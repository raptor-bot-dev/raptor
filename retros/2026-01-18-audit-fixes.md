# Retro: TP/SL Engine Audit Fixes

**Date:** 2026-01-18
**Session:** Phase B Audit Fixes
**Commit:** `bbfdd53`

---

## What We Fixed

An audit of the TP/SL engine implementation revealed 6 critical bugs that would have prevented the system from working correctly in production.

### Bug Summary

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | NotificationPoller never started | **P0** | Notifications never delivered to Telegram |
| 2 | Notification types wrong | **P0** | Formatter didn't recognize types, wrong messages |
| 3 | Position creation uses wrong column | **P0** | Positions fail to insert (user_id vs tg_id) |
| 4 | TP/SL fields not populated | **P0** | WebSocket hints miss bonding curve, no stored prices |
| 5 | State machine stuck at TRIGGERED | **P1** | Positions never complete, no EXECUTING/COMPLETED state |
| 6 | Duplicate triggers possible | **P1** | Legacy monitor could fire alongside TP/SL engine |
| 7 | TP/SL prices recomputed | **P2** | Strategy changes could affect open positions |

---

## Root Cause Analysis

### 1. NotificationPoller Never Started

**Root Cause:** `createNotificationPoller()` was defined but never called in `bot/index.ts`.

**Fix:** Import and call in bot startup:
```typescript
const notificationPoller = createNotificationPoller(bot as any);
notificationPoller.start();
```

### 2. Notification Type Mismatch

**Root Cause:** `exitQueue.ts` used types like `'TAKE_PROFIT'` but formatter expected `'TP_HIT'`.

**Fix:** Map triggers to correct types:
- `'TP'` → `'TP_HIT'`
- `'SL'` → `'SL_HIT'`
- `'TRAIL'` → `'TRAILING_STOP_HIT'`
- `'MAXHOLD'`/`'EMERGENCY'` → `'POSITION_CLOSED'`

### 3. Position Column Name

**Root Cause:** `createPositionV31()` inserted into `user_id` column, but DB table uses `tg_id`.

**Fix:** Change insert to use `tg_id: position.userId`.

### 4. Missing TP/SL Fields

**Root Cause:** `createPositionV31()` didn't accept or populate:
- `trigger_state`
- `tp_price` / `sl_price`
- `bonding_curve`

**Fix:** Extended function signature and compute prices at creation time.

### 5. State Machine Not Advancing

**Root Cause:** RPC functions `mark_position_executing()`, `mark_trigger_completed()`, `mark_trigger_failed()` existed in DB but had no TypeScript wrappers and were never called.

**Fix:**
1. Add wrapper functions in `supabase.ts`
2. Call in `execution.ts` before/after sell transactions

### 6. Duplicate Triggers

**Root Cause:** Legacy `positions.ts` monitor didn't check `trigger_state` before firing.

**Fix:** Add guard:
```typescript
if (position.trigger_state && position.trigger_state !== 'MONITORING') {
  return; // Already triggered by TP/SL engine
}
```

### 7. Dynamic Price Recomputation

**Root Cause:** `tpslMonitor.ts` always computed TP/SL from strategy instead of using stored `position.tp_price`/`sl_price`.

**Fix:** Use stored prices when available, fall back to strategy for legacy positions.

---

## Files Changed

| File | Lines Changed | Changes |
|------|---------------|---------|
| `apps/bot/src/index.ts` | +9 | Start NotificationPoller |
| `apps/hunter/src/queues/exitQueue.ts` | +30/-6 | Fix types, payload |
| `packages/shared/src/supabase.ts` | +90/-1 | Add wrappers, fix tg_id |
| `apps/hunter/src/loops/execution.ts` | +27 | State transitions |
| `apps/hunter/src/loops/positions.ts` | +29/-6 | Trigger state check |
| `apps/hunter/src/loops/tpslMonitor.ts` | +26/-5 | Stored prices |

**Total:** +211/-18 lines

---

## Lessons Learned

### 1. Integration Testing Catches What Unit Tests Miss

The individual components (NotificationPoller, exitQueue, createPositionV31) all worked in isolation. The bugs were in how they connected:
- Poller never started
- Types didn't match between producer and consumer
- Column names didn't match between code and schema

**Action:** Add integration tests that verify the full path from trigger to notification delivery.

### 2. Type Safety Doesn't Prevent Schema Mismatches

TypeScript showed `user_id` everywhere but the actual DB column was `tg_id`. The PositionV31 type was wrong.

**Action:** Consider generating types from DB schema (e.g., `supabase gen types`).

### 3. Feature Flags Are Essential

Running both monitors in parallel allowed us to fix bugs without service interruption. The `trigger_state` check prevents duplicates.

**Action:** Keep shadow mode until full confidence, then cut over.

### 4. Audit Before Deploy

An external audit caught issues that would have been critical in production. Fresh eyes find assumptions.

**Action:** Always audit critical paths before enabling in production.

---

## Verification Checklist

- [x] NotificationPoller starts and polls
- [x] Notification types match formatter expectations
- [x] Position creation succeeds with tg_id
- [x] trigger_state, tp_price, sl_price, bonding_curve populated
- [x] State machine transitions: MONITORING → TRIGGERED → EXECUTING → COMPLETED
- [x] Legacy monitor skips non-MONITORING positions
- [x] Stored TP/SL prices used when available
- [x] Build passes: `pnpm -w lint && pnpm -w build`

---

## Next Steps

1. **Monitor logs** for notification delivery success
2. **Verify state transitions** in production (check positions table)
3. **Test trigger scenarios** - TP, SL, TRAIL, MAXHOLD
4. **Gradual cutover** - disable legacy monitor when confident

---

## References

- [AUDIT_FIX_PLAN.md](/mnt/c/RaptorBot/raptor/AUDIT_FIX_PLAN.md)
- [AUDIT_RESEARCH_NOTES.md](/mnt/c/RaptorBot/raptor/AUDIT_RESEARCH_NOTES.md)
- [2026-01-18-tpsl-engine.md](/mnt/c/RaptorBot/raptor/retros/2026-01-18-tpsl-engine.md)
