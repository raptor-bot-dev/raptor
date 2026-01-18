// =============================================================================
// RAPTOR TP/SL Engine - Monitor Loop
// Main orchestrator: Jupiter polling + WebSocket hints + trigger evaluation
// =============================================================================

import {
  getOpenPositions,
  updatePositionPrice,
  getStrategy,
  supabase,
  type PositionV31,
  type Strategy,
  type ExitTrigger,
  idKeyExitSell,
  getTpSlConfig,
  evaluateTrigger,
  computeTpSlPrices,
  computeTrailActivationPrice,
  isMaxHoldExceeded,
} from '@raptor/shared';
import { jupiter } from '@raptor/executor/solana';

import { HeliusWsManager } from '../monitors/heliusWs.js';
import { TpSlSubscriptionManager, type TokenActivityEvent } from '../monitors/subscriptionManager.js';
import { ExitQueue, createExitJob } from '../queues/exitQueue.js';

/**
 * Position with cached strategy data for trigger evaluation
 */
interface MonitoredPosition {
  position: PositionV31;
  strategy: Strategy;
  tpPrice: number;
  slPrice: number;
  trailActivationPrice: number | null;
}

/**
 * TpSlMonitorLoop - Main TP/SL engine orchestrator
 *
 * Hybrid pricing approach:
 * - Jupiter polling (3s interval) for all open positions
 * - Helius WebSocket for instant activity detection on monitored tokens
 *
 * Key features:
 * - Token-scoped WebSocket subscriptions (not per-position)
 * - Atomic trigger claims to prevent double-execution
 * - Priority-based exit queue with backpressure
 * - Feature-flagged for parallel migration with legacy monitor
 */
export class TpSlMonitorLoop {
  private running = false;
  private workerId: string;

  // Infrastructure
  private wsManager: HeliusWsManager;
  private subscriptionManager: TpSlSubscriptionManager;
  private exitQueue: ExitQueue;

  // Position tracking
  private monitoredPositions: Map<string, MonitoredPosition> = new Map(); // positionId -> data
  private tokenToPositions: Map<string, Set<string>> = new Map(); // tokenMint -> positionIds

  // Polling
  private pollTimer: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;

  // Stats
  private stats = {
    pollCycles: 0,
    priceUpdates: 0,
    triggersEvaluated: 0,
    triggersDetected: 0,
    wsActivityHints: 0,
  };

  constructor(workerId: string) {
    this.workerId = workerId;

    const config = getTpSlConfig();
    this.pollIntervalMs = config.pollIntervalMs;

    // Initialize infrastructure
    this.wsManager = new HeliusWsManager();
    this.subscriptionManager = new TpSlSubscriptionManager(this.wsManager);
    this.exitQueue = new ExitQueue();

    // Wire up activity events
    this.subscriptionManager.on('activity', (event: TokenActivityEvent) => {
      this.handleActivityHint(event);
    });
  }

  /**
   * Start the TP/SL monitor loop
   */
  async start(): Promise<void> {
    const config = getTpSlConfig();

    if (!config.enabled) {
      console.log('[TpSlMonitorLoop] TP/SL engine is disabled (TPSL_ENGINE_ENABLED != true)');
      return;
    }

    if (this.running) return;

    console.log('[TpSlMonitorLoop] Starting...');
    console.log(`[TpSlMonitorLoop] Poll interval: ${this.pollIntervalMs}ms`);

    this.running = true;

    // Start infrastructure
    await this.wsManager.start();
    this.exitQueue.start();

    // Load initial positions
    await this.loadPositions();

    // Start polling
    this.schedulePoll();

    console.log('[TpSlMonitorLoop] Started');
  }

  /**
   * Stop the TP/SL monitor loop
   */
  async stop(): Promise<void> {
    console.log('[TpSlMonitorLoop] Stopping...');
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop infrastructure
    await this.exitQueue.stop(true); // Wait for drain
    await this.wsManager.stop();

    this.monitoredPositions.clear();
    this.tokenToPositions.clear();

    console.log('[TpSlMonitorLoop] Stopped');
    this.logStats();
  }

  /**
   * Get current statistics
   */
  getStats(): typeof this.stats & { positions: number; tokens: number; queue: ReturnType<ExitQueue['getStats']> } {
    return {
      ...this.stats,
      positions: this.monitoredPositions.size,
      tokens: this.tokenToPositions.size,
      queue: this.exitQueue.getStats(),
    };
  }

