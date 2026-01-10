/**
 * Moonshot API for RAPTOR
 *
 * DEX Screener's Solana launchpad (bonding curve):
 * - Token metadata and status
 * - Bonding curve progress
 * - Price and market cap
 * - Migration status (to Raydium/Meteora)
 *
 * Moonshot Program: MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG
 */

// Moonshot API (via DexScreener)
const MOONSHOT_API = 'https://api.moonshot.cc/v1';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Bonding curve constants
const MOONSHOT_CURVE_TARGET = 500; // SOL required to graduate

// Cache
const cache = new Map<string, { data: MoonshotToken; expiry: number }>();
const CACHE_TTL = 30 * 1000; // 30 seconds

export interface MoonshotToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;

  // Creator
  creator: string;
  createdAt: number;

  // Status
  status: 'bonding' | 'migrating' | 'migrated';
  bondingCurveProgress: number; // 0-100%
  solRaised: number;
  targetSol: number;

  // Price data
  priceInSol: number;
  priceInUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;

  // Volume
  volume24h: number;
  txCount24h: number;

  // Supply
  totalSupply: number;
  circulatingSupply: number;

  // Migration info
  migratedAt?: number;
  poolAddress?: string;
  dex?: string;

  // Social
  twitter?: string;
  telegram?: string;
  website?: string;
}

/**
 * Get token info from Moonshot
 */
export async function getTokenInfo(
  mint: string,
  solPriceUsd?: number
): Promise<MoonshotToken | null> {
  const cacheKey = `moonshot:${mint}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  try {
    // Try Moonshot API first
    const moonshotData = await fetchMoonshotData(mint);

    if (moonshotData) {
      if (solPriceUsd) {
        moonshotData.priceInUsd = moonshotData.priceInSol * solPriceUsd;
        moonshotData.marketCapUsd = moonshotData.marketCapSol * solPriceUsd;
      }

      cache.set(cacheKey, {
        data: moonshotData,
        expiry: Date.now() + CACHE_TTL,
      });

      return moonshotData;
    }

    // Fall back to DexScreener for migrated tokens
    const dexData = await fetchDexScreenerData(mint, solPriceUsd);
    if (dexData) {
      cache.set(cacheKey, {
        data: dexData,
        expiry: Date.now() + CACHE_TTL,
      });
      return dexData;
    }

    return null;
  } catch (error) {
    console.error('[Moonshot] Fetch error:', error);
    return null;
  }
}

/**
 * Check if token is from Moonshot
 */
export async function isMoonshotToken(mint: string): Promise<boolean> {
  const token = await getTokenInfo(mint);
  return token !== null;
}

/**
 * Fetch from Moonshot API
 */
async function fetchMoonshotData(mint: string): Promise<MoonshotToken | null> {
  try {
    const response = await fetch(`${MOONSHOT_API}/token/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    return parseMoonshotResponse(data);
  } catch {
    return null;
  }
}

/**
 * Fetch from DexScreener for migrated tokens
 */
