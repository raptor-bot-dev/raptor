How Pump.fun bonding-curve sells are processed (on-chain)

A bonding-curve sell on Pump.fun is a direct call into the Pump program’s sell instruction. Conceptually, the program:

Reads Pump global config (fees, fee recipients, etc.)

Reads + mutates the token’s bonding-curve state (reserves / pricing state)

Transfers tokens from the user’s token account → bonding-curve token account (via the token program you pass)

Transfers SOL from the bonding-curve SOL side → user (minus protocol fee)

Pays the fee recipient

Emits an Anchor event via the eventAuthority/program accounts that appear in the IDL

You can see the required account list and args in the Pump IDL (sell = “Sells tokens into a bonding curve”).

What program ID do Pump.fun bonding-curve sells use?

For bonding-curve trading, the commonly referenced Pump.fun program id is:

6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P

That is the program you should see as the invoked program for bonding-curve sell instructions in getTransaction output.

Exact sell account list (order matters)

From the Pump IDL, the bonding-curve sell instruction expects this account ordering:

global

feeRecipient (writable)

mint

bondingCurve (writable)

associatedBondingCurve (writable)

associatedUser (writable)

user (signer, writable)

systemProgram

associatedTokenProgram

tokenProgram

eventAuthority

program

Args (IDL):

amount: u64 (token amount in base units)

minSolOutput: u64 (lamports)

How to implement a Pump.fun bonding-curve SELL in your bot (production approach)
Step 0 — Determine whether it’s bonding curve vs graduated

Before building a sell, decide which execution surface you’re on:

Bonding curve (pre-graduation): use Pump program sell (this answer)

Graduated / PumpSwap pool: do not use bonding-curve sell; route via PumpSwap or a router (often Jupiter) instead. Pump has explicitly discussed PumpSwap and the post-upgrade split in their public docs.

Step 1 — Resolve token program (Legacy SPL vs Token-2022)

You must pass the correct tokenProgram and derive ATAs accordingly:

Pump introduced create_v2 where mints are created under Token-2022, and the associated bonding-curve token account + user token account must be derived/owned under Token-2022 rules.

Legacy create tokens remain (and are expected to keep working without the Token-2022 changes).

Operationally: read the mint account owner → choose TOKEN_PROGRAM_ID vs TOKEN_2022_PROGRAM_ID, then derive associatedUser / associatedBondingCurve with that token program.

Step 2 — Handle Mayhem-mode fee recipient correctly (this is where “emergency sell” fixes often fail)

Pump’s own breaking-change note (Nov 11, 2025) adds is_mayhem_mode and states:

For bonding-curve trades, if is_mayhem_mode = true, the fee recipient passed at account index 2 must be a Mayhem fee recipient.

The Mayhem program id and the Mayhem fee recipients list are provided there, and it also explains where to source the reserved fee recipients from global state.

So your sell builder should do:

Fetch/parse bondingCurve state → check is_mayhem_mode

If true → pick a valid Mayhem fee recipient (per Pump docs) and pass it as feeRecipient (account #2)

If false → use the normal Pump fee recipient logic

Step 3 — Compute minSolOutput (slippage protection)

Do not set minSolOutput = 0 unless you truly want “panic dump at any price.”

A robust pattern:

Fetch bonding-curve account data

Compute expected lamports out (your bonding-curve math)

Apply slippage bps → set minSolOutput

If you don’t want to maintain curve math, you can still:

simulate the transaction with a conservative minSolOutput and adjust, or

use a vetted SDK that already derives accounts + amounts (community SDKs exist; one example explicitly lists the program id and shows building sell instructions).

Step 4 — Build and send the transaction fast

For a bot, typical production requirements:

Add ComputeBudgetProgram instructions (compute units + unit price)

Use a high-performance RPC / block engine path (your existing Raptor stack likely already has this)

Pre-create ATAs where possible; missing ATAs are a common failure mode in general tooling

Use idempotent send + confirmation strategy (skip preflight only if you have your own simulation/guardrails)

Step 5 — Validate on-chain with getTransaction (your fastest truth source)

Once you have a candidate sell tx signature, confirm:

invoked program id = 6EF8… for bonding-curve sell

account ordering matches the IDL (feeRecipient is index 2)

token program is correct (legacy vs Token-2022)

if mayhem-mode, fee recipient is one of the allowed Mayhem recipients

Key takeaway for your bot implementation

A "basic sell" implementation that only hardcodes one fee recipient and assumes legacy SPL token will break under:

Token-2022 create_v2 coins, and/or

is_mayhem_mode = true coins (wrong fee recipient at index 2).

---

Implementation Notes (production-critical)

A) "pump.pro" handling (important clarification)

