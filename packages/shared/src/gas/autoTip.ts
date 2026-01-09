/**
 * Gas Auto-Tip for RAPTOR v2.2
 *
 * Automatically calculates optimal priority fees based on:
 * - Network congestion
 * - User speed preference
 * - Maximum USD cost limit
 *
 * Features:
 * - Real-time fee recommendations per chain
 * - Speed tiers: slow, normal, fast, turbo
 * - USD cost calculation
 * - Congestion detection
 */

import type { Chain } from '../types.js';

// Speed tiers
export type TipSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

// Re-use PriorityFees from speedCache to avoid duplicate export
import type { PriorityFees } from '../cache/speedCache.js';

// Gas recommendation
export interface GasRecommendation {
  chain: Chain;
  speed: TipSpeed;
  priorityFee: bigint;
  maxFee?: bigint;
  estimatedCostUSD: number;
  congestionLevel: 'low' | 'medium' | 'high' | 'extreme';
  warning?: string;
}

// Speed multipliers relative to normal
const SPEED_MULTIPLIERS: Record<TipSpeed, number> = {
  slow: 0.5,
  normal: 1.0,
  fast: 2.0,
  turbo: 3.0,
};

// Base priority fees per chain (in native units, updated by speedCache)
// These are fallback values if cache is not populated
const BASE_PRIORITY_FEES: Record<Chain, { normal: bigint; unit: string }> = {
  sol: { normal: 100000n, unit: 'lamports' }, // 0.0001 SOL
  bsc: { normal: 3000000000n, unit: 'wei' }, // 3 gwei
  base: { normal: 100000000n, unit: 'wei' }, // 0.1 gwei
  eth: { normal: 2000000000n, unit: 'wei' }, // 2 gwei
};

// Approximate native token prices (updated by speedCache)
let tokenPrices: Record<Chain, number> = {
  sol: 150,
  bsc: 600,
  base: 3500,
  eth: 3500,
};

// Cached priority fees (updated externally)
let cachedFees: Record<Chain, PriorityFees> = {
  sol: createDefaultFees('sol'),
  bsc: createDefaultFees('bsc'),
  base: createDefaultFees('base'),
  eth: createDefaultFees('eth'),
};

/**
 * Create default fees for a chain
 */
function createDefaultFees(chain: Chain): PriorityFees {
  const base = BASE_PRIORITY_FEES[chain].normal;
  return {
    slow: (base * 50n) / 100n,
    normal: base,
    fast: base * 2n,
    turbo: base * 3n,
    lastUpdated: Date.now(),
  };
}

/**
 * Update cached priority fees (called by speedCache)
 */
export function updatePriorityFees(chain: Chain, fees: PriorityFees): void {
  cachedFees[chain] = fees;
}

/**
 * Update token prices (called by speedCache)
 */
export function updateTokenPrices(prices: Record<Chain, number>): void {
  tokenPrices = { ...tokenPrices, ...prices };
}

/**
 * Get recommended priority fee for a chain and speed
 */
export function getRecommendedTip(
  chain: Chain,
  speed: TipSpeed,
  maxUSD?: number
): GasRecommendation {
  const fees = cachedFees[chain];
  let priorityFee = fees[speed];

  // Calculate USD cost
  let estimatedCostUSD = calculateTipCostUSD(chain, priorityFee);

  // Apply max USD limit if specified
  if (maxUSD && estimatedCostUSD > maxUSD) {
    // Scale down to fit within budget
    const scaleFactor = maxUSD / estimatedCostUSD;
    priorityFee = BigInt(Math.floor(Number(priorityFee) * scaleFactor));
    estimatedCostUSD = maxUSD;
  }

  // Detect congestion level
  const congestionLevel = detectCongestion(chain, fees);

  // Build recommendation
  const recommendation: GasRecommendation = {
    chain,
    speed,
    priorityFee,
    estimatedCostUSD,
    congestionLevel,
  };

  // Add max fee for EIP-1559 chains
  if (chain !== 'sol') {
    // Max fee = priority fee + 2x base fee buffer
    recommendation.maxFee = priorityFee * 3n;
  }

  // Add warnings for high costs
  if (chain === 'eth' && estimatedCostUSD > 10) {
    recommendation.warning = 'High ETH gas costs - consider Base or BSC';
  } else if (congestionLevel === 'extreme') {
    recommendation.warning = 'Network congestion is extreme - expect delays';
  }

  return recommendation;
}

/**
 * Calculate USD cost of a priority fee
 */
