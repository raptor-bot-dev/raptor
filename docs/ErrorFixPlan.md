You have enough signal in that error to stop guessing. The Pump.fun program is explicitly telling you **your sell instruction is asking to sell more tokens than the wallet actually has**.

### What the error proves

* `AnchorError … NotEnoughTokensToSell (6023)`
* `Left: 205478149265`
* `Right: 2054781492657`

In Anchor error conventions here, **Left is available**, **Right is requested**. Your code requested **~10×** the available balance.

That points to a **unit/decimals bug** (or a percent-to-raw conversion bug) in the Pump.fun sell path, not “market conditions”.

Jupiter failing with `COULD_NOT_FIND_ANY_ROUTE` is normal for:

* non-graduated tokens (still on bonding curve),
* tokens with no active pool/route,
* temporarily illiquid/blocked routes.

The critical failure is Pump.fun simulation: you’re submitting an instruction with the wrong amount.

---

## Likely Root Causes (Ranked)

### 1) Decimals mismatch at sell time (most likely)

Your system stores decimals / balance normalization somewhere and uses it later during sell. If decimals are wrong by one digit, you get exactly this behavior (10×).

Typical causes:

* Using **stored decimals** that differ from **on-chain mint decimals**.
* Parsing token amounts as UI strings and converting incorrectly.
* Treating “token amount” as “raw amount” or vice versa.

### 2) Wrong amount units expected by Pump.fun client

Some pumpfun client functions expect:

* `amount` in **raw base units** (integer)
  while your code might be passing:
* **UI units** (float/decimal), then multiplying again.

### 3) Selling from the wrong token account / balance source

Less likely because the available (Left) is non-zero and consistent, but still possible:

* You read balance from one ATA, but the instruction references another ATA.
* Or you compute percent from a cached balance different from the on-chain balance at execution time.

---

## Immediate Fix Strategy (What to change first)

### A) Make sell amount authoritative from chain at execution time

For any sell (manual, TP/SL, emergency), the executor must do:

1. **Fetch mint decimals from chain** (not DB).
2. **Fetch token account balance raw** from chain (the actual ATA you’ll spend from).
3. Compute `sellAmountRaw = floor(balanceRaw * pct / 100)`.
4. Clamp and dust-protect:

   * `sellAmountRaw = min(sellAmountRaw, balanceRaw)`
   * If `sellAmountRaw <= 0` → abort with user-friendly message.
5. Use **only raw integers** through the execution pipeline.

This eliminates 90% of these “NotEnoughTokensToSell” failures.

### B) Add a preflight invariant before building the Pump.fun sell instruction

Before submitting the sell ix:

* Re-check: `sellAmountRaw <= balanceRaw`
* If not, hard fail with a diagnostic message and store it in execution logs.

This prevents wasted broadcasts and confusing errors.

### C) Stop trying Jupiter first when token is on bonding curve

For bonding-curve tokens, Jupiter will often return no route. That’s fine, but it wastes time and creates noise.

Correct routing rule:

* If token is **on bonding curve** → **Pump.fun sell path first**
* Else if token is **graduated** → **Jupiter path first**
* If your “isGraduated” detection is unreliable, add a fast on-chain check.

---

# Redesign Plan: Sell System That Does Not Break Under Volatility

This plan restructures your sell pipeline so **all sell triggers share one execution core**, and amount/decimals are handled correctly every time.

## Phase 1 — Unify Sell Entry Points into One Exit Service (2–4 hours work if codebase is clean)

### Goal

Manual sell, Emergency sell, TP/SL exits all call the same internal method:

`executeExit(positionId, triggerType, percent, slippagePolicy)`

### Changes

* Create/ensure: `apps/executor/src/services/exitService.ts`

  * `resolveSellContext()`: mint, user wallet, ATA, decimals, balanceRaw
  * `computeSellAmountRaw(percent, balanceRaw)`
  * `routeSelection()`: Pump.fun vs Jupiter (based on token state)
  * `buildAndSendTx()`
  * `persistClosePosition()`

* Modify callers to use this service:

  * `apps/bot/src/handlers/sell.ts`
  * `apps/bot/src/services/emergencySellService.ts`
  * `apps/hunter/src/...` TP/SL job consumer path

### Acceptance criteria

* Any exit path produces identical logs and behavior.
* Idempotency works the same everywhere.

---

## Phase 2 — Fix Amount & Decimals Once, Centrally (This is the bug you are hitting)

### Implement authoritative on-chain normalization

In `resolveSellContext()`:

* Fetch mint decimals from chain at sell time.
* Fetch token account raw balance for the **exact ATA** used in the instruction.
* Never trust DB decimals for execution.

### Add hard invariants

Log and fail early if:

* `sellAmountRaw > balanceRaw`
* `balanceRaw == 0`
* ATA mismatch (ATA derived vs provided)

### Acceptance criteria

* Your Pump.fun simulation never fails with NotEnoughTokensToSell unless the user genuinely has 0 tokens.

---

## Phase 3 — Correct Token State Detection (Stop routing errors)

### Implement `getTokenTradeMode(mint)`

Returns:

* `BONDING_CURVE`
* `GRADUATED_POOL`
* `UNKNOWN` (fallback)

Recommended checks (fastest, most reliable):

* If position has known “bonding curve address” / pump metadata → bonding curve.
* Else attempt Jupiter quote with tiny notional; if route exists → likely graduated.
* Else attempt a lightweight on-chain check (program-owned accounts) if you already have those addresses.

### Acceptance criteria

* Bonding curve tokens do not attempt Jupiter first.
* Graduated tokens do not attempt Pump.fun first.

---

## Phase 4 — Better Failure Handling (Stop “agent running in circles”)

### New error taxonomy (actionable)

When a sell fails, classify it into:

* **NO_ROUTE** (Jupiter) → “Token not tradable via Jupiter; trying bonding curve if applicable”
* **INSUFFICIENT_BALANCE** (Pump.fun 6023) → “Sell amount exceeded wallet balance; internal amount conversion bug” (and include raw numbers)
* **ACCOUNT_MISMATCH** → “Token account mismatch / ATA issue”
* **SIM_FAIL_OTHER** → include first 3 relevant logs and the program id

### Add structured execution context to every failure

Store:

* mint, decimals, balanceRaw, requestedRaw, percent, routeChosen, slippageBps, ata address
* the first 20 simulation logs

### Acceptance criteria

* A single failure report tells you exactly what to fix without guesswork.

---

## Phase 5 — Add a “Safe Sell” fallback mode (optional but useful)

If normal sell fails:

* Recompute balances again
* Sell `min(balanceRaw, requestedRaw)` (clamp) and retry once
* If it still fails, stop

This is a practical safety net for race conditions (balance changes between reads and send).

---

# What Your Specific Error Implies You Should Fix First

Given the 10× mismatch (`Right` is exactly 10× `Left`), I would immediately inspect:

1. **Where sell amount is computed** for Pump.fun sell:

* Are you multiplying by `10^decimals` twice?
* Are you using the wrong decimals (e.g., 9 vs 10)?

2. **Whether you are converting UI amount to raw** using a float or a string parse that introduces scaling errors.

3. **Whether you are reusing entry decimals** (from buy) for sells without re-checking on-chain.

---


