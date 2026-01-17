# Changelog.md

Keep this log short and append-only. Use ISO dates.

## 2026-01-17
- **fix(bot): settings panel text input not responding**
  - Added missing v3 autohunt settings session steps to messages.ts handleSessionFlow()
  - Now routes AWAITING_TRADE_SIZE, AWAITING_MAX_POSITIONS, AWAITING_TP_PERCENT,
    AWAITING_SL_PERCENT, AWAITING_SLIPPAGE_BPS, AWAITING_PRIORITY_SOL to handleSettingsInput()
  - Settings panel now properly updates values when user enters text
- **fix(bot): slippage now uses percentage instead of bps**
  - Display: shows "10%" instead of "1000 bps"
  - Input: accepts 1-1000% (converted to bps internally)
  - Better UX for high volatility launches that need 100%+ slippage
- **fix(hunter): pass tgId to executor for MEV/priority settings**
  - Hunter execution loop was not passing user ID to executor
  - Now passes `tgId: job.user_id` to `executeBuyWithKeypair` and `executeSellWithKeypair`
  - Executor now fetches user's chain_settings for priority_sol and anti_mev_enabled
  - Enables Jito MEV protection and custom priority fees for autohunt trades
- **fix(executor): pass priorityFeeSol to PumpFunClient buy/sell**
  - Was hardcoded to 100000 microLamports (~0.00002 SOL)
  - Now uses chain_settings.priority_sol from user preferences
  - Affects both buy and sell transactions on pump.fun bonding curve
- **feat(hunter): add mayhem mode filter**
  - Parse `is_mayhem_mode` from pump.fun Create instruction
  - Skip mayhem mode tokens in OpportunityLoop (low quality launches)
  - Added `isMayhemMode` field to PumpFunEvent interface
- **refactor(shared): remove unused PumpFun API functions**
  - Removed `getRecentTrades()` (never called)
  - Removed `PumpFunTrade` interface (only used by removed function)
  - Removed `parsePumpFunTrade()` (only used by removed function)
- **refactor(executor): remove dead code from pumpFun.ts**
  - Removed `parseCreateEvent()` (returned null)
  - Removed `parseTradeEvent()` (returned null)
  - Removed `PumpFunTrade` interface (only used by removed function)
- **docs: add PumpFun protocol reference to Reference_docs.md**
  - Bonding curve parameters and graduation threshold
  - Key 2025 protocol updates (volume accumulators, fee config, creator vault, mayhem mode)
  - Third-party API references

## 2026-01-16
- **feat(bot): add priority fee and MEV protection settings** (cb35d21)
  - Add Priority Fee setting to Settings UI (0.0001 - 0.01 SOL)
  - Add MEV Protection toggle (Jito) - ON by default
  - Uses chain_settings table for per-chain priority_sol and anti_mev_enabled
  - New callbacks: settings:edit_priority, settings:toggle_mev
- **fix(bot): arm/disarm autohunt bugs**
  - Re-validate settings in confirmArm() before enabling
  - Error handling in confirmDisarm() now updates UI on failure
- **fix(bot): shorten divider and add more bot menu commands** (d8f4dd8)
  - Shortened divider from 20 to 16 chars
  - Added /hunt, /positions, /wallet, /settings commands
- **fix(bot): implement emergency sell service** (P1 critical audit fix)
  - Added apps/bot/src/services/emergencySellService.ts
  - Uses idKeyExitSell for idempotency (one emergency sell per position)
  - Atomic budget reservation and execution tracking
  - High slippage (15%) for faster emergency exits
  - Proper position closing with EMERGENCY trigger
- **docs: deprecate Max Buys/Hour in favor of cooldown_seconds**
  - Max Buys/Hour was a design artifact never implemented in DB
  - cooldown_seconds provides same rate-limiting with better properties
  - Updated DESIGN.md, PROMPT.md, Project_status.md
- refactor(bot): implement v3 terminal UI with autohunt-only panels
- feat(ui): add panelKit.ts HTML renderer with width pad and linux joiners
- feat(ui): add all core panels - Home, Settings, Positions, Withdraw, Help
- feat(ui): add hunt panels - Arm/Disarm confirm, position details, emergency sell
- feat(ui): add notification panels - Hunt Executed/Closed/Skipped/Failed
- refactor(bot): rewrite callback router with new CB.* ID scheme
- remove(bot): disable manual buyer UI flows and callbacks
- remove(bot): disable /deposit command (users fund wallet directly)
- fix(withdraw): implement math validation with 0.01 SOL buffer
- fix(pnl): compute realized PnL from closed positions only
- fix(strategy): correct field names (max_positions, max_per_trade_sol)
- chore(db): add performance indexes for v3 queries

## 2026-01-15
- Added patched UI and placeholder removal work in prior audit iterations.
