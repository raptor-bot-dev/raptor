/**
 * Unified Launchpad Detector for RAPTOR
 *
 * Currently supports:
 * - PumpFun (pump.fun) - Full support with WebSocket monitor
 * - Raydium - Fallback for graduated/unknown tokens via DexScreener
 *
 * Deprecated (no monitor implementation):
 * - Moonshot, Bonk.fun, Believe - stubbed out, kept for backward compatibility
 */

import * as pumpfun from './pumpfun.js';
import * as rugcheck from './rugcheck.js';
import * as goplus from './goplus.js';
import * as dexscreener from './dexscreener.js';

// NOTE: moonshot and bonkfun imports removed - APIs are stubbed out

// Simplified to only working launchpads
export type LaunchpadType = 'pumpfun' | 'raydium' | 'unknown';

export interface LaunchpadInfo {
  launchpad: LaunchpadType;
  status: 'bonding' | 'migrating' | 'graduated' | 'trading';
  bondingProgress: number; // 0-100%
  solRaised: number;
  targetSol: number;
}

export interface UnifiedTokenData {
  // Basic info
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;

  // Creator
  creator: string;
  createdAt: number;

  // Launchpad info
  launchpad: LaunchpadInfo;

  // Price data
  priceInSol: number;
  priceInUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;

  // Trading
  volume24h: number;
  liquidity: number;
  holders: number;

  // Security (from RugCheck/GoPlus)
  security: {
    riskLevel: string;
    riskScore: number;
    isMintable: boolean;
    isFreezable: boolean;
    lpStatus: string;
    risks: string[];
  } | null;

  // Links
  links: {
    launchpad: string;
    dexscreener: string;
    birdeye: string;
    solscan: string;
  };

  // Raw data from source
  rawData: unknown;
}

/**
 * Detect launchpad and get unified token data
 * Simplified to pump.fun + DexScreener fallback only
 */
export async function detectAndFetch(
  mint: string,
  solPriceUsd?: number
): Promise<UnifiedTokenData | null> {
  // Try pump.fun and DexScreener in parallel
  const [pumpResult, dexResult, rugResult, goplusResult] = await Promise.allSettled([
    pumpfun.getTokenInfo(mint, solPriceUsd),
    dexscreener.getTokenByAddress(mint),
    rugcheck.getTokenSecurity(mint),
    goplus.getTokenSecurity(mint, 'sol'),
  ]);

  const pumpData = pumpResult.status === 'fulfilled' ? pumpResult.value : null;
  const dexData = dexResult.status === 'fulfilled' ? dexResult.value : null;
  const rugData = rugResult.status === 'fulfilled' ? rugResult.value : null;
  const goplusData = goplusResult.status === 'fulfilled' ? goplusResult.value : null;

  // PumpFun takes priority
  if (pumpData) {
    return convertPumpFunData(pumpData, rugData, goplusData);
  }

  // DexScreener fallback (Raydium/Orca tokens)
  if (dexData?.data) {
    return convertDexScreenerData(dexData.data, mint, rugData, goplusData, solPriceUsd);
  }

  return null;
}

/**
 * Quick launchpad detection (no data fetch)
 * Simplified to pump.fun only
 */
export async function detectLaunchpad(mint: string): Promise<LaunchpadType> {
  const isPump = await pumpfun.isPumpFunToken(mint).catch(() => false);
  if (isPump) return 'pumpfun';
  return 'unknown';
}

/**
 * Get new launches from pump.fun
 * Note: Bonk.fun API was removed as the endpoint doesn't exist
 */
export async function getNewLaunches(limit = 10): Promise<UnifiedTokenData[]> {
  console.log('[LaunchpadDetector] Fetching new launches from pump.fun...');

  try {
    const pumpLaunches = await pumpfun.getNewLaunches(limit);
    console.log(`[LaunchpadDetector] PumpFun new launches: ${pumpLaunches.length}`);

    const results: UnifiedTokenData[] = [];
    for (const token of pumpLaunches) {
      const converted = convertPumpFunData(token, null, null);
      if (converted) results.push(converted);
    }

    // Sort by creation time
    results.sort((a, b) => b.createdAt - a.createdAt);

    return results.slice(0, limit);
  } catch (error) {
    console.error('[LaunchpadDetector] PumpFun new launches failed:', error);
    return [];
  }
}

/**
 * Get trending tokens from pump.fun
 * Note: Bonk.fun API was removed as the endpoint doesn't exist
 */
export async function getTrending(limit = 10): Promise<UnifiedTokenData[]> {
  console.log('[LaunchpadDetector] Fetching trending tokens from pump.fun...');

  try {
    const pumpTrending = await pumpfun.getTrendingTokens(limit);
    console.log(`[LaunchpadDetector] PumpFun trending: ${pumpTrending.length}`);

    const results: UnifiedTokenData[] = [];
    for (const token of pumpTrending) {
      const converted = convertPumpFunData(token, null, null);
      if (converted) results.push(converted);
    }

    // Sort by market cap
    results.sort((a, b) => b.marketCapSol - a.marketCapSol);

    return results.slice(0, limit);
  } catch (error) {
    console.error('[LaunchpadDetector] PumpFun trending failed:', error);
    return [];
  }
}

