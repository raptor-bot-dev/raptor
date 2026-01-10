/**
 * DexScreener API Service for RAPTOR
 *
 * Provides token data from DexScreener's free API:
 * - Token price, volume, liquidity, market cap
 * - Trading pairs and DEX info
 * - Auto-detects chain from response
 */

import type { Chain } from '../types.js';

// DexScreener API base URL
const DEXSCREENER_API = 'https://api.dexscreener.com/latest';

// Map DexScreener chain IDs to our chain types
const CHAIN_MAP: Record<string, Chain> = {
  solana: 'sol',
  bsc: 'bsc',
  base: 'base',
  ethereum: 'eth',
};

// Reverse map for lookups
const CHAIN_TO_DEXSCREENER: Record<Chain, string> = {
  sol: 'solana',
  bsc: 'bsc',
  base: 'base',
  eth: 'ethereum',
};

// DexScreener pair response types
export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

// Normalized token data we return
export interface DexScreenerTokenData {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  priceUsd: number;
  priceNative: number;
  marketCap: number | null;
  fdv: number | null;
  liquidity: number;
  volume24h: number;
  priceChange24h: number;
  txns24h: { buys: number; sells: number };
  pairAddress: string;
  dex: string;
  pairCreatedAt: number | null;
  imageUrl?: string;
}

// Simple in-memory cache
const cache = new Map<string, { data: DexScreenerTokenData; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get token data from DexScreener by address
 * Auto-detects chain from response
 */
export async function getTokenByAddress(
  address: string
): Promise<{ data: DexScreenerTokenData | null; chains: Chain[] }> {
  const cacheKey = address.toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return { data: cached.data, chains: [cached.data.chain] };
  }

  try {
    const response = await fetch(
      `${DEXSCREENER_API}/dex/tokens/${address}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      console.error(`[DexScreener] API error: ${response.status}`);
      return { data: null, chains: [] };
    }

    const json = await response.json() as DexScreenerResponse;

    if (!json.pairs || json.pairs.length === 0) {
      return { data: null, chains: [] };
    }

    // Get all unique chains where this token exists
    const chainsFound = new Set<Chain>();
    for (const pair of json.pairs) {
      const chain = CHAIN_MAP[pair.chainId];
      if (chain) {
        chainsFound.add(chain);
      }
    }

    // Find the pair with highest liquidity
    const bestPair = json.pairs
      .filter((p) => CHAIN_MAP[p.chainId])
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    if (!bestPair) {
      return { data: null, chains: Array.from(chainsFound) };
    }

    const tokenData = normalizePairData(bestPair);

    // Cache the result
    cache.set(cacheKey, {
      data: tokenData,
      expiry: Date.now() + CACHE_TTL,
    });

    return { data: tokenData, chains: Array.from(chainsFound) };
  } catch (error) {
    console.error('[DexScreener] Fetch error:', error);
    return { data: null, chains: [] };
  }
}

/**
 * Get token data for a specific chain
 */
export async function getTokenOnChain(
  address: string,
  chain: Chain
): Promise<DexScreenerTokenData | null> {
  const cacheKey = `${chain}:${address.toLowerCase()}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  try {
    const chainId = CHAIN_TO_DEXSCREENER[chain];
    const response = await fetch(
      `${DEXSCREENER_API}/dex/pairs/${chainId}/${address}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    // If pair lookup fails, try token lookup
    if (!response.ok) {
      const { data, chains } = await getTokenByAddress(address);
      if (data && chains.includes(chain)) {
        return data;
      }
      return null;
    }

    const json = await response.json() as DexScreenerResponse;

    if (!json.pairs || json.pairs.length === 0) {
      // Fallback to token lookup
      const { data, chains } = await getTokenByAddress(address);
      if (data && chains.includes(chain)) {
        return data;
      }
      return null;
    }

    // Find pair for our token on the specified chain
    const pair = json.pairs.find(
      (p) =>
        p.chainId === chainId &&
        (p.baseToken.address.toLowerCase() === address.toLowerCase() ||
          p.quoteToken.address.toLowerCase() === address.toLowerCase())
    );

    if (!pair) {
      return null;
    }

    const tokenData = normalizePairData(pair);

    cache.set(cacheKey, {
      data: tokenData,
      expiry: Date.now() + CACHE_TTL,
    });

    return tokenData;
  } catch (error) {
    console.error('[DexScreener] Fetch error:', error);
    return null;
  }
}

/**
 * Get all trading pairs for a token
 */
export async function getTokenPairs(
  address: string,
  chain?: Chain
): Promise<DexScreenerPair[]> {
  try {
    const url = chain
      ? `${DEXSCREENER_API}/dex/tokens/${address}`
      : `${DEXSCREENER_API}/dex/tokens/${address}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return [];
    }

    const json = await response.json() as DexScreenerResponse;

    if (!json.pairs) {
      return [];
    }

    // Filter by chain if specified
    if (chain) {
      const chainId = CHAIN_TO_DEXSCREENER[chain];
      return json.pairs.filter((p) => p.chainId === chainId);
    }

    return json.pairs;
  } catch (error) {
    console.error('[DexScreener] Fetch pairs error:', error);
    return [];
  }
}

/**
 * Detect which chains a token exists on
 */
export async function detectTokenChains(address: string): Promise<Chain[]> {
  const { chains } = await getTokenByAddress(address);
  return chains;
}

/**
 * Normalize DexScreener pair data to our format
 */
function normalizePairData(pair: DexScreenerPair): DexScreenerTokenData {
  return {
    address: pair.baseToken.address,
    chain: CHAIN_MAP[pair.chainId] || 'eth',
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    priceUsd: parseFloat(pair.priceUsd) || 0,
    priceNative: parseFloat(pair.priceNative) || 0,
    marketCap: pair.marketCap ?? null,
    fdv: pair.fdv ?? null,
    liquidity: pair.liquidity?.usd ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    priceChange24h: pair.priceChange?.h24 ?? 0,
    txns24h: pair.txns?.h24 ?? { buys: 0, sells: 0 },
    pairAddress: pair.pairAddress,
    dex: pair.dexId,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    imageUrl: pair.info?.imageUrl,
  };
}

/**
 * Clear the cache
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; hits: number; misses: number } {
  return {
    size: cache.size,
    hits: 0, // Would need to track this
    misses: 0,
  };
}
