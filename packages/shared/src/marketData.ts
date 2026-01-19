// =============================================================================
// RAPTOR Market Data Helper Module
// Unified source of truth for token market data, MC, and quote-based PnL
// =============================================================================

import { getTokenInfo, calculateSellPrice, type PumpFunToken } from './api/pumpfun.js';
import { getTokenByAddress } from './api/dexscreener.js';
import { getTokenPrice, type PriceResult } from './pricing.js';
import { getSolPrice } from './api/birdeye.js';

// Default values for pump.fun tokens
const PUMP_FUN_TOTAL_SUPPLY = 1_000_000_000;
const PUMP_FUN_DECIMALS = 6;
const PUMP_PRO_DECIMALS = 9;

// Cache for market data (30 second TTL)
const marketDataCache = new Map<string, { data: MarketData; expiry: number }>();
const CACHE_TTL_MS = 30_000;

export type MarketDataSource = 'bonding_curve' | 'pumpfun_api' | 'dexscreener' | 'birdeye' | 'jupiter' | 'none';

export interface MarketData {
  mint: string;
  priceSol: number;
  priceUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;
  supply: number;
  decimals: number;
  source: MarketDataSource;
  isGraduated: boolean;
  bondingCurveProgress?: number;
  // Raw bonding curve data for quote calculations
  virtualSolReserves?: number;
  virtualTokenReserves?: number;
}

export interface QuotePnlResult {
  currentValueSol: number;
  pnlSol: number;
  pnlPercent: number;
  source: 'bonding_curve' | 'jupiter' | 'spot';
}

export interface GetMarketDataOptions {
  solPriceUsd?: number;
  forceRefresh?: boolean;
  source?: 'pump.fun' | 'pump.pro' | 'unknown';
}

/**
 * Get unified market data for a single token
 *
 * Data source priority:
 * 1. pump.fun API (for bonding curve tokens - has most complete data)
 * 2. DEXScreener API (for graduated tokens)
 * 3. Jupiter price + defaults (fallback)
 */
export async function getMarketData(
  mint: string,
  options: GetMarketDataOptions = {}
): Promise<MarketData> {
  const { solPriceUsd, forceRefresh = false, source } = options;
  const now = Date.now();

  // Check cache unless force refresh
  if (!forceRefresh) {
    const cached = marketDataCache.get(mint);
    if (cached && now < cached.expiry) {
      // Update USD prices if solPriceUsd provided
      if (solPriceUsd && !cached.data.priceUsd) {
        return {
          ...cached.data,
          priceUsd: cached.data.priceSol * solPriceUsd,
          marketCapUsd: cached.data.marketCapSol * solPriceUsd,
        };
      }
      return cached.data;
    }
  }

  // Get SOL price if not provided
  let solPrice = solPriceUsd;
  if (!solPrice) {
    try {
      const fetchedPrice = await getSolPrice();
      solPrice = fetchedPrice ?? undefined;
    } catch {
      solPrice = undefined;
    }
  }

  // Determine decimals based on source
  const decimals = source === 'pump.pro' ? PUMP_PRO_DECIMALS : PUMP_FUN_DECIMALS;

  // Try pump.fun API first (works for pump.fun tokens, may work for pump.pro)
  try {
    const tokenInfo = await getTokenInfo(mint, solPrice);
    if (tokenInfo) {
      const data = pumpFunTokenToMarketData(tokenInfo, decimals, solPrice);
      marketDataCache.set(mint, { data, expiry: now + CACHE_TTL_MS });
      return data;
    }
  } catch (error) {
    console.warn(`[MarketData] pump.fun API failed for ${mint}:`, error);
  }

  // Try DEXScreener for graduated tokens
  try {
    const { data: dexData } = await getTokenByAddress(mint);
    if (dexData?.priceNative && dexData.priceNative > 0) {
      const priceSol = dexData.priceNative;
      const supply = PUMP_FUN_TOTAL_SUPPLY; // Default, DEXScreener doesn't always have supply
      const marketCapSol = priceSol * supply;

      const data: MarketData = {
        mint,
        priceSol,
        priceUsd: solPrice ? priceSol * solPrice : null,
        marketCapSol,
        marketCapUsd: solPrice ? marketCapSol * solPrice : null,
        supply,
        decimals,
        source: 'dexscreener',
        isGraduated: true, // If on DEXScreener, likely graduated
      };

      marketDataCache.set(mint, { data, expiry: now + CACHE_TTL_MS });
      return data;
    }
  } catch (error) {
    console.warn(`[MarketData] DEXScreener failed for ${mint}:`, error);
  }

  // Fallback to Jupiter price with defaults
  try {
    const priceResult = await getTokenPrice(mint);
    if (priceResult.price > 0) {
      const priceSol = priceResult.price;
      const supply = PUMP_FUN_TOTAL_SUPPLY;
      const marketCapSol = priceSol * supply;

      const data: MarketData = {
        mint,
        priceSol,
        priceUsd: solPrice ? priceSol * solPrice : null,
        marketCapSol,
        marketCapUsd: solPrice ? marketCapSol * solPrice : null,
        supply,
        decimals,
        source: priceSourceToMarketDataSource(priceResult.source),
        isGraduated: true, // If Jupiter has price, likely graduated
      };

      marketDataCache.set(mint, { data, expiry: now + CACHE_TTL_MS });
      return data;
    }
  } catch (error) {
    console.warn(`[MarketData] Jupiter price failed for ${mint}:`, error);
  }

  // Return empty data if all sources fail
  return {
    mint,
    priceSol: 0,
    priceUsd: null,
    marketCapSol: 0,
    marketCapUsd: null,
    supply: PUMP_FUN_TOTAL_SUPPLY,
    decimals,
    source: 'none',
    isGraduated: false,
  };
}

