# Architecture.md

This doc describes RAPTOR's current architecture and the Phase A plan (Autohunt-only). Keep it concise and update as the system evolves.

## High-level system

RAPTOR is a monorepo with separate services:
- **Telegram Bot** (`apps/bot`): UX, configuration, notifications.
- **Hunter** (`apps/hunter`): detects eligible launches and decides *whether* to trade.
- **Executor** (`apps/executor`): builds/signs/sends transactions and manages exits.
- **API** (`apps/api`): internal API and data access helpers (if used).
- **Shared packages** (`packages/*`): shared types, utilities, DB helpers.

Key principle: **reuse existing modules** (DB schema, trade models, RPC adapters, tx building). Prefer refactor and feature flags over re-implementing core logic.

## Phase A architecture (Autohunt-only)

### Components and responsibilities

**Bot (UI)**
- Renders panels (Home/Settings/Positions/Withdraw/Help).
- Persists user configuration (trade size, TP/SL, max positions, rate limits).
- Receives trade events (buy executed, sell closed, errors) and notifies user.

**Hunter (decision engine)**
- Watches launch sources (Bags.fm Telegram, Meteora on-chain) and emits candidates.
- Applies filters (risk rules, wallet constraints, max positions, cooldowns).
- Monitors graduation events and on-chain activity via Helius WebSocket.
- When approved, calls Executor with a concrete trade plan.

**Executor (execution engine)**
- Builds swap/tx instructions and submits.
- Tracks position state transitions: OPEN -> CLOSING -> CLOSED.
- Enforces timers server-side (TP/SL + optional max-hold) and is the single source of truth.
- Supports Emergency Sell (idempotent close).

### Data stores
- Supabase/Postgres is the system of record for: users, wallets, config, trades, positions, events.
- Never store plaintext private keys. Wallets table stores **public keys only** (self-custody constraint).

## Database Schema (Phase 0 Revamp)

The database schema was rebuilt from scratch for the Bags.fm/Meteora migration. See `docs/revamp/DB_BOOTSTRAP.md` for full details.

### Core Tables

| Table | Purpose |
|-------|---------|
| `users` | User identity, Telegram linkage, tiering |
| `wallets` | Public keys associated with users (no private keys, self-custody) |
| `user_settings` | Per-user preferences |
| `launch_candidates` | Normalized output from discovery layer |
| `positions` | Position lifecycle with explicit state machine (updated_at, tx sigs) |
| `executions` | Immutable trade log (idempotency anchor) |
| `notifications_outbox` | Transactional outbox with UUID→tgId resolution |
| `trade_jobs` | Durable job queue with SKIP LOCKED leasing |
| `strategies` | Per-user trading strategy configuration |
| `cooldowns` | Rate limiting for trade execution |
| `trade_monitors` | Active position monitoring state |
| `manual_settings` | Manual trade mode settings |
| `chain_settings` | Per-chain settings (priority fees, MEV protection) |

### Key Design Patterns

1. **Explicit State Machines**: Positions have `lifecycle_state` (PRE_GRADUATION → POST_GRADUATION → CLOSED) and `trigger_state` (MONITORING → TRIGGERED → EXECUTING → COMPLETED/FAILED)
2. **Idempotency**: Executions keyed by `idempotency_key` for exactly-once semantics
3. **Transactional Outbox**: Notifications use `notifications_outbox` with SKIP LOCKED leasing for crash recovery
4. **Self-Custody**: Wallets table stores pubkeys only; no private key material in DB

### Migrations

Located in `supabase/migrations/`. Run with:
```bash
pnpm db:reset       # Drop + migrate + seed (uses Supabase CLI)
pnpm db:push        # Apply to remote
supabase db reset   # Alternative: direct Supabase CLI
supabase db push    # Alternative: direct Supabase CLI
```

### SQL Functions (Phase-X)

Helper RPC functions in migrations:
- `fn_upsert_trade_monitor` — create or update monitor
- `fn_get_monitors_for_refresh` — get monitors due for refresh
- `fn_update_monitor_data` — update monitor market data
- `fn_reset_monitor_ttl` — reset monitor time-to-live
- `fn_close_monitor` — close and archive monitor
- `fn_get_user_monitor` — get specific user's monitor
- `fn_expire_old_monitors` — garbage collect stale monitors
- `fn_set_monitor_view` — set monitor display mode
- `fn_get_recent_positions` — paginated position history
- `fn_count_recent_positions` — position count for user
- `fn_get_or_create_manual_settings` / `fn_update_manual_settings`
- `fn_get_or_create_chain_settings` / `fn_update_chain_settings` / `fn_reset_chain_settings`