Treat "pump.pro" as a UI / domain label, not an on-chain surface. Your subscriptions must be driven by program IDs, not domains. In practice, you will generally have:

Pump bonding curve program (for pre-graduation buys/sells)

Pump AMM / PumpSwap program (for post-graduation swaps)

(Optional) any special-mode programs (e.g., "Mayhem"), if applicable to your execution path

Action: implement a single ProgramRegistry that contains the program IDs you subscribe to and the instruction discriminators you decode, independent of "pump.pro vs pump.fun".

B) REST fallback base URL

Your fallback URL example uses frontend-api.pump.fun. In production you should implement REST fallback as a configurable base because Pump has shipped multiple versions over time (e.g., frontend-api-v3, "advanced", etc.). Do not hardcode one base.

Action: set:

PUMP_REST_BASE=https://frontend-api-v3.pump.fun (or whatever you currently use)

A health-check + circuit-breaker (rate limits, 429s, auth failures)

C) On-chain log subscription strategy (fast + reliable)

For speed and completeness, prefer:

Yellowstone gRPC (best for high-throughput bots)

Otherwise: logsSubscribe over WebSocket plus getTransaction backfill on relevant signatures

Maintain a short signature cache (LRU TTL) per mint/program to prevent duplicate processing

Minimum viable pipeline:

logsSubscribe filtered by program id(s)

detect candidate instructions by discriminator pattern (or log strings, if stable)

getTransaction for full account list + pre/post balances

normalize into canonical events: TOKEN_CREATED, BUY, SELL, GRADUATED

D) Token-2022 edge cases you must bake in

When you detect a mint:

read mint account owner to determine token program:

legacy SPL Token (Tokenkeg...)

Token-2022

derive ATAs using the correct token program semantics

for holder checks, query both where appropriate (as you wrote)

E) Mayhem-mode / alternate fee recipient logic

You already called this out correctly: the fee recipient can differ based on mode. Your sell/buy builder must:

read curve/pool state

branch on is_mayhem_mode (or equivalent)

select the correct fee recipient source, and pass it in the correct account position

This is frequently the reason "emergency sell" fixes are still incomplete.

F) Graduation routing

Do not attempt to execute a "sell" using bonding curve instructions once the token is graduated.

Pre-graduation: bonding-curve math + Pump buy/sell

Post-graduation: route via AMM (often simplest: Jupiter quote -> swap), and shift PnL to quote-based

G) Persistence model (suggested normalization)

Your "Persist:" lists are good. The main production improvement is to normalize into:

tokens (mint-level)

token_states (curve state snapshots, graduation flags, mayhem flag)

trades (normalized buy/sell, amounts, prices, tx_sig)

executions (your bot actions, idempotency keys, route, error)

token_metrics (holders, concentration, socials)

So you can recompute analytics without rewriting core facts.

Minimal acceptance tests (high-signal)

Detect 10 new mints via on-chain create logs (no REST)

For each mint: correctly classify token program (legacy vs 2022) and persist curve addresses

Ingest 100 buys/sells and reconcile:

amount_tokens from token balance deltas

amount_sol from SOL balance deltas

Identify graduation within 10 seconds of state change

Execute:

bonding-curve sell (non-graduated)

Jupiter swap sell (graduated)

Prove mayhem-mode fee recipient branching by simulation + at least one on-chain success case

---

Pump.fun Integration - Engineering Task Plan

Shared Non-Functional Requirements (applies to all tasks)

All ingestion paths must be idempotent (unique by tx_sig + instruction_index and/or mint + tx_sig where appropriate).

All event models must be normalized into canonical schema (Token, Trade, Execution, TokenState, TokenMetrics).

Execution must not rely on Pump REST. REST is discovery/metadata only.

