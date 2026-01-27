# Phase 0 — Database Bootstrap (Fresh DB)

> This phase exists because the old RAPTOR database has been deleted.
>
> **No other phase may begin until Phase 0 is complete, tests are green, and the commit is merged.**

---

## 0. Goals

- Stand up a **fresh database** that matches the new Bags/Meteora snap system
- Encode **idempotency** and **state machines** in schema
- Provide repeatable **migrations + seeds** for local, staging, and production
- Provide a minimal **test harness** proving migrations work end-to-end

---

## 1. Database Strategy

### 1.1 Single Source of Truth
- The schema is defined exclusively by migrations.
- There must be **zero manual SQL edits** applied to production.

### 1.2 Deterministic Environments
- Local, staging, prod must run the **same** migration pipeline.
- `db reset` must be able to drop + recreate + migrate + seed in one command.

### 1.3 Self-Custody Constraint
- RAPTOR must not store private keys or seed phrases.
- Wallet table stores **public keys only**.

---

## 2. Minimum Schema (v1)

> The exact columns may evolve, but the entities below are required.

### 2.1 users
Purpose: user identity, Telegram linkage, tiering.

Recommended columns:
- `id (uuid pk)`
- `created_at (timestamptz)`
- `telegram_chat_id (text|bigint, unique)`
- `tier (text)`
- `is_banned (bool default false)`

### 2.2 wallets
Purpose: associate pubkeys to users.

- `id (uuid pk)`
- `user_id (uuid fk users)`
- `pubkey (text, unique)`
- `label (text nullable)`
- `created_at`

### 2.3 settings
Purpose: per-user snap risk controls.

- `user_id (uuid pk fk users)`
- `slippage_bps (int)`
- `max_positions (int)`
- `max_trades_per_hour (int)`
- `max_buy_amount_sol (numeric)`
- `allowlist_mode (text: off|partners_only|custom)`
- `kill_switch (bool default false)`
- `updated_at`

### 2.4 launch_candidates
Purpose: normalized output from discovery layer.

- `id (uuid pk)`
- `mint (text)`
- `launch_source (text: bags|pumpfun|future)`
- `discovery_method (text: telegram|onchain)`
- `first_seen_at (timestamptz)`
- `raw_payload (jsonb)`
- `status (text: new|accepted|rejected)`

Constraints:
- `UNIQUE(mint)` (recommended) OR `UNIQUE(mint, first_seen_at)` if you intentionally allow multiple “first seen” records.

### 2.5 positions
Purpose: active/historical positions.

- `id (uuid pk)`
- `user_id (uuid fk users)`
- `mint (text)`
- `lifecycle_state (text: PRE_GRADUATION|POST_GRADUATION|CLOSED)`
- `pricing_source (text: BONDING_CURVE|AMM_POOL)`
- `router_used (text)`
- `entry_price (numeric)`
- `size (numeric)`
- `opened_at (timestamptz)`
- `closed_at (timestamptz nullable)`

Indexes:
- `(user_id, lifecycle_state)`
- `(mint)`

### 2.6 executions
Purpose: immutable log of trade attempts (idempotency anchor).

- `id (uuid pk)`
- `idempotency_key (text unique)`
- `user_id (uuid fk users)`
- `mint (text)`
- `side (text: BUY|SELL)`
- `requested_size (numeric)`
- `filled_size (numeric nullable)`
- `signature (text nullable)`
- `status (text: pending|sent|confirmed|failed)`
- `error_code (text nullable)`
- `error_detail (text nullable)`
- `created_at (timestamptz)`

Constraints:
- `UNIQUE(idempotency_key)`
- `UNIQUE(signature) WHERE signature IS NOT NULL`

### 2.7 notifications_outbox
Purpose: transactional outbox for notifier.

- `id (uuid pk)`
- `type (text)`
- `payload (jsonb)`
- `status (text: pending|sending|sent|failed)`
- `attempts (int default 0)`
- `sending_expires_at (timestamptz nullable)`
- `created_at`

Indexes:
- `(status, sending_expires_at)` for SKIP LOCKED leasing

---

## 3. Migrations & Seeds

### 3.1 Migration Rules
- Every change = new migration.
- Prefer reversible migrations.
- Avoid destructive changes without explicit backfill plan.

### 3.2 Seed Rules
- Seeds must be idempotent.
- Seeds should set sane defaults for `settings`.

---

## 4. Test Requirements (Phase Gate)

Minimum tests to unblock Phase 1:

1) Migration pipeline test
- apply migrations on empty DB
- verify required tables exist

2) Constraint tests
- execution idempotency uniqueness
- launch candidate dedupe uniqueness

3) CRUD smoke tests
- create user + settings
- insert launch_candidate
- create position
- insert execution
- enqueue outbox notification

---

## 5. Commit Gate

Phase 0 is complete only when:
- migrations run clean on a fresh DB
- seeds run clean
- tests green
- single commit merged with message:
  - `phase-0: db bootstrap`
- tag created:
  - `phase-0-db-bootstrap`

---

## 6. Docs to Update in This Phase

Required updates:
- `docs/revamp/INDEX.md` (progress log row)
- `Architecture.md` (DB as a first-class component)
- `ConstraintsAndPolicies.md` or equivalent (self-custody + data retention)

---

## 7. Do-Not-Do List

- Do not start Bags discovery until DB is stable
- Do not store private keys
- Do not skip uniqueness constraints “because it’s annoying”
- Do not create tables manually in prod