  /**
   * Load/refresh open positions from database
   */
  private async loadPositions(): Promise<void> {
    try {
      // Get all open positions
      const positions = await getOpenPositions('sol');

      // Track which positions we've seen
      const currentPositionIds = new Set<string>();

      for (const position of positions) {
        currentPositionIds.add(position.id);

        // Skip if already monitoring and trigger state is MONITORING
        const existing = this.monitoredPositions.get(position.id);
        if (existing && position.trigger_state === 'MONITORING') {
          // Update position data (price might have changed externally)
          existing.position = position;
          continue;
        }

        // Skip positions not in MONITORING state
        if (position.trigger_state !== 'MONITORING') {
          this.removePosition(position.id);
          continue;
        }

        // Load strategy for trigger evaluation
        const strategy = await getStrategy(position.strategy_id);
        if (!strategy) {
          console.warn(`[TpSlMonitorLoop] Strategy not found for position ${position.id}`);
          continue;
        }

        // Compute trigger prices
        const { tpPrice, slPrice } = computeTpSlPrices(
          position.entry_price,
          strategy.take_profit_percent,
          strategy.stop_loss_percent
        );

        const trailActivationPrice = strategy.trailing_enabled
          ? computeTrailActivationPrice(
              position.entry_price,
              strategy.trailing_activation_percent ?? null
            )
          : null;

        // Add to monitoring
        const monitored: MonitoredPosition = {
          position,
          strategy,
          tpPrice,
          slPrice,
          trailActivationPrice,
        };

        this.monitoredPositions.set(position.id, monitored);

        // Track token -> positions mapping
        let tokenPositions = this.tokenToPositions.get(position.token_mint);
        if (!tokenPositions) {
          tokenPositions = new Set();
          this.tokenToPositions.set(position.token_mint, tokenPositions);
        }
        tokenPositions.add(position.id);

        // Subscribe to WebSocket for this token
        this.subscriptionManager.addPosition(
          position.id,
          position.token_mint,
          position.bonding_curve || position.token_mint // Fallback to mint if no bonding curve
        );
      }

      // Remove positions that are no longer open
      for (const [positionId] of this.monitoredPositions) {
        if (!currentPositionIds.has(positionId)) {
          this.removePosition(positionId);
        }
      }

      if (positions.length > 0) {
        console.log(
          `[TpSlMonitorLoop] Monitoring ${this.monitoredPositions.size} positions ` +
            `across ${this.tokenToPositions.size} tokens`
        );
      }
    } catch (error) {
      console.error('[TpSlMonitorLoop] Failed to load positions:', error);
    }
  }

  /**
   * Remove a position from monitoring
   */
  private removePosition(positionId: string): void {
    const monitored = this.monitoredPositions.get(positionId);
    if (!monitored) return;

    const tokenMint = monitored.position.token_mint;

    // Remove from position map
    this.monitoredPositions.delete(positionId);

    // Remove from token -> positions mapping
    const tokenPositions = this.tokenToPositions.get(tokenMint);
    if (tokenPositions) {
      tokenPositions.delete(positionId);
      if (tokenPositions.size === 0) {
        this.tokenToPositions.delete(tokenMint);
      }
    }

    // Unsubscribe from WebSocket
    this.subscriptionManager.removePosition(positionId);
  }

