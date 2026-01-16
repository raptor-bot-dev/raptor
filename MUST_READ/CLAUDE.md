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
