/**
 * PumpFun API for RAPTOR
 *
 * Integration with Pump.fun for Solana token launches:
 * - Bonding curve status and progress
 * - Token metadata and creator info
 * - Buy/sell before graduation
 * - Real-time price from bonding curve
 *
 * Docs: https://docs.pump.fun/
 */

// PumpFun API endpoints
const PUMPFUN_API = 'https://frontend-api.pump.fun';
const PUMPFUN_CLIENT_API = 'https://client-api-2-74b1891ee9f9.herokuapp.com';

// Bonding curve constants
const BONDING_CURVE_LIMIT = 85; // SOL required to graduate (approx)
const INITIAL_VIRTUAL_SOL = 30; // Virtual SOL in bonding curve

// Cache
const cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 30 * 1000; // 30 seconds for real-time data

export interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  metadataUri: string;
  twitter?: string;
  telegram?: string;
  website?: string;

  // Creator info
  creator: string;
  createdTimestamp: number;

  // Bonding curve status
  complete: boolean; // true if graduated to Raydium
  virtualSolReserves: number;
  virtualTokenReserves: number;
  realSolReserves: number;
  realTokenReserves: number;
  totalSupply: number;

  // Calculated fields
  bondingCurveProgress: number; // 0-100%
  priceInSol: number;
  priceInUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;

  // Trading stats
  lastTradeTimestamp?: number;
  kingOfTheHillTimestamp?: number;
  replyCount?: number;

  // Associated accounts
  bondingCurve: string;
  associatedBondingCurve: string;
}

export interface PumpFunTrade {
  signature: string;
  mint: string;
  solAmount: number;
  tokenAmount: number;
  isBuy: boolean;
  user: string;
  timestamp: number;
  virtualSolReserves: number;
  virtualTokenReserves: number;
}

/**
 * Get token info from PumpFun
 */
export async function getTokenInfo(
  mint: string,
  solPriceUsd?: number
): Promise<PumpFunToken | null> {
  const cacheKey = `token:${mint}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return cached.data as PumpFunToken;
  }

  try {
    const response = await fetch(`${PUMPFUN_API}/coins/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Not a PumpFun token
      }
      console.error(`[PumpFun] API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const token = parsePumpFunToken(data, solPriceUsd);

    cache.set(cacheKey, {
      data: token,
      expiry: Date.now() + CACHE_TTL,
    });

    return token;
  } catch (error) {
    console.error('[PumpFun] Fetch error:', error);
    return null;
  }
}

/**
 * Check if an address is a PumpFun token
 */
export async function isPumpFunToken(mint: string): Promise<boolean> {
  const token = await getTokenInfo(mint);
  return token !== null;
}

/**
 * Get recent trades for a token
 */
export async function getRecentTrades(
  mint: string,
  limit = 20
): Promise<PumpFunTrade[]> {
  try {
    const response = await fetch(
      `${PUMPFUN_API}/trades/latest?mint=${mint}&limit=${limit}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Array<Record<string, unknown>>;
    return data.map(parsePumpFunTrade);
  } catch (error) {
    console.error('[PumpFun] Trades fetch error:', error);
    return [];
  }
}

/**
 * Get trending tokens on PumpFun
 */
export async function getTrendingTokens(limit = 10): Promise<PumpFunToken[]> {
  const url = `${PUMPFUN_API}/coins?sort=market_cap&order=DESC&limit=${limit}&includeNsfw=false`;
  try {
    console.log('[PumpFun] Fetching trending tokens from:', url);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[PumpFun] Trending API error: ${response.status} - ${body.slice(0, 200)}`);
      return [];
    }

    const data = await response.json() as Array<Record<string, unknown>>;
    console.log(`[PumpFun] Trending tokens fetched: ${data.length} results`);
    return data.map(d => parsePumpFunToken(d));
  } catch (error) {
    console.error('[PumpFun] Trending fetch error:', error);
    return [];
  }
}

/**
 * Get new token launches
 */
export async function getNewLaunches(limit = 10): Promise<PumpFunToken[]> {
  const url = `${PUMPFUN_API}/coins?sort=created_timestamp&order=DESC&limit=${limit}&includeNsfw=false`;
  try {
    console.log('[PumpFun] Fetching new launches from:', url);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[PumpFun] New launches API error: ${response.status} - ${body.slice(0, 200)}`);
      return [];
    }

    const data = await response.json() as Array<Record<string, unknown>>;
    console.log(`[PumpFun] New launches fetched: ${data.length} results`);
    return data.map(d => parsePumpFunToken(d));
  } catch (error) {
    console.error('[PumpFun] New launches fetch error:', error);
    return [];
  }
}

/**
 * Calculate buy price for amount of SOL
 */
