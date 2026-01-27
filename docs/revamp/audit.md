# Revamp — Audit (Mandatory Final Gate)

## 0. Purpose
Define the audit requirements to certify the Bags/Meteora revamp as safe, correct, and production-ready.

No new features proceed until audit findings are resolved.

---

## 1. Internal Audit Checklist

### 1.1 SwapRouter Safety
- Slippage bounds always set
- Quote → tx mapping cannot be tampered
- Router selection deterministic
- Failure modes produce explicit errors

### 1.2 Idempotency
- Duplicate intents cannot double-execute
- `executions.idempotency_key` uniqueness enforced
- Retried sends do not create new execution rows

### 1.3 State Machine Correctness
- Only allowed transitions possible
- All transitions persisted
- PnL calculations stable across graduation

### 1.4 Discovery Hardening
- Parser rejects malformed signals
- Dedupe enforced at DB layer
- Telegram vs on-chain reconciliation logic correct

### 1.5 Database Safety
- Constraints present
- Indexes support hot paths
- Outbox leases recover from crashes

---

## 2. External Audit Pack (Recommended)

Provide auditors:
- `revamp.md`
- `docs/revamp/INDEX.md`
- `docs/revamp/*` (all phase docs)
- Architecture.md
- latest schema + migrations
- test suite + how to run

Expected deliverables from auditors:
- findings list
- severity triage
- reproduction steps
- recommended fixes

---

## 3. Post-Audit Closure Rules

- All critical/high findings fixed before release
- Rerun full test suite
- Tag release:
  - `revamp-bags-meteora-v1`

---

## 4. Audit Definition of Done

Audit phase complete when:
- internal checklist passes
- external findings (if used) resolved
- tests green
- final commit merged + tagged
