/**
 * Text Message Handler for RAPTOR v2.3
 *
 * Handles:
 * - Wallet address detection (shows send options)
 * - Contract address detection (shows token info + buy)
 * - Withdrawal amount input
 * - Wallet deletion confirmation
 * - Custom strategy value inputs
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getUserBalances, userHasWallet } from '@raptor/shared';
import { sendOptionsKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';
import { formatSendToAddress, LINE } from '../utils/formatters.js';
import { confirmDeleteWallet, cancelDeleteWallet } from '../commands/wallet.js';

// Regex patterns for address detection
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Common token mint addresses to distinguish from wallet addresses
const KNOWN_TOKEN_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

/**
 * Main text message handler
 */
export async function handleTextMessage(ctx: MyContext) {
  const user = ctx.from;
  const text = ctx.message?.text?.trim();

  if (!user || !text) return;

  // Handle session-based flows first
  if (ctx.session.step) {
    const handled = await handleSessionFlow(ctx, text);
    if (handled) return;
  }

  // Detect and handle addresses/CAs
  const addressInfo = detectAddress(text);
  if (addressInfo) {
    await handleAddressInput(ctx, addressInfo);
    return;
  }

  // If no handler matched, ignore (or could show help)
}

/**
 * Handle session-based input flows
 */
async function handleSessionFlow(ctx: MyContext, text: string): Promise<boolean> {
  switch (ctx.session.step) {
    case 'awaiting_withdrawal_amount':
      await handleWithdrawalAmountInput(ctx, text);
      return true;

    case 'awaiting_delete_confirmation':
      await handleDeleteConfirmation(ctx, text);
      return true;

    case 'awaiting_custom_tp':
    case 'awaiting_custom_sl':
    case 'awaiting_custom_maxhold':
    case 'awaiting_custom_value':
      await handleCustomStrategyInput(ctx, text);
      return true;

    case 'awaiting_send_amount':
      await handleSendAmountInput(ctx, text);
      return true;

    default:
      return false;
  }
}

/**
 * Detect if text is a wallet address or contract address
 */
function detectAddress(text: string): {
  type: 'solana_wallet' | 'solana_token' | 'evm_wallet' | 'evm_token';
  address: string;
  chain: Chain;
} | null {
  // Check Solana address
  if (SOLANA_ADDRESS_REGEX.test(text)) {
    // Determine if it's a known token or likely a wallet
    const isKnownToken = KNOWN_TOKEN_MINTS.has(text);
    return {
      type: isKnownToken ? 'solana_token' : 'solana_wallet',
      address: text,
      chain: 'sol',
    };
  }

  // Check EVM address
  if (EVM_ADDRESS_REGEX.test(text)) {
    // For EVM, we can't easily distinguish wallet vs token
    // Assume it's a token/CA - user can use wallet menu for sends
    return {
      type: 'evm_token',
      address: text,
      chain: 'eth', // Default to ETH, will be selectable
    };
  }

  return null;
}

/**
 * Handle detected address input
 */
async function handleAddressInput(
  ctx: MyContext,
  addressInfo: {
    type: 'solana_wallet' | 'solana_token' | 'evm_wallet' | 'evm_token';
    address: string;
    chain: Chain;
  }
) {
  const user = ctx.from;
  if (!user) return;

  // Check if user has a wallet
  const hasWallet = await userHasWallet(user.id);
  if (!hasWallet) {
    await ctx.reply(
      `${LINE}\n⚠️ *No Wallet Found*\n${LINE}\n\nYou need to create a wallet first.\n\n${LINE}`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('🦖 Get Started', 'start_generate_wallet'),
      }
    );
    return;
  }

  if (addressInfo.type === 'solana_wallet') {
    // Show send options for Solana
    await showSendOptions(ctx, addressInfo.address, 'sol');
  } else if (addressInfo.type === 'evm_wallet' || addressInfo.type === 'evm_token') {
    // For EVM, show chain selection first
    await showEvmChainSelection(ctx, addressInfo.address);
  } else if (addressInfo.type === 'solana_token') {
    // Show token info + buy options
    await showTokenCard(ctx, addressInfo.address, 'sol');
  }
}

/**
 * Show send options when wallet address is detected
 */
async function showSendOptions(ctx: MyContext, toAddress: string, chain: Chain) {
  const message = formatSendToAddress(toAddress, chain);

  // Store in session for the send flow
  ctx.session.pendingSend = {
    toAddress,
    chain,
  };

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: sendOptionsKeyboard(chain),
  });
}

/**
 * Show EVM chain selection when EVM address detected
 */
