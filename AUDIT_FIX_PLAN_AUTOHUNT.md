# RAPTOR Autohunt Audit Fix Plan (Round 3)

Scope: Autohunt pipeline A-Z (UI -> strategy persistence -> opportunity intake -> scoring/filters -> trade jobs -> execution -> notifications).

## Flow Map (A-Z)
1) User edits autohunt settings (trade size, TP/SL, slippage, priority, snipe mode).
   - UI: `raptor/apps/bot/src/ui/panels/settings.ts`
   - Handler: `raptor/apps/bot/src/handlers/settingsHandler.ts`
   - Storage: `strategies` + `chain_settings` in `raptor/packages/shared/src/supabase.ts`
2) User arms/disarms autohunt.
   - `raptor/apps/bot/src/handlers/huntHandler.ts` -> `updateStrategy(..., enabled: true/false)`
3) Hunter monitors pump.fun creates.
   - `raptor/apps/hunter/src/monitors/pumpfun.ts`
   - `raptor/apps/hunter/src/loops/opportunities.ts`
4) Hunter loads enabled AUTO strategies, fetches metadata, scores token.
   - `raptor/apps/hunter/src/loops/opportunities.ts`
   - `raptor/apps/hunter/src/scoring/scorer.ts`
   - `raptor/apps/hunter/src/scoring/rules.ts`
5) Hunter matches strategies and creates trade jobs.
   - `raptor/apps/hunter/src/loops/opportunities.ts`
   - `raptor/packages/shared/src/supabase.ts` (`createTradeJob`)
6) Execution loop claims jobs, reserves budget, executes trades, creates positions/notifications.
   - `raptor/apps/hunter/src/loops/execution.ts`
   - `raptor/packages/shared/src/supabase.ts` (`reserveTradeBudget`, `updateExecution`, `createPositionV31`)
7) Maintenance and cleanup.
   - `raptor/apps/hunter/src/loops/maintenance.ts`

## Key Findings (by severity)

### P0 - Logic/Consistency
1) **Legacy hunt UI still active and inconsistent with current strategy settings.**
   - Legacy callbacks (`menu_hunt`, `hunt_chain_*`, etc.) still route to `raptor/apps/bot/src/commands/hunt.ts`.
   - That flow uses `hunt_settings` (user_settings) with different defaults (minScore=23, snipeMode=balanced) and a different field model (maxPositionSize vs max_positions).
   - Risk: users can update old panels and drift from strategy-based settings used by autohunt execution.
   - Files: `raptor/apps/bot/src/handlers/callbacks.ts`, `raptor/apps/bot/src/commands/hunt.ts`, `raptor/packages/shared/src/supabase.ts`

2) **Opportunity status mislabels duplicates as failures.**
   - In `raptor/apps/hunter/src/loops/opportunities.ts`, duplicate job creation is treated as failure (jobsCreated stays 0).
   - This sets opportunity status to REJECTED even though jobs already exist, and prevents `complete_opportunity_if_terminal` from resolving the opportunity.
   - Files: `raptor/apps/hunter/src/loops/opportunities.ts`, `raptor/packages/database/migrations/006_v31_complete.sql`

### P1 - Functional Gaps
3) **Strategy allowlist is never enforced.**
   - `strategyMatchesOpportunity` ignores `token_allowlist` entirely.
   - Users expecting allowlist-only autohunt will still buy anything that passes scoring.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

4) **Min liquidity filter is effectively no-op for pump.fun.**
   - `opportunity.initial_liquidity_sol` is never populated for pump.fun creates, so min_liquidity checks are skipped.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts` + `raptor/packages/shared/src/supabase.ts`

5) **Snipe mode is per-user but globally aggregated.**
   - `getMostThoroughSnipeMode()` chooses the slowest mode across all enabled strategies.
   - A single “quality” user forces 2s metadata waits for all “speed” users.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

### P2 - Design/UX Mismatches
6) **Priority fee source mismatch.**
   - Autohunt jobs store `priority_fee_lamports` (strategy), but ExecutionLoop ignores it and uses `chain_settings.priority_sol` via tgId.
   - User-facing priority control in Settings updates `chain_settings`, not strategy.
   - Potential confusion and stale strategy field.
   - Files: `raptor/apps/hunter/src/loops/opportunities.ts`, `raptor/apps/hunter/src/loops/execution.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

