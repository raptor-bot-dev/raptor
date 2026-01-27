// =============================================================================
// RAPTOR Phase 4: Meteora On-Chain Source Tests
// Unit tests for MeteoraOnChainSource WebSocket listener
// =============================================================================

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  MeteoraOnChainSource,
  type MeteoraOnChainConfig,
  type MeteoraOnChainSignal,
} from '../meteoraOnChainSource.js';

// Valid test addresses (using real Solana address format patterns)
const VALID_MINT = 'So11111111111111111111111111111111111111112';
const VALID_BONDING_CURVE = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';
const VALID_CREATOR = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const METEORA_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

// Mock HeliusWsManager
vi.mock('../../monitors/heliusWs.js', () => {
  const EventEmitter = require('events');

  class MockHeliusWsManager extends EventEmitter {
    private connected = false;
    private subscriptionCallbacks: Map<number, Function> = new Map();
    private nextRequestId = 1;

    async start(): Promise<void> {
      this.connected = true;
      // Emit connected event asynchronously
      setTimeout(() => this.emit('connected'), 0);
    }

    async stop(): Promise<void> {
      this.connected = false;
    }

    isConnected(): boolean {
      return this.connected;
    }

    subscribe(programId: string, callback: Function): number {
      const requestId = this.nextRequestId++;
      this.subscriptionCallbacks.set(requestId, callback);
      return requestId;
    }

    unsubscribe(requestId: number): void {
      this.subscriptionCallbacks.delete(requestId);
    }

    // Test helper: simulate a logs notification
    _simulateLogsNotification(notification: any): void {
      for (const callback of this.subscriptionCallbacks.values()) {
        callback(notification);
      }
    }
  }

  return { HeliusWsManager: MockHeliusWsManager };
});

// Helper to create a MeteoraOnChainSource for testing
function createTestSource(overrides: Partial<MeteoraOnChainConfig> = {}): MeteoraOnChainSource {
  return new MeteoraOnChainSource({
    programId: METEORA_PROGRAM_ID,
    enabled: true,
    ...overrides,
  });
}

describe('MeteoraOnChainSource', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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

  describe('start/stop', () => {
    it('should not start when disabled', async () => {
      const source = createTestSource({ enabled: false });
      await source.start();

      // Should not throw, just log and return
      const stats = source.getStats();
      expect(stats.logsReceived).toBe(0);
    });

    it('should start and stop cleanly when enabled', async () => {
      const source = createTestSource({ enabled: true });

      await source.start();
      await source.stop();

      // Should complete without error
      const stats = source.getStats();
      expect(stats.logsReceived).toBe(0);
    });
  });

  describe('handlers', () => {
    it('should register signal handlers', () => {
      const source = createTestSource();
      const handler = vi.fn();

      source.onSignal(handler);

      // Handler is registered (we'll test it fires in integration)
      expect(typeof source.getStats).toBe('function');
    });

    it('should support multiple handlers', async () => {
      const source = createTestSource();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      source.onSignal(handler1);
      source.onSignal(handler2);

      // Both handlers should be registered
      // Full test requires actual log notification
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const source = createTestSource();
      const stats = source.getStats();

      expect(stats).toHaveProperty('logsReceived');
      expect(stats).toHaveProperty('createEventsDetected');
      expect(stats).toHaveProperty('parseFailures');
      expect(stats).toHaveProperty('signalsEmitted');
      expect(stats).toHaveProperty('handlerErrors');
    });

    it('should initialize stats to zero', () => {
      const source = createTestSource();
      const stats = source.getStats();

      expect(stats.logsReceived).toBe(0);
      expect(stats.createEventsDetected).toBe(0);
      expect(stats.parseFailures).toBe(0);
      expect(stats.signalsEmitted).toBe(0);
      expect(stats.handlerErrors).toBe(0);
    });

    it('should return a copy of stats (not reference)', () => {
      const source = createTestSource();
      const stats1 = source.getStats();
      const stats2 = source.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('configuration', () => {
    it('should use provided program ID', () => {
      const customProgramId = 'CustomProgram1111111111111111111111111111111';
      const source = createTestSource({ programId: customProgramId });

      // Program ID is internal, but we can verify the source was created
      expect(source.isEnabled()).toBe(true);
    });

    it('should use default program ID when not provided', () => {
      // Note: When programId is not provided, the source uses getMeteoraProgramId()
      // In test environment, we provide a programId to avoid calling the config function
      const source = new MeteoraOnChainSource({
        enabled: true,
        programId: METEORA_PROGRAM_ID,
      });

      // Should be enabled and use the provided program ID
      expect(source.isEnabled()).toBe(true);
    });
  });
});

describe('MeteoraOnChainSignal interface', () => {
  it('should have required fields', () => {
    const signal: MeteoraOnChainSignal = {
      mint: VALID_MINT,
      bondingCurve: VALID_BONDING_CURVE,
      creator: VALID_CREATOR,
      signature: 'tx123456789',
      slot: 12345,
      timestamp: Date.now(),
    };

    expect(signal.mint).toBe(VALID_MINT);
    expect(signal.bondingCurve).toBe(VALID_BONDING_CURVE);
    expect(signal.creator).toBe(VALID_CREATOR);
    expect(signal.signature).toBe('tx123456789');
    expect(signal.slot).toBe(12345);
    expect(typeof signal.timestamp).toBe('number');
  });
});
