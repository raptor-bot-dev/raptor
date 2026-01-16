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
- 2026-01-16: Audit completed, Emergency Sell service implemented.
- All P1 critical issues resolved.
- Ready for deployment testing.
