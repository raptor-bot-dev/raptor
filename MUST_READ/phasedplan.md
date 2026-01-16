# RAPTOR v3 Complete Redesign - Phased Implementation Plan

**Created:** 2026-01-16
**Status:** Planning
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

## Phase 0: Foundation & Panel Kit

**Duration:** Day 1

### 0.1 Create Panel Rendering System
**New file:** `apps/bot/src/ui/panelKit.ts`

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
**New file:** `apps/bot/src/ui/callbackIds.ts`

Centralized callback IDs per PROMPT.md specification:
- `home:*` - Home navigation
- `hunt:*` - Arm/disarm autohunt
- `settings:*` - Settings edits
- `positions:*`, `position:*` - Position management
- `withdraw:*` - Withdrawal flow
- `help:*` - Help panel

### 0.3 Verification Checklist
- [ ] `pnpm -w build` passes
- [ ] Panel kit exports all required functions
- [ ] No emoji in test button labels

---

## Phase 1: Core Panel Implementations

**Duration:** Days 1-2

### 1.1 HOME Panel
**File:** `apps/bot/src/ui/panels/home.ts`

Content:
- Wallet list with balances (code + joiner)
- Autohunt status (Armed/Disarmed)
- Open positions count (n / 2)
- Trade stats (total, wins, losses)
- Realized PnL (SOL + %)

Buttons: `[Arm/Disarm, Positions] [Withdraw, Settings] [Help, Refresh]`

### 1.2 SETTINGS Panel
**File:** `apps/bot/src/ui/panels/settings.ts`

Fields: Trade Size, Max Positions (1-2), TP%, SL%, Max Buys/Hr, Slippage bps

### 1.3 ARM/DISARM Confirm Panels
**File:** `apps/bot/src/ui/panels/hunt.ts`

### 1.4 POSITIONS List Panel
**File:** `apps/bot/src/ui/panels/positions.ts`

Per position: symbol, mint, entry SOL, MC, PnL%
Buttons per position: `[i Details, i Emergency Sell, i Chart]`

### 1.5 POSITION Details Panel
**File:** `apps/bot/src/ui/panels/positionDetail.ts`

### 1.6 EMERGENCY SELL Confirm Panel
**File:** `apps/bot/src/ui/panels/emergencySell.ts`

### 1.7 WITHDRAW Panels
**File:** `apps/bot/src/ui/panels/withdraw.ts`

Screens: Home, SOL input, % input, Confirm

### 1.8 HELP Panel
**File:** `apps/bot/src/ui/panels/help.ts`

### 1.9 Verification Checklist
- [ ] All panels render with correct HTML
- [ ] No emoji on any button labels
- [ ] Width pad displays correctly
- [ ] Joiners only one level deep

---

## Phase 2: Notification Panels

**Duration:** Day 2

### 2.1 HUNT EXECUTED
**File:** `apps/bot/src/ui/notifications/huntExecuted.ts`

Content: Token, mint, entry price + MC, bought SOL + tokens, TX link
Buttons: `[Chart, Emergency Sell, View TX]`

### 2.2 HUNT CLOSED
**File:** `apps/bot/src/ui/notifications/huntClosed.ts`

Content: Entry/exit prices + MC, received SOL, PnL
Buttons: `[View TX, Positions, Home]`

### 2.3 HUNT SKIPPED
**File:** `apps/bot/src/ui/notifications/huntSkipped.ts`

### 2.4 EXECUTION FAILED
**File:** `apps/bot/src/ui/notifications/executionFailed.ts`

### 2.5 Verification Checklist
- [ ] Notifications render correctly
- [ ] TX links go to Solscan
- [ ] Chart links go to Dexscreener

---

## Phase 3: Callback Router Rewrite

**Duration:** Days 2-3

### 3.1 Create New Callback Router
**File:** `apps/bot/src/handlers/callbackRouter.ts`

Route by prefix to dedicated handlers.

### 3.2 Implement Handler Modules
**Files:**
- `apps/bot/src/handlers/home.ts`
- `apps/bot/src/handlers/hunt.ts`
- `apps/bot/src/handlers/settings.ts`
- `apps/bot/src/handlers/positions.ts`
- `apps/bot/src/handlers/withdraw.ts`
- `apps/bot/src/handlers/help.ts`

### 3.3 Session State Management
**File:** `apps/bot/src/handlers/sessionSteps.ts`

Keep only: trade_size, tp, sl, max_buys, slippage, withdrawal flows

