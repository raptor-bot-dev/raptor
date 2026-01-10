/**
 * 7-Category Token Scoring System for RAPTOR v2.2
 *
 * Each category scores 0-5 points for a max total of 35.
 *
 * Categories:
 * 1. Sellability (5) - Can sell, tax levels
 * 2. Supply Integrity (5) - Fixed supply, no mint authority
 * 3. Liquidity Control (5) - LP locked, liquidity depth
 * 4. Distribution (5) - Holder concentration, clusters
 * 5. Deployer Provenance (5) - History, rug count
 * 6. Post-Launch Controls (5) - Authorities, ownership
 * 7. Execution Risk (5) - Slippage, gas costs
 *
 * Score Decisions:
 * 0-14: SKIP - Too risky
 * 15-22: TINY - Small position only
 * 23-28: TRADABLE - Normal position
 * 29-35: BEST - Max position
 */

import type { Chain, ChainConfig, Opportunity } from '@raptor/shared';
import {
  MIN_LIQUIDITY_BNB,
  MIN_LIQUIDITY_ETH,
  MAX_BUY_TAX,
  MAX_SELL_TAX,
} from '@raptor/shared';

// Score thresholds for trading decisions
export const SCORE_SKIP = 14;
export const SCORE_TINY = 22;
export const SCORE_TRADABLE = 28;
export const SCORE_BEST = 35;

export type ScoreDecision = 'SKIP' | 'TINY' | 'TRADABLE' | 'BEST';

// Individual category scores
export interface CategoryScores {
  sellability: number;       // 0-5: Can sell, tax levels
  supplyIntegrity: number;   // 0-5: Fixed supply, no mint authority
  liquidityControl: number;  // 0-5: LP locked, liquidity depth
  distribution: number;      // 0-5: Holder concentration, clusters
  deployerProvenance: number; // 0-5: Deployer history, rug count
  postLaunchControls: number; // 0-5: Authorities, ownership
  executionRisk: number;     // 0-5: Slippage, gas costs
}

// Full scoring result
export interface ScoreResult {
  total: number;
  categories: CategoryScores;
  decision: ScoreDecision;
  reasons: string[];
}

// Input data for scoring
export interface ScoreInput {
  // Sellability
  canSell: boolean;
  buyTax: number;  // basis points
  sellTax: number; // basis points
  isHoneypot: boolean;

  // Supply Integrity
  hasMintAuthority: boolean;
  totalSupply: bigint;
  maxSupply?: bigint;
  burnedPercent?: number;

  // Liquidity Control
  liquidity: bigint;
  isLpLocked: boolean;
  lpLockDurationDays?: number;

  // Distribution
  topHolderPercent: number;
  top10HoldersPercent: number;
  holderCount: number;
  hasClusterPatterns?: boolean;

  // Deployer Provenance
  deployerRugCount: number;
  deployerSuccessCount: number;
  deployerAge?: number; // days
  isDeployerBlacklisted: boolean;

  // Post-Launch Controls
  hasOwnership: boolean;
  canPauseTransfers: boolean;
  hasBlacklist: boolean;
  hasFreezeAuthority?: boolean; // Solana

  // Execution Risk
  estimatedSlippage: number; // basis points
  estimatedGasUSD: number;
  positionSizeUSD: number;
}

/**
 * Calculate the full 7-category score
 */
export function calculateFullScore(input: ScoreInput): ScoreResult {
  const categories: CategoryScores = {
    sellability: scoreSellability(input),
    supplyIntegrity: scoreSupplyIntegrity(input),
    liquidityControl: scoreLiquidityControl(input),
    distribution: scoreDistribution(input),
    deployerProvenance: scoreDeployerProvenance(input),
    postLaunchControls: scorePostLaunchControls(input),
    executionRisk: scoreExecutionRisk(input),
  };

  const total = Object.values(categories).reduce((sum, val) => sum + val, 0);
  const decision = getScoreDecision(total);
  const reasons = getScoreReasons(categories, input);

  return { total, categories, decision, reasons };
}

/**
 * Score sellability (0-5)
 */
function scoreSellability(input: ScoreInput): number {
  // Honeypot = 0
  if (input.isHoneypot || !input.canSell) return 0;

  let score = 5;

  // Deduct for taxes
  const avgTax = (input.buyTax + input.sellTax) / 2;

  if (avgTax > 1000) score -= 3;       // >10% tax
  else if (avgTax > 500) score -= 2;   // >5% tax
  else if (avgTax > 200) score -= 1;   // >2% tax

  // Deduct for high sell tax specifically
  if (input.sellTax > input.buyTax + 200) score -= 1;

  return Math.max(0, score);
}

/**
 * Score supply integrity (0-5)
 */
