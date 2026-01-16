/**
 * Wallet Command - Full wallet management for RAPTOR v4.0
 * Solana-only build
 *
 * Provides:
 * - Multi-wallet support (up to 5 wallets)
 * - Wallet generation with auto-delete credentials (2 minutes)
 * - Deposit/Withdrawal flows
 * - Wallet deletion with confirmation
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain, TradingMode, UserWallet, EncryptedData } from '@raptor/shared';
import {
  getUserWallets,
  getUserWalletsForChain,
  getWalletByIndex,
  createWallet,
  deleteWallet as deleteWalletFromDb,
  setActiveWallet,
  getWalletCount,
  generateSolanaKeypair,
  importSolanaKeypair,
  decryptPrivateKey,
  markWalletBackupExported,
  SOLANA_CONFIG,
} from '@raptor/shared';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  walletKeyboard,
  portfolioKeyboard,
  walletChainKeyboard,
  walletListKeyboard,
  walletActionsKeyboard,
  withdrawAmountKeyboard,
  backKeyboard,
  CHAIN_EMOJI,
  CHAIN_NAME,
} from '../utils/keyboards.js';
import {
  formatWalletsOverview,
  formatWalletCredentials,
  formatDeleteWalletWarning,
  escapeMarkdownV2,
  LINE,
  formatWalletName,
} from '../utils/formatters.js';

// Store pending wallet deletions for confirmation
const pendingDeletions = new Map<number, { chain: Chain; walletIndex: number }>();

// Store auto-delete message timeouts
const autoDeleteTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Fetch live balances for wallets from Solana RPC
 */