### 3.4 Verification Checklist
- [ ] All new callbacks route correctly
- [ ] Session flows work end-to-end
- [ ] No dangling callback IDs

---

## Phase 4: Remove Legacy Features

**Duration:** Day 3

### 4.1 Disable Manual Buyer
**Files to modify:**
- `apps/bot/src/handlers/callbacks.ts` - Remove `buy_sol_*` handlers
- `apps/bot/src/handlers/buy.ts` - Remove manual buy logic
- `apps/bot/src/handlers/messages.ts` - Remove manual session steps
- `apps/bot/src/utils/keyboards.ts` - Remove buy keyboards

### 4.2 Remove /deposit Command
**Files to modify:**
- `apps/bot/src/commands/deposit.ts` - Return disabled message
- `apps/bot/src/handlers/callbacks.ts` - Remove `wallet_deposit_*`

### 4.3 Remove Pool/Solo/Snipe Mode Selection
Single wallet flow only.

### 4.4 Remove Trade Monitor (Live PnL)
Positions panel is sufficient.

### 4.5 Cleanup Legacy Callbacks
Remove: `confirm_sell:*`, `sell:*`, `snipe_*`, `analyze_sol_*`

### 4.6 Verification Checklist
- [ ] Manual buy returns disabled message
- [ ] /deposit returns disabled message
- [ ] No dead buttons in UI
- [ ] Build passes

---

## Phase 5: Withdraw Math Correctness

**Duration:** Days 3-4

### 5.1 Implement Withdraw Validation
**File:** `apps/bot/src/services/withdrawService.ts`

```typescript
const BUFFER_SOL = 0.01;

// SOL: validate 0 < x <= maxWithdraw
// %: validate 1 <= p <= 100
// Lamports: floor((balance - buffer) * p / 100)
```

### 5.2 Confirm Panel with Computed Values
Show: To, Amount, Est fees, Approx receive

### 5.3 Re-check Balance Before Send
Fresh balance fetch immediately before transaction.

### 5.4 Unit Tests
**File:** `apps/bot/src/__tests__/withdrawService.test.ts`

### 5.5 Verification Checklist
- [ ] Withdraw SOL validates correctly
- [ ] Withdraw % validates correctly
- [ ] Balance re-checked before send
- [ ] Unit tests pass

---

## Phase 6: PnL Correctness

**Duration:** Day 4

### 6.1 Compute Realized PnL Only
**File:** `apps/bot/src/services/pnlService.ts`

```typescript
// Sum closed positions: pnlSol = sum(exit - entry)
// pnlPercent = pnlSol / sum(entry) * 100
```

### 6.2 Trade Stats
```typescript
// wins = closed positions with pnl > 0
// losses = closed positions with pnl < 0
```

### 6.3 Remove Fake/Placeholder PnL
Omit PnL if unavailable, never show placeholder.

### 6.4 Verification Checklist
- [ ] Home panel shows correct realized PnL
- [ ] No fake values anywhere

---

## Phase 7: Emergency Sell Implementation

**Duration:** Day 4

### 7.1 Idempotent Emergency Sell
**File:** `apps/bot/src/handlers/positions.ts`

Key: `sell:{positionId}:emergency`
Lock position, set CLOSING_EMERGENCY, sell token balance.

### 7.2 Handle Both Token Standards
Support SPL Token and Token-2022.

### 7.3 Verification Checklist
- [ ] Emergency sell is idempotent
- [ ] Position locks correctly
- [ ] Both token standards work

---

## Phase 8: Backend & Supabase Cleanup

**Duration:** Day 5

### 8.1 Database Schema Cleanup
Using Supabase MCP tools:

**Tables to review:**
- `user_balances` - Check if legacy
- `trades` - Check if v3.1 executions replaces
- `deposit_addresses` - Remove if /deposit removed

### 8.2 Remove Unused Functions
**File:** `packages/shared/src/supabase.ts`

Review: `getOrCreateDepositAddress()`, `getUserBalancesByMode()`

