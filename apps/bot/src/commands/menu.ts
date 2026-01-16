/**
 * Menu Command - Main navigation hub for RAPTOR v5.0
 *
 * Shows compact menu with:
 * - SOL balance (live from RPC)
 * - P&L stats (trades, win rate)
 * - Quick navigation buttons
 */

import type { MyContext } from '../types.js';
import { getUserWallets, getUserStats, SOLANA_CONFIG } from '@raptor/shared';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { mainMenuKeyboard } from '../utils/keyboards.js';
import { formatMainMenu } from '../utils/formatters.js';

/**
 * Fetch live SOL balance from RPC for all user wallets
 */
async function fetchLiveSolBalance(userId: number): Promise<number> {
  try {
    const wallets = await getUserWallets(userId);
    if (wallets.length === 0) return 0;

    const connection = new Connection(SOLANA_CONFIG.rpcUrl);
    let totalBalance = 0;

    for (const wallet of wallets) {
      if (wallet.chain === 'sol' && wallet.solana_address) {
        try {
          const balanceLamports = await connection.getBalance(
            new PublicKey(wallet.solana_address),
            'finalized'
          );
          totalBalance += balanceLamports / LAMPORTS_PER_SOL;
        } catch (err) {
          console.error(`[Menu] RPC error for wallet ${wallet.wallet_index}:`, err);
        }
      }
    }

    return totalBalance;
  } catch (error) {
    console.error('[Menu] Error fetching live balance:', error);
    return 0;
  }
}

export async function menuCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Fetch live balance and stats in parallel
    const [solBalance, stats] = await Promise.all([
      fetchLiveSolBalance(user.id),
      getUserStats(user.id),
    ]);

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
    // Fetch live balance and stats in parallel
    const [solBalance, stats] = await Promise.all([
      fetchLiveSolBalance(user.id),
      getUserStats(user.id),
    ]);

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
