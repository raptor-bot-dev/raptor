/**
 * Balance Command - Quick balance check for RAPTOR v2.2
 *
 * Shows a quick overview of all balances without the full wallet UI.
 * Perfect for a fast check on the go.
 */

import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getUserBalances } from '@raptor/shared';
import { backKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';
import { formatCrypto, formatPnL } from '../utils/formatters.js';

export async function balanceCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const balances = await getUserBalances(user.id);

    if (balances.length === 0) {
      await ctx.reply(
        '💰 *Balance*\n\nNo balances yet.\n\nUse /deposit to add funds.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = '💰 *Quick Balance*\n\n';
    let totalDeposited = 0;
    let totalCurrent = 0;

    // Group balances by chain
    const byChain = new Map<Chain, { deposited: number; current: number; symbol: string }>();

    for (const bal of balances) {
      const chain = bal.chain as Chain;
      const deposited = parseFloat(bal.deposited) || 0;
      const current = parseFloat(bal.current_value) || 0;
      const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

      // Rough USD conversion for totals
      const usdMultiplier =
        chain === 'sol' ? 150 :
        chain === 'bsc' ? 300 :
        3000;

      totalDeposited += deposited * usdMultiplier;
      totalCurrent += current * usdMultiplier;

      if (!byChain.has(chain)) {
        byChain.set(chain, { deposited: 0, current: 0, symbol });
      }
      const existing = byChain.get(chain)!;
      existing.deposited += deposited;
      existing.current += current;
    }

    // Format per-chain balances
    for (const [chain, data] of byChain) {
      const pnl = data.deposited > 0
        ? ((data.current - data.deposited) / data.deposited) * 100
        : 0;

      message += `${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}*\n`;
      message += `   ${formatCrypto(data.current, data.symbol)} ${formatPnL(pnl)}\n`;
    }

    // Total P&L
    const totalPnlPercent = totalDeposited > 0
      ? ((totalCurrent - totalDeposited) / totalDeposited) * 100
      : 0;

    message += `\n📊 *Total P&L:* ${formatPnL(totalPnlPercent)}`;
    message += `\n💵 *Est. Value:* ~$${totalCurrent.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('[Balance] Error:', error);
    await ctx.reply('❌ Error fetching balance. Please try again.');
  }
}