async function fetchWalletBalances(
  wallets: UserWallet[]
): Promise<Map<string, { balance: number; usdValue: number }>> {
  const balances = new Map<string, { balance: number; usdValue: number }>();
  const rpcUrl = SOLANA_CONFIG.rpcUrl;

  console.log(`[Wallet] Fetching balances for ${wallets.length} wallets from: ${rpcUrl.substring(0, 50)}...`);

  const connection = new Connection(rpcUrl);

  for (const wallet of wallets) {
    const key = `${wallet.chain}_${wallet.wallet_index}`;
    const address = wallet.solana_address;

    try {
      const balanceLamports = await connection.getBalance(new PublicKey(address), 'finalized');
      const sol = balanceLamports / LAMPORTS_PER_SOL;
      console.log(`[Wallet] ${key} (${address.slice(0, 8)}...): ${sol.toFixed(4)} SOL`);
      balances.set(key, { balance: sol, usdValue: 0 });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Wallet] RPC error for ${key} (${address.slice(0, 8)}...): ${errMsg}`);
      balances.set(key, { balance: 0, usdValue: 0 });
    }
  }

  return balances;
}

/**
 * Main wallet command - show wallets overview
 */
export async function walletCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    await showWalletsOverview(ctx, user.id, false);
  } catch (error) {
    console.error('[Wallet] Error:', error);
    await ctx.reply('Error loading wallets. Please try again.', {
      reply_markup: backKeyboard('menu'),
    });
  }
}

/**
 * Show wallets overview (reply or edit)
 */
async function showWalletsOverview(ctx: MyContext, userId: number, edit: boolean) {
  try {
    const wallets = await getUserWallets(userId);

    // Fetch live balances from chain RPCs (only if wallets exist)
    const balances = wallets.length > 0
      ? await fetchWalletBalances(wallets)
      : new Map();

    const message = formatWalletsOverview(wallets, balances);

    if (edit) {
      await ctx.editMessageText(message, {
        parse_mode: 'MarkdownV2',
        reply_markup: walletKeyboard(),
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'MarkdownV2',
        reply_markup: walletKeyboard(),
      });
    }
  } catch (error) {
    console.error('[Wallet] Error in showWalletsOverview:', error);
    throw error; // Re-throw to be caught by walletCommand
  }
}

/**
 * Show wallets via callback
 */
export async function showWallets(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    await showWalletsOverview(ctx, user.id, true);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading wallets' });
  }
}

/**
 * Show portfolio - all wallets as clickable buttons
 */
export async function showPortfolio(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Get all user wallets
    const wallets = await getUserWallets(user.id);

    if (wallets.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'No wallets yet. Create one first!',
        show_alert: true,
      });
      return;
    }

    // Format wallet data for keyboard
    // v3.4 (F1): Use cleaner wallet naming
    const walletData = wallets.map((w) => ({
      chain: w.chain,
      index: w.wallet_index,
      label: formatWalletName(w.wallet_index, w.wallet_label),
      isActive: w.is_active,
    }));

    const message = `💼 *PORTFOLIO*
${LINE}

Select a wallet to manage:`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: portfolioKeyboard(walletData),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error showing portfolio:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading portfolio' });
  }
}

/**
 * Show chain selection for wallet creation (Solana only)
 */
export async function showWalletCreate(ctx: MyContext) {
  const message = `➕ *CREATE WALLET*
${LINE}

Create a new Solana wallet.
You can have up to 5 wallets.`;

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: walletChainKeyboard(),
  });

  await ctx.answerCallbackQuery();
}

/**
 * Create a new Solana wallet
 */
export async function createNewWallet(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only build
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({
      text: 'This build is Solana-only',
      show_alert: true,
    });
    return;
  }

  try {
    // Check wallet count
    const count = await getWalletCount(user.id, 'sol');
    if (count >= 5) {
      await ctx.answerCallbackQuery({
        text: 'Maximum 5 wallets reached',
        show_alert: true,
      });
      return;
    }

    // Generate Solana keypair
    const keypair = generateSolanaKeypair();

    // Create wallet in database
    const wallet = await createWallet({
      tg_id: user.id,
      chain: 'sol',
      address: keypair.publicKey,
      private_key_encrypted: keypair.privateKeyEncrypted,
    });

    // Decrypt private key for display (pass tgId for v2 encryption)
    const privateKey = decryptPrivateKey(keypair.privateKeyEncrypted, user.id);

    // Show credentials
    const message = formatWalletCredentials(
      'sol',
      keypair.publicKey,
      privateKey,
      wallet.wallet_index
    );

    // Send new message with credentials
    const credentialsMsg = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ I Saved It', `wallet_saved_sol_${wallet.wallet_index}`)
        .row()
        .text('📋 Copy Address', `copy_${keypair.publicKey}`),
    });

    // Schedule auto-delete after 2 minutes
    const timeoutKey = `${user.id}_sol_${wallet.wallet_index}`;
    const existingTimeout = autoDeleteTimeouts.get(timeoutKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, credentialsMsg.message_id);
        autoDeleteTimeouts.delete(timeoutKey);
      } catch {
        // Message may already be deleted
      }
    }, 120_000); // 2 minutes

    autoDeleteTimeouts.set(timeoutKey, timeout);

    // Update original message
    // v3.4 (F1): Use cleaner wallet naming with chain icon
    const walletDisplayName = formatWalletName(wallet.wallet_index, null, 'sol', true);
    await ctx.editMessageText(
      `✅ *WALLET CREATED*
${LINE}

${CHAIN_EMOJI.sol} *Solana* - ${walletDisplayName}

Your new wallet has been created.
Credentials shown in the message above.

⚠️ *The credentials message will auto-delete in 2 minutes.*
Make sure to save your private key!`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );

    await ctx.answerCallbackQuery({ text: 'Wallet created successfully!' });
  } catch (error) {
    console.error('[Wallet] Error creating wallet:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // v3.4.1: Better error handling with specific messages
    let userMessage = 'Error creating wallet. Please try again.';
    if (errorMsg.includes('Maximum 5 wallets') || errorMsg.includes('maximum')) {
      userMessage = 'Maximum 5 wallets reached.';
    } else if (errorMsg.includes('duplicate') || errorMsg.includes('unique')) {
      userMessage = 'Wallet already exists. Try refreshing.';
    } else if (errorMsg.includes('connection') || errorMsg.includes('timeout')) {
      userMessage = 'Database connection error. Please try again later.';
    } else if (errorMsg.includes('encryption') || errorMsg.includes('key')) {
      userMessage = 'Encryption error. Please contact support.';
    }

    await ctx.answerCallbackQuery({
      text: userMessage,
      show_alert: true,
    });
  }
}

/**
 * Show wallet import screen (Solana only)
 */
export async function showWalletImport(ctx: MyContext) {
  const message = `${LINE}
📥 *IMPORT WALLET*
${LINE}

Import an existing Solana wallet.
You'll need to provide your private key.

⚠️ *SECURITY WARNING:*
• Your private key will be encrypted and stored securely
• The message with your key will be deleted immediately
• Make sure you're in a private chat

${LINE}`;

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text(`${CHAIN_EMOJI.sol} Import Solana`, 'wallet_import_sol')
      .row()
      .text('« Back', 'wallets'),
  });

  await ctx.answerCallbackQuery();
}

/**
 * Start import flow for Solana
 */
export async function startWalletImport(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only build
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({
      text: 'This build is Solana-only',
      show_alert: true,
    });
    return;
  }

  try {
    // Check wallet count
    const count = await getWalletCount(user.id, 'sol');
    if (count >= 5) {
      await ctx.answerCallbackQuery({
        text: 'Maximum 5 wallets reached',
        show_alert: true,
      });
      return;
    }

    await ctx.editMessageText(
      `${LINE}
📥 *IMPORT SOLANA WALLET*
${LINE}

Send your private key in the next message.

*Format:* base58
*Example:* \`5Kj...abc123\`

⚠️ *SECURITY:*
• Your message will be deleted immediately
• The private key will be encrypted
• Never share your private key with anyone

*Type your private key below:*

${LINE}`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Cancel', 'wallets'),
      }
    );

    // Set session state for import
    if (!ctx.session) {
      ctx.session = {
        step: null,
        pendingWithdrawal: null,
      };
    }
    ctx.session.awaitingImport = 'sol';

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error starting import:', error);
    await ctx.answerCallbackQuery({
      text: 'Error. Please try again.',
      show_alert: true,
    });
  }
}