7) **Slippage UI mismatch.**
   - UI prompt says “1-1000%”, handler rejects >99%.
   - File: `raptor/apps/bot/src/ui/panels/settings.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

8) **Global min-score floor is implicit.**
   - `scoreOpportunity` uses `MIN_QUALIFICATION_SCORE = 23`, so user `min_score < 23` never takes effect.
   - Legacy UI still displays “score /35” while scoring weights sum to 58.
   - Files: `raptor/apps/hunter/src/scoring/scorer.ts`, `raptor/apps/bot/src/commands/hunt.ts`

9) **AUTO_EXECUTE_ENABLED does not gate job creation.**
   - `OpportunityLoop` still creates jobs even when auto-execute is disabled (env flag).
   - Jobs may accumulate and execute later unexpectedly.
   - Files: `raptor/apps/hunter/src/index.ts`, `raptor/apps/hunter/src/loops/opportunities.ts`

## Fix Plan (no code changes yet)

### P0 - Unify autohunt settings surface
1) Retire legacy hunt settings UI or route legacy callbacks to new panels.
   - Option A: Remove `menu_hunt` legacy flow and forward to `CB.HUNT.*`/Settings.
   - Option B: Keep legacy UI but fully sync all fields both ways (not recommended).
   - Files: `raptor/apps/bot/src/handlers/callbacks.ts`, `raptor/apps/bot/src/commands/hunt.ts`

2) Treat duplicate trade jobs as already-created (not failure).
   - If duplicate key, increment “created” count or mark status as COMPLETED/ALREADY_QUEUED.
   - Use `scoring.hardStopReason` in `status_reason` when hard stops occur.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

### P1 - Close functional gaps
3) Enforce `token_allowlist` if non-empty.
   - Only match strategies when mint is in allowlist, or explicitly document if not supported.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

4) Either compute initial liquidity for pump.fun or drop the min_liquidity filter.
   - If keeping it, populate `initial_liquidity_sol` at detection time or from bonding-curve state.
   - Files: `raptor/apps/hunter/src/loops/opportunities.ts`, `raptor/apps/hunter/src/monitors/pumpfun.ts`

5) Per-user snipe mode behavior.
   - Option A: Partition scoring by snipe mode (per-user metadata fetch).
   - Option B: Remove “speed” in multi-user contexts and document quality-only behavior.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

### P2 - UX alignment and cleanup
6) Align priority fee behavior.
   - Either pass job payload priority to executor OR remove strategy priority to avoid confusion.
   - Files: `raptor/apps/hunter/src/loops/execution.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

7) Fix slippage range mismatch in settings.
   - Align prompt text and validation range.
   - Files: `raptor/apps/bot/src/ui/panels/settings.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

8) Make global min-score floor explicit.
   - Expose the floor in UI or adjust `MIN_QUALIFICATION_SCORE` to match user range.
   - Update legacy UI or remove it.
   - Files: `raptor/apps/hunter/src/scoring/scorer.ts`, `raptor/apps/bot/src/commands/hunt.ts`

9) Gate job creation when auto-execute is disabled.
   - If `AUTO_EXECUTE_ENABLED` is false, skip job creation or mark opportunity as QUALIFIED only.
   - Files: `raptor/apps/hunter/src/index.ts`, `raptor/apps/hunter/src/loops/opportunities.ts`

## Verification Plan
- Unit: strategy matching (allowlist), scoring hard-stop reason, duplicate job handling.
- Integration: simulate duplicate job creation + opportunity status, per-user snipe mode behavior.
- E2E: arm hunt -> new token -> scoring -> job creation -> execution -> notifications.
