/**
 * Menu Command - Main navigation hub for RAPTOR v3.4.2
 *
 * Shows Command Center with:
 * - Bot description and modes
 * - External links
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

    // v3.4.2: Use username for Command Center display
    const message = formatMainMenu(
      user.username,
      totalBalance,
      positions.length,
      todayPnL
    );

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
      link_preview_options: { is_disabled: true },
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

    // v3.4.2: Use username for Command Center display
    const message = formatMainMenu(
      user.username,
      totalBalance,
      positions.length,
      todayPnL
    );

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
      link_preview_options: { is_disabled: true },
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Menu] Error showing menu:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading menu' });
  }
}
