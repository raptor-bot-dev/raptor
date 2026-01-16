/**
 * Home Handler - Routes home:* callbacks
 * Reference: MUST_READ/PROMPT.md
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { MyContext } from '../types.js';
import { CB } from '../ui/callbackIds.js';
import { renderHome, renderHomeError, type HomeData } from '../ui/panels/home.js';
import {
  getUserWallets,
  getOrCreateAutoStrategy,
  getUserOpenPositions,
} from '@raptor/shared';
import { computeRealizedPnL, computeTradeStats } from '../services/pnlService.js';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Get Solana balance for an address
 */
async function getSolanaBalance(address: string): Promise<number> {
  if (!address) return 0;
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const balance = await connection.getBalance(new PublicKey(address), 'finalized');
    return balance;
  } catch {
    return 0;
  }
}

/**
 * Handle home:* callbacks
 */
export async function handleHomeCallbacks(ctx: MyContext, data: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  switch (data) {
    case CB.HOME.OPEN:
    case CB.HOME.REFRESH:
      await showHome(ctx);
      break;

    default:
      console.warn(`Unknown home callback: ${data}`);
      await ctx.answerCallbackQuery('Unknown action');
  }
}

/**
 * Render and display the home panel
 */
export async function showHome(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // Fetch data in parallel
    const [wallets, strategy, positions, pnl, stats] = await Promise.all([
      getUserWallets(userId),
      getOrCreateAutoStrategy(userId, 'sol'),
      getUserOpenPositions(userId),
      computeRealizedPnL(userId),
      computeTradeStats(userId),
    ]);

    // Get balances for each wallet
    const walletsWithBalances = await Promise.all(
      wallets.map(async (w) => {
        const balanceLamports = await getSolanaBalance(w.solana_address || '');
        return {
          address: w.solana_address || '',
          balanceSol: balanceLamports / 1e9,
        };
      })
    );

    // Check if autohunt is armed (strategy is enabled)
    const isArmed = strategy.enabled;

    // Get max positions from strategy or default to 2
    const maxPositions = strategy.max_positions ?? 2;

    const homeData: HomeData = {
      wallets: walletsWithBalances,
      armed: isArmed,
      openPositions: positions.length,
      maxPositions,
      trades: stats,
      pnl,
    };

    const panel = renderHome(homeData);

    // Edit or reply based on context
    if (ctx.callbackQuery) {
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error showing home:', error);
    const errorPanel = renderHomeError('Failed to load data');
    if (ctx.callbackQuery) {
      await ctx.editMessageText(errorPanel.text, errorPanel.opts);
      await ctx.answerCallbackQuery('Error loading home');
    } else {
      await ctx.reply(errorPanel.text, errorPanel.opts);
    }
  }
}
