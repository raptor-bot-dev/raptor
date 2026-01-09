/**
 * Menu Command - Main navigation hub for RAPTOR v2.2
 *
 * Shows dashboard with:
 * - Total balance across all chains
 * - Active position count
 * - Today's P&L
 * - Quick navigation buttons
 */

import type { MyContext } from '../types.js';
import { getUserBalances, getActivePositions } from '@raptor/shared';
import { mainMenuKeyboard } from '../utils/keyboards.js';
import { formatMainMenu } from '../utils/formatters.js';

export async function menuCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Fetch user data in parallel
    const [balances, positions] = await Promise.all([
      getUserBalances(user.id),
      getActivePositions(user.id),
    ]);

    // Calculate total balance (simplified - would need price feeds for accurate USD)
    let totalBalance = 0;
    for (const bal of balances) {
      const current = parseFloat(bal.current_value) || 0;
      // Rough USD conversion (would use real prices in production)
      const usdMultiplier =
        bal.chain === 'sol' ? 150 : // SOL ~$150
        bal.chain === 'bsc' ? 300 : // BNB ~$300
        3000; // ETH ~$3000
      totalBalance += current * usdMultiplier;
    }

    // Calculate today's P&L (simplified)
    let todayPnL = 0;
    for (const pos of positions) {
      todayPnL += pos.unrealized_pnl_percent || 0;
    }
    if (positions.length > 0) {
      todayPnL = todayPnL / positions.length; // Average P&L
    }

    const message = formatMainMenu(
      user.first_name || 'Trader',
      totalBalance,
      positions.length,
      todayPnL
    );

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  } catch (error) {
    console.error('[Menu] Error:', error);
    await ctx.reply(
      '❌ Error loading menu. Please try again.',
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

/**
 * Show menu via callback (for back navigation)
 */
export async function showMenu(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const [balances, positions] = await Promise.all([
      getUserBalances(user.id),
      getActivePositions(user.id),
    ]);

    let totalBalance = 0;
    for (const bal of balances) {
      const current = parseFloat(bal.current_value) || 0;
      const usdMultiplier =
        bal.chain === 'sol' ? 150 :
        bal.chain === 'bsc' ? 300 :
        3000;
      totalBalance += current * usdMultiplier;
    }

    let todayPnL = 0;
    for (const pos of positions) {
      todayPnL += pos.unrealized_pnl_percent || 0;
    }
    if (positions.length > 0) {
      todayPnL = todayPnL / positions.length;
    }

    const message = formatMainMenu(
      user.first_name || 'Trader',
      totalBalance,
      positions.length,
      todayPnL
    );

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Menu] Error showing menu:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading menu' });
  }
}
