/**
 * History Command - Trade history for RAPTOR v2.2
 *
 * Shows past trades with:
 * - Buy/sell type
 * - Token and chain
 * - P&L for sells
 * - Timestamps
 * - Pagination for large histories
 */

import type { MyContext } from '../types.js';
import type { Chain, Trade } from '@raptor/shared';
import { getTradesPaginated } from '@raptor/shared';
import { backKeyboard, paginationKeyboard, CHAIN_EMOJI } from '../utils/keyboards.js';
import { formatTradeHistory, formatTime, formatPnL } from '../utils/formatters.js';

// Page size for trade history
const PAGE_SIZE = 10;

/**
 * Main history command
 */
export async function historyCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const { trades } = await getTradesPaginated(user.id, PAGE_SIZE, 0);

    if (trades.length === 0) {
      await ctx.reply(
        '📜 *Trade History*\n\n' +
        'No trades yet.\n\n' +
        'Your trading history will appear here once you start trading.',
        {
          parse_mode: 'Markdown',
          reply_markup: backKeyboard('menu'),
        }
      );
      return;
    }

    const message = formatTradeHistory(trades);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: backKeyboard('menu'),
    });
  } catch (error) {
    console.error('[History] Error:', error);
    await ctx.reply('❌ Error loading history. Please try again.');
  }
}

/**
 * Show history via callback with pagination
 */
export async function showHistory(ctx: MyContext, page: number = 1) {
  const user = ctx.from;
  if (!user) return;

  try {
    const offset = (page - 1) * PAGE_SIZE;
    const { trades, total } = await getTradesPaginated(user.id, PAGE_SIZE, offset);

    if (trades.length === 0 && page === 1) {
      await ctx.editMessageText(
        '📜 *Trade History*\n\n' +
        'No trades yet.\n\n' +
        'Your trading history will appear here once you start trading.',
        {
          parse_mode: 'Markdown',
          reply_markup: backKeyboard('wallet'),
        }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    let message = `📜 *Trade History* (Page ${page})\n\n`;

    for (const trade of trades) {
      const chain = trade.chain as Chain;
      const emoji = CHAIN_EMOJI[chain];
      const typeEmoji = trade.type === 'BUY' ? '🟢' : '🔴';
      const pnl = trade.pnl_percent;
      const pnlStr = pnl ? ` ${formatPnL(pnl)}` : '';

      message += `${typeEmoji} ${emoji} *${trade.token_symbol}*${pnlStr}\n`;
      message += `   ${formatTime(trade.created_at)}\n`;
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const keyboard = paginationKeyboard(page, totalPages, 'history_page')
      .row()
      .text('← Back', 'back_to_wallet');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[History] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading history' });
  }
}

/**
 * Format a single trade for detailed view
 */
export function formatTradeDetail(trade: Trade): string {
  const chain = trade.chain as Chain;
  const emoji = CHAIN_EMOJI[chain];
  const typeEmoji = trade.type === 'BUY' ? '🟢 BUY' : '🔴 SELL';
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  let message = `${emoji} *${trade.token_symbol}* ${typeEmoji}\n\n`;

  message += `*Amount In:* ${parseFloat(trade.amount_in).toFixed(6)} ${symbol}\n`;
  message += `*Amount Out:* ${parseFloat(trade.amount_out).toFixed(6)} tokens\n`;
  message += `*Price:* ${parseFloat(trade.price).toFixed(8)}\n`;

  if (trade.pnl && trade.pnl_percent) {
    message += `\n*P&L:* ${formatPnL(trade.pnl_percent)}\n`;
    message += `*Profit:* ${parseFloat(trade.pnl).toFixed(6)} ${symbol}\n`;
  }

  message += `\n*Fee:* ${parseFloat(trade.fee_amount).toFixed(6)} ${symbol}\n`;
  message += `*Time:* ${formatTime(trade.created_at)}\n`;
  message += `\n🔗 \`${trade.tx_hash.slice(0, 16)}...\``;

  return message;
}