// Converter functions

function convertPumpFunData(
  token: pumpfun.PumpFunToken,
  rug: rugcheck.RugCheckResult | null,
  gop: goplus.GoPlusSecurityResult | null
): UnifiedTokenData {
  const status = token.complete ? 'graduated' : 'bonding';
  const links = pumpfun.getPumpFunLinks(token.mint);

  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    imageUri: token.imageUri,
    creator: token.creator,
    createdAt: token.createdTimestamp,
    launchpad: {
      launchpad: 'pumpfun',
      status,
      bondingProgress: token.bondingCurveProgress,
      solRaised: token.realSolReserves,
      targetSol: 85,
    },
    priceInSol: token.priceInSol,
    priceInUsd: token.priceInUsd,
    marketCapSol: token.marketCapSol,
    marketCapUsd: token.marketCapUsd,
    volume24h: 0,
    liquidity: token.realSolReserves,
    holders: 0,
    security: buildSecurityInfo(rug, gop),
    links: {
      launchpad: links.pumpfun,
      dexscreener: links.dexscreener,
      birdeye: links.birdeye,
      solscan: links.solscan,
    },
    rawData: token,
  };
}

// NOTE: convertMoonshotData and convertBonkFunData removed - APIs are stubbed out

function convertDexScreenerData(
  data: dexscreener.DexScreenerTokenData,
  mint: string,
  rug: rugcheck.RugCheckResult | null,
  gop: goplus.GoPlusSecurityResult | null,
  solPriceUsd?: number
): UnifiedTokenData {
  const priceUsd = data.priceUsd || 0;
  const priceInSol = solPriceUsd && solPriceUsd > 0 ? priceUsd / solPriceUsd : data.priceNative || 0;

  return {
    mint,
    name: data.name,
    symbol: data.symbol,
    description: '',
    imageUri: data.imageUrl || '',
    creator: '',
    createdAt: data.pairCreatedAt || 0,
    launchpad: {
      launchpad: 'raydium',
      status: 'trading',
      bondingProgress: 100,
      solRaised: 0,
      targetSol: 0,
    },
    priceInSol,
    priceInUsd: priceUsd,
    marketCapSol: data.fdv && solPriceUsd ? data.fdv / solPriceUsd : 0,
    marketCapUsd: data.fdv || 0,
    volume24h: data.volume24h || 0,
    liquidity: data.liquidity || 0,
    holders: 0,
    security: buildSecurityInfo(rug, gop),
    links: {
      launchpad: `https://raydium.io/swap/?inputMint=sol&outputMint=${mint}`,
      dexscreener: `https://dexscreener.com/solana/${mint}`,
      birdeye: `https://birdeye.so/token/${mint}?chain=solana`,
      solscan: `https://solscan.io/token/${mint}`,
    },
    rawData: data,
  };
}

function buildSecurityInfo(
  rug: rugcheck.RugCheckResult | null,
  gop: goplus.GoPlusSecurityResult | null
): UnifiedTokenData['security'] {
  if (!rug && !gop) return null;

  const risks: string[] = [];

  // Combine risks from both sources
  if (rug?.risks) risks.push(...rug.risks);
  if (gop?.risks) risks.push(...gop.risks);

  // Use RugCheck as primary for Solana
  if (rug) {
    return {
      riskLevel: rug.riskLevel,
      riskScore: rug.riskScore,
      isMintable: rug.isMintable,
      isFreezable: rug.isFreezable,
      lpStatus: rug.lpBurned
        ? `🔥 Burned ${rug.lpBurnedPercent.toFixed(0)}%`
        : rug.lpLocked
          ? `🔒 Locked ${rug.lpLockedPercent.toFixed(0)}%`
          : '⚠️ Not locked',
      risks: [...new Set(risks)], // Deduplicate
    };
  }

  // Fall back to GoPlus
  if (gop) {
    return {
      riskLevel: gop.riskLevel,
      riskScore: gop.riskScore,
      isMintable: gop.isMintable,
      isFreezable: false,
      lpStatus: 'Unknown',
      risks: [...new Set(risks)],
    };
  }

  return null;
}

/**
 * Get launchpad emoji
 */
export function getLaunchpadEmoji(launchpad: LaunchpadType): string {
  switch (launchpad) {
    case 'pumpfun':
      return '🎰';
    case 'raydium':
      return '💧';
    default:
      return '❓';
  }
}

/**
 * Get launchpad display name
 */
export function getLaunchpadName(launchpad: LaunchpadType): string {
  switch (launchpad) {
    case 'pumpfun':
      return 'Pump.fun';
    case 'raydium':
      return 'Raydium';
    default:
      return 'Unknown';
  }
}

/**
 * Format bonding curve bar
 */
export function formatBondingBar(progress: number): string {
  const filled = Math.floor(progress / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}
