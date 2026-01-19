// =============================================================================
// RAPTOR v3.1 Execution Loop
// Job queue consumer: claims jobs, reserves budget, executes trades
// =============================================================================

import {
  claimTradeJobs,
  markJobRunning,
  extendLease,
  finalizeJob,
  reserveTradeBudget,
  updateExecution,
  createPositionV31,
  closePositionV31,
  createNotification,
  setCooldown,
  getStrategy,
  isTradingPaused,
  isCircuitOpen,
  getActiveWallet,
  getPositionByUuid,
  loadSolanaKeypair,
  applySellFeeDecimal,
  getTokenInfo,  // For fetching market cap at buy time
  // TP/SL state machine functions (Phase B audit fix)
  markPositionExecuting,
  markTriggerCompleted,
  markTriggerFailed,
  getOpportunityById,
  type TradeJob,
  type Strategy,
  type EncryptedData,
  type ExitTrigger,
  getJobClaimLimit,
  getJobLeaseDuration,
} from '@raptor/shared';
import { isRetryableError, parseError } from '@raptor/shared';

// Import the executor library
import { solanaExecutor } from '@raptor/executor';
import type { Keypair } from '@solana/web3.js';

const POLL_INTERVAL_MS = 1000;
const MAX_JOB_AGE_SECONDS = 60; // Skip jobs older than 60 seconds (token launch window expired)

export class ExecutionLoop {
  private running = false;
  private workerId: string;
  private autoExecuteEnabled: boolean;

  constructor(workerId: string, autoExecuteEnabled: boolean) {
    this.workerId = workerId;
    this.autoExecuteEnabled = autoExecuteEnabled;
  }

  async start(): Promise<void> {
    console.log('[ExecutionLoop] Starting...');
    this.running = true;
    this.poll();
  }

  async stop(): Promise<void> {
    console.log('[ExecutionLoop] Stopping...');
    this.running = false;
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        // Skip if auto-execute is disabled
        if (!this.autoExecuteEnabled) {
          await this.sleep(POLL_INTERVAL_MS * 5);
          continue;
        }

        // Check global safety controls
        const paused = await isTradingPaused();
        if (paused) {
          console.log('[ExecutionLoop] Trading is paused globally');
          await this.sleep(5000);
          continue;
        }

        const circuitOpen = await isCircuitOpen();
        if (circuitOpen) {
          console.log('[ExecutionLoop] Circuit breaker is open');
          await this.sleep(5000);
          continue;
        }

        // Claim jobs
        const jobs = await claimTradeJobs(
          this.workerId,
          getJobClaimLimit(),
          getJobLeaseDuration(),
          'sol'
        );

        if (jobs.length > 0) {
          console.log(`[ExecutionLoop] Claimed ${jobs.length} jobs`);
        }

        // Process jobs in parallel
        await Promise.all(jobs.map((job) => this.processJob(job)));
      } catch (error) {
        console.error('[ExecutionLoop] Poll error:', error);
      }

