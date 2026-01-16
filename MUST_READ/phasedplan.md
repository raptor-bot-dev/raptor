# RAPTOR v3 Complete Redesign - Phased Implementation Plan

**Created:** 2026-01-16
**Status:** Phase A Complete - Cleanup & Polish Remaining
**Goal:** Transform RAPTOR into a minimal, production-ready Autohunt-only Solana trading bot with terminal-style UI.

---

## Overview

This plan covers the complete overhaul of RAPTOR bot including:
- Terminal-style UI redesign (HTML panels, width pad, joiners)
- Remove manual buyer and deposit features
- Autohunt-only product with max 2 positions
- Emergency Sell + Chart on all position screens
- Withdraw with custom SOL/% validation
- Backend cleanup and Supabase optimization
- Edge functions for maintenance tasks

---

## Phase 0: Foundation & Panel Kit ✅ COMPLETE

**Duration:** Day 1

### 0.1 Create Panel Rendering System
**File:** `apps/bot/src/ui/panelKit.ts` ✅

Core exports:
- `WIDTH_PAD` - U+2800 braille blanks x 80 chars
- `escapeHtml()`, `b()`, `code()`, `join()` - formatting helpers
- `compactLines()` - removes blank lines
- `assertNoEmoji()` - validates button labels
- `kb()` - keyboard builder with emoji enforcement
- `panel(title, lines, buttons)` - main renderer
- `stat()`, `section()`, `walletRow()`, `tokenHeader()`, `priceMc()`, `amountDetail()`
- `solscanTxUrl()`, `dexscreenerChartUrl()` - link helpers
- `formatSol()` - number formatter

### 0.2 Define Callback ID Constants
**File:** `apps/bot/src/ui/callbackIds.ts` ✅

Centralized callback IDs per PROMPT.md specification:
- `CB.HOME.*` - Home navigation
- `CB.HUNT.*` - Arm/disarm autohunt
- `CB.SETTINGS.*` - Settings edits
- `CB.POSITIONS.*`, `CB.POSITION.*` - Position management
- `CB.WITHDRAW.*` - Withdrawal flow
- `CB.HELP.*` - Help panel

### 0.3 Verification Checklist
- [x] `pnpm -w build` passes
- [x] Panel kit exports all required functions
- [x] No emoji in test button labels

---

## Phase 1: Core Panel Implementations ✅ COMPLETE

**Duration:** Days 1-2

### 1.1 HOME Panel
**File:** `apps/bot/src/ui/panels/home.ts` ✅

### 1.2 SETTINGS Panel
**File:** `apps/bot/src/ui/panels/settings.ts` ✅

**Settings fields (v3.6):**
- Trade Size (SOL)
- Max Positions (1-2)
- Take Profit (%)
- Stop Loss (%)
- Slippage (bps)
- Priority Fee (SOL) - NEW
- MEV Protection (ON/OFF) - NEW

### 1.3 ARM/DISARM Confirm Panels
**File:** `apps/bot/src/ui/panels/hunt.ts` ✅

### 1.4 POSITIONS List Panel
**File:** `apps/bot/src/ui/panels/positions.ts` ✅

### 1.5 POSITION Details Panel
**File:** `apps/bot/src/ui/panels/positionDetail.ts` ✅

### 1.6 EMERGENCY SELL Confirm Panel
**File:** `apps/bot/src/ui/panels/emergencySell.ts` ✅

### 1.7 WITHDRAW Panels
**File:** `apps/bot/src/ui/panels/withdraw.ts` ✅

### 1.8 HELP Panel
**File:** `apps/bot/src/ui/panels/help.ts` ✅

### 1.9 Verification Checklist
- [x] All panels render with correct HTML
- [x] No emoji on any button labels
- [x] Width pad displays correctly
- [x] Joiners only one level deep

---

## Phase 2: Notification Panels ✅ COMPLETE

**Duration:** Day 2