function scoreSupplyIntegrity(input: ScoreInput): number {
  let score = 5;

  // Mint authority = major deduction
  if (input.hasMintAuthority) score -= 3;

  // Check if supply is capped
  if (input.maxSupply && input.maxSupply > input.totalSupply) {
    score -= 1;
  }

  // Bonus for burned tokens
  if (input.burnedPercent && input.burnedPercent > 50) {
    score = Math.min(5, score + 1);
  }

  return Math.max(0, score);
}

/**
 * Score liquidity control (0-5)
 */
function scoreLiquidityControl(input: ScoreInput): number {
  let score = 0;

  // Base liquidity score (0-3)
  const MIN_LIQ = BigInt(1e18); // 1 ETH/BNB equivalent
  const GOOD_LIQ = BigInt(5e18);
  const GREAT_LIQ = BigInt(10e18);

  if (input.liquidity >= GREAT_LIQ) score += 3;
  else if (input.liquidity >= GOOD_LIQ) score += 2;
  else if (input.liquidity >= MIN_LIQ) score += 1;

  // LP lock bonus (0-2)
  if (input.isLpLocked) {
    if (input.lpLockDurationDays && input.lpLockDurationDays >= 180) {
      score += 2;
    } else if (input.lpLockDurationDays && input.lpLockDurationDays >= 30) {
      score += 1;
    } else {
      score += 1; // Lock exists but short duration
    }
  }

  return Math.min(5, score);
}

/**
 * Score distribution (0-5)
 */
function scoreDistribution(input: ScoreInput): number {
  let score = 5;

  // Top holder concentration
  if (input.topHolderPercent > 50) score -= 3;
  else if (input.topHolderPercent > 30) score -= 2;
  else if (input.topHolderPercent > 20) score -= 1;

  // Top 10 holders
  if (input.top10HoldersPercent > 80) score -= 2;
  else if (input.top10HoldersPercent > 60) score -= 1;

  // Low holder count
  if (input.holderCount < 10) score -= 2;
  else if (input.holderCount < 50) score -= 1;

  // Cluster patterns (coordinated wallets)
  if (input.hasClusterPatterns) score -= 2;

  return Math.max(0, score);
}

/**
 * Score deployer provenance (0-5)
 */
function scoreDeployerProvenance(input: ScoreInput): number {
  // Blacklisted deployer = 0
  if (input.isDeployerBlacklisted) return 0;

  let score = 3; // Start at middle

  // Rug history
  if (input.deployerRugCount > 2) score -= 3;
  else if (input.deployerRugCount > 0) score -= 2;

  // Success history
  if (input.deployerSuccessCount >= 5) score += 2;
  else if (input.deployerSuccessCount >= 2) score += 1;

  // Deployer age (established wallets are better)
  if (input.deployerAge && input.deployerAge > 180) score += 1;

  return Math.max(0, Math.min(5, score));
}

/**
 * Score post-launch controls (0-5)
 */
function scorePostLaunchControls(input: ScoreInput): number {
  let score = 5;

  // Ownership retained = risk
  if (input.hasOwnership) score -= 1;

  // Pausable transfers = major risk
  if (input.canPauseTransfers) score -= 2;

  // Blacklist function = risk
  if (input.hasBlacklist) score -= 2;

  // Freeze authority (Solana) = major risk
  if (input.hasFreezeAuthority) score -= 2;

  return Math.max(0, score);
}

/**
 * Score execution risk (0-5)
 */
function scoreExecutionRisk(input: ScoreInput): number {
  let score = 5;

  // High slippage
  if (input.estimatedSlippage > 1500) score -= 2;      // >15%
  else if (input.estimatedSlippage > 1000) score -= 1; // >10%

  // Gas cost relative to position
  if (input.positionSizeUSD > 0) {
    const gasPct = (input.estimatedGasUSD / input.positionSizeUSD) * 100;

    if (gasPct > 10) score -= 2;      // >10% in gas
    else if (gasPct > 5) score -= 1;  // >5% in gas
  }

  return Math.max(0, score);
}

/**
 * Get trading decision from score
 */
export function getScoreDecision(score: number): ScoreDecision {
  if (score <= SCORE_SKIP) return 'SKIP';
  if (score <= SCORE_TINY) return 'TINY';
  if (score <= SCORE_TRADABLE) return 'TRADABLE';
  return 'BEST';
}

/**
 * Generate human-readable reasons for the score
 */
