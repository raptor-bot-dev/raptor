# Revamp — Discovery (LaunchSource)

## 0. Purpose
Define the discovery layer refactor required to make RAPTOR launchpad-agnostic, with **Bags** as the primary source.

Discovery outputs **LaunchCandidates** only. It must never execute trades.

---

## 1. LaunchSource Interface

### Responsibilities
- Discover potential launches
- Normalize into a canonical `LaunchCandidate`
- Enforce deterministic parsing + dedupe

### Forbidden
- Trade execution
- Pricing calculations beyond basic validation (e.g., mint address sanity)

---

## 2. BagsSource (Phase 1)

### 2.1 Telegram Ingestion MVP
Inputs:
- A single Telegram channel that prints new Bags launches

Processing:
1) Receive message
2) Parse deterministically (regex + strict schema)
3) Validate:
   - mint is valid base58
   - timestamp present or assign received time
4) Emit LaunchCandidate
5) Dedupe by (mint) or (mint, first_seen_at) depending on schema choice

Outputs:
- Insert row into `launch_candidates`

### 2.2 Parser Contract (Explicit)
The parser must return either:
- `{ ok: true, candidate }`
- `{ ok: false, reason, raw }`

No partial candidates.

### 2.3 Deduplication
- Primary dedupe in DB via unique constraint
- Secondary dedupe in memory to reduce spam

---

## 3. On-Chain BagsSource (Phase 4)

### Goal
Replace Telegram dependency with on-chain truth.

Approach:
- Subscribe to Meteora DBC program transactions
- Decode token creation/init instructions
- Normalize and insert into `launch_candidates` with `discovery_method = onchain`

Cross-validation:
- If Telegram candidate exists for mint → link/merge

---

## 4. Tests

### Unit tests
- Message parsing (valid examples)
- Message parsing (invalid examples)
- Dedupe behavior

### Integration tests
- Insert launch_candidate
- Verify unique constraint behavior

---

## 5. Phase 1 Commit Gate

- [x] Parser + ingestion stable
- [x] Tests green (46 bags tests: 29 parser + 17 source)
- [x] Docs updated
- Commit message:
  - `phase-1: bags discovery mvp`

### Phase 1 Implementation Summary

Files created:
- `apps/hunter/src/sources/bagsParser.ts` - Deterministic parser
- `apps/hunter/src/sources/bagsDeduplicator.ts` - In-memory dedupe with TTL
- `apps/hunter/src/sources/bagsSource.ts` - Telegram channel monitor using grammy
- `apps/hunter/src/sources/index.ts` - Module exports
- `apps/hunter/src/sources/__tests__/bagsParser.test.ts` - 29 parser tests
- `apps/hunter/src/sources/__tests__/bagsSource.test.ts` - 17 source/dedupe tests

Files modified:
- `apps/hunter/src/index.ts` - Wired up BagsSource with DB insertion handler
- `apps/hunter/package.json` - Added grammy and @raptor/database dependencies
- `packages/shared/src/config.ts` - Added Bags config helpers
