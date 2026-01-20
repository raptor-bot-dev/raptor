# TODO.md - Tomorrow's Tasks (2026-01-21)

## Overview

**Current State:** v136 deployed with Token-2022 ATA detection fix. This is the REAL fix for emergency sell `PREFLIGHT_ZERO_BALANCE` errors.

**Primary Goal:** Verify emergency sell works on v136, then close out remaining positions.

---

## P0 - Critical (Must Complete)

### 1. Verify Emergency Sell Fix (v136 - Token-2022 ATA)
**Context:** The root cause was found: `getTokenBalanceRaw()` derived ATAs using standard SPL token program, but pump.fun tokens use Token-2022 which derives ATAs at different addresses.

**Fix deployed in v136:**
- `getTokenBalanceRaw()` now detects token program via `getTokenProgramForMint()`
- Passes detected program to `getAssociatedTokenAddress(mint, wallet, false, tokenProgramId)`
- Added logging: `getTokenBalanceRaw: ... tokenProgram=Token-2022, ata=...`

**Steps:**
1. Check Fly.io deploy status: `fly status -a raptor-bot` and `fly releases -a raptor-bot`
2. Verify v136 is deployed (should show Token-2022 ATA fix)
3. Trigger emergency sell via Telegram on one of the 4 active positions:
   - PUMP: `Ahte7zvpjbroToRRoA3MzvuDz6XGFgvWrBPGj1hfpump` (id: 5)
   - REDBULL: `BDVhcvNs7PZzfJvoekLvxyR5i9BUT5emwbRhfyU6pump` (id: 6)
   - Watcher: `2BVSFGaxPFNPoX1z4orquizM97v4jrxc4XDANQdQpump` (id: 7)
   - HODL: `HnbVCGDftjvVxpVPBMYj5Xh8WbARiP4hnFiFfKANqEQx` (id: 8)
4. Check logs for successful token program detection:
   ```
   [SolanaExecutor] getTokenBalanceRaw: mint=..., wallet=..., tokenProgram=Token-2022, ata=...
   [SolanaExecutor] Token balance: X (Y.YY)
   ```
5. Verify sell transaction confirms on Solscan

**Success Criteria:** Emergency sell completes without `PREFLIGHT_ZERO_BALANCE` or `NotEnoughTokensToSell` error

**If it still fails:**
- Check logs: `fly logs -a raptor-bot`
- Verify the ATA address matches what Solscan shows for the wallet
- If ATA mismatch, check if `getTokenProgramForMint()` is returning correct program
- May need to verify wallet actually holds tokens via Solscan

---

### 2. Close Remaining Active Positions (if emergency sell works)
**Context:** 4 positions open since 2026-01-19, all on bonding curves (not graduated)

**Steps:**
1. After verifying one emergency sell works, close remaining 3 positions
2. Document any issues encountered
3. Verify position status changes to CLOSED in database

---

## P1 - Important (Should Complete)

### 3. Test Autohunt End-to-End
**Context:** With emergency sell fixed, autohunt should be fully functional

**Steps:**
1. Arm autohunt via Telegram (/hunt → Arm)
2. Wait for a token detection (or use test token if available)
3. Verify:
   - Position created with correct entry data (cost, decimals, MC)
   - TP/SL prices calculated and stored
   - Position appears in Positions panel
   - Emergency sell button works
4. If a trade executes, verify sell triggers work (TP or manual)

---

### 4. Max Positions Setting
**Context:** User requested 5 positions instead of default 2

**Steps:**
1. Update user's strategy: `UPDATE strategies SET max_positions = 5 WHERE tg_id = <USER_ID>`
2. Or add to Settings UI: "Edit Max Positions" button
3. Verify position limit is enforced correctly

---

## P2 - Nice to Have

### 5. Integration Test for Token-2022 ATA Detection
**Context:** No automated test to catch Token-2022 ATA derivation issues

**Steps:**
1. Create test fixture with known TOKEN_PROGRAM_ID mint
2. Create test fixture with known TOKEN_2022_PROGRAM_ID mint (pump.fun token)
3. Add unit test for `getTokenBalanceRaw()` with mocked RPC
4. Verify correct ATA addresses are derived for each program
5. Location: `apps/executor/src/tests/testTokenBalance.ts`

---

### 6. Integration Test for Fee Recipient Resolution
**Context:** Fee recipient logic is now mode-aware but untested

**Steps:**
1. Create test for normal mode fee recipient
2. Create test for mayhem mode fee recipient
3. Mock Global state with different modes
4. Location: `apps/executor/src/tests/testFeeRecipient.ts`

---

### 7. Re-enable Metadata Hard Stops
**Context:** Metadata rules relaxed for pump.pro tokens due to API issues

**Steps:**
1. Check if pump.fun API is stable for pump.pro tokens
2. If stable, re-enable hard stops in `apps/hunter/src/scoring/rules.ts`:
   - `has_metadata_uri`
   - `has_twitter`
   - `has_website`
   - `has_profile_image`
3. Monitor for false rejections

---

## Technical Debt / Future

