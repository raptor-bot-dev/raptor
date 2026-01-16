Claude Code Prompt — RAPTOR Bot Simplification + Panel Redesign (Telegram-only)

You are Claude Code acting as **Lead Maintainer + Telegram Bot Engineer**. Your task is to **simplify and redesign the RAPTOR Telegram bot** to the new minimal product shape (Autohunt-only, no manual buyer), implement the new terminal-style panel system, ensure math correctness (withdraw, PnL), and remove dead/legacy paths. After changes, run typecheck/build, fix errors, and commit.

### Non-negotiable UX requirements

1. Use `parse_mode: 'HTML'` for all redesigned panels.
2. **No emojis on buttons** (keyboard labels). Panels may include emojis.
3. Headings must have **no blank lines**. No extra line breaks anywhere besides required `\n` between lines.
4. Every panel must include an **“invisible width pad” line** immediately after divider to maximize bubble width on all devices:

   * Use Braille Pattern Blank U+2800 repeated ~80 chars inside `<code>...</code>`.
5. Brand icon is a dinosaur: **🦖** in all headers.
6. Linux joiners (`└─`) only appear for **parent → detail** lines (wallet→balance, price→MC, amount→tokens, pnl%→pnlSOL). One level deep only.

### Product scope decisions

* **Remove manual buyer completely** (no CA scan/buy/sell manual flows).
* No /deposit command. Users can fund by sending SOL to wallet address.
* Keep **withdraw** (custom amount in SOL or % only; no presets).
* Autohunt runs on backend; bot sends **notifications on buy/sell**, plus status screens.
* Allow **max 2 open positions** per wallet.
* Add **Emergency Sell** and **Chart** actions on open positions and on buy notification.

### Required Screens (Telegram panels)

Implement the following panels and flows exactly:

#### A) HOME

Header: `🦖 <b>RAPTOR | HOME</b>`
Divider: `━━━━━━━━━━━━━━━━━━━━━━`
Pad line: `<code>${WIDTH_PAD}</code>`
Body:

* Wallet list (full address in `<code>...</code>`), each followed by joiner balance line:

  * `1) <code>{address}</code>`
  * `   └─ {balance} SOL`
* Autohunt status: Armed/Disarmed
* Open Positions: `{n} / 2`
* Trades: total, wins, losses
* Realized PnL: SOL and % (no fake values; compute from closed positions only)

Keyboard labels (no emojis):

* Row 1: `Arm Autohunt` or `Disarm`, `Positions ({n})`
* Row 2: `Withdraw`, `Settings`
* Row 3: `Help`, `Refresh`

#### B) SETTINGS (minimal)

Fields:

* Trade Size (SOL) — custom input
* Max Positions (1 or 2)
* Take Profit %
* Stop Loss %
* Max Buys/Hour
* Slippage bps (optional, but include for completeness)
  Keyboard:
* `Edit Trade Size`, `Edit Max Positions`
* `Edit TP`, `Edit SL`
* `Edit Max Buys/Hr`, `Edit Slippage`
* `Home`
  Each edit leads to an input prompt and updates persisted user config.

#### C) ARM / DISARM confirm

Arm shows current config and warning; Disarm confirms stop.
Keyboard: `Confirm`, `Cancel`, plus `Home` (and `Settings`/`Positions` where appropriate).

#### D) POSITIONS list

List open positions only (0–2). For each:

* token symbol
* mint (code line)
* joiner line with Entry SOL, Entry MC, and PnL% if available (from cached pricing); omit PnL if unavailable.
  Keyboard:
* For each position i: `i Details`, `i Emergency Sell`, `i Chart`
* Bottom: `Refresh`, `Home`

#### E) POSITION details

Show:

* token name/symbol, mint
* entry price with joiner entry MC
* exit rules (TP/SL)
* size (entry SOL) with joiner token amount
* status OPEN/CLOSING
  Keyboard:
* `Emergency Sell`, `Chart`
* `View Entry TX`, `Back`
* `Home`

#### F) EMERGENCY SELL confirm

Confirm emergency close, show mint and current token balance.
Keyboard:

* `Confirm Sell`, `Cancel`
* `Chart`, `Back`
* `Home`

#### G) WITHDRAW

No deposit. Withdraw only:

* Screen shows from-wallet (code), balance, fee buffer, max withdraw, destination (code or “Not set”).
  Buttons:
* `Set Destination`, `Withdraw SOL`, `Withdraw %`
* `Back`, `Home`
  Withdraw SOL prompt: “Enter amount in SOL. Example: 0.15”
  Withdraw % prompt: “Enter percent (1–100). Example: 25”
  Confirm screen shows to, amount, estimated fees, approx receive.

### Notifications

#### ✅ HUNT EXECUTED

Panel title: `RAPTOR | HUNT EXECUTED` (emoji allowed in panel text, not buttons)
Body:

* token name/symbol
* mint in code
* entry price with joiner market cap
* bought SOL with joiner token amount
* TX link
  Buttons: `Chart`, `Emergency Sell`, `View TX`

#### 🎯 HUNT CLOSED

Body:

* entry price with joiner entry MC
* exit price with joiner exit MC
* received SOL
* pnl% with joiner pnl SOL
* TX link
  Buttons: `View TX`, `Positions`, `Home`

