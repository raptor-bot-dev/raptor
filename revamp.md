# RAPTOR Launchpad Revamp — Bags.fm / Meteora Migration (DETAILED SPEC)

---

## 0. Purpose, Scope, and Non-Goals

### Purpose
This document is the **authoritative technical and operational specification** for revamping RAPTOR’s snap system away from pump.fun and toward **Bags.fm launches on Meteora**.

It is written to:
- Eliminate ambiguity during implementation
- Prevent architectural drift
- Enforce disciplined, phase-based delivery
- Ensure long-term maintainability and auditability

### Scope
Included:
- Discovery, execution, pricing, and position lifecycle changes
- Architectural refactors and abstractions
- **Database rebuild**: the old RAPTOR database has been deleted, so we will create a **fresh schema** and **new migrations** aligned to the new system
- Documentation and repository hygiene rules
- Testing, commit discipline, and audit requirements

Explicitly excluded:
- UI/UX redesign (out of scope unless required for correctness)
- New trading strategies beyond snap logic
- Multi-chain or EVM support (Solana-only)

---

## 1. Problem Statement (Why This Revamp Is Mandatory)

### 1.1 pump.fun Saturation Failure

Current issues with pump.fun as the primary snap source:

- Thousands of launches per day → impossible filtering
- Low average liquidity and follow-through
- Excessive bot noise and adversarial behavior
- Tight coupling between discovery and PumpSwap execution

This creates **negative expectancy**, regardless of execution speed.

### 1.2 Architectural Coupling Debt

Current state:
- Discovery logic assumes pump.fun semantics
- Execution assumes PumpSwap
- Position lifecycle assumes single-venue pricing

This prevents:
- Clean addition of new launchpads
- Reliable migration handling
- Deterministic testing

---

## 2. Bags.fm + Meteora: Technical Rationale

### 2.1 Bags.fm Launch Lifecycle

Bags launches follow a **structured lifecycle**:

1. Token creation via **Meteora Dynamic Bonding Curve (DBC)**
2. Early trading on bonding curve
3. Graduation to **Meteora DAMM v2** AMM pool
4. Ongoing trading with creator fee share

This lifecycle is deterministic and observable on-chain.

### 2.2 Why This Matters for RAPTOR

- Lower launch frequency → higher analyst bandwidth per launch
- Deterministic migration → safe position lifecycle modeling
- Meteora infra → mature liquidity primitives

RAPTOR is optimized for **expectancy per trade**, not raw count.

---

## 3. New Core Architectural Principles

### Principle 1: Launchpad-Agnostic Discovery
Discovery must never assume:
- a specific program
- a specific AMM
- a specific pricing model

### Principle 2: Venue-Agnostic Execution
Execution must:
- accept normalized inputs
- select the appropriate router
- produce deterministic transactions

### Principle 3: Explicit State Machines
Implicit state is forbidden.
All position and lifecycle transitions must be explicit and testable.

---

## 4. Canonical Data Models (Explicit)

### 4.1 LaunchCandidate
```
LaunchCandidate {
  mint: PublicKey
  symbol: string
  launchSource: 'bags' | 'pumpfun' | future
  discoveryMethod: 'telegram' | 'onchain'
  timestamp: number
  rawMetadata: unknown
}
```

### 4.2 Position
```
Position {
  id: UUID
  mint: PublicKey
  entryPrice: number
  size: number
  lifecycleState: PRE_GRADUATION | POST_GRADUATION | CLOSED
  pricingSource: BONDING_CURVE | AMM_POOL
  routerUsed: string
}
```

---

## 5. Discovery Layer — Explicit Design

### 5.1 BagsSource (Phase 1)

Responsibilities:
- Subscribe to Telegram signal channel
- Parse messages deterministically
- Reject malformed or ambiguous signals
- Emit normalized LaunchCandidate

**Hard Rules**:
- No execution logic here
- No pricing logic here
- Idempotent by default

### 5.2 On-Chain BagsSource (Phase 4)

- Subscribe to Meteora DBC program
- Decode create/init instructions
- Cross-validate with Telegram feed

Telegram is treated as **signal**, on-chain as **truth**.

---