Hard-coded program IDs are allowed, but all addresses must be sourced from config and pinned docs.

Epic 0 - Program Registry + Canonical IDLs
Task 0.1 - ProgramRegistry

Deliverable

ProgramRegistry that centralizes program IDs and instruction discriminators.

Implementation

Config keys:

PUMP_BONDING_PROGRAM_ID = 6EF8...

PUMP_AMM_PROGRAM_ID = pAMMB...

TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID

Discriminator map loaded from local IDL JSON (pinned file), not fetched at runtime.

Done criteria

Unit test: can map raw instruction data -> {name, discriminator} for at least create, create_v2, buy, sell.

One integration test: given a known Pump bonding tx, registry identifies instruction name reliably.

Epic 1 - On-chain Coin Discovery (Create / Create_v2)
Task 1.1 - Log Subscription (Yellowstone or WS)

Deliverable

PumpLogSubscriber that listens for transactions involving Pump bonding program ID.

Implementation

If available: Yellowstone gRPC path (preferred for throughput). Guides exist for Pump transaction streaming.

Fallback: Solana WS logsSubscribe + getTransaction fetch.

Done criteria

Ingest 100 create events in a row without duplicates (TTL cache OK).

"At least once" delivery to downstream normalizer with deterministic ordering.

Task 1.2 - Create Instruction Decoder

Deliverable

decodePumpCreate(ix) producing TokenCreatedEvent.

Data contract

export type TokenProgramFlavor = "spl-token" | "token-2022";

export interface TokenCreatedEvent {
  event_type: "TOKEN_CREATED";
  mint: string;
  creator: string;
  name?: string;
  symbol?: string;
  uri?: string;
  bonding_curve: string;
  associated_bonding_curve: string;
  program_id: string;      // Pump bonding program
  token_program: TokenProgramFlavor;
  is_mayhem_mode?: boolean; // if present in state / ix args
  tx_sig: string;
  slot: number;
  block_time?: number;
  source: "onchain";
}

Verification steps

Fetch mint account; determine mint owner -> token program flavor (Token-2022 vs legacy).

Validate bonding curve PDA derivation where possible (warn-only if derivation unknown).

Done criteria

Unit tests using fixture tx JSON (saved getTransaction outputs).

Integration test: persist tokens row and initial token_states snapshot.

Task 1.3 - REST Fallback (optional, discovery only)

Deliverable

PumpRestClient for coin discovery metadata fallback, with configurable base URL.

Reference

Community-cataloged Pump frontend API endpoints exist (v3 endpoints list).

Done criteria

If log ingestion fails or falls behind, REST can backfill "latest coins" for the last N minutes.

REST results are de-duped against on-chain events by mint.

Epic 2 - Latest Trades Feed (Buy/Sell Normalization)
Task 2.1 - Trade Detection + Transaction Fetch

Deliverable

PumpTradeDetector identifies buy/sell instructions from logs and fetches full transaction.

Implementation

For every candidate signature:

getTransaction(jsonParsed) and extract:

preTokenBalances, postTokenBalances

preBalances, postBalances

instruction index, account keys

Done criteria

Captures both buys and sells with consistent side classification.

Task 2.2 - Balance Delta Parser

Deliverable

parseTradeDeltas(tx, mint, user) returns amount_tokens, amount_sol, price.

Data contract

export interface TradeEvent {
  event_type: "TRADE";
  mint: string;
  side: "BUY" | "SELL";
  amount_tokens: string; // base units as string
  amount_sol: string;    // lamports as string
  price_sol_per_token: string; // decimal string (derived)
  user?: string;         // best-effort signer / token owner
  tx_sig: string;
  slot: number;
  block_time?: number;
  program_id: string;    // Pump bonding or AMM
  source: "onchain";
}

Verification

Tokens: derive from mint token balance deltas.

SOL: derive from lamport delta for user signer, adjusted for fees where possible.

Done criteria

For 50 sampled trades, parsed deltas match explorer-level interpretation within tolerance (fees accounted).

Epic 3 - Graduation Detection (Bonding -> AMM/PumpSwap)
Task 3.1 - Bonding Curve State Poller

Deliverable

BondingCurveStatePoller that loads curve state accounts for tracked tokens.

