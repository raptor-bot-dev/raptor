/**
 * Moonshot API for RAPTOR
 *
 * DEPRECATED: Moonshot has no WebSocket monitor for real-time detection.
 * This file is kept as a stub for backward compatibility.
 * All functions return empty results.
 *
 * To add Moonshot support in the future:
 * 1. Implement WebSocket monitor in apps/hunter/src/monitors/moonshot.ts
 * 2. Restore this API file
 * 3. Add to launchpadDetector.ts
 */

export interface MoonshotToken {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  creator: string;
  createdAt: number;
  status: 'bonding' | 'migrating' | 'migrated';
  bondingCurveProgress: number;
  solRaised: number;
  targetSol: number;
  priceInSol: number;
  priceInUsd: number | null;
  marketCapSol: number;
  marketCapUsd: number | null;
  volume24h: number;
  txCount24h: number;
  totalSupply: number;
  circulatingSupply: number;
  migratedAt?: number;
  poolAddress?: string;
  dex?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

/**
 * DEPRECATED: No monitor implementation
 */
export async function getTokenInfo(
  _mint: string,
  _solPriceUsd?: number
): Promise<MoonshotToken | null> {
  return null;
}

/**
 * DEPRECATED: No monitor implementation
 */
export async function isMoonshotToken(_mint: string): Promise<boolean> {
  return false;
}

/**
 * DEPRECATED: No monitor implementation
 */
export function getMoonshotStatus(_token: MoonshotToken): {
  emoji: string;
  label: string;
  description: string;
} {
  return { emoji: '❓', label: 'Unknown', description: 'Moonshot not implemented' };
}

/**
 * DEPRECATED: No monitor implementation
 */
export function formatBondingBar(_progress: number): string {
  return '░░░░░░░░░░';
}

/**
 * Get Moonshot links (still valid for UI)
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
 * DEPRECATED: No-op
 */
export function clearCache(): void {
  // No-op - not implemented
}
