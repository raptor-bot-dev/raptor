# Changelog.md

Keep this log short and append-only. Use ISO dates.

## 2026-01-16
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
