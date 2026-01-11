/**
 * Wallet Command - Full wallet management for RAPTOR v2.3
 *
 * Provides:
 * - Multi-wallet support (up to 5 wallets per chain)
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
  generateEvmKeypair,
  importSolanaKeypair,
  importEvmKeypair,
  decryptPrivateKey,
  markWalletBackupExported,
  SOLANA_CONFIG,
  getChainConfig,
} from '@raptor/shared';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { JsonRpcProvider, formatEther } from 'ethers';
import {
  walletKeyboard,
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
  LINE,
} from '../utils/formatters.js';

// Store pending wallet deletions for confirmation
const pendingDeletions = new Map<number, { chain: Chain; walletIndex: number }>();

// Store auto-delete message timeouts
const autoDeleteTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Fetch live balances for wallets from chain RPCs
 */
async function fetchWalletBalances(
  wallets: UserWallet[]
): Promise<Map<string, { balance: number; usdValue: number }>> {
  const balances = new Map<string, { balance: number; usdValue: number }>();

  for (const wallet of wallets) {
    const key = `${wallet.chain}_${wallet.wallet_index}`;
    const address = wallet.chain === 'sol' ? wallet.solana_address : wallet.evm_address;

    try {
      let balance: bigint;

      if (wallet.chain === 'sol') {
        // Solana: Get SOL balance
        const connection = new Connection(SOLANA_CONFIG.rpcUrl);
        balance = BigInt(
          await connection.getBalance(new PublicKey(address), 'finalized')
        );
        const sol = Number(balance) / LAMPORTS_PER_SOL;
        balances.set(key, { balance: sol, usdValue: 0 });
      } else {
        // EVM: Get native token balance (ETH/BNB)
        const config = getChainConfig(wallet.chain);
        const provider = new JsonRpcProvider(config.rpcUrl);
        balance = await provider.getBalance(address);
        const eth = Number(formatEther(balance));
        balances.set(key, { balance: eth, usdValue: 0 });
      }
    } catch (error) {
      console.error(`[Wallet] Failed to fetch balance for ${key}:`, error);
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
 * Show chain selection for wallet creation
 */
export async function showWalletCreate(ctx: MyContext) {
  const message = `${LINE}
➕ *CREATE WALLET*
${LINE}

Select a chain to create a new wallet.
You can have up to 5 wallets per chain.

${LINE}`;

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: walletChainKeyboard(),
  });

  await ctx.answerCallbackQuery();
}

/**
 * Create a new wallet for a chain
 */
export async function createNewWallet(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Check wallet count
    const count = await getWalletCount(user.id, chain);
    if (count >= 5) {
      await ctx.answerCallbackQuery({
        text: `Maximum 5 wallets reached for ${CHAIN_NAME[chain]}`,
        show_alert: true,
      });
      return;
    }

    // Generate keypair based on chain type
    const isSolana = chain === 'sol';
    const keypair = isSolana ? generateSolanaKeypair() : generateEvmKeypair();

    // Create wallet in database
    const wallet = await createWallet({
      tg_id: user.id,
      chain,
      address: keypair.publicKey,
      private_key_encrypted: keypair.privateKeyEncrypted,
    });

    // Decrypt private key for display
    const privateKey = decryptPrivateKey(keypair.privateKeyEncrypted);

    // Show credentials
    const message = formatWalletCredentials(
      chain,
      keypair.publicKey,
      privateKey,
      wallet.wallet_index
    );

    // Send new message with credentials
    const credentialsMsg = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ I Saved It', `wallet_saved_${chain}_${wallet.wallet_index}`)
        .row()
        .text('📋 Copy Address', `copy_${keypair.publicKey}`),
    });

    // Schedule auto-delete after 2 minutes
    const timeoutKey = `${user.id}_${chain}_${wallet.wallet_index}`;
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
    await ctx.editMessageText(
      `${LINE}
✅ *WALLET CREATED*
${LINE}

${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}* - Wallet #${wallet.wallet_index}

Your new wallet has been created.
Credentials shown in the message above.

⚠️ *The credentials message will auto-delete in 2 minutes.*
Make sure to save your private key!

${LINE}`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );

    await ctx.answerCallbackQuery({ text: 'Wallet created successfully!' });
  } catch (error) {
    console.error('[Wallet] Error creating wallet:', error);
    await ctx.answerCallbackQuery({
      text: 'Error creating wallet. Please try again.',
      show_alert: true,
    });
  }
}

/**
 * Show chain selection for wallet import
 */
