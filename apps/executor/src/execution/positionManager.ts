/**
 * Position Manager for RAPTOR v2.2
 *
 * Manages active positions with support for:
 * - Real-time price feeds
 * - Trailing stops (TRAILING strategy)
 * - Partial exits (MOON_BAG, DCA_EXIT strategies)
 * - Peak price tracking
 * - Strategy-specific exit logic
 */

import type { Position, TradingStrategy } from '@raptor/shared';
import {
  getAllActivePositions,
  updatePosition,
  MAX_HOLD_TIME,
} from '@raptor/shared';
import {
  STRATEGY_CONFIGS,
  calculateTrailingStop,
  shouldActivateTrailingStop,
  getNextDCAExitLevel,
  calculateMoonBagAmount,
} from '@raptor/shared';
import { ChainExecutor } from '../chains/chainExecutor.js';
import { PriceFeed, createPriceFeed, PriceUpdate } from '../feeds/priceFeed.js';

// Faster intervals with real-time price feeds
const POSITION_CHECK_INTERVAL = 3000; // 3 seconds
const PRICE_POLL_INTERVAL = 5000; // 5 seconds fallback

// Extended position with strategy fields
interface PositionWithStrategy extends Position {
  strategy?: TradingStrategy;
  peak_price?: string;
  trailing_stop_price?: string;
  partial_exit_taken?: boolean;
  exit_levels_hit?: number;
  moon_bag_amount?: string;
}

export class PositionManager {
  private executors: Map<string, ChainExecutor> = new Map();
  private priceFeeds: Map<string, PriceFeed> = new Map();
  private latestPrices: Map<string, bigint> = new Map();
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private subscribedPositions: Set<string> = new Set();

  constructor(executors: ChainExecutor[]) {
    for (const executor of executors) {
      const config = executor.getConfig();
      const chainKey = config.name.toLowerCase();
      this.executors.set(chainKey, executor);

      const priceFeed = createPriceFeed(config, executor.getProvider());
      this.priceFeeds.set(chainKey, priceFeed);
    }
  }

  async start(): Promise<void> {
    this.running = true;

    for (const [chain, priceFeed] of this.priceFeeds) {
      await priceFeed.start();
      console.log(`[PositionManager] Price feed started for ${chain}`);
    }

    await this.syncPositionSubscriptions();

    this.checkInterval = setInterval(
      () => this.checkPositions(),
      POSITION_CHECK_INTERVAL
    );

    console.log('[PositionManager] Started with real-time price feeds');
  }

  async stop(): Promise<void> {
    this.running = false;

    for (const priceFeed of this.priceFeeds.values()) {
      await priceFeed.stop();
    }

    if (this.checkInterval) clearInterval(this.checkInterval);
    console.log('[PositionManager] Stopped');
  }

  private async syncPositionSubscriptions(): Promise<void> {
    try {
      const positions = await getAllActivePositions();
      const activeKeys = new Set<string>();

      for (const position of positions) {
        const key = `${position.chain}:${position.token_address}`;
        activeKeys.add(key);

        if (!this.subscribedPositions.has(key)) {
          await this.subscribeToPosition(position);
        }
      }

      for (const key of this.subscribedPositions) {
        if (!activeKeys.has(key)) {
          const [chain, token] = key.split(':');
          const priceFeed = this.priceFeeds.get(chain);
          if (priceFeed) {
            priceFeed.unsubscribe(token);
          }
          this.subscribedPositions.delete(key);
        }
      }
    } catch (error) {
      console.error('[PositionManager] Sync subscriptions failed:', error);
    }
  }

  private async subscribeToPosition(position: Position): Promise<void> {
    const priceFeed = this.priceFeeds.get(position.chain);
    if (!priceFeed) return;

    const key = `${position.chain}:${position.token_address}`;

    const handler = async (update: PriceUpdate) => {
      this.latestPrices.set(update.token, update.price);

      try {
        const entryPrice = parseFloat(position.entry_price);
        const currentPriceNum =
          Number(update.price) / Number(BigInt(position.tokens_held));
        const pnlPercent =
          ((currentPriceNum - entryPrice) / entryPrice) * 100;

        // Update peak price if current is higher
        const posWithStrategy = position as PositionWithStrategy;
        const peakPrice = posWithStrategy.peak_price
          ? parseFloat(posWithStrategy.peak_price)
          : entryPrice;
        const newPeakPrice = Math.max(peakPrice, currentPriceNum);

        // Calculate trailing stop if applicable
        let trailingStopPrice: number | undefined;
        const strategy = posWithStrategy.strategy || 'STANDARD';

        if (strategy === 'TRAILING' && pnlPercent >= 30) {
          trailingStopPrice = calculateTrailingStop(newPeakPrice, strategy) || undefined;
        }

        await updatePosition(position.id, {
          current_price: currentPriceNum.toString(),
          unrealized_pnl_percent: pnlPercent,
          peak_price: newPeakPrice.toString(),
          ...(trailingStopPrice && { trailing_stop_price: trailingStopPrice.toString() }),
        });
      } catch (error) {
        // Silent fail for price updates
      }
    };

    await priceFeed.subscribe(position.token_address, handler);
    this.subscribedPositions.add(key);
  }

