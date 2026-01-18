// =============================================================================
// RAPTOR TP/SL Engine - Subscription Manager
// Token-scoped subscription lifecycle with reference counting
// =============================================================================

import { EventEmitter } from 'events';
import { HeliusWsManager, LogsNotification } from './heliusWs.js';

/**
 * Token subscription state
 */
interface TokenSubscription {
  /** Token mint address */
  tokenMint: string;
  /** Bonding curve or pool account being monitored */
  monitoredPubkey: string;
  /** Request ID from HeliusWsManager */
  requestId: number;
  /** Position IDs watching this token */
  positionIds: Set<string>;
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Activity event emitted when WebSocket detects activity
 */
export interface TokenActivityEvent {
  tokenMint: string;
  signature: string;
  logs: string[];
}

/**
 * TpSlSubscriptionManager - Manages token-scoped WebSocket subscriptions
 *
 * Key features:
 * - One subscription per token (many positions can watch same token)
 * - Reference counting (auto-unsubscribe when no watchers)
 * - Activity events for immediate price refresh
 */
export class TpSlSubscriptionManager extends EventEmitter {
  private wsManager: HeliusWsManager;
  private tokenSubscriptions: Map<string, TokenSubscription> = new Map(); // tokenMint -> subscription
  private positionToToken: Map<string, string> = new Map(); // positionId -> tokenMint

  constructor(wsManager: HeliusWsManager) {
    super();
    this.wsManager = wsManager;
  }

  /**
   * Add a position to watch
   * Creates subscription if this is the first position for this token
   *
   * @param positionId - Unique position identifier
   * @param tokenMint - Token mint address
   * @param bondingCurve - Bonding curve or pool address to monitor
   */
  addPosition(positionId: string, tokenMint: string, bondingCurve: string): void {
    // Check if already watching this position
    if (this.positionToToken.has(positionId)) {
      console.warn(`[SubscriptionManager] Position ${positionId.slice(0, 8)}... already watching`);
      return;
    }

    // Check if we already have a subscription for this token
    const existing = this.tokenSubscriptions.get(tokenMint);

    if (existing) {
      // Add position to existing subscription
      existing.positionIds.add(positionId);
      this.positionToToken.set(positionId, tokenMint);

      console.log(
        `[SubscriptionManager] Position ${positionId.slice(0, 8)}... added to existing subscription ` +
        `(${existing.positionIds.size} watchers for ${tokenMint.slice(0, 12)}...)`
      );
      return;
    }

    // Create new subscription
    const requestId = this.wsManager.subscribe(bondingCurve, (notification) => {
      this.handleActivity(tokenMint, notification);
    });

    const subscription: TokenSubscription = {
      tokenMint,
      monitoredPubkey: bondingCurve,
      requestId,
      positionIds: new Set([positionId]),
      lastActivityAt: Date.now(),
    };

    this.tokenSubscriptions.set(tokenMint, subscription);
    this.positionToToken.set(positionId, tokenMint);

    console.log(
      `[SubscriptionManager] New subscription for ${tokenMint.slice(0, 12)}... ` +
      `(bonding curve: ${bondingCurve.slice(0, 12)}...)`
    );
  }

  /**
   * Remove a position from watching
   * Unsubscribes if this was the last position watching this token
   *
   * @param positionId - Unique position identifier
   */
  removePosition(positionId: string): void {
    const tokenMint = this.positionToToken.get(positionId);
    if (!tokenMint) {
      // Position not tracked
      return;
    }

    this.positionToToken.delete(positionId);

    const subscription = this.tokenSubscriptions.get(tokenMint);
    if (!subscription) return;

    subscription.positionIds.delete(positionId);

    // Check if no more watchers
    if (subscription.positionIds.size === 0) {
      // Unsubscribe from WebSocket
      this.wsManager.unsubscribe(subscription.requestId);
      this.tokenSubscriptions.delete(tokenMint);

      console.log(
        `[SubscriptionManager] Unsubscribed from ${tokenMint.slice(0, 12)}... (no more watchers)`
      );
    } else {
      console.log(
        `[SubscriptionManager] Position ${positionId.slice(0, 8)}... removed ` +
        `(${subscription.positionIds.size} watchers remaining for ${tokenMint.slice(0, 12)}...)`
      );
    }
  }

  /**
   * Get all position IDs watching a specific token
   */
  getWatchingPositions(tokenMint: string): string[] {
    const subscription = this.tokenSubscriptions.get(tokenMint);
    if (!subscription) return [];
    return Array.from(subscription.positionIds);
  }

  /**
   * Check if a token is being watched
   */
  isWatching(tokenMint: string): boolean {
    return this.tokenSubscriptions.has(tokenMint);
  }

  /**
   * Get total number of active token subscriptions
   */
  getSubscriptionCount(): number {
    return this.tokenSubscriptions.size;
  }

  /**
   * Get total number of positions being watched
   */
  getPositionCount(): number {
    return this.positionToToken.size;
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { tokens: number; positions: number; wsSubscriptions: number } {
    return {
      tokens: this.tokenSubscriptions.size,
      positions: this.positionToToken.size,
      wsSubscriptions: this.wsManager.getSubscriptionCount(),
    };
  }

  /**
   * Handle activity notification from WebSocket
   */
  private handleActivity(tokenMint: string, notification: LogsNotification): void {
    const subscription = this.tokenSubscriptions.get(tokenMint);
    if (!subscription) return;

    subscription.lastActivityAt = Date.now();

    // Emit activity event for TpSlMonitorLoop to trigger immediate price check
    const event: TokenActivityEvent = {
      tokenMint,
      signature: notification.signature,
      logs: notification.logs,
    };

    this.emit('activity', event);
  }

  /**
   * Clean up stale subscriptions
   * Call this periodically to remove subscriptions with no activity
   *
   * @param staleThresholdMs - Consider stale after this many ms without activity
   */
  cleanupStale(staleThresholdMs: number = 300000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [tokenMint, subscription] of this.tokenSubscriptions.entries()) {
      if (now - subscription.lastActivityAt > staleThresholdMs) {
        // Check if there are still active positions
        // Don't cleanup if positions are still watching (they might be waiting for price movement)
        if (subscription.positionIds.size === 0) {
          this.wsManager.unsubscribe(subscription.requestId);
          this.tokenSubscriptions.delete(tokenMint);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[SubscriptionManager] Cleaned up ${cleaned} stale subscriptions`);
    }

    return cleaned;
  }

  /**
   * Force refresh subscriptions (for recovery scenarios)
   */
  refreshAll(): void {
    for (const [tokenMint, subscription] of this.tokenSubscriptions.entries()) {
      // Unsubscribe old
      this.wsManager.unsubscribe(subscription.requestId);

      // Create new subscription
      const newRequestId = this.wsManager.subscribe(
        subscription.monitoredPubkey,
        (notification) => this.handleActivity(tokenMint, notification)
      );

      subscription.requestId = newRequestId;
    }

    console.log(`[SubscriptionManager] Refreshed ${this.tokenSubscriptions.size} subscriptions`);
  }
}
