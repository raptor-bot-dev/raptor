/**
 * Bonk.fun API for RAPTOR
 *
 * BONK ecosystem launchpad on Solana:
 * - Token metadata and bonding curve
 * - Progress to graduation
 * - BONK integration features
 *
 * Program: BonKyiRTJNYFweQirNMBGGqPnUqUwUwDsvgZBtpUgMwa
 */

// Bonk.fun API
const BONKFUN_API = 'https://api.bonk.fun/v1';

// Bonding curve target
const BONKFUN_CURVE_TARGET = 85; // SOL to graduate

// Cache
const cache = new Map<string, { data: BonkFunToken; expiry: number }>();
const CACHE_TTL = 30 * 1000; // 30 seconds

export interface BonkFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;

  // Creator
  creator: string;
  createdAt: number;

  // Bonding curve status
  status: 'active' | 'migrating' | 'graduated';
  bondingCurveProgress: number; // 0-100%
  solRaised: number;
  targetSol: number;

  // BONK features
  bonkBurned: number;
  bonkRewards: number;

  // Price
  priceInSol: number;
  priceInUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;

  // Trading
  volume24h: number;
  holders: number;

  // Supply
  totalSupply: number;

  // Migration
  graduatedAt?: number;
  poolAddress?: string;

  // Social
  twitter?: string;
  telegram?: string;
  website?: string;
}

/**
 * Get token info from Bonk.fun
 */
export async function getTokenInfo(
  mint: string,
  solPriceUsd?: number
): Promise<BonkFunToken | null> {
  const cacheKey = `bonkfun:${mint}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  try {
    const response = await fetch(`${BONKFUN_API}/token/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error(`[Bonk.fun] API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const token = parseBonkFunResponse(data, solPriceUsd);

    cache.set(cacheKey, {
      data: token,
      expiry: Date.now() + CACHE_TTL,
    });

    return token;
  } catch (error) {
    console.error('[Bonk.fun] Fetch error:', error);
    return null;
  }
}

/**
 * Check if token is from Bonk.fun
 */
export async function isBonkFunToken(mint: string): Promise<boolean> {
  const token = await getTokenInfo(mint);
  return token !== null;
}

/**
 * Get trending tokens on Bonk.fun
 */
export async function getTrending(limit = 10): Promise<BonkFunToken[]> {
  try {
    const response = await fetch(`${BONKFUN_API}/tokens/trending?limit=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Array<Record<string, unknown>>;
    return data.map((d) => parseBonkFunResponse(d));
  } catch (error) {
    console.error('[Bonk.fun] Trending fetch error:', error);
    return [];
  }
}

/**
 * Get new launches on Bonk.fun
 */
export async function getNewLaunches(limit = 10): Promise<BonkFunToken[]> {
  try {
    const response = await fetch(`${BONKFUN_API}/tokens/new?limit=${limit}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Array<Record<string, unknown>>;
    return data.map((d) => parseBonkFunResponse(d));
  } catch (error) {
    console.error('[Bonk.fun] New launches fetch error:', error);
    return [];
  }
}

/**
 * Parse Bonk.fun API response
 */
function parseBonkFunResponse(
  data: Record<string, unknown>,
  solPriceUsd?: number
): BonkFunToken {
  const solRaised = Number(data.solRaised || data.collateral || 0) / 1e9;
  const bondingCurveProgress = Math.min(100, (solRaised / BONKFUN_CURVE_TARGET) * 100);

  let status: BonkFunToken['status'] = 'active';
  if (data.graduated || bondingCurveProgress >= 100) {
    status = 'graduated';
  } else if (data.migrating) {
    status = 'migrating';
  }

  const totalSupply = Number(data.totalSupply || 1e9) / 1e6;
  const priceInSol = Number(data.priceInSol || 0);
  const marketCapSol = priceInSol * totalSupply;

  return {
    mint: String(data.mint || data.address || ''),
    name: String(data.name || 'Unknown'),
    symbol: String(data.symbol || '???'),
    description: String(data.description || ''),
    imageUri: String(data.image || data.imageUri || ''),
    creator: String(data.creator || ''),
    createdAt: Number(data.createdAt || data.timestamp || 0),
    status,
    bondingCurveProgress,
    solRaised,
    targetSol: BONKFUN_CURVE_TARGET,
    bonkBurned: Number(data.bonkBurned || 0),
    bonkRewards: Number(data.bonkRewards || 0),
    priceInSol,
    priceInUsd: solPriceUsd ? priceInSol * solPriceUsd : null,
    marketCapSol,
    marketCapUsd: solPriceUsd ? marketCapSol * solPriceUsd : null,
    volume24h: Number(data.volume24h || 0),
    holders: Number(data.holders || data.holderCount || 0),
    totalSupply,
    graduatedAt: data.graduatedAt ? Number(data.graduatedAt) : undefined,
    poolAddress: data.poolAddress ? String(data.poolAddress) : undefined,
    twitter: data.twitter ? String(data.twitter) : undefined,
    telegram: data.telegram ? String(data.telegram) : undefined,
    website: data.website ? String(data.website) : undefined,
  };
}

/**
 * Get Bonk.fun status
 */
export function getBonkFunStatus(token: BonkFunToken): {
  emoji: string;
  label: string;
  description: string;
} {
  if (token.status === 'graduated') {
    return {
      emoji: '🎓',
      label: 'Graduated',
      description: 'Trading on Raydium',
    };
  }

  if (token.status === 'migrating') {
    return {
      emoji: '🔄',
      label: 'Migrating',
      description: 'Moving to DEX...',
    };
  }

  if (token.bondingCurveProgress >= 90) {
    return {
      emoji: '🔥',
      label: 'Almost There!',
      description: `${token.bondingCurveProgress.toFixed(1)}% to graduation`,
    };
  }

  if (token.bondingCurveProgress >= 50) {
    return {
      emoji: '📈',
      label: 'Growing',
      description: `${token.bondingCurveProgress.toFixed(1)}% funded`,
    };
  }

  return {
    emoji: '🐕',
    label: 'New Launch',
    description: `${token.bondingCurveProgress.toFixed(1)}% funded`,
  };
}

/**
 * Format bonding curve progress
 */
export function formatBondingBar(progress: number): string {
  const filled = Math.floor(progress / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get Bonk.fun links
 */
export function getBonkFunLinks(mint: string): {
  bonkfun: string;
  dexscreener: string;
  birdeye: string;
  solscan: string;
} {
  return {
    bonkfun: `https://bonk.fun/token/${mint}`,
    dexscreener: `https://dexscreener.com/solana/${mint}`,
    birdeye: `https://birdeye.so/token/${mint}?chain=solana`,
    solscan: `https://solscan.io/token/${mint}`,
  };
}

/**
 * Clear cache
 */
export function clearCache(): void {
  cache.clear();
}
