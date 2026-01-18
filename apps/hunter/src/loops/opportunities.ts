// =============================================================================
// RAPTOR v4.3 Opportunity Loop
// Monitors launchpads and creates qualified opportunities with snipe modes
// =============================================================================

import {
  upsertOpportunity,
  updateOpportunityStatus,
  getEnabledAutoStrategies,
  createTradeJob,
  getGlobalSafetyControls,
  idKeyAutoBuy,
  type Strategy,
  type OpportunityV31,
} from '@raptor/shared';
import { PumpFunMonitor, type PumpFunEvent } from '../monitors/pumpfun.js';
import { scoreOpportunity, type ScoringResult } from '../scoring/scorer.js';
import { fetchMetadata, type TokenMetadata } from '../utils/metadataFetcher.js';

// Snipe mode timeout configurations (ms)
const SNIPE_MODE_TIMEOUTS: Record<string, number> = {
  speed: 300,    // Fast metadata check
  quality: 2000, // Full metadata scoring
};

// Default snipe mode if not specified
const DEFAULT_SNIPE_MODE = 'quality';

type SnipeMode = 'speed' | 'quality';

interface ModeResult {
  mode: SnipeMode;
  scoring: ScoringResult;
  matchingCount: number;
  jobsCreated: number;
}

export class OpportunityLoop {
  private running = false;
  private pumpFunMonitor: PumpFunMonitor;
  private autoExecuteEnabled: boolean;

