# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-18
**Branch:** `main`
**Status:** Token parsing WORKING - create_v2 discriminator fix deployed

---

## What Was Done This Session

### 1. Helius RPC Migration
- **Problem:** QuickNode free tier doesn't support `logsSubscribe`
- **Fix:** Switched to Helius paid plan
- **Deployed:** Secrets updated on raptor-hunter and raptor-bot

### 2. Address Lookup Table (ALT) Fix
- **Problem:** 100% token parse failure - program ID in ALTs not being read
- **Fix:** Combined staticAccountKeys + loadedAddresses.writable + loadedAddresses.readonly
- **Commit:** `9e01e03`

### 3. create_v2 Discriminator Fix (CRITICAL)
- **Problem:** After ALT fix, still 100% parse failure - discriminator mismatch
- **Root Cause:** pump.fun switched from `create` to `create_v2` instruction
  - Legacy: `[24,30,200,40,5,28,7,119]` - sha256("global:create")[0..8]
  - Current: `[214,144,76,236,95,139,49,180]` - sha256("global:create_v2")[0..8]
- **Fix:** Added CREATE_V2_DISCRIMINATOR and check for both
- **Commit:** `dbd0bd6`

---

## Current State

- **Token Parsing:** ✅ WORKING
- **Autohunt:** Waiting for user to arm strategy
- **Build:** `pnpm -w lint && pnpm -w build` passes

Last successful parses:
```
[PumpFunMonitor] Token: PinkBull (3EBTvCMr...)
[PumpFunMonitor] Token: WTF (4qrYs4Ku...)
[OpportunityLoop] No enabled strategies, skipping: WTF
```

---

## Deployment

**Fly.io auto-deploys from GitHub pushes** - no manual `fly deploy` needed.

For secrets:
```bash
fly secrets set KEY=value -a raptor-hunter
fly secrets deploy -a raptor-hunter
```

---

## Key Files Changed This Session

| File | Change |
|------|--------|
| `apps/hunter/src/monitors/pumpfun.ts` | ALT fix + create_v2 discriminator |
| `MUST_READ/DEPLOYMENT.md` | Added auto-deploy documentation |
| `MUST_READ/Changelog.md` | Added 2026-01-18 entries |

---

## Technical Notes

### Address Lookup Tables (ALTs)
Solana versioned (v0) transactions can reference accounts via ALTs. Must combine:
- `staticAccountKeys` - accounts in transaction
- `meta.loadedAddresses.writable` - writable from ALTs
- `meta.loadedAddresses.readonly` - readonly from ALTs

### Anchor Discriminators
Calculated as `sha256("global:<instruction_name>")[0..8]`:
- `create` → `[24,30,200,40,5,28,7,119]` (legacy)
- `create_v2` → `[214,144,76,236,95,139,49,180]` (current)
