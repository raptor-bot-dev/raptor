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
- 2026-01-18 (latest): **Audit fixes round 2 deployed** - uuid_id standardization complete
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