async function showEvmChainSelection(ctx: MyContext, address: string) {
  const message = `${LINE}
🔗 *SELECT CHAIN*
${LINE}

Address detected:
\`${address.slice(0, 10)}...${address.slice(-8)}\`

Which chain is this for?

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text(`${CHAIN_EMOJI.bsc} BSC`, `address_chain_bsc_${address}`)
    .text(`${CHAIN_EMOJI.base} Base`, `address_chain_base_${address}`)
    .row()
    .text(`${CHAIN_EMOJI.eth} Ethereum`, `address_chain_eth_${address}`)
    .row()
    .text('❌ Cancel', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show token card with buy options
 */
async function showTokenCard(ctx: MyContext, tokenAddress: string, chain: Chain) {
  // TODO: Fetch token info from API
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  const message = `${LINE}
🪙 *TOKEN DETECTED*
${LINE}

${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}*

*Address:*
\`${tokenAddress}\`

⏳ Loading token info...

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text(`🛒 Buy 0.1 ${symbol}`, `buy_${chain}_${tokenAddress}_0.1`)
    .text(`🛒 Buy 0.5 ${symbol}`, `buy_${chain}_${tokenAddress}_0.5`)
    .row()
    .text(`🛒 Buy 1 ${symbol}`, `buy_${chain}_${tokenAddress}_1`)
    .text(`🛒 Buy X`, `buy_${chain}_${tokenAddress}_custom`)
    .row()
    .text('🔍 Analyze', `analyze_${chain}_${tokenAddress}`)
    .text('🔄 Refresh', `refresh_${chain}_${tokenAddress}`)
    .row()
    .text('« Back', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Handle withdrawal amount input
 */
async function handleWithdrawalAmountInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain } = ctx.session.pendingWithdrawal;
  const balances = await getUserBalances(user.id);
  const balance = balances.find((b) => b.chain === chain);

  if (!balance) {
    await ctx.reply('❌ Error: Balance not found.');
    ctx.session.step = null;
    ctx.session.pendingWithdrawal = null;
    return;
  }

  const available = parseFloat(balance.current_value);
  let amount: number;

  if (text.toLowerCase() === 'max') {
    amount = available;
  } else {
    amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Invalid amount. Please enter a valid number.');
      return;
    }
    if (amount > available) {
      await ctx.reply(`❌ Insufficient balance. Maximum: ${available.toFixed(4)}`);
      return;
    }
  }

  ctx.session.pendingWithdrawal.amount = amount.toString();
  ctx.session.step = 'awaiting_withdrawal_confirm';

  const token = chain === 'bsc' ? 'BNB' : chain === 'sol' ? 'SOL' : 'ETH';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', 'confirm_withdraw')
    .text('❌ Cancel', 'cancel');

  await ctx.reply(
    `⚠️ *Confirm Withdrawal*\n\n` +
      `Amount: ${amount.toFixed(4)} ${token}\n` +
      `Chain: ${CHAIN_NAME[chain as Chain]}\n\n` +
      `Funds will be sent to your deposit address.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

/**
 * Handle DELETE confirmation for wallet deletion
 */
async function handleDeleteConfirmation(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user) return;

  if (text.toUpperCase() === 'DELETE') {
    await confirmDeleteWallet(ctx);
  } else {
    // Cancel deletion
    cancelDeleteWallet(user.id);
    ctx.session.step = null;

    await ctx.reply('Wallet deletion cancelled.', {
      reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
    });
  }
}

/**
 * Handle custom strategy value input
 */
async function handleCustomStrategyInput(ctx: MyContext, text: string) {
  const step = ctx.session.step;
  const value = parseFloat(text);

  if (isNaN(value)) {
    await ctx.reply('❌ Please enter a valid number.');
    return;
  }

  // Validate ranges based on step
  let isValid = true;
  let errorMsg = '';

  switch (step) {
    case 'awaiting_custom_tp':
      if (value < 10 || value > 500) {
        isValid = false;
        errorMsg = 'Take profit must be between 10% and 500%';
      }
      break;
    case 'awaiting_custom_sl':
      if (value < 5 || value > 50) {
        isValid = false;
        errorMsg = 'Stop loss must be between 5% and 50%';
      }
      break;
    case 'awaiting_custom_maxhold':
      if (value < 5 || value > 1440) {
        isValid = false;
        errorMsg = 'Max hold must be between 5 and 1440 minutes (24h)';
      }
      break;
  }

  if (!isValid) {
    await ctx.reply(`❌ ${errorMsg}`);
    return;
  }

  // Store value and continue
  // TODO: Update user's custom strategy in database
  ctx.session.step = null;

  await ctx.reply(`✅ Value set to ${value}`, {
    reply_markup: new InlineKeyboard().text('« Back to Strategy', 'strategy_custom'),
  });
}

/**
 * Handle send amount input
 */
async function handleSendAmountInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingSend) return;

  const amount = parseFloat(text);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a valid number.');
    return;
  }

  const { toAddress, chain } = ctx.session.pendingSend;
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  ctx.session.pendingSend.amount = amount.toString();
  ctx.session.step = 'awaiting_send_confirm';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Send', 'confirm_send')
    .text('❌ Cancel', 'cancel_send');

  await ctx.reply(
    `${LINE}\n⚠️ *Confirm Send*\n${LINE}\n\n` +
      `*Amount:* ${amount} ${symbol}\n` +
      `*To:* \`${toAddress.slice(0, 10)}...${toAddress.slice(-8)}\`\n` +
      `*Chain:* ${CHAIN_NAME[chain]}\n\n` +
      `${LINE}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// Extend session type to include pendingSend
declare module '../types.js' {
  interface SessionData {
    pendingSend?: {
      toAddress: string;
      chain: Chain;
      amount?: string;
      tokenAddress?: string;
    };
  }
}
