# Project_status.md

Single source of truth for current progress. Keep it brief.

## Current milestone
**Phase A: Autohunt-only Telegram bot (minimal UX)** - COMPLETE

### Objectives
- Autohunt execution is reliable (buy/exit/emergency close). ✅
- Telegram UX is consistent, fast, and readable (terminal-style panels). ✅
- Remove UX paths that cause errors (manual buyer, deposit). ✅

## Done
- v3 Terminal UI implementation complete:
  - panelKit.ts HTML renderer with width pad and linux joiners
  - All core panels: Home, Settings, Positions, Withdraw, Help
  - Hunt panels: Arm/Disarm confirm, position details, emergency sell
  - Notification panels: Hunt Executed/Closed/Skipped/Failed
- Callback router rewritten with new CB.* ID scheme
- Manual buyer UI flows disabled (returns "feature removed" message)
- /deposit command disabled (users fund wallet directly)
- Withdraw math validation with 0.01 SOL buffer implemented
- PnL computed from closed positions only (no fake values)
- Strategy field names corrected (max_positions, max_per_trade_sol)
- Database performance indexes added
- **Emergency Sell service fully implemented** (2026-01-16 audit fix):
  - Idempotent execution via idKeyExitSell with trigger='EMERGENCY'
  - Atomic budget reservation and execution tracking
  - High slippage (15%) for faster execution
  - Proper position closing and notification creation
- **Priority Fee setting added to Settings UI** (2026-01-16):
  - Manual input field: 0.0001 - 0.01 SOL
  - Uses chain_settings.priority_sol (per-chain)
  - Edit Priority button in Settings panel
- **MEV Protection toggle added to Settings UI** (2026-01-16):
  - Toggle button shows MEV: ON/OFF
  - Uses chain_settings.anti_mev_enabled (defaults to true)
  - Jito bundles enabled when ON
- **Arm/disarm autohunt bugs fixed** (2026-01-16):
  - Re-validation in confirmArm() before enabling
  - Error handling in confirmDisarm() updates UI on failure
- **Bot menu commands expanded** (d8f4dd8):
  - /hunt, /positions, /wallet, /settings for direct panel access
- **Hunter/Executor audit completed** (2026-01-17):
  - Priority fee now passed to PumpFunClient buy/sell (was hardcoded)
  - Mayhem mode tokens filtered out in OpportunityLoop
  - Unused API functions removed (getRecentTrades, parsePumpFunTrade, parseCreateEvent, parseTradeEvent)
  - PumpFun docs added to Reference_docs.md
- **RPC migrated from Helius to QuickNode** (2026-01-17):
  - Helius free tier was rate-limiting (HTTP 429)
  - QuickNode free tier: 10M credits, 15 RPS
  - Secrets updated on raptor-hunter and raptor-bot
- **Settings panel text input fixed** (2026-01-17):
  - messages.ts was missing cases for v3 settings session steps
  - Now routes to handleSettingsInput() for all settings edits
- **Slippage changed to percentage** (2026-01-17):
  - Display: "10%" instead of "1000 bps"
  - Input: accepts 1-1000% (converted to bps internally)
  - Better UX for high volatility launches
- **Hunter now passes tgId to executor** (2026-01-17):
  - ExecutionLoop passes `tgId: job.user_id` to buy/sell calls
  - Enables user's priority_sol and anti_mev_enabled settings
  - Jito MEV protection now active for autohunt trades
- **Token parsing fixed for versioned+legacy tx** (2026-01-17):
  - PumpFunMonitor was only handling versioned transactions (v0)
  - Now supports both legacy and versioned transaction formats
  - Fixed 100% token parse failure rate
- **Circuit breaker reset** (2026-01-17):
  - Had 8 consecutive failures blocking all trades
  - Reset to allow execution
- `pnpm -w lint && pnpm -w build` passes

## Design Notes
- **Max Buys/Hour**: DEPRECATED - superseded by `cooldown_seconds`.
  Early design docs mentioned this field but implementation consolidated to `cooldown_seconds`
  which provides the same rate-limiting with better properties (time-based, deterministic,
  no reset logic needed). Example: cooldown_seconds=600 ≈ max 6 buys/hour.
- **Position Chart/TX buttons**: Use URL buttons (`urlBtn`) which open directly in browser.
  No callback handlers needed for these.

## Next steps (post-MVP)
- Edge Functions for background cleanup (stale executions, expired monitors)
- Unit tests for withdraw math and PnL calculations
- Production smoke testing with real wallet

## Definition of done for MVP
- `pnpm -w lint && pnpm -w build` passes. ✅
- Manual buyer callbacks safely disabled. ✅
- Autohunt notifications render with Solscan + Dexscreener links. ✅
- Withdraw math validated in code. ✅
- Emergency sell implemented with idempotency. ✅

## Where we left off last
- 2026-01-17 (latest): Token parsing fix deployed.
- Fixed PumpFunMonitor to handle both versioned and legacy transactions.
- Circuit breaker reset (was blocking all trades due to 8 consecutive failures).
- User armed autohunt with funded wallet (1 SOL).
- Monitoring live for first successful trade execution.