export function calculateTipCostUSD(chain: Chain, priorityFee: bigint): number {
  const price = tokenPrices[chain];

  // Convert to native token amount
  let nativeAmount: number;

  if (chain === 'sol') {
    // Solana: lamports to SOL
    nativeAmount = Number(priorityFee) / 1e9;
    // Assume ~200k compute units for typical swap
    nativeAmount *= 200000 / 1e6;
  } else {
    // EVM: wei to ETH/BNB
    // Assume ~200k gas for typical swap
    const gasUsed = 200000n;
    const totalWei = priorityFee * gasUsed;
    nativeAmount = Number(totalWei) / 1e18;
  }

  return nativeAmount * price;
}

/**
 * Detect network congestion level
 */
function detectCongestion(chain: Chain, fees: PriorityFees): 'low' | 'medium' | 'high' | 'extreme' {
  // Compare turbo to normal ratio
  const ratio = Number(fees.turbo) / Number(fees.normal);

  // Also check absolute values against historical baselines
  const baseline = BASE_PRIORITY_FEES[chain].normal;
  const currentVsBaseline = Number(fees.normal) / Number(baseline);

  if (ratio > 5 || currentVsBaseline > 10) {
    return 'extreme';
  } else if (ratio > 3 || currentVsBaseline > 5) {
    return 'high';
  } else if (ratio > 2 || currentVsBaseline > 2) {
    return 'medium';
  }
  return 'low';
}

/**
 * Get all speed tier recommendations for a chain
 */
export function getAllSpeedRecommendations(
  chain: Chain,
  maxUSD?: number
): Record<TipSpeed, GasRecommendation> {
  return {
    slow: getRecommendedTip(chain, 'slow', maxUSD),
    normal: getRecommendedTip(chain, 'normal', maxUSD),
    fast: getRecommendedTip(chain, 'fast', maxUSD),
    turbo: getRecommendedTip(chain, 'turbo', maxUSD),
  };
}

/**
 * Check if a trade is viable given gas costs
 * Used for micro-scalp strategy validation
 */
export function isTradeViable(
  chain: Chain,
  speed: TipSpeed,
  tradeAmountUSD: number,
  expectedProfitPercent: number,
  minNetProfitUSD: number = 0.50
): { viable: boolean; reason?: string; netProfitUSD: number } {
  const recommendation = getRecommendedTip(chain, speed);
  const gasCostUSD = recommendation.estimatedCostUSD;

  // Calculate expected profit
  const grossProfitUSD = tradeAmountUSD * (expectedProfitPercent / 100);

  // Subtract gas (buy + sell) and 1% fee
  const feeUSD = tradeAmountUSD * 0.01;
  const totalCostsUSD = gasCostUSD * 2 + feeUSD; // Gas for buy and sell
  const netProfitUSD = grossProfitUSD - totalCostsUSD;

  if (netProfitUSD < minNetProfitUSD) {
    return {
      viable: false,
      reason: `Net profit $${netProfitUSD.toFixed(2)} below minimum $${minNetProfitUSD.toFixed(2)}`,
      netProfitUSD,
    };
  }

  // Additional check for ETH mainnet
  if (chain === 'eth' && gasCostUSD > tradeAmountUSD * 0.05) {
    return {
      viable: false,
      reason: 'Gas costs exceed 5% of trade on ETH mainnet',
      netProfitUSD,
    };
  }

  return {
    viable: true,
    netProfitUSD,
  };
}

/**
 * Format gas recommendation for display
 */
export function formatGasRecommendation(rec: GasRecommendation): string {
  const speedEmoji: Record<TipSpeed, string> = {
    slow: '🐢',
    normal: '🚶',
    fast: '🏃',
    turbo: '🚀',
  };

  const congestionEmoji: Record<string, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    extreme: '🔴',
  };

  let msg = `${speedEmoji[rec.speed]} ${rec.speed.toUpperCase()}\n`;
  msg += `Cost: ~$${rec.estimatedCostUSD.toFixed(2)}\n`;
  msg += `Network: ${congestionEmoji[rec.congestionLevel]} ${rec.congestionLevel}`;

  if (rec.warning) {
    msg += `\n⚠️ ${rec.warning}`;
  }

  return msg;
}

/**
 * Fetch and update priority fees from RPC
 * Called periodically by speedCache background updater
 */
export async function fetchPriorityFees(chain: Chain): Promise<PriorityFees> {
  // Placeholder - in production this would:
  // - Solana: Call getPriorityFeeEstimate or analyze recent blocks
  // - EVM: Call eth_feeHistory or similar

  // For now, return slightly randomized values to simulate network activity
  const base = BASE_PRIORITY_FEES[chain].normal;
  const jitter = () => BigInt(Math.floor(Math.random() * 20) - 10) / 100n;

  const normal = base + (base * jitter()) / 100n;

  return {
    slow: (normal * 50n) / 100n,
    normal,
    fast: normal * 2n,
    turbo: normal * 3n,
    lastUpdated: Date.now(),
  };
}