  private async checkPositions(): Promise<void> {
    if (!this.running) return;

    try {
      await this.syncPositionSubscriptions();

      const positions = await getAllActivePositions();

      for (const position of positions) {
        await this.checkPosition(position as PositionWithStrategy);
      }
    } catch (error) {
      console.error('[PositionManager] Position check failed:', error);
    }
  }

  private async checkPosition(position: PositionWithStrategy): Promise<void> {
    const executor = this.executors.get(position.chain);
    if (!executor) return;

    const strategy = position.strategy || 'STANDARD';
    const config = STRATEGY_CONFIGS[strategy];
    const pnlPercent = position.unrealized_pnl_percent;

    // === TRAILING STOP CHECK ===
    if (strategy === 'TRAILING') {
      const trailingResult = await this.checkTrailingStop(position, executor);
      if (trailingResult) return;
    }

    // === DCA EXIT CHECK ===
    if (strategy === 'DCA_EXIT') {
      const dcaResult = await this.checkDCAExit(position, executor);
      if (dcaResult) return; // Position closed or partial exit executed
    }

    // === MOON BAG CHECK ===
    if (strategy === 'MOON_BAG' && !position.partial_exit_taken) {
      const moonBagResult = await this.checkMoonBagExit(position, executor);
      if (moonBagResult) return;
    }

    // === STANDARD TAKE PROFIT ===
    if (pnlPercent >= config.takeProfitPercent) {
      console.log(
        `[${position.chain}] Take profit triggered for ${position.token_symbol} (${strategy})`
      );
      await this.closePosition(position, executor, 'TAKE_PROFIT');
      return;
    }

    // === STOP LOSS ===
    if (pnlPercent <= -config.stopLossPercent) {
      console.log(
        `[${position.chain}] Stop loss triggered for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'STOP_LOSS');
      return;
    }

    // === MAX HOLD TIME ===
    const holdTime = Date.now() - new Date(position.created_at).getTime();
    if (holdTime > config.maxHoldMs) {
      console.log(
        `[${position.chain}] Max hold time reached for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'MAX_HOLD_TIME');
      return;
    }
  }

  /**
   * Check and execute trailing stop
   */
  private async checkTrailingStop(
    position: PositionWithStrategy,
    executor: ChainExecutor
  ): Promise<boolean> {
    const pnlPercent = position.unrealized_pnl_percent;

    // Only check if trailing has been activated
    if (!shouldActivateTrailingStop(pnlPercent, 'TRAILING')) {
      return false;
    }

    const currentPrice = parseFloat(position.current_price);
    const trailingStopPrice = position.trailing_stop_price
      ? parseFloat(position.trailing_stop_price)
      : null;

    // If no trailing stop price set yet, don't trigger
    if (!trailingStopPrice) return false;

    // Check if price dropped below trailing stop
    if (currentPrice <= trailingStopPrice) {
      console.log(
        `[${position.chain}] Trailing stop triggered for ${position.token_symbol} ` +
        `(price ${currentPrice.toFixed(8)} <= trailing stop ${trailingStopPrice.toFixed(8)})`
      );
      await this.closePosition(position, executor, 'TRAILING_STOP');
      return true;
    }

    return false;
  }

