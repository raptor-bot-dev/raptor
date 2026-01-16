# Changelog.md

Keep this log short and append-only. Use ISO dates.

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
