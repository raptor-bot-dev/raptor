// =============================================================================
// RAPTOR Phase 1: Bags.fm Signal Source
// Telegram channel monitoring for Bags.fm launch signals
// =============================================================================

import { Bot } from 'grammy';
import { parseBagsMessage, type BagsSignal, type BagsParseResult } from './bagsParser.js';
import { BagsDeduplicator } from './bagsDeduplicator.js';
import { classifyError } from '@raptor/shared';

/**
 * Configuration for BagsSource.
 */
export interface BagsSourceConfig {
  /** Telegram bot token for channel monitoring */
  botToken: string;
  /** Channel ID or username to monitor (e.g., "@bagsfm_signals" or -1001234567890) */
  channelId: string | number;
  /** Whether the source is enabled */
  enabled: boolean;
  /** Deduplication TTL in milliseconds (default: 60000) */
  dedupeTtlMs?: number;
}

/**
 * Handler function type for processed signals.
 */
export type BagsSignalHandler = (signal: BagsSignal) => Promise<void>;

/**
 * BagsSource monitors a Telegram channel for Bags.fm launch signals
 * and emits normalized LaunchCandidates for downstream processing.
 *
 * Design:
 * - Uses grammy bot to receive channel posts
 * - Parses messages using strict bagsParser
 * - Deduplicates using in-memory layer before handlers
 * - Handlers are responsible for DB insertion
 *
 * Note: The bot must be added to the channel as a member to receive messages.
 */
export class BagsSource {
  private config: BagsSourceConfig;
  private bot: Bot | null = null;
  private handlers: BagsSignalHandler[] = [];
  private deduplicator: BagsDeduplicator;
  private running = false;
  private stats = {
    messagesReceived: 0,
    parseSuccesses: 0,
    parseFailures: 0,
    duplicatesFiltered: 0,
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

  constructor(config: BagsSourceConfig) {
    this.config = config;
    this.deduplicator = new BagsDeduplicator({
      ttlMs: config.dedupeTtlMs ?? 60_000,
    });
  }

  /**
   * Check if the source is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Register a handler for processed signals.
   * Handlers receive normalized BagsSignal objects.
   */
  onSignal(handler: BagsSignalHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Start monitoring the Telegram channel.
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[BagsSource] Source is disabled, not starting');
      return;
    }

    if (!this.config.botToken) {
      console.error('[BagsSource] No bot token configured, cannot start');
      return;
    }

    if (!this.config.channelId) {
      console.error('[BagsSource] No channel ID configured, cannot start');
      return;
    }

    console.log('[BagsSource] Starting...');
    this.running = true;

    try {
      this.bot = new Bot(this.config.botToken);

      // Handle channel posts
      this.bot.on('channel_post:text', async (ctx) => {
        // If the bot is in multiple channels, ensure we only process the configured channel.
        if (!this.isConfiguredChannel(ctx.channelPost.chat.id, ctx.channelPost.chat.username)) return;
        await this.handleChannelPost(ctx.channelPost.text || '', ctx.channelPost.date);
      });

      // Handle edited channel posts (in case signals are corrected)
      this.bot.on('edited_channel_post:text', async (ctx) => {
        if (!this.isConfiguredChannel(ctx.editedChannelPost.chat.id, ctx.editedChannelPost.chat.username)) return;
        await this.handleChannelPost(ctx.editedChannelPost.text || '', ctx.editedChannelPost.date);
      });

      // Error handling
      this.bot.catch((err) => {
        console.error('[BagsSource] Bot error:', err.message);
      });

      // Start polling
      // Note: Using long polling for simplicity. Webhook mode would require infrastructure.
      this.bot.start({
        drop_pending_updates: true, // Don't process old messages on startup
        onStart: (botInfo) => {
          console.log(`[BagsSource] Connected as @${botInfo.username}`);
          console.log(`[BagsSource] Monitoring channel: ${this.config.channelId}`);
        },
      });

      console.log('[BagsSource] Started successfully');
    } catch (error) {
      console.error('[BagsSource] Failed to start:', error);
      this.running = false;
      throw error;
    }
  }

  /**
   * Stop monitoring.
   */
  async stop(): Promise<void> {
    console.log('[BagsSource] Stopping...');
    this.running = false;

    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }

    console.log('[BagsSource] Stopped');
    this.logStats();
  }

  /**
   * Get current statistics.
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Handle an incoming channel post.
   */
  private async handleChannelPost(text: string, unixTimestamp: number): Promise<void> {
    if (!this.running) return;

    this.stats.messagesReceived++;

    // Parse the message
    const result = parseBagsMessage(text, unixTimestamp * 1000);

    if (!result.ok) {
      this.stats.parseFailures++;
      // Only log if it looks like it might have been a signal (contains potential mint patterns)
      if (text.length > 32 && /[1-9A-HJ-NP-Za-km-z]{20,}/.test(text)) {
        console.log(`[BagsSource] Parse failed: ${result.reason} (${text.slice(0, 50)}...)`);
      }
      return;
    }

    this.stats.parseSuccesses++;
    const signal = result.candidate;

    // Check for duplicates
    if (this.deduplicator.checkAndMark(signal.mint)) {
      this.stats.duplicatesFiltered++;
      console.log(`[BagsSource] Duplicate filtered: ${signal.mint.slice(0, 12)}...`);
      return;
    }

    console.log(
      `[BagsSource] Signal received: ${signal.symbol || 'UNKNOWN'} ` +
        `(${signal.mint.slice(0, 12)}...)`
    );

    // Check circuit breaker before emitting
    if (!this.checkCircuitBreaker()) {
      console.log('[BagsSource] Circuit open - skipping signal');
      return;
    }

    // Emit to handlers
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
        console.error('[BagsSource] Handler error:', error);
      }
    }

    // Update circuit breaker based on outcome
    if (hadError) {
      this.recordFailure(lastError);
    } else {
      this.recordSuccess();
    }
  }

  private isConfiguredChannel(chatId: number, username?: string | null): boolean {
    const configured = this.config.channelId;
    if (typeof configured === 'number') {
      return chatId === configured;
    }
    const configuredStr = String(configured);
    if (configuredStr.startsWith('@')) {
      return !!username && `@${username}`.toLowerCase() === configuredStr.toLowerCase();
    }
    // Allow numeric IDs passed as strings (e.g. "-100123...")
    const asNumber = Number(configuredStr);
    if (!Number.isNaN(asNumber)) {
      return chatId === asNumber;
    }
    return false;
  }

  /**
   * Log statistics summary.
   */
  private logStats(): void {
    console.log('[BagsSource] Stats:', {
      received: this.stats.messagesReceived,
      parsed: this.stats.parseSuccesses,
      failed: this.stats.parseFailures,
      dupes: this.stats.duplicatesFiltered,
      emitted: this.stats.signalsEmitted,
      errors: this.stats.handlerErrors,
    });
  }

  /**
   * Process a message manually (for testing).
   * This bypasses the Telegram connection but tracks stats.
   */
  async processMessage(text: string, timestamp?: number): Promise<BagsParseResult> {
    this.stats.messagesReceived++;
    const ts = timestamp ?? Date.now();
    const result = parseBagsMessage(text, ts);

    if (!result.ok) {
      this.stats.parseFailures++;
      return result;
    }

    this.stats.parseSuccesses++;

    if (this.deduplicator.checkAndMark(result.candidate.mint)) {
      this.stats.duplicatesFiltered++;
      return result;
    }

    for (const handler of this.handlers) {
      try {
        await handler(result.candidate);
        this.stats.signalsEmitted++;
      } catch (error) {
        this.stats.handlerErrors++;
        console.error('[BagsSource] Handler error in processMessage:', error);
      }
    }

    return result;
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
      console.log('[BagsSource] Circuit breaker CLOSED - resuming processing');
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
        `[BagsSource] Circuit breaker OPEN after ${this.circuitBreaker.failures} failures ` +
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

/**
 * Create a BagsSource from environment variables.
 * Environment variables:
 * - BAGS_BOT_TOKEN: Telegram bot token for channel monitoring
 * - BAGS_CHANNEL_ID: Channel ID or username
 * - BAGS_SOURCE_ENABLED: "true" to enable
 */
export function createBagsSourceFromEnv(): BagsSource {
  return new BagsSource({
    botToken: process.env.BAGS_BOT_TOKEN || '',
    channelId: process.env.BAGS_CHANNEL_ID || '',
    enabled: process.env.BAGS_SOURCE_ENABLED === 'true',
    dedupeTtlMs: parseInt(process.env.BAGS_DEDUPE_TTL_MS || '60000', 10),
  });
}