export async function showWalletImport(ctx: MyContext) {
  const message = `${LINE}
📥 *IMPORT WALLET*
${LINE}

Select a chain to import an existing wallet.
You'll need to provide your private key.

⚠️ *SECURITY WARNING:*
• Your private key will be encrypted and stored securely
• The message with your key will be deleted immediately
• Make sure you're in a private chat

${LINE}`;

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard()
      .text(`${CHAIN_EMOJI.sol} Solana`, 'wallet_import_sol')
      .text(`${CHAIN_EMOJI.bsc} BSC`, 'wallet_import_bsc')
      .row()
      .text(`${CHAIN_EMOJI.base} Base`, 'wallet_import_base')
      .text(`${CHAIN_EMOJI.eth} Ethereum`, 'wallet_import_eth')
      .row()
      .text('« Back', 'wallets'),
  });

  await ctx.answerCallbackQuery();
}

/**
 * Start import flow for a specific chain
 */
export async function startWalletImport(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Check wallet count
    const count = await getWalletCount(user.id, chain);
    if (count >= 5) {
      await ctx.answerCallbackQuery({
        text: `Maximum 5 wallets reached for ${CHAIN_NAME[chain]}`,
        show_alert: true,
      });
      return;
    }

    const isSolana = chain === 'sol';
    const keyFormat = isSolana ? 'base58' : 'hex (with or without 0x prefix)';
    const example = isSolana ? '5Kj...abc123' : '0x1234...abcd';

    await ctx.editMessageText(
      `${LINE}
📥 *IMPORT ${CHAIN_NAME[chain].toUpperCase()} WALLET*
${LINE}

Send your private key in the next message.

*Format:* ${keyFormat}
*Example:* \`${example}\`

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
    ctx.session.awaitingImport = chain;

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
    await markWalletBackupExported(user.id, chain, walletIndex);

    // Clear auto-delete timeout
    const timeoutKey = `${user.id}_${chain}_${walletIndex}`;
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
 * Show wallets for a specific chain
 */
export async function showChainWallets(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  try {
    const wallets = await getUserWalletsForChain(user.id, chain);

    const message = `${LINE}
${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]} Wallets*
${LINE}

${wallets.length === 0 ? 'No wallets yet. Create one below.' : `You have ${wallets.length}/5 wallets.`}

${LINE}`;

    const walletList = wallets.map((w) => ({
      index: w.wallet_index,
      label: w.wallet_label || `Wallet #${w.wallet_index}`,
      isActive: w.is_active,
    }));

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletListKeyboard(chain, walletList),
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

  try {
    const wallet = await getWalletByIndex(user.id, chain, walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;
    const activeStatus = wallet.is_active ? '✓ Active' : '';
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

    const message = `${LINE}
${CHAIN_EMOJI[chain]} *${wallet.wallet_label || `Wallet #${walletIndex}`}* ${activeStatus}
${LINE}

*Chain:* ${CHAIN_NAME[chain]}
*Address:*
\`${address}\`

*Balance:* 0.0000 ${symbol}

${LINE}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: walletActionsKeyboard(chain, walletIndex),
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

  try {
    const wallet = await getWalletByIndex(user.id, chain, walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Decrypt private key
    const isSolana = chain === 'sol';
    const encryptedKey = isSolana
      ? wallet.solana_private_key_encrypted
      : wallet.evm_private_key_encrypted;
    const address = isSolana ? wallet.solana_address : wallet.evm_address;
    const privateKey = decryptPrivateKey(encryptedKey as EncryptedData);

    // Show credentials in new message
    const message = formatWalletCredentials(chain, address, privateKey, walletIndex);

    const credentialsMsg = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('✅ I Saved It', `wallet_saved_${chain}_${walletIndex}`),
    });

    // Schedule auto-delete
    const timeoutKey = `${user.id}_${chain}_${walletIndex}_export`;

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

  try {
    await setActiveWallet(user.id, chain, walletIndex);

    await ctx.answerCallbackQuery({
      text: `Wallet #${walletIndex} is now active`,
    });

    // Refresh wallet details
    await showWalletDetails(ctx, chain, walletIndex);
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

  try {
    const wallet = await getWalletByIndex(user.id, chain, walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Check if this is the only wallet on the chain
    const count = await getWalletCount(user.id, chain);
    if (count <= 1) {
      await ctx.answerCallbackQuery({
        text: 'Cannot delete the only wallet on this chain',
        show_alert: true,
      });
      return;
    }

    // Store pending deletion
    pendingDeletions.set(user.id, { chain, walletIndex });

    // Set session step
    ctx.session.step = 'awaiting_delete_confirmation';

    const message = formatDeleteWalletWarning(
      chain,
      walletIndex,
      wallet.wallet_label || `Wallet #${walletIndex}`
    );

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('❌ Cancel', `wallet_chain_${chain}`),
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

  const { chain, walletIndex } = pendingDelete;

  try {
    await deleteWalletFromDb(user.id, chain, walletIndex);

    // Clear pending deletion
    pendingDeletions.delete(user.id);
    ctx.session.step = null;

    await ctx.reply(
      `✅ Wallet #${walletIndex} on ${CHAIN_NAME[chain]} has been deleted.`,
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

  try {
    const wallet = await getWalletByIndex(user.id, chain, walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
    const minDeposit =
      chain === 'sol'
        ? '0.05 SOL'
        : chain === 'bsc'
          ? '0.01 BNB'
          : '0.01 ETH';

    const message = `${LINE}
📥 *DEPOSIT*
${LINE}

${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}* - ${wallet.wallet_label || `Wallet #${walletIndex}`}

Send *${symbol}* to this address:

\`${address}\`

*Minimum:* ${minDeposit}

⚠️ Only send ${symbol} on ${CHAIN_NAME[chain]} network.
Sending other tokens may result in loss.

${LINE}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('📋 Copy Address', `copy_${address}`)
        .row()
        .text('🔄 Check Balance', `wallet_select_${chain}_${walletIndex}`)
        .row()
        .text('« Back', `wallet_select_${chain}_${walletIndex}`),
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

  try {
    const wallet = await getWalletByIndex(user.id, chain, walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Fetch current balance
    const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;
    let balance = 0;

    try {
      if (chain === 'sol') {
        const connection = new Connection(SOLANA_CONFIG.rpcUrl);
        const balanceLamports = await connection.getBalance(new PublicKey(address), 'finalized');
        balance = balanceLamports / LAMPORTS_PER_SOL;
      } else {
        const config = getChainConfig(chain);
        const provider = new JsonRpcProvider(config.rpcUrl);
        const balanceWei = await provider.getBalance(address);
        balance = Number(formatEther(balanceWei));
      }
    } catch (error) {
      console.error('[Wallet] Error fetching balance for withdrawal:', error);
    }

    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

    const message = `${LINE}
📤 *WITHDRAW*
${LINE}

${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}* - ${wallet.wallet_label || `Wallet #${walletIndex}`}

*Current Balance:* ${balance.toFixed(4)} ${symbol}

Select amount to withdraw:

${LINE}`;

    // Store withdrawal context in session
    if (!ctx.session) {
      ctx.session = {
        step: null,
        pendingWithdrawal: null,
      };
    }
    ctx.session.pendingWithdrawal = {
      chain,
      amount: balance.toString(),
      address: undefined,
    };

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: withdrawAmountKeyboard(chain, walletIndex),
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

  try {
    const wallet = await getWalletByIndex(user.id, chain, walletIndex);
    if (!wallet) {
      await ctx.answerCallbackQuery({ text: 'Wallet not found' });
      return;
    }

    // Fetch current balance
    const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;
    let balance = 0;

    if (chain === 'sol') {
      const connection = new Connection(SOLANA_CONFIG.rpcUrl);
      const balanceLamports = await connection.getBalance(new PublicKey(address), 'finalized');
      balance = balanceLamports / LAMPORTS_PER_SOL;
    } else {
      const config = getChainConfig(chain);
      const provider = new JsonRpcProvider(config.rpcUrl);
      const balanceWei = await provider.getBalance(address);
      balance = Number(formatEther(balanceWei));
    }

    // Calculate amount (keep some for gas if not 100%)
    let withdrawAmount: number;
    if (percentage === 100) {
      // For 100%, leave minimum for gas
      const gasReserve = chain === 'sol' ? 0.001 : chain === 'bsc' ? 0.001 : 0.001;
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

    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

    // Update session with amount
    ctx.session.pendingWithdrawal = {
      chain,
      amount: withdrawAmount.toFixed(6),
      address: undefined,
    };
    ctx.session.step = 'awaiting_withdrawal_address';

    const message = `${LINE}
📤 *WITHDRAW ${percentage}%*
${LINE}

*Amount:* ${withdrawAmount.toFixed(6)} ${symbol}

Please enter the destination address:

${LINE}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('« Cancel', `wallet_select_${chain}_${walletIndex}`),
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

  try {
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

    // Set session for custom amount input
    ctx.session.step = 'awaiting_withdrawal_amount';
    ctx.session.pendingWithdrawal = {
      chain,
      amount: undefined,
      address: undefined,
    };

    const message = `${LINE}
📤 *CUSTOM WITHDRAWAL*
${LINE}

Enter the amount to withdraw in ${symbol}:

*Example:* 0.5

${LINE}`;

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('« Cancel', `wallet_select_${chain}_${walletIndex}`),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Wallet] Error starting custom withdrawal:', error);
    await ctx.answerCallbackQuery({ text: 'Error' });
  }
}

// Legacy exports for backwards compatibility
export { showWallets as showWallet };
