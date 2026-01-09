/**
 * Tests for Two-Tier Decision Logic
 */

import { describe, it, expect } from 'vitest';
import {
  decideTier,
  isTrustedSource,
  TRUSTED_SOURCES,
  type TierDecisionInput,
} from './tierDecision.js';

describe('TierDecision', () => {
  describe('isTrustedSource', () => {
    it('should recognize trusted Solana sources', () => {
      expect(isTrustedSource('pump.fun')).toBe(true);
      expect(isTrustedSource('pumpswap')).toBe(true);
      expect(isTrustedSource('moonshot')).toBe(true);
      expect(isTrustedSource('bonk.fun')).toBe(true);
      expect(isTrustedSource('believe.app')).toBe(true);
    });

    it('should recognize trusted Base sources', () => {
      expect(isTrustedSource('virtuals.fun')).toBe(true);
      expect(isTrustedSource('wow.xyz')).toBe(true);
      expect(isTrustedSource('base.pump')).toBe(true);
    });

    it('should recognize trusted BSC sources', () => {
      expect(isTrustedSource('four.meme')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isTrustedSource('PUMP.FUN')).toBe(true);
      expect(isTrustedSource('Pump.Fun')).toBe(true);
    });

    it('should reject unknown sources', () => {
      expect(isTrustedSource('unknown.dex')).toBe(false);
      expect(isTrustedSource('random')).toBe(false);
      expect(isTrustedSource('')).toBe(false);
    });
  });

  describe('decideTier', () => {
    it('should return FULL for manual snipes', () => {
      const input: TierDecisionInput = {
        source: 'pump.fun',
        isManualSnipe: true,
        tokenAgeSeconds: 10,
      };

      const result = decideTier(input);

      expect(result.tier).toBe('FULL');
      expect(result.reason.toLowerCase()).toContain('manual');
    });

    it('should return FULL for unknown sources', () => {
      const input: TierDecisionInput = {
        source: 'unknown.dex',
        isManualSnipe: false,
        tokenAgeSeconds: 10,
      };

      const result = decideTier(input);

      expect(result.tier).toBe('FULL');
      expect(result.reason.toLowerCase()).toContain('unknown');
    });

    it('should return FULL for old tokens', () => {
      const input: TierDecisionInput = {
        source: 'pump.fun',
        isManualSnipe: false,
        tokenAgeSeconds: 400, // > 5 minutes
      };

      const result = decideTier(input);

      expect(result.tier).toBe('FULL');
      expect(result.reason).toContain('old');
    });

    it('should return FAST for fresh trusted source tokens', () => {
      const input: TierDecisionInput = {
        source: 'pump.fun',
        isManualSnipe: false,
        tokenAgeSeconds: 30, // Fresh
      };

      const result = decideTier(input);

      expect(result.tier).toBe('FAST');
      expect(result.reason.toLowerCase()).toContain('trusted');
    });

    it('should return FAST for edge case at 5 minutes', () => {
      const input: TierDecisionInput = {
        source: 'moonshot',
        isManualSnipe: false,
        tokenAgeSeconds: 300, // Exactly 5 minutes
      };

      const result = decideTier(input);

      expect(result.tier).toBe('FAST');
    });

    it('should return FULL for just over 5 minutes', () => {
      const input: TierDecisionInput = {
        source: 'moonshot',
        isManualSnipe: false,
        tokenAgeSeconds: 301, // Just over 5 minutes
      };

      const result = decideTier(input);

      expect(result.tier).toBe('FULL');
    });
  });

  describe('TRUSTED_SOURCES constant', () => {
    it('should be a non-empty Set', () => {
      expect(TRUSTED_SOURCES).toBeInstanceOf(Set);
      expect(TRUSTED_SOURCES.size).toBeGreaterThan(0);
    });

    it('should contain expected sources', () => {
      expect(TRUSTED_SOURCES.has('pump.fun')).toBe(true);
      expect(TRUSTED_SOURCES.has('four.meme')).toBe(true);
      expect(TRUSTED_SOURCES.has('virtuals.fun')).toBe(true);
    });
  });
});
