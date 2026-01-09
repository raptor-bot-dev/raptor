/**
 * Fast Check Module for RAPTOR v2.2
 *
 * Tier 1 analysis using only cached data for O(1) lookups.
 * Target: < 10ms total execution time.
 *
 * Checks performed:
 * 1. Trusted source? (Set lookup)
 * 2. Not blacklisted token? (Set lookup)
 * 3. Not blacklisted deployer? (Set lookup)
 * 4. Minimum liquidity met? (comparison)
 */

import type { Chain } from '@raptor/shared';
import { speedCache } from '@raptor/shared';
import { isTrustedSource, normalizeSource } from '@raptor/shared';

export interface FastCheckInput {
  tokenAddress: string;
  deployerAddress: string;
  chain: Chain;
  source: string;
  liquidity: bigint;
  tokenAgeSeconds: number;
}

export interface FastCheckResult {
  canTrade: boolean;
  reason: string;
  source: string;
  normalizedSource: string;
  liquidity: bigint;
  checks: {
    trustedSource: boolean;
    notBlacklistedToken: boolean;
    notBlacklistedDeployer: boolean;
    meetsMinLiquidity: boolean;
    isFreshToken: boolean;
  };
  executionTimeMs: number;
}

// Minimum liquidity requirements per chain (in native token wei/lamports)
const MIN_LIQUIDITY: Record<Chain, bigint> = {
  sol: BigInt(50e9), // 50 SOL (in lamports)
  bsc: BigInt(3e18), // 3 BNB (in wei)
  base: BigInt(1e18), // 1 ETH (in wei)
  eth: BigInt(2e18), // 2 ETH (in wei)
};

// Maximum token age for fast-path (5 minutes)
const MAX_FAST_AGE_SECONDS = 300;

/**
 * Perform fast check using only cached data
 * Target execution time: < 10ms
 */
export function fastCheck(input: FastCheckInput): FastCheckResult {
  const startTime = performance.now();

  const normalizedSource = normalizeSource(input.source);
  const tokenLower = input.tokenAddress.toLowerCase();
  const deployerLower = input.deployerAddress.toLowerCase();

  // 1. Check trusted source (O(1) Set lookup)
  const trustedSource = isTrustedSource(normalizedSource);

  // 2. Check token not blacklisted (O(1) Set lookup)
  const notBlacklistedToken = !speedCache.isTokenBlacklisted(tokenLower);

  // 3. Check deployer not blacklisted (O(1) Set lookup)
  const notBlacklistedDeployer = !speedCache.isDeployerBlacklisted(deployerLower);

  // 4. Check minimum liquidity (simple comparison)
  const minLiq = MIN_LIQUIDITY[input.chain];
  const meetsMinLiquidity = input.liquidity >= minLiq;

  // 5. Check token freshness
  const isFreshToken = input.tokenAgeSeconds <= MAX_FAST_AGE_SECONDS;

  // Build result
  const checks = {
    trustedSource,
    notBlacklistedToken,
    notBlacklistedDeployer,
    meetsMinLiquidity,
    isFreshToken,
  };

  // Determine if we can trade
  let canTrade = true;
  let reason = 'All fast checks passed';

  if (!trustedSource) {
    canTrade = false;
    reason = `Untrusted source: ${input.source}`;
  } else if (!notBlacklistedToken) {
    canTrade = false;
    reason = 'Token is blacklisted';
  } else if (!notBlacklistedDeployer) {
    canTrade = false;
    reason = 'Deployer is blacklisted';
  } else if (!meetsMinLiquidity) {
    canTrade = false;
    reason = `Insufficient liquidity: ${formatLiquidity(input.liquidity, input.chain)} < ${formatLiquidity(minLiq, input.chain)}`;
  } else if (!isFreshToken) {
    canTrade = false;
    reason = `Token too old: ${input.tokenAgeSeconds}s > ${MAX_FAST_AGE_SECONDS}s`;
  }

  const executionTimeMs = performance.now() - startTime;

  return {
    canTrade,
    reason,
    source: input.source,
    normalizedSource,
    liquidity: input.liquidity,
    checks,
    executionTimeMs,
  };
}

/**
 * Format liquidity for display
 */
function formatLiquidity(amount: bigint, chain: Chain): string {
  const decimals = chain === 'sol' ? 9 : 18;
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, '0').slice(0, 2);

  const symbol = {
    sol: 'SOL',
    bsc: 'BNB',
    base: 'ETH',
    eth: 'ETH',
  }[chain];

  return `${whole}.${fraction} ${symbol}`;
}

/**
 * Quick blacklist check only (for post-buy verification)
 */
export function quickBlacklistCheck(
  tokenAddress: string,
  deployerAddress: string
): { isBlacklisted: boolean; type: 'token' | 'deployer' | null } {
  if (speedCache.isTokenBlacklisted(tokenAddress)) {
    return { isBlacklisted: true, type: 'token' };
  }
  if (speedCache.isDeployerBlacklisted(deployerAddress)) {
    return { isBlacklisted: true, type: 'deployer' };
  }
  return { isBlacklisted: false, type: null };
}

/**
 * Get minimum liquidity for a chain
 */
export function getMinLiquidity(chain: Chain): bigint {
  return MIN_LIQUIDITY[chain];
}

/**
 * Update minimum liquidity for a chain (runtime config)
 */
export function setMinLiquidity(chain: Chain, amount: bigint): void {
  MIN_LIQUIDITY[chain] = amount;
}
