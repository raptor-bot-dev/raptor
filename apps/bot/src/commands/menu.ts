/**
 * Menu Command - Main navigation hub for RAPTOR v5.0
 *
 * Shows compact menu with:
 * - SOL balance
 * - P&L stats (trades, win rate)
 * - Quick navigation buttons
 */

import type { MyContext } from '../types.js';
import { getUserBalances, getUserStats } from '@raptor/shared';
import { mainMenuKeyboard } from '../utils/keyboards.js';
import { formatMainMenu } from '../utils/formatters.js';

export async function menuCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Fetch balance and stats in parallel
    const [balances, stats] = await Promise.all([
      getUserBalances(user.id),
      getUserStats(user.id),
    ]);

    // Calculate SOL balance
    let solBalance = 0;
    for (const bal of balances) {
      if (bal.chain === 'sol') {
        solBalance += parseFloat(bal.current_value) || 0;
      }
    }

    const message = formatMainMenu(solBalance, {
      totalPnl: stats.totalPnl,
      totalTrades: stats.totalTrades,
      winRate: stats.winRate,
    });

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
    const [balances, stats] = await Promise.all([
      getUserBalances(user.id),
      getUserStats(user.id),
    ]);

    let solBalance = 0;
    for (const bal of balances) {
      if (bal.chain === 'sol') {
        solBalance += parseFloat(bal.current_value) || 0;
      }
    }

    const message = formatMainMenu(solBalance, {
      totalPnl: stats.totalPnl,
      totalTrades: stats.totalTrades,
      winRate: stats.winRate,
    });

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
