# RAPTOR Autohunt Audit Fix Plan (Round 3)

Scope: Autohunt pipeline A-Z (UI -> strategy persistence -> opportunity intake -> scoring/filters -> trade jobs -> execution -> notifications).

## Status Update (post pump.pro metadata issues)
- Social metadata hard stops are relaxed to soft scoring (URI/Twitter/website/image are not hard stops).
- Creator holdings <=10% is bypassed when holdings are unknown (allows pump.pro timing issues).
- Snipe mode still sets metadata timeout, but no forced full fetch (speed can skip more often).

## Status Update (post-implementation)
- Retryable jobs can reuse FAILED executions via `p_allow_retry` (Migration 016).
- OpportunityLoop now scores per snipe mode (speed vs quality) and avoids early COMPLETED.
- Auto-execute disabled now prevents job creation (marks QUALIFIED only).
- Token allowlist enforced when configured.
- Legacy hunt callbacks route to new Arm/Disarm + Settings panels.
- Settings slippage copy aligned to 1-99%; snipe mode UI normalized to speed/quality.

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
1) **Retryable autohunt jobs cannot actually retry.**
   - ExecutionLoop marks executions as FAILED even when the job is retryable.
   - `reserve_trade_budget` blocks any retry once an execution is FAILED ("Already executed").
   - Result: retryable jobs are re-queued but immediately rejected on the next attempt.
   - Files: `raptor/apps/hunter/src/loops/execution.ts`, `raptor/packages/database/migrations/009_manual_trade_fix.sql`

2) **Legacy hunt UI still active and inconsistent with current strategy settings.**
   - Legacy callbacks (`menu_hunt`, `hunt_chain_*`, etc.) still route to `raptor/apps/bot/src/commands/hunt.ts`.
   - That flow uses `hunt_settings` (user_settings) with different defaults (minScore=23, snipeMode=balanced) and a different field model (maxPositionSize vs max_positions).
   - Risk: users can update old panels and drift from strategy-based settings used by autohunt execution.
   - Files: `raptor/apps/bot/src/handlers/callbacks.ts`, `raptor/apps/bot/src/commands/hunt.ts`, `raptor/packages/shared/src/supabase.ts`

3) **Opportunity lifecycle is inconsistent (duplicates and early COMPLETED).**
   - In `raptor/apps/hunter/src/loops/opportunities.ts`, duplicate job creation is treated as failure (jobsCreated stays 0).
   - This sets opportunity status to REJECTED even though jobs already exist, and prevents `complete_opportunity_if_terminal` from resolving the opportunity.
   - Opportunities are marked COMPLETED immediately after job creation, so DB outcome updates never run (they require status EXECUTING).
   - Files: `raptor/apps/hunter/src/loops/opportunities.ts`, `raptor/packages/database/migrations/006_v31_complete.sql`

### P1 - Functional Gaps
4) **AUTO_EXECUTE_ENABLED does not gate job creation.**
   - `OpportunityLoop` still creates jobs even when auto-execute is disabled (env flag).
   - Jobs may accumulate and execute later unexpectedly.
   - Files: `raptor/apps/hunter/src/index.ts`, `raptor/apps/hunter/src/loops/opportunities.ts`

5) **Strategy allowlist is never enforced.**
   - `strategyMatchesOpportunity` ignores `token_allowlist` entirely.
   - Users expecting allowlist-only autohunt will still buy anything that passes scoring.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

6) **Min liquidity filter is effectively no-op for pump.fun.**
   - `opportunity.initial_liquidity_sol` is never populated for pump.fun creates, so min_liquidity checks are skipped.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts` + `raptor/packages/shared/src/supabase.ts`

7) **Snipe mode is per-user but globally aggregated.**
   - `getMostThoroughSnipeMode()` chooses the slowest mode across all enabled strategies.
   - A single “quality” user forces 2s metadata waits for all “speed” users.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

8) **Global quality gate is relaxed for pump.pro testing.**
   - Social metadata rules and holdings checks are no longer hard stops.
   - This allows trades without socials or verified holdings when metadata is missing.
   - File: `raptor/apps/hunter/src/scoring/rules.ts`

### P2 - Design/UX Mismatches
9) **Priority fee source mismatch.**
   - Autohunt jobs store `priority_fee_lamports` (strategy), but ExecutionLoop ignores it and uses `chain_settings.priority_sol` via tgId.
   - User-facing priority control in Settings updates `chain_settings`, not strategy.
   - Potential confusion and stale strategy field.
   - Files: `raptor/apps/hunter/src/loops/opportunities.ts`, `raptor/apps/hunter/src/loops/execution.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

