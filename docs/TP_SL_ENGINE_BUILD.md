The separation is about determinism, safety, and operational resilience. In a trading system, the “TP/SL engine” and the “buy/sell executor” have fundamentally different runtime characteristics and failure modes, so separating them reduces risk and improves performance.

Here is the logic, precisely.

1) Different Responsibilities and Latency Profiles
TP/SL engine (monitor + trigger)

I/O bound: consumes WebSocket streams, parses events, computes mark prices.

Needs to react in milliseconds to price updates.

Runs continuously, 24/7, with reconnect logic and subscription state.

Executor (transaction builder + signer)

Execution bound: builds swaps, requests quotes, signs, submits, retries, handles failures.

Has to be correct and idempotent, not necessarily “always-on streaming.”

If you mix them, spikes in one side degrade the other. A slow quote response or stuck swap can block or slow down WS processing, which is exactly when you most need fast reaction.

2) Backpressure and “Do Not Execute in the WS Callback”

The TP/SL engine receives bursts (especially on pump.fun / PumpSwap). If you execute swaps directly in the same process/thread as WS handling:

bursts of ticks → bursts of swap attempts

swap attempts are slower than ticks

tick processing falls behind → you miss triggers or execute late

memory grows (event queue grows) → process becomes unstable

Separating them forces the correct pattern:

WS tick → evaluate → enqueue job
executor consumes queue at controlled concurrency

That’s the core “backpressure” design in production event-driven systems.

3) Exactly-Once Triggering and Idempotency Are Easier

You need two separate “exactly-once” guarantees:

Trigger fires once (TP/SL reached)

Sell executes once (no double-sell)

When monitor and executor are separate, you can enforce this cleanly:

Monitor does atomic DB claim: NONE → TRIGGERED_*

Executor enforces idempotencyKey: positionId + trigger

Even if the monitor crashes mid-flight, the executor won’t double-execute. Even if WS duplicates events, the DB claim prevents duplicate triggers.

When everything is one combined blob, people often “shortcut” the state machine, and double-execution bugs creep in during volatility.

4) Reliability: One Can Crash Without Taking Down the Other

In real markets you will hit:

WS disconnects

malformed logs

RPC timeouts

quote API failures

sudden token-account data anomalies

If parsing logic crashes a combined process, you also lose your execution path. If an execution path panics, you also lose monitoring.

Separation gives you:

Monitor can restart and resubscribe without impacting the executor.

Executor can restart without losing subscription state (monitor keeps running).

Cleaner alerts: you know which subsystem failed.

5) Security Boundary and Key Exposure

If your executor holds signing keys, you want that process to:

do as little as possible

expose minimal surface area

have minimal dependencies

The TP/SL engine typically pulls in:

websocket clients

log decoders

parsers

more code = more bugs

Keeping monitoring separate reduces the chance that a parser bug or dependency issue impacts the signer process.

Even if both run on the same machine, separation still reduces risk.

6) Scalability and Future-Proofing

Today it may be one droplet. Later you might want:

multiple monitors (by chain or by token type)

one shared executor (single-writer)

monitoring in multiple regions (edge) but execution centralized

adding more strategies that subscribe to more streams

If your architecture is already separated:

scaling is mostly configuration and deployment

not a refactor of core logic

Practical Bottom Line

You can run TP/SL monitoring inside the executor (as a background worker) and it will work early-stage.

But separating them gives you:

better latency under load

safer execution semantics (exactly-once is easier)

better crash isolation

cleaner security posture

easier scaling later

Given RAPTOR’s promise (automation + speed on Solana launchpads), separation is the more production-correct approach.

RAPTOR TP/SL Engine Integration Build Plan (Revised + References)
0) Non-Negotiable Design Principles

Monitoring must be event-driven (WebSocket), not polling.

Sell execution must not occur inside WS callbacks (use a queue with backpressure).

Exactly-once triggering must be enforced via atomic DB state transitions + idempotency keys.

Token-scoped subscriptions (one subscription per token; many positions watch it).

Executor and monitor are separate services (bot/UI stays thin).

