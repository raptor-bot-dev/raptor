# RAPTOR Revamp Documentation Index

This directory contains the **canonical, phase-locked documentation** for the RAPTOR launchpad revamp (pump.fun → Bags.fm / Meteora) **and the required fresh database rebuild**.

This index is the **entry point**. All contributors MUST start here.

---

## 1. Document Hierarchy & Authority

Order of authority (highest → lowest):

1. `revamp.md` (root RFC – non-negotiable)
2. This index (`docs/revamp/INDEX.md`)
3. Phase-specific docs (listed below)
4. Code comments

If a conflict exists, the higher authority wins.

---

## 2. Phase-Specific Documents (Logical Split)

These documents are referenced by `revamp.md` and must stay aligned.

### 2.0 `DB_BOOTSTRAP.md` (Phase 0)
Scope:
- Fresh schema + migrations + seeds
- Idempotency constraints
- Outbox leasing + crash recovery
- Migration/seed test gates

### 2.1 `discovery.md`
Scope:
- LaunchSource abstraction
- BagsSource (Telegram + on-chain)
- Deduplication and normalization

### 2.2 `execution.md`
Scope:
- SwapRouter abstraction
- BagsTradeRouter
- Execution guarantees & failure handling

### 2.3 `lifecycle.md`
Scope:
- Position state machine
- PRE_GRADUATION → POST_GRADUATION transitions
- Pricing source switching

### 2.4 `audit.md`
Scope:
- Internal audit checklist
- External audit handoff expectations

---

## 3. Phase Progress Log (Append-Only)

This log is **append-only**. Never edit historical entries.

```
PHASE | DATE (UTC)       | COMMIT HASH | SUMMARY                                    | TEST STATUS
-------------------------------------------------------------------------------------------------
0     | 2026-01-27       | 661f004     | Fresh schema, 7 tables, RPC funcs, tests   | GREEN
1     | 2026-01-27       | 3d1d328     | Bags discovery MVP: parser, source, dedupe | GREEN
2     | 2026-01-27       | d582f75     | SwapRouter abstraction + BagsTradeRouter   | GREEN
3     | 2026-01-27       | daceecf     | Lifecycle state machine, graduation monitor| GREEN
4     | 2026-01-27       | daceecf     | Meteora on-chain detection via logsSubscribe| GREEN
5     | 2026-01-27       | 6ceeef9     | Circuit breakers, error classification, config validation | GREEN
X     | 2026-01-28       | 9501945     | Durable trade job queue (SKIP LOCKED leasing) | GREEN
X     | 2026-01-28       | ff99678     | Notifications outbox (UUID→tgId resolution) | GREEN
```

### Security Model: Wallet Custody

RAPTOR uses **server-side encrypted key custody**:
- Encrypted private keys are stored in the `wallets` table (legacy column: `solana_private_key_encrypted`)
- Keys are decrypted in-memory only at signing time
- Key derivation uses per-user salt (Telegram ID)
- Public key integrity check validates stored address matches derived keypair

This is the chosen production model. The Phase-0 schema comment about "no private keys" is historical and has been updated.

Rules:
- One row per completed phase
- Commit hash must be a GitHub main-branch commit
- Tests must be GREEN

---

## 4. Mandatory Phase Discipline (Enforced)

For **every phase**, the following steps are REQUIRED:

1. Phase scope reviewed against `revamp.md`
2. Code implemented (only scoped changes)
3. Docs updated (this index + relevant phase doc)
4. Full test suite executed
5. Tests verified green
6. Single logical commit created
7. Phase logged in Section 3

Skipping any step invalidates the phase.

---

## 5. GitHub Pull Request Template (MANDATORY)

All revamp-related PRs MUST use the following checklist.

```
## Revamp Phase PR

Phase:
- [ ] Phase 0 — DB Bootstrap
- [ ] Phase 1 — Bags Discovery
- [ ] Phase 2 — Execution Refactor
- [ ] Phase 3 — Lifecycle & Pricing
- [ ] Phase 4 — On-Chain Detection
- [ ] Phase 5 — Cleanup & Hardening
- [ ] Final — Audit Closure

Scope Compliance:
- [ ] Changes limited strictly to this phase
- [ ] No speculative or future-phase code

Testing:
- [ ] Unit tests added/updated
- [ ] Full test suite run
- [ ] All tests passing

Documentation:
- [ ] revamp.md reviewed
- [ ] docs/revamp updated
- [ ] Architecture.md updated if required

Safety & Risk:
- [ ] No execution path ambiguity
- [ ] No hidden state introduced
- [ ] Failure modes considered

Commit Discipline:
- [ ] Single logical commit
- [ ] Commit message references phase
```

PRs missing any checkbox are rejected.

---

## 6. Audit Enforcement

### 6.1 Internal Audit Gate
Before final merge:
- SwapRouter behavior reviewed
- State transitions validated
- Slippage & execution safety confirmed
- DB constraints and outbox leasing reviewed

### 6.2 External Audit Preparation
The following must be provided to auditors:
- `revamp.md`
- This index
- All phase docs
- Final code snapshot
- Schema + migrations + how to run tests

No feature work proceeds until audit findings are resolved.

---

## 7. Repo Etiquette Addendum (Revamp-Specific)

- No "quick fixes" outside phase scope
- No disabled tests
- No TODOs in execution paths
- No merging without docs

Violations are considered architectural regressions.

---

## 8. Operating Reminder

> The purpose of this revamp is **expectancy**, not novelty.
>
> If a change does not measurably improve signal quality, execution safety, or clarity — it does not belong here.