## Primary flows

### 1) Arm Autohunt
1. User arms via bot.
2. Bot saves config + arm state.
3. Hunter begins evaluating candidates for that user wallet.

### 2) Buy execution
1. Hunter selects candidate token.
2. Hunter checks constraints (balance, max positions, rate limits).
3. Hunter requests Executor to buy with trade size.
4. Executor submits tx and persists the position.
5. Bot sends "HUNT EXECUTED" notification with TX + Chart.

### 3) Exit execution (TP/SL/timeout)
1. Executor monitors conditions (price/MC thresholds and/or time-based exits).
2. On trigger, Executor sells and marks the position CLOSED.
3. Bot sends "HUNT CLOSED" with realized PnL.

### 4) Emergency Sell
1. User taps Emergency Sell from a position screen.
2. Bot calls Executor to close the position (idempotent).
3. Executor sells and finalizes.
4. Bot notifies close.

## App structure conventions

- `apps/bot/src/ui/*`: panel renderers and keyboard builders.
- `apps/bot/src/handlers/*`: callback routing and message handling.
- `apps/hunter/src/*`: candidate sources + scoring + risk rules.
- `apps/executor/src/*`: chain adapters, tx building, position lifecycle.
- `packages/*`: shared models and utilities.

## Reliability / idempotency
- All state changes must be persisted before notifying.
- Emergency sell must be idempotent (keyed by positionId).
- Any "pending" state must have retries and clear failure reasons.

## TP/SL Engine Architecture

### Overview

The TP/SL (Take Profit / Stop Loss) engine provides automatic position exits based on price thresholds. It uses a **hybrid approach** combining Jupiter polling with optional WebSocket activity hints for optimal balance between reliability and responsiveness.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    apps/hunter                               │
│  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐   │
│  │ PumpFunMonitor│  │TpSlMonitorLoop│  │PositionMonitor │   │
│  │ (token detect)│  │   (NEW)       │  │   (legacy)     │   │
│  └───────────────┘  └───────┬───────┘  └────────────────┘   │
│                             │                                │
│         ┌───────────────────┼───────────────────┐           │
│         ▼                   ▼                   ▼           │
│  ┌─────────────┐     ┌─────────────┐     ┌───────────┐      │
│  │ HeliusWs    │     │ Jupiter     │     │ ExitQueue │      │
│  │ Manager     │     │ Price API   │     │ (backpres)│      │
│  └─────────────┘     └─────────────┘     └─────┬─────┘      │
│                                                 │            │
└─────────────────────────────────────────────────┼────────────┘
                                                  ▼
                                          ┌─────────────┐
                                          │apps/executor│
                                          │ (sell tx)   │
                                          └─────────────┘
```

### Key Components

**TpSlMonitorLoop** (`apps/hunter/src/loops/tpslMonitor.ts`)
- Primary price source: Jupiter Price API (3s polling interval)
- Optional: Helius WebSocket for instant activity detection
- Evaluates TP/SL/Trailing/MaxHold triggers for open positions
- Queues exit jobs (never executes in callback)

**HeliusWsManager** (`apps/hunter/src/monitors/heliusWs.ts`)
- WebSocket connection with 30s heartbeat (Helius has 10-min timeout)
- logsSubscribe for bonding curve activity detection
- Automatic reconnect with exponential backoff

**ExitQueue** (`apps/hunter/src/queues/exitQueue.ts`)
- Concurrency-limited queue (maxConcurrent=3)
- Priority: SL > TP > TRAIL > MAXHOLD
- Backpressure prevents executor overload
- Deduplication via idempotency keys

**Subscription Manager** (`apps/hunter/src/monitors/subscriptionManager.ts`)
- Token-scoped subscriptions (one per token, many positions watch)
- Reference counting for cleanup
- Auto-unsubscribe when no positions watching

### Design Principles

1. **Event-driven monitoring** - WebSocket + polling hybrid
2. **Never execute in WS callback** - Queue with backpressure
3. **Exactly-once triggering** - Atomic DB state transitions + idempotency keys
4. **Token-scoped subscriptions** - One sub per token, many watchers
5. **Crash isolation** - Monitor and executor are separate concerns

### Trigger State Machine

```
Position.trigger_state flow:
  MONITORING → TRIGGERED → EXECUTING → COMPLETED
                                    ↘ FAILED