Implementation

Use getAccountInfo for bonding curve PDA.

Interpret complete and reserve fields (your existing curve decoding).

Done criteria

For a token that graduates, is_graduated flips within <=10s of on-chain completion.

Task 3.2 - AMM Program Detection

Deliverable

AmmPoolDetector identifies when token appears in Pump AMM program.

Implementation

Subscribe to Pump AMM program logs OR infer via state change / REST fields.

Store amm_pool reference if discoverable.

Done criteria

token_states.is_graduated = true implies executor switches to AMM/Jupiter route.

Epic 4 - Holders / Insiders Analyzer
Task 4.1 - Holder Snapshotter

Deliverable

HoldersAnalyzer.snapshot(mint).

Implementation

getTokenLargestAccounts(mint)

For creator wallet: getTokenAccountsByOwner checked against both token program flavors (where supported).

Persist

creator_holdings_percent, top_holders_percent, holders_count, creator_wallet.

Done criteria

Updates at 30-60s cadence without hammering RPC; caches per mint TTL.

Epic 5 - Swap Instruction Building (Execution)
5A - Bonding Curve Executor (Pump Program)
Task 5.1 - TokenProgramResolver

Deliverable

resolveTokenProgramForMint(mint) -> TokenProgramFlavor.

Done criteria

Correctly selects Token-2022 vs legacy for 100 random new coins.

Task 5.2 - FeeRecipientResolver (mode-aware)

Deliverable

resolveFeeRecipient({mint, bondingCurveState}) -> Pubkey

Implementation

Reads global/global_config as needed.

Branches on is_mayhem_mode where applicable (do not hardcode a single fee recipient).

Done criteria

For at least one "non-standard fee recipient" case, simulation passes with correct account list.

Task 5.3 - Build Sell Instruction

Deliverable

buildPumpBondingSellIx({user, mint, amountTokens, minSolOutput, tokenProgramFlavor}).

Reference

The Pump IDL expresses account ordering; treat pinned IDL as canonical.

Done criteria

Instruction compiles and simulates successfully for:

legacy SPL mint

Token-2022 mint (if encountered)

Fails with deterministic error when minSolOutput too high.

5B - Graduated Executor (AMM/Jupiter)
Task 5.4 - Jupiter Quote + Swap Builder

Deliverable

buildJupiterSwap({inputMint, outputMint, amount, slippageBps}) returning tx instructions.

Done criteria

For graduated tokens, executor always uses Jupiter route and never attempts bonding curve sell.

Epic 6 - Price/MC + PnL Engine
Task 6.1 - Price Resolver

Deliverable

getCurrentPrice(mint) selects:

bonding curve math if not graduated

Jupiter quote if graduated

Done criteria

Price updates every 30s per mint with caching and jitter.

Task 6.2 - Quote-based PnL

Deliverable

computeUnrealizedPnL(position) using:

curve sell math (non-graduated)

Jupiter quote-out (graduated)

Done criteria

For test positions, PnL matches "quote-out" behavior within acceptable slippage tolerance.

Epic 7 - Metadata/Socials Aggregation
Task 7.1 - Metadata Resolver

Deliverable

MetadataResolver.enrich(mint) that merges:

Pump REST coin fields (fast path)

On-chain metadata (Metaplex where applicable)

Done criteria

Stores image_uri, website, twitter, telegram when present; does not block core trading.

Epic 8 - Persistence Layer (Schema + Constraints)
Task 8.1 - Tables + Constraints

Deliverable

SQL migrations for core entities:

tokens

token_states

trades

executions

token_metrics

Hard requirements

Unique constraints for idempotency:

trades(tx_sig, ix_index) unique

executions(idempotency_key) unique

Done criteria

Replaying the same tx stream twice results in zero duplicate rows.

Epic 9 - Observability + QA
Task 9.1 - Structured Logging

Deliverable

Every normalized event logs:

mint, tx_sig, slot, event_type, source, latency_ms

Done criteria

Can trace a mint from create -> first trade -> graduation -> execution.

Task 9.2 - Fixture-based Integration Tests

Deliverable

fixtures/pump/ directory with saved getTransaction JSON for:

create

buy

sell

graduation boundary case

token-2022 (if available)