10) **Slippage UI mismatch.**
   - UI prompt says “1-1000%”, handler rejects >99%.
   - File: `raptor/apps/bot/src/ui/panels/settings.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

11) **Global min-score floor is implicit.**
   - `scoreOpportunity` uses `MIN_QUALIFICATION_SCORE = 23`, so user `min_score < 23` never takes effect.
   - Legacy UI still displays “score /35” while scoring weights sum to 63.
   - Files: `raptor/apps/hunter/src/scoring/scorer.ts`, `raptor/apps/bot/src/commands/hunt.ts`

12) **Snipe mode UI is inconsistent with stored values.**
   - New Settings only exposes speed/quality, but legacy hunt can set balanced.
   - Settings display treats any non-speed as “Quality”, masking “balanced”.
   - Files: `raptor/apps/bot/src/ui/panels/settings.ts`, `raptor/apps/bot/src/commands/hunt.ts`

## Fix Plan (no code changes yet)

### P0 - Unify autohunt settings surface
1) Fix retryable job idempotency.
   - Ensure retryable trade jobs can reuse their execution record.
   - Option A: For retryable failures, keep execution status non-terminal (do not set FAILED).
   - Option B: Allow `reserve_trade_budget` to reopen a FAILED execution when the job is retrying.
   - Files: `raptor/apps/hunter/src/loops/execution.ts`, `raptor/packages/database/migrations/009_manual_trade_fix.sql`

2) Retire legacy hunt settings UI or route legacy callbacks to new panels.
   - Option A: Remove `menu_hunt` legacy flow and forward to `CB.HUNT.*`/Settings.
   - Option B: Keep legacy UI but fully sync all fields both ways (not recommended).
   - Files: `raptor/apps/bot/src/handlers/callbacks.ts`, `raptor/apps/bot/src/commands/hunt.ts`

3) Fix opportunity lifecycle and dedupe handling.
   - If duplicate key, increment “created” count or mark status as COMPLETED/ALREADY_QUEUED.
   - Use `scoring.hardStopReason` in `status_reason` when hard stops occur.
   - Keep opportunities in EXECUTING until jobs are terminal; let DB function set outcome.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

### P1 - Close functional gaps
4) Gate job creation when auto-execute is disabled.
   - If `AUTO_EXECUTE_ENABLED` is false, skip job creation and mark opportunities as QUALIFIED only.
   - Files: `raptor/apps/hunter/src/index.ts`, `raptor/apps/hunter/src/loops/opportunities.ts`

5) Enforce `token_allowlist` if non-empty.
   - Only match strategies when mint is in allowlist, or explicitly document if not supported.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

6) Either compute initial liquidity for pump.fun or drop the min_liquidity filter.
   - If keeping it, populate `initial_liquidity_sol` at detection time or from bonding-curve state.
   - Files: `raptor/apps/hunter/src/loops/opportunities.ts`, `raptor/apps/hunter/src/monitors/pumpfun.ts`

7) Per-user snipe mode behavior.
   - Option A: Partition scoring by snipe mode (per-user metadata fetch).
   - Option B: Remove “speed” in multi-user contexts and document quality-only behavior.
   - File: `raptor/apps/hunter/src/loops/opportunities.ts`

8) Decide if relaxed quality gate is acceptable for pump.pro testing.
   - Option A: Keep relaxed until pump.pro metadata stabilizes.
   - Option B: Re-enable hard stops and block tokens without socials/holdings.
   - File: `raptor/apps/hunter/src/scoring/rules.ts`

### P2 - UX alignment and cleanup
9) Align priority fee behavior.
   - Either pass job payload priority to executor OR remove strategy priority to avoid confusion.
   - Files: `raptor/apps/hunter/src/loops/execution.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

10) Fix slippage range mismatch in settings.
   - Align prompt text and validation range.
   - Files: `raptor/apps/bot/src/ui/panels/settings.ts`, `raptor/apps/bot/src/handlers/settingsHandler.ts`

11) Make global min-score floor explicit.
   - Expose the floor in UI or adjust `MIN_QUALIFICATION_SCORE` to match user range.
   - Update legacy UI or remove it.
   - Files: `raptor/apps/hunter/src/scoring/scorer.ts`, `raptor/apps/bot/src/commands/hunt.ts`