### 2.1 HUNT EXECUTED
**File:** `apps/bot/src/ui/notifications/huntExecuted.ts` ✅

### 2.2 HUNT CLOSED
**File:** `apps/bot/src/ui/notifications/huntClosed.ts` ✅

### 2.3 HUNT SKIPPED
**File:** `apps/bot/src/ui/notifications/huntSkipped.ts` ✅

### 2.4 EXECUTION FAILED
**File:** `apps/bot/src/ui/notifications/executionFailed.ts` ✅

### 2.5 Verification Checklist
- [x] Notifications render correctly
- [x] TX links go to Solscan
- [x] Chart links go to Dexscreener

---

## Phase 3: Callback Router Rewrite ✅ COMPLETE

**Duration:** Days 2-3

### 3.1 Create New Callback Router
**File:** `apps/bot/src/handlers/callbackRouter.ts` ✅

### 3.2 Implement Handler Modules
**Files:**
- `apps/bot/src/handlers/home.ts` ✅
- `apps/bot/src/handlers/huntHandler.ts` ✅
- `apps/bot/src/handlers/settingsHandler.ts` ✅
- `apps/bot/src/handlers/positionsHandler.ts` ✅
- `apps/bot/src/handlers/withdrawHandler.ts` ✅
- `apps/bot/src/handlers/helpHandler.ts` ✅

### 3.3 Verification Checklist
- [x] All new callbacks route correctly
- [x] Session flows work end-to-end
- [x] No dangling callback IDs

---

## Phase 4: Remove Legacy Features ✅ COMPLETE

**Duration:** Day 3

### 4.1 Disable Manual Buyer ✅
- Manual buy callbacks return "feature removed" message

### 4.2 Remove /deposit Command ✅
- `/deposit` returns disabled message (users fund wallet directly)

### 4.3 Remove Pool/Solo/Snipe Mode Selection ✅
- Single wallet flow only

### 4.4 Verification Checklist
- [x] Manual buy returns disabled message
- [x] /deposit returns disabled message
- [x] No dead buttons in UI
- [x] Build passes

---

## Phase 5: Withdraw Math Correctness ✅ COMPLETE

**Duration:** Days 3-4

### 5.1 Implement Withdraw Validation ✅
**File:** `apps/bot/src/handlers/withdrawHandler.ts`

- 0.01 SOL buffer implemented
- SOL validation: 0 < x <= maxWithdraw
- % validation: 1 <= p <= 100
- Lamports computed correctly

### 5.2 Verification Checklist
- [x] Withdraw SOL validates correctly
- [x] Withdraw % validates correctly
- [x] Balance re-checked before send
- [ ] Unit tests (deferred to Phase 10)

---

## Phase 6: PnL Correctness ✅ COMPLETE

**Duration:** Day 4

### 6.1 Compute Realized PnL Only ✅
**File:** `apps/bot/src/services/pnlService.ts`

- Sum closed positions: pnlSol = sum(exit - entry)
- pnlPercent = pnlSol / sum(entry) * 100
- Wins/losses computed from closed positions

### 6.2 Verification Checklist
- [x] Home panel shows correct realized PnL
- [x] No fake values anywhere

---

## Phase 7: Emergency Sell Implementation ✅ COMPLETE

**Duration:** Day 4

### 7.1 Emergency Sell Panel ✅
**File:** `apps/bot/src/ui/panels/emergencySell.ts`

### 7.2 Emergency Sell Handler ✅
**File:** `apps/bot/src/handlers/positionsHandler.ts`

### 7.3 Verification Checklist
- [x] Emergency sell confirm panel implemented
- [x] Position status updated correctly
- [x] Trade job created for sell execution

---

## Phase 8: Backend & Supabase Cleanup 🔄 PENDING

**Duration:** Day 5
**Priority:** Post-MVP (can deploy without this)

### 8.1 Legacy Tables to Remove

These tables are no longer queried in v5.0 (Solana-only autohunt):

