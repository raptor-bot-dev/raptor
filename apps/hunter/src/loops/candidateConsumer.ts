// =============================================================================
// RAPTOR Candidate Consumer Loop
// Converts launch_candidates (status='new') into trade_jobs for enabled strategies
// =============================================================================

import {
  getNewCandidates,
  updateCandidateStatus,
  expireStaleCandidates,
  getEnabledAutoStrategies,
  createTradeJob,
  isTradingPaused,
  isCircuitOpen,
  idKeyAutoBuy,
  getCandidateConsumerPollIntervalMs,
  getCandidateConsumerBatchSize,
  getCandidateMaxAgeSeconds,
  type LaunchCandidate,
  type Strategy,
} from '@raptor/shared';

const DEFAULT_SLIPPAGE_BPS = 1500; // 15%
const DEFAULT_BUY_AMOUNT_SOL = 0.1;
const MAINTENANCE_INTERVAL_MS = 30000; // Run maintenance every 30 seconds

export class CandidateConsumerLoop {
  private running = false;
  private workerId: string;
  private pollIntervalMs: number;
  private batchSize: number;
  private maxAgeSeconds: number;
  private lastMaintenanceAt = 0;

  private stats = {
    candidatesProcessed: 0,
    jobsCreated: 0,
    candidatesRejected: 0,
    candidatesExpired: 0,
    errors: 0,
  };

  constructor(workerId: string) {
    this.workerId = workerId;
    this.pollIntervalMs = getCandidateConsumerPollIntervalMs();
    this.batchSize = getCandidateConsumerBatchSize();
    this.maxAgeSeconds = getCandidateMaxAgeSeconds();
  }

