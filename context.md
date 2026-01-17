# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-17
**Branch:** `main`
**Status:** Deployed and armed - monitoring for first trade

---

## What Was Done This Session

### 1. Token Parsing Fix (CRITICAL)
- **Problem:** 100% of detected tokens failed to parse
- **Root Cause:** PumpFunMonitor only handled versioned (v0) transactions
- **Fix:** Added support for both versioned AND legacy transaction formats
  - Versioned: `staticAccountKeys`, `compiledInstructions`, Uint8Array data
  - Legacy: `accountKeys`, `instructions`, base64 string data
- **File:** `apps/hunter/src/monitors/pumpfun.ts`

### 2. Circuit Breaker Reset
- Had 8 consecutive failures (threshold: 5)
- `circuit_open_until` was blocking all trades
- Reset via SQL: `UPDATE safety_controls SET circuit_open_until = NULL, consecutive_failures = 0`

### 3. Settings Panel Text Input Fixed
- `messages.ts` missing cases for v3 session steps
- Added routing to `handleSettingsInput()` for all settings edits

### 4. Slippage UX Changed to Percentage
- Display: "10%" instead of "1000 bps"
- Input: accepts 1-1000% (converted to bps internally)

### 5. MEV/Priority Fee Audit
- Hunter now passes `tgId: job.user_id` to executor
- Enables user's priority_sol and anti_mev_enabled settings

---

## Current State

- **Build:** `pnpm -w lint && pnpm -w build` passes
- **Deployed:** Both apps deployed to Fly.io
- **User:** Armed autohunt with 1 SOL funded wallet
- **Circuit Breaker:** Reset and open

---

## Key Files Changed This Session

| File | Change |
|------|--------|
| `apps/hunter/src/monitors/pumpfun.ts` | Versioned + legacy tx parsing |
| `apps/bot/src/handlers/messages.ts` | Settings session step routing |
| `apps/bot/src/handlers/settingsHandler.ts` | Slippage % input conversion |
| `apps/bot/src/ui/panels/settings.ts` | Slippage % display |
| `apps/hunter/src/loops/execution.ts` | Pass tgId to executor |

---

## Commits This Session

1. `e5cb4c4` - fix(bot): settings input routing, slippage %, hunter MEV/priority
2. `bb35ea2` - fix(hunter): handle both versioned and legacy tx parsing

---

## Monitoring

Check hunter logs for successful token parsing:
```
[PumpFunMonitor] TX abc123... versioned=false, 5 ix, 12 accounts
[PumpFunMonitor] Token: SYMBOL (mint_address)
```

If still seeing "Failed to parse", the issue may be:
1. RPC returning null (timing - increase retry delay)
2. pump.fun changed Create instruction format (check discriminator)

---

## Fly.io Apps

| App | Status |
|-----|--------|
| raptor-bot | deployed |
| raptor-hunter | deployed |