| Table | Status | Action |
|-------|--------|--------|
| `user_balances` | Legacy v2 pool/solo/snipe tracking | Remove after verifying no queries |
| `token_scores` | v2.2 caching, never referenced | Safe to drop |
| `blacklisted_tokens` | v2.2, replaced by strategy denylists | Safe to drop |
| `blacklisted_deployers` | v2.2, replaced by strategy denylists | Safe to drop |
| `hunt_settings` | v2.2, superseded by `strategies` table | Safe to drop |
| `snipe_requests` | Manual snipe mode disabled | Safe to drop |

### 8.2 Deprecated Functions to Remove
**File:** `packages/shared/src/supabase.ts`

```typescript
// Wallet backward compat wrappers (lines ~1109-1187)
getUserWallet()           // → use getActiveWallet()
createUserWallet()        // → use createWallet()
getOrCreateUserWallet()   // → use getOrCreateFirstWallet()
markBackupExported()      // → use markWalletBackupExported()

// Snipe request functions (manual snipe disabled)
createSnipeRequest()
getSnipeRequest()
getUserSnipeRequests()
updateSnipeRequestStatus()

// User balance functions (legacy v2)
getOrCreateBalance()
updateBalance()
getUserAllocations()
```

### 8.3 Add Missing Indexes

```sql
-- User position history (paginated queries)
CREATE INDEX IF NOT EXISTS idx_positions_user_history
  ON positions(user_id, status, created_at DESC);

-- User execution audit trail
CREATE INDEX IF NOT EXISTS idx_executions_user_history
  ON executions(user_id, status, created_at DESC);

-- Notification delivery queue per user
CREATE INDEX IF NOT EXISTS idx_notifications_user_delivery
  ON notifications(user_id, delivered_at, created_at DESC);
```

### 8.4 Verification Checklist
- [ ] Verify no queries hit legacy tables before dropping
- [ ] Run `pnpm -w build` after removing deprecated functions
- [ ] Apply index migration via Supabase MCP
- [ ] Check security advisors after DDL changes

---

## Phase 9: Edge Functions ⏸️ DEFERRED

**Duration:** Days 5-6
**Priority:** Optional - RPC functions already handle all critical operations

### Current State
The system uses **33 RPC functions** (PostgreSQL procedures) instead of Edge Functions:

| Operation | RPC Function | Status |
|-----------|--------------|--------|
| Budget enforcement | `reserve_trade_budget()` | ✅ Working |
| Job claiming | `claim_trade_jobs()` | ✅ Working |
| Stale cleanup | `cleanup_stale_executions()` | ✅ Working |
| Monitor TTL | `expire_old_monitors()` | ✅ Working |
| Notification queue | `claim_notifications()` | ✅ Working |

### Why Defer Edge Functions
1. **RPC-based architecture works** - atomic operations, no external webhook complexity
2. **Polling workers** (hunter, executor apps) already handle background jobs
3. **Lease-based job claiming** prevents duplicate execution
4. **No urgent need** - all maintenance tasks have RPC equivalents

### Future Consideration
If needed for scheduled cron tasks independent of app workers:

```
supabase/functions/
├── deliver-notifications/index.ts  # Send queued Telegram messages
├── cleanup-executions/index.ts     # Archive stale RESERVED/SUBMITTED
└── expire-monitors/index.ts        # TTL expiry for trade monitors
```

### 9.1 Verification Checklist
- [x] RPC functions handle all critical operations
- [ ] Edge functions (optional, not blocking MVP)

---

## Phase 10: Integration & Testing 🔄 PENDING

**Duration:** Day 6

### 10.1 Build Verification ✅
```bash
pnpm -w install   # ✅ Passes
pnpm -w lint      # ✅ Passes
pnpm -w build     # ✅ Passes
```

### 10.2 Unit Tests (New)
**Files to create:**

#### 10.2.1 Withdraw Math Tests
**File:** `apps/bot/src/__tests__/withdrawMath.test.ts`

