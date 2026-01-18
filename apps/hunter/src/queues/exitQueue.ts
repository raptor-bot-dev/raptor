// =============================================================================
// RAPTOR TP/SL Engine - Exit Queue
// Priority queue with backpressure for exit job execution
// =============================================================================

import { EventEmitter } from 'events';
import {
  createTradeJob,
  getStrategy,
  getPositionById,
  createNotification,
  type ExitJob,
  type ExitTrigger,
  EXIT_PRIORITY,
  getTpSlConfig,
} from '@raptor/shared';

/**
 * Exit queue result
 */
export interface ExitQueueResult {
  success: boolean;
  reason?: string;
}

/**
 * Exit job status tracking
 */
interface QueuedJob {
  job: ExitJob;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * ExitQueue - Priority queue for TP/SL exit execution
 *
 * Key features:
 * - Priority sorting (SL > TP > TRAIL > MAXHOLD)
 * - Deduplication via idempotency key
 * - Backpressure with configurable max concurrent
 * - Event-based completion notification
 *
 * Usage:
 *   const queue = new ExitQueue();
 *   queue.start();
 *   queue.enqueue(exitJob);
 *   queue.on('completed', (job, result) => { ... });
 */
export class ExitQueue extends EventEmitter {
  private queue: QueuedJob[] = [];
  private processing: Map<string, QueuedJob> = new Map(); // idempotencyKey -> job
  private completed: Set<string> = new Set(); // idempotencyKey for dedup
  private maxConcurrent: number;
  private running = false;
  private processTimer: NodeJS.Timeout | null = null;
  private readonly PROCESS_INTERVAL_MS = 100;

  constructor(maxConcurrent?: number) {
    super();
    const config = getTpSlConfig();
    this.maxConcurrent = maxConcurrent ?? config.maxConcurrentExits;
  }

  /**
   * Start the queue processor
   */
  start(): void {
    if (this.running) return;
    console.log(`[ExitQueue] Starting with maxConcurrent=${this.maxConcurrent}`);
    this.running = true;
    this.scheduleProcess();
  }

  /**
   * Stop the queue processor
   * @param waitForDrain - Wait for all processing jobs to complete
   */
  async stop(waitForDrain = true): Promise<void> {
    console.log('[ExitQueue] Stopping...');
    this.running = false;

    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }

    if (waitForDrain && this.processing.size > 0) {
      console.log(`[ExitQueue] Waiting for ${this.processing.size} jobs to complete...`);
      await this.waitForDrain();
    }
  }

