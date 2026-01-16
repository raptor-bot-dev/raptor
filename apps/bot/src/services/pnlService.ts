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

/**
 * Compute realized PnL from closed positions only
 * Never show fake values - omit if data unavailable
 */
export async function computeRealizedPnL(userId: number): Promise<PnLResult> {
  try {
    const closedPositions = await getClosedPositions(userId);

    let totalEntrySol = 0;
    let totalPnLSol = 0;

    for (const pos of closedPositions) {
      if (pos.realized_pnl_sol !== null && pos.realized_pnl_sol !== undefined) {
        totalPnLSol += pos.realized_pnl_sol;
        totalEntrySol += pos.entry_cost_sol;
      }
    }

    const percent = totalEntrySol > 0 ? (totalPnLSol / totalEntrySol) * 100 : 0;

    return { sol: totalPnLSol, percent };
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

    const wins = closedPositions.filter(
      (p) => p.realized_pnl_sol !== null && p.realized_pnl_sol > 0
    ).length;

    const losses = closedPositions.filter(
      (p) => p.realized_pnl_sol !== null && p.realized_pnl_sol < 0
    ).length;

    return {
      total: closedPositions.length,
      wins,
      losses,
    };
  } catch (error) {
    console.error('Error computing trade stats:', error);
    return { total: 0, wins: 0, losses: 0 };
  }
}
