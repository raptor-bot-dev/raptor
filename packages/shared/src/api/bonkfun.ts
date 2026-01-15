/**
 * Bonk.fun API for RAPTOR
 *
 * DEPRECATED: The Bonk.fun API (api.bonk.fun) does not exist.
 * This file is kept as a stub for backward compatibility.
 * All functions return empty results.
 */

export interface BonkFunToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  creator: string;
  createdAt: number;
  status: 'active' | 'migrating' | 'graduated';
  bondingCurveProgress: number;
  solRaised: number;
  targetSol: number;
  bonkBurned: number;
  bonkRewards: number;
  priceInSol: number;
  priceInUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;
  volume24h: number;
  holders: number;
  totalSupply: number;
  graduatedAt?: number;
  poolAddress?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

/**
 * DEPRECATED: Bonk.fun API does not exist
 */
export async function getTokenInfo(
  _mint: string,
  _solPriceUsd?: number
): Promise<BonkFunToken | null> {
  return null;
}

/**
 * DEPRECATED: Bonk.fun API does not exist
 */
export async function isBonkFunToken(_mint: string): Promise<boolean> {
  return false;
}

/**
 * DEPRECATED: Bonk.fun API does not exist
 */
export async function getTrending(_limit = 10): Promise<BonkFunToken[]> {
  return [];
}

/**
 * DEPRECATED: Bonk.fun API does not exist
 */
export async function getNewLaunches(_limit = 10): Promise<BonkFunToken[]> {
  return [];
}

/**
 * DEPRECATED: Bonk.fun API does not exist
 */
export function getBonkFunStatus(_token: BonkFunToken): {
  emoji: string;
  label: string;
  description: string;
} {
  return { emoji: '❓', label: 'Unknown', description: 'Bonk.fun API unavailable' };
}

/**
 * DEPRECATED: Bonk.fun API does not exist
 */
export function formatBondingBar(_progress: number): string {
  return '░░░░░░░░░░';
}

/**
 * Get Bonk.fun links (still valid for UI)
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
 * DEPRECATED: No-op
 */
export function clearCache(): void {
  // No-op - API doesn't exist
}