Done criteria

CI test suite runs decoder + parsers purely from fixtures (no live RPC).

Acceptance Checklist (system-level)

System is "complete" when:

New mints are discovered via logs and persisted within 2 seconds (steady-state).

Buys/sells are normalized from pre/post balances reliably.

Graduation flips execution routing automatically.

Emergency sell succeeds for:

non-graduated (Pump bonding curve program)

graduated (Jupiter route; Pump AMM present)

Fee recipient selection is mode-aware (no single hard-coded recipient).

Full replay of 10,000 tx signatures produces identical DB state (idempotent).

---

Repo Mapping - Engineering Task Plan to Current Codebase

Epic 0 - Program Registry + Canonical IDLs
- Current program IDs live in `packages/shared/src/chains/solana.ts` (PROGRAM_IDS) and `packages/shared/src/constants.ts` (SOLANA_CONFIG).
- Discriminators and PDA logic are hardcoded in `apps/executor/src/chains/solana/pumpFun.ts` and `apps/hunter/src/monitors/pumpfun.ts`.
- Missing today: pinned IDL JSON. Suggested location: `packages/shared/src/idl/pumpfun.json` (new) plus a new registry module such as `packages/shared/src/pumpfun/programRegistry.ts` (new).

Epic 1 - On-chain Coin Discovery (Create / Create_v2)
- WS log subscription + create parsing already in `apps/hunter/src/monitors/pumpfun.ts`.
- Alternate listener exists in `apps/executor/src/listeners/solana/pumpFunListener.ts` (create-only).
- Opportunity entrypoint is `apps/hunter/src/loops/opportunities.ts` (uses PumpFunMonitor).
- Metadata fetcher is `apps/hunter/src/utils/metadataFetcher.ts`.
- REST fallback is `packages/shared/src/api/pumpfun.ts` and `packages/shared/src/api/launchpadDetector.ts`.

Epic 2 - Latest Trades Feed (Buy/Sell Normalization)
- No dedicated trade-stream parser yet. Best fit is a new listener in `apps/executor/src/listeners/solana/` (new file) or extend `apps/executor/src/listeners/solana/pumpFunListener.ts`.
- Raw tx parsing helpers are already used in `apps/executor/src/chains/solana/solanaExecutor.ts` (balance diffs, mint decimals).
- Trade persistence hooks are in `packages/shared/src/supabase.ts` (recordTrade) and `packages/database/migrations/` for schema.

Epic 3 - Graduation Detection (Bonding -> AMM/PumpSwap)
- Bonding curve state decode is in `apps/executor/src/chains/solana/pumpFun.ts` and on-chain progress read in `apps/hunter/src/loops/opportunities.ts`.
- AMM pool detection is in `apps/executor/src/listeners/solana/raydiumListener.ts`.
- Fallback launchpad detection lives in `packages/shared/src/api/launchpadDetector.ts` and `packages/shared/src/api/dexscreener.ts`.

Epic 4 - Holders / Insiders Analyzer
- Creator holdings check (dev wallet percent) is in `apps/hunter/src/scoring/rules.ts`.
- No periodic holder snapshotter yet; suggested new module under `packages/shared/src/analysis/` or `apps/executor/src/analysis/`.
- External security sources are wired in `packages/shared/src/api/rugcheck.ts` and `packages/shared/src/api/goplus.ts`.

Epic 5 - Swap Instruction Building (Execution)
- Bonding curve executor is `apps/executor/src/chains/solana/pumpFun.ts`.
- Routing and execution flow is `apps/executor/src/chains/solana/solanaExecutor.ts`.
- Jupiter route is `apps/executor/src/chains/solana/jupiter.ts`.
- Jito/priority handling is `apps/executor/src/chains/solana/jitoClient.ts` and `apps/executor/src/security/tradeGuards.ts`.
- Token program detection and decimals are in `apps/executor/src/chains/solana/pumpFun.ts` and `apps/executor/src/chains/solana/solanaExecutor.ts`.

