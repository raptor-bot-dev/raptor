/**
 * Trading Strategies for RAPTOR v4.0
 * Solana-only build
 *
 * @deprecated v5.0 - Predefined strategies are deprecated.
 * Users now configure TP/SL directly in Hunt Settings, which updates
 * their AUTO strategy in the database. This file is kept for backward
 * compatibility only.
 *
 * Previous predefined strategies (no longer used):
 * - MICRO_SCALP - Quick scalps (15% TP, 8% SL)
 * - STANDARD - Balanced approach (50% TP, 30% SL)
 * - MOON_BAG - Keep 25% position after TP
 * - DCA_EXIT - Ladder exits
 * - TRAILING - Trailing stop loss
 *
 * New approach: Users set their own TP/SL values in Hunt Settings menu,
 * which directly updates the strategies table in the database.
 */

import type { Chain } from '../types.js';

export type TradingStrategy =
  | 'MICRO_SCALP'
  | 'STANDARD'
  | 'MOON_BAG'
  | 'DCA_EXIT'
  | 'TRAILING';

export interface StrategyConfig {
  name: TradingStrategy;
  displayName: string;
  description: string;
  takeProfitPercent: number;
  stopLossPercent: number;
  maxHoldMs: number;
  allowedChains: Chain[];

  // MOON_BAG specific
  moonBagPercent?: number;

  // DCA_EXIT specific
  exitLadder?: { percent: number; sellPercent: number }[];

  // TRAILING specific
  trailingActivationPercent?: number;
  trailingDistancePercent?: number;
}

export const STRATEGY_CONFIGS: Record<TradingStrategy, StrategyConfig> = {
  MICRO_SCALP: {
    name: 'MICRO_SCALP',
    displayName: 'Micro Scalp',
    description: 'Quick 15% scalps, 15min max.',
    takeProfitPercent: 15,
    stopLossPercent: 8,
    maxHoldMs: 15 * 60 * 1000, // 15 minutes
    allowedChains: ['sol'],
  },

  STANDARD: {
    name: 'STANDARD',
    displayName: 'Standard',
    description: 'Balanced 50% TP, 30% SL, 4h hold.',
    takeProfitPercent: 50,
    stopLossPercent: 30,
    maxHoldMs: 4 * 60 * 60 * 1000, // 4 hours
    allowedChains: ['sol'],
  },

  MOON_BAG: {
    name: 'MOON_BAG',
    displayName: 'Moon Bag',
    description: 'Sell 75% at TP, keep 25% for moonshot potential.',
    takeProfitPercent: 50,
    stopLossPercent: 30,
    maxHoldMs: 8 * 60 * 60 * 1000, // 8 hours
    allowedChains: ['sol'],
    moonBagPercent: 25,
  },

  DCA_EXIT: {
    name: 'DCA_EXIT',
    displayName: 'DCA Exit',
    description: 'Ladder out: 25% sells at 25/50/100/200% gains.',
    takeProfitPercent: 200, // Final exit
    stopLossPercent: 30,
    maxHoldMs: 8 * 60 * 60 * 1000, // 8 hours
    allowedChains: ['sol'],
    exitLadder: [
      { percent: 25, sellPercent: 25 },
      { percent: 50, sellPercent: 25 },
      { percent: 100, sellPercent: 25 },
      { percent: 200, sellPercent: 25 },
    ],
  },

  TRAILING: {
    name: 'TRAILING',
    displayName: 'Trailing Stop',
    description: 'Dynamic stop: activates at 30% gain, trails 20% below peak.',
    takeProfitPercent: 100, // Max cap
    stopLossPercent: 30,
    maxHoldMs: 8 * 60 * 60 * 1000, // 8 hours
    allowedChains: ['sol'],
    trailingActivationPercent: 30,
    trailingDistancePercent: 20,
  },
};

// Default strategy for new users
export const DEFAULT_STRATEGY: TradingStrategy = 'STANDARD';

/**
 * Get strategy configuration
 */
export function getStrategyConfig(strategy: TradingStrategy): StrategyConfig {
  return STRATEGY_CONFIGS[strategy];
}

