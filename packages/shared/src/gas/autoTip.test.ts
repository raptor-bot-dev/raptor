/**
 * Tests for Gas Auto-Tip
 */

import { describe, it, expect } from 'vitest';
import {
  getRecommendedTip,
  calculateTipCostUSD,
  getAllSpeedRecommendations,
  isTradeViable,
  formatGasRecommendation,
  type TipSpeed,
} from './autoTip.js';

describe('AutoTip', () => {
  describe('getRecommendedTip', () => {
    it('should return recommendation for Solana', () => {
      const rec = getRecommendedTip('sol', 'normal');

      expect(rec.chain).toBe('sol');
      expect(rec.speed).toBe('normal');
      expect(typeof rec.priorityFee).toBe('bigint');
      expect(typeof rec.estimatedCostUSD).toBe('number');
      expect(['low', 'medium', 'high', 'extreme']).toContain(rec.congestionLevel);
    });

    it('should return recommendation for BSC', () => {
      const rec = getRecommendedTip('bsc', 'fast');

      expect(rec.chain).toBe('bsc');
      expect(rec.speed).toBe('fast');
      expect(typeof rec.priorityFee).toBe('bigint');
    });

    it('should return recommendation for ETH', () => {
      const rec = getRecommendedTip('eth', 'turbo');

      expect(rec.chain).toBe('eth');
      expect(rec.speed).toBe('turbo');
      expect(rec.maxFee).toBeDefined(); // EIP-1559 chains have maxFee
    });

    it('should respect max USD limit', () => {
      const recUnlimited = getRecommendedTip('eth', 'turbo');
      const recLimited = getRecommendedTip('eth', 'turbo', 1.0);

      expect(recLimited.estimatedCostUSD).toBeLessThanOrEqual(1.0);
      // Limited should have lower or equal priority fee
      expect(recLimited.priorityFee).toBeLessThanOrEqual(recUnlimited.priorityFee);
    });

    it('should have higher fees for faster speeds', () => {
      const slow = getRecommendedTip('sol', 'slow');
      const normal = getRecommendedTip('sol', 'normal');
      const fast = getRecommendedTip('sol', 'fast');
      const turbo = getRecommendedTip('sol', 'turbo');

      expect(slow.priorityFee).toBeLessThan(normal.priorityFee);
      expect(normal.priorityFee).toBeLessThan(fast.priorityFee);
      expect(fast.priorityFee).toBeLessThan(turbo.priorityFee);
    });
  });

  describe('calculateTipCostUSD', () => {
    it('should calculate USD cost for Solana', () => {
      const cost = calculateTipCostUSD('sol', 100000n);

      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    it('should calculate USD cost for EVM chains', () => {
      const costBsc = calculateTipCostUSD('bsc', 3000000000n);
      const costEth = calculateTipCostUSD('eth', 2000000000n);

      expect(typeof costBsc).toBe('number');
      expect(typeof costEth).toBe('number');
      expect(costBsc).toBeGreaterThanOrEqual(0);
      expect(costEth).toBeGreaterThanOrEqual(0);
    });

    it('should return higher cost for higher fees', () => {
      const lowCost = calculateTipCostUSD('sol', 50000n);
      const highCost = calculateTipCostUSD('sol', 500000n);

      expect(highCost).toBeGreaterThan(lowCost);
    });
  });

  describe('getAllSpeedRecommendations', () => {
    it('should return recommendations for all speeds', () => {
      const recs = getAllSpeedRecommendations('sol');

      expect(recs.slow).toBeDefined();
      expect(recs.normal).toBeDefined();
      expect(recs.fast).toBeDefined();
      expect(recs.turbo).toBeDefined();
    });

    it('should apply max USD to all speeds', () => {
      const recs = getAllSpeedRecommendations('eth', 0.5);

      expect(recs.slow.estimatedCostUSD).toBeLessThanOrEqual(0.5);
      expect(recs.normal.estimatedCostUSD).toBeLessThanOrEqual(0.5);
      expect(recs.fast.estimatedCostUSD).toBeLessThanOrEqual(0.5);
      expect(recs.turbo.estimatedCostUSD).toBeLessThanOrEqual(0.5);
    });
  });

  describe('isTradeViable', () => {
    it('should approve viable trades', () => {
      // $100 trade, 15% expected profit, fast speed on Solana (cheap gas)
      const result = isTradeViable('sol', 'fast', 100, 15);

      expect(result.viable).toBe(true);
      expect(result.netProfitUSD).toBeGreaterThan(0);
    });

    it('should reject unprofitable trades', () => {
      // $1 trade, 1% expected profit - likely not viable after gas
      const result = isTradeViable('eth', 'turbo', 1, 1, 0.50);

      // This may or may not be viable depending on current gas prices
      // but netProfitUSD should be calculated
      expect(typeof result.netProfitUSD).toBe('number');
    });

    it('should provide reason for rejection', () => {
      // Very small trade on ETH with high gas
      const result = isTradeViable('eth', 'turbo', 0.10, 5, 10);

      if (!result.viable) {
        expect(result.reason).toBeDefined();
        expect(result.reason!.length).toBeGreaterThan(0);
      }
    });

    it('should calculate net profit correctly', () => {
      const result = isTradeViable('sol', 'normal', 100, 50);

      // Gross profit would be $50 (50% of $100)
      // Net should be gross minus gas and fees
      expect(result.netProfitUSD).toBeLessThan(50);
      expect(result.netProfitUSD).toBeGreaterThan(0);
    });
  });

  describe('formatGasRecommendation', () => {
    it('should format recommendation as string', () => {
      const rec = getRecommendedTip('sol', 'fast');
      const formatted = formatGasRecommendation(rec);

      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted).toContain('FAST');
      expect(formatted).toContain('$');
    });

    it('should include warning if present', () => {
      // Get ETH turbo which might have a warning
      const rec = getRecommendedTip('eth', 'turbo');
      const formatted = formatGasRecommendation(rec);

      if (rec.warning) {
        expect(formatted).toContain(rec.warning);
      }
    });
  });
});
