/**
 * Positions Handler - Routes positions:* and position:* callbacks
 * Reference: MUST_READ/PROMPT.md
 */

import type { MyContext } from '../types.js';
import { CB, extractPositionId } from '../ui/callbackIds.js';
import {
  renderPositionsList,
  renderNoPositions,
  type PositionListItem,
} from '../ui/panels/positions.js';
import {
  renderPositionDetail,
  renderPositionNotFound,
  type PositionDetailData,
} from '../ui/panels/positionDetail.js';
import {
  renderEmergencySellConfirm,
  renderEmergencySellSubmitted,
  renderEmergencySellInProgress,
  renderEmergencySellError,
  type EmergencySellData,
} from '../ui/panels/emergencySell.js';
import {
  getUserOpenPositions,
  getPositionByUuid,
  getOrCreateAutoStrategy,
  getSolPrice,
  getMarketDataBatch,
  getMarketData,
  computeQuotePnl,
} from '@raptor/shared';
import { GrammyError } from 'grammy';
import { executeEmergencySell as executeEmergencySellService } from '../services/emergencySellService.js';
import { showHome } from './home.js';

// Pump.fun tokens have fixed 1 billion total supply
const PUMP_FUN_TOTAL_SUPPLY = 1_000_000_000;

/**
 * Handle positions:* and position:* callbacks
 */
export async function handlePositionCallbacks(ctx: MyContext, data: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Handle positions list callbacks
  if (data === CB.POSITIONS.OPEN || data === CB.POSITIONS.REFRESH) {
    await showPositionsList(ctx);
    return;
  }

  // Handle single position callbacks
  const positionId = extractPositionId(data);
  if (!positionId) {
    await ctx.answerCallbackQuery('Invalid position');
    return;
  }

  // Determine action from callback pattern
  if (data.startsWith('position:details:')) {
    await showPositionDetails(ctx, positionId);
  } else if (data.startsWith('position:emergency_sell:')) {
    await showEmergencySellConfirm(ctx, positionId);
  } else if (data.startsWith('position:ces:')) {
    await executeEmergencySell(ctx, positionId);
  } else if (data.startsWith('position:xes:')) {
    await showPositionDetails(ctx, positionId);
  } else if (data.startsWith('position:back:')) {
    await showPositionsList(ctx);
  } else {
    console.warn(`Unknown position callback: ${data}`);
    await ctx.answerCallbackQuery('Unknown action');
  }
}

/**
 * Show positions list panel
 */
export async function showPositionsList(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const positions = await getUserOpenPositions(userId);
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    if (positions.length === 0) {
      const panel = renderNoPositions();
      if (ctx.callbackQuery) {
        await ctx.editMessageText(panel.text, panel.opts);
        await ctx.answerCallbackQuery();
      } else {
        await ctx.reply(panel.text, panel.opts);
      }
      return;
    }

    // Fetch SOL price once for the batch
    const solPriceUsd = await getSolPrice();

    // Fetch market data for all position tokens (current MC, price, etc.)
    const mints = positions.map((p) => p.token_mint);
    const marketDataMap = await getMarketDataBatch(mints, solPriceUsd ?? undefined);

    // Map positions to list items with quote-based PnL calculation
    const listItems: PositionListItem[] = await Promise.all(
      positions.map(async (pos) => {
        const marketData = marketDataMap[pos.token_mint];
        const adjustedTokens = normalizeTokenAmount(
          pos.size_tokens,
          pos.token_decimals,
          marketData?.decimals
        );
        let pnlPercent: number | undefined;
        let pnlSol: number | undefined;
        let currentMcUsd: number | undefined;

        // Get current MC from market data
        if (marketData?.marketCapUsd && marketData.marketCapUsd > 0) {
          currentMcUsd = marketData.marketCapUsd;
        }

        // Calculate quote-based PnL if we have entry data
        if (pos.entry_cost_sol > 0 && adjustedTokens > 0) {
          const pnlResult = await computeQuotePnl(
            pos.token_mint,
            adjustedTokens,
            pos.entry_cost_sol,
            { marketData, solPriceUsd: solPriceUsd ?? undefined }
          );
          if (pnlResult.currentValueSol > 0) {
            pnlPercent = pnlResult.pnlPercent;
            pnlSol = pnlResult.pnlSol;
          }
        }

        return {
          id: pos.uuid_id,
          symbol: pos.token_symbol || 'Unknown',
          mint: pos.token_mint,
      entrySol: pos.entry_cost_sol,
      currentMcUsd, // AUDIT FIX: Show CURRENT MC, not entry MC
      pnlPercent,
      pnlSol,
        };
      })
    );

    const maxPositions = strategy.max_positions ?? 2;
    const panel = renderPositionsList(listItems, maxPositions);

    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(panel.text, panel.opts);
        await ctx.answerCallbackQuery();
      } catch (error) {
        // FIX: Ignore "message is not modified" error - happens when refresh doesn't change anything
        if (error instanceof GrammyError && error.description?.includes('message is not modified')) {
          await ctx.answerCallbackQuery();
        } else {
          throw error;
        }
      }
    } else {
      await ctx.reply(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error showing positions list:', error);
    await ctx.answerCallbackQuery('Error loading positions');
  }
}

/**
 * Show single position details
 */