12) Align snipe mode UI with stored values.
   - Either remove “balanced” from legacy flows or surface it in Settings.
   - Files: `raptor/apps/bot/src/ui/panels/settings.ts`, `raptor/apps/bot/src/commands/hunt.ts`

## Implementation Plan (detailed tasks + owners)

### P0.0 Retryable job idempotency
Owner: Hunter agent + DB agent
Tasks:
- Ensure retryable jobs can re-use the same execution record.
  - Option A: If a job is retryable, do not set execution status to FAILED; keep it RESERVE/SUBMITTED and update on success or final failure.
  - Option B: Update `reserve_trade_budget` to allow reopening a FAILED execution when the trade job is retrying.
- Decide which layer owns this behavior (ExecutionLoop vs RPC).
Files:
- `raptor/apps/hunter/src/loops/execution.ts`
- `raptor/packages/database/migrations/009_manual_trade_fix.sql`
Acceptance:
- Retryable jobs execute more than once and do not immediately fail with “Already executed”.

### P0.1 Unify autohunt settings (single source of truth)
Owner: Bot agent
Tasks:
- Route legacy Hunt entry points to the new flow.
  - In `raptor/apps/bot/src/handlers/callbacks.ts`, replace legacy `showHunt` import/usage from `commands/hunt.ts` with `handlers/huntHandler.showHunt` or direct Settings.
  - For `menu_hunt`, `back_to_hunt`, and `hunt`, open the new arm/disarm panel (which already links to Settings).
- Deprecate legacy hunt callback routes (`hunt_chain_*`, `hunt_score_*`, `hunt_size_*`, `hunt_slip_*`, `hunt_priority_*`, `hunt_snipe_*`, `hunt_tp_*`, `hunt_sl_*`).
  - Option A (preferred): remove these branches in `raptor/apps/bot/src/handlers/callbacks.ts` and update keyboards so they are never emitted.
  - Option B: keep the routes but show a one-line “Use Settings” panel that links to `CB.SETTINGS.OPEN`.
- Stop writing `hunt_settings` for autohunt configuration.
  - Either delete the legacy flows in `raptor/apps/bot/src/commands/hunt.ts` or ensure they are unreachable.
  - Confirm that only `strategies` and `chain_settings` are used as source of truth.
Acceptance:
- No UI path writes to `hunt_settings` for autohunt.
- “Hunt” only arms/disarms; “Settings” changes parameters.

### P0.2 Opportunity status and dedupe semantics
Owner: Hunter agent
Tasks:
- Make `createBuyJob()` return a result (created / deduped / failed).
  - If Supabase returns existing job (duplicate idempotency key), treat as `deduped` and count as created.
- Adjust opportunity status rules:
  - If at least one job created/deduped, keep status as EXECUTING (do not mark COMPLETED early).
  - If all matching strategies were deduped, check existing jobs and set COMPLETED only when terminal.
- Add `status_reason` for rejections using `scoring.hardStopReason` or “score below minimum.”
Files:
- `raptor/apps/hunter/src/loops/opportunities.ts`
- `raptor/packages/shared/src/supabase.ts` (optional helper to query jobs by opportunity)
Acceptance:
- Duplicate token events never mark opportunities as REJECTED when jobs already exist.
- Opportunities do not bypass DB outcome updates.

### P1.0 Gate job creation when auto-execute is disabled
Owner: Hunter agent
Tasks:
- If `AUTO_EXECUTE_ENABLED` is false, skip job creation and mark opportunities as QUALIFIED with reason.
- Prevent backlog of jobs that execute unexpectedly later.
Files:
- `raptor/apps/hunter/src/loops/opportunities.ts`
Acceptance:
- Monitor-only mode does not create trade_jobs.

### P1.1 Enforce token allowlist
Owner: Hunter agent
Tasks:
- In `strategyMatchesOpportunity`, add allowlist check:
  - If `strategy.token_allowlist` is non-empty, only match if the mint is in the list.
  - Keep denylist behavior unchanged.
Files:
- `raptor/apps/hunter/src/loops/opportunities.ts`
Acceptance:
- Allowlist-only strategies do not buy unlisted tokens.