Epic 6 - Price/MC + PnL Engine
- Market data helper is `packages/shared/src/marketData.ts`.
- Price resolver (Jupiter + fallbacks) is `packages/shared/src/pricing.ts`.
- UI consumers: `apps/bot/src/ui/panels/positions.ts` and `apps/bot/src/ui/panels/positionDetail.ts`.
- PnL services and monitor updates: `apps/bot/src/services/pnlService.ts` and `apps/bot/src/services/tradeMonitor.ts`.

Epic 7 - Metadata/Socials Aggregation
- Metadata fetch/parse is `apps/hunter/src/utils/metadataFetcher.ts`.
- Pump REST metadata is `packages/shared/src/api/pumpfun.ts`.
- On-chain metadata fallback for pump.pro is in `apps/hunter/src/monitors/pumpfun.ts`.
- Quality gates using metadata are in `apps/hunter/src/scoring/rules.ts`.

Epic 8 - Persistence Layer (Schema + Constraints)
- Schema migrations live in `packages/database/migrations/`.
- Supabase access layer is `packages/shared/src/supabase.ts`.
- Types are in `packages/shared/src/types.ts` and `packages/database/types.ts`.

Epic 9 - Observability + QA
- Structured logging is `packages/shared/src/logger.ts` and `packages/shared/src/security/secureLogger.ts`.
- Health/monitoring is `packages/shared/src/health.ts`, `packages/shared/src/monitoring.ts`, and `apps/api/src/routes/health.ts`.
- Test harness exists in `apps/executor/src/tests/` (add pump fixtures there).

---

Gap Checklist - Exists vs Missing

Program Registry + IDL
- Exists: program IDs in `packages/shared/src/chains/solana.ts` and `packages/shared/src/constants.ts`.
- Missing [P1, M]: pinned IDL JSON file + registry module that maps discriminators (suggest `packages/shared/src/idl/` + `packages/shared/src/pumpfun/programRegistry.ts`).

On-chain Discovery
- Exists: pump.fun/pump.pro log subscriptions and create parsing in `apps/hunter/src/monitors/pumpfun.ts`.
- Missing [P2, L]: Yellowstone gRPC path + dedicated backfill using REST for create gaps.

Trade Normalization (Buy/Sell)
- Exists: execution path has balance delta logic in `apps/executor/src/chains/solana/solanaExecutor.ts`.
- Missing [P1, M]: reusable trade-stream normalizer (logsSubscribe + getTransaction) that persists trades.

Graduation Detection
- Exists: bonding curve progress decode in `apps/executor/src/chains/solana/pumpFun.ts` and `apps/hunter/src/loops/opportunities.ts`.
- Exists: Raydium pool listener in `apps/executor/src/listeners/solana/raydiumListener.ts`.
- Missing [P1, S]: explicit "graduated" state + pool reference persistence in DB (schema hook).

Holders / Insiders
- Exists: creator holdings check in `apps/hunter/src/scoring/rules.ts`.
- Missing [P2, M]: periodic holder snapshotter + top-holder concentration persistence.

Execution (Bonding Curve + AMM)
- Exists: pump.fun client in `apps/executor/src/chains/solana/pumpFun.ts`, Jupiter in `apps/executor/src/chains/solana/jupiter.ts`.
- Missing [P0, M]: mode-aware fee recipient resolver (mayhem) + explicit IDL account ordering validation.

Pricing / PnL
- Exists: `packages/shared/src/marketData.ts`, `packages/shared/src/pricing.ts`, UI panels in `apps/bot/src/ui/panels/`, on-chain bonding curve fallback, and Jupiter quote-based PnL.
- Missing [P2, S]: quote throttling strategy for high-frequency UI refresh.

Metadata / Socials
- Exists: metadata fetcher `apps/hunter/src/utils/metadataFetcher.ts` + REST metadata `packages/shared/src/api/pumpfun.ts`.
- Missing [P2, S]: consolidated metadata resolver module shared between hunter/executor/bot.

Persistence
- Exists: migrations in `packages/database/migrations/`, supabase access in `packages/shared/src/supabase.ts`.
- Missing [P1, M]: normalized tables for tokens/token_states/trades/executions/token_metrics (if not already added).

Observability / QA
- Exists: logger in `packages/shared/src/logger.ts`, health endpoints in `apps/api/src/routes/health.ts`.
- Missing [P2, M]: fixture-based Pump transaction test suite and deterministic replay harness.