1) Reference Docs (Exact Links to Use During Build)
Solana (RPC WebSocket + Accounts)

Solana RPC WebSocket methods overview: https://solana.com/docs/rpc/websocket

logsSubscribe method (Solana docs): https://solana.com/docs/rpc/websocket/logssubscribe

SPL Token basics (accounts, mints, decimals): https://spl.solana.com/token

Helius (WebSocket endpoints, limitations, enhanced WS)

Helius WebSocket overview / troubleshooting (endpoint format, stability): https://www.helius.dev/docs/rpc/websocket

Helius WebSocket methods index: https://www.helius.dev/docs/api-reference/rpc/websocket-methods

Helius logsSubscribe page (includes 10-minute inactivity timer + ping guidance): https://www.helius.dev/docs/api-reference/rpc/websocket/logssubscribe

Helius RPC endpoints: https://www.helius.dev/docs/api-reference/endpoints

(Optional) Helius Enhanced WebSockets: https://www.helius.dev/docs/enhanced-websockets

Jupiter (Quote + Swap execution)

Jupiter “Get Quote” docs: https://dev.jup.ag/docs/swap/get-quote

Jupiter API reference (note deprecations / migrations): https://dev.jup.ag/api-reference

Jupiter quote endpoint API reference: https://dev.jup.ag/api-reference/swap/quote

Anchor event encoding (for bonding curve log parsing)

Anchor events: emits base64 Program Data: and decoding approach: https://www.anchor-lang.com/docs/features/events

(Source reference if needed): https://github.com/coral-xyz/anchor/blob/master/docs/content/docs/features/events.mdx

Supabase / Postgres (atomic trigger claiming)

Supabase DB overview: https://supabase.com/docs/guides/database/overview

Postgres realtime subscription options (optional, for cache sync): https://supabase.com/docs/guides/realtime/subscribing-to-database-changes

2) Target Runtime Architecture (What Goes Where)
Services (Docker)

apps/bot (Telegram long polling UI)

Configure TP/SL, arm/disarm, show state, show tx links.

apps/executor (execution engine)

Owns swaps, budget reservation, idempotency, final DB writes, notifications.

apps/tpsl-monitor (NEW)

Connects to Helius WS, maintains subscriptions, computes price, evaluates triggers, queues exit jobs.

Correction / hardening:

Use Helius WS endpoint format exactly (wss URL with api-key).

Implement keepalive pings (Helius has a documented inactivity timer).

3) Database Design (State Machine That Prevents Double Sells)
Positions table fields (minimum)

tp_bps, sl_bps (int)

tp_price, sl_price (numeric) — store targets at entry time (reduces recompute errors)

tpsl_armed (bool)

trigger_state (enum/text): NONE | TRIGGERED_TP | TRIGGERED_SL | EXECUTING | CLOSED | FAILED

triggered_at (timestamp)

exit_trigger (TP|SL|EMERGENCY|MANUAL)

exit_tx (text)

last_mark_price (numeric), last_price_at (timestamp)

Atomic claim (critical)

On trigger detection, do a single atomic update that only succeeds once:

UPDATE positions SET trigger_state=... WHERE id=? AND trigger_state='NONE' RETURNING ...
If it returns zero rows → someone already claimed it.

Why this matters: prevents race conditions when multiple WS updates arrive quickly.

4) TP/SL Monitor Internals (Modules)
4.1 HeliusWsClient

Connect to Helius WS (wss endpoint with api-key).

Implement:

reconnect with exponential backoff

resubscribe on reconnect

ping/heartbeat (at least every 60s) to avoid inactivity disconnects.

4.2 SubscriptionManager (token-scoped pooling)

Data structure:

Map<mint, TokenSubscription>

TokenSubscription contains:

mode: PUMPSWAP_POOL | BONDING_CURVE

WS subscription ids

latestPrice, lastUpdateAt

watchers: Set<positionId>

Rules:

subscribe once per token

add/remove watchers as positions arm/disarm

auto-unsubscribe when watchers set becomes empty

