// =============================================================================
// RAPTOR Phase 4: Meteora On-Chain Source
// WebSocket listener for Meteora DBC token launches via Helius
// =============================================================================

import { HeliusWsManager, type LogsNotification } from '../monitors/heliusWs.js';
import { parseMeteoraLogs, isCreateInstruction, validateCreateEvent, type MeteoraCreateEvent } from './meteoraParser.js';
import { findAndDecodeCreateInstruction } from './meteoraInstructionDecoder.js';
import { getMeteoraProgramId, classifyError, SOLANA_CONFIG } from '@raptor/shared';

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

    console.warn('[MeteoraOnChainSource] ⚠️  On-chain detection enabled (METEORA_ONCHAIN_ENABLED=true).');
    console.warn('[MeteoraOnChainSource] Two-layer: log prefilter → fetch tx → IDL discriminator decoder.');
    console.warn('[MeteoraOnChainSource] If RPC fetch fails, may fall back to heuristic address extraction.');
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
   *
   * Two-layer detection:
   *   Layer 1 — Tightened log heuristic pre-filter (fast, may have rare false positives)
   *   Layer 2 — Fetch full transaction + IDL instruction decoder (accurate)
   */
  private async handleLogsNotification(notification: LogsNotification): Promise<void> {
    this.stats.logsReceived++;

    // Debug: log every 100th notification and the first 3
    if (this.stats.logsReceived <= 3 || this.stats.logsReceived % 100 === 0) {
      console.log(`[MeteoraOnChainSource] DEBUG: logsReceived=${this.stats.logsReceived}, sig=${notification.signature?.slice(0, 16)}..., err=${!!notification.err}, logs=${notification.logs?.length}`);
    }

    // Debug: log any notification with 60+ log lines (potential creates)
    if (notification.logs?.length >= 60) {
      const hasInit = notification.logs.some(l => l.includes('InitializeVirtualPool'));
      console.log(`[MeteoraOnChainSource] LARGE TX: sig=${notification.signature?.slice(0, 20)}..., logs=${notification.logs.length}, hasInit=${hasInit}, err=${!!notification.err}`);
      if (hasInit) {
        console.log(`[MeteoraOnChainSource] CREATE CANDIDATE: ${notification.logs.slice(4, 7).join(' | ')}`);
      }
    }

    // Skip failed transactions
    if (notification.err) {
      return;
    }

    const { signature, logs, slot } = notification;

    // Layer 1: Quick log pre-filter — check if this is a create instruction
    // Only check instruction name, don't try to extract addresses from logs
    // (addresses are in tx account keys, not log text)
    if (!isCreateInstruction(logs)) {
      return;
    }

    this.stats.createEventsDetected++;

    console.log(
      `[MeteoraOnChainSource] Potential create detected, fetching tx ${signature.slice(0, 12)}...`
    );

    // Layer 2: Fetch full transaction and use proper IDL decoder
    let event: MeteoraCreateEvent | null = null;
    try {
      const tx = await this.fetchTransaction(signature);
      if (tx) {
        event = findAndDecodeCreateInstruction(tx, this.programId);
      }
    } catch (error) {
      console.error(
        `[MeteoraOnChainSource] fetchTransaction error for ${signature.slice(0, 12)}...:`,
        (error as Error).message
      );
    }

    // Fallback: if RPC fetch failed, try heuristic address extraction from logs
    if (!event) {
      const heuristicResult = parseMeteoraLogs(logs);
      if (heuristicResult.ok && validateCreateEvent(heuristicResult.event)) {
        event = heuristicResult.event;
        console.warn(
          `[MeteoraOnChainSource] Using heuristic fallback for ${signature.slice(0, 12)}...`
        );
      }
    }

    if (!event) {
      this.stats.parseFailures++;
      console.log(
        `[MeteoraOnChainSource] REJECTED tx=${signature.slice(0, 12)}...: decoder_failed`
      );
      return;
    }

    // Final validation (defense-in-depth)
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
   * Fetch full transaction data via HTTP RPC for accurate instruction decoding.
   * Uses json encoding (not jsonParsed) to get raw instruction data + account indices.
   * Merges static account keys with loaded addresses for v0 transactions.
   * Returns both top-level AND inner instructions (CPI calls).
   */
  private async fetchTransaction(signature: string): Promise<{
    message: {
      accountKeys: string[];
      instructions: Array<{
        programIdIndex: number;
        accounts: number[];
        data: string;
      }>;
      innerInstructions: Array<{
        programIdIndex: number;
        accounts: number[];
        data: string;
      }>;
    };
  } | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(SOLANA_CONFIG.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            { encoding: 'json', maxSupportedTransactionVersion: 0 },
          ],
        }),
        signal: controller.signal,
      });

      interface InnerInstruction {
        programIdIndex: number;
        accounts: number[];
        data: string;
      }

      interface GetTxResponse {
        result?: {
          transaction?: {
            message?: {
              accountKeys?: Array<string | { pubkey?: string }>;
              instructions?: Array<{
                programIdIndex: number;
                accounts: number[];
                data: string;
              }>;
            };
          };
          meta?: {
            loadedAddresses?: {
              writable?: string[];
              readonly?: string[];
            };
            innerInstructions?: Array<{
              index: number;
              instructions: InnerInstruction[];
            }>;
          };
        };
      }

      const data = (await response.json()) as GetTxResponse;
      const tx = data.result;
      if (!tx?.transaction?.message) return null;

      // Merge static account keys with loaded addresses (for v0 transactions with ALTs)
      const rawKeys = tx.transaction.message.accountKeys || [];
      const staticKeys: string[] = rawKeys
        .map((k) => (typeof k === 'string' ? k : k?.pubkey))
        .filter((k): k is string => typeof k === 'string' && k.length > 0);
      const loaded = tx.meta?.loadedAddresses;
      const allKeys = loaded
        ? [...staticKeys, ...(loaded.writable || []), ...(loaded.readonly || [])]
        : staticKeys;

      // Flatten all inner instructions (CPI calls) into a single array
      const innerIxGroups = tx.meta?.innerInstructions || [];
      const flatInnerIxs: InnerInstruction[] = [];
      for (const group of innerIxGroups) {
        for (const ix of group.instructions) {
          flatInnerIxs.push(ix);
        }
      }

      return {
        message: {
          accountKeys: allKeys,
          instructions: tx.transaction.message.instructions || [],
          innerInstructions: flatInnerIxs,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
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
