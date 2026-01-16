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
- `pnpm -w lint && pnpm -w build` passes

## Next steps (post-MVP)
- Edge Functions for background cleanup (stale executions, expired monitors)
- Unit tests for withdraw math and PnL calculations
- Production smoke testing with real wallet

## Definition of done for MVP
- `pnpm -w lint && pnpm -w build` passes. ✅
- Manual buyer callbacks safely disabled. ✅
- Autohunt notifications render with Solscan + Dexscreener links. ✅
- Withdraw math validated in code. ✅

## Where we left off last
- v3 Terminal UI implementation complete and building successfully.
- Ready for deployment testing.
