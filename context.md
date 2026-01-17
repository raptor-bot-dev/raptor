# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-17
**Branch:** `main`
**Status:** Ready for deployment - all fixes complete

---

## What Was Done This Session

### 1. RPC Migration (Helius -> QuickNode)
- Helius free tier was rate-limiting WebSocket (HTTP 429)
- Migrated to QuickNode free tier (10M credits, 15 RPS)
- Updated secrets on raptor-hunter and raptor-bot via Fly.io

### 2. Settings Panel Text Input Fixed
- **Problem:** Settings wouldn't update when user entered values
- **Root Cause:** `messages.ts` missing cases for v3 session steps
- **Fix:** Added routing to `handleSettingsInput()` for:
  - AWAITING_TRADE_SIZE
  - AWAITING_MAX_POSITIONS
  - AWAITING_TP_PERCENT
  - AWAITING_SL_PERCENT
  - AWAITING_SLIPPAGE_BPS
  - AWAITING_PRIORITY_SOL

### 3. Slippage UX Improved
- Changed from bps to percentage display/input
- Range: 1-1000% (for high volatility launches)
- Stored internally as bps (multiply by 100)

### 4. MEV/Priority Fee Audit
- Full audit of Jito and priority fee implementation
- **Found bug:** Hunter wasn't passing tgId to executor
- **Fixed:** Added `tgId: job.user_id` to buy/sell calls
- User's priority_sol and anti_mev_enabled now active

---

## Current State

- **Build:** `pnpm -w lint && pnpm -w build` passes
- **RPC:** QuickNode free tier (secrets deployed)
- **Bot:** Settings input working, slippage in %
- **Hunter:** Passes tgId, MEV protection active

---

## Deployment Commands

```bash
fly deploy -a raptor-bot
fly deploy -a raptor-hunter
```

---

## Key Files Changed

| File | Change |
|------|--------|
| `apps/bot/src/handlers/messages.ts` | Added v3 settings session step routing |
| `apps/bot/src/handlers/settingsHandler.ts` | Slippage % input conversion |
| `apps/bot/src/ui/panels/settings.ts` | Slippage % display |
| `apps/hunter/src/loops/execution.ts` | Pass tgId to executor |

---

## MEV Protection Flow

```
User Settings (Telegram)
    ↓
chain_settings (priority_sol, anti_mev_enabled)
    ↓
Hunter ExecutionLoop → { tgId: job.user_id }
    ↓
SolanaExecutor → fetches user's chain_settings
    ↓
Jito bundle (Jupiter) or priority fee (pump.fun)
```

---

## User Action Required

- Fund wallet with SOL to start trading
- Wallet address: check Telegram bot Home panel

---

## Smoke Test Checklist

| Test | Expected | Status |
|------|----------|--------|
| Settings edit | Enter value, shows confirmation | [ ] |
| Slippage display | Shows "10%" not "1000 bps" | [ ] |
| Priority fee | Saves 0.0001 - 0.01 SOL | [ ] |
| MEV toggle | ON/OFF toggles | [ ] |
| Hunter WebSocket | Connected to QuickNode | [ ] |
| Autohunt buy | Uses user's priority/MEV | [ ] |

---

## Fly.io Apps

| App | Status | Action |
|-----|--------|--------|
| raptor-bot | needs deploy | `fly deploy -a raptor-bot` |
| raptor-hunter | needs deploy | `fly deploy -a raptor-hunter` |
