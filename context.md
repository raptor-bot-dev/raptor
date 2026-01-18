# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-18
**Branch:** `main`
**Status:** Helius configured, ALT fix committed - needs deploy

---

## What Was Done This Session

### 1. Helius RPC Migration
- **Problem:** QuickNode free tier doesn't support `logsSubscribe` - WebSocket closed immediately after subscription
- **Error:** `1001 - upstream went away` after subscribe
- **Fix:** Switched to Helius paid plan (API key: 4f5a8544-...)
- **Deployed:** Secrets updated on raptor-hunter and raptor-bot via `fly-secrets-deploy`

### 2. Address Lookup Table (ALT) Fix (CRITICAL)
- **Problem:** 100% of detected tokens failing to parse even with Helius working
- **Root Cause:** Versioned transactions can have accounts in Address Lookup Tables (ALTs)
  - We were only reading `staticAccountKeys`
  - The pump.fun program ID was in `meta.loadedAddresses` from ALTs
  - No pump.fun instructions were matching because program ID wasn't in our account list
- **Fix:** Combined all account sources for versioned transactions:
  - `staticAccountKeys` (original)
  - `meta.loadedAddresses.writable` (from ALTs)
  - `meta.loadedAddresses.readonly` (from ALTs)
- **File:** `apps/hunter/src/monitors/pumpfun.ts`
- **Commit:** `9e01e03`

---

## Current State

- **Build:** `pnpm -w lint && pnpm -w build` passes
- **Helius Secrets:** Deployed to Fly.io apps
- **Code Fix:** Auto-deployed to Fly.io via GitHub integration

---

## Deployment

**Fly.io auto-deploys from GitHub pushes** - no manual deploy needed.

Releases are triggered automatically when commits are pushed to `main`.

---

## Key Files Changed This Session

| File | Change |
|------|--------|
| `apps/hunter/src/monitors/pumpfun.ts` | Include ALT loaded addresses |

---

## Commits This Session

1. `5cf1818` - debug: log pump.fun discriminators for create instruction mismatch
2. `9e01e03` - fix(hunter): include ALT loaded addresses for versioned transactions

---

## Verification After Deploy

Check hunter logs for successful token parsing:
```
[PumpFunMonitor] TX abc123... versioned=true, 6 ix, 25 accounts
[PumpFunMonitor] pump.fun discriminators in TX: [24,30,200,40,5,28,7,119]
[PumpFunMonitor] Token: SYMBOL (mint_address)
```

If still seeing "No Create instruction found", check:
1. The discriminator `[24,30,200,40,5,28,7,119]` in logs vs CREATE_DISCRIMINATOR constant
2. pump.fun may have changed their program (unlikely but possible)

---

## Fly.io Apps

| App | Status |
|-----|--------|
| raptor-bot | Helius secrets deployed |
| raptor-hunter | Helius secrets deployed, CODE NEEDS DEPLOY |

---

## Technical Notes

### Address Lookup Tables (ALTs)
Solana versioned (v0) transactions can reference accounts via ALTs to fit more accounts in a transaction. The `getTransaction` RPC response includes:
- `transaction.message.staticAccountKeys` - accounts directly in the transaction
- `meta.loadedAddresses.writable` - writable accounts from ALTs
- `meta.loadedAddresses.readonly` - readonly accounts from ALTs

The full account list for instruction parsing must combine all three.
