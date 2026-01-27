// =============================================================================
// RAPTOR Phase 4: Meteora On-Chain Source
// WebSocket listener for Meteora DBC token launches via Helius
// =============================================================================

import { HeliusWsManager, type LogsNotification } from '../monitors/heliusWs.js';
import { parseMeteoraLogs, validateCreateEvent, type MeteoraCreateEvent } from './meteoraParser.js';
import { getMeteoraProgramId } from '@raptor/shared';

/**
 * Signal emitted when a new Meteora DBC token is detected on-chain
 */
export interface MeteoraOnChainSignal {
  /** Token mint address */
  mint: string;
  /** Bonding curve / pool address */
  bondingCurve: string;
  /** Creator wallet address */
  creator: string;
  /** Transaction signature */
  signature: string;
  /** Slot number */
  slot: number;
  /** Detection timestamp (ms) */
  timestamp: number;
}

/**
 * Configuration for MeteoraOnChainSource
 */
export interface MeteoraOnChainConfig {
  /** Meteora DBC program ID to monitor */
  programId?: string;
  /** Whether the source is enabled */
  enabled: boolean;
}

/**
 * Handler function type for detected signals
 */
export type MeteoraSignalHandler = (signal: MeteoraOnChainSignal) => Promise<void>;

/**
 * MeteoraOnChainSource monitors the Meteora DBC program for new token launches
 * and emits normalized signals for downstream processing.
 *
 * Design:
 * - Uses HeliusWsManager for WebSocket subscription
 * - Subscribes to logsSubscribe for Meteora program
 * - Parses logs using meteoraParser
 * - Handlers are responsible for DB insertion
 *
 * Key differences from BagsSource (Telegram):
 * - On-chain detection is faster and more reliable
 * - No dependency on external Telegram channel
 * - May not have symbol/name (requires separate metadata fetch)
 */
export class MeteoraOnChainSource {
  private config: MeteoraOnChainConfig;
  private wsManager: HeliusWsManager;
  private handlers: MeteoraSignalHandler[] = [];
  private running = false;
  private subscriptionRequestId: number | null = null;
  private programId: string;

  private stats = {
    logsReceived: 0,
    createEventsDetected: 0,
    parseFailures: 0,
    signalsEmitted: 0,
    handlerErrors: 0,
  };

  constructor(config: MeteoraOnChainConfig) {
    this.config = config;
    this.programId = config.programId || getMeteoraProgramId();
    this.wsManager = new HeliusWsManager();
  }

  /**
   * Check if the source is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Register a handler for detected signals
   */
  onSignal(handler: MeteoraSignalHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Get current statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Start monitoring the Meteora program
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[MeteoraOnChainSource] Source is disabled, not starting');
      return;
    }

    console.log('[MeteoraOnChainSource] Starting...');
    console.log(`[MeteoraOnChainSource] Program ID: ${this.programId}`);

    this.running = true;

    try {
      // Start WebSocket manager
      await this.wsManager.start();

      // Wait for connection
      await this.waitForConnection();

      // Subscribe to Meteora program logs
      this.subscribeToProgram();

      console.log('[MeteoraOnChainSource] Started and subscribed');
    } catch (error) {
      console.error('[MeteoraOnChainSource] Failed to start:', error);
      this.running = false;
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    console.log('[MeteoraOnChainSource] Stopping...');
    this.running = false;

    // Unsubscribe
    if (this.subscriptionRequestId !== null) {
      this.wsManager.unsubscribe(this.subscriptionRequestId);
      this.subscriptionRequestId = null;
    }

    // Stop WebSocket manager
    await this.wsManager.stop();

    console.log('[MeteoraOnChainSource] Stopped');
    this.logStats();
  }

  /**
   * Wait for WebSocket connection to be established
   */
  private waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wsManager.isConnected()) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 10000);

      const onConnected = () => {
        clearTimeout(timeout);
        this.wsManager.off('connected', onConnected);
        this.wsManager.off('error', onError);
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        this.wsManager.off('connected', onConnected);
        this.wsManager.off('error', onError);
        reject(error);
      };

      this.wsManager.on('connected', onConnected);
      this.wsManager.on('error', onError);
    });
  }

  /**
   * Subscribe to Meteora program logs
   */
  private subscribeToProgram(): void {
    this.subscriptionRequestId = this.wsManager.subscribe(
      this.programId,
      (notification: LogsNotification) => {
        this.handleLogsNotification(notification);
      }
    );

    console.log(
      `[MeteoraOnChainSource] Subscribed to program ${this.programId.slice(0, 12)}... ` +
        `(requestId: ${this.subscriptionRequestId})`
    );
  }

  /**
   * Handle incoming logs notification
   */
  private async handleLogsNotification(notification: LogsNotification): Promise<void> {
    this.stats.logsReceived++;

    // Skip failed transactions
    if (notification.err) {
      return;
    }

    const { signature, logs } = notification;

    // Parse logs to detect create events
    const result = parseMeteoraLogs(logs);

    if (!result.ok) {
      if (result.reason !== 'not_create_instruction') {
        this.stats.parseFailures++;
        console.log(
          `[MeteoraOnChainSource] Parse failed for ${signature.slice(0, 12)}...: ${result.reason}`
        );
      }
      return;
    }

    const event = result.event;

    // Validate the event
    if (!validateCreateEvent(event)) {
      this.stats.parseFailures++;
      console.log(
        `[MeteoraOnChainSource] Invalid event for ${signature.slice(0, 12)}...: validation failed`
      );
      return;
    }

    this.stats.createEventsDetected++;

    console.log(
      `[MeteoraOnChainSource] Detected new token: ${event.mint.slice(0, 12)}... ` +
        `(tx: ${signature.slice(0, 12)}...)`
    );

    // Build signal
    const signal: MeteoraOnChainSignal = {
      mint: event.mint,
      bondingCurve: event.bondingCurve,
      creator: event.creator,
      signature,
      slot: 0, // Slot not available in logs notification
      timestamp: Date.now(),
    };

    // Emit to handlers
    await this.emitSignal(signal);
  }

  /**
   * Emit signal to all registered handlers
   */
  private async emitSignal(signal: MeteoraOnChainSignal): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(signal);
        this.stats.signalsEmitted++;
      } catch (error) {
        this.stats.handlerErrors++;
        console.error('[MeteoraOnChainSource] Handler error:', error);
      }
    }
  }

  /**
   * Log statistics
   */
  private logStats(): void {
    console.log('[MeteoraOnChainSource] Session stats:', {
      logsReceived: this.stats.logsReceived,
      createEventsDetected: this.stats.createEventsDetected,
      parseFailures: this.stats.parseFailures,
      signalsEmitted: this.stats.signalsEmitted,
      handlerErrors: this.stats.handlerErrors,
    });
  }
}
