# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-18
**Branch:** `main`
**Status:** Phase B - TP/SL Engine COMPLETE + Audit Fixes Round 2 Deployed

---

## Latest: uuid_id Standardization (2026-01-18)

### What Was Fixed (Round 2)

| Issue | Severity | Fix |
|-------|----------|-----|
| RPC functions use INTEGER `id` but receive UUID | **P0** | Migration 015 - All RPCs now use `uuid_id` |
| `positions.uuid_id` can be NULL | **P0** | Backfill + NOT NULL constraint |
| No unique index on `uuid_id` | **P0** | Added unique index |
| `PositionV31` missing `uuid_id` field | **P1** | Added to TypeScript interface |
| `markNotificationFailed` uses wrong columns | **P1** | Uses RPC with correct `delivery_error` column |
| Trigger-time notifications have placeholder values | **P2** | Moved to post-sell with real data |
| TRADE_DONE used for both BUY and SELL | **P2** | TRADE_DONE is BUY-only now |

### Files Changed (Round 2)

| File | Changes |
|------|---------|
| `packages/database/migrations/015_tpsl_uuid_and_notifications.sql` | NEW - uuid_id fixes, RPC fixes |
| `packages/shared/src/types.ts` | Add `uuid_id` to PositionV31 |
| `packages/shared/src/supabase.ts` | Add triggerExitAtomically, fix closePositionV31 |
| `apps/hunter/src/loops/tpslMonitor.ts` | Use uuid_id consistently |
| `apps/hunter/src/queues/exitQueue.ts` | Remove trigger-time notifications |
| `apps/hunter/src/loops/positions.ts` | Atomic claim before exit jobs |
| `apps/hunter/src/loops/execution.ts` | Post-sell notifications |
| `apps/bot/src/handlers/*.ts` | Use uuid_id throughout |

### Commits
- `cf9cb34` - fix(tpsl): standardize on uuid_id and fix critical RPC bugs
- `bbfdd53` - fix(tpsl): audit fixes for notification delivery and state machine

---

## TP/SL Engine Architecture

### Implementation Phases (All Complete)

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Documentation updates | ✅ |
| 1 | Database migration (trigger_state) | ✅ |
| 2 | Helius WebSocket infrastructure | ✅ |
| 3 | Exit queue with backpressure | ✅ |
| 4 | TpSlMonitorLoop integration | ✅ |
| 5 | Testing and verification | ✅ |
| 6 | Audit fixes | ✅ |

### Key Files

| File | Purpose |
|------|---------|
| `packages/database/migrations/014_tpsl_engine_state.sql` | trigger_state column, atomic claim functions |
| `packages/database/migrations/015_tpsl_uuid_and_notifications.sql` | uuid_id fixes, RPC fixes |
| `apps/hunter/src/monitors/heliusWs.ts` | WebSocket with 30s heartbeat |
| `apps/hunter/src/monitors/subscriptionManager.ts` | Token-scoped subscriptions |
| `apps/hunter/src/queues/exitQueue.ts` | Priority queue with backpressure |
| `apps/hunter/src/loops/tpslMonitor.ts` | Main orchestrator |

---

## Critical Patterns (from Audit)

### Position ID Standard
**Always use `uuid_id` (UUID) for position operations**, not the integer `id` column.

```typescript
// Position creation returns uuid_id
const position = await createPositionV31({
  userId: job.user_id,  // Maps to tg_id internally
  // ... other fields
});
const positionId = position.uuid_id;  // Use this!

// All operations use uuid_id
await triggerExitAtomically(position.uuid_id, 'TP', triggerPrice);
await closePositionV31({ positionId: position.uuid_id, ... });
```

### State Machine Calls (SELL jobs)
```typescript
// Before sell
await markPositionExecuting(positionId);  // uuid_id
// On success (after closePositionV31)
await markTriggerCompleted(positionId);   // uuid_id
// On failure
await markTriggerFailed(positionId, error);  // uuid_id
```

### Notification Types
- `TP` → `TP_HIT` (not TAKE_PROFIT)
- `SL` → `SL_HIT` (not STOP_LOSS)
- `TRAIL` → `TRAILING_STOP_HIT`
- `MAXHOLD`/`EMERGENCY` → `POSITION_CLOSED`

### Trigger State Check (Legacy Monitor)
```typescript
if (position.trigger_state && position.trigger_state !== 'MONITORING') {
  return; // Skip - already triggered
}
```

---

## Deployment Status

- **Database**: Migrations 014 + 015 applied
- **Bot**: Deployed with NotificationPoller
- **Hunter**: Deployed with uuid_id standardization
- **Feature Flags**:
  - `TPSL_ENGINE_ENABLED=true` (shadow mode)
  - `LEGACY_POSITION_MONITOR=true` (parallel operation)

Build Status: **PASSING**

Fly.io auto-deploys from GitHub pushes to `main`.

---

## Notification Patterns

### After SELL completes (not at trigger time)
```typescript
// Post-sell notification with real data
await createNotification({
  userId: position.tg_id,
  type: triggerToNotificationType(trigger),  // TP_HIT, SL_HIT, etc.
  payload: {
    tokenSymbol: position.token_symbol,
    pnlPercent: result.pnlPercent,
    solReceived: result.solReceived,  // Real value
    txHash: result.txSig,             // Real tx signature
    trigger,
    positionId: position.uuid_id,
  },
});
```

### TRADE_DONE is BUY-only
- BUY success → `TRADE_DONE` notification
- SELL success → `TP_HIT`, `SL_HIT`, `TRAILING_STOP_HIT`, or `POSITION_CLOSED`
