# RAPTOR Audit Fix Plan - Dynamic Data Displays (Round 4)

Scope: bot UI panels/notifications, price/market-cap sources, TP/SL monitor pricing, emergency sell routing.

## Owner Decisions
- Positions list shows CURRENT MC (USD). Entry MC moves to detail panel.
- PnL must be quote-based for accuracy.
- OK to add DB columns for accurate display data (decimals, entry MC).

## Implementation Plan (step-by-step)

### Step 1 - Add DB columns for accuracy (schema)
1. Create migration: `packages/database/migrations/0xx_positions_display_fields.sql`
   - Add columns:
     - `token_decimals SMALLINT NULL`
     - `entry_mc_sol NUMERIC NULL`
     - `entry_mc_usd NUMERIC NULL`
   - Optional: add `entry_price_spot` if you want explicit spot entry price separate from average.
2. Backfill where possible:
   - Set `token_decimals` from mint on-chain (script or one-off job).
   - Set `entry_mc_sol` and `entry_mc_usd` for existing positions if `entry_price` + supply + solPriceUsd_at_entry are available.
3. Update shared types and helpers:
   - `packages/shared/src/types.ts` (PositionV31) add the new fields.
   - `packages/shared/src/supabase.ts` include fields in reads/updates.

### Step 2 - Market data helper (single source of truth)
1. Create a shared helper (extend `packages/shared/src/pricing.ts` or new `marketData.ts`):
   - Input: `mint`, optional `bondingCurve`, optional `tokenDecimals`, optional `totalSupply`.
   - Output: `{ priceSol, priceUsd, marketCapSol, marketCapUsd, supply, decimals, source }`.
2. Data source order:
   - On-chain bonding curve state (if bondingCurve exists).
   - pump.fun API (if available).
   - DEXScreener/Birdeye (token info).
   - Jupiter price + mint supply (fallback).
3. Cache:
   - Reuse existing 30s cache or add per-mint cache for market data.

### Step 3 - Quote-based PnL helper (accuracy)
1. Create `getExpectedSolOut(mint, tokensAdjusted, tokenDecimals, bondingCurve?)`:
   - If bonding curve state available: use `calculateSellOutput()` on raw tokens.
   - If graduated: use Jupiter quoteSell.
   - Fallback to `spotPriceSol * tokensAdjusted`.
2. Compute PnL:
   - `currentValueSol = expectedSolOut`
   - `pnlSol = currentValueSol - entry_cost_sol`
   - `pnlPercent = (pnlSol / entry_cost_sol) * 100`
3. Do not use USD for PnL display.

### Step 4 - Update bot panels (positions list + detail)
1. `apps/bot/src/handlers/positionsHandler.ts`
   - Fetch `solPriceUsd` once per render.
   - For each position:
     - Fetch market data helper for current MC (USD).
     - Compute quote-based PnL (SOL + %).
2. `apps/bot/src/ui/panels/positions.ts`
   - Show **current MC** in USD in list.
   - Do not show entry MC in list.
3. `apps/bot/src/ui/panels/positionDetail.ts`
   - Add `Current MC (USD)` and `Entry MC (USD)` lines.
   - Add `PnL` lines (percent + SOL).

### Step 5 - Store accurate entry fields at buy time
1. `apps/hunter/src/loops/execution.ts`
   - Fetch token decimals on buy (cache by mint).
   - Store `size_tokens` using actual decimals.
   - Compute `entry_price` using adjusted tokens.
   - Compute and store `entry_mc_sol`, `entry_mc_usd` using market data helper + solPriceUsd at buy time.
2. Ensure TP/SL prices are computed from corrected `entry_price`.

### Step 6 - TP/SL and legacy monitors use shared pricing
1. `apps/hunter/src/loops/tpslMonitor.ts`
   - Replace Jupiter-only pricing with market data helper (priceSol).
2. `apps/hunter/src/loops/positions.ts`
   - Same change for legacy monitor.

### Step 7 - Emergency sell reliability (pump.fun + pump.pro)
1. `apps/executor/src/chains/solana/solanaExecutor.ts`
   - Extend bonding curve derivation to try both pump.fun and pump.pro program IDs.
