/**
 * PnL Service - Compute realized PnL and trade stats
 * Reference: MUST_READ/PROMPT.md
 */

import { getClosedPositions } from '@raptor/shared';

export interface PnLResult {
  sol: number;
  percent: number;
}

export interface TradeStats {
  total: number;
  wins: number;
  losses: number;
}

/** Position data needed for PnL calculations */
export interface PositionForPnL {
  realized_pnl_sol: number | null;
  entry_cost_sol: number;
}

/**
 * Calculate realized PnL from an array of positions (pure function)
 * @param positions Array of closed positions
 * @returns PnL result with sol and percent
 */
export function calculateRealizedPnL(positions: PositionForPnL[]): PnLResult {
  let totalEntrySol = 0;
  let totalPnLSol = 0;

  for (const pos of positions) {
    if (pos.realized_pnl_sol !== null && pos.realized_pnl_sol !== undefined) {
      totalPnLSol += pos.realized_pnl_sol;
      totalEntrySol += pos.entry_cost_sol;
    }
  }

  const percent = totalEntrySol > 0 ? (totalPnLSol / totalEntrySol) * 100 : 0;

  return { sol: totalPnLSol, percent };
}

/**
 * Calculate trade stats from an array of positions (pure function)
 * @param positions Array of closed positions
 * @returns Trade stats with total, wins, losses
 */
export function calculateTradeStats(positions: PositionForPnL[]): TradeStats {
  const wins = positions.filter(
    (p) => p.realized_pnl_sol !== null && p.realized_pnl_sol > 0
  ).length;

  const losses = positions.filter(
    (p) => p.realized_pnl_sol !== null && p.realized_pnl_sol < 0
  ).length;

  return {
    total: positions.length,
    wins,
    losses,
  };
}

/**
 * Compute realized PnL from closed positions only
 * Never show fake values - omit if data unavailable
 */
export async function computeRealizedPnL(userId: number): Promise<PnLResult> {
  try {
    const closedPositions = await getClosedPositions(userId);
    return calculateRealizedPnL(closedPositions);
  } catch (error) {
    console.error('Error computing realized PnL:', error);
    return { sol: 0, percent: 0 };
  }
}

/**
 * Compute trade stats: total trades, wins, losses
 */
export async function computeTradeStats(userId: number): Promise<TradeStats> {
  try {
    const closedPositions = await getClosedPositions(userId);
    return calculateTradeStats(closedPositions);
  } catch (error) {
    console.error('Error computing trade stats:', error);
    return { total: 0, wins: 0, losses: 0 };
  }
}