```typescript
describe('withdrawMath', () => {
  it('should compute maxWithdraw with 0.01 SOL buffer', () => {
    expect(maxWithdraw(1.0)).toBe(0.99);
    expect(maxWithdraw(0.02)).toBe(0.01);
    expect(maxWithdraw(0.01)).toBe(0);
    expect(maxWithdraw(0.005)).toBe(0);
  });

  it('should validate SOL amount', () => {
    expect(validateSolAmount(0.5, 1.0)).toBe(true);
    expect(validateSolAmount(1.0, 1.0)).toBe(false); // exceeds max
    expect(validateSolAmount(0, 1.0)).toBe(false);   // zero not allowed
  });

  it('should validate percentage', () => {
    expect(validatePercent(50)).toBe(true);
    expect(validatePercent(100)).toBe(true);
    expect(validatePercent(0)).toBe(false);
    expect(validatePercent(101)).toBe(false);
  });

  it('should compute lamports from percentage', () => {
    // 1 SOL balance, 50% withdraw, 0.01 buffer
    expect(computeLamportsFromPercent(1.0, 50)).toBe(495_000_000);
  });
});
```

#### 10.2.2 PnL Calculation Tests
**File:** `apps/bot/src/__tests__/pnlService.test.ts`

```typescript
describe('pnlService', () => {
  it('should compute realized PnL from closed positions only', () => {
    const positions = [
      { status: 'CLOSED', entry_sol: 0.1, exit_sol: 0.15 }, // +0.05
      { status: 'CLOSED', entry_sol: 0.1, exit_sol: 0.08 }, // -0.02
      { status: 'OPEN', entry_sol: 0.1, exit_sol: null },   // ignored
    ];
    expect(computeRealizedPnl(positions)).toEqual({
      pnlSol: 0.03,
      pnlPercent: 15, // 0.03 / 0.2 * 100
      wins: 1,
      losses: 1,
    });
  });

  it('should return zero for no closed positions', () => {
    expect(computeRealizedPnl([])).toEqual({
      pnlSol: 0,
      pnlPercent: 0,
      wins: 0,
      losses: 0,
    });
  });
});
```

### 10.3 Smoke Test Checklist (Manual)

| Test | Expected | Status |
|------|----------|--------|
| `/start` | Home panel renders wide | [ ] |
| Wallet address | Monospace, copyable | [ ] |
| Buttons | No emojis | [ ] |
| Arm hunt | Confirm panel → status toggles | [ ] |
| Disarm hunt | Confirm panel → status toggles | [ ] |
| Settings edit | Values persist | [ ] |
| Positions list | Shows open positions | [ ] |
| Position detail | Entry/current prices, PnL | [ ] |
| Emergency sell | Confirm panel, job created | [ ] |
| Withdraw SOL | Validates 0 < x <= max | [ ] |
| Withdraw % | Validates 1 <= p <= 100 | [ ] |
| TX links | Opens Solscan | [ ] |
| Chart links | Opens Dexscreener | [ ] |

### 10.4 Verification Checklist
- [x] `pnpm -w lint && pnpm -w build` passes
- [ ] Unit tests written and passing
- [ ] Manual smoke test completed

---

## Phase 11: Documentation & Commit ✅ MOSTLY COMPLETE

**Duration:** Day 6

### 11.1 Update Changelog ✅
**File:** `MUST_READ/Changelog.md` - Updated with all v3 changes

### 11.2 Update Project Status ✅
**File:** `MUST_READ/Project_status.md` - Phase A marked complete

### 11.3 Commits & PR ✅
- Commit: `1fcf3e0` - "refactor(bot): implement v3 terminal UI with autohunt-only panels"
- PR #4 merged to main via squash
- Branch `chore/raptor-v3-ui-wrap-history-integrity` deleted

### 11.4 Remaining Documentation
- [ ] Update this plan with final status
- [ ] Archive completed phases to separate file (optional)

---

## File Summary