### P1.2 Make min_liquidity meaningful on pump.fun (or remove it)
Owner: Hunter agent + Executor agent (if using pump.fun decoding)
Tasks (Option A: compute):
- At detection time, compute `initial_liquidity_sol` from bonding curve state.
  - Use pump.fun bonding curve decode utilities from executor (`deriveBondingCurvePDA`, `decodeBondingCurveState`).
  - Map “liquidity” to `realSolReserves` (or another chosen metric) and store in `opportunities.initial_liquidity_sol`.
- Pass this field into `upsertOpportunity`.
Tasks (Option B: remove):
- If not computing, document that min_liquidity is ignored for pump.fun and remove the check for source `pump.fun`.
Files:
- `raptor/apps/hunter/src/loops/opportunities.ts`
- `raptor/apps/executor/src/chains/solana/pumpFun.ts` (if reused)
Acceptance:
- min_liquidity either works with real data or is explicitly disabled for pump.fun.

### P1.3 Per-user snipe mode behavior (avoid global slowdown)
Owner: Hunter agent
Tasks:
- Group enabled AUTO strategies by `snipe_mode`.
- Fetch metadata separately per mode with its timeout (speed vs quality).
- Score once per mode and only apply results to strategies in that mode.
- Ensure global social hard-stops still apply (speed can skip more often).
Files:
- `raptor/apps/hunter/src/loops/opportunities.ts`
Acceptance:
- Speed users are not forced into quality delays by other users.

### P1.4 Decide relaxed quality gate behavior (pump.pro)
Owner: Hunter agent
Tasks:
- Confirm whether relaxed rules are intentional for testing.
- If not, re-enable hard stops for socials and holdings.
Files:
- `raptor/apps/hunter/src/scoring/rules.ts`
Acceptance:
- Policy matches current testing goals (relaxed vs strict).

### P2.1 Align priority fee source of truth
Owner: Hunter agent + Bot agent
Tasks (Option A: chain_settings only):
- Remove `priority_fee_lamports` usage from job payloads and UI expectations.
- Make it clear in Settings that priority fee is per-chain (not per-strategy).
Tasks (Option B: per-job override):
- Pass `job.payload.priority_fee_lamports` into executor options (convert to SOL).
- Document precedence: job payload overrides chain_settings.
Files:
- `raptor/apps/hunter/src/loops/opportunities.ts`
- `raptor/apps/hunter/src/loops/execution.ts`
- `raptor/apps/bot/src/handlers/settingsHandler.ts`
Acceptance:
- Priority fee a user sets is actually used on trades.

### P2.2 Fix slippage range mismatch in Settings
Owner: Bot agent
Tasks:
- Align the prompt text to the enforced validation range (1–99%), or change validation to match text.
Files:
- `raptor/apps/bot/src/ui/panels/settings.ts`
- `raptor/apps/bot/src/handlers/settingsHandler.ts`
Acceptance:
- UI and validation accept the same range.

### P2.3 Make global min-score floor explicit
Owner: Hunter agent + Bot agent
Tasks:
- Either remove the hardcoded floor (`MIN_QUALIFICATION_SCORE`) or surface it in UI/docs.
- If kept, ensure UI shows the actual score scale (current weights sum to 58, not 35).
Files:
- `raptor/apps/hunter/src/scoring/scorer.ts`
- `raptor/apps/bot/src/commands/hunt.ts` (or remove legacy UI)
Acceptance:
- User min_score behaves as expected with no hidden global floor.

### P2.4 Align snipe mode UI with stored values
Owner: Bot agent
Tasks:
- Remove “balanced” from legacy flows or surface it in the Settings panel.
- If legacy is removed, ensure Settings is the only source.
Files:
- `raptor/apps/bot/src/ui/panels/settings.ts`
- `raptor/apps/bot/src/commands/hunt.ts`
Acceptance:
- Snipe mode shown in UI matches the stored value.

## Documentation Updates
Owner: Docs agent
Tasks:
- Update `raptor/MUST_READ/Changelog.md` and `raptor/MUST_READ/Project_status.md` after fixes.
- If legacy hunt UI is removed, update `raptor/MUST_READ/PROMPT.md` and any help text.

## Verification Plan
- Unit: strategy matching (allowlist), scoring hard-stop reason, duplicate job handling.
- Integration: simulate duplicate job creation + opportunity status, per-user snipe mode behavior.
- E2E: arm hunt -> new token -> scoring -> job creation -> execution -> notifications.