4.3 Price Engines
A) PumpSwap / “Graduated” tokens via reserve accounts

Use accountSubscribe to both reserve token accounts (base + quote).

Compute price from reserve ratio:

Use raw integers from token accounts

Normalize by mint decimals (SPL token doc)

Decide a standard unit: price = quote_per_base

Important correctness checks

Ensure you are subscribing to the actual pool reserve token accounts (not random ATAs).

Ensure you handle decimals correctly (base/quote may differ).

B) Bonding curve tokens via program logs

Use logsSubscribe filtered to the bonding curve program / mentions.

Parse trade events:

If Anchor-emitted, decode base64 log entries prefixed with Program Data:.

Extract virtual reserves, compute price.

Key correction:
Do not assume all program logs are Anchor events. Implement:

a fast “does this log contain anchor event marker?” check

a safe decode path (invalid base64 must not crash the monitor)

4.4 TriggerEvaluator

On each price update:

Update token’s latestPrice

For each watching position:

if not armed or already triggered → skip

if price >= tp_price → TP trigger

if price <= sl_price → SL trigger

Attempt atomic DB claim

If claim succeeds → enqueue ExitJob

4.5 ExecutionQueue (Backpressure + Concurrency Limits)

Concurrency-limited worker (start with 3–5)

Never run swaps in WS callback

Job payload:

positionId, triggerType (TP|SL), idempotencyKey, slippageBps

Retry policy:

Retry once on transient network failures (e.g., quote fetch)

Do not infinite retry; mark FAILED and notify user/admin

5) Executor Integration (Reuse Your Existing Emergency-Sell Patterns)

Add/standardize an internal endpoint:

POST /internal/positions/:id/exit

Executor responsibilities:

Validate position eligible for exit

Idempotency (same strategy you used for emergency sells)

Budget reservation (atomic)

Swap via Jupiter:

Quote → Swap (use current Jupiter docs; note API changes/deprecations).

Update DB: CLOSED, exit_tx, PnL fields

Create notification record (bot consumes and sends)

Slippage policy (recommended)

SL: higher (faster exit)

TP: lower (better fill)

Make both configurable per strategy later; start with sane defaults.

6) Bot UI Changes (Telegram)

Position panel additions:

Set TP% / SL%

Arm/Disarm TP/SL

Status block:

Armed: Yes/No

Last mark price + timestamp

Target TP/SL prices

Trigger state

Exit tx link when closed

Bot never connects to WS.

7) Docker Compose Deployment (DigitalOcean)

Add tpsl-monitor service:

no published ports

depends on executor

env includes: HELIUS_API_KEY, SUPABASE_*, EXECUTOR_BASE_URL, INTERNAL_API_SECRET

Also ensure:

Executor API is not exposed publicly (internal only).

Keepalive enabled due to Helius inactivity behavior.

8) Phased Rollout Plan (Safe and Fast)
Phase 0 — Plumbing + schema

DB migrations

Executor internal exit endpoint

Bot UI config + feature flags

Phase 1 — PumpSwap monitoring (graduated tokens only)

accountSubscribe reserve watchers

price calc + trigger evaluator + queue

end-to-end TP/SL exits

Phase 2 — Bonding curve monitoring

logsSubscribe + robust parser (Anchor decode path + non-Anchor fallback)

integrate into same pipeline

Phase 3 — Resilience hardening

reconnect/resubscribe

stale price detection + UI warnings

bounded retry rules

dedupe tests under high tick rate

Phase 4 — Observability + tuning

metrics: tick rate, trigger latency, exit success rate, WS disconnects

admin alerts on failure spikes

tune slippage/priority fees based on real fills

9) Test Plan (What to Prove Before Mainnet)

Unit

decimal normalization

TP/SL threshold math

parser safety (bad logs cannot crash)

Integration

simulated WS tick burst → only one trigger claim succeeds

execution queue concurrency

E2E

open position → arm TP → simulate crossing → exit tx recorded + telegram notified

same for SL

simulate WS disconnect → monitor recovers and continues

10) Key Corrections vs the earlier plan (so you don’t get bitten)

