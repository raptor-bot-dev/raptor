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
