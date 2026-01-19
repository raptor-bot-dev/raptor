# Retro: Emergency Sell and Pricing Reliability

**Date:** 2026-01-19
**Session:** Emergency sell bug + pricing fallback fixes
**Commits:**
- `82e2625` - fix(bot): emergency sell and pricing reliability

---

## Context

User reported two issues after position tracking fixes were deployed:
1. Emergency sell stuck on "Processing" and never completes
2. Positions panel shows old data and price fetch errors

## What We Fixed

### 1. Emergency Sell Status Mismatch

**Problem:** Emergency sell always showed "An emergency sell is already in progress" even for positions that had never attempted emergency sell.

**Root Cause:** The code checked `position.status !== 'OPEN'` but the database uses `'ACTIVE'` for open positions. Since `'ACTIVE' !== 'OPEN'` is always true, every position failed the check.

**Files with wrong status:**
- `apps/bot/src/handlers/positionsHandler.ts` (lines 163, 191, 230)
- `apps/bot/src/ui/panels/positionDetail.ts` (lines 26, 91, 121)
- `apps/bot/src/commands/positions.ts` (line 115)
- `packages/shared/src/types.ts` (line 35) - type definition

**Fix:** Changed all occurrences from `'OPEN'` to `'ACTIVE'`.

**Type definition update:**
```typescript
// Before
type PositionStatus = 'OPEN' | 'CLOSING' | 'CLOSED';

// After
type PositionStatus = 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED';
```

### 2. Price Fetching Failures

**Problem:** PnL displayed as 0.00% even though positions should have gains/losses.

**Root Cause:** pump.fun API returning HTTP 530 (Cloudflare blocked). The pricing module only had pump.fun as fallback after Jupiter.

**Original fallback chain:**
1. Jupiter API (primary)
2. pump.fun API (fallback) - **BLOCKED**
3. Return 0

**Fix:** Added DEXScreener as second fallback:
1. Jupiter API (primary)
2. **DEXScreener API (new)** - more reliable
3. pump.fun API (tertiary)
4. Return 0

DEXScreener was already integrated in the codebase for token data, so adding it to pricing was straightforward.

### 3. Entry Cost Capture (Executor)

**Problem:** Future positions would still have wrong entry costs because executor returned requested amount, not actual spend.

**Root Cause:** pump.fun bonding curve uses less SOL than requested. The executor was returning `solAmount` (input) instead of measuring actual spend.

**Fix:** Added balance measurement before/after buy:
```typescript
// Before buy
const balanceBefore = await this.getSolBalance(walletAddress);

// Execute buy
const result = await client.buy({...});

// After buy
const balanceAfter = await this.getSolBalance(walletAddress);
const actualSolSpent = lamportsToSol(balanceBefore - balanceAfter);
```

### 4. Existing Position Data (SQL)

**Problem:** 4 existing positions had wrong entry costs (0.1 SOL instead of ~0.017 SOL) and wrong token symbols.

**Fix:** Queried blockchain for actual transaction balances and updated via SQL:
- PUMP: 0.016973511 SOL
- REDBULL: 0.016973611 SOL
- Watcher: 0.016973 SOL
- HODL: 0.016973 SOL

Token symbols fixed using DEXScreener API:
- Unknown → HODL
- Unknown → Watcher
- Unknown → REDBULL

## Investigation Process

1. **Checked database** - Positions had correct data (from earlier session fix)
2. **Checked deployed code** - Still had old values, not redeployed
3. **Found status mismatch** - Database query showed `status='ACTIVE'`, code checked for `'OPEN'`
4. **Traced pricing failure** - Fly.io logs showed repeated `[PumpFun] API error: 530`
5. **Added DEXScreener fallback** - Already had integration, just needed to add to pricing module

## What Went Well

- Quick diagnosis via database vs code comparison
- DEXScreener integration was already in codebase
- Build passed first try after type fixes
- User's data already correct in DB (from earlier session)

## What Could Be Improved

- Status value mismatch (`OPEN` vs `ACTIVE`) existed across multiple files since initial implementation
- Should have caught when `PositionStatus` type was first defined
- pump.fun API unreliability is a recurring issue - need more defensive design
- Type system didn't catch the mismatch because status was cast `as PositionStatus`

## Lessons Learned

1. **Database schema is source of truth** - When types disagree with DB, fix the types
2. **Multiple fallbacks for external APIs** - DEXScreener more reliable than pump.fun
3. **Measure actual outcomes** - Don't trust input values, measure actual wallet changes
4. **Test with real data** - Would have caught status mismatch if tested emergency sell

## Files Changed

| File | Changes |
|------|---------|
| `apps/bot/src/handlers/positionsHandler.ts` | Status checks `'OPEN'` → `'ACTIVE'` |
| `apps/bot/src/ui/panels/positionDetail.ts` | Type + status checks |
| `apps/bot/src/commands/positions.ts` | Status check |
| `packages/shared/src/types.ts` | `PositionStatus` type definition |
| `packages/shared/src/pricing.ts` | DEXScreener fallback (v4.5) |
| `apps/executor/src/chains/solana/solanaExecutor.ts` | `getSolBalance()` + `actualSolSpent` |

## Follow-up Items

- [x] Fix existing positions via SQL
- [x] Fix token symbols via DEXScreener API
- [ ] pump.pro bonding curve derivation (P0)
- [ ] Increase max_positions to 5 (P1)
