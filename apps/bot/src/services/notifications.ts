/**
 * RAPTOR v3.1 Notification Polling Service
 *
 * Polls for unclaimed notifications and delivers them via Telegram.
 * Runs in the Bot process (single instance) to prevent duplicate delivery.
 *
 * Design:
 * - Polls every 1.5 seconds (configurable via NOTIFICATION_POLL_INTERVAL_MS)
 * - Claims notifications atomically to prevent double-send
 * - Formats messages based on notification type using panelKit terminal UI
 * - Handles delivery failures with retry logic
 */

import { Bot } from 'grammy';
import {
  claimNotifications,
  markNotificationDelivered,
  markNotificationFailed,
  getNotificationPollInterval,
  getWorkerId,
  createLogger,
  type Notification,
} from '@raptor/shared';

import type { Panel } from '../ui/panelKit.js';
import {
  renderHuntExecuted,
  renderHuntClosed,
  renderBuyFailed,
  renderSellFailed,
  renderTradeDone,
  renderTpHit,
  renderSlHit,
  renderTrailingStopHit,
  renderPositionOpened,
  renderPositionClosed,
  renderBudgetWarning,
  renderCircuitBreaker,
  renderOpportunityDetected,
  renderGenericNotification,
  type HuntExecutedData,
  type HuntClosedData,
  type TpHitData,
  type SlHitData,
  type TrailingStopHitData,
  type PositionOpenedData,
  type PositionClosedData,
  type BudgetWarningData,
  type CircuitBreakerData,
  type OpportunityDetectedData,
  type TradeDoneData,
  type ExitTrigger,
} from '../ui/notifications/index.js';

const logger = createLogger('NotificationPoller');

export interface NotificationPollerOptions {
  bot: Bot;
  pollIntervalMs?: number;
  batchSize?: number;
}

export class NotificationPoller {
  private bot: Bot;
  private workerId: string;
  private pollIntervalMs: number;
  private batchSize: number;
  private running: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(options: NotificationPollerOptions) {
    this.bot = options.bot;
    this.workerId = getWorkerId();
    this.pollIntervalMs = options.pollIntervalMs || getNotificationPollInterval();
    this.batchSize = options.batchSize || 20;

    logger.info('NotificationPoller initialized', {
      workerId: this.workerId,
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
    });
  }

  /**
   * Start the notification polling loop
   */
  start(): void {
    if (this.running) {
      logger.warn('NotificationPoller already running');
      return;
    }

    this.running = true;
    logger.info('NotificationPoller started');
    this.poll();
  }

  /**
   * Stop the notification polling loop
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('NotificationPoller stopped');
  }

  /**
   * Single poll iteration
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      // Claim notifications
      const notifications = await claimNotifications(this.workerId, this.batchSize);

      if (notifications.length > 0) {
        logger.debug(`Claimed ${notifications.length} notifications`);

        // Process each notification
        await Promise.all(
          notifications.map((n) => this.deliverNotification(n))
        );
      }
    } catch (error) {
      logger.error('Poll error', error);
    }

    // Schedule next poll
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs);
    }
  }

  /**
   * Deliver a single notification
   */
  private async deliverNotification(notification: Notification): Promise<void> {
    try {
      const panel = this.formatNotification(notification);

      await this.bot.api.sendMessage(notification.user_id, panel.text, {
        ...panel.opts,
        link_preview_options: { is_disabled: true },
      });

      // Mark as delivered
      await markNotificationDelivered(notification.id);
      logger.debug(`Delivered notification ${notification.id} to user ${notification.user_id}`);
    } catch (error) {
      logger.error(`Failed to deliver notification ${notification.id}`, error);

      // Mark as failed for retry
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await markNotificationFailed(notification.id, errorMessage);
    }
  }

