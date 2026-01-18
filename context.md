# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-18
**Branch:** `main`
**Status:** Phase B - TP/SL Engine COMPLETE + Audit Fixes Deployed

---

## Latest: Audit Fixes (2026-01-18)

### What Was Fixed

| Issue | Severity | Fix |
|-------|----------|-----|
| Notifications never delivered | **P0** | Start NotificationPoller in bot/index.ts |
| Notification types wrong | **P0** | TAKE_PROFIT → TP_HIT, STOP_LOSS → SL_HIT |
| Notification payload mismatch | **P0** | Use tokenSymbol, pnlPercent, solReceived, txHash |
| Position creation broken | **P0** | Use `tg_id` not `user_id` column |
| TP/SL fields not populated | **P0** | Set trigger_state, tp_price, sl_price, bonding_curve |
| State machine stuck | **P1** | Add markPositionExecuting/Completed/Failed calls |
| Duplicate triggers possible | **P1** | Add trigger_state check to legacy monitor |
| TP/SL prices recomputed | **P2** | Use stored position.tp_price/sl_price |

### Files Changed (Audit)

| File | Changes |
|------|---------|
| `apps/bot/src/index.ts` | Start NotificationPoller + shutdown handler |
| `apps/hunter/src/queues/exitQueue.ts` | Fix notification types and payload |
| `packages/shared/src/supabase.ts` | Fix tg_id, add state wrappers, add getOpportunityById |
| `apps/hunter/src/loops/execution.ts` | Call state transitions, pass TP/SL + bonding_curve |
| `apps/hunter/src/loops/positions.ts` | Add trigger_state check, fix notification types |
| `apps/hunter/src/loops/tpslMonitor.ts` | Use stored tp_price/sl_price |

### Commit
`bbfdd53` - fix(tpsl): audit fixes for notification delivery and state machine

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
| `packages/database/migrations/014_tpsl_engine_state.sql` | trigger_state, atomic claim functions |
| `apps/hunter/src/monitors/heliusWs.ts` | WebSocket with 30s heartbeat |
| `apps/hunter/src/monitors/subscriptionManager.ts` | Token-scoped subscriptions |
| `apps/hunter/src/queues/exitQueue.ts` | Priority queue with backpressure |
| `apps/hunter/src/loops/tpslMonitor.ts` | Main orchestrator |

---

## Critical Patterns (from Audit)

### Position Creation
```typescript
await createPositionV31({
  userId: job.user_id,  // Maps to tg_id internally
  // ... other fields
  tpPercent: strategy.take_profit_percent,
  slPercent: strategy.stop_loss_percent,
  bondingCurve: opportunity?.bonding_curve,
});
```

### State Machine Calls (SELL jobs)
```typescript
// Before sell
await markPositionExecuting(positionId);
// On success (after closePositionV31)
await markTriggerCompleted(positionId);
// On failure
await markTriggerFailed(positionId, error);
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

- **Database**: Migration 014 applied
- **Bot**: Deployed with NotificationPoller
- **Hunter**: Deployed with audit fixes
- **Feature Flags**:
  - `TPSL_ENGINE_ENABLED=true` (shadow mode)
  - `LEGACY_POSITION_MONITOR=true` (parallel operation)

Build Status: **PASSING**

Fly.io auto-deploys from GitHub pushes to `main`.
