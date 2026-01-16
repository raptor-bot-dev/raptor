import { describe, it, expect } from 'vitest';
import {
  BUFFER_SOL,
  LAMPORTS_PER_SOL,
  maxWithdraw,
  validateSolAmount,
  validatePercent,
  computeSolFromPercent,
  solToLamports,
  lamportsToSol,
  computeLamportsFromPercent,
  isValidSolanaAddress,
} from '../utils/withdrawMath.js';

describe('withdrawMath', () => {
  describe('constants', () => {
    it('should have correct buffer value', () => {
      expect(BUFFER_SOL).toBe(0.01);
    });

    it('should have correct lamports per SOL', () => {
      expect(LAMPORTS_PER_SOL).toBe(1_000_000_000);
    });
  });

  describe('maxWithdraw', () => {
    it('should subtract buffer from balance', () => {
      expect(maxWithdraw(1.0)).toBe(0.99);
      expect(maxWithdraw(0.5)).toBe(0.49);
      expect(maxWithdraw(10.0)).toBe(9.99);
    });

    it('should return 0.01 when balance equals 0.02', () => {
      expect(maxWithdraw(0.02)).toBe(0.01);
    });

    it('should return 0 when balance equals buffer', () => {
      expect(maxWithdraw(0.01)).toBe(0);
    });

    it('should return 0 when balance is less than buffer', () => {
      expect(maxWithdraw(0.005)).toBe(0);
      expect(maxWithdraw(0)).toBe(0);
    });

    it('should never return negative', () => {
      expect(maxWithdraw(-1)).toBe(0);
      expect(maxWithdraw(-0.5)).toBe(0);
    });
  });

  describe('validateSolAmount', () => {
    it('should accept valid amounts within max', () => {
      expect(validateSolAmount(0.5, 1.0)).toBe(true);
      expect(validateSolAmount(0.99, 1.0)).toBe(true);
      expect(validateSolAmount(0.01, 0.02)).toBe(true);
    });

    it('should reject amounts exceeding max', () => {
      expect(validateSolAmount(1.0, 1.0)).toBe(false); // max is 0.99
      expect(validateSolAmount(0.991, 1.0)).toBe(false);
      expect(validateSolAmount(5.0, 1.0)).toBe(false);
    });

    it('should reject zero amounts', () => {
      expect(validateSolAmount(0, 1.0)).toBe(false);
    });

    it('should reject negative amounts', () => {
      expect(validateSolAmount(-0.5, 1.0)).toBe(false);
      expect(validateSolAmount(-1, 1.0)).toBe(false);
    });

    it('should reject NaN', () => {
      expect(validateSolAmount(NaN, 1.0)).toBe(false);
    });

    it('should reject when balance is too low', () => {
      expect(validateSolAmount(0.01, 0.01)).toBe(false); // max is 0
      expect(validateSolAmount(0.001, 0.005)).toBe(false);
    });
  });

  describe('validatePercent', () => {
    it('should accept valid percentages 1-100', () => {
      expect(validatePercent(1)).toBe(true);
      expect(validatePercent(50)).toBe(true);
      expect(validatePercent(100)).toBe(true);
      expect(validatePercent(99.5)).toBe(true);
    });

    it('should reject zero', () => {
      expect(validatePercent(0)).toBe(false);
    });

    it('should reject negative values', () => {
      expect(validatePercent(-1)).toBe(false);
      expect(validatePercent(-50)).toBe(false);
    });

    it('should reject values over 100', () => {
      expect(validatePercent(101)).toBe(false);
      expect(validatePercent(150)).toBe(false);
    });

    it('should reject NaN', () => {
      expect(validatePercent(NaN)).toBe(false);
    });
  });

  describe('computeSolFromPercent', () => {
    it('should compute correct SOL from percentage', () => {
      // 1 SOL balance, 50% = 0.495 SOL (50% of 0.99 max)
      expect(computeSolFromPercent(1.0, 50)).toBe(0.495);
    });

    it('should compute 100% correctly', () => {
      // 1 SOL balance, 100% = 0.99 SOL (all of max)
      expect(computeSolFromPercent(1.0, 100)).toBe(0.99);
    });

    it('should compute 1% correctly', () => {
      // 1 SOL balance, 1% = 0.0099 SOL
      expect(computeSolFromPercent(1.0, 1)).toBeCloseTo(0.0099, 4);
    });

    it('should return 0 when balance is at or below buffer', () => {
      expect(computeSolFromPercent(0.01, 100)).toBe(0);
      expect(computeSolFromPercent(0.005, 50)).toBe(0);
    });
  });

  describe('solToLamports', () => {
    it('should convert SOL to lamports', () => {
      expect(solToLamports(1.0)).toBe(1_000_000_000);
      expect(solToLamports(0.5)).toBe(500_000_000);
      expect(solToLamports(0.000000001)).toBe(1);
    });

    it('should floor fractional lamports', () => {
      // 0.0000000015 SOL = 1.5 lamports, should floor to 1
      expect(solToLamports(0.0000000015)).toBe(1);
      expect(solToLamports(0.0000000019)).toBe(1);
    });

    it('should return 0 for zero SOL', () => {
      expect(solToLamports(0)).toBe(0);
    });
  });

  describe('lamportsToSol', () => {
    it('should convert lamports to SOL', () => {
      expect(lamportsToSol(1_000_000_000)).toBe(1.0);
      expect(lamportsToSol(500_000_000)).toBe(0.5);
      expect(lamportsToSol(1)).toBe(0.000000001);
    });

    it('should return 0 for zero lamports', () => {
      expect(lamportsToSol(0)).toBe(0);
    });
  });

  describe('computeLamportsFromPercent', () => {
    it('should compute correct lamports from percentage', () => {
      // 1 SOL balance, 50% = 0.495 SOL = 495,000,000 lamports
      expect(computeLamportsFromPercent(1.0, 50)).toBe(495_000_000);
    });

    it('should compute 100% correctly', () => {
      // 1 SOL balance, 100% = 0.99 SOL = 990,000,000 lamports
      expect(computeLamportsFromPercent(1.0, 100)).toBe(990_000_000);
    });

    it('should return 0 when balance is at or below buffer', () => {
      expect(computeLamportsFromPercent(0.01, 100)).toBe(0);
    });

    it('should floor fractional lamports', () => {
      // Small percentage of small balance may result in fractional lamports
      // 0.02 SOL balance, max withdraw = 0.01 SOL
      // 1% of max = 0.0001 SOL = 100,000 lamports
      expect(computeLamportsFromPercent(0.02, 1)).toBe(100_000);
    });
  });

  describe('isValidSolanaAddress', () => {
    it('should accept valid Solana addresses', () => {
      // Typical Solana public key (44 chars)
      expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
      expect(isValidSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
      expect(isValidSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    });

    it('should reject too short addresses', () => {
      expect(isValidSolanaAddress('1111111111111111111111111111111')).toBe(false); // 31 chars
      expect(isValidSolanaAddress('abc')).toBe(false);
      expect(isValidSolanaAddress('')).toBe(false);
    });

    it('should reject too long addresses', () => {
      expect(isValidSolanaAddress('111111111111111111111111111111111111111111111')).toBe(false); // 45 chars
    });

    it('should handle whitespace', () => {
      expect(isValidSolanaAddress('  11111111111111111111111111111111  ')).toBe(true);
    });

    it('should reject null/undefined', () => {
      expect(isValidSolanaAddress(null as unknown as string)).toBe(false);
      expect(isValidSolanaAddress(undefined as unknown as string)).toBe(false);
    });
  });
});
