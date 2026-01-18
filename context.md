# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-18
**Branch:** `main`
**Status:** Phase B - TP/SL Engine implementation COMPLETE

---

## Current Task: TP/SL Engine Implementation

### Overview
Implementing automatic position exits via TP/SL triggers with hybrid pricing architecture.

### Architecture Decisions
1. **Integrated approach** - New TpSlMonitorLoop in `apps/hunter` (not separate service)
2. **Hybrid pricing** - Jupiter API (3s poll) + Helius WS for instant activity detection
3. **Exactly-once semantics** - Atomic DB trigger claim + existing idempotency patterns
4. **Feature-flagged migration** - Run parallel with legacy polling, gradual cutover

### Implementation Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Documentation updates | COMPLETE |
| 1 | Database migration (trigger_state) | COMPLETE |
| 2 | Helius WebSocket infrastructure | COMPLETE |
| 3 | Exit queue with backpressure | COMPLETE |
| 4 | TpSlMonitorLoop integration | COMPLETE |
| 5 | Testing and verification | COMPLETE |

---

## Files Created

| File | Purpose |
|------|---------|
| `packages/database/migrations/014_tpsl_engine_state.sql` | trigger_state column, atomic claim function |
| `packages/shared/src/tpsl.ts` | TriggerState type, computeTpSlPrices(), EXIT_PRIORITY |
| `apps/hunter/src/monitors/heliusWs.ts` | Helius WebSocket manager with heartbeat |
| `apps/hunter/src/monitors/subscriptionManager.ts` | Token-scoped subscription lifecycle |
| `apps/hunter/src/queues/exitQueue.ts` | Exit queue with backpressure |
| `apps/hunter/src/loops/tpslMonitor.ts` | Main TP/SL monitoring loop |

## Files Updated

| File | Changes |
|------|---------|
| `packages/shared/src/types.ts` | Added TriggerState type, PositionV31 fields |
| `packages/shared/src/index.ts` | Export tpsl module |
| `packages/shared/src/config.ts` | Feature flag functions |
| `apps/hunter/src/index.ts` | Conditional TP/SL and legacy loop startup |
| `.env.fly` | TP/SL engine environment variables |

---

## Deployment Instructions

### 1. Apply Database Migration
Run the migration `014_tpsl_engine_state.sql` on Supabase before deploying.

### 2. Feature Flags
- `TPSL_ENGINE_ENABLED=false` - Keep disabled initially
- `LEGACY_POSITION_MONITOR=true` - Keep legacy running

### 3. Gradual Cutover
1. **Shadow Mode**: Set `TPSL_ENGINE_ENABLED=true` while keeping legacy enabled
2. **Verify**: Monitor logs for trigger accuracy, compare timing
3. **Cutover**: Set `LEGACY_POSITION_MONITOR=false` when confident

---

## Technical Notes

### Helius WebSocket Requirements
- 10-minute inactivity timer - MUST ping every 30 seconds
- Endpoint: `wss://mainnet.helius-rpc.com/?api-key=<KEY>`
- logsSubscribe supports only ONE pubkey per call

### Trigger State Machine
```
MONITORING → TRIGGERED → EXECUTING → COMPLETED
                                  ↘ FAILED
```

### Exit Priority (lower = higher priority)
```
EMERGENCY: 0
SL: 10
TP: 50
TRAIL: 60
MAXHOLD: 70
MANUAL: 80
```

### Idempotency Key Format
```
RAPTOR:V3:EXIT:sol:SELL:<MINT>:pos:<POSITION_ID>:trg:<TRIGGER>:<HASH>
```

---

## Build Verification

Before deploying:
```bash
pnpm -w lint && pnpm -w build
```

Build Status: **PASSING**

Fly.io auto-deploys from GitHub pushes to `main`.