### 8. Background Price Polling
**Context:** Current pricing fetches on-demand for each panel open

**When to implement:** When user count exceeds ~100 active users

**Approach:**
- Poll Jupiter prices every 30s for all open positions
- Store in database or Redis
- Positions panel reads from cache instead of fetching

---

### 9. Fixture-based Test Suite
**Context:** No test fixtures for pump.fun transactions

**Location:** `apps/executor/src/tests/fixtures/pump/`

**Files needed:**
- `create.json` - legacy create transaction
- `create_v2.json` - Token-2022 create transaction
- `buy.json` - bonding curve buy
- `sell.json` - bonding curve sell
- `graduated.json` - graduation boundary case

---

## Session Retrospective (2026-01-20)

### What Worked
1. **Preflight check caught the issue** - `PREFLIGHT_ZERO_BALANCE` was clearer than 10x error
2. **User feedback was key** - "wallets still hold tokens" pointed directly to infrastructure bug
3. **Existing code reuse** - `getTokenProgramForMint()` already existed, just needed integration
4. **Incremental deployments** - v134, v135, v136 each had one fix, easy to isolate
5. **Detailed logging** - Added to `getTokenBalanceRaw()` to see ATA being checked

### What Didn't Work
1. **Misdiagnosed root cause initially** - Thought it was decimal multiplication, actually was ATA derivation
2. **Didn't connect the dots** - Saw "Token-2022" in logs but didn't realize balance check wasn't using it
3. **Multiple compounding issues** - Fly.io autostop + ATA bug overlapping made debugging harder

### Root Cause Summary
Emergency sell `PREFLIGHT_ZERO_BALANCE` was caused by:
- `getTokenBalanceRaw()` used `getAssociatedTokenAddress(mint, wallet)` without token program parameter
- Default is standard SPL Token, but pump.fun tokens use **Token-2022**
- Token-2022 derives ATAs at **different addresses** than standard SPL
- Function checked wrong ATA (0 balance) while real Token-2022 ATA had tokens

Fixed by:
1. Import `getTokenProgramForMint` from pumpFun.ts
2. Detect token program before deriving ATA
3. Pass `tokenProgramId` to `getAssociatedTokenAddress(mint, wallet, false, tokenProgramId)`

### Files Changed Today (v136 session)
```
apps/executor/src/chains/solana/solanaExecutor.ts - getTokenBalanceRaw() Token-2022 fix
apps/bot/fly.toml                                  - dockerfile path fix
apps/bot/src/services/emergencySellService.ts     - sellPercent: 100 option
apps/hunter/src/loops/execution.ts                - sellPercent option
retros/2026-01-20-retro.md                        - NEW: session retro
MUST_READ/Changelog.md                            - updated
MUST_READ/Project_status.md                       - updated
MUST_READ/TODO.md                                 - updated
context.md                                        - updated
```

### Key Learnings
1. **Token-2022 ATAs are at different addresses** - Always use detected token program
2. **Fresh on-chain data > stored data** - Fetching balance eliminates decimal confusion
3. **Read the existing code** - `getTokenProgramForMint()` already existed, just wasn't used
4. **Fly.io autostop + Telegram long-polling = bad** - Bots need to run continuously

---

## Deployment Status

| App | Current Version | Contains Fix | Status |
|-----|-----------------|--------------|--------|
| raptor-bot | v136 | Token-2022 ATA detection | ✅ Deployed |
| raptor-hunter | v113 | N/A (doesn't execute sells) | ✅ OK |

**To check:** `fly releases -a raptor-bot | head -5`

---

## Quick Reference

### Active Positions
```sql
SELECT id, token_mint, token_symbol, status
FROM positions
WHERE status = 'ACTIVE';
```

| ID | Mint | Symbol |
|----|------|--------|
| 5 | Ahte7zvpjbroToRRoA3MzvuDz6XGFgvWrBPGj1hfpump | PUMP |
| 6 | BDVhcvNs7PZzfJvoekLvxyR5i9BUT5emwbRhfyU6pump | REDBULL |
| 7 | 2BVSFGaxPFNPoX1z4orquizM97v4jrxc4XDANQdQpump | Watcher |
| 8 | HnbVCGDftjvVxpVPBMYj5Xh8WbARiP4hnFiFfKANqEQx | HODL |

### Key Commands
```bash
# Check deploy status
fly status -a raptor-bot
fly releases -a raptor-bot

# View logs
fly logs -a raptor-bot

# Build locally
pnpm -w build

# Database query (use Supabase MCP)
mcp__supabase__execute_sql
```

### Key Files for Token-2022 ATA Fix
- Token program detection: `apps/executor/src/chains/solana/pumpFun.ts:getTokenProgramForMint()`
- Balance check: `apps/executor/src/chains/solana/solanaExecutor.ts:getTokenBalanceRaw()`
- Emergency sell: `apps/bot/src/services/emergencySellService.ts`

### Debug Logs to Watch For
```
[SolanaExecutor] getTokenBalanceRaw: mint=..., wallet=..., tokenProgram=Token-2022, ata=...
[SolanaExecutor] Token balance: X (Y.YY)
```