Solana docs URLs are best referenced via solana.com/docs/... (not the old docs.solana.com paths).

Helius WS requires keepalive (documented inactivity timer).

Jupiter API docs have active deprecations/migrations; follow dev.jup.ag references, not stale community links.

Anchor events decode should key off Program Data: base64 logs; do not assume every log is Anchor.

Below is a phased, file-level implementation plan that you can hand directly to Claude/Cursor and build without ambiguity. I am assuming your current monorepo layout resembles what you’ve referenced already:

apps/bot (Telegram UI, long polling)

apps/executor (trade execution)

Supabase/Postgres for persistence

Docker-based deployment (single DO droplet)

If any path differs, the plan still holds; adjust paths accordingly.

Phase 0 — Foundations (DB + Contracts + Flags)
0.1 Database migrations (Supabase/Postgres)
Create migration

Add/ensure these columns exist on your positions table (name them consistently with your schema conventions):

Modify

supabase/migrations/XXXXXXXX_add_tpsl_fields.sql (or your migrations folder)

Columns

tpsl_armed boolean not null default false

tp_bps integer null

sl_bps integer null

tp_price numeric null

sl_price numeric null

trigger_state text not null default 'NONE'
Allowed: NONE | TRIGGERED_TP | TRIGGERED_SL | EXECUTING | CLOSED | FAILED

triggered_at timestamptz null

exit_trigger text null (TP/SL/EMERGENCY/MANUAL)

exit_tx text null

last_mark_price numeric null

last_price_at timestamptz null

Optional: trigger_error text null (for debugging failures)

Indexing (important)

(token_mint, tpsl_armed) or your equivalent token id field

(trigger_state, tpsl_armed) for the monitor’s query pattern

Acceptance criteria

Migration applies cleanly in Supabase

Existing positions default safely (tpsl_armed=false, trigger_state=NONE)

0.2 Shared types + constants

Add

packages/shared/src/tpsl.ts

TriggerState union type

ExitTrigger union type

Bps helpers

Modify

packages/shared/src/index.ts (export new module)

Acceptance criteria

No duplicated string literals across services for trigger states

0.3 Feature flags (env-driven)

Add

TPSL_MONITOR_ENABLED

TPSL_ENABLE_BONDING_CURVE

TPSL_MAX_CONCURRENT_EXITS (default 3)

TPSL_STALE_AFTER_SECONDS (default 20–60)

TPSL_SLIPPAGE_BPS_SL (e.g., 1500 = 15%)

TPSL_SLIPPAGE_BPS_TP (e.g., 500 = 5%)

Modify

apps/tpsl-monitor/src/config.ts (later)

apps/executor/src/config.ts (slippage defaults, internal auth)

Acceptance criteria

Entire feature can be disabled without code changes

Phase 1 — Executor Exit API (Idempotent, Internal, Reusable)

Goal: make TP/SL exits use the same execution discipline as Emergency Sell.

1.1 Add internal endpoint

Modify

apps/executor/src/routes/internal.ts (or similar)

apps/executor/src/server.ts (route wiring)

Add endpoint
POST /internal/positions/:id/exit

Request body

type ExitRequest = {
  trigger: 'TP' | 'SL' | 'EMERGENCY' | 'MANUAL';
  idempotencyKey: string;
  slippageBps?: number;
};


Behavior

Authenticate request (HMAC/secret header)

Load position + validate eligible (open, has balance, not closed)

Idempotency:

If idempotencyKey already seen → return previous result

Reserve budget (reuse reserveTradeBudget)

Execute sell via Jupiter (existing flow)

Update DB:

trigger_state = 'CLOSED'

exit_trigger = trigger

exit_tx = signature

last_mark_price/last_price_at optional update

Create notification record for bot

Add

apps/executor/src/services/positionExitService.ts

Implements core logic for exit request

Used by emergency + TP/SL + manual sell unify later

Acceptance criteria

A dry internal call can close a position and record exit_tx

Idempotency prevents double execution

1.2 Refactor Emergency Sell to use same exit service (optional but recommended)