## 6. Execution Layer — SwapRouter

### 6.1 SwapRouter Interface
```
SwapRouter {
  quote(input): Quote
  buildTx(quote): VersionedTransaction
  execute(tx): Signature
}
```

### 6.2 BagsTradeRouter (Initial Implementation)

- Uses Bags trade service SDK
- Abstracts routing across:
  - Meteora DBC
  - Meteora DAMM v2
  - Future venues

Execution guarantees:
- Explicit slippage bounds
- Deterministic transaction build

---

## 7. Pricing & Lifecycle Handling

### 7.1 PRE_GRADUATION

- Pricing sourced from bonding curve math
- No pool assumptions allowed

### 7.2 POST_GRADUATION

- Pricing sourced from AMM pool
- Liquidity and depth checks mandatory

Migration detection:
- Explicit on-chain event or state transition

---

## 8. Phase-Based Build Plan (STRICT)

### Global Rules (Non-Negotiable)

For **every phase**:
1. Implement only scoped changes
2. Update all affected documentation
3. Run full test suite
4. Tests must pass
5. Commit to GitHub (single logical commit)
6. Tag phase completion
7. Move to the next phase

---

## 9. Phase Breakdown (Enforced Order)

### Phase 0 — DB Bootstrap (MANDATORY)
A fresh schema and migration pipeline must exist before any discovery/execution refactor begins.

Deliverables:
- Fresh DB schema + migrations
- Seed scripts for local/dev
- Documented reset + migrate commands

Tests:
- Migration apply on empty DB
- Migration rollback (where applicable)
- Minimal CRUD tests (users, settings, launch_candidates, positions, executions, outbox)

Commit Gate:
- Tests green
- Commit + tag: `phase-0-db-bootstrap`

### Phase 1 — Bags Discovery MVP

Deliverables:
- BagsSource (Telegram)
- LaunchCandidate normalization

Tests:
- Parsing
- Deduplication

Docs:
- Architecture.md
- Discovery.md
- docs/revamp/discovery.md
- docs/revamp/INDEX.md (progress row)

Commit Gate:
- All discovery tests passing
- Commit + tag: `phase-1-bags-discovery`

### Phase 2 — Execution Refactor

Deliverables:
- SwapRouter abstraction
- BagsTradeRouter
- PumpSwap removal from execution path

Tests:
- Quote correctness (mocked)
- Tx build integrity
- Idempotency tests

Commit Gate:
- No PumpSwap references in execution path
- Tests green
- Commit + tag: `phase-2-swaprouter`

### Phase 3 — Position Lifecycle

Deliverables:
- Explicit lifecycle state machine
- Pricing source switching

Tests:
- Graduation simulation
- PnL invariants

Commit Gate:
- Tests green
- Commit + tag: `phase-3-lifecycle`

### Phase 4 — On-Chain Detection

Deliverables:
- Meteora DBC subscription
- Decoder
- Reconciliation vs Telegram feed

Tests:
- Event decoding accuracy
- Missed-launch detection

Commit Gate:
- Tests green
- Commit + tag: `phase-4-onchain-discovery`

### Phase 5 — Cleanup & Hardening

Deliverables:
- Dead code removal
- Config simplification
- Observability hardening

Tests:
- Full regression suite

Commit Gate:
- Tests green
- Commit + tag: `phase-5-hardening`

---

## 10. Audit Phase (MANDATORY)

### Internal Audit
- Router safety
- State correctness
- Failure handling
- Data integrity (constraints, idempotency, outbox)

### External Audit (Recommended)
Independent review of:
- SwapRouter abstraction
- Bags/Meteora integration
- Lifecycle & pricing transitions
- Idempotency and replay safety

Post-audit:
- Apply fixes
- Run full test suite
- Final GitHub release tag

---

## 11. Definition of Done

RAPTOR is complete when:
- Bags is primary launch source
- pump.fun optional / secondary
- PumpSwap fully removed from execution
- Fresh DB schema + migrations are stable
- Docs match reality
- Tests are green
- Audit is complete

---

## 12. Operating Doctrine

> Discipline beats speed.  
> Architecture enforces behavior.  
> Expectancy is the only metric that matters.
