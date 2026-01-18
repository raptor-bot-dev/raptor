// =============================================================================
// RAPTOR v3.1 Position Monitor Loop
// Monitors open positions for TP/SL/Trailing/MaxHold exit triggers
// =============================================================================

import {
  getOpenPositions,
  updatePositionPriceByUuid,
  createTradeJob,
  getStrategy,
  triggerExitAtomically,
  markPositionExecuting,
  type PositionV31,
  type Strategy,
  type Chain,
  type ExitTrigger,
} from '@raptor/shared';
import { idKeyExitSell } from '@raptor/shared';
import { jupiter } from '@raptor/executor/solana';

/**
 * Get current token price from Jupiter Price API
 * @param mint - Token mint address
 * @returns Price in SOL, or null if unavailable
 */
const getTokenPrice = async (mint: string): Promise<number | null> => {
  try {
    const price = await jupiter.getTokenPrice(mint);
    // Jupiter returns 0 on error/no price
    return price > 0 ? price : null;
  } catch (error) {
    console.error(`[PositionMonitorLoop] Failed to get price for ${mint}:`, error);
    return null;
  }
};

const POLL_INTERVAL_MS = 3000;

export class PositionMonitorLoop {
  private running = false;
  private workerId: string;

  constructor(workerId: string) {
    this.workerId = workerId;
  }

  async start(): Promise<void> {
    console.log('[PositionMonitorLoop] Starting...');
    this.running = true;
    this.poll();
  }

  async stop(): Promise<void> {
    console.log('[PositionMonitorLoop] Stopping...');
    this.running = false;
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        // Get all open positions for Solana
        const positions = await getOpenPositions('sol');

        if (positions.length > 0) {
          console.log(
            `[PositionMonitorLoop] Checking ${positions.length} positions`
          );
        }

        for (const position of positions) {
          await this.checkExitConditions(position);
        }
      } catch (error) {
        console.error('[PositionMonitorLoop] Poll error:', error);
      }

      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  /**
   * Check exit conditions for a position
   */
  private async checkExitConditions(position: PositionV31): Promise<void> {
    try {
      // Phase B audit fix: Skip if already triggered by TP/SL engine
      // This prevents duplicate exit jobs when both monitors run in parallel
      if (position.trigger_state && position.trigger_state !== 'MONITORING') {
        return;
      }

      // Get strategy for exit parameters
      const strategy = await getStrategy(position.strategy_id);
      if (!strategy) {
        console.warn(
          `[PositionMonitorLoop] Strategy not found for position ${position.uuid_id}`
        );
        return;
      }

      // Get current price
      const currentPrice = await getTokenPrice(position.token_mint);
      if (currentPrice === null) {
        return;
      }

      // Calculate price change
      const priceChange =
        ((currentPrice - position.entry_price) / position.entry_price) * 100;

      // Update peak price tracking (use uuid_id)
      const newPeak = Math.max(currentPrice, position.peak_price || 0);
      await updatePositionPriceByUuid(position.uuid_id, currentPrice, newPeak);

      // Check for exit triggers
      let trigger: ExitTrigger | null = null;

      // Take profit
      if (priceChange >= strategy.take_profit_percent) {
        trigger = 'TP';
      }

      // Stop loss
      if (priceChange <= -strategy.stop_loss_percent) {
        trigger = 'SL';
      }

      // Trailing stop
      if (strategy.trailing_enabled && position.peak_price) {
        const activationReached =
          ((position.peak_price - position.entry_price) /
            position.entry_price) *
            100 >=
          (strategy.trailing_activation_percent || 0);

        if (activationReached) {
          const peakDrop =
            ((position.peak_price - currentPrice) / position.peak_price) * 100;

          if (peakDrop >= (strategy.trailing_distance_percent || 0)) {
            trigger = 'TRAIL';
          }
        }
      }

      // Max hold time
      const holdMinutes =
        (Date.now() - new Date(position.opened_at).getTime()) / 60000;
      if (holdMinutes >= strategy.max_hold_minutes) {
        trigger = 'MAXHOLD';
      }

      // Create exit job if trigger detected
      if (trigger) {
        await this.createExitJob(position, strategy, trigger, currentPrice);
      }
    } catch (error) {
      console.error(
        `[PositionMonitorLoop] Error checking position ${position.uuid_id}:`,
        error
      );
    }
  }

  /**
   * Create an exit (sell) job for a position
   * Uses atomic claim to prevent duplicate exits when running with TP/SL engine
   */
  private async createExitJob(
    position: PositionV31,
    strategy: Strategy,
    trigger: ExitTrigger,
    currentPrice: number
  ): Promise<void> {
    // Atomic claim: attempt to claim this trigger before creating exit job
    // This prevents race conditions with the TP/SL engine
    const claimResult = await triggerExitAtomically(
      position.uuid_id,
      trigger,
      currentPrice
    );

    if (!claimResult.triggered) {
      // Another worker (or TP/SL engine) already claimed this position
      console.log(
        `[PositionMonitorLoop] Atomic claim failed for ${position.uuid_id.slice(0, 8)}...: ${claimResult.reason}`
      );
      return;
    }

    // Calculate sell percent (leave moon bag if TP)
    const sellPercent =
      trigger === 'TP' && strategy.moon_bag_percent > 0
        ? 100 - strategy.moon_bag_percent
        : 100;

    // Generate idempotency key (use uuid_id)
    const idempotencyKey = idKeyExitSell({
      chain: position.chain as Chain,
      mint: position.token_mint,
      positionId: position.uuid_id,
      trigger,
      sellPercent,
    });

    try {
      // Mark position as EXECUTING
      await markPositionExecuting(position.uuid_id);

      // Create sell job (use uuid_id for position_id, tg_id for userId)
      await createTradeJob({
        strategyId: position.strategy_id,
        userId: position.tg_id,
        chain: position.chain,
        action: 'SELL',
        idempotencyKey,
        payload: {
          mint: position.token_mint,
          position_id: position.uuid_id,  // Use uuid_id
          sell_percent: sellPercent,
          slippage_bps: strategy.slippage_bps,
          priority_fee_lamports: strategy.priority_fee_lamports,
          trigger,
          trigger_price: currentPrice,
        },
        priority: 50, // Higher priority for exits
      });

      console.log(
        `[PositionMonitorLoop] Created ${trigger} exit job for position ${position.uuid_id.slice(0, 8)}...`
      );

      // NOTE: Notifications are NOT created here at trigger time.
      // They are created in execution.ts AFTER the sell completes
      // with real solReceived and txHash values.
    } catch (error) {
      // Duplicate key means exit job already exists
      if ((error as Error).message?.includes('duplicate')) {
        return;
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