```

States:
- `MONITORING`: Position is open, watching for TP/SL
- `TRIGGERED`: TP/SL threshold crossed, queued for execution
- `EXECUTING`: Sell transaction in progress
- `COMPLETED`: Exit successful, position closed
- `FAILED`: Exit failed, requires manual intervention

### Exactly-Once Guarantees

1. **Atomic DB claim**: `trigger_exit_atomically()` uses `WHERE trigger_state='MONITORING'`
2. **Idempotency key**: `idKeyExitSell({positionId, trigger, sellPercent})`
3. **Double protection**: Even if WS duplicates events, only one exit executes

## Durable Trade Job Queue (2026-01-28)

### Overview

Trade execution uses a durable queue (`trade_jobs` table) with PostgreSQL `SKIP LOCKED` for exactly-once job processing.

### Flow

```
CandidateConsumerLoop → INSERT trade_jobs → ExecutionLoop claims via SKIP LOCKED
                                          → Lease renewal during execution
                                          → Finalize (COMPLETED/FAILED)
```

### Key Properties
- **Claim**: `SELECT ... FOR UPDATE SKIP LOCKED` prevents double-processing
- **Lease**: Jobs have a TTL; unclaimed expired jobs can be re-claimed
- **Finalize**: Terminal state (COMPLETED/FAILED/CANCELED) with execution result
- **Crash recovery**: Leased but unfinalized jobs expire and become re-claimable

### Notification Outbox

Notifications use a transactional outbox pattern:
1. Notification created in `notifications_outbox` with UUID user reference
2. NotificationPoller leases pending notifications via SKIP LOCKED
3. Resolves UUID → Telegram user ID for delivery
4. Marks delivered or retries on failure

## Discovery Sources (Bags.fm / Meteora Revamp)

### Overview

The discovery layer detects new token launches from multiple sources and normalizes them into candidates for evaluation.

### Sources

**BagsSource** (`apps/hunter/src/sources/bagsSource.ts`)
- Monitors Bags.fm Telegram channel for launch announcements
- Parses mint addresses from messages via `bagsParser.ts`
- Two-layer deduplication: in-memory TTL (60s) + DB unique constraint
- Circuit breaker: opens after 5 consecutive failures, 60s cooldown

**MeteoraOnChainSource** (`apps/hunter/src/sources/meteoraOnChainSource.ts`)
- Helius WebSocket `logsSubscribe` for Meteora bonding curve creation
- Parses create instructions via `meteoraParser.ts`
- Detects mint, bonding curve, and creator addresses
- Circuit breaker: same 5-failure / 60s pattern

### Data Flow

```
Telegram/WebSocket → Parser → Deduplicator → launch_candidates table → OpportunityLoop
```

## SwapRouter Architecture (Phase 2)

### Overview

The SwapRouter abstraction provides lifecycle-aware routing between different DEX backends.

### Router Selection

**RouterFactory** (`apps/executor/src/routers/routerFactory.ts`)
- Maintains ordered list of routers
- First router that `canHandle(intent)` wins
- Deterministic selection based on `lifecycleState`

**Priority Order:**
1. **BagsTradeRouter** — PRE_GRADUATION tokens on Meteora bonding curve
2. **JupiterRouter** — POST_GRADUATION tokens and fallback

### Lifecycle-Aware Routing

```
PRE_GRADUATION  → BagsTradeRouter (bonding curve API)
POST_GRADUATION → JupiterRouter (AMM pools)
```

### Safety Features

- **Slippage clamping**: 0-9900 bps enforced in all routers
- **Error classification**: `classifyError()` returns RETRYABLE/PERMANENT/UNKNOWN
- **Circuit breakers**: Prevent cascade failures on API/RPC issues

## Position Lifecycle State Machine

### States

```typescript
LifecycleState = 'PRE_GRADUATION' | 'POST_GRADUATION' | 'CLOSED'
TriggerState = 'MONITORING' | 'TRIGGERED' | 'EXECUTING' | 'COMPLETED' | 'FAILED'
```

### Transitions

**Lifecycle:**
- PRE_GRADUATION → POST_GRADUATION (via `graduate_position_atomically()`)
- PRE_GRADUATION → CLOSED (via sell)
- POST_GRADUATION → CLOSED (via sell)

**Trigger:**
- MONITORING → TRIGGERED (via `trigger_exit_atomically()`)
- TRIGGERED → EXECUTING (via `mark_position_executing()`)
- EXECUTING → COMPLETED (via `mark_trigger_completed()`)
- EXECUTING → FAILED (via `mark_trigger_failed()`)

### Atomicity

All transitions use:
- Row-level locking (`FOR UPDATE`)
- WHERE clause validation (only allowed source states)
- Single SQL statement (no read-then-write races)
