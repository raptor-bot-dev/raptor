// /sell command - Sell tokens
// v3.2: New flow - prompts for CA, then shows sell panel
// Usage: /sell (prompts for CA) or /sell <contract>

import { CommandContext, Context, InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import {
  getActivePositions,
  getPositionByToken,
  closePosition,
  type Position,
  type Chain,
} from '@raptor/shared';

const CHAIN_SYMBOLS: Record<Chain, string> = {
  sol: 'SOL',
};

// Solana address regex
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function sellCommand(ctx: MyContext): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  const args = ctx.match?.toString().trim().split(/\s+/) || [];

  // If CA provided directly: /sell <contract>
  if (args.length > 0 && args[0] !== '') {
    const tokenAddress = args[0];
    
    // Validate - only Solana for now
    if (SOLANA_ADDRESS_REGEX.test(tokenAddress)) {
      // Show sell panel directly
      await showSellPanelForMint(ctx, tgId, tokenAddress);
      return;
    }

    await ctx.reply(
      '❌ Invalid token address.\n\nPlease enter a valid Solana contract address.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // No arguments - prompt for CA
  ctx.session.step = 'awaiting_sell_ca';
  
  await ctx.reply(
    `💰 *SELL TOKEN*\n\n` +
    `Paste the contract address (CA) of the token you want to sell:`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('❌ Cancel', 'back_to_menu'),
    }
  );
}

/**
 * Show sell panel for a specific mint
 */
async function showSellPanelForMint(
  ctx: MyContext,
  userId: number,
  mint: string
): Promise<void> {
  try {
    const { openSellPanelNew } = await import('../services/tradeMonitor.js');
    const { solanaExecutor } = await import('@raptor/executor/solana');
    
    await openSellPanelNew(
      ctx.api,
      userId,
      ctx.chat!.id,
      mint,
      solanaExecutor
    );
  } catch (error) {
    console.error('[Sell] Error showing sell panel:', error);
    await ctx.reply('❌ Failed to load sell panel. Please try again.');
  }
}

/**
 * Handle CA input for /sell flow
 * Called from messages.ts when step === 'awaiting_sell_ca'
 */
export async function handleSellCaInput(
  ctx: MyContext,
  text: string
): Promise<boolean> {
  const tgId = ctx.from?.id;
  if (!tgId) return false;

  // Validate Solana address
  if (!SOLANA_ADDRESS_REGEX.test(text)) {
    await ctx.reply(
      '❌ Invalid Solana address.\n\nPlease enter a valid contract address (CA):',
      {
        reply_markup: new InlineKeyboard().text('❌ Cancel', 'back_to_menu'),
      }
    );
    return true; // Handled, but stay in awaiting state
  }

  // Clear step
  ctx.session.step = null;

  // Show sell panel
  await showSellPanelForMint(ctx, tgId, text);
  return true;
}

// Handle sell callback buttons (legacy - kept for backwards compatibility)
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