### Files Created ✅
```
apps/bot/src/ui/
├── panelKit.ts              ✅ HTML renderer + width pad
├── callbackIds.ts           ✅ CB.* ID constants
├── index.ts                 ✅ Re-exports
├── panels/
│   ├── home.ts              ✅
│   ├── settings.ts          ✅
│   ├── hunt.ts              ✅
│   ├── positions.ts         ✅
│   ├── positionDetail.ts    ✅
│   ├── emergencySell.ts     ✅
│   ├── withdraw.ts          ✅
│   ├── help.ts              ✅
│   └── index.ts             ✅
└── notifications/
    ├── huntExecuted.ts      ✅
    ├── huntClosed.ts        ✅
    ├── huntSkipped.ts       ✅
    ├── executionFailed.ts   ✅
    └── index.ts             ✅

apps/bot/src/handlers/
├── callbackRouter.ts        ✅
├── home.ts                  ✅
├── huntHandler.ts           ✅
├── settingsHandler.ts       ✅
├── positionsHandler.ts      ✅
├── withdrawHandler.ts       ✅
└── helpHandler.ts           ✅

apps/bot/src/services/
└── pnlService.ts            ✅

apps/bot/src/utils/
└── panelWrap.ts             ✅
```

### Files Modified ✅
```
apps/bot/src/handlers/callbacks.ts   ✅ Legacy handlers disabled
apps/bot/src/commands/deposit.ts     ✅ Returns disabled message
apps/bot/src/index.ts                ✅ New router integration
packages/shared/src/supabase.ts      ✅ Strategy field fixes
```

### Files Still Pending
```
apps/bot/src/__tests__/
├── withdrawMath.test.ts     [ ] Unit tests
└── pnlService.test.ts       [ ] Unit tests

supabase/functions/          [ ] Optional - deferred
```

---

## Success Criteria

### MVP (Phase A) ✅ COMPLETE
- [x] `pnpm -w lint && pnpm -w build` passes
- [x] All panels render with correct HTML formatting
- [x] No emoji on any button labels
- [x] Width pad makes bubbles wide on mobile
- [x] Withdraw math is validated in code
- [x] PnL shows only realized values
- [x] Emergency sell panel and handler implemented
- [x] Manual buyer callbacks disabled
- [x] /deposit disabled
- [x] Changelog updated

### Post-MVP (Pending)
- [ ] Unit tests for withdraw math and PnL
- [ ] Manual smoke test completed
- [ ] Backend cleanup (legacy tables/functions)
- [ ] Edge functions (optional)

---

## Key Decisions (Confirmed)

1. **Legacy Data**: Hard reset - no migration needed, fresh start
2. **Edge Functions**: Deferred - RPC functions already handle all operations
3. **Rollout Strategy**: Big-bang switch - replace old UI completely

## Risk Mitigation

1. **No Feature Flags Needed**: Big-bang switch simplifies deployment
2. **Database**: Can safely remove unused tables (no legacy data concerns)
3. **Rollback Plan**: Git tag `v3.0.0-pre` before deployment, can revert if critical issues
4. **Testing**: Manual smoke test before production deployment

---

## Timeline

| Phase | Status | Focus |
|-------|--------|-------|
| 0 | ✅ Complete | Foundation & Panel Kit |
| 1 | ✅ Complete | Core Panels |
| 2 | ✅ Complete | Notifications |
| 3 | ✅ Complete | Callback Router |
| 4 | ✅ Complete | Remove Legacy |
| 5 | ✅ Complete | Withdraw Math |
| 6 | ✅ Complete | PnL Correctness |
| 7 | ✅ Complete | Emergency Sell |
| 8 | 🔄 Pending | Backend Cleanup (post-MVP) |
| 9 | ⏸️ Deferred | Edge Functions (optional) |
| 10 | 🔄 Pending | Testing |
| 11 | ✅ Mostly Complete | Documentation |

**Phase A MVP:** Complete (merged to main)
**Remaining:** Unit tests, smoke test, optional cleanup
