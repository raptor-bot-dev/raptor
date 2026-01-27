# Retro: TP/SL Engine Implementation

**Date:** 2026-01-18
**Session:** Phase B - TP/SL Engine

---

## What We Built

### TP/SL Engine (Automatic Position Exits)

A hybrid pricing system for automatic position exits combining:
- Jupiter Price API (3s polling) for reliable pricing
- Helius WebSocket for instant activity detection
- Atomic trigger state machine for exactly-once execution
- Exit queue with backpressure for executor protection

### Key Components

| Component | Purpose |
|-----------|---------|
| TpSlMonitorLoop | Main orchestrator - polls Jupiter, listens to WS |
| HeliusWsManager | WebSocket connection with heartbeat and reconnect |
| SubscriptionManager | Token-scoped subscriptions (one per token) |
| ExitQueue | Concurrency-limited queue with priority |

---

## Architecture Decisions

### 1. Integrated vs Separate Service

**Decision:** Integrate into `apps/hunter` (not separate service)

**Rationale:**
- Current scale (tens of positions) doesn't require separate process
- Simpler deployment on Fly.io
- Reuses existing patterns (PumpFunMonitor WS handling)
- Can extract later if needed

### 2. Hybrid Pricing

**Decision:** Jupiter polling + WebSocket activity hints

**Rationale:**
- Jupiter is battle-tested and reliable
- WebSocket enables instant trigger on activity
- Never rely solely on WS for price calculation
- Fallback always available via Jupiter

### 3. Feature-Flagged Migration

**Decision:** Run new and legacy monitors in parallel

**Rationale:**
- Zero-downtime migration
- Can compare trigger timing
- Easy rollback if issues arise
- Gradual cutover by user percentage

---

## Design Patterns Used

### 1. Atomic Trigger Claim

```sql
UPDATE positions
SET trigger_state = 'TRIGGERED'
WHERE id = $id AND trigger_state = 'MONITORING';
```

Prevents double-execution even under WS message bursts.

### 2. Idempotency Keys

```
RAPTOR:V3:EXIT:sol:SELL:<MINT>:pos:<POS_ID>:trg:<TRIGGER>:<HASH>
```

Same position + same trigger = one and only one sell.

### 3. Backpressure Queue

```typescript
class ExitQueue {
  maxConcurrent = 3;
  // Never execute in WS callback
  // Priority: SL > TP > TRAIL > MAXHOLD
}
```

Prevents executor overload during volatile markets.

---

## Research Findings

### Helius WebSocket

- 10-minute inactivity timeout - MUST ping every 30-60 seconds
- logsSubscribe only supports ONE pubkey per call
- Endpoint: `wss://mainnet.helius-rpc.com/?api-key=<KEY>`

### Jupiter API

- Quote endpoint: `https://api.jup.ag/swap/v1/quote`
- `outAmount` is best-case; `otherAmountThreshold` includes slippage
- Use `restrictIntermediateTokens=true` for better routes

---

## Files Created/Modified

### Documentation Updates (Phase 0)
- `MUST_READ/Architecture.md` - Added TP/SL engine architecture diagram
- `MUST_READ/CLAUDE.md` - Added TP/SL constraints and patterns
- `MUST_READ/DESIGN.md` - Added trigger state machine design
- `MUST_READ/Reference_docs.md` - Added Helius/Jupiter API links
- `MUST_READ/Project_status.md` - Added Phase B milestone
- `MUST_READ/Changelog.md` - Added TP/SL engine entry
- `context.md` - Updated with implementation context

### Implementation (Phases 1-5) - COMPLETE

**Phase 1: Database Migration**
- `packages/database/migrations/014_tpsl_engine_state.sql`
  - Added `trigger_state`, `tp_price`, `sl_price`, `bonding_curve`, `triggered_at` columns
  - Created `trigger_exit_atomically()` atomic claim function
  - Added index for trigger evaluation queries

**Phase 2: Helius WebSocket Infrastructure**
- `apps/hunter/src/monitors/heliusWs.ts` - HeliusWsManager
  - 30s heartbeat to prevent 10-min timeout
  - Exponential backoff reconnect (max 10 attempts)
  - Subscription restore on reconnect
- `apps/hunter/src/monitors/subscriptionManager.ts` - TpSlSubscriptionManager
  - Token-scoped subscriptions with reference counting
  - Activity events for immediate price refresh

**Phase 3: Exit Queue with Backpressure**
- `apps/hunter/src/queues/exitQueue.ts` - ExitQueue
  - Priority sorting (SL > TP > TRAIL > MAXHOLD)
  - Deduplication via idempotency key
  - maxConcurrent=3 backpressure

**Phase 4: TpSlMonitorLoop Integration**
- `apps/hunter/src/loops/tpslMonitor.ts` - Main orchestrator
  - Jupiter polling (3s interval)
  - WebSocket activity hint handling
  - Atomic trigger claims
  - Exit job queueing
- `apps/hunter/src/index.ts` - Conditional startup with feature flags

**Phase 5: Testing and Verification**
- Build: PASSING
- Lint: PASSING
- Updated `.env.fly` with TP/SL configuration

---

## Lessons Learned

1. **WebSocket is not a pricing source** - Use it for activity detection, not price calculation
2. **Atomic claims are essential** - WS can deliver duplicate events under load
3. **Never block callbacks** - Queue operations, don't execute inline
4. **Feature flags enable safe migration** - Run old and new systems in parallel
5. **Type safety catches issues early** - Adding fields to PositionV31 caught missing bonding_curve

---

## Deployment Checklist

1. [ ] Apply migration `014_tpsl_engine_state.sql` to Supabase
2. [ ] Deploy with `TPSL_ENGINE_ENABLED=false` initially
3. [ ] Enable shadow mode: `TPSL_ENGINE_ENABLED=true` + `LEGACY_POSITION_MONITOR=true`
4. [ ] Monitor logs for trigger accuracy
5. [ ] Gradual cutover: `LEGACY_POSITION_MONITOR=false`

---

## Verification Checklist (Post-Deploy)

- [ ] TP trigger fires when price >= entry * (1 + tp_percent/100)
- [ ] SL trigger fires when price <= entry * (1 - sl_percent/100)
- [ ] Trailing stop activates and triggers correctly
- [ ] No double-executions under WS burst
- [ ] WS reconnects automatically after disconnect
- [ ] Heartbeat prevents 10-min timeout
- [ ] Exit queue processes with backpressure
- [ ] Legacy polling can be disabled without issues

---

## References

- [MUST_READ/TP_SL_ENGINE_BUILD.md](/mnt/c/RaptorBot/raptor/MUST_READ/TP_SL_ENGINE_BUILD.md)
- [Helius WebSocket Docs](https://www.helius.dev/docs/api-reference/rpc/websocket/logssubscribe)
- [Jupiter Quote API](https://dev.jup.ag/docs/swap/get-quote)
