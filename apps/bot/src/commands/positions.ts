import type { MyContext } from '../types.js';
import { getActivePositions } from '@raptor/shared';

export async function positionsCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const positions = await getActivePositions(user.id);

    if (positions.length === 0) {
      await ctx.reply(
        '📈 *Active Positions*\n\n' +
          '_No active positions_\n\n' +
          "Funds are waiting for prey.\n" +
          "You'll be notified when we strike.",
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = '📈 *Active Positions*\n\n';

    for (const pos of positions) {
      const pnlEmoji =
        pos.unrealized_pnl_percent >= 20
          ? '🟢'
          : pos.unrealized_pnl_percent >= 0
            ? '🟡'
            : '🔴';
      const pnlSign = pos.unrealized_pnl_percent >= 0 ? '+' : '';
      const chainEmoji = pos.chain === 'bsc' ? '🟡' : '🔵';
      const token = pos.chain === 'bsc' ? 'BNB' : 'ETH';

      const age = getTimeAgo(new Date(pos.created_at));

      message += `${pnlEmoji} *${pos.token_symbol}* ${chainEmoji}\n`;
      message += `   Entry: ${parseFloat(pos.amount_in).toFixed(4)} ${token}\n`;
      message += `   P&L: ${pnlSign}${pos.unrealized_pnl_percent.toFixed(1)}%\n`;
      message += `   TP: ${pos.take_profit_percent}% | SL: ${pos.stop_loss_percent}%\n`;
      message += `   Age: ${age}\n\n`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error fetching positions:', error);
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
