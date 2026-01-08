import type { Position } from '@raptor/shared';
import {
  getAllActivePositions,
  updatePosition,
  MAX_HOLD_TIME,
} from '@raptor/shared';
import { ChainExecutor } from '../chains/chainExecutor.js';
import { PriceFeed, createPriceFeed, PriceUpdate } from '../feeds/priceFeed.js';

// Faster intervals with real-time price feeds
const POSITION_CHECK_INTERVAL = 3000; // 3 seconds (faster checks with real-time prices)
const PRICE_POLL_INTERVAL = 5000; // 5 seconds fallback for polling

export class PositionManager {
  private executors: Map<string, ChainExecutor> = new Map();
  private priceFeeds: Map<string, PriceFeed> = new Map();
  private latestPrices: Map<string, bigint> = new Map(); // token -> price
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private subscribedPositions: Set<string> = new Set(); // position keys

  constructor(executors: ChainExecutor[]) {
    for (const executor of executors) {
      const config = executor.getConfig();
      const chainKey = config.name.toLowerCase();
      this.executors.set(chainKey, executor);

      // Create price feed for this chain
      const priceFeed = createPriceFeed(config, executor.getProvider());
      this.priceFeeds.set(chainKey, priceFeed);
    }
  }

  async start(): Promise<void> {
    this.running = true;

    // Start price feeds for all chains
    for (const [chain, priceFeed] of this.priceFeeds) {
      await priceFeed.start();
      console.log(`[PositionManager] Price feed started for ${chain}`);
    }

    // Subscribe to existing positions
    await this.syncPositionSubscriptions();

    // Start position check loop (faster with real-time prices)
    this.checkInterval = setInterval(
      () => this.checkPositions(),
      POSITION_CHECK_INTERVAL
    );

    console.log('[PositionManager] Started with real-time price feeds');
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop all price feeds
    for (const priceFeed of this.priceFeeds.values()) {
      await priceFeed.stop();
    }

    if (this.checkInterval) clearInterval(this.checkInterval);
    console.log('[PositionManager] Stopped');
  }

  /**
   * Sync price feed subscriptions with active positions
   */
  private async syncPositionSubscriptions(): Promise<void> {
    try {
      const positions = await getAllActivePositions();
      const activeKeys = new Set<string>();

      for (const position of positions) {
        const key = `${position.chain}:${position.token_address}`;
        activeKeys.add(key);

        // Subscribe if not already
        if (!this.subscribedPositions.has(key)) {
          await this.subscribeToPosition(position);
        }
      }

      // Unsubscribe from closed positions
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

  /**
   * Subscribe to price updates for a position
   */
  private async subscribeToPosition(position: Position): Promise<void> {
    const priceFeed = this.priceFeeds.get(position.chain);
    if (!priceFeed) return;

    const key = `${position.chain}:${position.token_address}`;

    // Create handler for this token
    const handler = async (update: PriceUpdate) => {
      // Store latest price
      this.latestPrices.set(update.token, update.price);

      // Update position with new price
      try {
        const entryPrice = parseFloat(position.entry_price);
        const currentPriceNum =
          Number(update.price) / Number(BigInt(position.tokens_held));
        const pnlPercent =
          ((currentPriceNum - entryPrice) / entryPrice) * 100;

        await updatePosition(position.id, {
          current_price: currentPriceNum.toString(),
          unrealized_pnl_percent: pnlPercent,
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
      // Sync subscriptions to pick up new positions
      await this.syncPositionSubscriptions();

      const positions = await getAllActivePositions();

      for (const position of positions) {
        await this.checkPosition(position);
      }
    } catch (error) {
      console.error('[PositionManager] Position check failed:', error);
    }
  }

  private async checkPosition(position: Position): Promise<void> {
    const executor = this.executors.get(position.chain);
    if (!executor) return;

    // Check take profit
    if (position.unrealized_pnl_percent >= position.take_profit_percent) {
      console.log(
        `[${position.chain}] Take profit triggered for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'TAKE_PROFIT');
      return;
    }

    // Check stop loss
    if (position.unrealized_pnl_percent <= -position.stop_loss_percent) {
      console.log(
        `[${position.chain}] Stop loss triggered for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'STOP_LOSS');
      return;
    }

    // Check max hold time
    const holdTime = Date.now() - new Date(position.created_at).getTime();
    if (holdTime > MAX_HOLD_TIME) {
      console.log(
        `[${position.chain}] Max hold time reached for ${position.token_symbol}`
      );
      await this.closePosition(position, executor, 'MAX_HOLD_TIME');
      return;
    }
  }

  private async closePosition(
    position: Position,
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
}
