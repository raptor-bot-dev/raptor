/**
 * Unified Launchpad Detector for RAPTOR
 *
 * Detects which launchpad a Solana token is from:
 * - PumpFun (pump.fun)
 * - Moonshot (DEX Screener)
 * - Bonk.fun (BONK ecosystem)
 * - Believe.app
 *
 * Aggregates data from multiple sources
 */

import * as pumpfun from './pumpfun.js';
import * as moonshot from './moonshot.js';
import * as bonkfun from './bonkfun.js';
import * as rugcheck from './rugcheck.js';
import * as goplus from './goplus.js';
import * as dexscreener from './dexscreener.js';

export type LaunchpadType = 'pumpfun' | 'moonshot' | 'bonkfun' | 'believe' | 'raydium' | 'unknown';

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
 */
export async function detectAndFetch(
  mint: string,
  solPriceUsd?: number
): Promise<UnifiedTokenData | null> {
  // Try all launchpads in parallel
  const [pumpResult, moonshotResult, bonkResult, dexResult, rugResult, goplusResult] = await Promise.allSettled([
    pumpfun.getTokenInfo(mint, solPriceUsd),
    moonshot.getTokenInfo(mint, solPriceUsd),
    bonkfun.getTokenInfo(mint, solPriceUsd),
    dexscreener.getTokenByAddress(mint),
    rugcheck.getTokenSecurity(mint),
    goplus.getTokenSecurity(mint, 'sol'),
  ]);

  const pumpData = pumpResult.status === 'fulfilled' ? pumpResult.value : null;
  const moonshotData = moonshotResult.status === 'fulfilled' ? moonshotResult.value : null;
  const bonkData = bonkResult.status === 'fulfilled' ? bonkResult.value : null;
  const dexData = dexResult.status === 'fulfilled' ? dexResult.value : null;
  const rugData = rugResult.status === 'fulfilled' ? rugResult.value : null;
  const goplusData = goplusResult.status === 'fulfilled' ? goplusResult.value : null;

  // Determine launchpad and primary data source
  let launchpad: LaunchpadType = 'unknown';
  let primaryData: UnifiedTokenData | null = null;

  // PumpFun takes priority for bonding curve tokens
  if (pumpData && !pumpData.complete) {
    launchpad = 'pumpfun';
    primaryData = convertPumpFunData(pumpData, rugData, goplusData);
  }
  // Then Moonshot
  else if (moonshotData && moonshotData.status !== 'migrated') {
    launchpad = 'moonshot';
    primaryData = convertMoonshotData(moonshotData, rugData, goplusData);
  }
  // Then Bonk.fun
  else if (bonkData && bonkData.status !== 'graduated') {
    launchpad = 'bonkfun';
    primaryData = convertBonkFunData(bonkData, rugData, goplusData);
  }
  // Graduated PumpFun
  else if (pumpData?.complete) {
    launchpad = 'pumpfun';
    primaryData = convertPumpFunData(pumpData, rugData, goplusData);
  }
  // Graduated Moonshot
  else if (moonshotData?.status === 'migrated') {
    launchpad = 'moonshot';
    primaryData = convertMoonshotData(moonshotData, rugData, goplusData);
  }
  // Graduated Bonk.fun
  else if (bonkData?.status === 'graduated') {
    launchpad = 'bonkfun';
    primaryData = convertBonkFunData(bonkData, rugData, goplusData);
  }
  // DexScreener data only (regular Raydium/Orca token)
  else if (dexData?.data) {
    launchpad = 'raydium';
    primaryData = convertDexScreenerData(dexData.data, mint, rugData, goplusData, solPriceUsd);
  }

  return primaryData;
}

/**
 * Quick launchpad detection (no data fetch)
 */
export async function detectLaunchpad(mint: string): Promise<LaunchpadType> {
  const [isPump, isMoon, isBonk] = await Promise.all([
    pumpfun.isPumpFunToken(mint).catch(() => false),
    moonshot.isMoonshotToken(mint).catch(() => false),
    bonkfun.isBonkFunToken(mint).catch(() => false),
  ]);

  if (isPump) return 'pumpfun';
  if (isMoon) return 'moonshot';
  if (isBonk) return 'bonkfun';

  return 'unknown';
}

/**
 * Get new launches from all launchpads
 */