/**
 * Batch fetch market data for multiple tokens
 * More efficient than calling getMarketData() for each token
 */
export async function getMarketDataBatch(
  mints: string[],
  solPriceUsd?: number
): Promise<Record<string, MarketData>> {
  if (mints.length === 0) {
    return {};
  }

  // Get SOL price once for the batch
  let solPrice = solPriceUsd;
  if (!solPrice) {
    try {
      const fetchedPrice = await getSolPrice();
      solPrice = fetchedPrice ?? undefined;
    } catch {
      solPrice = undefined;
    }
  }

  // Fetch all in parallel
  const results = await Promise.all(
    mints.map(mint => getMarketData(mint, { solPriceUsd: solPrice }))
  );

  // Build result map
  const resultMap: Record<string, MarketData> = {};
  for (let i = 0; i < mints.length; i++) {
    resultMap[mints[i]] = results[i];
  }

  return resultMap;
}

/**
 * Get expected SOL output for selling tokens
 *
 * Uses quote-based calculation when possible:
 * 1. Bonding curve math (for pump.fun/pump.pro tokens not graduated)
 * 2. Spot price fallback (price × tokens)
 *
 * Note: Jupiter quote would be ideal for graduated tokens but requires
 * async API calls that are slow for UI. Use spot price for graduated tokens.
 */
