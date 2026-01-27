// =============================================================================
// RAPTOR v4.5 Hybrid Pricing Module
// Fetches token prices with Jupiter primary + DEXScreener + pump.fun fallback
// =============================================================================

import { getTokenInfo } from './api/pumpfun.js';
import { getTokenByAddress } from './api/dexscreener.js';
import { getBondingCurveSnapshot, getMintInfo } from './pumpfun/onchain.js';

// Jupiter Price API v2
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

// Request timeout
const API_TIMEOUT_MS = 5000;

// Simple in-memory cache (30 second TTL)
const priceCache = new Map<string, { price: number; source: PriceSource; expiry: number }>();
const CACHE_TTL_MS = 30_000;

export type PriceSource = 'jupiter' | 'dexscreener' | 'pumpfun' | 'onchain' | 'none';

export interface PriceResult {
  price: number;
  source: PriceSource;
}

/**
 * Get prices for multiple tokens using Jupiter batch API with DEXScreener + pump.fun fallback
 *
 * Strategy:
 * 1. Try Jupiter batch API first (handles graduated tokens via DEX)
 * 2. For missing prices, try DEXScreener API (handles most tokens)
 * 3. For still missing prices, try pump.fun API (handles bonding curve tokens)
 * 4. Return 0 with source='none' for unavailable prices
 *
 * @param mints - Array of token mint addresses
 * @returns Record mapping mint -> { price, source }
 */