/**
 * Handle "I Saved It" confirmation - delete credentials message
 */
export async function handleWalletSaved(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Mark backup as exported
    await markWalletBackupExported(user.id, 'sol', walletIndex);

    // Clear auto-delete timeout
    const timeoutKey = `${user.id}_sol_${walletIndex}`;
    const timeout = autoDeleteTimeouts.get(timeoutKey);
    if (timeout) {
      clearTimeout(timeout);
      autoDeleteTimeouts.delete(timeoutKey);
    }

    // Delete the credentials message
    await ctx.deleteMessage();

    await ctx.answerCallbackQuery({
      text: 'Great! Your wallet is ready to use.',
    });
  } catch (error) {
    console.error('[Wallet] Error handling saved:', error);
  }
}

/**
 * Show wallets for Solana
 */
export async function showChainWallets(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallets = await getUserWalletsForChain(user.id, 'sol');

    // v3.4.1: Fix line formatting - lines only below headings
    const message = `${CHAIN_EMOJI.sol} *Solana Wallets*
${LINE}

${wallets.length === 0 ? 'No wallets yet. Create one below.' : `You have ${wallets.length}/5 wallets.`}`;

    // v3.4 (F1): Use cleaner wallet naming
    const walletList = wallets.map((w) => ({
      index: w.wallet_index,
      label: formatWalletName(w.wallet_index, w.wallet_label),
      isActive: w.is_active,
    }));

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletListKeyboard('sol', walletList),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading wallets' });
  }
}

/**
 * Show wallet details/actions
 */
export async function showWalletDetails(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallet = await getWalletByIndex(user.id, 'sol', walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    const address = wallet.solana_address;
    const activeStatus = wallet.is_active ? '✓ Active' : '';

    // Fetch live balance
    let balance = 0;
    try {
      const connection = new Connection(SOLANA_CONFIG.rpcUrl);
      const balanceLamports = await connection.getBalance(new PublicKey(address), 'finalized');
      balance = balanceLamports / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('[Wallet] Error fetching balance for details:', error);
    }

    // v3.4.1: Fix line formatting - lines only below headings, use formatWalletName()
    const message = `${CHAIN_EMOJI.sol} *${formatWalletName(walletIndex, wallet.wallet_label, 'sol')}* ${activeStatus}
${LINE}

*Chain:* Solana
*Address:*
\`${address}\`

*Balance:* ${balance.toFixed(4)} SOL`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletActionsKeyboard('sol', walletIndex),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading wallet' });
  }
}

/**
 * Export wallet private key
 */