/**
 * Check if strategy is allowed on a chain
 */
export function isStrategyAllowedOnChain(strategy: TradingStrategy, chain: Chain): boolean {
  return STRATEGY_CONFIGS[strategy].allowedChains.includes(chain);
}

/**
 * Get all strategies allowed on a chain
 */
export function getStrategiesForChain(chain: Chain): TradingStrategy[] {
  return Object.values(STRATEGY_CONFIGS)
    .filter(config => config.allowedChains.includes(chain))
    .map(config => config.name);
}

/**
 * Check if strategy uses trailing stop
 */
export function isTrailingStrategy(strategy: TradingStrategy): boolean {
  return strategy === 'TRAILING';
}

/**
 * Check if strategy uses partial exits
 */
export function hasPartialExits(strategy: TradingStrategy): boolean {
  return strategy === 'MOON_BAG' || strategy === 'DCA_EXIT';
}

/**
 * Calculate trailing stop price based on peak price
 */
export function calculateTrailingStop(
  peakPrice: number,
  strategy: TradingStrategy
): number | null {
  const config = STRATEGY_CONFIGS[strategy];
  if (!config.trailingDistancePercent) return null;

  return peakPrice * (1 - config.trailingDistancePercent / 100);
}

/**
 * Check if trailing stop should be activated
 */
export function shouldActivateTrailingStop(
  currentPnlPercent: number,
  strategy: TradingStrategy
): boolean {
  const config = STRATEGY_CONFIGS[strategy];
  if (!config.trailingActivationPercent) return false;

  return currentPnlPercent >= config.trailingActivationPercent;
}

/**
 * Get next DCA exit level
 */
export function getNextDCAExitLevel(
  currentPnlPercent: number,
  levelsHit: number,
  strategy: TradingStrategy
): { targetPercent: number; sellPercent: number } | null {
  const config = STRATEGY_CONFIGS[strategy];
  if (!config.exitLadder) return null;

  const nextLevel = config.exitLadder[levelsHit];
  if (!nextLevel) return null;

  // Only return if we haven't passed this level yet
  if (currentPnlPercent >= nextLevel.percent) {
    return { targetPercent: nextLevel.percent, sellPercent: nextLevel.sellPercent };
  }

  return null;
}

/**
 * Calculate moon bag amount
 */
export function calculateMoonBagAmount(
  totalTokens: bigint,
  strategy: TradingStrategy
): bigint | null {
  const config = STRATEGY_CONFIGS[strategy];
  if (!config.moonBagPercent) return null;

  return (totalTokens * BigInt(config.moonBagPercent)) / 100n;
}

/**
 * Format strategy for display
 */
export function formatStrategy(strategy: TradingStrategy): string {
  const config = STRATEGY_CONFIGS[strategy];
  return `${config.displayName} (TP: ${config.takeProfitPercent}%, SL: ${config.stopLossPercent}%)`;
}

/**
 * Get all strategies as options for UI
 */
export function getStrategyOptions(): { value: TradingStrategy; label: string; description: string }[] {
  return Object.values(STRATEGY_CONFIGS).map(config => ({
    value: config.name,
    label: config.displayName,
    description: config.description,
  }));
}

// Minimum net profit for micro-scalp to be viable (in USD)
export const MIN_MICRO_SCALP_PROFIT_USD = 0.50;

/**
 * Check if micro-scalp is viable given current gas costs
 */
export function isMicroScalpViable(
  positionSizeUSD: number,
  estimatedGasCostUSD: number,
  tradingFeeBps: number = 100 // 1% default
): boolean {
  // Expected profit at 15% TP
  const grossProfit = positionSizeUSD * 0.15;

  // Trading fee (applied to both entry and exit)
  const tradingFee = positionSizeUSD * (tradingFeeBps / 10000) * 2;

  // Gas cost for both transactions
  const totalGas = estimatedGasCostUSD * 2;

  // Net profit
  const netProfit = grossProfit - tradingFee - totalGas;

  return netProfit >= MIN_MICRO_SCALP_PROFIT_USD;
}
