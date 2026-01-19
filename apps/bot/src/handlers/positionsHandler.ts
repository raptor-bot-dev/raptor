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
  getTokenPrices,
} from '@raptor/shared';
import { executeEmergencySell as executeEmergencySellService } from '../services/emergencySellService.js';
import { showHome } from './home.js';

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
  } else if (data.startsWith('position:confirm_emergency_sell:')) {
    await executeEmergencySell(ctx, positionId);
  } else if (data.startsWith('position:cancel_emergency_sell:')) {
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

    // Fetch current prices for all position tokens (Jupiter + pump.fun fallback)
    const mints = positions.map((p) => p.token_mint);
    const prices = await getTokenPrices(mints);

    // Map positions to list items with real-time PnL calculation
    const listItems: PositionListItem[] = positions.map((pos) => {
      const priceResult = prices[pos.token_mint];
      let pnlPercent: number | undefined;

      // Calculate PnL if we have a valid price and entry data
      if (priceResult?.price && priceResult.price > 0 && pos.entry_cost_sol > 0 && pos.size_tokens > 0) {
        const currentValue = priceResult.price * pos.size_tokens;
        pnlPercent = ((currentValue - pos.entry_cost_sol) / pos.entry_cost_sol) * 100;
      }

      return {
        id: pos.uuid_id,
        symbol: pos.token_symbol || 'Unknown',
        mint: pos.token_mint,
        entrySol: pos.entry_cost_sol,
        entryMcSol: (pos as any).entry_mc_sol ?? undefined,
        pnlPercent,
      };
    });

    const maxPositions = strategy.max_positions ?? 2;
    const panel = renderPositionsList(listItems, maxPositions);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery();
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

    if (!position || position.tg_id !== userId) {
      const panel = renderPositionNotFound();
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery('Position not found');
      return;
    }

    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    const detailData: PositionDetailData = {
      id: position.uuid_id,
      tokenName: position.token_name || position.token_symbol || 'Unknown',
      symbol: position.token_symbol || 'Unknown',
      mint: position.token_mint,
      entryPrice: position.entry_price,
      entryMcSol: (position as any).entry_mc_sol ?? 0,
      takeProfitPercent: strategy.take_profit_percent ?? 50,
      stopLossPercent: strategy.stop_loss_percent ?? 20,
      entrySol: position.entry_cost_sol,
      tokenAmount: position.size_tokens ?? 0,
      status: position.status as 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED',
      entryTxSig: position.entry_tx_sig ?? undefined,
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

    if (!position || position.tg_id !== userId) {
      await ctx.answerCallbackQuery('Position not found');
      return;
    }

    if (position.status !== 'ACTIVE') {
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

    if (!position || position.tg_id !== userId) {
      await ctx.answerCallbackQuery('Position not found');
      return;
    }

    if (position.status !== 'ACTIVE') {
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