      await this.sleep(POLL_INTERVAL_MS);
    }
  }

  /**
   * Process a single trade job
   */
  private async processJob(job: TradeJob): Promise<void> {
    console.log(`[ExecutionLoop] Processing job ${job.id} (${job.action})`);

    // Check job staleness - skip jobs that are too old (token launch window expired)
    const jobAgeSeconds = (Date.now() - new Date(job.created_at).getTime()) / 1000;
    if (jobAgeSeconds > MAX_JOB_AGE_SECONDS) {
      console.log(`[ExecutionLoop] Skipping stale job ${job.id} (age: ${Math.round(jobAgeSeconds)}s > ${MAX_JOB_AGE_SECONDS}s)`);
      // Finalize as CANCELED (not FAILED) to avoid tripping circuit breaker
      await finalizeJob({
        jobId: job.id,
        workerId: this.workerId,
        status: 'CANCELED',
        retryable: false,
        error: `Job expired (${Math.round(jobAgeSeconds)}s old - token launch window closed)`,
      });
      return;
    }

    // Track lease validity
    let leaseValid = true;

    // Start heartbeat
    const heartbeat = setInterval(async () => {
      try {
        const extended = await extendLease(job.id, this.workerId);
        if (!extended) {
          console.warn(`[ExecutionLoop] Lost lease for job ${job.id} - another worker may have claimed it`);
          leaseValid = false;
        }
      } catch (err) {
        console.warn(`[ExecutionLoop] Heartbeat failed for job ${job.id}:`, err);
        leaseValid = false;
      }
    }, 10000);

    try {
      // 1. Mark job as running (increments attempts)
      const running = await markJobRunning(job.id, this.workerId);
      if (!running) {
        console.warn(`[ExecutionLoop] Failed to mark job running: ${job.id}`);
        return;
      }

      // 2. Get strategy for this job
      const strategy = await getStrategy(job.strategy_id);
      if (!strategy) {
        await this.failJob(job, 'Strategy not found', false);
        return;
      }

      // 3. Reserve budget atomically
      const reservation = await reserveTradeBudget({
        mode: 'AUTO',
        userId: job.user_id,
        strategyId: job.strategy_id,
        chain: job.chain,
        action: job.action,
        tokenMint: job.payload.mint,
        amountSol: job.payload.amount_sol || 0,
        idempotencyKey: job.idempotency_key,
        allowRetry: job.attempts > 0,
      });

      if (!reservation.allowed) {
        console.log(
          `[ExecutionLoop] Budget rejected: ${reservation.reason}`
        );
        await this.failJob(job, reservation.reason || 'Budget rejected', false);
        return;
      }

      const executionId = reservation.reservation_id!;
      console.log(`[ExecutionLoop] Reserved budget: ${executionId}`);

      // CRITICAL: Verify we still have the lease before executing trade
      if (!leaseValid) {
        console.error(`[ExecutionLoop] Aborting job ${job.id} - lease lost before trade execution`);
        await this.failJob(job, 'Lease lost - another worker claimed job', false);
        return;
      }

      // 4a. For SELL actions: Mark position as EXECUTING before trade
      // This is part of the TP/SL state machine (Phase B audit fix)
      if (job.action === 'SELL' && job.payload.position_id) {
        await markPositionExecuting(job.payload.position_id);
      }

      // 4. Execute the trade
      let result;
      if (job.action === 'BUY') {
        result = await this.executeBuy(job, strategy);
      } else {
        result = await this.executeSell(job, strategy);
      }

      // 5. Update execution record
      await updateExecution({
        executionId,
        status: result.success ? 'CONFIRMED' : 'FAILED',
        txSig: result.txSig,
        tokensOut: result.tokensReceived,
        pricePerToken: result.price,
        error: result.error,
        errorCode: result.errorCode,
        result: result as unknown as Record<string, unknown>,
      });

      if (result.success) {
        // Get opportunity data for position creation and notifications (BUY only)
        const opportunity = job.action === 'BUY' && job.opportunity_id
          ? await getOpportunityById(job.opportunity_id)
          : null;

        // 6. Create/close position
        if (job.action === 'BUY') {
          // Pump.fun tokens have 6 decimals - store adjusted amount for correct PnL calculation
          const PUMP_FUN_DECIMALS = 6;
          const adjustedSizeTokens = (result.tokensReceived || 0) / Math.pow(10, PUMP_FUN_DECIMALS);
          const entryCostSol = result.amountIn || job.payload.amount_sol || 0;
          // FIX: Calculate entry price from adjusted values (price = cost / tokens)
          // result.price is calculated with RAW tokens, but we store ADJUSTED tokens
          const entryPrice = adjustedSizeTokens > 0 ? entryCostSol / adjustedSizeTokens : 0;

          await createPositionV31({
            userId: job.user_id,
            strategyId: job.strategy_id,
            opportunityId: job.opportunity_id || undefined,
            chain: job.chain,
            tokenMint: job.payload.mint,
            tokenSymbol: opportunity?.token_symbol || undefined,  // FIX: Pass symbol for position display
            entryExecutionId: executionId,
            entryTxSig: result.txSig,
            entryCostSol,
            entryPrice,  // FIX: Use recalculated price that's consistent with adjusted tokens
            sizeTokens: adjustedSizeTokens,  // FIX: Store decimal-adjusted tokens for correct PnL with DEXScreener prices
            // TP/SL engine fields (Phase B audit fix)
            tpPercent: strategy.take_profit_percent,
            slPercent: strategy.stop_loss_percent,
            bondingCurve: opportunity?.bonding_curve || undefined,
          });
        } else if (job.payload.position_id) {
          await closePositionV31({
            positionId: job.payload.position_id,
            exitExecutionId: executionId,
            exitTxSig: result.txSig,
            exitPrice: result.price || 0,
            exitTrigger: job.payload.trigger || 'EMERGENCY',
            realizedPnlSol: result.pnlSol || 0,
            realizedPnlPercent: result.pnlPercent || 0,
          });
          // TP/SL state machine: Mark trigger as completed (Phase B audit fix)
          await markTriggerCompleted(job.payload.position_id);
        }

        // 7. Set cooldown
        await setCooldown({
          chain: job.chain,
          cooldownType: 'MINT',
          target: job.payload.mint,
          durationSeconds: strategy.cooldown_seconds,
          reason: 'Auto trade',
        });

        // 8. Create notification
        // BUY: TRADE_DONE notification
        // SELL: TP/SL-specific notification with real solReceived and txHash
        if (job.action === 'BUY') {
          // Fetch current token info for market cap at entry time
          let marketCapSol: number | undefined;
          try {
            const tokenInfo = await getTokenInfo(job.payload.mint);
            if (tokenInfo) {
              marketCapSol = tokenInfo.marketCapSol;
            }
          } catch (err) {
            console.log(`[ExecutionLoop] Could not fetch market cap: ${parseError(err)}`);
          }

          // Pump.fun tokens have 6 decimals - adjust raw amount for display
          const PUMP_FUN_DECIMALS = 6;
          const adjustedTokens = (result.tokensReceived || 0) / Math.pow(10, PUMP_FUN_DECIMALS);

          await createNotification({
            userId: job.user_id,
            type: 'TRADE_DONE',
            payload: {
              action: job.action,
              mint: job.payload.mint,
              tokenSymbol: opportunity?.token_symbol || undefined,  // FIX: Include symbol for display
              amount_sol: job.payload.amount_sol,
              tokens: adjustedTokens,  // FIX: Decimal-adjusted for human-readable display
              tx_sig: result.txSig,
              marketCapSol,  // Market cap in SOL at entry time
            },
          });
        } else if (job.action === 'SELL' && job.payload.trigger) {
          // TP/SL exit: Create notification with real data
          const notificationType = this.triggerToNotificationType(
            job.payload.trigger as ExitTrigger
          );
          await createNotification({
            userId: job.user_id,
            type: notificationType,
            payload: {
              positionId: job.payload.position_id,
              tokenSymbol: result.tokenSymbol ?? job.payload.mint, // Prefer actual symbol
              mint: job.payload.mint,  // FIX: Include mint for chart button
              trigger: job.payload.trigger,
              triggerPrice: job.payload.trigger_price,
              pnlPercent: result.pnlPercent || 0,
              solReceived: result.tokensReceived || 0, // This is SOL received for SELL
              txHash: result.txSig || '',
            },
          });
        }

        // 9. Finalize job as DONE
        await finalizeJob({
          jobId: job.id,
          workerId: this.workerId,
          status: 'DONE',
          retryable: false,
        });

        console.log(`[ExecutionLoop] Job completed: ${result.txSig}`);
      } else {
        // Handle failure
        const retryable = isRetryableError(result.errorCode);

        // TP/SL state machine: Mark trigger as failed for SELL jobs (Phase B audit fix)
        if (job.action === 'SELL' && job.payload.position_id) {
          await markTriggerFailed(job.payload.position_id, result.error);
        }

        await createNotification({
          userId: job.user_id,
          type: 'TRADE_FAILED',
          payload: {
            action: job.action,
            mint: job.payload.mint,
            error: result.error,
            retrying: retryable,
          },
        });

        await finalizeJob({
          jobId: job.id,
          workerId: this.workerId,
          status: 'FAILED',
          retryable,
          error: result.error,
        });

        console.warn(`[ExecutionLoop] Job failed: ${result.error} (retryable: ${retryable})`);
      }
    } catch (error) {
      const { code, message } = parseError(error);
      console.error(`[ExecutionLoop] Job error: ${message}`);

      if (job.action === 'SELL' && job.payload.position_id) {
        await markTriggerFailed(job.payload.position_id, message);
      }

      await finalizeJob({
        jobId: job.id,
        workerId: this.workerId,
        status: 'FAILED',
        retryable: isRetryableError(code),
        error: message,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Get user's keypair for trading
   */
  private async getUserKeypair(userId: number, chain: string): Promise<Keypair | null> {
    try {
      const wallet = await getActiveWallet(userId, chain as 'sol');
      if (!wallet) {
        console.warn(`[ExecutionLoop] No active wallet for user ${userId}`);
        return null;
      }

      // Get the encrypted private key
      const encryptedKey = wallet.solana_private_key_encrypted as EncryptedData;
      if (!encryptedKey) {
        console.warn(`[ExecutionLoop] No encrypted key for user ${userId}`);
        return null;
      }

      return loadSolanaKeypair(encryptedKey, userId);
    } catch (error) {
      console.error(`[ExecutionLoop] Failed to load keypair:`, error);
      return null;
    }
  }

  /**
   * Execute a buy trade
   */
  private async executeBuy(
    job: TradeJob,
    strategy: Strategy
  ): Promise<TradeResult> {
    try {
      // Get user's keypair
      const keypair = await this.getUserKeypair(job.user_id, job.chain);
      if (!keypair) {
        return {
          success: false,
          error: 'No active wallet found for user',
          errorCode: 'NO_WALLET',
        };
      }

      const amountSol = job.payload.amount_sol || strategy.max_per_trade_sol;
      const slippageBps = job.payload.slippage_bps || strategy.slippage_bps;

      // Pass tgId to executor so it can fetch chain_settings for:
      // - priority_sol (validator tip)
      // - anti_mev_enabled (Jito bundles)
      const result = await solanaExecutor.executeBuyWithKeypair(
        job.payload.mint,
        amountSol,
        keypair,
        { slippageBps, tgId: job.user_id }
      );

      return {
        success: result.success,
        txSig: result.txHash,
        tokensReceived: result.amountOut,
        amountIn: result.amountIn,  // Actual SOL spent (after fees)
        price: result.price,
        error: result.error,
      };
    } catch (error) {
      const { code, message } = parseError(error);
      return {
        success: false,
        error: message,
        errorCode: code,
      };
    }
  }

  /**
   * Execute a sell trade
   */
  private async executeSell(
    job: TradeJob,
    strategy: Strategy
  ): Promise<TradeResult> {
    try {
      // Get user's keypair
      const keypair = await this.getUserKeypair(job.user_id, job.chain);
      if (!keypair) {
        return {
          success: false,
          error: 'No active wallet found for user',
          errorCode: 'NO_WALLET',
        };
      }

      // Get position to know how many tokens to sell
      if (!job.payload.position_id) {
        return {
          success: false,
          error: 'No position_id in sell job payload',
          errorCode: 'INVALID_PAYLOAD',
        };
      }

      // Use getPositionByUuid since position_id is now uuid_id
      const position = await getPositionByUuid(job.payload.position_id);
      if (!position) {
        return {
          success: false,
          error: 'Position not found',
          errorCode: 'POSITION_NOT_FOUND',
        };
      }

      const sellPercent = job.payload.sell_percent || 100;
      const tokensToSell = position.size_tokens * (sellPercent / 100);
      const slippageBps = job.payload.slippage_bps || strategy.slippage_bps;

      // Pass tgId to executor so it can fetch chain_settings for:
      // - priority_sol (validator tip)
      // - anti_mev_enabled (Jito bundles)
      const result = await solanaExecutor.executeSellWithKeypair(
        job.payload.mint,
        tokensToSell,
        keypair,
        { slippageBps, tgId: job.user_id }
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          errorCode: parseError(result.error).code,
        };
      }

      // Calculate P&L
      const grossSol = result.amountOut;
      const { netAmount } = applySellFeeDecimal(grossSol);
      const proportionalEntryCost = (position.entry_cost_sol * sellPercent) / 100;
      const pnlSol = netAmount - proportionalEntryCost;
      const pnlPercent = proportionalEntryCost > 0
        ? ((netAmount - proportionalEntryCost) / proportionalEntryCost) * 100
        : 0;

      return {
        success: true,
        txSig: result.txHash,
        tokensReceived: grossSol, // SOL received
        price: result.price,
        pnlSol,
        pnlPercent,
        tokenSymbol: position.token_symbol || job.payload.mint,
      };
    } catch (error) {
      const { code, message } = parseError(error);
      return {
        success: false,
        error: message,
        errorCode: code,
      };
    }
  }

  /**
   * Helper to fail a job
   */
  private async failJob(
    job: TradeJob,
    error: string,
    retryable: boolean
  ): Promise<void> {
    await finalizeJob({
      jobId: job.id,
      workerId: this.workerId,
      status: 'FAILED',
      retryable,
      error,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Map exit trigger to notification type
   */
  private triggerToNotificationType(
    trigger: ExitTrigger
  ): 'TP_HIT' | 'SL_HIT' | 'TRAILING_STOP_HIT' | 'POSITION_CLOSED' {
    switch (trigger) {
      case 'TP':
        return 'TP_HIT';
      case 'SL':
        return 'SL_HIT';
      case 'TRAIL':
        return 'TRAILING_STOP_HIT';
      case 'MAXHOLD':
      case 'EMERGENCY':
      case 'MANUAL':
      default:
        return 'POSITION_CLOSED';
    }
  }
}

interface TradeResult {
  success: boolean;
  txSig?: string;
  tokensReceived?: number;
  amountIn?: number;  // Actual SOL spent (for BUY) or tokens sold (for SELL)
  price?: number;
  pnlSol?: number;
  pnlPercent?: number;
  tokenSymbol?: string;
  error?: string;
  errorCode?: string;
}
