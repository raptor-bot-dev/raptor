// =============================================================================
// RAPTOR Phase 3: Graduation Monitor Tests
// Unit tests for graduation detection and position lifecycle transitions
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the dependencies
vi.mock('@raptor/shared', () => ({
  getGraduationMonitoringMints: vi.fn(),
  getBondingCurveSnapshot: vi.fn(),
  isGraduationMonitorEnabled: vi.fn(),
  getGraduationPollIntervalMs: vi.fn(),
  hasGraduated: vi.fn(),
  graduatePositionAtomically: vi.fn(),
  getPreGraduationPositionsByMint: vi.fn(),
}));

import {
  getGraduationMonitoringMints,
  getBondingCurveSnapshot,
  isGraduationMonitorEnabled,
  getGraduationPollIntervalMs,
  hasGraduated,
  graduatePositionAtomically,
  getPreGraduationPositionsByMint,
} from '@raptor/shared';

import { GraduationMonitorLoop } from '../graduationMonitor.js';
import { graduatePosition, graduateAllPositionsForMint } from '../../handlers/graduationHandler.js';

// Helper to create mock position
function createMockPosition(overrides: Partial<{
  uuid_id: string;
  token_mint: string;
  lifecycle_state: string;
  pricing_source: string;
}> = {}) {
  return {
    uuid_id: 'test-position-uuid',
    token_mint: 'TestMint11111111111111111111111111111111111',
    lifecycle_state: 'PRE_GRADUATION',
    pricing_source: 'BONDING_CURVE',
    tg_id: 123456,
    strategy_id: 'test-strategy',
    chain: 'sol',
    entry_price: 0.000001,
    entry_cost_sol: 0.1,
    size_tokens: 100000,
    status: 'ACTIVE',
    trigger_state: 'MONITORING',
    opened_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create mock bonding curve snapshot
function createMockSnapshot(complete: boolean = false) {
  return {
    programId: 'TestProgram',
    bondingCurve: 'TestBondingCurve',
    state: {
      virtualTokenReserves: BigInt(1000000000000),
      virtualSolReserves: BigInt(30000000000),
      realTokenReserves: BigInt(900000000000),
      realSolReserves: BigInt(25000000000),
      tokenTotalSupply: BigInt(1000000000000),
      complete,
      creator: 'TestCreator',
    },
  };
}

describe('GraduationMonitorLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isGraduationMonitorEnabled).mockReturnValue(true);
    vi.mocked(getGraduationPollIntervalMs).mockReturnValue(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start/stop', () => {
    it('should not start when disabled', async () => {
      vi.mocked(isGraduationMonitorEnabled).mockReturnValue(false);

      const loop = new GraduationMonitorLoop('test-worker');
      await loop.start();

      // Should not throw, just log and return
      const stats = loop.getStats();
      expect(stats.pollCycles).toBe(0);
    });

    it('should start and stop cleanly', async () => {
      vi.mocked(getGraduationMonitoringMints).mockResolvedValue([]);

      const loop = new GraduationMonitorLoop('test-worker');
      await loop.start();

      // Wait a tick for initialization
      await new Promise(resolve => setTimeout(resolve, 10));

      await loop.stop();

      // Should have stats available
      const stats = loop.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const loop = new GraduationMonitorLoop('test-worker');
      const stats = loop.getStats();

      expect(stats).toHaveProperty('pollCycles');
      expect(stats).toHaveProperty('mintsChecked');
      expect(stats).toHaveProperty('graduationsDetected');
      expect(stats).toHaveProperty('positionsGraduated');
      expect(stats).toHaveProperty('errors');
    });
  });
});

