// =============================================================================
// RAPTOR v4.3 Opportunity Loop
// Monitors launchpads and creates qualified opportunities with snipe modes
// =============================================================================

import {
  upsertOpportunity,
  updateOpportunityStatus,
  getEnabledAutoStrategies,
  createTradeJob,
  type Chain,
  type Strategy,
  type OpportunityV31,
} from '@raptor/shared';
import { idKeyAutoBuy } from '@raptor/shared';
import { PumpFunMonitor, type PumpFunEvent } from '../monitors/pumpfun.js';
import { scoreOpportunity, type ScoringResult } from '../scoring/scorer.js';
import { fetchMetadata, type TokenMetadata } from '../utils/metadataFetcher.js';

// Snipe mode timeout configurations (ms)
const SNIPE_MODE_TIMEOUTS: Record<string, number> = {
  speed: 0,       // No metadata fetch
  balanced: 200,  // 200ms timeout
  quality: 2000,  // 2 second timeout
};

// Default snipe mode if not specified
const DEFAULT_SNIPE_MODE = 'balanced';

export class OpportunityLoop {
  private running = false;
  private pumpFunMonitor: PumpFunMonitor;

  constructor() {
    this.pumpFunMonitor = new PumpFunMonitor();
  }

  async start(): Promise<void> {
    console.log('[OpportunityLoop] Starting...');
    this.running = true;

    // Register handler for pump.fun events
    this.pumpFunMonitor.onTokenCreate(async (event) => {
      await this.handleNewToken(event);
    });

    // Start the monitor
    await this.pumpFunMonitor.start();

    console.log('[OpportunityLoop] Monitoring launchpads');
  }

  async stop(): Promise<void> {
    console.log('[OpportunityLoop] Stopping...');
    this.running = false;
    await this.pumpFunMonitor.stop();
  }

  /**
   * Handle a new token detection from any launchpad
   * v4.3: Added metadata fetching based on per-user snipe mode from strategy
   */
  private async handleNewToken(event: PumpFunEvent): Promise<void> {
    if (!this.running) return;

    try {
      // 1. Create/upsert opportunity
      const opportunity = await upsertOpportunity({
        chain: 'sol',
        source: 'pump.fun',
        tokenMint: event.mint,
        tokenName: event.name,
        tokenSymbol: event.symbol,
        deployer: event.creator,
        bondingCurve: event.bondingCurve,
        rawData: event as unknown as Record<string, unknown>,
      });

      console.log(
        `[OpportunityLoop] New token: ${event.symbol} (${event.mint.slice(0, 8)}...)`
      );

      // 2. Get all enabled AUTO strategies to determine snipe mode
      const strategies = await getEnabledAutoStrategies('sol');

      if (strategies.length === 0) {
        console.log(`[OpportunityLoop] No enabled strategies, skipping: ${event.symbol}`);
        return;
      }

      // 3. Determine snipe mode: use the most thorough mode among all enabled strategies
      // Priority: quality > balanced > speed (to ensure quality users get metadata)
      const snipeMode = this.getMostThoroughSnipeMode(strategies);
      const timeoutMs = SNIPE_MODE_TIMEOUTS[snipeMode] || SNIPE_MODE_TIMEOUTS.balanced;

      console.log(`[OpportunityLoop] Using snipe mode: ${snipeMode} (${strategies.length} strategies)`);

      // 4. Fetch metadata based on determined snipe mode
      let metadata: TokenMetadata | null = null;
      if (timeoutMs > 0 && event.uri) {
        const fetchStart = Date.now();
        metadata = await fetchMetadata(event.uri, timeoutMs);
        const fetchTime = Date.now() - fetchStart;
        if (metadata) {
          console.log(
            `[OpportunityLoop] Metadata fetched in ${fetchTime}ms: ` +
            `twitter=${Boolean(metadata.twitter)}, tg=${Boolean(metadata.telegram)}, ` +
            `web=${Boolean(metadata.website)}, img=${Boolean(metadata.image)}`
          );
        } else {
          console.log(`[OpportunityLoop] Metadata fetch ${timeoutMs > fetchTime ? 'failed' : 'timed out'} (${fetchTime}ms)`);
        }
      }

      // 5. Score the opportunity with metadata
      const scoring = await scoreOpportunity(opportunity, event, metadata);

      // 6. Update opportunity with score
      await upsertOpportunity({
        chain: 'sol',
        source: 'pump.fun',
        tokenMint: event.mint,
        score: scoring.totalScore,
        reasons: scoring.reasons,
      });

      // 7. Check qualification
      if (!scoring.qualified) {
        await updateOpportunityStatus(
          opportunity.id,
          'REJECTED',
          `Score ${scoring.totalScore} below minimum`
        );
        console.log(
          `[OpportunityLoop] Rejected: ${event.symbol} (score: ${scoring.totalScore})`
        );
        return;
      }

      // 8. Find matching strategies
      const matchingStrategies = strategies.filter((s) =>
        this.strategyMatchesOpportunity(s, opportunity, scoring)
      );

      if (matchingStrategies.length === 0) {
        await updateOpportunityStatus(
          opportunity.id,
          'QUALIFIED',
          'No matching strategies'
        );
        console.log(
          `[OpportunityLoop] Qualified but no matching strategies: ${event.symbol}`
        );
        return;
      }

      // 9. Mark as executing and create trade jobs
      await updateOpportunityStatus(opportunity.id, 'EXECUTING');

      let jobsCreated = 0;
      for (const strategy of matchingStrategies) {
        try {
          await this.createBuyJob(opportunity, strategy);
          jobsCreated++;
        } catch (error) {
          console.error(`[OpportunityLoop] Failed to create job for strategy ${strategy.id}:`, error);
        }
      }

      // 10. Update opportunity status based on job creation results
      if (jobsCreated > 0) {
        await updateOpportunityStatus(
          opportunity.id,
          'COMPLETED',
          `Created ${jobsCreated}/${matchingStrategies.length} trade jobs`
        );
        console.log(
          `[OpportunityLoop] Created ${jobsCreated} jobs for: ${event.symbol}`
        );
      } else {
        await updateOpportunityStatus(
          opportunity.id,
          'REJECTED',
          'Failed to create any trade jobs'
        );
        console.warn(
          `[OpportunityLoop] Failed to create any jobs for: ${event.symbol}`
        );
      }
    } catch (error) {
      console.error('[OpportunityLoop] Error handling token:', error);
    }
  }

