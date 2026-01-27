# Revamp — Audit (Mandatory Final Gate)

## 0. Purpose
Define the audit requirements to certify the Bags/Meteora revamp as safe, correct, and production-ready.

No new features proceed until audit findings are resolved.

---

## 1. Internal Audit Checklist

### 1.1 SwapRouter Safety ✅ PASS
- [x] Slippage bounds always set — clamped 0-9900 bps in Jupiter/PumpFun/BagsTradeRouter
- [x] Quote → tx mapping cannot be tampered — deterministic router selection
- [x] Router selection deterministic — lifecycle-based: PRE_GRADUATION→Bags, POST_GRADUATION→Jupiter
- [x] Failure modes produce explicit errors — `classifyError()` returns RETRYABLE/PERMANENT/UNKNOWN

### 1.2 Idempotency ✅ PASS
- [x] Duplicate intents cannot double-execute — SHA256 canonical idempotency keys
- [x] `executions.idempotency_key` uniqueness enforced — UNIQUE NOT NULL constraint
- [x] Retried sends do not create new execution rows — `allow_retry` reuses existing record

### 1.3 State Machine Correctness ✅ PASS
- [x] Only allowed transitions possible — WHERE clause validation in all RPC functions
- [x] All transitions persisted — row-level locking with FOR UPDATE
- [x] PnL calculations stable across graduation — pricing source switches atomically

### 1.4 Discovery Hardening ✅ PASS
- [x] Parser rejects malformed signals — explicit ok/error result types, address validation
- [x] Dedupe enforced at DB layer — UNIQUE constraint + in-memory TTL deduplicator
- [x] Telegram vs on-chain reconciliation logic correct — circuit breakers on both sources

### 1.5 Database Safety ✅ PASS
- [x] Constraints present — FK with CASCADE, CHECK constraints, NOT NULL
- [x] Indexes support hot paths — 30+ indexes including filtered indexes
- [x] Outbox leases recover from crashes — SKIP LOCKED with 5-min stale takeover

**Internal Audit Date:** 2026-01-27
**Audit Verdict:** PRODUCTION READY

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
