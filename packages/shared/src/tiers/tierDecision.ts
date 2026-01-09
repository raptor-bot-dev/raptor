/**
 * Two-Tier Decision Logic for RAPTOR v2.2
 *
 * Determines whether to use FAST (<100ms) or FULL (1-3s) analysis:
 * - FAST: Trusted launchpad + fresh token + not manual snipe
 * - FULL: Manual snipes, unknown sources, old tokens
 */

// Trusted launchpad sources that get fast-path analysis
export const TRUSTED_SOURCES = new Set([
  // Solana
  'pump.fun',
  'pumpswap',
  'moonshot',
  'bonk.fun',
  'believe.app',

  // Base
  'virtuals.fun',
  'wow.xyz',
  'base.pump',

  // BSC
  'four.meme',

  // General (aggregators that pre-vet)
  'dexscreener_verified',
]);

// Source name normalization
const SOURCE_ALIASES: Record<string, string> = {
  'pump': 'pump.fun',
  'pumpfun': 'pump.fun',
  'pump_fun': 'pump.fun',
  'moonshot': 'moonshot',
  'bonk': 'bonk.fun',
  'bonkfun': 'bonk.fun',
  'believe': 'believe.app',
  'believeapp': 'believe.app',
  'virtuals': 'virtuals.fun',
  'virtualsprotocol': 'virtuals.fun',
  'wow': 'wow.xyz',
  'basepump': 'base.pump',
  'four': 'four.meme',
  'fourmeme': 'four.meme',
};

export type AnalysisTier = 'FAST' | 'FULL';

export interface TierDecisionInput {
  source: string;
  isManualSnipe: boolean;
  tokenAgeSeconds: number;
  liquidity?: bigint;
  minLiquidity?: bigint;
}

export interface TierDecisionResult {
  tier: AnalysisTier;
  reason: string;
  normalizedSource: string;
  isTrustedSource: boolean;
}

/**
 * Normalize source name for consistent lookups
 */
export function normalizeSource(source: string): string {
  const lower = source.toLowerCase().trim().replace(/[\s_-]+/g, '');
  return SOURCE_ALIASES[lower] || source.toLowerCase();
}

/**
 * Check if a source is trusted
 */
export function isTrustedSource(source: string): boolean {
  const normalized = normalizeSource(source);
  return TRUSTED_SOURCES.has(normalized);
}

/**
 * Decide which analysis tier to use
 *
 * FAST tier (<100ms) requirements:
 * 1. Token from trusted launchpad
 * 2. Not a manual snipe (manual = user wants full analysis)
 * 3. Fresh token (< 5 minutes old)
 * 4. Meets minimum liquidity (if provided)
 *
 * Everything else gets FULL tier (1-3s comprehensive analysis)
 */
export function decideTier(input: TierDecisionInput): TierDecisionResult {
  const normalizedSource = normalizeSource(input.source);
  const trusted = isTrustedSource(normalizedSource);

  // Manual snipes always get full analysis
  if (input.isManualSnipe) {
    return {
      tier: 'FULL',
      reason: 'Manual snipe - full analysis requested',
      normalizedSource,
      isTrustedSource: trusted,
    };
  }

  // Unknown/untrusted sources get full analysis
  if (!trusted) {
    return {
      tier: 'FULL',
      reason: `Unknown source: ${input.source}`,
      normalizedSource,
      isTrustedSource: false,
    };
  }

  // Old tokens (>5 min) get full analysis - might have developed issues
  const MAX_FAST_AGE_SECONDS = 300; // 5 minutes
  if (input.tokenAgeSeconds > MAX_FAST_AGE_SECONDS) {
    return {
      tier: 'FULL',
      reason: `Token too old for fast path (${input.tokenAgeSeconds}s > ${MAX_FAST_AGE_SECONDS}s)`,
      normalizedSource,
      isTrustedSource: trusted,
    };
  }

  // Check minimum liquidity if provided
  if (input.liquidity !== undefined && input.minLiquidity !== undefined) {
    if (input.liquidity < input.minLiquidity) {
      return {
        tier: 'FULL',
        reason: `Liquidity below minimum - needs full analysis`,
        normalizedSource,
        isTrustedSource: trusted,
      };
    }
  }

  // All checks passed - use fast tier
  return {
    tier: 'FAST',
    reason: `Trusted source (${normalizedSource}), fresh token (${input.tokenAgeSeconds}s old)`,
    normalizedSource,
    isTrustedSource: trusted,
  };
}

/**
 * Get the list of trusted sources (for display/debugging)
 */
export function getTrustedSources(): string[] {
  return Array.from(TRUSTED_SOURCES);
}

/**
 * Add a source to trusted list at runtime
 * (useful for adding new launchpads without restart)
 */
export function addTrustedSource(source: string): void {
  TRUSTED_SOURCES.add(normalizeSource(source));
}

/**
 * Remove a source from trusted list at runtime
 * (useful if a launchpad becomes compromised)
 */
export function removeTrustedSource(source: string): boolean {
  return TRUSTED_SOURCES.delete(normalizeSource(source));
}