  /**
   * Format notification into Telegram Panel
   */
  private formatNotification(notification: Notification): Panel {
    const payload = notification.payload as Record<string, unknown>;

    switch (notification.type) {
      case 'BUY_CONFIRMED':
        return this.formatBuyConfirmed(payload);

      case 'BUY_FAILED':
        return this.formatBuyFailed(payload);

      case 'SELL_CONFIRMED':
        return this.formatSellConfirmed(payload);

      case 'SELL_FAILED':
        return this.formatSellFailed(payload);

      case 'TP_HIT':
        return this.formatTpHit(payload);

      case 'SL_HIT':
        return this.formatSlHit(payload);

      case 'TRAILING_STOP_HIT':
        return this.formatTrailingStopHit(payload);

      case 'POSITION_OPENED':
        return this.formatPositionOpened(payload);

      case 'POSITION_CLOSED':
        return this.formatPositionClosed(payload);

      case 'OPPORTUNITY_DETECTED':
        return this.formatOpportunityDetected(payload);

      case 'BUDGET_WARNING':
        return this.formatBudgetWarning(payload);

      case 'CIRCUIT_BREAKER':
        return this.formatCircuitBreaker(payload);

      case 'TRADE_DONE':
        return this.formatTradeDone(payload);

      default:
        return renderGenericNotification(notification.type, payload);
    }
  }

  // ============================================
  // Notification formatters - using panelKit terminal UI
  // ============================================

  private formatBuyConfirmed(payload: Record<string, unknown>): Panel {
    const data: HuntExecutedData = {
      positionId: String(payload.positionId || ''),
      tokenName: String(payload.tokenName || 'Unknown'),
      symbol: String(payload.tokenSymbol || '???'),
      mint: String(payload.tokenMint || ''),
      entryPrice: formatPriceForDisplay(Number(payload.price || 0)),
      marketCap: formatMarketCapForDisplay(Number(payload.marketCap || 0)),
      solIn: Number(payload.amountSol || 0),
      tokensOut: Number(payload.tokensReceived || 0),
      txSig: String(payload.txHash || ''),
    };
    return renderHuntExecuted(data);
  }

  private formatBuyFailed(payload: Record<string, unknown>): Panel {
    const symbol = String(payload.tokenSymbol || 'Unknown');
    const mint = String(payload.mint || payload.tokenMint || '');
    const error = String(payload.error || 'Unknown error');
    return renderBuyFailed(symbol, mint, error);
  }

  private formatSellConfirmed(payload: Record<string, unknown>): Panel {
    const data: HuntClosedData = {
      symbol: String(payload.tokenSymbol || 'Unknown'),
      mint: String(payload.tokenMint || payload.mint || ''),
      entryPrice: formatPriceForDisplay(Number(payload.entryPrice || 0)),
      entryMc: formatMarketCapForDisplay(Number(payload.entryMc || 0)),
      exitPrice: formatPriceForDisplay(Number(payload.price || 0)),
      exitMc: formatMarketCapForDisplay(Number(payload.exitMc || 0)),
      receivedSol: Number(payload.solReceived || 0),
      pnlPercent: Number(payload.pnlPercent || 0),
      pnlSol: Number(payload.pnlSol || 0),
      txSig: String(payload.txHash || ''),
      trigger: (payload.trigger as ExitTrigger) || 'MANUAL',
    };
    return renderHuntClosed(data);
  }

  private formatSellFailed(payload: Record<string, unknown>): Panel {
    const symbol = String(payload.tokenSymbol || 'Unknown');
    const mint = String(payload.mint || payload.tokenMint || '');
    const error = String(payload.error || 'Unknown error');
    return renderSellFailed(symbol, mint, error);
  }

  private formatTpHit(payload: Record<string, unknown>): Panel {
    const data: TpHitData = {
      tokenSymbol: String(payload.tokenSymbol || 'Unknown'),
      mint: String(payload.mint || payload.tokenMint || ''),
      pnlPercent: Number(payload.pnlPercent || 0),
      solReceived: Number(payload.solReceived || 0),
      txHash: String(payload.txHash || ''),
    };
    return renderTpHit(data);
  }

  private formatSlHit(payload: Record<string, unknown>): Panel {
    const data: SlHitData = {
      tokenSymbol: String(payload.tokenSymbol || 'Unknown'),
      mint: String(payload.mint || payload.tokenMint || ''),
      pnlPercent: Number(payload.pnlPercent || 0),
      solReceived: Number(payload.solReceived || 0),
      txHash: String(payload.txHash || ''),
    };
    return renderSlHit(data);
  }

