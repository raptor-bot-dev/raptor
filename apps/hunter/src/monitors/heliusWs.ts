// =============================================================================
// RAPTOR TP/SL Engine - Helius WebSocket Manager
// WebSocket connection manager for real-time price activity monitoring
// =============================================================================

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { SOLANA_CONFIG } from '@raptor/shared';

/**
 * Logs notification from Helius WebSocket
 */
export interface LogsNotification {
  signature: string;
  err: unknown | null;
  logs: string[];
}

/**
 * Subscription handler callback type
 */
export type SubscriptionHandler = (notification: LogsNotification) => void;

/**
 * Internal subscription tracking
 */
interface Subscription {
  /** JSON-RPC request ID used to create subscription */
  requestId: number;
  /** Helius subscription ID (received in response) */
  subscriptionId: number | null;
  /** Public key being monitored */
  pubkey: string;
  /** Handler callback */
  handler: SubscriptionHandler;
}

/**
 * HeliusWsManager - Manages WebSocket connection to Helius RPC
 *
 * Key features:
 * - Automatic heartbeat (30s) to prevent 10-minute inactivity timeout
 * - Reconnect with exponential backoff
 * - Subscription restore on reconnect
 * - Typed event emitter for status changes
 */
export class HeliusWsManager extends EventEmitter {
  private wssUrl: string;
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectCooldownMs = 60000; // 60s cooldown after max attempts

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatIntervalMs = 30000; // 30s < Helius 60s requirement
  private pendingPings = 0;
  private maxPendingPings = 2;

  private nextRequestId = 1;
  private subscriptions: Map<number, Subscription> = new Map(); // requestId -> Subscription
  private subscriptionIdMap: Map<number, number> = new Map(); // subscriptionId -> requestId

  constructor() {
    super();
    this.wssUrl = SOLANA_CONFIG.wssUrl;
  }

  /**
   * Start the WebSocket manager
   */
  async start(): Promise<void> {
    if (this.running) return;
    console.log('[HeliusWsManager] Starting...');
    this.running = true;
    await this.connect();
  }

