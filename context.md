# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-19
**Branch:** `main`
**Status:** Emergency Sell and Pricing Reliability Fixes - COMPLETE

---

## Latest: Emergency Sell and Pricing Fixes (2026-01-19)

### What Was Fixed

| Issue | Severity | Root Cause | Fix |
|-------|----------|------------|-----|
| Emergency sell stuck "In Progress" | **P0** | Code checked `status !== 'OPEN'` but DB uses `'ACTIVE'` | Changed all status checks to 'ACTIVE' |
| Price fetching failures | **P1** | pump.fun API blocked (530), was only fallback | Added DEXScreener as second fallback |
| Entry cost wrong (future buys) | **P1** | Executor returned requested amount, not actual spend | Added balance measurement before/after |

### Commits (This Session)
- `82e2625` - fix(bot): emergency sell and pricing reliability

### Files Changed
- `apps/bot/src/handlers/positionsHandler.ts` - status checks
- `apps/bot/src/ui/panels/positionDetail.ts` - status type and checks
- `apps/bot/src/commands/positions.ts` - status check
- `packages/shared/src/types.ts` - PositionStatus type: 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED'
- `packages/shared/src/pricing.ts` - DEXScreener fallback (v4.5)
- `apps/executor/src/chains/solana/solanaExecutor.ts` - `getSolBalance()` + `actualSolSpent` capture

### Data Fixes (SQL)
- Updated 4 existing positions with correct entry costs (~0.017 SOL instead of 0.1 SOL)
- Fixed token symbols: Unknown → HODL, Watcher, REDBULL

---

## Previous: Position Tracking Data Quality (2026-01-19)

### What Was Fixed

| Issue | Severity | Fix |
|-------|----------|-----|
| Entry cost shows reserved budget (0.1 SOL) instead of actual (~0.017) | **P0** | Added `amountIn` to TradeResult, use in position creation |
| Token symbol "Unknown" | **P1** | Save symbol from metadata to opportunity |
| PnL shows 0.00% | **P1** | Created hybrid pricing module (Jupiter + pump.fun) |

### Key Files
- `apps/hunter/src/loops/execution.ts` - `amountIn` mapping
- `packages/shared/src/pricing.ts` - NEW: Hybrid price fetching

---

## Deployment Status

- **Database**: Migrations 014-018 applied
- **Bot**: v86 - Emergency sell + pricing fixes
- **Hunter**: v95 - Position tracking fixes
- **Executor**: v?? - Actual SOL spent capture
- **Feature Flags**:
  - `TPSL_ENGINE_ENABLED=true` (shadow mode)
  - `LEGACY_POSITION_MONITOR=true` (parallel operation)

Build Status: **PASSING**

Fly.io auto-deploys from GitHub pushes to `main`.

---

## Critical Patterns

### Position Status Values
**Database uses `'ACTIVE'` for open positions**, not `'OPEN'`.

```typescript
// Correct status checks
if (position.status === 'ACTIVE') { /* open position */ }
if (position.status !== 'ACTIVE') { /* closing or closed */ }

// PositionStatus type
type PositionStatus = 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED';
```

### Pricing Fallback Chain
```typescript
// packages/shared/src/pricing.ts - v4.5
// 1. Jupiter batch API (primary)
// 2. DEXScreener API (secondary - more reliable)
// 3. pump.fun API (tertiary - may be blocked)
// 4. Return { price: 0, source: 'none' } if all fail
```

### Position ID Standard
**Always use `uuid_id` (UUID) for position operations**, not the integer `id` column.

```typescript
const position = await createPositionV31({ ... });
const positionId = position.uuid_id;  // Use this everywhere!
```

### Button Labels (No Emojis!)
```typescript
// WRONG - will throw assertNoEmoji error
btn('Speed ✓', CB.SETTINGS.SET_SNIPE_MODE_SPEED)

// RIGHT - use text indicators
btn('[x] Speed', CB.SETTINGS.SET_SNIPE_MODE_SPEED)
```

---

## Next Steps

### P0 - Critical
- [ ] **pump.pro bonding curve support**: `deriveBondingCurvePDA` only checks pump.fun program
  - When lookup fails, defaults to `graduated=true` → routes to Jupiter → fails

### P1 - Important
- [ ] **Max positions setting**: User wants 5 positions instead of 2
- [ ] **Background price polling**: For scale (1000+ users)

---

## Quick Commands

```bash
# Build and lint
pnpm -w lint && pnpm -w build

# Check git status
git status && git diff --stat

# View recent commits
git log --oneline -10

# Check Fly.io logs
fly logs -a raptor-bot
fly logs -a raptor-hunter
```