export function calculateBuyPrice(
  token: PumpFunToken,
  solAmount: number
): { tokenAmount: number; priceImpact: number; newPrice: number } {
  // Bonding curve formula: x * y = k (constant product)
  const k = token.virtualSolReserves * token.virtualTokenReserves;
  const newSolReserves = token.virtualSolReserves + solAmount;
  const newTokenReserves = k / newSolReserves;
  const tokenAmount = token.virtualTokenReserves - newTokenReserves;

  const oldPrice = token.virtualSolReserves / token.virtualTokenReserves;
  const newPrice = newSolReserves / newTokenReserves;
  const priceImpact = ((newPrice - oldPrice) / oldPrice) * 100;

  return {
    tokenAmount,
    priceImpact,
    newPrice,
  };
}

/**
 * Calculate sell price for amount of tokens
 */
export function calculateSellPrice(
  token: PumpFunToken,
  tokenAmount: number
): { solAmount: number; priceImpact: number; newPrice: number } {
  const k = token.virtualSolReserves * token.virtualTokenReserves;
  const newTokenReserves = token.virtualTokenReserves + tokenAmount;
  const newSolReserves = k / newTokenReserves;
  const solAmount = token.virtualSolReserves - newSolReserves;

  const oldPrice = token.virtualSolReserves / token.virtualTokenReserves;
  const newPrice = newSolReserves / newTokenReserves;
  const priceImpact = ((oldPrice - newPrice) / oldPrice) * 100;

  return {
    solAmount: Math.max(0, solAmount),
    priceImpact,
    newPrice,
  };
}

/**
 * Parse PumpFun API response into our format
 */
function parsePumpFunToken(
  data: Record<string, unknown>,
  solPriceUsd?: number
): PumpFunToken {
  const virtualSolReserves = Number(data.virtual_sol_reserves || 0) / 1e9;
  const virtualTokenReserves = Number(data.virtual_token_reserves || 0) / 1e6;
  const realSolReserves = Number(data.real_sol_reserves || 0) / 1e9;
  const totalSupply = Number(data.total_supply || 1e9) / 1e6;

  // Calculate bonding curve progress (0-100%)
  // Progress is based on how much real SOL has been added
  const bondingCurveProgress = Math.min(100, (realSolReserves / BONDING_CURVE_LIMIT) * 100);

  // Calculate price from bonding curve
  const priceInSol = virtualTokenReserves > 0
    ? virtualSolReserves / virtualTokenReserves
    : 0;

  // Market cap = price * supply
  const marketCapSol = priceInSol * totalSupply;

  return {
    mint: String(data.mint || ''),
    name: String(data.name || 'Unknown'),
    symbol: String(data.symbol || '???'),
    description: String(data.description || ''),
    imageUri: String(data.image_uri || ''),
    metadataUri: String(data.metadata_uri || ''),
    twitter: data.twitter ? String(data.twitter) : undefined,
    telegram: data.telegram ? String(data.telegram) : undefined,
    website: data.website ? String(data.website) : undefined,

    creator: String(data.creator || ''),
    createdTimestamp: Number(data.created_timestamp || 0),

    complete: Boolean(data.complete),
    virtualSolReserves,
    virtualTokenReserves,
    realSolReserves,
    realTokenReserves: Number(data.real_token_reserves || 0) / 1e6,
    totalSupply,

    bondingCurveProgress,
    priceInSol,
    priceInUsd: solPriceUsd ? priceInSol * solPriceUsd : null,
    marketCapSol,
    marketCapUsd: solPriceUsd ? marketCapSol * solPriceUsd : null,

    lastTradeTimestamp: data.last_trade_timestamp ? Number(data.last_trade_timestamp) : undefined,
    kingOfTheHillTimestamp: data.king_of_the_hill_timestamp ? Number(data.king_of_the_hill_timestamp) : undefined,
    replyCount: data.reply_count ? Number(data.reply_count) : undefined,

    bondingCurve: String(data.bonding_curve || ''),
    associatedBondingCurve: String(data.associated_bonding_curve || ''),
  };
}

/**
 * Parse PumpFun trade data
 */
function parsePumpFunTrade(data: Record<string, unknown>): PumpFunTrade {
  return {
    signature: String(data.signature || ''),
    mint: String(data.mint || ''),
    solAmount: Number(data.sol_amount || 0) / 1e9,
    tokenAmount: Number(data.token_amount || 0) / 1e6,
    isBuy: Boolean(data.is_buy),
    user: String(data.user || ''),
    timestamp: Number(data.timestamp || 0),
    virtualSolReserves: Number(data.virtual_sol_reserves || 0) / 1e9,
    virtualTokenReserves: Number(data.virtual_token_reserves || 0) / 1e6,
  };
}

/**
 * Format bonding curve progress bar
 */
export function formatBondingCurveBar(progress: number): string {
  const filled = Math.floor(progress / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get status text for bonding curve
 */
export function getBondingCurveStatus(token: PumpFunToken): {
  emoji: string;
  label: string;
  description: string;
} {
  if (token.complete) {
    return {
      emoji: '🎓',
      label: 'Graduated',
      description: 'Trading on Raydium',
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
 * Get PumpFun links for a token
 */
export function getPumpFunLinks(mint: string): {
  pumpfun: string;
  dexscreener: string;
  birdeye: string;
  solscan: string;
} {
  return {
    pumpfun: `https://pump.fun/${mint}`,
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