export async function exportWalletKey(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallet = await getWalletByIndex(user.id, 'sol', walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Decrypt private key (pass tgId for v2 encryption)
    const encryptedKey = wallet.solana_private_key_encrypted;
    const address = wallet.solana_address;
    const privateKey = decryptPrivateKey(encryptedKey as EncryptedData, user.id);

    // Show credentials in new message
    const message = formatWalletCredentials('sol', address, privateKey, walletIndex);

    const credentialsMsg = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('✅ I Saved It', `wallet_saved_sol_${walletIndex}`),
    });

    // Schedule auto-delete
    const timeoutKey = `${user.id}_sol_${walletIndex}_export`;

    const timeout = setTimeout(async () => {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, credentialsMsg.message_id);
        autoDeleteTimeouts.delete(timeoutKey);
      } catch {
        // Message may already be deleted
      }
    }, 120_000); // 2 minutes

    autoDeleteTimeouts.set(timeoutKey, timeout);

    await ctx.answerCallbackQuery({
      text: '⚠️ Key shown - message will auto-delete in 2 minutes',
      show_alert: true,
    });
  } catch (error) {
    console.error('[Wallet] Error exporting key:', error);
    await ctx.answerCallbackQuery({
      text: 'Error exporting key. Please try again.',
      show_alert: true,
    });
  }
}

/**
 * Set wallet as active
 */
export async function activateWallet(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    await setActiveWallet(user.id, 'sol', walletIndex);

    await ctx.answerCallbackQuery({
      text: `Wallet #${walletIndex} is now active`,
    });

    // Refresh wallet details
    await showWalletDetails(ctx, 'sol', walletIndex);
  } catch (error) {
    console.error('[Wallet] Error activating wallet:', error);
    await ctx.answerCallbackQuery({ text: 'Error activating wallet' });
  }
}

/**
 * Start wallet deletion - show warning
 */
export async function startDeleteWallet(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallet = await getWalletByIndex(user.id, 'sol', walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Check if this is the only wallet
    const count = await getWalletCount(user.id, 'sol');
    if (count <= 1) {
      await ctx.answerCallbackQuery({
        text: 'Cannot delete the only wallet',
        show_alert: true,
      });
      return;
    }

    // Store pending deletion
    pendingDeletions.set(user.id, { chain: 'sol', walletIndex });

    // Set session step
    ctx.session.step = 'awaiting_delete_confirmation';

    // v3.4.1: Use formatWalletName() for consistent naming
    const message = formatDeleteWalletWarning(
      'sol',
      walletIndex,
      formatWalletName(walletIndex, wallet.wallet_label, 'sol')
    );

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'wallet_chain_sol'),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error starting delete:', error);
    await ctx.answerCallbackQuery({ text: 'Error starting delete' });
  }
}

/**
 * Confirm wallet deletion (called from text message handler)
 */