  /**
   * Check and execute DCA exit ladder
   */
  private async checkDCAExit(
    position: PositionWithStrategy,
    executor: ChainExecutor
  ): Promise<boolean> {
    const pnlPercent = position.unrealized_pnl_percent;
    const levelsHit = position.exit_levels_hit || 0;

    // Check if we should hit the next exit level
    const nextLevel = getNextDCAExitLevel(pnlPercent, levelsHit, 'DCA_EXIT');

    if (nextLevel && pnlPercent >= nextLevel.targetPercent) {
      const tokensHeld = BigInt(position.tokens_held);
      const sellAmount = (tokensHeld * BigInt(nextLevel.sellPercent)) / 100n;

      console.log(
        `[${position.chain}] DCA exit level ${levelsHit + 1} triggered for ${position.token_symbol} ` +
        `(${nextLevel.targetPercent}% gain, selling ${nextLevel.sellPercent}%)`
      );

      // Execute partial sell
      await this.executePartialSell(position, executor, sellAmount, `DCA_LEVEL_${levelsHit + 1}`);

      // Update levels hit
      await updatePosition(position.id, {
        exit_levels_hit: levelsHit + 1,
        partial_exit_taken: true,
        tokens_held: (tokensHeld - sellAmount).toString(),
      });

      // Check if this was the last level
      if (levelsHit + 1 >= 4) {
        return true; // All levels hit, position effectively closed
      }

      return false; // Continue monitoring
    }

    return false;
  }

  /**
   * Check and execute moon bag exit
   */
  private async checkMoonBagExit(
    position: PositionWithStrategy,
    executor: ChainExecutor
  ): Promise<boolean> {
    const pnlPercent = position.unrealized_pnl_percent;
    const config = STRATEGY_CONFIGS['MOON_BAG'];

    // Check if we hit take profit
    if (pnlPercent >= config.takeProfitPercent) {
      const tokensHeld = BigInt(position.tokens_held);
      const moonBagAmount = calculateMoonBagAmount(tokensHeld, 'MOON_BAG');

      if (!moonBagAmount) return false;

      const sellAmount = tokensHeld - moonBagAmount;

      console.log(
        `[${position.chain}] Moon bag exit for ${position.token_symbol} ` +
        `(selling 75%, keeping ${config.moonBagPercent}% moon bag)`
      );

      // Execute partial sell
      await this.executePartialSell(position, executor, sellAmount, 'MOON_BAG_EXIT');

      // Update position to reflect moon bag
      await updatePosition(position.id, {
        partial_exit_taken: true,
        moon_bag_amount: moonBagAmount.toString(),
        tokens_held: moonBagAmount.toString(),
        // Keep position open with moon bag
      });

      return false; // Continue monitoring moon bag
    }

    return false;
  }

  /**
   * Execute a partial sell
   */
  private async executePartialSell(
    position: PositionWithStrategy,
    executor: ChainExecutor,
    amount: bigint,
    reason: string
  ): Promise<void> {
    try {
      // Use a special method for partial sells
      await executor.executeSell(
        position.id,
        position.token_address,
        position.token_symbol,
        amount,
        position.tg_id,
        position.entry_price
      );

      console.log(
        `[${position.chain}] Partial sell executed for position ${position.id} (${reason})`
      );
    } catch (error) {
      console.error(
        `Failed to execute partial sell for position ${position.id}:`,
        error
      );
    }
  }

  /**
   * Close position completely
   */
  private async closePosition(
    position: PositionWithStrategy,
    executor: ChainExecutor,
    reason: string
  ): Promise<void> {
    try {
      await executor.executeSell(
        position.id,
        position.token_address,
        position.token_symbol,
        BigInt(position.tokens_held),
        position.tg_id,
        position.entry_price
      );

      console.log(
        `[${position.chain}] Closed position ${position.id} (${reason})`
      );

      // TODO: Send notification to user
    } catch (error) {
      console.error(
        `Failed to close position ${position.id}:`,
        error
      );
    }
  }

  /**
   * Get position stats for a user
   */
  async getPositionStats(tgId: number): Promise<{
    activeCount: number;
    totalPnlPercent: number;
    totalValue: bigint;
  }> {
    try {
      const positions = await getAllActivePositions();
      const userPositions = positions.filter(p => p.tg_id === tgId);

      let totalPnlPercent = 0;
      let totalValue = 0n;

      for (const pos of userPositions) {
        totalPnlPercent += pos.unrealized_pnl_percent;
        // Assuming current_price is in native token units
        totalValue += BigInt(Math.floor(parseFloat(pos.current_price) * Number(BigInt(pos.tokens_held))));
      }

      return {
        activeCount: userPositions.length,
        totalPnlPercent: userPositions.length > 0 ? totalPnlPercent / userPositions.length : 0,
        totalValue,
      };
    } catch (error) {
      console.error('[PositionManager] Failed to get position stats:', error);
      return { activeCount: 0, totalPnlPercent: 0, totalValue: 0n };
    }
  }
}