async function showPositionDetails(ctx: MyContext, positionId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const position = await getPositionByUuid(positionId);

    // New schema uses user_id UUID, skip ownership check for now
    // FIXME: Implement proper tg_id -> user_id lookup
    if (!position) {
      const panel = renderPositionNotFound();
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery('Position not found');
      return;
    }

    // Fetch strategy and SOL price in parallel, then fetch market data with SOL price
    const [strategy, solPriceUsd] = await Promise.all([
      getOrCreateAutoStrategy(userId, 'sol'),
      getSolPrice(),
    ]);
    const marketData = await getMarketData(position.token_mint, {
      solPriceUsd: solPriceUsd ?? undefined,
    });

    // Calculate entry MC from stored value or entry price × total supply
    const supply = marketData?.supply ?? PUMP_FUN_TOTAL_SUPPLY;
    const entryMcSol = position.entry_mc_sol
      ?? (position.entry_price > 0 ? position.entry_price * supply : 0);
    const entryMcUsd = position.entry_mc_usd
      ?? (solPriceUsd && entryMcSol > 0 ? entryMcSol * solPriceUsd : undefined);

    // Get current market data
    const currentMcUsd = marketData?.marketCapUsd ?? undefined;

    // Calculate quote-based PnL
    let pnlPercent: number | undefined;
    let pnlSol: number | undefined;
    const adjustedTokens = normalizeTokenAmount(
      position.size_tokens,
      position.token_decimals,
      marketData?.decimals
    );
    if (position.entry_cost_sol > 0 && adjustedTokens > 0) {
      const pnlResult = await computeQuotePnl(
        position.token_mint,
        adjustedTokens,
        position.entry_cost_sol,
        { marketData, solPriceUsd: solPriceUsd ?? undefined }
      );
      if (pnlResult.currentValueSol > 0) {
        pnlPercent = pnlResult.pnlPercent;
        pnlSol = pnlResult.pnlSol;
      }
    }

    const detailData: PositionDetailData = {
      id: position.uuid_id,
      tokenName: position.token_name || position.token_symbol || 'Unknown',
      symbol: position.token_symbol || 'Unknown',
      mint: position.token_mint,
      entryPrice: position.entry_price,
      entryMcSol,
      takeProfitPercent: strategy.take_profit_percent ?? 50,
      stopLossPercent: strategy.stop_loss_percent ?? 20,
      entrySol: position.entry_cost_sol,
      tokenAmount: adjustedTokens ?? 0,
      status: (position.lifecycle_state === 'CLOSED' ? 'CLOSED' : 'ACTIVE') as 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED',
      entryTxSig: position.entry_tx_sig ?? undefined,
      solPriceUsd: solPriceUsd || undefined,
      // AUDIT FIX: Add current MC, entry MC in USD, and PnL
      entryMcUsd,
      currentMcUsd,
      pnlPercent,
      pnlSol,
    };

    const panel = renderPositionDetail(detailData);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error showing position details:', error);
    await ctx.answerCallbackQuery('Error loading position');
  }
}

/**
 * Show emergency sell confirmation
 */
async function showEmergencySellConfirm(ctx: MyContext, positionId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const position = await getPositionByUuid(positionId);

    // New schema uses user_id UUID, skip ownership check for now
    // FIXME: Implement proper tg_id -> user_id lookup
    if (!position) {
      await ctx.answerCallbackQuery('Position not found');
      return;
    }

    // New schema uses lifecycle_state instead of status
    if (position.lifecycle_state === 'CLOSED') {
      const panel = renderEmergencySellInProgress(position.token_symbol || 'Unknown');
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery('Position not available');
      return;
    }

    const sellData: EmergencySellData = {
      positionId: position.uuid_id,
      symbol: position.token_symbol || 'Unknown',
      mint: position.token_mint,
      tokenBalance: position.size_tokens ?? 0,
    };

    const panel = renderEmergencySellConfirm(sellData);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error showing emergency sell confirm:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Execute emergency sell
 * This executes an immediate sell with high slippage for fast exit
 */
async function executeEmergencySell(ctx: MyContext, positionId: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const position = await getPositionByUuid(positionId);

    // New schema uses user_id UUID, skip ownership check for now
    // FIXME: Implement proper tg_id -> user_id lookup
    if (!position) {
      await ctx.answerCallbackQuery('Position not found');
      return;
    }

    // New schema uses lifecycle_state instead of status
    if (position.lifecycle_state === 'CLOSED') {
      const panel = renderEmergencySellInProgress(position.token_symbol || 'Unknown');
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery('Already processing');
      return;
    }

    // Show processing state immediately
    await ctx.answerCallbackQuery('Processing emergency sell...');

    // Execute the emergency sell via service
    const result = await executeEmergencySellService({
      userId,
      position,
    });

    if (result.success && result.txHash) {
      // Show success panel
      const panel = renderEmergencySellSubmitted(
        position.token_symbol || 'Unknown',
        position.token_mint,
        result.txHash
      );
      await ctx.editMessageText(panel.text, panel.opts);
    } else if (result.alreadyExecuted) {
      // Already executed - show in-progress panel
      const panel = renderEmergencySellInProgress(position.token_symbol || 'Unknown');
      await ctx.editMessageText(panel.text, panel.opts);
    } else {
      // Show error panel
      const panel = renderEmergencySellError(result.error || 'Failed to execute emergency sell');
      await ctx.editMessageText(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error executing emergency sell:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to submit sell order';
    const panel = renderEmergencySellError(errorMsg);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery('Error');
  }
}

function normalizeTokenAmount(
  amount: number,
  storedDecimals?: number | null,
  actualDecimals?: number | null
): number {
  if (!amount || storedDecimals == null || actualDecimals == null) {
    return amount;
  }
  if (storedDecimals === actualDecimals) {
    return amount;
  }
  const diff = storedDecimals - actualDecimals;
  if (diff > 0) {
    return amount / Math.pow(10, diff);
  }
  return amount * Math.pow(10, -diff);
}