  /**
   * Get current statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  async start(): Promise<void> {
    console.log('[CandidateConsumerLoop] Starting...');
    console.log(`[CandidateConsumerLoop] Poll interval: ${this.pollIntervalMs}ms, Batch size: ${this.batchSize}`);
    console.log(`[CandidateConsumerLoop] Max candidate age: ${this.maxAgeSeconds}s`);

    this.running = true;
    this.poll();
  }

  async stop(): Promise<void> {
    console.log('[CandidateConsumerLoop] Stopping...');
    this.running = false;
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        // Run periodic maintenance (expire stale candidates)
        await this.maybeRunMaintenance();

        // Check global safety controls
        const paused = await isTradingPaused();
        if (paused) {
          console.log('[CandidateConsumerLoop] Trading is paused globally');
          await this.sleep(5000);
          continue;
        }

        const circuitOpen = await isCircuitOpen();
        if (circuitOpen) {
          console.log('[CandidateConsumerLoop] Circuit breaker is open');
          await this.sleep(5000);
          continue;
        }

        // Get enabled AUTO strategies
        const strategies = await getEnabledAutoStrategies('sol');
        if (strategies.length === 0) {
          // No strategies, sleep longer
          await this.sleep(this.pollIntervalMs * 5);
          continue;
        }

        // Get new candidates
        const candidates = await getNewCandidates(this.batchSize, this.maxAgeSeconds);
        if (candidates.length === 0) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        console.log(`[CandidateConsumerLoop] Processing ${candidates.length} candidates for ${strategies.length} strategies`);

        // Process each candidate
        for (const candidate of candidates) {
          await this.processCandidate(candidate, strategies);
        }
      } catch (error) {
        this.stats.errors++;
        console.error('[CandidateConsumerLoop] Poll error:', error);
        await this.sleep(this.pollIntervalMs * 2);
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * Process a single candidate across all enabled strategies
   */
  private async processCandidate(
    candidate: LaunchCandidate,
    strategies: Strategy[]
  ): Promise<void> {
    this.stats.candidatesProcessed++;

    const jobsCreated: string[] = [];
    const rejectionReasons: string[] = [];

    for (const strategy of strategies) {
      try {
        // Check if this strategy should trade this candidate
        const shouldTrade = this.shouldTradeCandidate(candidate, strategy);
        if (!shouldTrade.ok) {
          rejectionReasons.push(`${strategy.name}: ${shouldTrade.reason}`);
          continue;
        }

        // Determine buy amount (use max_per_trade_sol from strategy)
        const amountSol = strategy.max_per_trade_sol || DEFAULT_BUY_AMOUNT_SOL;
        const slippageBps = strategy.slippage_bps || DEFAULT_SLIPPAGE_BPS;

        // Create idempotency key
        const idempotencyKey = idKeyAutoBuy({
          chain: 'sol',
          strategyId: strategy.id,
          mint: candidate.mint,
          opportunityId: candidate.id,
          amountSol,
          slippageBps,
        });

        // Create trade job
        const job = await createTradeJob({
          strategyId: strategy.id,
          userId: strategy.user_id,
          opportunityId: candidate.id,
          chain: 'sol',
          action: 'BUY',
          idempotencyKey,
          payload: {
            mint: candidate.mint,
            amount_sol: amountSol,
            slippage_bps: slippageBps,
          },
          priority: 100,
        });

        jobsCreated.push(`${strategy.name} (job ${job.id})`);
        this.stats.jobsCreated++;

        console.log(
          `[CandidateConsumerLoop] Created job for ${candidate.symbol || candidate.mint.slice(0, 8)} ` +
          `(${strategy.name}, user ${strategy.user_id})`
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        // Duplicate key error is expected (idempotent)
        if (msg.includes('duplicate key') || msg.includes('23505')) {
          console.log(`[CandidateConsumerLoop] Job already exists for ${strategy.name}`);
        } else {
          console.error(`[CandidateConsumerLoop] Error creating job:`, msg);
          rejectionReasons.push(`${strategy.name}: ${msg}`);
        }
      }
    }

    // Update candidate status
    if (jobsCreated.length > 0) {
      await updateCandidateStatus(
        candidate.id,
        'accepted',
        `Created jobs: ${jobsCreated.join(', ')}`
      );
    } else if (rejectionReasons.length > 0) {
      this.stats.candidatesRejected++;
      await updateCandidateStatus(
        candidate.id,
        'rejected',
        rejectionReasons.join('; ')
      );
    }
  }

  /**
   * Check if a strategy should trade a candidate
   * Returns { ok: true } or { ok: false, reason: string }
   */
  private shouldTradeCandidate(
    candidate: LaunchCandidate,
    strategy: Strategy
  ): { ok: true } | { ok: false; reason: string } {
    // Check if strategy is enabled
    if (!strategy.enabled) {
      return { ok: false, reason: 'strategy_disabled' };
    }

    // Check auto_execute
    if (!strategy.auto_execute) {
      return { ok: false, reason: 'auto_execute_disabled' };
    }

    // Check chain match
    if (strategy.chain !== 'sol') {
      return { ok: false, reason: 'chain_mismatch' };
    }

    // Check buy amount (max_per_trade_sol)
    if (!strategy.max_per_trade_sol || strategy.max_per_trade_sol <= 0) {
      return { ok: false, reason: 'no_buy_amount' };
    }

    // Check launch source filter (if strategy has allowed_launchpads)
    if (strategy.allowed_launchpads && strategy.allowed_launchpads.length > 0) {
      if (!strategy.allowed_launchpads.includes(candidate.launch_source)) {
        return { ok: false, reason: `source_not_allowed: ${candidate.launch_source}` };
      }
    }

    // All checks passed
    return { ok: true };
  }

  /**
   * Periodically expire stale candidates
   */
  private async maybeRunMaintenance(): Promise<void> {
    const now = Date.now();
    if (now - this.lastMaintenanceAt < MAINTENANCE_INTERVAL_MS) {
      return;
    }
    this.lastMaintenanceAt = now;

    try {
      const expired = await expireStaleCandidates(this.maxAgeSeconds);
      if (expired > 0) {
        this.stats.candidatesExpired += expired;
        console.log(`[CandidateConsumerLoop] Expired ${expired} stale candidates`);
      }
    } catch (error) {
      console.error('[CandidateConsumerLoop] Maintenance error:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