export async function getNewLaunches(limit = 10): Promise<UnifiedTokenData[]> {
  console.log('[LaunchpadDetector] Fetching new launches...');
  const [pumpLaunches, bonkLaunches] = await Promise.allSettled([
    pumpfun.getNewLaunches(limit),
    bonkfun.getNewLaunches(limit),
  ]);

  const results: UnifiedTokenData[] = [];

  if (pumpLaunches.status === 'fulfilled') {
    console.log(`[LaunchpadDetector] PumpFun new launches: ${pumpLaunches.value.length}`);
    for (const token of pumpLaunches.value) {
      const converted = convertPumpFunData(token, null, null);
      if (converted) results.push(converted);
    }
  } else {
    console.error('[LaunchpadDetector] PumpFun new launches failed:', pumpLaunches.reason);
  }

  if (bonkLaunches.status === 'fulfilled') {
    console.log(`[LaunchpadDetector] BonkFun new launches: ${bonkLaunches.value.length}`);
    for (const token of bonkLaunches.value) {
      const converted = convertBonkFunData(token, null, null);
      if (converted) results.push(converted);
    }
  } else {
    console.error('[LaunchpadDetector] BonkFun new launches failed:', bonkLaunches.reason);
  }

  console.log(`[LaunchpadDetector] Total new launches: ${results.length}`);

  // Sort by creation time
  results.sort((a, b) => b.createdAt - a.createdAt);

  return results.slice(0, limit);
}

/**
 * Get trending tokens from all launchpads
 */
export async function getTrending(limit = 10): Promise<UnifiedTokenData[]> {
  console.log('[LaunchpadDetector] Fetching trending tokens...');
  const [pumpTrending, bonkTrending] = await Promise.allSettled([
    pumpfun.getTrendingTokens(limit),
    bonkfun.getTrending(limit),
  ]);

  const results: UnifiedTokenData[] = [];

  if (pumpTrending.status === 'fulfilled') {
    console.log(`[LaunchpadDetector] PumpFun trending: ${pumpTrending.value.length}`);
    for (const token of pumpTrending.value) {
      const converted = convertPumpFunData(token, null, null);
      if (converted) results.push(converted);
    }
  } else {
    console.error('[LaunchpadDetector] PumpFun trending failed:', pumpTrending.reason);
  }

  if (bonkTrending.status === 'fulfilled') {
    console.log(`[LaunchpadDetector] BonkFun trending: ${bonkTrending.value.length}`);
    for (const token of bonkTrending.value) {
      const converted = convertBonkFunData(token, null, null);
      if (converted) results.push(converted);
    }
  } else {
    console.error('[LaunchpadDetector] BonkFun trending failed:', bonkTrending.reason);
  }

  console.log(`[LaunchpadDetector] Total trending: ${results.length}`);

  // Sort by market cap
  results.sort((a, b) => b.marketCapSol - a.marketCapSol);

  return results.slice(0, limit);
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

function convertMoonshotData(
  token: moonshot.MoonshotToken,
  rug: rugcheck.RugCheckResult | null,
  gop: goplus.GoPlusSecurityResult | null
): UnifiedTokenData {
  const links = moonshot.getMoonshotLinks(token.mint);

  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    imageUri: token.imageUri,
    creator: token.creator,
    createdAt: token.createdAt,
    launchpad: {
      launchpad: 'moonshot',
      status: token.status === 'migrated' ? 'graduated' : token.status,
      bondingProgress: token.bondingCurveProgress,
      solRaised: token.solRaised,
      targetSol: token.targetSol,
    },
    priceInSol: token.priceInSol,
    priceInUsd: token.priceInUsd,
    marketCapSol: token.marketCapSol,
    marketCapUsd: token.marketCapUsd,
    volume24h: token.volume24h,
    liquidity: token.solRaised,
    holders: 0,
    security: buildSecurityInfo(rug, gop),
    links: {
      launchpad: links.moonshot,
      dexscreener: links.dexscreener,
      birdeye: links.birdeye,
      solscan: links.solscan,
    },
    rawData: token,
  };
}

function convertBonkFunData(
  token: bonkfun.BonkFunToken,
  rug: rugcheck.RugCheckResult | null,
  gop: goplus.GoPlusSecurityResult | null
): UnifiedTokenData {
  const links = bonkfun.getBonkFunLinks(token.mint);

  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    imageUri: token.imageUri,
    creator: token.creator,
    createdAt: token.createdAt,
    launchpad: {
      launchpad: 'bonkfun',
      status: token.status === 'graduated' ? 'graduated' : token.status === 'migrating' ? 'migrating' : 'bonding',
      bondingProgress: token.bondingCurveProgress,
      solRaised: token.solRaised,
      targetSol: token.targetSol,
    },
    priceInSol: token.priceInSol,
    priceInUsd: token.priceInUsd,
    marketCapSol: token.marketCapSol,
    marketCapUsd: token.marketCapUsd,
    volume24h: token.volume24h,
    liquidity: token.solRaised,
    holders: token.holders,
    security: buildSecurityInfo(rug, gop),
    links: {
      launchpad: links.bonkfun,
      dexscreener: links.dexscreener,
      birdeye: links.birdeye,
      solscan: links.solscan,
    },
    rawData: token,
  };
}

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
    case 'moonshot':
      return '🌙';
    case 'bonkfun':
      return '🐕';
    case 'believe':
      return '✨';
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
    case 'moonshot':
      return 'Moonshot';
    case 'bonkfun':
      return 'Bonk.fun';
    case 'believe':
      return 'Believe';
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