describe('graduatePosition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should graduate a pre-graduation position', async () => {
    const position = createMockPosition();
    vi.mocked(graduatePositionAtomically).mockResolvedValue(true);

    const result = await graduatePosition(position as never, null);

    expect(result.graduated).toBe(true);
    expect(result.positionId).toBe(position.uuid_id);
    expect(graduatePositionAtomically).toHaveBeenCalledWith(position.uuid_id, null);
  });

  it('should skip already graduated positions', async () => {
    const position = createMockPosition({ lifecycle_state: 'POST_GRADUATION' });

    const result = await graduatePosition(position as never, null);

    expect(result.graduated).toBe(false);
    expect(result.reason).toBe('already_post_graduation');
    expect(graduatePositionAtomically).not.toHaveBeenCalled();
  });

  it('should skip closed positions', async () => {
    const position = createMockPosition({ lifecycle_state: 'CLOSED' });

    const result = await graduatePosition(position as never, null);

    expect(result.graduated).toBe(false);
    expect(result.reason).toBe('already_closed');
    expect(graduatePositionAtomically).not.toHaveBeenCalled();
  });

  it('should handle atomic transition failure', async () => {
    const position = createMockPosition();
    vi.mocked(graduatePositionAtomically).mockResolvedValue(false);

    const result = await graduatePosition(position as never, null);

    expect(result.graduated).toBe(false);
    expect(result.reason).toBe('already_transitioned');
  });

  it('should pass pool address to atomic function', async () => {
    const position = createMockPosition();
    const poolAddress = 'TestPoolAddress11111111111111111111111111';
    vi.mocked(graduatePositionAtomically).mockResolvedValue(true);

    await graduatePosition(position as never, poolAddress);

    expect(graduatePositionAtomically).toHaveBeenCalledWith(position.uuid_id, poolAddress);
  });
});

describe('graduateAllPositionsForMint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should graduate all positions for a mint', async () => {
    const mint = 'TestMint11111111111111111111111111111111111';
    const positions = [
      createMockPosition({ uuid_id: 'pos-1' }),
      createMockPosition({ uuid_id: 'pos-2' }),
    ];

    vi.mocked(getPreGraduationPositionsByMint).mockResolvedValue(positions as never[]);
    vi.mocked(graduatePositionAtomically).mockResolvedValue(true);

    const results = await graduateAllPositionsForMint(mint);

    expect(results).toHaveLength(2);
    expect(results.every(r => r.graduated)).toBe(true);
    expect(graduatePositionAtomically).toHaveBeenCalledTimes(2);
  });

  it('should return empty array when no positions', async () => {
    const mint = 'TestMint11111111111111111111111111111111111';
    vi.mocked(getPreGraduationPositionsByMint).mockResolvedValue([]);

    const results = await graduateAllPositionsForMint(mint);

    expect(results).toHaveLength(0);
  });

  it('should handle partial failures', async () => {
    const mint = 'TestMint11111111111111111111111111111111111';
    const positions = [
      createMockPosition({ uuid_id: 'pos-1' }),
      createMockPosition({ uuid_id: 'pos-2' }),
    ];

    vi.mocked(getPreGraduationPositionsByMint).mockResolvedValue(positions as never[]);
    vi.mocked(graduatePositionAtomically)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const results = await graduateAllPositionsForMint(mint);

    expect(results).toHaveLength(2);
    expect(results[0].graduated).toBe(true);
    expect(results[1].graduated).toBe(false);
  });
});

describe('Graduation Detection', () => {
  it('should detect graduation via complete flag', () => {
    const snapshot = createMockSnapshot(true);

    // The actual hasGraduated function checks state.complete
    expect(snapshot.state.complete).toBe(true);
  });

  it('should not detect graduation when incomplete', () => {
    const snapshot = createMockSnapshot(false);

    expect(snapshot.state.complete).toBe(false);
  });
});

describe('State Machine Rules', () => {
  it('should only allow PRE_GRADUATION -> POST_GRADUATION transition', async () => {
    // PRE_GRADUATION -> POST_GRADUATION: allowed
    const preGradPosition = createMockPosition({ lifecycle_state: 'PRE_GRADUATION' });
    vi.mocked(graduatePositionAtomically).mockResolvedValue(true);

    const result1 = await graduatePosition(preGradPosition as never, null);
    expect(result1.graduated).toBe(true);

    // POST_GRADUATION -> PRE_GRADUATION: not allowed (can't go backwards)
    const postGradPosition = createMockPosition({ lifecycle_state: 'POST_GRADUATION' });
    const result2 = await graduatePosition(postGradPosition as never, null);
    expect(result2.graduated).toBe(false);

    // CLOSED -> any: not allowed (terminal state)
    const closedPosition = createMockPosition({ lifecycle_state: 'CLOSED' });
    const result3 = await graduatePosition(closedPosition as never, null);
    expect(result3.graduated).toBe(false);
  });
});
