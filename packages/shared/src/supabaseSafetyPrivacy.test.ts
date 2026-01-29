import { describe, it, expect, vi, beforeEach } from 'vitest';

const createClientMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
  SupabaseClient: class {},
}));

type QueryResult<T> = Promise<{ data: T; error: any }>;

function makeSupabaseStub(handlers: {
  usersSingle?: (ctx: { eqs: Array<[string, unknown]> }) => QueryResult<any>;
  positionsOrder?: (ctx: {
    eqs: Array<[string, unknown]>;
    neqs: Array<[string, unknown]>;
    orderBy: string;
  }) => QueryResult<any[]>;
  safetyControlsMaybeSingle?: (ctx: { eqs: Array<[string, unknown]> }) => QueryResult<any>;
}) {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      const neqs: Array<[string, unknown]> = [];

      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          eqs.push([col, val]);
          return builder;
        },
        neq(col: string, val: unknown) {
          neqs.push([col, val]);
          return builder;
        },
        order(orderBy: string) {
          if (table !== 'positions' || !handlers.positionsOrder) {
            return Promise.resolve({ data: [], error: null });
          }
          return handlers.positionsOrder({ eqs, neqs, orderBy });
        },
        single() {
          if (table === 'users' && handlers.usersSingle) {
            return handlers.usersSingle({ eqs });
          }
          return Promise.resolve({ data: null, error: { message: 'unexpected single()' } });
        },
        maybeSingle() {
          if (table === 'safety_controls' && handlers.safetyControlsMaybeSingle) {
            return handlers.safetyControlsMaybeSingle({ eqs });
          }
          return Promise.resolve({ data: null, error: { message: 'unexpected maybeSingle()' } });
        },
      };

      return builder;
    },
  };
}

describe('supabase safety/privacy hardening', () => {
  beforeEach(() => {
    createClientMock.mockReset();
    vi.resetModules();
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  });

  it('F-009: getUserOpenPositions filters by user_id (UUID schema) when mapping exists', async () => {
    const calls: Array<{ eqs: Array<[string, unknown]>; neqs: Array<[string, unknown]> }> = [];

    createClientMock.mockReturnValue(
      makeSupabaseStub({
        usersSingle: async ({ eqs }) => {
          expect(eqs).toEqual([['telegram_chat_id', 123]]);
          return { data: { id: 'uuid-user-1' }, error: null };
        },
        positionsOrder: async ({ eqs, neqs }) => {
          calls.push({ eqs, neqs });
          return { data: [{ id: 'pos-1' }], error: null };
        },
      })
    );

    const { getUserOpenPositions } = await import('./supabase.js');
    const result = await getUserOpenPositions(123);

    expect(result).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].eqs).toContainEqual(['user_id', 'uuid-user-1']);
  });

  it('F-009: getUserOpenPositions fails closed if UUID schema query fails', async () => {
    const calls: Array<{ eqs: Array<[string, unknown]>; neqs: Array<[string, unknown]> }> = [];

    createClientMock.mockReturnValue(
      makeSupabaseStub({
        usersSingle: async () => ({ data: { id: 'uuid-user-1' }, error: null }),
        positionsOrder: async ({ eqs }) => {
          calls.push({ eqs, neqs: [] });
          const hasUserIdFilter = eqs.some(([k]) => k === 'user_id');
          if (hasUserIdFilter) {
            return { data: null as any, error: { message: 'column "user_id" does not exist' } };
          }
          return { data: [{ id: 'pos-legacy-1', tg_id: 123 }], error: null };
        },
      })
    );

    const { getUserOpenPositions } = await import('./supabase.js');
    const result = await getUserOpenPositions(123);

    expect(result).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].eqs).toContainEqual(['user_id', 'uuid-user-1']);
    expect(calls[0].eqs.some(([k]) => k === 'tg_id')).toBe(false);
  });

  it('F-008: safety control reads fail closed (pause + disable) on DB errors', async () => {
    createClientMock.mockReturnValue(
      makeSupabaseStub({
        safetyControlsMaybeSingle: async () => ({
          data: null,
          error: { message: 'relation "safety_controls" does not exist' },
        }),
      })
    );

    const {
      isTradingPaused,
      isCircuitOpen,
      isAutoExecuteEnabledBySafetyControls,
      isManualTradingEnabledBySafetyControls,
    } = await import('./supabase.js');

    expect(await isTradingPaused()).toBe(true);
    expect(await isCircuitOpen()).toBe(true);
    expect(await isAutoExecuteEnabledBySafetyControls()).toBe(false);
    expect(await isManualTradingEnabledBySafetyControls()).toBe(false);
  });
});
