// /sell command - Sell a position
// Usage: /sell <contract> [amount|max] or select from active positions

import { CommandContext, Context, InlineKeyboard } from 'grammy';
import {
  getActivePositions,
  getPositionByToken,
  closePosition,
  type Position,
  type Chain,
} from '@raptor/shared';

const CHAIN_SYMBOLS: Record<Chain, string> = {
  bsc: 'BNB',
  base: 'ETH',
  eth: 'ETH',
  sol: 'SOL',
};

export async function sellCommand(ctx: CommandContext<Context>): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  const args = ctx.match?.toString().trim().split(/\s+/) || [];

  // If no arguments, show active positions for selection
  if (args.length === 0 || args[0] === '') {
    await showPositionsForSale(ctx, tgId);
    return;
  }

  // If contract provided: /sell <contract> [amount]
  const [tokenAddress, amountOrMax] = args;

  // Validate token address
  const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress);
  const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(tokenAddress);

  if (!isSolanaAddress && !isEvmAddress) {
    await ctx.reply(
      'Invalid token address. Use /sell without arguments to see your positions.'
    );
    return;
  }

  // Find position across all chains
  const positions = await getActivePositions(tgId);
  const position = positions.find(
    (p) => p.token_address.toLowerCase() === tokenAddress.toLowerCase()
  );

  if (!position) {
    await ctx.reply(
      'No active position found for this token.\n' +
        'Use /sell without arguments to see your positions.'
    );
    return;
  }

  // Determine amount to sell
  const tokensHeld = parseFloat(position.tokens_held);
  let sellAmount: number;

  if (!amountOrMax || amountOrMax.toLowerCase() === 'max' || amountOrMax === '100%') {
    sellAmount = tokensHeld;
  } else if (amountOrMax.endsWith('%')) {
    const percent = parseFloat(amountOrMax.slice(0, -1));
    if (isNaN(percent) || percent <= 0 || percent > 100) {
      await ctx.reply('Invalid percentage. Use a value between 1% and 100%.');
      return;
    }
    sellAmount = (tokensHeld * percent) / 100;
  } else {
    sellAmount = parseFloat(amountOrMax);
    if (isNaN(sellAmount) || sellAmount <= 0) {
      await ctx.reply('Invalid amount. Enter a positive number or "max".');
      return;
    }
    if (sellAmount > tokensHeld) {
      await ctx.reply(
        `You only hold ${tokensHeld.toFixed(4)} tokens. Use "max" to sell all.`
      );
      return;
    }
  }

  // Show confirmation
  const sellPercent = (sellAmount / tokensHeld) * 100;
  const symbol = CHAIN_SYMBOLS[position.chain];
  const pnl = parseFloat(position.unrealized_pnl);
  const pnlPercent = position.unrealized_pnl_percent;
  const pnlEmoji = pnl >= 0 ? '📈' : '📉';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Sell', `confirm_sell:${position.id}:${sellAmount}`)
    .text('❌ Cancel', 'cancel_sell');

  await ctx.reply(
    `*Confirm Sell Order*\n\n` +
      `Token: ${position.token_symbol}\n` +
      `Chain: ${position.chain.toUpperCase()}\n` +
      `Amount: ${sellAmount.toFixed(4)} tokens (${sellPercent.toFixed(1)}%)\n\n` +
      `Entry: ${parseFloat(position.entry_price).toFixed(8)} ${symbol}\n` +
      `Current: ${parseFloat(position.current_price).toFixed(8)} ${symbol}\n` +
      `${pnlEmoji} P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%\n\n` +
      `*Note:* 1% fee will be applied to proceeds.`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

async function showPositionsForSale(
  ctx: CommandContext<Context>,
  tgId: number
): Promise<void> {
  const positions = await getActivePositions(tgId);

  if (positions.length === 0) {
    await ctx.reply(
      'You have no active positions to sell.\n\n' +
        'Use /snipe to open a new position.'
    );
    return;
  }

  let message = '*Your Active Positions*\n\n';

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < positions.length && i < 10; i++) {
    const p = positions[i];
    const pnl = p.unrealized_pnl_percent;
    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
    const symbol = CHAIN_SYMBOLS[p.chain];

    message += `${pnlEmoji} *${p.token_symbol}* (${p.chain.toUpperCase()})\n`;
    message += `   Entry: ${parseFloat(p.entry_price).toFixed(8)} ${symbol}\n`;
    message += `   P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%\n\n`;

    // Add sell buttons
    keyboard
      .text(`Sell 50% ${p.token_symbol}`, `sell:${p.id}:50`)
      .text(`Sell 100% ${p.token_symbol}`, `sell:${p.id}:100`)
      .row();
  }

  message += 'Select a position to sell, or use:\n';
  message += '`/sell <contract> [amount|max]`';

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

// Handle sell callback buttons
export async function handleSellCallback(
  ctx: Context,
  data: string
): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  // Parse callback data: sell:<positionId>:<percent>
  const [, positionIdStr, percentStr] = data.split(':');
  const positionId = parseInt(positionIdStr, 10);
  const percent = parseInt(percentStr, 10);

  // Get position
  const positions = await getActivePositions(tgId);
  const position = positions.find((p) => p.id === positionId);

  if (!position) {
    await ctx.answerCallbackQuery({ text: 'Position not found' });
    return;
  }

  const tokensHeld = parseFloat(position.tokens_held);
  const sellAmount = (tokensHeld * percent) / 100;

  // Show confirmation
  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', `confirm_sell:${positionId}:${sellAmount}`)
    .text('❌ Cancel', 'cancel_sell');

  await ctx.editMessageText(
    `*Sell ${position.token_symbol}?*\n\n` +
      `Amount: ${sellAmount.toFixed(4)} tokens (${percent}%)\n` +
      `Current P&L: ${position.unrealized_pnl_percent >= 0 ? '+' : ''}${position.unrealized_pnl_percent.toFixed(2)}%`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );

  await ctx.answerCallbackQuery();
}

// Handle confirmed sell
export async function handleConfirmSell(
  ctx: Context,
  data: string
): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  // Parse: confirm_sell:<positionId>:<amount>
  const [, positionIdStr, amountStr] = data.split(':');
  const positionId = parseInt(positionIdStr, 10);
  const sellAmount = parseFloat(amountStr);

  await ctx.editMessageText(
    '⏳ Processing sell order...',
    { parse_mode: 'Markdown' }
  );

  try {
    // In production, this would:
    // 1. Call the executor to execute the sell
    // 2. Wait for confirmation
    // 3. Update position status

    // For now, just acknowledge
    await ctx.editMessageText(
      `*Sell Order Submitted*\n\n` +
        `Position ID: ${positionId}\n` +
        `Amount: ${sellAmount.toFixed(4)} tokens\n\n` +
        `Your sell order has been submitted. ` +
        `Check /positions for updates.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Sell error:', error);
    await ctx.editMessageText(
      'Failed to execute sell. Please try again.',
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.answerCallbackQuery();
}

// Handle cancel sell
export async function handleCancelSell(ctx: Context): Promise<void> {
  await ctx.editMessageText(
    'Sell order cancelled.',
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCallbackQuery();
}
