# Revamp — Execution (SwapRouter)

## 0. Purpose
Define the execution refactor to remove PumpSwap coupling and introduce a **venue-agnostic SwapRouter**.

Execution accepts normalized intents and produces:
- deterministic quotes
- deterministic transactions
- immutable execution records

---

## 1. SwapRouter Interface

### Contract
- `quote(intent) -> Quote`
- `buildTx(quote) -> VersionedTransaction`
- `execute(tx) -> signature`

### Non-negotiables
- Slippage is explicit
- Idempotency is enforced before sending
- Every attempt is recorded in `executions`

---

## 2. BagsTradeRouter (Phase 2 MVP)

### Rationale
Use Bags trade service initially to avoid premature complexity.

### Responsibilities
- Request quote (routePlan)
- Build swap transaction
- Return versioned tx for signing

### Failure handling
- If quote fails → record execution failed with reason
- If tx build fails → record execution failed
- If send fails → record execution failed

---

## 3. Idempotency Rules

Before execution:
- Compute `idempotency_key` from:
  - user_id
  - mint
  - side
  - position_id (if relevant)
  - time bucket or intent nonce

DB must enforce uniqueness.

---

## 4. PumpSwap Removal Plan

Phase 2 includes:
- Remove PumpSwap router usage
- Delete PumpSwap execution modules
- Replace references with SwapRouter

No shadow paths.

---

## 5. Tests

- Quote tests (mocked)
- Tx build integrity tests
- Idempotency tests (duplicate intent)

---

## 6. Phase 2 Commit Gate

- SwapRouter integrated
- PumpSwap removed from execution path
- Tests green
- Commit message:
  - `phase-2: swaprouter + bags trade router`
