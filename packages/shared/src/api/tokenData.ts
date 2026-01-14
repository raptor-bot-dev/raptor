/**
 * Unified Token Data Service for RAPTOR
 *
 * Combines data from multiple sources:
 * - DexScreener (all chains, free)
 * - Birdeye (Solana-specific, requires API key)
 *
 * Provides graceful fallback when APIs fail
 */

import type { Chain } from '../types.js';
import * as dexscreener from './dexscreener.js';
import * as birdeye from './birdeye.js';

export interface TokenInfo {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  decimals?: number;

  // Price data
  priceUsd: number | null;
  priceNative: number | null;
  priceChange24h: number | null;

  // Market data
  marketCap: number | null;
  fdv: number | null;
  liquidity: number | null;
  volume24h: number | null;

  // Activity
  holders: number | null;
  txns24h: { buys: number; sells: number } | null;

  // Trading info
  pairAddress: string | null;
  dex: string | null;
  pairCreatedAt: number | null;

  // Metadata
  imageUrl?: string;
  website?: string;
  twitter?: string;
  telegram?: string;

  // Security flags
  securityFlags: string[];
  riskScore: number | null; // 0-100, higher is safer

  // Data source info
  dataSource: 'dexscreener' | 'birdeye' | 'rpc' | 'mixed';
  lastUpdated: number;
}

/**
 * Get comprehensive token data
 * Tries multiple sources and combines results
 */
export async function getTokenInfo(
  address: string,
  chain?: Chain
): Promise<TokenInfo | null> {
  // Try DexScreener first (works for all chains)
  const dexResult = chain
    ? await dexscreener.getTokenOnChain(address, chain)
    : (await dexscreener.getTokenByAddress(address)).data;

  // For Solana, also try Birdeye for additional data
  const detectedChain = chain || dexResult?.chain;
  let birdeyeData: birdeye.BirdeyeTokenOverview | null = null;
  let securityData: { score: number; flags: string[] } | null = null;

  if (detectedChain === 'sol' && birdeye.isConfigured()) {
    const [overview, security] = await Promise.all([
      birdeye.getTokenOverview(address),
      birdeye.analyzeTokenRisk(address),
    ]);
    birdeyeData = overview;
    securityData = security;
  }

  // No data from any source
  if (!dexResult && !birdeyeData) {
    return null;
  }

  // Combine data from all sources
  const tokenInfo: TokenInfo = {
    address,
    chain: detectedChain || 'sol',
    name: dexResult?.name || birdeyeData?.name || 'Unknown',
    symbol: dexResult?.symbol || birdeyeData?.symbol || '???',
    decimals: birdeyeData?.decimals,

    priceUsd: dexResult?.priceUsd ?? birdeyeData?.price ?? null,
    priceNative: dexResult?.priceNative ?? null,
    priceChange24h: dexResult?.priceChange24h ?? birdeyeData?.priceChange24hPercent ?? null,

    marketCap: dexResult?.marketCap ?? birdeyeData?.mc ?? null,
    fdv: dexResult?.fdv ?? null,
    liquidity: dexResult?.liquidity ?? birdeyeData?.liquidity ?? null,
    volume24h: dexResult?.volume24h ?? birdeyeData?.v24hUSD ?? null,

    holders: birdeyeData?.holder ?? null,
    txns24h: dexResult?.txns24h ?? (birdeyeData ? {
      buys: birdeyeData.buy24h,
      sells: birdeyeData.sell24h,
    } : null),

    pairAddress: dexResult?.pairAddress ?? null,
    dex: dexResult?.dex ?? null,
    pairCreatedAt: dexResult?.pairCreatedAt ?? null,

    imageUrl: dexResult?.imageUrl ?? birdeyeData?.logoURI,
    website: birdeyeData?.extensions?.website,
    twitter: birdeyeData?.extensions?.twitter,
    telegram: birdeyeData?.extensions?.telegram,

    securityFlags: securityData?.flags ?? [],
    riskScore: securityData?.score ?? null,

    dataSource: birdeyeData && dexResult ? 'mixed' : (dexResult ? 'dexscreener' : 'birdeye'),
    lastUpdated: Date.now(),
  };

  return tokenInfo;
}

/**
 * Get token data with chain auto-detection
 * Returns the token and all chains it exists on
 */
export async function getTokenWithChainDetection(
  address: string
): Promise<{ token: TokenInfo | null; chains: Chain[] }> {
  const { data, chains } = await dexscreener.getTokenByAddress(address);

  if (!data) {
    return { token: null, chains };
  }

  // Get full token info for the best chain
  const token = await getTokenInfo(address, data.chain);

  return { token, chains };
}

/**
 * Detect which chains a token exists on
 */
export async function detectTokenChains(address: string): Promise<Chain[]> {
  return dexscreener.detectTokenChains(address);
}

/**
 * Get quick price data only (faster than full token info)
 */
export async function getTokenPrice(
  address: string,
  chain?: Chain
): Promise<{ priceUsd: number; priceNative: number } | null> {
  const data = chain
    ? await dexscreener.getTokenOnChain(address, chain)
    : (await dexscreener.getTokenByAddress(address)).data;

  if (!data) {
    return null;
  }

  return {
    priceUsd: data.priceUsd,
    priceNative: data.priceNative,
  };
}

/**
 * Format price for display
 */
export function formatPrice(price: number | null): string {
  if (price === null) return 'N/A';
  if (price === 0) return '$0';

  if (price < 0.00000001) {
    return `$${price.toExponential(2)}`;
  }
  if (price < 0.0001) {
    return `$${price.toFixed(10).replace(/\.?0+$/, '')}`;
  }
  if (price < 1) {
    return `$${price.toFixed(6).replace(/\.?0+$/, '')}`;
  }
  if (price < 1000) {
    return `$${price.toFixed(2)}`;
  }
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Format market cap/volume for display
 */
export function formatLargeNumber(num: number | null): string {
  if (num === null) return 'N/A';
  if (num === 0) return '$0';

  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(2)}K`;
  }
  return `$${num.toFixed(2)}`;
}

/**
 * Format percentage for display
 */
export function formatPercentage(pct: number | null): string {
  if (pct === null) return 'N/A';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Get security badge based on risk score
 */
export function getSecurityBadge(riskScore: number | null): {
  emoji: string;
  label: string;
  color: 'green' | 'yellow' | 'red';
} {
  if (riskScore === null) {
    return { emoji: '❓', label: 'Unverified', color: 'yellow' };
  }
  if (riskScore >= 80) {
    return { emoji: '✅', label: 'Safe', color: 'green' };
  }
  if (riskScore >= 50) {
    return { emoji: '⚠️', label: 'Caution', color: 'yellow' };
  }
  return { emoji: '🚨', label: 'Risky', color: 'red' };
}
