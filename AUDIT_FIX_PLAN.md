# RAPTOR Audit Fix Plan (Round 2)

Scope: bot, hunter, executor, TP/SL engine, notifications, worker coordination.

## Confirmed Decisions (from owner)
- Positions table uses `tg_id` (not `user_id`); positions stay on tg_id for compatibility.
- TP/SL thresholds are fixed at entry; `tp_price`/`sl_price` are source of truth for open positions.
- Shadow mode stays: `TPSL_ENGINE_ENABLED=true` and `LEGACY_POSITION_MONITOR=true`.
- Notifications are DB-poller based (worker -> notifications table -> NotificationPoller).
- `bonding_curve` exists on positions but must be populated from opportunity at creation.
- TP/SL engine standardizes on `positions.uuid_id` for all claims/exits.
- TP/SL notifications are sent after sell only (no trigger-time placeholders).
- Legacy monitor must use atomic claim (`trigger_exit_atomically`) before enqueueing.
## Maintainer Decisions (this plan)
- Enforce `positions.uuid_id` as NOT NULL with a unique index after backfill.
- `TRADE_DONE` is BUY-only; SELL exits rely on TP/SL-specific notifications after close.

## Key Findings (summary)
- TP/SL RPCs take UUIDs but compare against `positions.id` (SERIAL), so claims/transitions fail.
- v3.1 `PositionV31` assumes `user_id`, but positions store `tg_id` (exit jobs can have undefined userId).
- TP/SL notifications are created at trigger time with placeholder `solReceived`/`txHash` and never updated.
- `TRADE_DONE` payload is wrong for SELL (amount_sol undefined, tokens is SOL received).
- Legacy monitor lacks atomic claim; shadow mode can still enqueue duplicates.
- Notification retry writes `last_error` (non-existent) and uses a missing `increment` RPC.

## Fix Plan (by priority)

### P0 - Schema + RPC correctness (blocking)
1) Add migration `015_tpsl_uuid_and_notifications.sql`.
   - Files: packages/database/migrations/015_tpsl_uuid_and_notifications.sql.
   - Logic:
     - Backfill `positions.uuid_id` where NULL; then enforce NOT NULL.
     - Add unique index on `positions.uuid_id`.
     - Update TP/SL RPCs (`trigger_exit_atomically`, `mark_position_executing`,
       `mark_trigger_completed`, `mark_trigger_failed`) to use `WHERE uuid_id = p_position_id`.
     - Add `mark_notification_failed()` RPC to atomically increment attempts and set `delivery_error`.

### P1 - Shared types + helpers
2) Align `PositionV31` and add uuid helpers.
   - Files: packages/shared/src/types.ts, packages/shared/src/supabase.ts.
   - Logic:
     - Add `uuid_id` and `tg_id` to `PositionV31`; remove/avoid `user_id`.
     - Add `getPositionByUuid()` and `closePositionByUuid()` helpers.
     - Ensure TP/SL RPC wrappers accept uuid_id.

### P2 - TP/SL engine + legacy monitor
3) Standardize TP/SL engine on uuid_id and tg_id.
   - Files: apps/hunter/src/loops/tpslMonitor.ts, apps/hunter/src/queues/exitQueue.ts.
   - Logic:
     - Use `position.uuid_id` for idempotency keys, trigger claims, and exit job payload.
     - Use `position.tg_id` for user notifications and job ownership.

4) Legacy monitor uses atomic claim before enqueueing.
   - Files: apps/hunter/src/loops/positions.ts.
   - Logic:
     - Call `trigger_exit_atomically()` with uuid_id; only enqueue if claim succeeds.

### P3 - Notifications and execution flow
5) Emit TP/SL notifications after sell only.
   - Files: apps/hunter/src/loops/execution.ts, apps/hunter/src/queues/exitQueue.ts,
     apps/hunter/src/loops/positions.ts, apps/bot/src/services/notifications.ts.
   - Logic:
     - Remove trigger-time placeholder notifications (ExitQueue + legacy monitor).
     - After sell completes, emit `TP_HIT` / `SL_HIT` / `TRAILING_STOP_HIT` / `POSITION_CLOSED`
       with real `solReceived` and `txHash`.
     - Keep `TRADE_DONE` for BUY only (skip for SELL).

6) Fix notification retry updates.
   - Files: packages/shared/src/supabase.ts, packages/database/migrations/015_tpsl_uuid_and_notifications.sql.
   - Logic:
     - Use `delivery_error` column.
     - Increment `delivery_attempts` atomically via RPC.
     - Clear claim fields on failure for retries.

## Research Topics (web)
- Jupiter price API coverage for pump.fun pre-graduation tokens.
- PumpSwap pool reserve accounts for price (base/quote ATA derivation).
- Helius logsSubscribe limitations (single pubkey) + inactivity timer guidance.
- Bonding curve PDA derivation and synthetic reserve layout.
- Token-2022 ATA derivation specifics for pump.fun.

## Test/Verify Plan
- Unit: uuid-based RPCs, notification retry RPC, TP/SL notification formatting after sell.
- Integration: single trigger claim under burst load, exit job created once, trigger_state updated.
- E2E: open position -> TP/SL trigger -> sell -> TP/SL notification delivered with tx hash.
