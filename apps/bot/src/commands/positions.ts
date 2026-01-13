import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import { getRecentPositions, type RecentPosition } from '@raptor/shared';

export async function positionsCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Fetch positions from last 24 hours, limit 15
    const positions = await getRecentPositions(user.id, 24, 15, 0);

    if (positions.length === 0) {
      await ctx.reply(
        '📈 *Recent Positions (24h)*\n\n' +
          '_No positions in the last 24 hours_\n\n' +
          "Funds are waiting for prey.\n" +
          "You'll be notified when we strike.",
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = '📈 *Recent Positions (24h)*\n\n';

    // Build keyboard with View buttons for positions with monitors
    const keyboard = new InlineKeyboard();

    for (const pos of positions) {
      const pnlEmoji =
        pos.unrealized_pnl_percent >= 20
          ? '🟢'
          : pos.unrealized_pnl_percent >= 0
            ? '🟡'
            : '🔴';
      const pnlSign = pos.unrealized_pnl_percent >= 0 ? '+' : '';
      const chainEmoji = pos.chain === 'sol' ? '🟣' : pos.chain === 'bsc' ? '🟡' : '🔵';
      const statusIcon = pos.status === 'OPEN' ? '🟢' : pos.status === 'CLOSING' ? '🟠' : '⚪';

      const age = getTimeAgo(new Date(pos.created_at));

      message += `${statusIcon} *${pos.token_symbol || 'UNKNOWN'}* ${chainEmoji}\n`;
      message += `   Entry: ${pos.amount_in.toFixed(4)} SOL\n`;
      message += `   P&L: ${pnlSign}${pos.unrealized_pnl_percent?.toFixed(1) || '0.0'}%\n`;
      message += `   Status: ${pos.status} | Age: ${age}\n`;

      if (pos.has_monitor) {
        message += `   📊 _Monitor active_\n`;
      }
      message += '\n';

      // Add View button if position has an active monitor
      if (pos.has_monitor && pos.token_address) {
        keyboard.text(`📊 ${pos.token_symbol || 'View'}`, `view_monitor:${pos.token_address}`).row();
      }
    }

    // Add refresh button
    keyboard.text('🔄 Refresh', 'refresh_positions');

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('[Positions] Error fetching positions:', error);
    await ctx.reply('❌ Error fetching positions. Please try again.');
  }
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
