/**
 * Birdeye API Service for RAPTOR
 *
 * Provides Solana-specific token data:
 * - Token overview and metadata
 * - Security analysis
 * - Holder distribution
 * - Trade history
 *
 * Requires BIRDEYE_API_KEY environment variable
 */

const BIRDEYE_API = 'https://public-api.birdeye.so';

// Cache for API responses
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface BirdeyeTokenOverview {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  extensions?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    description?: string;
  };
  logoURI?: string;
  liquidity: number;
  price: number;
  priceChange24hPercent: number;
  volume24h: number;
  volume24hChangePercent: number;
  mc: number | null; // Market cap
  supply: number;
  holder: number;
  lastTradeUnixTime: number;
  lastTradeHumanTime: string;
  trade24h: number;
  buy24h: number;
  sell24h: number;
  uniqueWallet24h: number;
  uniqueWallet24hChangePercent: number;
  v24hUSD: number;
}

export interface BirdeyeSecurityData {
  creatorAddress: string;
  ownerAddress: string | null;
  creationTx: string;
  creationSlot: number;
  creationTime: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isToken2022: boolean;
  isMutable: boolean;
  top10HolderBalance: number;
  top10HolderPercent: number;
  top10UserBalance: number;
  top10UserPercent: number;
  totalSupply: number;
  preMarketHolder: number[];
  lockInfo: {
    isLocked: boolean;
    lockedPercent: number;
    unlockTime: number | null;
  } | null;
  risks: BirdeyeRisk[];
}

export interface BirdeyeRisk {
  name: string;
  value: string;
  description: string;
  level: 'info' | 'warn' | 'danger';
}

export interface BirdeyeHolder {
  address: string;
  amount: number;
  decimals: number;
  owner: string;
  percentage: number;
}

/**
 * Get API key from environment
 */
function getApiKey(): string | null {
  return process.env.BIRDEYE_API_KEY || null;
}

/**
 * Make authenticated request to Birdeye API
 */
async function birdeyeFetch<T>(
  endpoint: string,
  params?: Record<string, string>
): Promise<T | null> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn('[Birdeye] No API key configured (BIRDEYE_API_KEY)');
    return null;
  }

  try {
    const url = new URL(`${BIRDEYE_API}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'X-API-KEY': apiKey,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[Birdeye] API error: ${response.status}`);
      return null;
    }

    const json = await response.json() as { data?: T };
    return json.data as T;
  } catch (error) {
    console.error('[Birdeye] Fetch error:', error);
    return null;
  }
}

/**
 * Get token overview from Birdeye
 */
export async function getTokenOverview(
  address: string
): Promise<BirdeyeTokenOverview | null> {
  const cacheKey = `overview:${address}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data as BirdeyeTokenOverview;
  }

  const data = await birdeyeFetch<BirdeyeTokenOverview>(
    '/defi/token_overview',
    { address }
  );

  if (data) {
    cache.set(cacheKey, {
      data,
      expiry: Date.now() + CACHE_TTL,
    });
  }

  return data;
}

/**
 * Get token security data from Birdeye
 */
export async function getTokenSecurity(
  address: string
): Promise<BirdeyeSecurityData | null> {
  const cacheKey = `security:${address}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data as BirdeyeSecurityData;
  }

  const data = await birdeyeFetch<BirdeyeSecurityData>(
    '/defi/token_security',
    { address }
  );

  if (data) {
    cache.set(cacheKey, {
      data,
      expiry: Date.now() + CACHE_TTL,
    });
  }

  return data;
}

/**
 * Get token holder list from Birdeye
 */
export async function getTokenHolders(
  address: string,
  limit = 20
): Promise<BirdeyeHolder[]> {
  const cacheKey = `holders:${address}:${limit}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data as BirdeyeHolder[];
  }

  const data = await birdeyeFetch<{ items: BirdeyeHolder[] }>(
    '/defi/v3/token/holder',
    { address, limit: limit.toString() }
  );

  const holders = data?.items ?? [];

  cache.set(cacheKey, {
    data: holders,
    expiry: Date.now() + CACHE_TTL,
  });

  return holders;
}

/**
 * Get current SOL price in USD
 */
export async function getSolPrice(): Promise<number | null> {
  const cacheKey = 'sol_price';
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data as number;
  }

  // SOL mint address
  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  const data = await birdeyeFetch<{ value: number }>(
    '/defi/price',
    { address: SOL_MINT }
  );

  if (data?.value) {
    cache.set(cacheKey, {
      data: data.value,
      expiry: Date.now() + 30000, // 30s cache for prices
    });
    return data.value;
  }

  return null;
}

/**
 * Analyze token risks and return a risk score
 * Returns 0-100 (0 = very risky, 100 = safe)
 */
export async function analyzeTokenRisk(
  address: string
): Promise<{
  score: number;
  risks: BirdeyeRisk[];
  flags: string[];
} | null> {
  const security = await getTokenSecurity(address);

  if (!security) {
    return null;
  }

  const risks: BirdeyeRisk[] = security.risks || [];
  const flags: string[] = [];
  let score = 100;

  // Check mint authority
  if (security.mintAuthority) {
    flags.push('Mint authority enabled');
    score -= 20;
  }

  // Check freeze authority
  if (security.freezeAuthority) {
    flags.push('Freeze authority enabled');
    score -= 15;
  }

  // Check top holder concentration
  if (security.top10HolderPercent > 50) {
    flags.push('High holder concentration');
    score -= 15;
  }

  // Check if mutable
  if (security.isMutable) {
    flags.push('Token metadata is mutable');
    score -= 10;
  }

  // Check liquidity lock
  if (!security.lockInfo?.isLocked) {
    flags.push('Liquidity not locked');
    score -= 10;
  }

  // Add Birdeye's own risk flags
  for (const risk of risks) {
    if (risk.level === 'danger') {
      score -= 20;
    } else if (risk.level === 'warn') {
      score -= 10;
    }
  }

  return {
    score: Math.max(0, score),
    risks,
    flags,
  };
}

/**
 * Check if Birdeye API is configured
 */
export function isConfigured(): boolean {
  return !!getApiKey();
}

/**
 * Clear the cache
 */
export function clearCache(): void {
  cache.clear();
}
