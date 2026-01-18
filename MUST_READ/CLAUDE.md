# CLAUDE.md (RAPTOR)

This file is the working contract for Claude Code while iterating on RAPTOR. Keep it short; update as we go.

## Project goals

**Phase A target:** ship a minimal, production-ready **Solana pump.fun Autohunt** product.

MVP must deliver:
- Autohunt-only trading (remove or hard-disable manual buyer and live trade monitor UX).
- Telegram UI for: Home, Settings, Positions, Withdraw, Help.
- Telegram notifications on: buy executed, position closed, emergency sell, failures.
- 1 wallet per user (simple). Allow up to **2 concurrent positions** per wallet (configurable, default 2).
- A fail-safe: **Emergency Sell** button + **Chart** link on all position panels and notifications.

Key principle: **reuse existing code**. Prefer refactor/disable paths over rewrites.

## Repo structure (current)

- `apps/bot`: Telegram UI (grammy).
- `apps/hunter`: Autohunt detection + strategy selection.
- `apps/executor`: Transaction build/sign/send + chain adapters.
- `apps/api`: Internal/utility API layer (if present).
- `packages/*`: shared types, db helpers, common utils.

**Do not introduce a new runtime.** The repo is Node 20+ and pnpm workspaces.

## Telegram UI/UX style guide (must follow)

**Rendering:** use `parse_mode: 'HTML'` for predictable monospace and safe escaping.

**Buttons:** no emojis on buttons. Emojis are allowed inside panel text.

**Headings:** avoid extra blank lines. Use single-line headings.

**Max width trick:** add an invisible width pad line to widen Telegram bubbles on most devices.
- Use Braille Pattern Blank (U+2800) repeated ~80 chars inside a <code> line.
- Example: <code>${WIDTH_PAD}</code> where WIDTH_PAD is "⠀⠀⠀⠀..." (U+2800 repeats).

**Wallet list pattern:**
- Address in monospace.
- Balance as a child line with linux joiner.

Example:
1) <code>ADDRESS</code>
   └─ 0.10 SOL

**Joiners rule:** joiners (`└─`, optional `├─`) are only for parent→detail lines (one level deep).

**Raptor brand:** use dinosaur (raptor), not a bird mascot.

## Constraints and policies

Security
- Never log secrets (private keys, encrypted blobs, request headers that may contain secrets).
- Decrypt keys in-memory only; zeroize references ASAP.
- No key material in Supabase except encrypted-at-rest blobs that we already use (do not change format without migration plan).

Product constraints
- No /deposit flow: users can import a wallet or fund the generated address.
- Keep configuration simple: one wallet active; max 2 open positions.
- No “live trade monitor” UI; positions list is sufficient.
- Always provide Solscan TX links and a chart link for the token.

Reliability
- Every action must return a user-visible outcome: success panel, failure panel, or retry guidance.
- All timers (TP/SL/timeouts) must be enforced server-side (hunter/executor), not just in UI.

## Repo etiquette
- Prefer small, reviewable commits with clear messages.
- Do not change lockfiles unless required.
- Keep shared types in `packages/` and import them (avoid duplicating interfaces across apps).
- Remove features by **hard-disabling** first (feature flag / menu removal) before deleting code.

## Commands Claude may run without asking

Safe read-only / build commands:
- `pnpm -w install`
- `pnpm -w lint`
- `pnpm -w test`
- `pnpm -w build`
- `pnpm -w exec turbo run lint`
- `pnpm -w exec turbo run build`
- `pnpm -w exec turbo run test`

Safe repo tooling:
- `git status`, `git diff`, `git log --oneline --decorate -n 20`

Not allowed without asking
- Any command that deploys, rotates secrets, touches production DB, or broadcasts mainnet transactions.

## Testing rules
- CI minimum: `pnpm -w lint && pnpm -w test && pnpm -w build`.
- For trading logic, add unit tests for math (TP/SL %, fees, rounding) and for timer enforcement.
- Integration tests must default to mocked RPC unless explicitly configured.

## TP/SL Engine Constraints

### Non-Negotiable Design Patterns

1. **Never execute in WS callback** - Queue exit jobs, don't block WebSocket processing
2. **Atomic DB claims** - Use `trigger_exit_atomically()` for exactly-once triggering
3. **Idempotency keys** - All exits must use `idKeyExitSell({positionId, trigger, sellPercent})`
4. **Token-scoped subscriptions** - One WebSocket sub per token, many positions watch it
5. **Backpressure** - ExitQueue limits concurrency to prevent executor overload

### Trigger State Machine Rules

- Never transition backwards (e.g., TRIGGERED → MONITORING)
- Never set trigger_state for already-closed positions
- On failure, mark FAILED but don't reset to MONITORING
- FAILED positions require manual intervention via Emergency Sell

### Helius WebSocket Requirements

- **Heartbeat**: Ping every 30 seconds (Helius has 10-min inactivity timeout)
- **Reconnect**: Exponential backoff, max 10 attempts, then 60s cooldown
- **Resubscribe**: On reconnect, restore all active subscriptions
- **One pubkey per call**: logsSubscribe only supports single address filter

### Price Source Priority

1. Jupiter Price API (primary, 3s polling) - reliable, battle-tested
2. WebSocket activity hints (optional) - triggers immediate Jupiter re-fetch
3. Never rely solely on WebSocket for price - use for activity detection only

### Exit Priority

When multiple triggers fire simultaneously:
1. SL (highest priority - protect capital)
2. TP
3. TRAIL
4. MAXHOLD (lowest priority)

### Position Creation Requirements

Always populate these fields when creating positions via `createPositionV31()`:
- `tg_id` (NOT user_id - table uses tg_id column)
- `trigger_state: 'MONITORING'`
- `tp_price` / `sl_price` (computed from entry price + strategy percentages)
- `bonding_curve` (from opportunity if available)

### State Machine Transitions

Call these functions in execution.ts for SELL jobs:
1. **Before sell**: `markPositionExecuting(positionId)`
2. **On success**: `markTriggerCompleted(positionId)` (after closePositionV31)
3. **On failure**: `markTriggerFailed(positionId, errorMsg)`

### Notification Type Mapping

Use correct notification types that match the formatter:
- `'TP'` trigger → `'TP_HIT'` type (not 'TAKE_PROFIT')
- `'SL'` trigger → `'SL_HIT'` type (not 'STOP_LOSS')
- `'TRAIL'` trigger → `'TRAILING_STOP_HIT'` type
- `'MAXHOLD'` / `'EMERGENCY'` → `'POSITION_CLOSED'` type

### Notification Payload Structure

Use these keys (matching NotificationPoller formatter):
```typescript
{
  tokenSymbol: string,   // not 'token'
  pnlPercent: number,
  solReceived: number,
  txHash: string,
  trigger: ExitTrigger,
  positionId: string,
}
```

### Duplicate Trigger Prevention

Legacy monitors must check `trigger_state` before firing:
```typescript
if (position.trigger_state && position.trigger_state !== 'MONITORING') {
  return; // Already triggered by TP/SL engine
}
```
