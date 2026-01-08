import type { MyContext } from '../types.js';
import { getUserStats, getUserBalances } from '@raptor/shared';

export async function statusCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const [stats, balances] = await Promise.all([
      getUserStats(user.id),
      getUserBalances(user.id),
    ]);

    const pnlEmoji = stats.totalPnl >= 0 ? '🟢' : '🔴';
    const pnlSign = stats.totalPnl >= 0 ? '+' : '';

    let balanceText = '';
    for (const balance of balances) {
      const token = balance.chain === 'bsc' ? 'BNB' : 'ETH';
      const chainEmoji = balance.chain === 'bsc' ? '🟡' : '🔵';
      balanceText += `${chainEmoji} ${parseFloat(balance.current_value).toFixed(4)} ${token}\n`;
    }

    if (!balanceText) {
      balanceText = '_No deposits yet_\n';
    }

    await ctx.reply(
      `📊 *Your RAPTOR Status*\n\n` +
        `*Balances:*\n${balanceText}\n` +
        `*Total Deposited:* ${stats.deposited.toFixed(4)}\n` +
        `*Current Value:* ${stats.currentValue.toFixed(4)}\n` +
        `${pnlEmoji} *P&L:* ${pnlSign}${stats.totalPnl.toFixed(4)} (${pnlSign}${stats.pnlPercent.toFixed(2)}%)\n\n` +
        `*Hunting Stats:*\n` +
        `Trades: ${stats.totalTrades}\n` +
        `Win Rate: ${stats.winRate.toFixed(1)}%\n\n` +
        `_Use /positions to view active hunts_`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error fetching status:', error);
    await ctx.reply('❌ Error fetching status. Please try again.');
  }
}
