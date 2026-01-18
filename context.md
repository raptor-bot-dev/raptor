# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-18
**Branch:** `main`
**Status:** pump.pro Execution Debugging - Circuit Breaker Issue

---

## Latest: pump.pro Token Support (2026-01-18 afternoon)

### Current Blocker
**Circuit breaker keeps tripping** - jobs are being created but failing during execution.

### What's Working
| Component | Status |
|-----------|--------|
| Token detection (WebSocket) | ✅ pump.pro discriminator recognized |
| Metadata fetch | ✅ API → on-chain → fallback |
| Scoring | ✅ Relaxed rules pass pump.pro |
| Job creation | ✅ OpportunityLoop creates jobs |
| Staleness check | ✅ Jobs > 60s canceled, not failed |
| Error messages | ✅ parseError extracts real messages |

### What Needs Investigation
- Actual execution errors causing circuit breaker trips
- With parseError fix, FAILED jobs should now have real error messages

### Commits (This Session)
- `d1b86f3` - fix(hunter): add job staleness check (60s TTL)
- `d25ae0d` - fix(shared): handle object errors in parseError

### Tomorrow's First Steps
1. Reset circuit breaker
2. Check FAILED jobs for actual error messages
3. Investigate: wallet balance? bonding curve address? RPC errors?

---

## Previous: Snipe Mode & Production Bug Fixes (2026-01-18)

### What Was Fixed

| Issue | Severity | Fix |
|-------|----------|-----|
| Snipe mode button has emoji "✓" | **P1** | Changed to `[x] Speed` / `[x] Quality` |
| Clicking unchanged mode causes error | **P1** | Early return with "Already set to X" toast |
| BigInt underflow in pumpFun.ts | **P0** | Validation before BigInt operations |
| Jupiter slippage overflow (>99%) | **P0** | Clamp slippageBps to 9900 max |
| TypeScript type errors | **P2** | Use `as const` for literal types |

### Commits (Today)

- `5761fb9` - fix(bot): remove emoji from snipe mode buttons
- `5e4ca98` - fix(bot): prevent snipe mode 'message not modified' error
- `565594f` - fix(executor): prevent BigInt underflow and Jupiter slippage overflow

### Key Learning: Button Emoji Validator

panelKit.ts has `assertNoEmoji()` that throws on any emoji in button labels. The checkmark (✓) was caught by this. Per CLAUDE.md: "No emojis on buttons."

Use text indicators instead:
- `[x] Selected` - checkbox style
- `Selected` / `Not Selected` - plain text

---

## Previous: uuid_id Standardization (2026-01-18 earlier)

### What Was Fixed (Round 2)

| Issue | Severity | Fix |
|-------|----------|-----|
| RPC functions use INTEGER `id` but receive UUID | **P0** | Migration 015 - All RPCs now use `uuid_id` |
| `positions.uuid_id` can be NULL | **P0** | Backfill + NOT NULL constraint |
| No unique index on `uuid_id` | **P0** | Added unique index |
| `PositionV31` missing `uuid_id` field | **P1** | Added to TypeScript interface |
| Trigger-time notifications have placeholder values | **P2** | Moved to post-sell with real data |

### Commits (Round 2)
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

## Critical Patterns

### Position ID Standard
**Always use `uuid_id` (UUID) for position operations**, not the integer `id` column.

```typescript
// Position creation returns uuid_id
const position = await createPositionV31({ ... });
const positionId = position.uuid_id;  // Use this everywhere!

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

### Button Labels (No Emojis!)
```typescript
// WRONG - will throw assertNoEmoji error
btn('Speed ✓', CB.SETTINGS.SET_SNIPE_MODE_SPEED)

// RIGHT - use text indicators
btn('[x] Speed', CB.SETTINGS.SET_SNIPE_MODE_SPEED)
```

---

## Deployment Status

- **Database**: Migrations 014 + 015 applied
- **Bot**: v85 - Snipe mode fixes deployed
- **Hunter**: v95 - pump.pro support + staleness check + parseError fix
- **Feature Flags**:
  - `TPSL_ENGINE_ENABLED=true` (shadow mode)
  - `LEGACY_POSITION_MONITOR=true` (parallel operation)

Build Status: **PASSING**

Fly.io auto-deploys from GitHub pushes to `main`.

---

## Settings Panel Features

Current settings available in UI:
- Trade Size (SOL)
- Max Positions (1 or 2)
- Take Profit %
- Stop Loss %
- Slippage % (capped at 99%)
- Priority Fee (SOL)
- Snipe Mode (Speed / Quality)
- MEV Protection (ON/OFF)

---

## Notification Patterns

### After SELL completes (not at trigger time)
```typescript
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
