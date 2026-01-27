# Revamp — Lifecycle & Pricing

## 0. Purpose
Formalize position lifecycle handling for Bags/Meteora launches:

- PRE_GRADUATION (bonding curve)
- POST_GRADUATION (AMM pool)
- CLOSED

All transitions must be explicit, persisted, and tested.

---

## 1. State Machine

### States
- `PRE_GRADUATION`
- `POST_GRADUATION`
- `CLOSED`

### Allowed transitions
- PRE_GRADUATION → POST_GRADUATION
- PRE_GRADUATION → CLOSED
- POST_GRADUATION → CLOSED

Forbidden:
- POST_GRADUATION → PRE_GRADUATION

---

## 2. Pricing Sources

### PRE_GRADUATION
Pricing source: bonding curve.

Rules:
- do not assume pool liquidity
- handle extreme slippage + curve jumps

### POST_GRADUATION
Pricing source: AMM pool.

Rules:
- enforce minimum liquidity
- enforce route availability

---

## 3. Graduation Detection (Phase 3/4)

Acceptable mechanisms:
- explicit on-chain event
- DBC program state change
- DAMM pool creation detection

Graduation must be recorded:
- `positions.lifecycle_state` updated
- `positions.pricing_source` updated
- optional `positions.graduated_at`

---

## 4. Tests

- Graduation simulation fixture
- PnL continuity invariants
- Pricing fallback correctness

---

## 5. Phase 3 Commit Gate

- lifecycle state persisted
- pricing source switching works
- tests green
- commit message:
  - `phase-3: lifecycle`
