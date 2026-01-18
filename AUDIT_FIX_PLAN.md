# RAPTOR Audit Fix Plan

Scope: bot, hunter, executor, TP/SL engine, notifications, worker coordination.

## Confirmed Decisions (from owner)
- Positions table uses `tg_id` (not `user_id`); positions should stay on tg_id for compatibility.
- TP/SL thresholds are fixed at entry; `tp_price`/`sl_price` are source of truth for open positions.
- Shadow mode stays: `TPSL_ENGINE_ENABLED=true` and `LEGACY_POSITION_MONITOR=true` for now.
- Notifications are DB-poller based (worker -> notifications table -> NotificationPoller).
- `bonding_curve` exists on positions but is not populated; source from opportunity at creation.

## Key Findings (summary)
- Notification delivery is not started in the bot process, so DB notifications never send.
- Positions schema mismatch (`tg_id` vs `user_id`) can break position creation and ownership checks.
- TP/SL trigger_state is set to TRIGGERED but never moved to EXECUTING/COMPLETED/FAILED.
- Legacy monitor can run alongside the TP/SL engine without trigger_state checks, risking duplicate exits.
- TP/SL engine ignores stored `tp_price`/`sl_price` and relies on strategy values at runtime.
- TP/SL WS activity hints likely miss bonding-curve tokens because positions do not store bonding curve.

## Fix Plan (by priority)

### P0 - Make notifications and positions consistent
1) Start the notification poller in the bot entrypoint and align notification types.
   - Files: apps/bot/src/index.ts, apps/bot/src/services/notifications.ts,
     apps/hunter/src/loops/execution.ts, apps/hunter/src/queues/exitQueue.ts.
   - Logic: ensure DB notifications are actually delivered, then normalize types and payload
     keys so formatting is correct for both BUY and SELL paths.

2) Resolve positions user identifier mismatch (tg_id vs user_id).
   - Files: packages/database/migrations/001_initial.sql, packages/database/migrations/006_v31_complete.sql,
     packages/shared/src/supabase.ts.
   - Logic: keep `tg_id` as source of truth; update write paths (createPositionV31 + any inserts)
     to use `tg_id` and keep reads consistent.

### P1 - Fix TP/SL state machine and duplicate triggers
3) Update trigger_state transitions during execution and on completion/failure.
   - Files: apps/hunter/src/loops/execution.ts, packages/database/migrations/014_tpsl_engine_state.sql,
     packages/shared/src/supabase.ts (add RPC wrapper helpers).
   - Logic: call mark_position_executing before sell, mark_trigger_completed on success,
     mark_trigger_failed on failure to keep state machine correct and recoverable.

4) Prevent legacy monitor from firing when TP/SL engine is active.
   - Files: apps/hunter/src/loops/positions.ts, apps/hunter/src/index.ts,
     packages/shared/src/config.ts.
   - Logic: keep shadow mode but add trigger_state checks so only MONITORING positions
     can enqueue exits; add dedupe guard keyed by trigger_state.

### P2 - Correct TP/SL pricing inputs and WS hints
5) Use stored tp_price/sl_price when present and persist them at position creation.
   - Files: apps/hunter/src/loops/tpslMonitor.ts, packages/shared/src/supabase.ts,
     packages/database/migrations/014_tpsl_engine_state.sql.
   - Logic: treat `tp_price`/`sl_price` as immutable for open positions; compute once at entry.

6) Store bonding curve or pool pubkey on positions for WS activity hints.
   - Files: packages/shared/src/supabase.ts, apps/hunter/src/loops/tpslMonitor.ts,
     packages/shared/src/types.ts, packages/database/migrations/006_v31_complete.sql (if column missing).
   - Logic: populate `bonding_curve` from the opportunity (or pump.fun create data) so WS hints
     target the right account.

## Research Topics (web)
- Jupiter price API coverage for pump.fun pre-graduation tokens.
- PumpSwap pool reserve accounts for price (base/quote ATA derivation).
- Helius logsSubscribe limitations (single pubkey) + inactivity timer guidance.
- Bonding curve PDA derivation and synthetic reserve layout.
- Token-2022 ATA derivation specifics for pump.fun.

## Test/Verify Plan
- Unit: trigger_state transition helpers, TP/SL price evaluation, notification formatting.
- Integration: single trigger claim under burst load, exit job created once, trigger_state updated.
- E2E: open position -> TP/SL trigger -> exit -> notification delivered.