export async function confirmDeleteWallet(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const pendingDelete = pendingDeletions.get(user.id);
  if (!pendingDelete) {
    await ctx.reply('No pending wallet deletion.');
    return;
  }

  const { walletIndex } = pendingDelete;

  try {
    await deleteWalletFromDb(user.id, 'sol', walletIndex);

    // Clear pending deletion
    pendingDeletions.delete(user.id);
    ctx.session.step = null;

    await ctx.reply(
      `✅ Wallet #${walletIndex} on Solana has been deleted.`,
      {
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );
  } catch (error) {
    console.error('[Wallet] Error deleting wallet:', error);
    await ctx.reply('Error deleting wallet. Please try again.');
  }
}

/**
 * Cancel wallet deletion
 */
export function cancelDeleteWallet(userId: number) {
  pendingDeletions.delete(userId);
}

/**
 * Show deposit screen for a wallet
 */
export async function showWalletDeposit(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallet = await getWalletByIndex(user.id, 'sol', walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    const address = wallet.solana_address;

    // v3.4.1: Fix line formatting - lines only below headings
    const message = `📥 *DEPOSIT*
${LINE}

${CHAIN_EMOJI.sol} *Solana* - ${formatWalletName(walletIndex, wallet.wallet_label, 'sol')}

Send *SOL* to this address:

\`${address}\`

*Minimum:* 0.05 SOL

⚠️ Only send SOL on Solana network.
Sending other tokens may result in loss.`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('📋 Copy Address', `copy_${address}`)
        .row()
        .text('🔄 Check Balance', `wallet_select_sol_${walletIndex}`)
        .row()
        .text('« Back', `wallet_select_sol_${walletIndex}`),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error showing deposit:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading deposit info' });
  }
}

/**
 * Start withdrawal flow - show amount selection
 */
export async function startWithdrawal(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallet = await getWalletByIndex(user.id, 'sol', walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Fetch current balance
    const address = wallet.solana_address;
    let balance = 0;

    try {
      const connection = new Connection(SOLANA_CONFIG.rpcUrl);
      const balanceLamports = await connection.getBalance(new PublicKey(address), 'finalized');
      balance = balanceLamports / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('[Wallet] Error fetching balance for withdrawal:', error);
    }

    // v3.4.1: Fix line formatting - lines only below headings
    const message = `📤 *WITHDRAW*
${LINE}

${CHAIN_EMOJI.sol} *Solana* - ${formatWalletName(walletIndex, wallet.wallet_label, 'sol')}

*Current Balance:* ${balance.toFixed(4)} SOL

Select amount to withdraw:`;

    // Store withdrawal context in session
    if (!ctx.session) {
      ctx.session = {
        step: null,
        pendingWithdrawal: null,
      };
    }
    ctx.session.pendingWithdrawal = {
      chain: 'sol',
      walletIndex,
      amount: balance.toString(),
      address: undefined,
    };

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: withdrawAmountKeyboard('sol', walletIndex),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error starting withdrawal:', error);
    await ctx.answerCallbackQuery({ text: 'Error starting withdrawal' });
  }
}

/**
 * Handle percentage-based withdrawal amount selection
 */
export async function selectWithdrawalPercentage(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number,
  percentage: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    const wallet = await getWalletByIndex(user.id, 'sol', walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Fetch current balance
    const address = wallet.solana_address;
    let balance = 0;

    const connection = new Connection(SOLANA_CONFIG.rpcUrl);
    const balanceLamports = await connection.getBalance(new PublicKey(address), 'finalized');
    balance = balanceLamports / LAMPORTS_PER_SOL;

    // Calculate amount (keep some for gas if not 100%)
    let withdrawAmount: number;
    if (percentage === 100) {
      // For 100%, leave minimum for gas
      const gasReserve = 0.001;
      withdrawAmount = Math.max(0, balance - gasReserve);
    } else {
      withdrawAmount = (balance * percentage) / 100;
    }

    if (withdrawAmount <= 0) {
      await ctx.answerCallbackQuery({
        text: 'Insufficient balance for withdrawal',
        show_alert: true,
      });
      return;
    }

    // Update session with amount
    ctx.session.pendingWithdrawal = {
      chain: 'sol',
      walletIndex,
      amount: withdrawAmount.toFixed(6),
      address: undefined,
    };
    ctx.session.step = 'awaiting_withdrawal_address';

    const amountText = `${withdrawAmount.toFixed(6)} SOL`;
    // v3.4.1: Fix line formatting - lines only below headings
    const message = `📤 *WITHDRAW ${percentage}%*
${LINE}

*Amount:* ${escapeMarkdownV2(amountText)}

Please enter the destination address:`;

    await ctx.editMessageText(message, {
      parse_mode: 'MarkdownV2',
      reply_markup: new InlineKeyboard().text('« Cancel', `wallet_select_sol_${walletIndex}`),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error selecting withdrawal percentage:', error);
    await ctx.answerCallbackQuery({ text: 'Error processing withdrawal' });
  }
}

/**
 * Start custom amount withdrawal flow
 */
export async function startCustomWithdrawal(
  ctx: MyContext,
  chain: Chain,
  walletIndex: number
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  try {
    // Set session for custom amount input
    ctx.session.step = 'awaiting_withdrawal_amount';
    ctx.session.pendingWithdrawal = {
      chain: 'sol',
      walletIndex,
      amount: undefined,
      address: undefined,
    };

    const message = `${LINE}
📤 *CUSTOM WITHDRAWAL*
${LINE}

Enter the amount to withdraw in SOL:

*Example:* 0.5

${LINE}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('« Cancel', `wallet_select_sol_${walletIndex}`),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error starting custom withdrawal:', error);
    await ctx.answerCallbackQuery({ text: 'Error' });
  }
}

// Legacy exports for backwards compatibility
export { showWallets as showWallet };
