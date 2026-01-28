// =============================================================================
// RAPTOR Phase 1: Bags Source Tests
// Integration tests for BagsSource and BagsDeduplicator
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BagsSource,
  BagsDeduplicator,
  type BagsSourceConfig,
  type BagsSignal,
} from '../index.js';

// Valid test addresses
const VALID_MINT_1 = 'So11111111111111111111111111111111111111112';
const VALID_MINT_2 = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Helper to create a BagsSource for testing (disabled, no Telegram connection)
function createTestSource(overrides: Partial<BagsSourceConfig> = {}): BagsSource {
  return new BagsSource({
    botToken: 'test-token',
    channelId: '@test_channel',
    enabled: false, // Don't actually connect
    dedupeTtlMs: 1000, // Short TTL for testing
    ...overrides,
  });
}

describe('BagsDeduplicator', () => {
  let dedup: BagsDeduplicator;

  beforeEach(() => {
    dedup = new BagsDeduplicator({ ttlMs: 100, maxEntries: 5 });
  });

  describe('isDuplicate', () => {
    it('should return false for new mints', () => {
      expect(dedup.isDuplicate(VALID_MINT_1)).toBe(false);
    });

    it('should return true for recently seen mints', () => {
      dedup.mark(VALID_MINT_1);
      expect(dedup.isDuplicate(VALID_MINT_1)).toBe(true);
    });

    it('should return false after TTL expires', async () => {
      dedup.mark(VALID_MINT_1);
      expect(dedup.isDuplicate(VALID_MINT_1)).toBe(true);

      // Wait for TTL to expire (100ms + buffer)
      await new Promise((r) => setTimeout(r, 150));

      expect(dedup.isDuplicate(VALID_MINT_1)).toBe(false);
    });
  });

  describe('checkAndMark', () => {
    it('should return false and mark for new mints', () => {
      const result = dedup.checkAndMark(VALID_MINT_1);
      expect(result).toBe(false);
      expect(dedup.isDuplicate(VALID_MINT_1)).toBe(true);
    });

    it('should return true for already marked mints', () => {
      dedup.checkAndMark(VALID_MINT_1);
      const result = dedup.checkAndMark(VALID_MINT_1);
      expect(result).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      dedup.mark(VALID_MINT_1);
      dedup.mark(VALID_MINT_2);
      expect(dedup.size).toBe(2);

      dedup.clear();
      expect(dedup.size).toBe(0);
      expect(dedup.isDuplicate(VALID_MINT_1)).toBe(false);
    });
  });

  describe('maxEntries', () => {
    it('should evict oldest entries when limit exceeded', () => {
      // Mark 6 entries (limit is 5)
      for (let i = 1; i <= 6; i++) {
        dedup.mark(`Mint${i}${'1'.repeat(38)}`);
      }

      // Should have evicted some entries
      expect(dedup.size).toBeLessThanOrEqual(5);
    });
  });
});

describe('BagsSource', () => {
  describe('isEnabled', () => {
    it('should return false when disabled', () => {
      const source = createTestSource({ enabled: false });
      expect(source.isEnabled()).toBe(false);
    });

    it('should return true when enabled', () => {
      const source = createTestSource({ enabled: true });
      expect(source.isEnabled()).toBe(true);
    });
  });

  describe('processMessage', () => {
    it('should parse valid signal and call handler', async () => {
      const source = createTestSource();
      const signals: BagsSignal[] = [];

      source.onSignal(async (signal) => {
        signals.push(signal);
      });

      const text = `New launch!
Mint: ${VALID_MINT_1}
$TEST token`;

      const result = await source.processMessage(text);

      expect(result.ok).toBe(true);
      expect(signals).toHaveLength(1);
      expect(signals[0].mint).toBe(VALID_MINT_1);
      expect(signals[0].symbol).toBe('TEST');
    });

    it('should return parse failure for invalid message', async () => {
      const source = createTestSource();
      const signals: BagsSignal[] = [];

      source.onSignal(async (signal) => {
        signals.push(signal);
      });

      const result = await source.processMessage('Invalid message');

      expect(result.ok).toBe(false);
      expect(signals).toHaveLength(0);
    });

    it('should deduplicate repeated signals', async () => {
      const source = createTestSource();
      const signals: BagsSignal[] = [];

      source.onSignal(async (signal) => {
        signals.push(signal);
      });

      const text = `Mint: ${VALID_MINT_1}`;

      // Process same signal twice
      await source.processMessage(text);
      await source.processMessage(text);

      // Should only emit once
      expect(signals).toHaveLength(1);
    });

    it('should allow different mints', async () => {
      const source = createTestSource();
      const signals: BagsSignal[] = [];

      source.onSignal(async (signal) => {
        signals.push(signal);
      });

      await source.processMessage(`Mint: ${VALID_MINT_1}`);
      await source.processMessage(`Mint: ${VALID_MINT_2}`);

      expect(signals).toHaveLength(2);
      expect(signals[0].mint).toBe(VALID_MINT_1);
      expect(signals[1].mint).toBe(VALID_MINT_2);
    });

    it('should use provided timestamp', async () => {
      const source = createTestSource();
      const signals: BagsSignal[] = [];

      source.onSignal(async (signal) => {
        signals.push(signal);
      });

      const timestamp = 1700000000000;
      await source.processMessage(`Mint: ${VALID_MINT_1}`, timestamp);

      expect(signals[0].timestamp).toBe(timestamp);
    });
  });

  describe('handlers', () => {
    it('should support multiple handlers', async () => {
      const source = createTestSource();
      const results1: string[] = [];
      const results2: string[] = [];

      source.onSignal(async (signal) => {
        results1.push(signal.mint);
      });

      source.onSignal(async (signal) => {
        results2.push(signal.mint);
      });

      await source.processMessage(`Mint: ${VALID_MINT_1}`);

      expect(results1).toEqual([VALID_MINT_1]);
      expect(results2).toEqual([VALID_MINT_1]);
    });

    it('should continue processing if handler throws', async () => {
      const source = createTestSource();
      const signals: BagsSignal[] = [];

      // First handler throws
      source.onSignal(async () => {
        throw new Error('Handler error');
      });

      // Second handler should still run
      source.onSignal(async (signal) => {
        signals.push(signal);
      });

      // Should not throw
      await expect(source.processMessage(`Mint: ${VALID_MINT_1}`)).resolves.toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should track message processing stats', async () => {
      const source = createTestSource();

      source.onSignal(async () => {});

      // Process valid signal
      await source.processMessage(`Mint: ${VALID_MINT_1}`);

      // Process invalid message
      await source.processMessage('Invalid');

      // Process duplicate
      await source.processMessage(`Mint: ${VALID_MINT_1}`);

      const stats = source.getStats();
      expect(stats.parseSuccesses).toBe(2); // First valid + duplicate attempt parses
      expect(stats.parseFailures).toBe(1);
      expect(stats.duplicatesFiltered).toBe(1);
      expect(stats.signalsEmitted).toBe(1); // Only first emit counts
    });
  });
});