  /**
   * Schedule next poll cycle
   */
  private schedulePoll(): void {
    if (!this.running) return;

    this.pollTimer = setTimeout(async () => {
      await this.pollCycle();
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Main poll cycle - check all positions
   */
  private async pollCycle(): Promise<void> {
    this.stats.pollCycles++;

    try {
      // Refresh position list periodically
      if (this.stats.pollCycles % 10 === 0) {
        await this.loadPositions();
      }

      // Get unique tokens to fetch prices for
      const tokens = Array.from(this.tokenToPositions.keys());
      if (tokens.length === 0) return;

      // Fetch prices in parallel (batch for efficiency)
      const pricePromises = tokens.map(async (tokenMint) => {
        try {
          const price = await jupiter.getTokenPrice(tokenMint);
          return { tokenMint, price: price > 0 ? price : null };
        } catch {
          return { tokenMint, price: null };
        }
      });

      const priceResults = await Promise.all(pricePromises);

      // Evaluate triggers for each token's positions
      for (const { tokenMint, price } of priceResults) {
        if (price === null) continue;

        const positionIds = this.tokenToPositions.get(tokenMint);
        if (!positionIds) continue;

        for (const positionId of positionIds) {
          await this.evaluatePosition(positionId, price);
        }
      }
    } catch (error) {
      console.error('[TpSlMonitorLoop] Poll cycle error:', error);
    }
  }

  /**
   * Handle WebSocket activity hint - trigger immediate price check
   */
  private async handleActivityHint(event: TokenActivityEvent): Promise<void> {
    this.stats.wsActivityHints++;

    const positionIds = this.tokenToPositions.get(event.tokenMint);
    if (!positionIds || positionIds.size === 0) return;

    // Fetch fresh price
    try {
      const price = await jupiter.getTokenPrice(event.tokenMint);
      if (price <= 0) return;

      // Evaluate all positions for this token
      for (const positionId of positionIds) {
        await this.evaluatePosition(positionId, price);
      }
    } catch (error) {
      console.error(
        `[TpSlMonitorLoop] Activity hint price fetch failed for ${event.tokenMint.slice(0, 12)}...:`,
        error
      );
    }
  }

  /**
   * Evaluate a single position against current price
   */
  private async evaluatePosition(positionId: string, currentPrice: number): Promise<void> {
    const monitored = this.monitoredPositions.get(positionId);
    if (!monitored) return;

    const { position, strategy, tpPrice, slPrice, trailActivationPrice } = monitored;
    this.stats.triggersEvaluated++;

    try {
      // Update peak price tracking
      const newPeak = Math.max(currentPrice, position.peak_price || 0);
      if (newPeak > (position.peak_price || 0)) {
        await updatePositionPrice(position.id, currentPrice, newPeak);
        monitored.position.peak_price = newPeak;
      }
      this.stats.priceUpdates++;

      // Evaluate trigger conditions
      let trigger: ExitTrigger | null = evaluateTrigger(
        currentPrice,
        tpPrice,
        slPrice,
        position.peak_price,
        trailActivationPrice,
        strategy.trailing_enabled ? (strategy.trailing_distance_percent ?? null) : null
      );

      // Check max hold time
      if (!trigger && isMaxHoldExceeded(position.opened_at, strategy.max_hold_minutes)) {
        trigger = 'MAXHOLD';
      }

      if (!trigger) return;

      this.stats.triggersDetected++;

      // Attempt atomic trigger claim
      const claimed = await this.claimTrigger(position.id, trigger, currentPrice);
      if (!claimed) {
        // Another worker claimed it, or already triggered
        return;
      }

      console.log(
        `[TpSlMonitorLoop] Trigger ${trigger} fired for ${position.token_symbol} ` +
          `at price ${currentPrice.toFixed(10)} (position: ${position.id.slice(0, 8)}...)`
      );

      // Create exit job
      const sellPercent =
        trigger === 'TP' && strategy.moon_bag_percent > 0
          ? 100 - strategy.moon_bag_percent
          : 100;

      const idempotencyKey = idKeyExitSell({
        chain: position.chain as 'sol',
        mint: position.token_mint,
        positionId: position.id,
        trigger,
        sellPercent,
      });

      const exitJob = createExitJob({
        positionId: position.id,
        tokenMint: position.token_mint,
        userId: position.user_id,
        trigger,
        triggerPrice: currentPrice,
        idempotencyKey,
        sellPercent,
      });

      // Enqueue for execution
      this.exitQueue.enqueue(exitJob);

      // Remove from monitoring (position is exiting)
      this.removePosition(position.id);
    } catch (error) {
      console.error(
        `[TpSlMonitorLoop] Error evaluating position ${positionId}:`,
        error
      );
    }
  }

  /**
   * Atomically claim a trigger in the database
   * Returns true if successfully claimed, false if already triggered
   */
  private async claimTrigger(
    positionId: string,
    trigger: ExitTrigger,
    triggerPrice: number
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('trigger_exit_atomically', {
        p_position_id: positionId,
        p_trigger: trigger,
        p_trigger_price: triggerPrice,
      });

      if (error) {
        console.error('[TpSlMonitorLoop] Atomic claim error:', error);
        return false;
      }

      return data?.triggered === true;
    } catch (error) {
      console.error('[TpSlMonitorLoop] Atomic claim failed:', error);
      return false;
    }
  }

  /**
   * Log statistics
   */
  private logStats(): void {
    console.log('[TpSlMonitorLoop] Session stats:', {
      pollCycles: this.stats.pollCycles,
      priceUpdates: this.stats.priceUpdates,
      triggersEvaluated: this.stats.triggersEvaluated,
      triggersDetected: this.stats.triggersDetected,
      wsActivityHints: this.stats.wsActivityHints,
    });
  }
}