  constructor(autoExecuteEnabled: boolean) {
    this.pumpFunMonitor = new PumpFunMonitor();
    this.autoExecuteEnabled = autoExecuteEnabled;
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

    // Skip mayhem mode tokens (low quality launches per November 2025 pump.fun update)
    if (event.isMayhemMode) {
      console.log(
        `[OpportunityLoop] Skipping mayhem mode token: ${event.symbol} (${event.mint.slice(0, 8)}...)`
      );
      return;
    }

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

      // 2. Get all enabled AUTO strategies
      const strategies = await getEnabledAutoStrategies('sol');

      if (strategies.length === 0) {
        console.log(`[OpportunityLoop] No enabled strategies, skipping: ${event.symbol}`);
        return;
      }

      const autoExecuteAllowed = await this.isAutoExecuteAllowed();
      const canonicalMode = this.getMostThoroughSnipeMode(strategies);

      // If auto-execute is disabled, score once and exit without creating jobs
      if (!autoExecuteAllowed) {
        const { scoring } = await this.scoreWithMode(opportunity, event, canonicalMode);
        await this.updateOpportunityScore(opportunity, scoring);

        if (!scoring.qualified) {
          const reason = this.getRejectionReason(scoring);
          await updateOpportunityStatus(opportunity.id, 'REJECTED', reason);
          console.log(
            `[OpportunityLoop] Rejected: ${event.symbol} (${reason})`
          );
          return;
        }

        await updateOpportunityStatus(
          opportunity.id,
          'QUALIFIED',
          'Auto-execute disabled'
        );
        console.log(`[OpportunityLoop] Qualified (auto-execute disabled): ${event.symbol}`);
        return;
      }

      // 3. Group strategies by snipe mode (speed vs quality)
      const strategiesByMode = this.groupStrategiesByMode(strategies);

      let jobsCreated = 0;
      let matchingStrategies = 0;
      let executingPromise: Promise<void> | null = null;

      const ensureExecuting = async () => {
        if (!executingPromise) {
          executingPromise = updateOpportunityStatus(opportunity.id, 'EXECUTING');
        }
        await executingPromise;
      };

      // 4. Score per mode, match strategies, and create jobs
      const modeResults = await Promise.all(
        Array.from(strategiesByMode.entries()).map(async ([mode, modeStrategies]) => {
          const { scoring } = await this.scoreWithMode(opportunity, event, mode);
          const matching = scoring.qualified
            ? modeStrategies.filter((s) =>
                this.strategyMatchesOpportunity(s, opportunity, scoring)
              )
            : [];

          const result: ModeResult = {
            mode,
            scoring,
            matchingCount: matching.length,
            jobsCreated: 0,
          };

          if (matching.length === 0) {
            return result;
          }

          await ensureExecuting();

          for (const strategy of matching) {
            try {
              await this.createBuyJob(opportunity, strategy);
              result.jobsCreated += 1;
            } catch (error) {
              console.error(
                `[OpportunityLoop] Failed to create job for strategy ${strategy.id}:`,
                error
              );
            }
          }

          return result;
        })
      );

      const canonicalResult = this.pickCanonicalResult(modeResults);
      if (canonicalResult) {
        await this.updateOpportunityScore(opportunity, canonicalResult.scoring);
      }

      for (const result of modeResults) {
        matchingStrategies += result.matchingCount;
        jobsCreated += result.jobsCreated;
      }

      if (matchingStrategies === 0) {
        const scoring = canonicalResult?.scoring;
        if (scoring && !scoring.qualified) {
          const reason = this.getRejectionReason(scoring);
          await updateOpportunityStatus(opportunity.id, 'REJECTED', reason);
          console.log(
            `[OpportunityLoop] Rejected: ${event.symbol} (${reason})`
          );
        } else {
          await updateOpportunityStatus(
            opportunity.id,
            'QUALIFIED',
            'No matching strategies'
          );
          console.log(
            `[OpportunityLoop] Qualified but no matching strategies: ${event.symbol}`
          );
        }
        return;
      }

      if (jobsCreated === 0) {
        await updateOpportunityStatus(
          opportunity.id,
          'REJECTED',
          'Failed to create any trade jobs'
        );
        console.warn(
          `[OpportunityLoop] Failed to create any jobs for: ${event.symbol}`
        );
        return;
      }

      await updateOpportunityStatus(
        opportunity.id,
        'EXECUTING',
        `Created ${jobsCreated}/${matchingStrategies} trade jobs`
      );
      console.log(
        `[OpportunityLoop] Created ${jobsCreated} jobs for: ${event.symbol}`
      );
    } catch (error) {
      console.error('[OpportunityLoop] Error handling token:', error);
    }
  }

  /**
   * Get the most thorough snipe mode from all strategies
   * v4.3: quality > speed to ensure quality users get metadata
   * NOTE: balanced is normalized to quality to reduce modes.
   */
  private getMostThoroughSnipeMode(strategies: Strategy[]): SnipeMode {
    const modes = strategies.map((s) => this.normalizeSnipeMode(s.snipe_mode));
    const speedCount = modes.filter((m) => m === 'speed').length;
    const qualityCount = modes.filter((m) => m === 'quality').length;

    if (qualityCount > 0) {
      console.log(`[OpportunityLoop] Snipe modes: ${speedCount} speed, ${qualityCount} quality -> using quality`);
      return 'quality';
    }
    console.log(`[OpportunityLoop] Snipe modes: ${speedCount} speed -> using speed`);
    return 'speed';
  }

  private normalizeSnipeMode(mode?: Strategy['snipe_mode'] | null): SnipeMode {
    if (mode === 'speed') {
      return 'speed';
    }
    return DEFAULT_SNIPE_MODE as SnipeMode;
  }

  private groupStrategiesByMode(strategies: Strategy[]): Map<SnipeMode, Strategy[]> {
    const grouped = new Map<SnipeMode, Strategy[]>();

    for (const strategy of strategies) {
      const mode = this.normalizeSnipeMode(strategy.snipe_mode);
      const list = grouped.get(mode) || [];
      list.push(strategy);
      grouped.set(mode, list);
    }

    const speedCount = grouped.get('speed')?.length ?? 0;
    const qualityCount = grouped.get('quality')?.length ?? 0;
    console.log(`[OpportunityLoop] Snipe modes: ${speedCount} speed, ${qualityCount} quality`);

    return grouped;
  }

  private getModeTimeout(mode: SnipeMode): number {
    return SNIPE_MODE_TIMEOUTS[mode] || SNIPE_MODE_TIMEOUTS[DEFAULT_SNIPE_MODE as SnipeMode];
  }

  private async fetchMetadataForMode(
    event: PumpFunEvent,
    mode: SnipeMode
  ): Promise<TokenMetadata | null> {
    const timeoutMs = this.getModeTimeout(mode);
    if (timeoutMs <= 0 || !event.uri) {
      return null;
    }

    const fetchStart = Date.now();
    const metadata = await fetchMetadata(event.uri, timeoutMs);
    const fetchTime = Date.now() - fetchStart;

    if (metadata) {
      console.log(
        `[OpportunityLoop] [${mode}] Metadata fetched in ${fetchTime}ms: ` +
          `twitter=${Boolean(metadata.twitter)}, tg=${Boolean(metadata.telegram)}, ` +
          `web=${Boolean(metadata.website)}, img=${Boolean(metadata.image)}`
      );
    } else {
      console.log(
        `[OpportunityLoop] [${mode}] Metadata fetch ${timeoutMs > fetchTime ? 'failed' : 'timed out'} (${fetchTime}ms)`
      );
    }

    return metadata;
  }

  private async scoreWithMode(
    opportunity: OpportunityV31,
    event: PumpFunEvent,
    mode: SnipeMode
  ): Promise<{ scoring: ScoringResult; metadata: TokenMetadata | null }> {
    const metadata = await this.fetchMetadataForMode(event, mode);
    const scoring = await scoreOpportunity(opportunity, event, metadata);
    return { scoring, metadata };
  }

  private async updateOpportunityScore(
    opportunity: OpportunityV31,
    scoring: ScoringResult
  ): Promise<void> {
    await upsertOpportunity({
      chain: opportunity.chain,
      source: opportunity.source,
      tokenMint: opportunity.token_mint,
      score: scoring.totalScore,
      reasons: scoring.reasons,
    });
  }

  private getRejectionReason(scoring: ScoringResult): string {
    if (scoring.hardStopTriggered) {
      return `Hard stop: ${scoring.hardStopReason || 'unknown'}`;
    }
    return `Score ${scoring.totalScore} below minimum`;
  }

  private pickCanonicalResult(results: ModeResult[]): ModeResult | null {
    if (results.length === 0) {
      return null;
    }

    const priority: Record<SnipeMode, number> = {
      quality: 2,
      speed: 1,
    };

    return results.reduce((best, current) =>
      priority[current.mode] > priority[best.mode] ? current : best
    );
  }

  private async isAutoExecuteAllowed(): Promise<boolean> {
    if (!this.autoExecuteEnabled) {
      return false;
    }

    try {
      const controls = await getGlobalSafetyControls();
      if (controls && controls.auto_execute_enabled === false) {
        return false;
      }
    } catch (error) {
      console.error('[OpportunityLoop] Failed to load safety controls:', error);
    }

    return true;
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

    // Check token allowlist (if set)
    if (
      strategy.token_allowlist.length > 0 &&
      !strategy.token_allowlist.includes(opportunity.token_mint)
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