  private formatTrailingStopHit(payload: Record<string, unknown>): Panel {
    const data: TrailingStopHitData = {
      tokenSymbol: String(payload.tokenSymbol || 'Unknown'),
      mint: String(payload.mint || payload.tokenMint || ''),
      pnlPercent: Number(payload.pnlPercent || 0),
      peakPercent: Number(payload.peakPercent || 0),
      solReceived: Number(payload.solReceived || 0),
      txHash: String(payload.txHash || ''),
    };
    return renderTrailingStopHit(data);
  }

  private formatPositionOpened(payload: Record<string, unknown>): Panel {
    const data: PositionOpenedData = {
      tokenSymbol: String(payload.tokenSymbol || 'Unknown'),
      mint: String(payload.mint || payload.tokenMint || ''),
      amountSol: Number(payload.amountSol || 0),
      tokens: Number(payload.tokens || 0),
      source: (payload.source as 'auto' | 'manual') || 'auto',
    };
    return renderPositionOpened(data);
  }

  private formatPositionClosed(payload: Record<string, unknown>): Panel {
    const data: PositionClosedData = {
      tokenSymbol: String(payload.tokenSymbol || 'Unknown'),
      mint: String(payload.mint || payload.tokenMint || ''),
      pnlSol: Number(payload.pnlSol || 0),
      pnlPercent: Number(payload.pnlPercent || 0),
      trigger: (payload.trigger as ExitTrigger) || 'MANUAL',
      txHash: payload.txHash ? String(payload.txHash) : undefined,
    };
    return renderPositionClosed(data);
  }

  private formatOpportunityDetected(payload: Record<string, unknown>): Panel {
    const data: OpportunityDetectedData = {
      tokenName: String(payload.tokenName || 'Unknown'),
      tokenSymbol: String(payload.tokenSymbol || '???'),
      tokenMint: String(payload.tokenMint || ''),
      score: Number(payload.score || 0),
      source: String(payload.source || 'bags'),
    };
    return renderOpportunityDetected(data);
  }

  private formatBudgetWarning(payload: Record<string, unknown>): Panel {
    const data: BudgetWarningData = {
      dailySpent: Number(payload.dailySpent || 0),
      dailyLimit: Number(payload.dailyLimit || 0),
      percentUsed: Number(payload.percentUsed || 0),
    };
    return renderBudgetWarning(data);
  }

  private formatCircuitBreaker(payload: Record<string, unknown>): Panel {
    const data: CircuitBreakerData = {
      consecutiveFailures: Number(payload.consecutiveFailures || 0),
      reopensAt: payload.reopensAt ? String(payload.reopensAt) : undefined,
    };
    return renderCircuitBreaker(data);
  }

  private formatTradeDone(payload: Record<string, unknown>): Panel {
    // TRADE_DONE is BUY-only per CLAUDE.md
    const data: TradeDoneData = {
      mint: String(payload.mint || ''),
      amountSol: Number(payload.amount_sol || 0),
      tokens: Number(payload.tokens || 0),
      txSig: String(payload.tx_sig || ''),
      tokenSymbol: payload.tokenSymbol ? String(payload.tokenSymbol) : undefined,
      marketCapSol: payload.marketCapSol ? Number(payload.marketCapSol) : undefined,
    };
    return renderTradeDone(data);
  }
}

// ============================================
// Helper functions for formatting
// ============================================

/**
 * Format price for display
 */
function formatPriceForDisplay(price: number): string {
  if (price === 0) return '$0';
  if (price < 0.00001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  return `$${price.toFixed(4)}`;
}

/**
 * Format market cap for display
 */
function formatMarketCapForDisplay(mc: number): string {
  if (mc === 0) return '$0';
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
  if (mc >= 1e3) return `$${(mc / 1e3).toFixed(2)}K`;
  return `$${mc.toFixed(2)}`;
}

/**
 * Create and start a notification poller
 */
export function createNotificationPoller(bot: Bot): NotificationPoller {
  const poller = new NotificationPoller({ bot });
  return poller;
}