function getScoreReasons(categories: CategoryScores, input: ScoreInput): string[] {
  const reasons: string[] = [];

  // Sellability issues
  if (categories.sellability < 3) {
    if (input.isHoneypot) reasons.push('Honeypot detected');
    else if (!input.canSell) reasons.push('Cannot sell');
    else if (input.sellTax > 500) reasons.push(`High sell tax: ${input.sellTax / 100}%`);
  }

  // Supply issues
  if (categories.supplyIntegrity < 3) {
    if (input.hasMintAuthority) reasons.push('Mint authority active');
  }

  // Liquidity issues
  if (categories.liquidityControl < 3) {
    if (!input.isLpLocked) reasons.push('LP not locked');
    if (input.liquidity < BigInt(1e18)) reasons.push('Low liquidity');
  }

  // Distribution issues
  if (categories.distribution < 3) {
    if (input.topHolderPercent > 30) reasons.push(`Top holder: ${input.topHolderPercent}%`);
    if (input.holderCount < 50) reasons.push(`Only ${input.holderCount} holders`);
  }

  // Deployer issues
  if (categories.deployerProvenance < 3) {
    if (input.isDeployerBlacklisted) reasons.push('Deployer blacklisted');
    else if (input.deployerRugCount > 0) reasons.push(`Deployer has ${input.deployerRugCount} rugs`);
  }

  // Control issues
  if (categories.postLaunchControls < 3) {
    if (input.canPauseTransfers) reasons.push('Can pause transfers');
    if (input.hasBlacklist) reasons.push('Has blacklist function');
  }

  // Execution issues
  if (categories.executionRisk < 3) {
    if (input.estimatedSlippage > 1000) reasons.push(`High slippage: ${input.estimatedSlippage / 100}%`);
  }

  return reasons;
}

/**
 * Legacy score calculation for backward compatibility
 * Converts old 0-100 opportunities to new 0-35 system
 */
export async function calculateScore(
  opportunity: Opportunity,
  config: ChainConfig
): Promise<number> {
  // Create minimal input from opportunity
  const input: ScoreInput = {
    canSell: true,
    buyTax: opportunity.buy_tax,
    sellTax: opportunity.sell_tax,
    isHoneypot: false,
    hasMintAuthority: false,
    totalSupply: 0n,
    liquidity: opportunity.liquidity,
    isLpLocked: false,
    topHolderPercent: 20,
    top10HoldersPercent: 50,
    holderCount: 100,
    deployerRugCount: 0,
    deployerSuccessCount: 0,
    isDeployerBlacklisted: false,
    hasOwnership: true,
    canPauseTransfers: false,
    hasBlacklist: false,
    estimatedSlippage: 500,
    estimatedGasUSD: 1,
    positionSizeUSD: 100,
  };

  const result = calculateFullScore(input);
  return result.total;
}

/**
 * Calculate position size based on score decision
 * SECURITY: P1-6 - Uses pure BigInt arithmetic to prevent precision loss
 */
export function calculatePositionSize(
  userAllocation: bigint,
  liquidity: bigint,
  config: ChainConfig,
  decision?: ScoreDecision
): bigint {
  // Decision-based multiplier in basis points (10000 = 100%)
  // SECURITY: P1-6 - Use basis points for precision-safe BigInt math
  const decisionMultiplierBps: Record<ScoreDecision, bigint> = {
    SKIP: 0n,
    TINY: 2500n,     // 25% = 2500 bps
    TRADABLE: 7500n, // 75% = 7500 bps
    BEST: 10000n,    // 100% = 10000 bps
  };

  const multiplierBps = decision ? decisionMultiplierBps[decision] : 10000n;
  if (multiplierBps === 0n) return 0n;

  // Don't invest more than maxPoolPercent of liquidity
  const maxFromPool = (liquidity * BigInt(config.maxPoolPercent)) / 100n;

  // Don't invest more than user's max position size
  const maxFromUser = userAllocation > config.maxPositionSize
    ? config.maxPositionSize
    : userAllocation;

  // Take the smaller
  const baseSize = maxFromPool < maxFromUser ? maxFromPool : maxFromUser;

  // Apply multiplier using basis points (no precision loss)
  // SECURITY: P1-6 - Pure BigInt arithmetic: (size * bps) / 10000
  const positionSize = (baseSize * multiplierBps) / 10000n;

  // Ensure minimum position size
  if (positionSize < config.minPositionSize) {
    return 0n;
  }

  return positionSize;
}

/**
 * Format score result for display
 */
export function formatScoreResult(result: ScoreResult): string {
  const categoryLines = [
    `Sellability: ${result.categories.sellability}/5`,
    `Supply: ${result.categories.supplyIntegrity}/5`,
    `Liquidity: ${result.categories.liquidityControl}/5`,
    `Distribution: ${result.categories.distribution}/5`,
    `Deployer: ${result.categories.deployerProvenance}/5`,
    `Controls: ${result.categories.postLaunchControls}/5`,
    `Execution: ${result.categories.executionRisk}/5`,
  ];

  const decisionEmoji: Record<ScoreDecision, string> = {
    SKIP: '🚫',
    TINY: '🔸',
    TRADABLE: '✅',
    BEST: '🌟',
  };

  return [
    `Score: ${result.total}/35 ${decisionEmoji[result.decision]} ${result.decision}`,
    '',
    ...categoryLines,
    '',
    result.reasons.length > 0 ? `Issues: ${result.reasons.join(', ')}` : 'No issues found',
  ].join('\n');
}
