// =============================================================================
// RAPTOR v3.1 Opportunity Loop
// Monitors launchpads and creates qualified opportunities
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

      // 2. Score the opportunity
      const scoring = await scoreOpportunity(opportunity, event);

      // 3. Update opportunity with score
      await upsertOpportunity({
        chain: 'sol',
        source: 'pump.fun',
        tokenMint: event.mint,
        score: scoring.totalScore,
        reasons: scoring.reasons,
      });

      // 4. Check qualification
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

      // 5. Find matching strategies
      const strategies = await getEnabledAutoStrategies('sol');
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

      // 6. Mark as executing and create trade jobs
      await updateOpportunityStatus(opportunity.id, 'EXECUTING');

      for (const strategy of matchingStrategies) {
        await this.createBuyJob(opportunity, strategy);
      }

      console.log(
        `[OpportunityLoop] Created ${matchingStrategies.length} jobs for: ${event.symbol}`
      );
    } catch (error) {
      console.error('[OpportunityLoop] Error handling token:', error);
    }
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
