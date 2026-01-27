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
- Watches pump.fun / launch sources and emits candidates.
- Applies filters (risk rules, wallet constraints, max positions, max buys/hour).
- When approved, calls Executor with a concrete trade plan.

**Executor (execution engine)**
- Builds swap/tx instructions and submits.
- Tracks position state transitions: OPEN -> CLOSING -> CLOSED.
- Enforces timers server-side (TP/SL + optional max-hold) and is the single source of truth.
- Supports Emergency Sell (idempotent close).

### Data stores
- Supabase/Postgres is the system of record for: users, wallets, config, trades, positions, events.
- Never store plaintext private keys. If encrypted blobs exist, keep format stable.

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