#### HUNT SKIPPED / EXECUTION FAILED

Also implement with tight formatting. Buttons: `Settings`/`Positions`/`Home` only.

---

# Callback IDs and routing (strict)

Implement or standardize these callback IDs (no emoji labels):

### Home

* `home:open`
* `home:refresh`

### Autohunt

* `hunt:arm`
* `hunt:disarm`
* `hunt:confirm_arm`
* `hunt:confirm_disarm`
* `hunt:cancel`

### Settings

* `settings:open`
* `settings:edit_trade_size`
* `settings:edit_max_positions`
* `settings:edit_tp`
* `settings:edit_sl`
* `settings:edit_max_buys_hr`
* `settings:edit_slippage`
* `settings:back_home`

### Positions

* `positions:open`
* `positions:refresh`
* `position:details:{positionId}`
* `position:chart:{positionId}`
* `position:emergency_sell:{positionId}`
* `position:confirm_emergency_sell:{positionId}`
* `position:cancel_emergency_sell:{positionId}`

### Withdraw

* `withdraw:open`
* `withdraw:set_destination`
* `withdraw:amount_sol`
* `withdraw:amount_pct`
* `withdraw:confirm`
* `withdraw:cancel`
* `withdraw:back`

### Links

* `link:tx:{sig}` optional (or embed as normal URL button)
* `link:chart:{mint}` optional (or embed as normal URL button)

---

# File-level instructions (what to delete / disable)

1. **Remove manual buyer UI flows**:

   * Delete callbacks, commands, and handlers related to manual CA scanning, manual buy/sell, and trade monitor panels.
   * If you cannot delete safely, hard-disable them: reply with “This feature has been removed in the simplified bot.”

2. Remove `/deposit` command and any “deposit menu” panels.

3. Keep only:

   * home/status
   * settings
   * positions
   * withdraw
   * help
   * autohunt arm/disarm

Ensure no dangling callback IDs remain.

---

# Panel rendering implementation (mandatory)

Create a single helper (or reuse existing wrapper) that enforces:

* header + divider + width pad
* join with single `\n`
* no double blank lines
* HTML escaping for dynamic strings
* consistent dinosaur icon

Example structure:

* `apps/bot/src/ui/panel.ts` (or `apps/bot/src/utils/panels.ts`)
  Exports:
* `renderPanel(title: string, lines: string[]): { text: string, parse_mode: 'HTML' }`
* `code(text)`, `b(text)`, `escapeHtml(text)`
* `joiner(detailLine: string)` returns `   └─ ${detailLine}`

WIDTH_PAD constant must be in one place.

---

# Math correctness requirements

## Withdraw math (must be exact)

Let:

* `balanceLamports = getBalance(wallet)`
* `balanceSol = balanceLamports / 1e9`
* `bufferSol = 0.01` (configurable constant)
* `maxWithdrawSol = max(0, balanceSol - bufferSol)`

### SOL amount

* input `x` parse float
* validate `0 < x <= maxWithdrawSol`
* send lamports: `floor(x * 1e9)`
* re-check balance immediately before send to prevent overdraft

### Percent

* input `p` parse float
* validate `1 <= p <= 100`
* `withdrawLamports = floor((balanceLamports - bufferLamports) * p / 100)`
* reject if <= 0
* send `withdrawLamports`

Always show a confirm panel with computed values.

## PnL correctness

* Only compute realized PnL from closed positions:

  * `pnlSol = sum(exitSol - entrySol - fees if you track)`
  * `pnlPct = pnlSol / sum(entrySol)` (or weighted average; choose and document)
* Do not show “live PnL” unless you have a reliable price snapshot in DB; otherwise omit.

## Max positions = 2

Enforce at entry:

* if open positions >= 2 → skip (and optionally notify)
  Also ensure emergency sell respects locks.

---

# Execution correctness requirements

Emergency Sell must:

* be idempotent (key: `sell:positionId:emergency`)
* lock position row (or mutex)
* set status `CLOSING_EMERGENCY`
* sell current ATA token balance (Token-2022 and SPL)
* on success: close position and notify
* on failure: revert to OPEN or mark FAILED with safe messaging

Chart link must open Dexscreener:

* `https://dexscreener.com/solana/{mint}`

TX link must open Solscan:

* `https://solscan.io/tx/{sig}`

---

# Engineering tasks

1. Implement panel helper and update all panels to use it.
2. Replace existing menus with the new minimal set.
3. Remove/manual-disable old features and callbacks.
4. Ensure all callback routes are registered and don’t throw.
5. Run validations:

   * Typecheck
   * Build
   * Lint (if available)
6. Start bot locally and smoke test:

   * Home renders width padded (bubble wide)
   * Wallet lines are monospace and copyable
   * Buttons contain no emojis
   * Settings edits persist
   * Positions list renders, details render
   * Emergency sell confirm screen works
   * Withdraw SOL and Withdraw % flows validate correctly
7. Commit with clear messages and push.

Commit message suggestion:

* `refactor(bot): simplify UI to autohunt-only terminal panels`
* `feat(bot): emergency sell + chart links`
* `fix(withdraw): add custom SOL/% withdrawal validation`
* `chore(ui): add HTML panel renderer + width pad`

Return a summary of changed files and any remaining TODOs.

---
