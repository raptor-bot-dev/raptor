# Project_status.md

Single source of truth for current progress. Keep it brief.

## Current milestone
**Phase B: TP/SL Engine (automatic position exits)** - COMPLETE (audit fixes deployed)

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
- **RPC migrated to Helius paid plan** (2026-01-18):
  - QuickNode free tier doesn't support `logsSubscribe` (WebSocket)
  - Helius paid plan configured via Fly.io secrets
- **Address Lookup Table (ALT) fix** (2026-01-18):
  - Versioned transactions can have accounts in ALTs
  - Now includes `meta.loadedAddresses.writable` and `readonly`
  - Fixes parse failures when pump.fun program ID is in an ALT
- **create_v2 discriminator support** (2026-01-18):
  - pump.fun now uses `create_v2` instruction instead of legacy `create`
  - Added CREATE_V2_DISCRIMINATOR for current pump.fun protocol
  - Monitor checks for both legacy and current discriminators
- **pump.pro program support** (2026-01-18):
  - pump.fun migrated most token creation to new pump.pro program
  - Program ID: `proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u`
  - Added PUMP_PRO to PROGRAM_IDS in shared config
  - Monitor subscribes to both pump.fun and pump.pro logs
  - Parsing handles Create instructions from both programs
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
- **Snipe mode setting added to Settings UI** (2026-01-18):
  - Speed (300ms metadata timeout) vs Quality (2000ms) modes
  - Stored in strategies.snipe_mode column
  - Edit Snipe Mode button in Settings panel
- **Snipe mode button emoji error fixed** (2026-01-18):
  - panelKit assertNoEmoji() rejected checkmark emoji
  - Changed to [x] Speed / [x] Quality text indicators
- **BigInt underflow and Jupiter slippage fixes** (2026-01-18):
  - pumpFun.ts now validates BigInt operations to prevent underflow
  - Jupiter slippage clamped to 9900 bps (99%) max
  - Fixes RangeError crashes with high slippage settings
- **Autohunt retry and lifecycle fixes** (2026-01-18):
  - Retryable jobs can reuse executions (reserve_trade_budget allow-retry)
  - OpportunityLoop uses per-mode scoring (speed vs quality)
  - Opportunities remain EXECUTING until jobs are terminal
  - Auto-execute disabled skips job creation (QUALIFIED only)
  - Token allowlist now enforced when set
- **Legacy hunt UI routed to new panels** (2026-01-18):
  - Legacy hunt callbacks now open Arm/Disarm + Settings
  - Snipe mode normalized to speed/quality in Settings
  - Slippage prompt aligned to 1-99%
- **Token launch filtering modes** (2026-01-19):
  - 3 configurable filter modes: strict, moderate (default), light
  - Strict: Require socials + 3s delay + activity check
  - Moderate: 3s delay + activity check only (checks bondingCurveProgress > 0.5%)
  - Light: Require at least 1 social signal, no delay (fastest entry)
  - Activity check uses pump.fun API to verify early buyer interest
  - Reduces wasted gas and RPC calls on dead tokens
  - Migration 017 adds filter_mode column to strategies
  - Settings UI updated with Filter Mode selection
- **Filter mode policy hardened** (2026-01-19):
  - Strict forces quality metadata fetch and fails closed on missing socials/activity
  - Moderate fails open on activity API errors
  - Activity check runs once per token with on-chain fallback
- **Notification alerts upgraded to terminal UI** (2026-01-19):
  - All notifications now use panelKit HTML format with `🦖 RAPTOR | TITLE` header
  - Created 5 new notification component files (tradeDone, tpSlHit, positionState, systemAlerts, generic)
  - NotificationPoller uses `parse_mode: 'HTML'` and returns Panel objects
  - Generic notification formats fields with labels instead of raw JSON
  - All notifications include action buttons (Positions, Home, View TX, Chart)
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

## Phase B Objectives (TP/SL Engine)
- Hybrid pricing: Jupiter polling (3s) + Helius WebSocket activity hints
- Trigger state machine: MONITORING → TRIGGERED → EXECUTING → COMPLETED
- Exactly-once execution via atomic DB claims + idempotency keys
- Exit queue with backpressure (maxConcurrent=3)
- Feature-flagged migration from legacy position monitor

### Phase B Implementation Status
- [x] Phase 0: Documentation updates
- [x] Phase 1: Database migration (trigger_state, tp_price, sl_price)
- [x] Phase 2: Helius WebSocket infrastructure
- [x] Phase 3: Exit queue with backpressure
- [x] Phase 4: TpSlMonitorLoop integration
- [x] Phase 5: Migration and testing
- [x] **Phase 6: Audit fixes round 1** (2026-01-18)
  - NotificationPoller startup + type/payload fixes
  - Position creation tg_id fix + TP/SL field population
  - State machine RPC wrappers + execution transitions
  - Duplicate trigger prevention in legacy monitor
  - Stored TP/SL price usage