  /**
   * Stop the WebSocket manager
   */
  async stop(): Promise<void> {
    console.log('[HeliusWsManager] Stopping...');
    this.running = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
    this.subscriptionIdMap.clear();
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get count of active subscriptions
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Subscribe to logs for a specific pubkey (bonding curve or pool account)
   *
   * @param pubkey - The public key to monitor
   * @param handler - Callback for log notifications
   * @returns Request ID (use for unsubscribe)
   */
  subscribe(pubkey: string, handler: SubscriptionHandler): number {
    const requestId = this.nextRequestId++;

    const subscription: Subscription = {
      requestId,
      subscriptionId: null,
      pubkey,
      handler,
    };

    this.subscriptions.set(requestId, subscription);

    // Send subscription if connected
    if (this.isConnected()) {
      this.sendSubscribe(subscription);
    }

    console.log(`[HeliusWsManager] Subscription queued: ${pubkey.slice(0, 12)}... (reqId: ${requestId})`);
    return requestId;
  }

  /**
   * Unsubscribe from logs for a pubkey
   *
   * @param requestId - The request ID returned from subscribe()
   */
  unsubscribe(requestId: number): void {
    const subscription = this.subscriptions.get(requestId);
    if (!subscription) return;

    // Send unsubscribe if we have a subscription ID and are connected
    if (subscription.subscriptionId !== null && this.isConnected()) {
      this.sendUnsubscribe(subscription.subscriptionId);
    }

    // Clean up maps
    if (subscription.subscriptionId !== null) {
      this.subscriptionIdMap.delete(subscription.subscriptionId);
    }
    this.subscriptions.delete(requestId);

    console.log(`[HeliusWsManager] Unsubscribed: ${subscription.pubkey.slice(0, 12)}...`);
  }

  /**
   * Connect to WebSocket
   */
  private async connect(): Promise<void> {
    if (!this.running) return;

    try {
      // Mask API key in logs
      const maskedUrl = this.wssUrl.replace(/api-key=[^&]+/, 'api-key=***');
      console.log(`[HeliusWsManager] Connecting to ${maskedUrl}`);

      this.ws = new WebSocket(this.wssUrl);

      this.ws.on('open', () => {
        console.log('[HeliusWsManager] WebSocket connected');
        this.reconnectAttempts = 0;
        this.pendingPings = 0;
        this.startHeartbeat();
        this.resubscribeAll();
        this.emit('connected');
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[HeliusWsManager] WebSocket closed: ${code} - ${reason.toString()}`);
        this.stopHeartbeat();
        this.clearSubscriptionIds();
        this.emit('disconnected', { code, reason: reason.toString() });
        this.handleDisconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[HeliusWsManager] WebSocket error:', error.message);
        this.emit('error', error);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('pong', () => {
        this.pendingPings = 0;
      });
    } catch (error) {
      console.error('[HeliusWsManager] Connection failed:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Start heartbeat to keep connection alive
   * Helius has 10-minute inactivity timeout - we ping every 30s
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected()) return;

      if (this.pendingPings >= this.maxPendingPings) {
        console.warn('[HeliusWsManager] Connection unresponsive, reconnecting');
        this.ws?.terminate();
        return;
      }

      this.ws?.ping();
      this.pendingPings++;
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Subscription confirmation response
      if (message.id !== undefined && message.result !== undefined) {
        this.handleSubscriptionResponse(message.id, message.result);
        return;
      }

      // Unsubscribe confirmation
      if (message.id !== undefined && message.result === true) {
        // Unsubscribe succeeded, nothing to do
        return;
      }

      // Logs notification
      if (message.method === 'logsNotification' && message.params?.result?.value) {
        this.handleLogsNotification(message.params.subscription, message.params.result.value);
        return;
      }

      // Error response
      if (message.error) {
        console.error('[HeliusWsManager] RPC error:', message.error);
        this.emit('rpc_error', message.error);
      }
    } catch (error) {
      console.error('[HeliusWsManager] Message parse error:', error);
    }
  }

  /**
   * Handle subscription confirmation response
   */
  private handleSubscriptionResponse(requestId: number, subscriptionId: number): void {
    const subscription = this.subscriptions.get(requestId);
    if (!subscription) {
      console.warn(`[HeliusWsManager] Unknown subscription response: reqId=${requestId}`);
      return;
    }

    subscription.subscriptionId = subscriptionId;
    this.subscriptionIdMap.set(subscriptionId, requestId);

    console.log(`[HeliusWsManager] Subscription confirmed: ${subscription.pubkey.slice(0, 12)}... (subId: ${subscriptionId})`);
  }

  /**
   * Handle logs notification
   */
  private handleLogsNotification(subscriptionId: number, value: LogsNotification): void {
    const requestId = this.subscriptionIdMap.get(subscriptionId);
    if (requestId === undefined) {
      // May be from an old subscription
      return;
    }

    const subscription = this.subscriptions.get(requestId);
    if (!subscription) return;

    // Skip errored transactions
    if (value.err) return;

    try {
      subscription.handler(value);
    } catch (error) {
      console.error('[HeliusWsManager] Handler error:', error);
    }
  }

  /**
   * Send subscription request
   */
  private sendSubscribe(subscription: Subscription): void {
    if (!this.isConnected()) return;

    const message = {
      jsonrpc: '2.0',
      id: subscription.requestId,
      method: 'logsSubscribe',
      params: [
        { mentions: [subscription.pubkey] },
        { commitment: 'confirmed' },
      ],
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Send unsubscribe request
   */
  private sendUnsubscribe(subscriptionId: number): void {
    if (!this.isConnected()) return;

    const message = {
      jsonrpc: '2.0',
      id: this.nextRequestId++,
      method: 'logsUnsubscribe',
      params: [subscriptionId],
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Resubscribe all pending subscriptions after reconnect
   */
  private resubscribeAll(): void {
    for (const subscription of this.subscriptions.values()) {
      this.sendSubscribe(subscription);
    }

    if (this.subscriptions.size > 0) {
      console.log(`[HeliusWsManager] Resubscribed ${this.subscriptions.size} subscriptions`);
    }
  }

  /**
   * Clear subscription IDs (on disconnect)
   */
  private clearSubscriptionIds(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.subscriptionId = null;
    }
    this.subscriptionIdMap.clear();
  }

  /**
   * Handle disconnection with reconnect
   */
  private handleDisconnect(): void {
    if (!this.running) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      // Exponential backoff: 3s, 6s, 9s, 12s, 15s (capped)
      const delay = 3000 * Math.min(this.reconnectAttempts, 5);

      console.log(
        `[HeliusWsManager] Reconnecting in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );

      setTimeout(() => this.connect(), delay);
    } else {
      console.error('[HeliusWsManager] Max reconnect attempts reached, cooling down');

      // After cooldown, reset and try again
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.connect();
      }, this.reconnectCooldownMs);
    }
  }
}