export async function getTokenPrices(mints: string[]): Promise<Record<string, PriceResult>> {
  if (mints.length === 0) {
    return {};
  }

  const results: Record<string, PriceResult> = {};
  const now = Date.now();

  // Check cache first
  const uncachedMints: string[] = [];
  for (const mint of mints) {
    const cached = priceCache.get(mint);
    if (cached && now < cached.expiry) {
      results[mint] = { price: cached.price, source: cached.source };
    } else {
      uncachedMints.push(mint);
    }
  }

  if (uncachedMints.length === 0) {
    return results;
  }

  // Try Jupiter batch API first
  try {
    const ids = uncachedMints.join(',');
    const response = await fetch(`${JUPITER_PRICE_API}?ids=${ids}&vsToken=So11111111111111111111111111111111111111112`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (response.ok) {
      const data = await response.json() as { data?: Record<string, { price: number }> };

      for (const mint of uncachedMints) {
        const priceData = data.data?.[mint];
        if (priceData?.price && priceData.price > 0) {
          const result: PriceResult = { price: priceData.price, source: 'jupiter' };
          results[mint] = result;
          priceCache.set(mint, { ...result, expiry: now + CACHE_TTL_MS });
        }
      }
    }
  } catch (error) {
    console.warn('[Pricing] Jupiter batch price fetch failed:', error);
  }

  // Fallback 1: DEXScreener API for missing prices (more reliable than pump.fun API)
  let missingMints = uncachedMints.filter(m => !results[m]);
  if (missingMints.length > 0) {
    await Promise.all(
      missingMints.map(async (mint) => {
        try {
          const { data: tokenData } = await getTokenByAddress(mint);
          // DEXScreener returns priceNative which is price in SOL
          if (tokenData?.priceNative && tokenData.priceNative > 0) {
            const result: PriceResult = { price: tokenData.priceNative, source: 'dexscreener' };
            results[mint] = result;
            priceCache.set(mint, { ...result, expiry: now + CACHE_TTL_MS });
          }
        } catch (error) {
          console.warn(`[Pricing] DEXScreener price fetch failed for ${mint}:`, error);
        }
      })
    );
  }

  // Fallback 2: pump.fun API for still missing prices (may be blocked by Cloudflare)
  missingMints = uncachedMints.filter(m => !results[m]);
  if (missingMints.length > 0) {
    await Promise.all(
      missingMints.map(async (mint) => {
        try {
          const tokenInfo = await getTokenInfo(mint);
          if (tokenInfo?.priceInSol && tokenInfo.priceInSol > 0) {
            const result: PriceResult = { price: tokenInfo.priceInSol, source: 'pumpfun' };
            results[mint] = result;
            priceCache.set(mint, { ...result, expiry: now + CACHE_TTL_MS });
          }
        } catch (error) {
          console.warn(`[Pricing] pump.fun price fetch failed for ${mint}:`, error);
        }
      })
    );
  }

  // Fallback 3: On-chain bonding curve (handles pump.pro when API is down)
  missingMints = uncachedMints.filter(m => !results[m]);
  if (missingMints.length > 0) {
    await Promise.all(
      missingMints.map(async (mint) => {
        try {
          const snapshot = await getBondingCurveSnapshot(mint);
          if (!snapshot) {
            return;
          }

          const mintInfo = await getMintInfo(mint);
          const decimals = mintInfo?.decimals ?? 6;

          const solReserves = Number(snapshot.state.virtualSolReserves) / 1e9;
          const tokenReserves = Number(snapshot.state.virtualTokenReserves) / Math.pow(10, decimals);
          if (tokenReserves <= 0) {
            return;
          }

          const price = solReserves / tokenReserves;
          if (price > 0) {
            const result: PriceResult = { price, source: 'onchain' };
            results[mint] = result;
            priceCache.set(mint, { ...result, expiry: now + CACHE_TTL_MS });
          }
        } catch (error) {
          console.warn(`[Pricing] On-chain price fetch failed for ${mint}:`, error);
        }
      })
    );
  }

  // Set 'none' for any remaining missing prices
  for (const mint of uncachedMints) {
    if (!results[mint]) {
      results[mint] = { price: 0, source: 'none' };
      // Don't cache 'none' results - allow retry on next request
    }
  }

  return results;
}

/**
 * Get price for a single token
 * Convenience wrapper around getTokenPrices
 */
export async function getTokenPrice(mint: string): Promise<PriceResult> {
  const results = await getTokenPrices([mint]);
  return results[mint] || { price: 0, source: 'none' };
}

/**
 * Clear the price cache (useful for testing)
 */
export function clearPriceCache(): void {
  priceCache.clear();
}

// =============================================================================
// Phase 3: Position-Aware Pricing
// =============================================================================

/**
 * Pricing source type (matches DB constraint)
 */
export type PositionPricingSource = 'BONDING_CURVE' | 'AMM_POOL';

/**
 * Position-like object with pricing source field
 */
export interface PriceablePosition {
  token_mint: string;
  pricing_source?: PositionPricingSource | null;
}

/**
 * Get price for a position, respecting its pricing source.
 *
 * This function ensures price consistency across lifecycle transitions:
 * - PRE_GRADUATION positions use bonding curve pricing
 * - POST_GRADUATION positions use AMM pool pricing (Jupiter/DEXScreener)
 *
 * The fallback chain differs based on pricing source:
 * - BONDING_CURVE: onchain > pumpfun > jupiter > dexscreener
 * - AMM_POOL: jupiter > dexscreener > onchain > pumpfun
 *
 * @param position Position with token_mint and optional pricing_source
 * @returns Price result with price and source
 */
export async function getPositionPrice(position: PriceablePosition): Promise<PriceResult> {
  const mint = position.token_mint;
  const pricingSource = position.pricing_source || 'BONDING_CURVE';

  // For bonding curve positions, prefer on-chain pricing
  if (pricingSource === 'BONDING_CURVE') {
    return await getBondingCurvePriceFirst(mint);
  }

  // For AMM pool positions, prefer Jupiter/DEXScreener
  return await getAmmPoolPriceFirst(mint);
}

/**
 * Get price with bonding curve sources prioritized.
 * Used for PRE_GRADUATION positions.
 */
async function getBondingCurvePriceFirst(mint: string): Promise<PriceResult> {
  const now = Date.now();

  // Check cache first
  const cached = priceCache.get(mint);
  if (cached && now < cached.expiry) {
    return { price: cached.price, source: cached.source };
  }

  // 1. Try on-chain bonding curve first
  try {
    const snapshot = await getBondingCurveSnapshot(mint);
    if (snapshot) {
      const mintInfo = await getMintInfo(mint);
      const decimals = mintInfo?.decimals ?? 6;

      const solReserves = Number(snapshot.state.virtualSolReserves) / 1e9;
      const tokenReserves = Number(snapshot.state.virtualTokenReserves) / Math.pow(10, decimals);

      if (tokenReserves > 0) {
        const price = solReserves / tokenReserves;
        if (price > 0) {
          const result: PriceResult = { price, source: 'onchain' };
          priceCache.set(mint, { ...result, expiry: now + CACHE_TTL_MS });
          return result;
        }
      }
    }
  } catch {
    // Continue to fallbacks
  }

  // 2. Try pump.fun API
  try {
    const tokenInfo = await getTokenInfo(mint);
    if (tokenInfo?.priceInSol && tokenInfo.priceInSol > 0) {
      const result: PriceResult = { price: tokenInfo.priceInSol, source: 'pumpfun' };
      priceCache.set(mint, { ...result, expiry: now + CACHE_TTL_MS });
      return result;
    }
  } catch {
    // Continue to fallbacks
  }

  // 3. Fall back to standard getTokenPrice (Jupiter -> DEXScreener)
  return await getTokenPrice(mint);
}

/**
 * Get price with AMM pool sources prioritized.
 * Used for POST_GRADUATION positions.
 */
async function getAmmPoolPriceFirst(mint: string): Promise<PriceResult> {
  // Standard getTokenPrice already prioritizes Jupiter -> DEXScreener -> pump.fun -> onchain
  // This is the optimal order for AMM pool pricing
  return await getTokenPrice(mint);
}
