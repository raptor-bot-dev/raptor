/**
 * RAPTOR v3.1 Notification Polling Service
 *
 * Polls for unclaimed notifications and delivers them via Telegram.
 * Runs in the Bot process (single instance) to prevent duplicate delivery.
 *
 * Design:
 * - Polls every 1.5 seconds (configurable via NOTIFICATION_POLL_INTERVAL_MS)
 * - Claims notifications atomically to prevent double-send
 * - Formats messages based on notification type
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
      const message = this.formatNotification(notification);

      await this.bot.api.sendMessage(notification.user_id, message, {
        parse_mode: 'Markdown',
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
   * Format notification into Telegram message
   */
  private formatNotification(notification: Notification): string {
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

      default:
        return this.formatGeneric(notification.type, payload);
    }
  }

  // ============================================
  // Notification formatters
  // ============================================

  private formatBuyConfirmed(payload: Record<string, unknown>): string {
    const chain = String(payload.chain || 'sol').toUpperCase();
    const tokenMint = String(payload.tokenMint || '');
    const amountSol = Number(payload.amountSol || 0);
    const tokensReceived = Number(payload.tokensReceived || 0);
    const price = Number(payload.price || 0);
    const txHash = String(payload.txHash || '');
    const route = String(payload.route || 'Unknown');

    const explorerUrl = `https://solscan.io/tx/${txHash}`;
    const mintUrl = `https://solscan.io/token/${tokenMint}`;

    return `✅ *BUY CONFIRMED*

*Chain:* ${chain}
*Route:* ${route}
*Amount:* ${amountSol.toFixed(4)} SOL
*Tokens:* ${tokensReceived.toLocaleString()}
*Price:* ${price.toFixed(9)} SOL

[View Transaction](${explorerUrl}) | [View Token](${mintUrl})`;
  }

  private formatBuyFailed(payload: Record<string, unknown>): string {
    const chain = String(payload.chain || 'sol').toUpperCase();
    const error = String(payload.error || 'Unknown error');
    const errorCode = String(payload.errorCode || '');

    return `❌ *BUY FAILED*

*Chain:* ${chain}
*Error:* ${error}
${errorCode ? `*Code:* ${errorCode}` : ''}

Please check your wallet balance and try again.`;
  }

  private formatSellConfirmed(payload: Record<string, unknown>): string {
    const chain = String(payload.chain || 'sol').toUpperCase();
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const tokensSold = Number(payload.tokensSold || 0);
    const solReceived = Number(payload.solReceived || 0);
    const price = Number(payload.price || 0);
    const txHash = String(payload.txHash || '');
    const pnlSol = Number(payload.pnlSol || 0);
    const pnlPercent = Number(payload.pnlPercent || 0);

    const explorerUrl = `https://solscan.io/tx/${txHash}`;
    const pnlEmoji = pnlSol >= 0 ? '📈' : '📉';
    const pnlSign = pnlSol >= 0 ? '+' : '';

    return `✅ *SELL CONFIRMED*

*Token:* ${tokenSymbol}
*Chain:* ${chain}
*Tokens Sold:* ${tokensSold.toLocaleString()}
*SOL Received:* ${solReceived.toFixed(4)} SOL
*Price:* ${price.toFixed(9)} SOL

${pnlEmoji} *P&L:* ${pnlSign}${pnlSol.toFixed(4)} SOL (${pnlSign}${pnlPercent.toFixed(2)}%)

[View Transaction](${explorerUrl})`;
  }

  private formatSellFailed(payload: Record<string, unknown>): string {
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const error = String(payload.error || 'Unknown error');

    return `❌ *SELL FAILED*

*Token:* ${tokenSymbol}
*Error:* ${error}

Please try again or check token liquidity.`;
  }

  private formatTpHit(payload: Record<string, unknown>): string {
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const pnlPercent = Number(payload.pnlPercent || 0);
    const solReceived = Number(payload.solReceived || 0);
    const txHash = String(payload.txHash || '');

    const explorerUrl = txHash ? `https://solscan.io/tx/${txHash}` : '';

    return `🎯 *TAKE PROFIT HIT*

*Token:* ${tokenSymbol}
*Profit:* +${pnlPercent.toFixed(2)}%
*SOL Received:* ${solReceived.toFixed(4)} SOL

${explorerUrl ? `[View Transaction](${explorerUrl})` : 'Auto-sell executed'}`;
  }

  private formatSlHit(payload: Record<string, unknown>): string {
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const pnlPercent = Number(payload.pnlPercent || 0);
    const solReceived = Number(payload.solReceived || 0);
    const txHash = String(payload.txHash || '');

    const explorerUrl = txHash ? `https://solscan.io/tx/${txHash}` : '';

    return `🛑 *STOP LOSS HIT*

*Token:* ${tokenSymbol}
*Loss:* ${pnlPercent.toFixed(2)}%
*SOL Received:* ${solReceived.toFixed(4)} SOL

${explorerUrl ? `[View Transaction](${explorerUrl})` : 'Auto-sell executed'}`;
  }

  private formatTrailingStopHit(payload: Record<string, unknown>): string {
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const pnlPercent = Number(payload.pnlPercent || 0);
    const peakPercent = Number(payload.peakPercent || 0);
    const solReceived = Number(payload.solReceived || 0);
    const txHash = String(payload.txHash || '');

    const explorerUrl = txHash ? `https://solscan.io/tx/${txHash}` : '';

    return `📉 *TRAILING STOP HIT*

*Token:* ${tokenSymbol}
*Peak Profit:* +${peakPercent.toFixed(2)}%
*Locked Profit:* +${pnlPercent.toFixed(2)}%
*SOL Received:* ${solReceived.toFixed(4)} SOL

${explorerUrl ? `[View Transaction](${explorerUrl})` : 'Auto-sell executed'}`;
  }

  private formatPositionOpened(payload: Record<string, unknown>): string {
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const chain = String(payload.chain || 'sol').toUpperCase();
    const amountSol = Number(payload.amountSol || 0);
    const tokens = Number(payload.tokens || 0);
    const source = String(payload.source || 'auto');

    return `📥 *POSITION OPENED*

*Token:* ${tokenSymbol}
*Chain:* ${chain}
*Entry:* ${amountSol.toFixed(4)} SOL
*Tokens:* ${tokens.toLocaleString()}
*Source:* ${source === 'auto' ? 'Auto Hunt' : 'Manual'}`;
  }

  private formatPositionClosed(payload: Record<string, unknown>): string {
    const tokenSymbol = String(payload.tokenSymbol || 'Unknown');
    const pnlSol = Number(payload.pnlSol || 0);
    const pnlPercent = Number(payload.pnlPercent || 0);
    const trigger = String(payload.trigger || 'MANUAL');

    const pnlEmoji = pnlSol >= 0 ? '📈' : '📉';
    const pnlSign = pnlSol >= 0 ? '+' : '';

    return `📤 *POSITION CLOSED*

*Token:* ${tokenSymbol}
*Trigger:* ${trigger}
${pnlEmoji} *P&L:* ${pnlSign}${pnlSol.toFixed(4)} SOL (${pnlSign}${pnlPercent.toFixed(2)}%)`;
  }

  private formatOpportunityDetected(payload: Record<string, unknown>): string {
    const tokenName = String(payload.tokenName || 'Unknown');
    const tokenSymbol = String(payload.tokenSymbol || '???');
    const tokenMint = String(payload.tokenMint || '');
    const score = Number(payload.score || 0);
    const source = String(payload.source || 'pump.fun');

    const mintUrl = `https://solscan.io/token/${tokenMint}`;

    return `🎯 *OPPORTUNITY DETECTED*

*Token:* ${tokenName} (${tokenSymbol})
*Score:* ${score}/100
*Source:* ${source}

[View Token](${mintUrl})

_Auto-buy will execute if strategy conditions match._`;
  }

  private formatBudgetWarning(payload: Record<string, unknown>): string {
    const dailySpent = Number(payload.dailySpent || 0);
    const dailyLimit = Number(payload.dailyLimit || 0);
    const percentUsed = Number(payload.percentUsed || 0);

    return `⚠️ *BUDGET WARNING*

*Daily Spent:* ${dailySpent.toFixed(2)} SOL
*Daily Limit:* ${dailyLimit.toFixed(2)} SOL
*Usage:* ${percentUsed.toFixed(0)}%

Consider adjusting your daily limit in settings.`;
  }

  private formatCircuitBreaker(payload: Record<string, unknown>): string {
    const consecutiveFailures = Number(payload.consecutiveFailures || 0);
    const reopensAt = String(payload.reopensAt || '');

    return `🚨 *CIRCUIT BREAKER OPEN*

*Consecutive Failures:* ${consecutiveFailures}
*Auto-trading paused until:* ${reopensAt || 'manual reset'}

This is a safety measure. Check your RPC and wallet status.`;
  }

  private formatGeneric(type: string, payload: Record<string, unknown>): string {
    return `📢 *${type}*

${JSON.stringify(payload, null, 2)}`;
  }
}

/**
 * Create and start a notification poller
 */
export function createNotificationPoller(bot: Bot): NotificationPoller {
  const poller = new NotificationPoller({ bot });
  return poller;
}
