// =============================================================================
// RAPTOR TP/SL Engine - Shared Types and Utilities
// =============================================================================

import type { ExitTrigger, TriggerState } from './types.js';

// Re-export TriggerState for convenience (defined in types.ts)
export type { TriggerState } from './types.js';

/**
 * Exit trigger priorities (lower = higher priority)
 * Used by ExitQueue to process critical exits first
 */
export const EXIT_PRIORITY: Record<ExitTrigger, number> = {
  EMERGENCY: 0,  // User override - highest priority
  SL: 10,        // Protect capital
  TP: 50,        // Take profits
  TRAIL: 60,     // Trailing stop
  MAXHOLD: 70,   // Time-based exit
  MANUAL: 80,    // User-initiated manual sell
};

/**
 * Compute TP and SL target prices from entry price and percentages
 *
 * @param entryPrice - Price per token at entry
 * @param tpPercent - Take profit percentage (e.g., 50 = 50% gain)
 * @param slPercent - Stop loss percentage (e.g., 30 = 30% loss)
 * @returns Computed target prices
 */
export function computeTpSlPrices(
  entryPrice: number,
  tpPercent: number,
  slPercent: number
): { tpPrice: number; slPrice: number } {
  return {
    tpPrice: entryPrice * (1 + tpPercent / 100),
    slPrice: entryPrice * (1 - slPercent / 100),
  };
}

/**
 * Compute trailing stop activation price
 *
 * @param entryPrice - Price per token at entry
 * @param activationPercent - Percentage gain required to activate trailing stop
 * @returns Activation price, or null if trailing not configured
 */
export function computeTrailActivationPrice(
  entryPrice: number,
  activationPercent: number | null
): number | null {
  if (activationPercent === null || activationPercent <= 0) {
    return null;
  }
  return entryPrice * (1 + activationPercent / 100);
}

/**
 * Compute trailing stop trigger price from peak price
 *
 * @param peakPrice - Highest price reached since entry
 * @param trailDistancePercent - Percentage drop from peak to trigger
 * @returns Trigger price
 */
export function computeTrailTriggerPrice(
  peakPrice: number,
  trailDistancePercent: number
): number {
  return peakPrice * (1 - trailDistancePercent / 100);
}

/**
 * Evaluate if a TP/SL trigger should fire
 *
 * @param currentPrice - Current token price
 * @param tpPrice - Take profit target price
 * @param slPrice - Stop loss target price
 * @param peakPrice - Highest price reached (for trailing stop)
 * @param trailActivationPrice - Price to activate trailing stop
 * @param trailDistancePercent - Trailing stop distance percentage
 * @returns The trigger type if threshold crossed, null otherwise
 */
export function evaluateTrigger(
  currentPrice: number,
  tpPrice: number | null,
  slPrice: number | null,
  peakPrice: number | null,
  trailActivationPrice: number | null,
  trailDistancePercent: number | null
): ExitTrigger | null {
  // Check SL first (protect capital)
  if (slPrice !== null && currentPrice <= slPrice) {
    return 'SL';
  }

  // Check trailing stop (if activated)
  if (
    trailActivationPrice !== null &&
    trailDistancePercent !== null &&
    peakPrice !== null &&
    peakPrice >= trailActivationPrice
  ) {
    const trailTriggerPrice = computeTrailTriggerPrice(peakPrice, trailDistancePercent);
    if (currentPrice <= trailTriggerPrice) {
      return 'TRAIL';
    }
  }

  // Check TP
  if (tpPrice !== null && currentPrice >= tpPrice) {
    return 'TP';
  }

  return null;
}

/**
 * Check if max hold time has been exceeded
 *
 * @param openedAt - When position was opened (ISO string or Date)
 * @param maxHoldMinutes - Maximum hold time in minutes
 * @returns true if max hold exceeded
 */
export function isMaxHoldExceeded(
  openedAt: string | Date,
  maxHoldMinutes: number
): boolean {
  const openedAtMs = new Date(openedAt).getTime();
  const nowMs = Date.now();
  const holdMinutes = (nowMs - openedAtMs) / 60000;
  return holdMinutes >= maxHoldMinutes;
}

/**
 * Configuration for TP/SL monitoring
 */
export interface TpSlConfig {
  /** Enable the TP/SL engine */
  enabled: boolean;
  /** Keep legacy position monitor running (for parallel migration) */
  legacyEnabled: boolean;
  /** Jupiter polling interval in milliseconds */
  pollIntervalMs: number;
  /** Maximum concurrent exits in queue */
  maxConcurrentExits: number;
  /** Price considered stale after this many seconds */
  staleAfterSeconds: number;
  /** Default slippage for SL exits (higher for faster execution) */
  slippageBpsSL: number;
  /** Default slippage for TP exits (lower for better fill) */
  slippageBpsTP: number;
}

/**
 * Default TP/SL configuration
 */
export const DEFAULT_TPSL_CONFIG: TpSlConfig = {
  enabled: false, // Feature-flagged off by default
  legacyEnabled: true, // Keep legacy running during migration
  pollIntervalMs: 3000, // 3 second Jupiter polling
  maxConcurrentExits: 3, // Max concurrent exit jobs
  staleAfterSeconds: 30, // Price stale after 30s
  slippageBpsSL: 1500, // 15% slippage for SL (fast exit)
  slippageBpsTP: 800, // 8% slippage for TP (better fill)
};

/**
 * Get TP/SL config from environment variables
 */
export function getTpSlConfig(): TpSlConfig {
  return {
    enabled: process.env.TPSL_ENGINE_ENABLED === 'true',
    legacyEnabled: process.env.LEGACY_POSITION_MONITOR !== 'false',
    pollIntervalMs: parseInt(process.env.TPSL_POLL_INTERVAL_MS || '3000', 10),
    maxConcurrentExits: parseInt(process.env.TPSL_MAX_CONCURRENT_EXITS || '3', 10),
    staleAfterSeconds: parseInt(process.env.TPSL_STALE_AFTER_SECONDS || '30', 10),
    slippageBpsSL: parseInt(process.env.TPSL_SLIPPAGE_BPS_SL || '1500', 10),
    slippageBpsTP: parseInt(process.env.TPSL_SLIPPAGE_BPS_TP || '800', 10),
  };
}

/**
 * Exit job for the execution queue
 */
export interface ExitJob {
  /** Position UUID */
  positionId: string;
  /** Token mint address */
  tokenMint: string;
  /** User telegram ID */
  userId: number;
  /** Exit trigger type */
  trigger: ExitTrigger;
  /** Price at trigger time */
  triggerPrice: number;
  /** Idempotency key for exactly-once execution */
  idempotencyKey: string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** When job was enqueued */
  enqueuedAt: Date;
  /** Slippage to use for this exit */
  slippageBps: number;
  /** Percentage of position to sell (100 = full exit) */
  sellPercent: number;
}
