import { describe, it, expect } from 'vitest';
import {
  calculateRealizedPnL,
  calculateTradeStats,
  type PositionForPnL,
} from '../services/pnlService.js';

describe('pnlService', () => {
  describe('calculateRealizedPnL', () => {
    it('should compute PnL from closed positions with realized values', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.05 }, // +50%
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.02 }, // -20%
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBeCloseTo(0.03, 10); // 0.05 - 0.02
      expect(result.percent).toBeCloseTo(15, 10); // 0.03 / 0.2 * 100
    });

    it('should ignore positions with null realized_pnl_sol', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.05 },
        { entry_cost_sol: 0.1, realized_pnl_sol: null }, // Open position, should be ignored
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBe(0.05);
      expect(result.percent).toBe(50); // 0.05 / 0.1 * 100
    });

    it('should return zero for empty positions array', () => {
      const result = calculateRealizedPnL([]);

      expect(result.sol).toBe(0);
      expect(result.percent).toBe(0);
    });

    it('should return zero percent when all positions have null PnL', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: null },
        { entry_cost_sol: 0.2, realized_pnl_sol: null },
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBe(0);
      expect(result.percent).toBe(0);
    });

    it('should handle negative total PnL correctly', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.05 },
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.03 },
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBe(-0.08);
      expect(result.percent).toBe(-40); // -0.08 / 0.2 * 100
    });

    it('should handle mixed wins and losses', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 1.0, realized_pnl_sol: 0.5 }, // +50%
        { entry_cost_sol: 1.0, realized_pnl_sol: -0.3 }, // -30%
        { entry_cost_sol: 1.0, realized_pnl_sol: 0.2 }, // +20%
        { entry_cost_sol: 1.0, realized_pnl_sol: -0.1 }, // -10%
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBeCloseTo(0.3, 10); // 0.5 - 0.3 + 0.2 - 0.1
      expect(result.percent).toBeCloseTo(7.5, 10); // 0.3 / 4.0 * 100
    });

    it('should handle breakeven trades (zero PnL)', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0 },
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBe(0);
      expect(result.percent).toBe(0);
    });

    it('should handle very small PnL values', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.001, realized_pnl_sol: 0.0001 },
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBe(0.0001);
      expect(result.percent).toBe(10); // 0.0001 / 0.001 * 100
    });
  });

  describe('calculateTradeStats', () => {
    it('should count wins, losses, and total correctly', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.05 }, // win
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.02 }, // loss
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.03 }, // win
      ];

      const result = calculateTradeStats(positions);

      expect(result.total).toBe(3);
      expect(result.wins).toBe(2);
      expect(result.losses).toBe(1);
    });

    it('should return zeros for empty positions array', () => {
      const result = calculateTradeStats([]);

      expect(result.total).toBe(0);
      expect(result.wins).toBe(0);
      expect(result.losses).toBe(0);
    });

    it('should not count positions with null PnL as wins or losses', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.05 }, // win
        { entry_cost_sol: 0.1, realized_pnl_sol: null }, // not counted
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.02 }, // loss
      ];

      const result = calculateTradeStats(positions);

      expect(result.total).toBe(3); // total still counts all positions
      expect(result.wins).toBe(1);
      expect(result.losses).toBe(1);
    });

    it('should not count breakeven (zero PnL) as win or loss', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0 }, // breakeven
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.05 }, // win
      ];

      const result = calculateTradeStats(positions);

      expect(result.total).toBe(2);
      expect(result.wins).toBe(1);
      expect(result.losses).toBe(0);
    });

    it('should handle all wins', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.05 },
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.03 },
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.01 },
      ];

      const result = calculateTradeStats(positions);

      expect(result.total).toBe(3);
      expect(result.wins).toBe(3);
      expect(result.losses).toBe(0);
    });

    it('should handle all losses', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.05 },
        { entry_cost_sol: 0.1, realized_pnl_sol: -0.03 },
      ];

      const result = calculateTradeStats(positions);

      expect(result.total).toBe(2);
      expect(result.wins).toBe(0);
      expect(result.losses).toBe(2);
    });

    it('should handle large number of positions', () => {
      const positions: PositionForPnL[] = [];
      for (let i = 0; i < 100; i++) {
        positions.push({
          entry_cost_sol: 0.1,
          realized_pnl_sol: i % 2 === 0 ? 0.01 : -0.01,
        });
      }

      const result = calculateTradeStats(positions);

      expect(result.total).toBe(100);
      expect(result.wins).toBe(50);
      expect(result.losses).toBe(50);
    });
  });

  describe('edge cases', () => {
    it('should handle very large entry costs', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 1000, realized_pnl_sol: 100 },
      ];

      const result = calculateRealizedPnL(positions);

      expect(result.sol).toBe(100);
      expect(result.percent).toBe(10);
    });

    it('should handle floating point precision', () => {
      const positions: PositionForPnL[] = [
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.1 },
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.1 },
        { entry_cost_sol: 0.1, realized_pnl_sol: 0.1 },
      ];

      const result = calculateRealizedPnL(positions);

      // 0.3 / 0.3 * 100 = 100, but floating point might give 99.99999...
      expect(result.percent).toBeCloseTo(100, 5);
    });
  });
});
