# TODO.md - Tomorrow's Tasks (2026-01-21)

## Overview

**Current State:** Emergency sell fixes deployed (token program detection + IDL-based fee recipient). Awaiting v118 deployment to test.

**Primary Goal:** Verify emergency sell works, then close out remaining audit items.

---

## P0 - Critical (Must Complete)

### 1. Verify Emergency Sell Fix
**Context:** Two commits deployed to fix `InvalidProgramId` on `token_program` account:
- `cf62b67`: Token program detection (TOKEN_PROGRAM_ID vs TOKEN_2022_PROGRAM_ID)
- `ef787c5`: IDL-based fee recipient resolution (mayhem mode aware)

**Steps:**
1. Check Fly.io deploy status: `fly status -a raptor-bot` and `fly releases -a raptor-bot`
2. Verify v118 is deployed (should contain both fixes)
3. Trigger emergency sell via Telegram on one of the 4 active positions:
   - REDBULL: `BDVhcvNs7PZzfJvoekLvxyR5i9BUT5emwbRhfyU6pump` (id: 6)
   - PUMP: `Ahte7zvpjbroToRRoA3MzvuDz6XGFgvWrBPGj1hfpump` (id: 5)
   - Watcher: `2BVSFGaxPFNPoX1z4orquizM97v4jrxc4XDANQdQpump` (id: 7)
   - HODL: `HnbVCGDftjvVxpVPBMYj5Xh8WbARiP4hnFiFfKANqEQx` (id: 8)
4. Check logs for token program detection messages:
   - `[getTokenProgramForMint] Mint X uses standard SPL Token program`
   - `[getTokenProgramForMint] Mint X uses Token-2022 program`
5. Verify sell transaction succeeds (check Solscan)

**Success Criteria:** Emergency sell completes without `InvalidProgramId` error

**If it fails:**
- Check logs: `fly logs -a raptor-bot`
- Look for specific error in transaction simulation
- May need to check fee recipient resolution (mayhem mode)

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

### 5. Integration Test for Token Program Detection
**Context:** No automated test to catch token program mismatch

**Steps:**
1. Create test fixture with known TOKEN_PROGRAM_ID mint
2. Create test fixture with known TOKEN_2022_PROGRAM_ID mint
3. Add unit test for `getTokenProgramForMint()`
4. Location: `apps/executor/src/tests/testTokenProgram.ts`

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
1. **IDL-based approach** - Reading pump.fun's own IDL ensures compatibility
2. **Vendored IDL** - No runtime dependency on external resources
3. **Token program detection** - Simple, clean check for mint account owner
4. **PUMPFUN.md spec** - Invaluable reference for correct implementation
5. **Incremental commits** - Separated token program fix from IDL fix

### What Didn't Work
1. **Hardcoded TOKEN_2022_PROGRAM_ID** - Should have been detected earlier
2. **No integration test** - Would have caught token program mismatch
3. **Deployment delay** - GitHub Actions CI adds latency to verification

### Root Cause Summary
Emergency sell failed due to two issues:
1. **Token program mismatch**: Hardcoded TOKEN_2022_PROGRAM_ID, but some tokens use TOKEN_PROGRAM_ID
2. **Fee recipient mode**: Mayhem mode requires reserved fee recipients from Global config

Both fixed by:
1. `getTokenProgramForMint()` - checks mint account owner
2. `resolveFeeRecipient()` - reads Global config, branches on mode

### Files Changed Today
```
apps/executor/src/chains/solana/pumpFun.ts     - token program detection + fee recipient delegation
apps/executor/src/chains/solana/feeRecipient.ts - NEW: mode-aware fee recipient resolution
apps/executor/src/chains/solana/pumpIdl.ts      - NEW: IDL loader + Borsh decoder
apps/executor/package.json                      - @coral-xyz/anchor dependency
vendor/pump-public-docs/idl/pump.json           - NEW: vendored pump.fun IDL
.gitignore                                      - settings.local.json
MUST_READ/Changelog.md                          - updated
MUST_READ/Project_status.md                     - updated
MUST_READ/Reference_docs.md                     - updated
```

### Key Learnings
1. **Always detect token program** - Don't assume Token-2022; check mint owner
2. **Mode-aware fee logic** - Mayhem mode is a real case that needs handling
3. **Vendor dependencies** - IDLs should be pinned files, not runtime fetches
4. **Read the spec** - PUMPFUN.md had all the answers

---

## Deployment Status

| App | Current Version | Contains Fix | Status |
|-----|-----------------|--------------|--------|
| raptor-bot | v117 | Token program only | ✅ Deployed |
| raptor-bot | v118 | Token program + IDL fee | ⏳ Pending |
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

# Database query
mcp__supabase__execute_sql
```

### Key Files
- Token program detection: `apps/executor/src/chains/solana/pumpFun.ts:getTokenProgramForMint()`
- Fee recipient: `apps/executor/src/chains/solana/feeRecipient.ts:resolveFeeRecipient()`
- IDL loader: `apps/executor/src/chains/solana/pumpIdl.ts`
- Emergency sell: `apps/bot/src/services/emergencySellService.ts`