  /**
   * Get the most thorough snipe mode from all strategies
   * v4.3: quality > balanced > speed to ensure quality users get metadata
   *
   * NOTE: This is a known limitation - all users share the same metadata fetch timeout.
   * If ANY user has 'quality' mode, all users wait for metadata (up to 2000ms).
   * This ensures quality users get proper scoring, but may delay speed users slightly.
   *
   * Future improvement: Per-user scoring with separate metadata fetch per snipe mode.
   */
  private getMostThoroughSnipeMode(strategies: Strategy[]): string {
    const modes = strategies.map((s) => s.snipe_mode || DEFAULT_SNIPE_MODE);

    // Count modes for logging
    const speedCount = modes.filter(m => m === 'speed').length;
    const balancedCount = modes.filter(m => m === 'balanced').length;
    const qualityCount = modes.filter(m => m === 'quality').length;

    if (qualityCount > 0) {
      console.log(`[OpportunityLoop] Snipe modes: ${speedCount} speed, ${balancedCount} balanced, ${qualityCount} quality -> using quality`);
      return 'quality';
    }
    if (balancedCount > 0) {
      console.log(`[OpportunityLoop] Snipe modes: ${speedCount} speed, ${balancedCount} balanced -> using balanced`);
      return 'balanced';
    }
    console.log(`[OpportunityLoop] Snipe modes: ${speedCount} speed -> using speed`);
    return 'speed';
  }

  /**
   * Check if a strategy matches an opportunity
   */
  private strategyMatchesOpportunity(
    strategy: Strategy,
    opportunity: OpportunityV31,
    scoring: ScoringResult
  ): boolean {
    // Check minimum score
    if (scoring.totalScore < strategy.min_score) {
      return false;
    }

    // Check allowed launchpads
    if (!strategy.allowed_launchpads.includes(opportunity.source)) {
      return false;
    }

    // Check minimum liquidity
    if (
      opportunity.initial_liquidity_sol &&
      opportunity.initial_liquidity_sol < strategy.min_liquidity_sol
    ) {
      return false;
    }

    // Check token denylist
    if (strategy.token_denylist.includes(opportunity.token_mint)) {
      return false;
    }

    // Check deployer denylist
    if (
      opportunity.deployer &&
      strategy.deployer_denylist.includes(opportunity.deployer)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Create a buy trade job for a strategy
   */
  private async createBuyJob(
    opportunity: OpportunityV31,
    strategy: Strategy
  ): Promise<void> {
    const idempotencyKey = idKeyAutoBuy({
      chain: 'sol',
      mint: opportunity.token_mint,
      strategyId: strategy.id,
      opportunityId: opportunity.id,
      amountSol: strategy.max_per_trade_sol,
      slippageBps: strategy.slippage_bps,
    });

    try {
      await createTradeJob({
        strategyId: strategy.id,
        userId: strategy.user_id,
        opportunityId: opportunity.id,
        chain: 'sol',
        action: 'BUY',
        idempotencyKey,
        payload: {
          mint: opportunity.token_mint,
          amount_sol: strategy.max_per_trade_sol,
          slippage_bps: strategy.slippage_bps,
          priority_fee_lamports: strategy.priority_fee_lamports,
        },
        priority: 100, // Normal priority for buys
      });

      console.log(
        `[OpportunityLoop] Created job for strategy ${strategy.name} (user ${strategy.user_id})`
      );
    } catch (error) {
      // Duplicate key error means job already exists - that's fine
      if ((error as Error).message?.includes('duplicate')) {
        console.log(
          `[OpportunityLoop] Job already exists for strategy ${strategy.name}`
        );
      } else {
        throw error;
      }
    }
  }
}