2. `apps/executor/src/chains/solana/pumpFun.ts`
   - Ensure token program detection (Tokenkeg vs Token-2022) is respected in sell instruction.
   - Route pump.pro tokens to the correct program ID.
3. Validate that InvalidProgramId is resolved on real pump.pro tokens.

### Step 8 - Notifications consistency
1. `apps/bot/src/ui/notifications/tradeDone.ts`
   - Display MC in USD (using `solPriceUsd` or marketCapUsd).
2. `apps/bot/src/services/notifications.ts`
   - Ensure BUY/SELL confirmed payloads include market cap fields or suppress MC lines when missing.

## Calculation Reference (formulas)
PnL (quote-based):
- expectedSolOut = sell quote (bonding curve or Jupiter)
- pnlSol = expectedSolOut - entry_cost_sol
- pnlPercent = (pnlSol / entry_cost_sol) * 100

Market cap (USD):
- priceSol = spot price
- marketCapSol = priceSol * totalSupplyTokens
- marketCapUsd = marketCapSol * solPriceUsd

Entry MC (stored):
- entryMcSol = entry_price * totalSupplyTokens
- entryMcUsd = entryMcSol * solPriceUsd_at_entry

Decimals:
- tokensRaw = floor(size_tokens * 10^token_decimals)

## Verification Checklist
- Positions list: MC in USD, no entry MC in list.
- Detail panel: Current MC USD, Entry MC USD, PnL % + SOL.
- PnL uses quote-based output where possible.
- TP/SL triggers fire for pump.fun/pump.pro tokens without Jupiter prices.
- Emergency sell works for pump.fun and pump.pro (no InvalidProgramId).

## Appendix: Example Calculations (pump.fun-style)
Example inputs (hypothetical):
- token_decimals = 6
- size_tokens = 2,050,000.0 (adjusted)
- entry_cost_sol = 0.0170
- entry_price = 0.0170 / 2,050,000 = 8.29268e-9 SOL
- total_supply = 1,000,000,000 tokens
- solPriceUsd = 180.00 USD

Entry MC:
- entryMcSol = entry_price * total_supply
  = 8.29268e-9 * 1,000,000,000
  = 8.29268 SOL
- entryMcUsd = entryMcSol * solPriceUsd
  = 8.29268 * 180
  = 1,492.68 USD

Current MC (spot):
- spotPriceSol = currentSpotPriceSol (from bonding curve or API)
- currentMcSol = spotPriceSol * total_supply
- currentMcUsd = currentMcSol * solPriceUsd

Quote-based PnL:
- tokensRaw = floor(size_tokens * 10^token_decimals)
- expectedSolOut = calculateSellOutput(tokensRaw, virtualSolReserves, virtualTokenReserves) -> lamports
- currentValueSol = expectedSolOut / 1e9
- pnlSol = currentValueSol - entry_cost_sol
- pnlPercent = (pnlSol / entry_cost_sol) * 100

Fallback (if no sell quote):
- currentValueSol = spotPriceSol * size_tokens
- pnlSol = currentValueSol - entry_cost_sol
- pnlPercent = (pnlSol / entry_cost_sol) * 100

## Appendix: Example Calculations (pump.pro-style)
Example inputs (hypothetical):
- token_decimals = 9
- size_tokens = 12,500,000.0 (adjusted)
- entry_cost_sol = 0.0250
- entry_price = 0.0250 / 12,500,000 = 2.0e-9 SOL
- total_supply = 2,500,000,000 tokens
- solPriceUsd = 175.00 USD

Entry MC:
- entryMcSol = entry_price * total_supply
  = 2.0e-9 * 2,500,000,000
  = 5.0 SOL
- entryMcUsd = entryMcSol * solPriceUsd
  = 5.0 * 175
  = 875.00 USD

Quote-based PnL:
- tokensRaw = floor(size_tokens * 10^token_decimals)
  = 12,500,000 * 1,000,000,000
  = 12,500,000,000,000,000
- expectedSolOut = calculateSellOutput(tokensRaw, virtualSolReserves, virtualTokenReserves) -> lamports
- currentValueSol = expectedSolOut / 1e9
- pnlSol = currentValueSol - entry_cost_sol
- pnlPercent = (pnlSol / entry_cost_sol) * 100
