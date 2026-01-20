# RAPTOR v3 Context - Resume Point

**Date:** 2026-01-20
**Branch:** `main`
**Status:** Token-2022 ATA Detection Fix (v136) - DEPLOYED, PENDING VERIFICATION

---

## Latest: Token-2022 ATA Detection Fix (2026-01-20 - v136)

### The Problem
Emergency sell returned `PREFLIGHT_ZERO_BALANCE` despite wallet holding tokens. User confirmed: "the wallets still hold the tokens so our infrastructure is wrong."

### Root Cause (THE REAL FIX)
`getTokenBalanceRaw()` in `solanaExecutor.ts` was deriving ATAs using standard SPL token program, but pump.fun tokens use **Token-2022** which derives ATAs at **different addresses**.

```typescript
// BEFORE (WRONG): Used default token program (standard SPL)
const ata = await getAssociatedTokenAddress(mint, wallet);

// AFTER (FIXED): Detect and use correct token program
const tokenProgramId = await getTokenProgramForMint(this.connection, mint);
const ata = await getAssociatedTokenAddress(mint, wallet, false, tokenProgramId);
```

Result: Function was checking wrong ATA (0 balance) while real Token-2022 ATA had tokens.

### Commits (This Session)
- `c4a1f50` - fix(executor): detect Token-2022 program for correct ATA in getTokenBalanceRaw
- `1e24662` - fix(deploy): correct dockerfile path in fly.toml

### Files Changed
- `apps/executor/src/chains/solana/solanaExecutor.ts` - getTokenBalanceRaw() Token-2022 fix
- `apps/bot/fly.toml` - dockerfile path `../../Dockerfile.bot` for local deploy
- `apps/bot/src/services/emergencySellService.ts` - sellPercent: 100 option
- `apps/hunter/src/loops/execution.ts` - sellPercent option
- `retros/2026-01-20-retro.md` - NEW: full session retrospective

### Deployment History (This Session)
| Version | Changes | Result |
|---------|---------|--------|
| v134 | sellPercent option + preflight checks | `PREFLIGHT_ZERO_BALANCE` (wrong ATA) |
| v135 | Fly.io autostop fix | Bot stayed running |
| v136 | Token-2022 ATA detection | **PENDING VERIFICATION** |

---

## Previous Issues Fixed (This Session)

### Issue 1: Fly.io Bot Not Autostarting
- Machine had old config (`autostop: true`, `min_machines_running: 0`)
- fly.toml was correct but machine retained old settings
- Fixed by redeploying with `flyctl deploy` to apply new config
- Also fixed dockerfile path: `../../Dockerfile.bot` (relative to fly.toml)

### Issue 2: Initial Misdiagnosis (10x Token Amount)
- First thought: decimal multiplication bug causing 10x amount
- Added `sellPercent` option to use fresh balance from chain
- This showed `PREFLIGHT_ZERO_BALANCE` which led to the REAL fix

---

## Deployment Status

- **Database**: Migrations 014-019 applied
- **Bot**: v136 - Token-2022 ATA detection fix
- **Hunter**: v113 - N/A (doesn't execute sells)
- **Feature Flags**:
  - `TPSL_ENGINE_ENABLED=true` (shadow mode)
  - `LEGACY_POSITION_MONITOR=true` (parallel operation)

Build Status: **PASSING**

Fly.io auto-deploys from GitHub pushes to `main`.

---

## Critical Patterns

### Token-2022 ATA Detection (NEW - CRITICAL)
**Always detect token program when deriving ATAs for pump.fun tokens.**

```typescript
// In pumpFun.ts
export async function getTokenProgramForMint(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const mintInfo = await connection.getAccountInfo(mint);
  if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return TOKEN_2022_PROGRAM_ID;
  }
  return TOKEN_PROGRAM_ID;
}

// When deriving ATAs
const tokenProgramId = await getTokenProgramForMint(connection, mint);
const ata = await getAssociatedTokenAddress(mint, wallet, false, tokenProgramId);
```

### Position Status Values
**Database uses `'ACTIVE'` for open positions**, not `'OPEN'`.

```typescript
// Correct status checks
if (position.status === 'ACTIVE') { /* open position */ }
type PositionStatus = 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED';
```

### Pricing Fallback Chain
```typescript
// packages/shared/src/pricing.ts - v4.5
// 1. Jupiter batch API (primary)
// 2. DEXScreener API (secondary - more reliable)
// 3. pump.fun API (tertiary - may be blocked)
```

### Position ID Standard
**Always use `uuid_id` (UUID) for position operations**, not the integer `id` column.

### Button Labels (No Emojis!)
```typescript
// WRONG - will throw assertNoEmoji error
btn('Speed ✓', CB.SETTINGS.SET_SNIPE_MODE_SPEED)
// RIGHT - use text indicators
btn('[x] Speed', CB.SETTINGS.SET_SNIPE_MODE_SPEED)
```

---

## Next Steps (Priority Order)

### P0 - Critical (Must Complete)
1. **Verify Emergency Sell Fix (v136)**
   - Test on one of 4 active positions (PUMP, REDBULL, Watcher, HODL)
   - Watch logs for: `getTokenBalanceRaw: ... tokenProgram=Token-2022, ata=...`
   - Verify sell transaction confirms on Solscan
2. **Close Remaining Positions** - If emergency sell works, close all 4

### P1 - Important
3. **Test Autohunt End-to-End** - Full cycle with emergency sell
4. **Max Positions Setting** - User requested 5 instead of 2

### P2 - Nice to Have
5. **Integration Test for Token-2022 ATA** - Prevent regression
6. **Integration Test for Fee Recipient** - Mode-aware resolution

---

## Active Positions (Need Emergency Sell Test)

| ID | Mint | Symbol |
|----|------|--------|
| 5 | Ahte7zvpjbroToRRoA3MzvuDz6XGFgvWrBPGj1hfpump | PUMP |
| 6 | BDVhcvNs7PZzfJvoekLvxyR5i9BUT5emwbRhfyU6pump | REDBULL |
| 7 | 2BVSFGaxPFNPoX1z4orquizM97v4jrxc4XDANQdQpump | Watcher |
| 8 | HnbVCGDftjvVxpVPBMYj5Xh8WbARiP4hnFiFfKANqEQx | HODL |

---

## Quick Commands

```bash
# Build and lint
pnpm -w lint && pnpm -w build

# Check git status
git status && git diff --stat

# View recent commits
git log --oneline -10

# Check Fly.io status
fly status -a raptor-bot
fly releases -a raptor-bot
fly logs -a raptor-bot
```

---

## Key Files for Token-2022 ATA Fix

| Purpose | File | Function |
|---------|------|----------|
| Token program detection | `apps/executor/src/chains/solana/pumpFun.ts` | `getTokenProgramForMint()` |
| Balance check | `apps/executor/src/chains/solana/solanaExecutor.ts` | `getTokenBalanceRaw()` |
| Emergency sell | `apps/bot/src/services/emergencySellService.ts` | `executeEmergencySell()` |
| Preflight check | `apps/executor/src/chains/solana/solanaExecutor.ts` | `executeSellWithKeypair()` |

---

## Debug Logs to Watch For

```
[SolanaExecutor] getTokenBalanceRaw: mint=..., wallet=..., tokenProgram=Token-2022, ata=...
[SolanaExecutor] Token balance: X (Y.YY)
```

If these show correct token program and non-zero balance, the fix is working.