export async function getExpectedSolOut(
  mint: string,
  tokensAdjusted: number,
  options: {
    marketData?: MarketData;
    solPriceUsd?: number;
  } = {}
): Promise<{ solOut: number; source: 'bonding_curve' | 'spot' }> {
  // Get market data if not provided
  const data = options.marketData || await getMarketData(mint, { solPriceUsd: options.solPriceUsd });

  // If we have bonding curve reserves, use bonding curve math
  if (data.virtualSolReserves && data.virtualTokenReserves && !data.isGraduated) {
    try {
      // Create a minimal PumpFunToken object for calculateSellPrice
      const pseudoToken: PumpFunToken = {
        mint,
        name: '',
        symbol: '',
        description: '',
        imageUri: '',
        metadataUri: '',
        creator: '',
        createdTimestamp: 0,
        complete: false,
        virtualSolReserves: data.virtualSolReserves,
        virtualTokenReserves: data.virtualTokenReserves,
        realSolReserves: 0,
        realTokenReserves: 0,
        totalSupply: data.supply,
        bondingCurveProgress: data.bondingCurveProgress || 0,
        priceInSol: data.priceSol,
        priceInUsd: data.priceUsd,
        marketCapSol: data.marketCapSol,
        marketCapUsd: data.marketCapUsd,
        bondingCurve: '',
        associatedBondingCurve: '',
      };

      const sellResult = calculateSellPrice(pseudoToken, tokensAdjusted);
      return { solOut: sellResult.solAmount, source: 'bonding_curve' };
    } catch (error) {
      console.warn(`[MarketData] Bonding curve sell calc failed for ${mint}:`, error);
    }
  }

  // Fallback to spot price calculation
  const solOut = data.priceSol * tokensAdjusted;
  return { solOut, source: 'spot' };
}

/**
 * Compute quote-based PnL for a position
 *
 * Formula:
 * - currentValueSol = getExpectedSolOut(tokens)
 * - pnlSol = currentValueSol - entryCostSol
 * - pnlPercent = (pnlSol / entryCostSol) * 100
 */
export async function computeQuotePnl(
  mint: string,
  tokensAdjusted: number,
  entryCostSol: number,
  options: {
    marketData?: MarketData;
    solPriceUsd?: number;
  } = {}
): Promise<QuotePnlResult> {
  if (entryCostSol <= 0 || tokensAdjusted <= 0) {
    return {
      currentValueSol: 0,
      pnlSol: 0,
      pnlPercent: 0,
      source: 'spot',
    };
  }

  const { solOut, source } = await getExpectedSolOut(mint, tokensAdjusted, options);

  const currentValueSol = solOut;
  const pnlSol = currentValueSol - entryCostSol;
  const pnlPercent = (pnlSol / entryCostSol) * 100;

  return {
    currentValueSol,
    pnlSol,
    pnlPercent,
    source: source === 'bonding_curve' ? 'bonding_curve' : 'spot',
  };
}

/**
 * Calculate entry market cap from entry price and supply
 */
export function calculateEntryMc(
  entryPrice: number,
  totalSupply: number = PUMP_FUN_TOTAL_SUPPLY,
  solPriceUsd?: number
): { entryMcSol: number; entryMcUsd: number | null } {
  const entryMcSol = entryPrice * totalSupply;
  const entryMcUsd = solPriceUsd ? entryMcSol * solPriceUsd : null;
  return { entryMcSol, entryMcUsd };
}

/**
 * Clear the market data cache
 */
export function clearMarketDataCache(): void {
  marketDataCache.clear();
}

// =============================================================================
// Helper Functions
// =============================================================================

function pumpFunTokenToMarketData(
  token: PumpFunToken,
  decimals: number,
  solPriceUsd?: number
): MarketData {
  return {
    mint: token.mint,
    priceSol: token.priceInSol,
    priceUsd: solPriceUsd ? token.priceInSol * solPriceUsd : token.priceInUsd,
    marketCapSol: token.marketCapSol,
    marketCapUsd: solPriceUsd ? token.marketCapSol * solPriceUsd : token.marketCapUsd,
    supply: token.totalSupply,
    decimals,
    source: token.complete ? 'pumpfun_api' : 'bonding_curve',
    isGraduated: token.complete,
    bondingCurveProgress: token.bondingCurveProgress,
    virtualSolReserves: token.virtualSolReserves,
    virtualTokenReserves: token.virtualTokenReserves,
  };
}

function priceSourceToMarketDataSource(source: PriceResult['source']): MarketDataSource {
  switch (source) {
    case 'jupiter':
      return 'jupiter';
    case 'dexscreener':
      return 'dexscreener';
    case 'pumpfun':
      return 'pumpfun_api';
    default:
      return 'none';
  }
}