Modify

apps/bot/src/services/emergencySellService.ts (if it currently does its own request wiring)

OR apps/executor emergency handler (depends on architecture)

Acceptance criteria

Emergency sell and TP/SL share the same execution pathway and DB semantics

Phase 2 — Bot UI: Arm/Disarm + Configure TP/SL (No Monitoring Yet)

Goal: Users can set TP/SL and arm it, but nothing auto-exits until monitor is enabled.

2.1 Update position panel UI

Modify

apps/bot/src/ui/panels/positionDetails.ts (or equivalent)

apps/bot/src/handlers/positionsHandler.ts

Add UI actions

“Set Take Profit %”

“Set Stop Loss %”

“Arm TP/SL”

“Disarm TP/SL”

Show status:

Armed: yes/no

TP target price + SL target price

Trigger state

Last mark update time

Exit tx link once closed

2.2 Update bot handlers

Add

apps/bot/src/handlers/tpslHandler.ts

Callback routing for set/arm/disarm

Validation (e.g., TP must be >0, SL must be >0)

Add

apps/bot/src/services/tpslService.ts

Compute target prices at entry:

tp_price = entry_price * (1 + tp_bps/10000)

sl_price = entry_price * (1 - sl_bps/10000)

Persist:

tp_bps, sl_bps, tp_price, sl_price, tpsl_armed

Reset trigger_state only if safe (must not reopen closed positions)

Acceptance criteria

You can arm/disarm TP/SL and see it reflected in DB and UI

No accidental trigger_state resets for already-closed positions

Phase 3 — New Service: apps/tpsl-monitor (PumpSwap Graduated Tokens Only)

Goal: Implement the real-time engine for the simpler case first: reserve-account based pricing.

3.1 Add the new app skeleton

Add

apps/tpsl-monitor/package.json

apps/tpsl-monitor/tsconfig.json

apps/tpsl-monitor/src/index.ts

apps/tpsl-monitor/src/config.ts

apps/tpsl-monitor/src/logger.ts

Modify

pnpm-workspace.yaml (ensure app is included)

Root build scripts if necessary

Acceptance criteria

pnpm -w build includes tpsl-monitor

3.2 Core modules (token pooling + backpressure)

Add

apps/tpsl-monitor/src/ws/heliusWsClient.ts

connect/reconnect

resubscribe after reconnect

heartbeat/ping timer

apps/tpsl-monitor/src/subscriptions/subscriptionManager.ts

Map<mint, TokenSubscription>

add/remove watchers

create/destroy subscriptions

apps/tpsl-monitor/src/pricing/pumpswapReservePrice.ts

given base/quote reserve balances + decimals → compute price

apps/tpsl-monitor/src/triggers/triggerEvaluator.ts

check TP/SL logic

attempt atomic claim in DB

apps/tpsl-monitor/src/queue/executionQueue.ts

concurrency-limited queue

calls executor internal exit endpoint

apps/tpsl-monitor/src/db/positionsRepo.ts

listArmedPositionsByMint(mint)

claimTrigger(positionId, triggerType) (atomic update)

updateLastMark(positionId, price, ts) (optional, rate-limited)

apps/tpsl-monitor/src/executor/executorClient.ts

signed internal POST to executor exit endpoint

Important implementation detail

Do not query DB per tick per position.

Keep an in-memory mapping:

mint -> Set<positionId>

positionId -> cachedPositionTargets

Refresh targets from DB periodically (e.g., every 5–15s), and also on state changes.

Acceptance criteria

Monitor subscribes once per mint and updates multiple positions efficiently

Trigger claims are exactly-once (atomic DB claim)

3.3 PumpSwap “graduated” subscription strategy

Implementation tasks

Identify “graduated token” positions:

based on a stored market_type/route field, or

based on presence of known pool accounts in DB

For each mint, subscribe to two accounts:

pool base reserve token account

pool quote reserve token account

On any reserve update:

fetch latest both reserves (from WS update + cached)

compute price

evaluate triggers

Acceptance criteria

