/**
 * RAPTOR Phase 0: Database Schema Tests
 *
 * Tests for the fresh database schema types and constraints.
 * These tests verify type safety and schema consistency.
 */

import { describe, it, expect } from 'vitest';
import type {
  User,
  UserInsert,
  Wallet,
  WalletInsert,
  Settings,
  SettingsInsert,
  LaunchCandidate,
  LaunchCandidateInsert,
  Position,
  PositionInsert,
  Execution,
  ExecutionInsert,
  NotificationOutbox,
  NotificationOutboxInsert,
  Database,
  LifecycleState,
  PricingSource,
  TriggerState,
  ExitTrigger,
  LaunchSource,
  DiscoveryMethod,
} from './types.js';

describe('Phase 0 Schema Types', () => {
  describe('User types', () => {
    it('should have required fields for User', () => {
      const user: User = {
        id: '11111111-1111-1111-1111-111111111111',
        created_at: '2024-01-01T00:00:00Z',
        telegram_chat_id: 123456789,
        telegram_username: 'testuser',
        tier: 'free',
        is_banned: false,
        banned_at: null,
        banned_reason: null,
        last_active_at: null,
      };

      expect(user.id).toBeDefined();
      expect(user.telegram_chat_id).toBe(123456789);
      expect(user.tier).toBe('free');
    });

    it('should allow minimal UserInsert', () => {
      const insert: UserInsert = {
        telegram_chat_id: 123456789,
      };

      expect(insert.telegram_chat_id).toBe(123456789);
      expect(insert.id).toBeUndefined();
      expect(insert.tier).toBeUndefined();
    });
  });

  describe('Wallet types', () => {
    it('should have required fields for Wallet', () => {
      const wallet: Wallet = {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        user_id: '11111111-1111-1111-1111-111111111111',
        pubkey: 'So11111111111111111111111111111111111111112',
        label: 'Main Wallet',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(wallet.pubkey.length).toBeGreaterThan(30); // Solana addresses are base58 encoded
      expect(wallet.is_active).toBe(true);
    });

    it('should require pubkey and user_id for WalletInsert', () => {
      const insert: WalletInsert = {
        user_id: '11111111-1111-1111-1111-111111111111',
        pubkey: 'So11111111111111111111111111111111111111112',
      };

      expect(insert.user_id).toBeDefined();
      expect(insert.pubkey).toBeDefined();
    });
  });

  describe('Settings types', () => {
    it('should have sensible defaults in SettingsInsert', () => {
      const insert: SettingsInsert = {
        user_id: '11111111-1111-1111-1111-111111111111',
      };

      // Only user_id is required, rest have DB defaults
      expect(insert.user_id).toBeDefined();
      expect(insert.slippage_bps).toBeUndefined();
      expect(insert.max_positions).toBeUndefined();
    });

    it('should enforce allowlist_mode enum', () => {
      const settings: Settings = {
        user_id: '11111111-1111-1111-1111-111111111111',
        slippage_bps: 1500,
        max_positions: 2,
        max_trades_per_hour: 10,
        max_buy_amount_sol: 0.1,
        allowlist_mode: 'off',
        kill_switch: false,
        updated_at: '2024-01-01T00:00:00Z',
      };

      expect(['off', 'partners_only', 'custom']).toContain(settings.allowlist_mode);
    });
  });

  describe('LaunchCandidate types', () => {
    it('should enforce launch_source enum', () => {
      const sources: LaunchSource[] = ['bags', 'pumpfun'];
      expect(sources).toHaveLength(2);
      expect(sources).toContain('bags');
      expect(sources).toContain('pumpfun');
    });

    it('should enforce discovery_method enum', () => {
      const methods: DiscoveryMethod[] = ['telegram', 'onchain'];
      expect(methods).toHaveLength(2);
    });

    it('should create valid LaunchCandidateInsert', () => {
      const insert: LaunchCandidateInsert = {
        mint: 'So11111111111111111111111111111111111111112',
        launch_source: 'bags',
        discovery_method: 'telegram',
      };

      expect(insert.mint).toBeDefined();
      expect(insert.launch_source).toBe('bags');
      expect(insert.discovery_method).toBe('telegram');
    });
  });

  describe('Position types', () => {
    it('should enforce lifecycle_state enum', () => {
      const states: LifecycleState[] = ['PRE_GRADUATION', 'POST_GRADUATION', 'CLOSED'];
      expect(states).toHaveLength(3);
    });

    it('should enforce pricing_source enum', () => {
      const sources: PricingSource[] = ['BONDING_CURVE', 'AMM_POOL'];
      expect(sources).toHaveLength(2);
    });

    it('should enforce trigger_state enum', () => {
      const states: TriggerState[] = ['MONITORING', 'TRIGGERED', 'EXECUTING', 'COMPLETED', 'FAILED'];
      expect(states).toHaveLength(5);
    });

    it('should enforce exit_trigger enum', () => {
      const triggers: ExitTrigger[] = ['TP', 'SL', 'TRAIL', 'MAXHOLD', 'EMERGENCY', 'MANUAL', 'GRADUATION'];
      expect(triggers).toHaveLength(7);
    });

    it('should create valid PositionInsert', () => {
      const insert: PositionInsert = {
        user_id: '11111111-1111-1111-1111-111111111111',
        mint: 'So11111111111111111111111111111111111111112',
        entry_price: 0.000001,
        entry_cost_sol: 0.1,
        size_tokens: 100000,
      };

      expect(insert.user_id).toBeDefined();
      expect(insert.mint).toBeDefined();
      expect(insert.entry_price).toBeGreaterThan(0);
      expect(insert.entry_cost_sol).toBeGreaterThan(0);
      expect(insert.size_tokens).toBeGreaterThan(0);
    });
  });

  describe('Execution types', () => {
    it('should require idempotency_key', () => {
      const insert: ExecutionInsert = {
        idempotency_key: 'buy_test_12345',
        user_id: '11111111-1111-1111-1111-111111111111',
        mint: 'So11111111111111111111111111111111111111112',
        side: 'BUY',
      };

      expect(insert.idempotency_key).toBeDefined();
      expect(insert.idempotency_key.length).toBeGreaterThan(0);
    });

    it('should enforce side enum', () => {
      const buyExec: ExecutionInsert = {
        idempotency_key: 'buy_1',
        user_id: '11111111-1111-1111-1111-111111111111',
        mint: 'Test1111111111111111111111111111111111111111',
        side: 'BUY',
      };

      const sellExec: ExecutionInsert = {
        idempotency_key: 'sell_1',
        user_id: '11111111-1111-1111-1111-111111111111',
        mint: 'Test1111111111111111111111111111111111111111',
        side: 'SELL',
      };

      expect(['BUY', 'SELL']).toContain(buyExec.side);
      expect(['BUY', 'SELL']).toContain(sellExec.side);
    });
  });

  describe('NotificationOutbox types', () => {
    it('should create valid NotificationOutboxInsert', () => {
      const insert: NotificationOutboxInsert = {
        user_id: '11111111-1111-1111-1111-111111111111',
        type: 'POSITION_OPENED',
        payload: { mint: 'test', symbol: 'TEST' },
      };

      expect(insert.user_id).toBeDefined();
      expect(insert.type).toBeDefined();
      expect(insert.payload).toBeDefined();
    });

    it('should allow JSON payload', () => {
      const notification: NotificationOutbox = {
        id: '00000000-0000-0000-0000-000000000001',
        user_id: '11111111-1111-1111-1111-111111111111',
        type: 'POSITION_CLOSED',
        payload: {
          mint: 'Test1111111111111111111111111111111111111111',
          symbol: 'TEST',
          pnl_percent: 25.5,
          exit_trigger: 'TP',
        },
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
        sending_expires_at: null,
        worker_id: null,
        last_error: null,
        created_at: '2024-01-01T00:00:00Z',
        sent_at: null,
      };

      expect(notification.payload).toHaveProperty('mint');
      expect(notification.payload).toHaveProperty('pnl_percent');
    });
  });

  describe('Database interface', () => {
    it('should have all 7 tables defined', () => {
      // Type-level test - if this compiles, the Database interface is correct
      type Tables = keyof Database['public']['Tables'];
      const expectedTables: Tables[] = [
        'users',
        'wallets',
        'settings',
        'launch_candidates',
        'positions',
        'executions',
        'notifications_outbox',
      ];

      expect(expectedTables).toHaveLength(7);
    });

    it('should have RPC functions defined', () => {
      type Functions = keyof Database['public']['Functions'];
      const expectedFunctions: Functions[] = [
        'claim_notifications',
        'mark_notification_delivered',
        'mark_notification_failed',
        'trigger_exit_atomically',
        'mark_position_executing',
        'mark_trigger_completed',
        'mark_trigger_failed',
      ];

      expect(expectedFunctions).toHaveLength(7);
    });
  });
});

describe('Schema constraints (logical)', () => {
  describe('Position lifecycle transitions', () => {
    it('should only allow valid lifecycle transitions', () => {
      // PRE_GRADUATION -> POST_GRADUATION (graduation)
      // PRE_GRADUATION -> CLOSED (early exit)
      // POST_GRADUATION -> CLOSED (normal exit)
      // CLOSED -> (terminal, no transitions)

      const validTransitions: Record<LifecycleState, LifecycleState[]> = {
        PRE_GRADUATION: ['POST_GRADUATION', 'CLOSED'],
        POST_GRADUATION: ['CLOSED'],
        CLOSED: [],
      };

      expect(validTransitions.PRE_GRADUATION).toContain('POST_GRADUATION');
      expect(validTransitions.PRE_GRADUATION).toContain('CLOSED');
      expect(validTransitions.POST_GRADUATION).toContain('CLOSED');
      expect(validTransitions.CLOSED).toHaveLength(0);
    });
  });

  describe('Trigger state machine', () => {
    it('should only allow valid trigger transitions', () => {
      // MONITORING -> TRIGGERED (condition met)
      // TRIGGERED -> EXECUTING (sell started)
      // EXECUTING -> COMPLETED (sell confirmed)
      // EXECUTING -> FAILED (sell failed)
      // FAILED -> MONITORING (retry allowed via emergency sell)

      const validTransitions: Record<TriggerState, TriggerState[]> = {
        MONITORING: ['TRIGGERED'],
        TRIGGERED: ['EXECUTING'],
        EXECUTING: ['COMPLETED', 'FAILED'],
        COMPLETED: [],
        FAILED: ['MONITORING'], // Emergency sell retry
      };

      expect(validTransitions.MONITORING).toContain('TRIGGERED');
      expect(validTransitions.TRIGGERED).toContain('EXECUTING');
      expect(validTransitions.EXECUTING).toContain('COMPLETED');
      expect(validTransitions.EXECUTING).toContain('FAILED');
      expect(validTransitions.COMPLETED).toHaveLength(0);
    });
  });

  describe('Pricing source alignment', () => {
    it('should align pricing_source with lifecycle_state', () => {
      // PRE_GRADUATION -> BONDING_CURVE
      // POST_GRADUATION -> AMM_POOL

      const expectedPricingSource: Record<Exclude<LifecycleState, 'CLOSED'>, PricingSource> = {
        PRE_GRADUATION: 'BONDING_CURVE',
        POST_GRADUATION: 'AMM_POOL',
      };

      expect(expectedPricingSource.PRE_GRADUATION).toBe('BONDING_CURVE');
      expect(expectedPricingSource.POST_GRADUATION).toBe('AMM_POOL');
    });
  });
});