  /**
   * Enqueue an exit job
   * Returns false if job already exists (dedupe)
   *
   * @param job - Exit job to enqueue
   * @returns Result indicating if job was queued
   */
  enqueue(job: ExitJob): ExitQueueResult {
    // Check for duplicate
    if (this.completed.has(job.idempotencyKey)) {
      return { success: false, reason: 'Already completed' };
    }

    if (this.processing.has(job.idempotencyKey)) {
      return { success: false, reason: 'Already processing' };
    }

    const existingQueued = this.queue.find(
      (q) => q.job.idempotencyKey === job.idempotencyKey
    );
    if (existingQueued) {
      return { success: false, reason: 'Already queued' };
    }

    // Create queued job
    const queuedJob: QueuedJob = {
      job,
      status: 'queued',
    };

    // Insert in priority order (lower priority number = higher priority)
    const insertIndex = this.queue.findIndex(
      (q) => q.job.priority > job.priority
    );

    if (insertIndex === -1) {
      this.queue.push(queuedJob);
    } else {
      this.queue.splice(insertIndex, 0, queuedJob);
    }

    console.log(
      `[ExitQueue] Enqueued ${job.trigger} exit for position ${job.positionId.slice(0, 8)}... ` +
        `(priority: ${job.priority}, queue size: ${this.queue.length})`
    );

    this.emit('enqueued', job);
    return { success: true };
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queued: number;
    processing: number;
    completed: number;
    maxConcurrent: number;
  } {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Check if queue has capacity for more processing
   */
  hasCapacity(): boolean {
    return this.processing.size < this.maxConcurrent;
  }

  /**
   * Schedule queue processing
   */
  private scheduleProcess(): void {
    if (!this.running) return;

    this.processTimer = setTimeout(() => {
      this.processQueue().then(() => {
        this.scheduleProcess();
      });
    }, this.PROCESS_INTERVAL_MS);
  }

  /**
   * Process queued jobs up to capacity
   */
  private async processQueue(): Promise<void> {
    // Start new jobs if we have capacity
    while (this.hasCapacity() && this.queue.length > 0) {
      const queuedJob = this.queue.shift()!;
      this.processJob(queuedJob);
    }
  }

  /**
   * Process a single exit job
   * Runs in background - doesn't block queue processing
   */
  private async processJob(queuedJob: QueuedJob): Promise<void> {
    const { job } = queuedJob;

    // Mark as processing
    queuedJob.status = 'processing';
    queuedJob.startedAt = new Date();
    this.processing.set(job.idempotencyKey, queuedJob);

    console.log(
      `[ExitQueue] Processing ${job.trigger} exit for position ${job.positionId.slice(0, 8)}... ` +
        `(processing: ${this.processing.size}/${this.maxConcurrent})`
    );

    try {
      // Get position and strategy for trade job creation
      const position = await getPositionById(job.positionId);
      if (!position) {
        throw new Error(`Position not found: ${job.positionId}`);
      }

      const strategy = await getStrategy(position.strategy_id);
      if (!strategy) {
        throw new Error(`Strategy not found: ${position.strategy_id}`);
      }

      // Calculate sell percent (leave moon bag if TP)
      let sellPercent = job.sellPercent;
      if (job.trigger === 'TP' && strategy.moon_bag_percent > 0) {
        sellPercent = Math.min(sellPercent, 100 - strategy.moon_bag_percent);
      }

      // Create trade job for ExecutionLoop
      await createTradeJob({
        strategyId: position.strategy_id,
        userId: job.userId,
        chain: position.chain,
        action: 'SELL',
        idempotencyKey: job.idempotencyKey,
        payload: {
          mint: job.tokenMint,
          position_id: job.positionId,
          sell_percent: sellPercent,
          slippage_bps: job.slippageBps,
          priority_fee_lamports: strategy.priority_fee_lamports,
          trigger: job.trigger,
          trigger_price: job.triggerPrice,
        },
        priority: job.priority,
      });

      // Create notification with payload that matches formatter expectations
      // FIX: Use tokenSymbol, pnlPercent, solReceived, txHash keys
      const pnlPercent = position.entry_price > 0
        ? ((job.triggerPrice - position.entry_price) / position.entry_price) * 100
        : 0;

      await createNotification({
        userId: job.userId,
        type: this.triggerToNotificationType(job.trigger),
        payload: {
          positionId: job.positionId,
          tokenSymbol: position.token_symbol || 'Unknown',
          trigger: job.trigger,
          triggerPrice: job.triggerPrice,
          pnlPercent: pnlPercent,
          // These will be updated by execution loop after sell completes
          solReceived: 0,
          txHash: '',
        },
      });

      // Mark completed
      queuedJob.status = 'completed';
      queuedJob.completedAt = new Date();

      console.log(
        `[ExitQueue] Trade job created for ${job.trigger} exit: ${job.positionId.slice(0, 8)}...`
      );

      this.emit('completed', job, { success: true });
    } catch (error) {
      // Handle duplicate key - job already exists in trade_jobs
      if ((error as Error).message?.includes('duplicate')) {
        queuedJob.status = 'completed';
        queuedJob.completedAt = new Date();
        console.log(
          `[ExitQueue] Trade job already exists for ${job.positionId.slice(0, 8)}... (dedupe)`
        );
        this.emit('completed', job, { success: true, dedupe: true });
      } else {
        queuedJob.status = 'failed';
        queuedJob.error = (error as Error).message;
        queuedJob.completedAt = new Date();
        console.error(
          `[ExitQueue] Failed to create trade job for ${job.positionId.slice(0, 8)}...:`,
          (error as Error).message
        );
        this.emit('failed', job, error);
      }
    } finally {
      // Clean up
      this.processing.delete(job.idempotencyKey);
      this.completed.add(job.idempotencyKey);
    }
  }

  /**
   * Map trigger to notification type
   * FIX: Use correct NotificationType values that formatter expects
   */
  private triggerToNotificationType(
    trigger: ExitTrigger
  ): 'TP_HIT' | 'SL_HIT' | 'TRAILING_STOP_HIT' | 'POSITION_CLOSED' | 'TRADE_DONE' {
    switch (trigger) {
      case 'TP':
        return 'TP_HIT';
      case 'SL':
        return 'SL_HIT';
      case 'TRAIL':
        return 'TRAILING_STOP_HIT';
      case 'MAXHOLD':
        return 'POSITION_CLOSED';
      case 'EMERGENCY':
        return 'POSITION_CLOSED';
      default:
        return 'TRADE_DONE';
    }
  }

  /**
   * Wait for all processing jobs to complete
   */
  private waitForDrain(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.processing.size === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Clear completed job history (for memory management)
   * Call periodically to prevent unbounded growth
   *
   * @param olderThanMs - Clear entries older than this (default: 1 hour)
   */
  clearCompletedHistory(maxEntries = 10000): void {
    if (this.completed.size > maxEntries) {
      // Keep most recent entries by clearing oldest half
      const toRemove = this.completed.size - maxEntries / 2;
      const iterator = this.completed.values();
      for (let i = 0; i < toRemove; i++) {
        const key = iterator.next().value;
        if (key) this.completed.delete(key);
      }
      console.log(`[ExitQueue] Cleared ${toRemove} old completed entries`);
    }
  }
}

/**
 * Create an ExitJob from trigger evaluation
 */
export function createExitJob(params: {
  positionId: string;
  tokenMint: string;
  userId: number;
  trigger: ExitTrigger;
  triggerPrice: number;
  idempotencyKey: string;
  sellPercent?: number;
  slippageBps?: number;
}): ExitJob {
  const config = getTpSlConfig();

  // Use appropriate slippage based on trigger type
  const slippageBps =
    params.slippageBps ??
    (params.trigger === 'SL' || params.trigger === 'EMERGENCY'
      ? config.slippageBpsSL
      : config.slippageBpsTP);

  return {
    positionId: params.positionId,
    tokenMint: params.tokenMint,
    userId: params.userId,
    trigger: params.trigger,
    triggerPrice: params.triggerPrice,
    idempotencyKey: params.idempotencyKey,
    priority: EXIT_PRIORITY[params.trigger],
    enqueuedAt: new Date(),
    slippageBps,
    sellPercent: params.sellPercent ?? 100,
  };
}
