// =============================================================================
// RAPTOR Phase 4: Meteora On-Chain Source
// WebSocket listener for Meteora DBC token launches via Helius
// =============================================================================

import { HeliusWsManager, type LogsNotification } from '../monitors/heliusWs.js';
import { parseMeteoraLogs, validateCreateEvent, type MeteoraCreateEvent } from './meteoraParser.js';
import { getMeteoraProgramId, classifyError } from '@raptor/shared';

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

  // Circuit breaker: pause processing after consecutive failures
  private circuitBreaker = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    threshold: 5,
    resetTimeMs: 60000, // 60 seconds cooldown
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

    console.warn('[MeteoraOnChainSource] ⚠️  HEURISTIC DETECTION — uses log-pattern regex, not instruction decoding.');
    console.warn('[MeteoraOnChainSource] Enable only in staging or behind METEORA_ONCHAIN_ENABLED=true.');
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

    const { signature, logs, slot } = notification;

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
        `[MeteoraOnChainSource] REJECTED tx=${signature.slice(0, 12)}...: ` +
          `validation_failed mint=${event.mint.slice(0, 12)}... curve=${event.bondingCurve.slice(0, 12)}... creator=${event.creator.slice(0, 12)}...`
      );
      return;
    }

    this.stats.createEventsDetected++;

    console.log(
      `[MeteoraOnChainSource] LAUNCH mint=${event.mint.slice(0, 12)}... ` +
        `creator=${event.creator.slice(0, 12)}... curve=${event.bondingCurve.slice(0, 12)}... ` +
        `tx=${signature.slice(0, 12)}... slot=${slot}`
    );

    // Build signal
    const signal: MeteoraOnChainSignal = {
      mint: event.mint,
      bondingCurve: event.bondingCurve,
      creator: event.creator,
      signature,
      slot,
      timestamp: Date.now(),
    };

    // Emit to handlers
    await this.emitSignal(signal);
  }

  /**
   * Emit signal to all registered handlers
   */
  private async emitSignal(signal: MeteoraOnChainSignal): Promise<void> {
    // Check circuit breaker before processing
    if (!this.checkCircuitBreaker()) {
      console.log('[MeteoraOnChainSource] Circuit open - skipping signal');
      return;
    }

    let hadError = false;
    let lastError: unknown;

    for (const handler of this.handlers) {
      try {
        await handler(signal);
        this.stats.signalsEmitted++;
      } catch (error) {
        this.stats.handlerErrors++;
        hadError = true;
        lastError = error;
        console.error('[MeteoraOnChainSource] Handler error:', error);
      }
    }

    // Update circuit breaker based on outcome
    if (hadError) {
      this.recordFailure(lastError);
    } else {
      this.recordSuccess();
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

  // =============================================================================
  // Circuit Breaker (Phase 5)
  // =============================================================================

  /**
   * Check if processing should continue (circuit is closed)
   */
  private checkCircuitBreaker(): boolean {
    if (!this.circuitBreaker.isOpen) {
      return true;
    }

    // Check if cooldown period has elapsed
    if (Date.now() - this.circuitBreaker.lastFailure > this.circuitBreaker.resetTimeMs) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
      console.log('[MeteoraOnChainSource] Circuit breaker CLOSED - resuming processing');
      return true;
    }

    return false;
  }

  /**
   * Record a failure and potentially open the circuit
   */
  private recordFailure(error: unknown): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    const errorClass = classifyError(error);

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.isOpen = true;
      console.warn(
        `[MeteoraOnChainSource] Circuit breaker OPEN after ${this.circuitBreaker.failures} failures ` +
          `(last error class: ${errorClass}) - pausing for ${this.circuitBreaker.resetTimeMs / 1000}s`
      );
    }
  }

  /**
   * Record a success and reset failure count
   */
  private recordSuccess(): void {
    if (this.circuitBreaker.failures > 0) {
      this.circuitBreaker.failures = 0;
    }
  }
}