async function fetchDexScreenerData(
  mint: string,
  solPriceUsd?: number
): Promise<MoonshotToken | null> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/tokens/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json() as { pairs?: Array<Record<string, unknown>> };

    if (!json.pairs || json.pairs.length === 0) {
      return null;
    }

    // Check if any pair is from Moonshot migration
    const moonshotPair = json.pairs.find((p) => {
      const labels = p.labels as string[] || [];
      return labels.includes('moonshot') || String(p.dexId || '').includes('moonshot');
    });

    if (!moonshotPair) {
      return null;
    }

    const baseToken = moonshotPair.baseToken as Record<string, unknown> || {};
    const priceUsd = parseFloat(String(moonshotPair.priceUsd || '0'));
    const priceNative = parseFloat(String(moonshotPair.priceNative || '0'));

    return {
      mint,
      name: String(baseToken.name || 'Unknown'),
      symbol: String(baseToken.symbol || '???'),
      description: '',
      imageUri: '',
      creator: '',
      createdAt: Number(moonshotPair.pairCreatedAt || 0),
      status: 'migrated',
      bondingCurveProgress: 100,
      solRaised: MOONSHOT_CURVE_TARGET,
      targetSol: MOONSHOT_CURVE_TARGET,
      priceInSol: priceNative,
      priceInUsd: priceUsd,
      marketCapSol: parseFloat(String(moonshotPair.fdv || '0')) / (solPriceUsd || 100),
      marketCapUsd: parseFloat(String(moonshotPair.fdv || '0')),
      volume24h: parseFloat(String((moonshotPair.volume as Record<string, string>)?.h24 || '0')),
      txCount24h: Number(((moonshotPair.txns as Record<string, Record<string, number>>)?.h24 as Record<string, number>)?.buys || 0) +
        Number(((moonshotPair.txns as Record<string, Record<string, number>>)?.h24 as Record<string, number>)?.sells || 0),
      totalSupply: 0,
      circulatingSupply: 0,
      poolAddress: String(moonshotPair.pairAddress || ''),
      dex: String(moonshotPair.dexId || 'raydium'),
    };
  } catch {
    return null;
  }
}

/**
 * Parse Moonshot API response
 */
function parseMoonshotResponse(data: Record<string, unknown>): MoonshotToken {
  const solRaised = Number(data.collateralAmount || 0) / 1e9;
  const bondingCurveProgress = Math.min(100, (solRaised / MOONSHOT_CURVE_TARGET) * 100);

  let status: MoonshotToken['status'] = 'bonding';
  if (data.status === 'migrated' || bondingCurveProgress >= 100) {
    status = 'migrated';
  } else if (data.status === 'migrating') {
    status = 'migrating';
  }

  const totalSupply = Number(data.totalSupply || 1e9) / 1e6;
  const priceInSol = solRaised > 0 ? solRaised / totalSupply : 0;

  return {
    mint: String(data.mint || data.address || ''),
    name: String(data.name || 'Unknown'),
    symbol: String(data.symbol || '???'),
    description: String(data.description || ''),
    imageUri: String(data.image || data.imageUri || ''),
    creator: String(data.creator || ''),
    createdAt: Number(data.createdAt || 0),
    status,
    bondingCurveProgress,
    solRaised,
    targetSol: MOONSHOT_CURVE_TARGET,
    priceInSol,
    priceInUsd: null,
    marketCapSol: priceInSol * totalSupply,
    marketCapUsd: null,
    volume24h: Number(data.volume24h || 0),
    txCount24h: Number(data.txCount24h || 0),
    totalSupply,
    circulatingSupply: totalSupply,
    migratedAt: data.migratedAt ? Number(data.migratedAt) : undefined,
    poolAddress: data.poolAddress ? String(data.poolAddress) : undefined,
    dex: data.dex ? String(data.dex) : undefined,
    twitter: data.twitter ? String(data.twitter) : undefined,
    telegram: data.telegram ? String(data.telegram) : undefined,
    website: data.website ? String(data.website) : undefined,
  };
}

/**
 * Get status text and emoji
 */
export function getMoonshotStatus(token: MoonshotToken): {
  emoji: string;
  label: string;
  description: string;
} {
  if (token.status === 'migrated') {
    return {
      emoji: '🎓',
      label: 'Graduated',
      description: `Trading on ${token.dex || 'Raydium'}`,
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
    emoji: '🌱',
    label: 'New Launch',
    description: `${token.bondingCurveProgress.toFixed(1)}% funded`,
  };
}

/**
 * Format bonding curve progress bar
 */
export function formatBondingBar(progress: number): string {
  const filled = Math.floor(progress / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get Moonshot links
 */
export function getMoonshotLinks(mint: string): {
  moonshot: string;
  dexscreener: string;
  birdeye: string;
  solscan: string;
} {
  return {
    moonshot: `https://moonshot.cc/token/${mint}`,
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
