/**
 * Deposit Command - DISABLED in v3
 *
 * This feature has been removed in favor of direct wallet transfers.
 * Users should send SOL directly to their wallet address shown on the Home panel.
 */

import type { MyContext } from '../types.js';

export async function depositCommand(ctx: MyContext) {
  await ctx.reply(
    '⚠️ <b>Deposit Command Removed</b>\n\n' +
      'The /deposit command has been removed.\n\n' +
      'To add funds, send SOL directly to your wallet address.\n' +
      'Use /start to see your wallet address.',
    { parse_mode: 'HTML' }
  );
}

// Legacy handlers - return disabled message
export async function handleModeSelection(ctx: MyContext, _mode: string) {
  await ctx.answerCallbackQuery('This feature has been removed');
}

export async function handleChainSelection(ctx: MyContext, _chain: string, _mode: string) {
  await ctx.answerCallbackQuery('This feature has been removed');
}
