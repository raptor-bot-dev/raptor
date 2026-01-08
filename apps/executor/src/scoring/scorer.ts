import type { ChainConfig, Opportunity } from '@raptor/shared';
import {
  MIN_LIQUIDITY_BNB,
  MIN_LIQUIDITY_ETH,
  MAX_BUY_TAX,
  MAX_SELL_TAX,
} from '@raptor/shared';

interface ScoreFactors {
  liquidity: number;
  tax: number;
  launchpad: number;
  timing: number;
}

export async function calculateScore(
  opportunity: Opportunity,
  config: ChainConfig
): Promise<number> {
  const factors = await getScoreFactors(opportunity, config);

  // Weighted average of all factors
  const weights = {
    liquidity: 0.3,
    tax: 0.25,
    launchpad: 0.25,
    timing: 0.2,
  };

  const score =
    factors.liquidity * weights.liquidity +
    factors.tax * weights.tax +
    factors.launchpad * weights.launchpad +
    factors.timing * weights.timing;

  return Math.round(score);
}

async function getScoreFactors(
  opportunity: Opportunity,
  config: ChainConfig
): Promise<ScoreFactors> {
  // Liquidity score (0-100)
  const minLiq = config.name === 'BSC' ? MIN_LIQUIDITY_BNB : MIN_LIQUIDITY_ETH;
  const optimalLiq = minLiq * 10n; // 10x minimum is optimal
  const liqScore = opportunity.liquidity >= optimalLiq
    ? 100
    : opportunity.liquidity >= minLiq
      ? 50 + (Number(opportunity.liquidity - minLiq) / Number(optimalLiq - minLiq)) * 50
      : (Number(opportunity.liquidity) / Number(minLiq)) * 50;

  // Tax score (0-100)
  const avgTax = (opportunity.buy_tax + opportunity.sell_tax) / 2;
  const maxTax = (MAX_BUY_TAX + MAX_SELL_TAX) / 2;
  const taxScore = avgTax === 0 ? 100 : Math.max(0, 100 - (avgTax / maxTax) * 100);

  // Launchpad score (0-100)
  const launchpadScores: Record<string, number> = {
    'four.meme': 85,
    'BasePump': 80,
    'PancakeSwap': 60,
    'Uniswap V3': 65,
    'Aerodrome': 60,
  };
  const launchpadScore = launchpadScores[opportunity.launchpad] || 50;

  // Timing score (0-100) - fresher is better
  const age = Date.now() - opportunity.timestamp;
  const maxAge = 60000; // 1 minute
  const timingScore = Math.max(0, 100 - (age / maxAge) * 100);

  return {
    liquidity: liqScore,
    tax: taxScore,
    launchpad: launchpadScore,
    timing: timingScore,
  };
}

export function calculatePositionSize(
  userAllocation: bigint,
  liquidity: bigint,
  config: ChainConfig
): bigint {
  // Don't invest more than maxPoolPercent of liquidity
  const maxFromPool = (liquidity * BigInt(config.maxPoolPercent)) / 100n;

  // Don't invest more than user's max position size
  const maxFromUser = userAllocation > config.maxPositionSize
    ? config.maxPositionSize
    : userAllocation;

  // Take the smaller of the two
  let positionSize = maxFromPool < maxFromUser ? maxFromPool : maxFromUser;

  // Ensure minimum position size
  if (positionSize < config.minPositionSize) {
    return 0n; // Skip if below minimum
  }

  return positionSize;
}

export function calculateRiskAdjustedSize(
  baseSize: bigint,
  score: number,
  volatility: number = 0
): bigint {
  // Reduce size for lower scores
  const scoreMultiplier = score >= 80 ? 1.0 : score >= 60 ? 0.75 : 0.5;

  // Reduce size for higher volatility
  const volMultiplier = volatility > 50 ? 0.5 : volatility > 25 ? 0.75 : 1.0;

  const adjustedSize = BigInt(
    Math.floor(Number(baseSize) * scoreMultiplier * volMultiplier)
  );

  return adjustedSize;
}