In a test harness, simulated reserve changes cause TP/SL triggers and exit calls

Phase 4 — Bonding Curve Mode (Pre-Graduation Tokens)

Goal: Add log-parsing support as a second pricing engine.

4.1 Bonding curve log subscription + parsing

Add

apps/tpsl-monitor/src/pricing/bondingCurveLogsPrice.ts

apps/tpsl-monitor/src/parsers/anchorEventDecoder.ts

apps/tpsl-monitor/src/parsers/bondingCurveTradeParser.ts

Behavior

Subscribe to bonding curve program logs (filter by program id)

Parse trade logs:

Safe parse (never crash on invalid)

Extract virtual reserves and compute price

Feed into same triggerEvaluator and queue

Acceptance criteria

Feature flag gated: only active when TPSL_ENABLE_BONDING_CURVE=true

Parser failures do not crash process; they degrade gracefully

Phase 5 — Reliability Hardening (Production-grade)
5.1 WebSocket resilience

Modify

heliusWsClient.ts

Add:

exponential backoff

resubscribe reconciliation (ensure all active subscriptions are restored)

heartbeat/ping schedule

stale stream detection:

if now - lastUpdateAt > TPSL_STALE_AFTER_SECONDS, mark token stale and avoid triggering (or trigger with caution depending on your policy)

5.2 Queue + failure policy

Modify

executionQueue.ts

Add:

bounded retry once for transient failures (HTTP timeouts, quote fetch failures)

permanent failures mark position FAILED + trigger_error

alert notification to user/admin (configurable)

5.3 Idempotency end-to-end

Ensure:

DB atomic claim prevents multi-trigger

executor idempotency key prevents multi-execution even if monitor retries

Acceptance criteria

Under forced WS burst + executor retry conditions, no double sells occur

Phase 6 — Observability + Admin Controls
6.1 Metrics/logging

Add

apps/tpsl-monitor/src/metrics/metrics.ts (even if just structured logs initially)

Log:

WS connected/disconnected count

active subscriptions count

ticks per mint

trigger latency timestamps:

tick received

claim succeeded

exit request sent

tx signature returned

6.2 Admin kill-switch

Implement global kill switch:

TRADING_PAUSED=true prevents monitor from enqueuing exits (or prevents executor from executing exits)

Prefer enforcing at executor layer as the final gate

Acceptance criteria

You can pause exits instantly without redeploying

Phase 7 — Testing Plan (File-level)
7.1 Unit tests

Add

apps/tpsl-monitor/src/pricing/__tests__/pumpswapReservePrice.test.ts

apps/tpsl-monitor/src/triggers/__tests__/triggerEvaluator.test.ts

apps/tpsl-monitor/src/parsers/__tests__/bondingCurveTradeParser.test.ts

Covers:

decimals correctness

boundary conditions (exact TP hit, exact SL hit)

invalid log data safety

7.2 Integration tests (mock WS + mock executor)

Add

apps/tpsl-monitor/src/__tests__/integration.monitor.test.ts

mock ws messages → verify single trigger claim and single executor call

7.3 E2E (devnet/staging)

Checklist:

open position

arm TP

simulate price crossing (either by paper harness or controlled pool)

verify:

trigger_state transitions

exit signature stored

telegram notification sent

Docker Compose Changes (Deployment)

Modify

docker-compose.yml

Add service

tpsl-monitor

depends_on executor

internal-only networking

no published ports

Acceptance criteria

docker compose up -d starts bot + executor + monitor cleanly

monitor can be disabled via env flag without removing service

Implementation Order Summary (Fastest Safe Path)

Phase 0 (DB + types + flags)

Phase 1 (executor internal exit endpoint + idempotency)

Phase 2 (bot UI config + arm/disarm)

Phase 3 (monitor for PumpSwap graduated tokens)

Phase 5 (resilience + dedupe hardening)

Phase 4 (bonding curve support)

Phase 6–7 (metrics + tests + rollout)

This ordering is deliberate: it ensures you do not ship a monitor that can trigger exits before the execution and DB correctness layers are bulletproof.