### 8.3 Add Missing Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_positions_user_status ON positions(user_id, status);
```

### 8.4 Verification Checklist
- [ ] No orphaned records
- [ ] Unused tables identified
- [ ] Indexes optimized

---

## Phase 9: Edge Functions

**Duration:** Days 5-6

### 9.1 Notification Delivery Function
**File:** `supabase/functions/deliver-notifications/index.ts`

### 9.2 Stale Execution Cleanup
**File:** `supabase/functions/cleanup-executions/index.ts`

### 9.3 Monitor TTL Expiration
**File:** `supabase/functions/expire-monitors/index.ts`

### 9.4 Verification Checklist
- [ ] Edge functions deploy successfully
- [ ] Cron schedules work
- [ ] Logs show execution

---

## Phase 10: Integration & Testing

**Duration:** Day 6

### 10.1 Build Verification
```bash
pnpm -w install
pnpm -w lint
pnpm -w build
```

### 10.2 Smoke Test Checklist
- [ ] `/start` → Home panel renders wide
- [ ] Wallet addresses are monospace and copyable
- [ ] Buttons have no emojis
- [ ] Arm/Disarm flow works
- [ ] Settings edit and persist
- [ ] Positions list renders
- [ ] Position details render
- [ ] Emergency sell confirm works
- [ ] Withdraw SOL validates correctly
- [ ] Withdraw % validates correctly
- [ ] HUNT EXECUTED notification renders
- [ ] HUNT CLOSED notification renders
- [ ] TX and Chart links work

---

## Phase 11: Documentation & Commit

**Duration:** Day 6

### 11.1 Update Changelog
Add entries for all changes.

### 11.2 Update Project Status
Mark Phase A as complete.

### 11.3 Commit Messages
```
refactor(bot): simplify UI to autohunt-only terminal panels
feat(bot): emergency sell + chart links
fix(withdraw): add custom SOL/% withdrawal validation
chore(ui): add HTML panel renderer + width pad
```

---

## File Summary

### New Files to Create
```
apps/bot/src/ui/
├── panelKit.ts
├── callbackIds.ts
├── panels/
│   ├── home.ts
│   ├── settings.ts
│   ├── hunt.ts
│   ├── positions.ts
│   ├── positionDetail.ts
│   ├── emergencySell.ts
│   ├── withdraw.ts
│   └── help.ts
└── notifications/
    ├── huntExecuted.ts
    ├── huntClosed.ts
    ├── huntSkipped.ts
    └── executionFailed.ts

apps/bot/src/handlers/
├── callbackRouter.ts
├── home.ts
├── hunt.ts
├── settings.ts
├── positions.ts
├── withdraw.ts
└── help.ts

apps/bot/src/services/
├── withdrawService.ts
└── pnlService.ts

supabase/functions/
├── deliver-notifications/index.ts
├── cleanup-executions/index.ts
└── expire-monitors/index.ts
```

### Files to Modify
```
apps/bot/src/handlers/callbacks.ts
apps/bot/src/handlers/messages.ts
apps/bot/src/utils/keyboards.ts
apps/bot/src/commands/deposit.ts
apps/bot/src/index.ts
packages/shared/src/supabase.ts
```

---

## Success Criteria

- [ ] `pnpm -w lint && pnpm -w test && pnpm -w build` passes
- [ ] All panels render with correct HTML formatting
- [ ] No emoji on any button labels
- [ ] Width pad makes bubbles wide on mobile
- [ ] Withdraw math is validated and tested
- [ ] PnL shows only realized values
- [ ] Emergency sell is idempotent
- [ ] Manual buyer callbacks disabled
- [ ] /deposit disabled
- [ ] Edge functions deployed
- [ ] Changelog updated

---

## Key Decisions (Confirmed)

1. **Legacy Data**: Hard reset - no migration needed, fresh start
2. **Edge Functions**: Include now - implement all three functions
3. **Rollout Strategy**: Big-bang switch - replace old UI completely

## Risk Mitigation

1. **No Feature Flags Needed**: Big-bang switch simplifies deployment
2. **Database**: Can safely remove unused tables (no legacy data concerns)
3. **Rollback Plan**: Tag git before changes, can revert if critical issues
4. **Testing**: Thorough smoke test before deployment

---

## Timeline

| Phase | Duration | Focus |
|-------|----------|-------|
| 0 | Day 1 | Foundation & Panel Kit |
| 1 | Days 1-2 | Core Panels |
| 2 | Day 2 | Notifications |
| 3 | Days 2-3 | Callback Router |
| 4 | Day 3 | Remove Legacy |
| 5 | Days 3-4 | Withdraw Math |
| 6 | Day 4 | PnL Correctness |
| 7 | Day 4 | Emergency Sell |
| 8 | Day 5 | Backend Cleanup |
| 9 | Days 5-6 | Edge Functions |
| 10 | Day 6 | Testing |
| 11 | Day 6 | Documentation |

**Total Estimated Duration:** 6 days