- [x] **Phase 7: Audit fixes round 2 - uuid_id standardization** (2026-01-18)
  - Migration 015: uuid_id NOT NULL, unique index, RPC functions use uuid_id
  - All position operations use uuid_id consistently
  - Post-sell notifications with real data (not trigger-time placeholders)
  - TRADE_DONE is BUY-only; SELL uses specific trigger types

## Where we left off last
- 2026-01-19 (latest): **Notification payload gaps fixed**
  - High: TP/SL notifications now include `mint` for chart button and display
  - Low: TRADE_DONE now includes `tokenSymbol` from opportunity metadata
  - Moved opportunity fetch to success block scope for access in both position and notification code
- 2026-01-19 (earlier): **Critical position creation bug fixed**
  - P0: `createPositionV31()` was missing required columns causing position insert failures
  - Root cause: Trade executed (tokens bought) but position not tracked (orphaned execution)
  - Missing columns: `token_address`, `amount_in`, `tokens_held`, `source`, `mode`, `strategy`
  - Status was 'OPEN' but constraint requires 'ACTIVE'|'CLOSED'|'PENDING'
  - Manually created position for orphaned execution (user 5979211008, token Ahte7zvpjbroToRRoA3MzvuDz6XGFgvWrBPGj1hfpump)
- 2026-01-19 (earlier): **Notification alerts upgraded to terminal UI**
  - All 13+ notification types now use panelKit HTML terminal style
  - Created tradeDone.ts, tpSlHit.ts, positionState.ts, systemAlerts.ts, generic.ts
  - NotificationPoller refactored to return Panel objects with HTML parse_mode
  - Generic fallback formats fields with labels instead of raw JSON dump
- 2026-01-19 (earlier): **Filter mode policy update**
  - Strict uses quality metadata fetch and fails closed on missing socials/activity
  - Activity check falls back to on-chain bonding curve state when pump.fun API is down
- 2026-01-19 (earlier): **Token launch filtering modes deployed**
  - Migration 017 applied: filter_mode column (strict/moderate/light)
  - OpportunityLoop: per-strategy filtering with activity check
  - Activity check: 3s delay + bondingCurveProgress > 0.5%
  - Settings UI: Edit Filter Mode button + selection panel
  - Commit 724969a pushed to origin/main
- 2026-01-18 (earlier): **Autohunt retry + lifecycle fixes deployed**
  - Migration 016 deployed: `p_allow_retry` in reserve_trade_budget
  - OpportunityLoop: per-mode metadata scoring, no early COMPLETED
  - Legacy hunt callbacks route to new Arm/Disarm + Settings panels
  - Settings: slippage prompt 1-99%, snipe mode speed/quality only
  - Commit d82ed23 pushed to origin/main
- 2026-01-18 (earlier): **pump.pro execution debugging resolved**
  - Fixed parseError to handle object errors (Supabase errors were showing as `[object Object]`)
  - Added job staleness check (60s TTL) - stale jobs now CANCELED instead of FAILED
  - Circuit breaker issue addressed by staleness check + retry mechanism
- 2026-01-18 (earlier): **pump.pro on-chain metadata fallback deployed**
  - P0: pump.fun API returning HTTP 530 for all pump.pro tokens
  - P0: Added on-chain Metaplex Metadata Account fetch as fallback
  - P0: Tokens now get proper name/symbol/uri even when API is down
  - Root cause: pump.fun API unavailable → empty uri → `has_metadata_uri` hard stop → score 0
- 2026-01-18 (earlier): **pump.pro discriminator fix deployed**
  - P0: Added pump.pro create discriminator `[147,241,123,100,244,132,174,118]`
  - P0: Reset circuit breaker (was 190 consecutive failures)
  - Tokens from pump.pro can now be detected and sniped
- 2026-01-18 (earlier): **Snipe mode & production bug fixes deployed**
  - P1: Snipe mode button emoji error fixed - changed "Speed ✓" to "[x] Speed"
  - P1: Snipe mode "message not modified" error fixed - early return when unchanged
  - P0: BigInt underflow in pumpFun.ts fixed - validation before BigInt ops
  - P0: Jupiter slippage overflow fixed - clamped to 9900 bps (99%) max
  - Bot deployed at v85, Hunter at v84
- 2026-01-18 (earlier): **Audit fixes round 2 deployed** - uuid_id standardization complete
  - P0: Migration 015 applied - All RPCs now use `uuid_id` (was INTEGER `id`)
  - P0: `uuid_id` column now NOT NULL with unique index
  - P1: TypeScript `PositionV31` interface includes `uuid_id` field
  - P2: Notifications sent after sell completes (real txHash, pnlPercent, solReceived)
  - P2: TRADE_DONE is BUY-only; SELL uses TP_HIT/SL_HIT/TRAILING_STOP_HIT/POSITION_CLOSED
  - Legacy monitor uses atomic claim before exit jobs
- Earlier: Audit fixes round 1 (NotificationPoller, tg_id, state machine)
- Earlier: TP/SL Engine implementation complete (Phases 0-5)
- pump.fun migrated most tokens to pump.pro program (`proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u`)
- Fly.io auto-deploys from GitHub pushes to `main` (documented in DEPLOYMENT.md)
