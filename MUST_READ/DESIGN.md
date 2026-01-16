Below is the complete, finalized redesign spec for the simplified RAPTOR Telegram bot, incorporating everything you decided:

Terminal aesthetic

🦖 dinosaur header

HTML parse_mode

Invisible width pad line on every panel (U+2800 braille blanks inside <code>)

Linux joiners only for parent → detail lines

No emojis on buttons

Minimal flows (no manual buyer, no deposit)

Emergency sell + chart links

Withdraw supports custom SOL or custom % only

Max open positions = 2

You can give this directly to Claude to implement.

Global Panel Renderer (mandatory)
Header + divider + width pad

Every panel must be rendered by a single helper:

Header line: 🦖 <b>RAPTOR | {TITLE}</b>
Divider: ━━━━━━━━━━━━━━━━━━━━━━
Width pad: <code>{WIDTH_PAD}</code>
Then content lines (no blank lines).

WIDTH_PAD constant

Use U+2800 (Braille Pattern Blank) repeated ~80 chars:

const WIDTH_PAD = "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀";

Always render:
<code>${WIDTH_PAD}</code>

Joiner rules

Only use └─ and (rarely) ├─

One-level deep only

Indent child lines by 3 spaces: └─ ...

Button rules

No emojis

Short labels

Consistent Title Case

Max 2 rows whenever possible

Always provide Home or Back in secondary screens

Screen Inventory (all panels)
1) HOME

Title: HOME
Body:

Wallet list (full addresses in code, balance as joiner line)

Autohunt status

Open positions count / 2

Trades summary

Realized PnL

Template:
🦖 <b>RAPTOR | HOME</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Wallets</b>

<code>{wallet1}</code>
└─ {bal1} SOL

<code>{wallet2}</code>
└─ {bal2} SOL
<b>Autohunt:</b> {Armed|Disarmed}
<b>Open Positions:</b> {open} / 2
<b>Trades:</b> {t} (W {w} / L {l})
<b>PnL:</b> {pnlSol} SOL
└─ {pnlPct}%

Buttons:
Row 1: Arm Autohunt (or Disarm), Positions ({open})
Row 2: Withdraw, Settings
Row 3: Help, Refresh

2) SETTINGS (minimal)

Title: SETTINGS
Fields:

Trade Size (SOL)

Max Positions (1 or 2)

Take Profit %

Stop Loss %

Max Buys/Hour

Optional: Slippage bps

Template:
🦖 <b>RAPTOR | SETTINGS</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Trade Size:</b> {tradeSize} SOL
<b>Max Positions:</b> {maxPos}
<b>Take Profit:</b> {tp}%
<b>Stop Loss:</b> {sl}%
<b>Max Buys/Hour:</b> {rate}
<b>Slippage:</b> {slip} bps

Buttons:
Row 1: Edit Trade Size, Edit Max Positions
Row 2: Edit TP, Edit SL
Row 3: Edit Max Buys/Hr, Edit Slippage
Row 4: Home

Edit prompts (all identical pattern)

Title: EDIT {FIELD}
🦖 <b>RAPTOR | EDIT {FIELD}</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
Enter {field} as {format}. Example: {example}

No extra lines.

3) ARM / DISARM Confirm
ARM

🦖 <b>RAPTOR | ARM AUTOHUNT</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Trade Size:</b> {tradeSize} SOL
<b>Max Positions:</b> {maxPos}
<b>TP:</b> {tp}%
<b>SL:</b> {sl}%
<b>Max Buys/Hour:</b> {rate}
<b>Warning:</b> Trades execute automatically.

Buttons:
Row 1: Confirm, Cancel
Row 2: Settings, Home

DISARM

🦖 <b>RAPTOR | DISARM AUTOHUNT</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
Autohunt will stop taking new entries. Open positions can still close automatically unless you emergency sell.

Buttons:
Row 1: Confirm, Cancel
Row 2: Positions, Home

4) POSITIONS LIST

Title: POSITIONS
Show open positions only (0–2).

Template (n>0):
🦖 <b>RAPTOR | POSITIONS</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Open:</b> {open} / 2

<b>{SYMBOL}</b>
└─ <code>{MINT}</code>
└─ Entry: {entrySol} SOL └─ MC: {entryMc} └─ PnL: {pnlPct}%

<b>{SYMBOL}</b>
└─ <code>{MINT}</code>
└─ Entry: {entrySol} SOL └─ MC: {entryMc} └─ PnL: {pnlPct}%

(If you don’t have PnL snapshot, omit it. Do not show fake values.)

Buttons:
Row per position:

Row: 1 Details, 1 Emergency Sell, 1 Chart

Row: 2 Details, 2 Emergency Sell, 2 Chart
Bottom: Refresh, Home

Template (n=0):
🦖 <b>RAPTOR | POSITIONS</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
No open positions.

Buttons: Refresh, Home

5) POSITION DETAILS

Title: POSITION
Use joiners to connect entry→mc and size→token.

Template:
🦖 <b>RAPTOR | POSITION</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Token:</b> {NAME} ({SYMBOL})
<code>{MINT}</code>
<b>Entry Price:</b> {entryPrice}
└─ <b>Entry MC:</b> {entryMc}
<b>Exit Rules:</b> TP {tp}% └─ SL {sl}%
<b>Size:</b> {entrySol} SOL
└─ {tokens} {SYMBOL}
<b>Status:</b> {OPEN|CLOSING}

Buttons:
Row 1: Emergency Sell, Chart
Row 2: View Entry TX, Back
Row 3: Home

6) EMERGENCY SELL Confirm

Title: EMERGENCY SELL

Template:
🦖 <b>RAPTOR | EMERGENCY SELL</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Token:</b> {SYMBOL}
<code>{MINT}</code>
<b>Sell:</b> 100%
└─ {tokenBal} {SYMBOL}
<b>Note:</b> This closes immediately and may execute at a worse price than waiting for TP.

Buttons:
Row 1: Confirm Sell, Cancel
Row 2: Chart, Back
Row 3: Home

7) WITHDRAW

No deposit screen. Withdraw only.

WITHDRAW HOME

🦖 <b>RAPTOR | WITHDRAW</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>From:</b> <code>{wallet}</code>
<b>Balance:</b> {bal} SOL
<b>Fee Buffer:</b> {buffer} SOL
<b>Max Withdraw:</b> {max} SOL
<b>Destination:</b> <code>{destOrUnset}</code>

Buttons:
Row 1: Set Destination, Withdraw SOL, Withdraw %
Row 2: Back, Home

Input prompts

🦖 <b>RAPTOR | WITHDRAW SOL</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
Enter amount in SOL. Example: 0.15

🦖 <b>RAPTOR | WITHDRAW %</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
Enter percent (1–100). Example: 25

Confirm

🦖 <b>RAPTOR | CONFIRM WITHDRAW</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>To:</b> <code>{dest}</code>
<b>Amount:</b> {amt} SOL
└─ Est Fees: {fees} SOL
<b>Receive:</b> ~{recv} SOL

Buttons:
Row 1: Confirm, Cancel
Row 2: Back, Home

Notifications (Autohunt)
✅ HUNT EXECUTED

🦖 <b>RAPTOR | HUNT EXECUTED</b> ✅
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Token:</b> {NAME} ({SYMBOL})
<code>{MINT}</code>
<b>Entry Price:</b> {price}
└─ <b>Market Cap:</b> {mc}
<b>Bought:</b> {solIn} SOL
└─ {tokensOut} {SYMBOL}
<b>TX:</b> {txLinkText}

Buttons: Chart, Emergency Sell, View TX

🎯 HUNT CLOSED

🦖 <b>RAPTOR | HUNT CLOSED</b> 🎯
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Token:</b> {SYMBOL}
<code>{MINT}</code>
<b>Entry Price:</b> {entryPrice}
└─ <b>Entry MC:</b> {entryMc}
<b>Exit Price:</b> {exitPrice}
└─ <b>Exit MC:</b> {exitMc}
<b>Received:</b> {solOut} SOL
<b>PnL:</b> {pnlPct}%
└─ {pnlSol} SOL
<b>TX:</b> {txLinkText}

Buttons: View TX, Positions, Home

💤 HUNT SKIPPED

🦖 <b>RAPTOR | HUNT SKIPPED</b>
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Reason:</b> {reason}
<b>Needed:</b> {need} SOL
└─ <b>Have:</b> {have} SOL

Buttons: Settings, Home

⚠️ EXECUTION FAILED

🦖 <b>RAPTOR | EXECUTION FAILED</b> ⚠️
━━━━━━━━━━━━━━━━━━━━━━
<code>{WIDTH_PAD}</code>
<b>Action:</b> {BUY|SELL}
<b>Token:</b> {symbol}
└─ <code>{mint}</code>
<b>Reason:</b> {shortError}
<b>Next:</b> {retryPolicy}

Buttons: Positions, Home

Links

Chart: Dexscreener https://birdeye.com/solana/{mint}

TX: Solscan https://solscan.io/tx/{sig}

Below is a Panel Kit you can drop into the repo to make every Telegram screen consistent, tight, and maintainable—without rewriting your bot logic. It centralizes:

🦖 header + divider + invisible width pad

HTML escaping

joiner rules (└─)

wallet rows and stats rows

standardized inline keyboards (emoji-free labels)

a “no blank lines” compactor so panels stay tight automatically

It is designed so you wrap existing handlers: replace ctx.reply("...") with ctx.reply(panel.text, panel.opts) and keep your business logic intact.

1) Create apps/bot/src/ui/panelKit.ts
// apps/bot/src/ui/panelKit.ts
import type { InlineKeyboardMarkup } from "grammy/types";

/**
 * RAPTOR Panel Kit (HTML)
 * - Enforces terminal UI standards
 * - Avoids blank lines
 * - Provides reusable row builders
 * - Enforces "no emoji" button labels
 */

export type Panel = {
  text: string;
  opts: {
    parse_mode: "HTML";
    reply_markup?: InlineKeyboardMarkup;
    disable_web_page_preview?: boolean;
  };
};

export type Button = { text: string; callback_data?: string; url?: string };

const DINO = "🦖";
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━━━";

// U+2800 Braille Pattern Blank – visually empty, but contributes width.
export const WIDTH_PAD =
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀";

// --- Safety / formatting helpers ---

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function b(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

export function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

/**
 * Joiner line (parent -> detail). Keep indentation consistent.
 * Example: "   └─ 0.10 SOL"
 */
export function join(detail: string): string {
  return `   └─ ${detail}`;
}

/**
 * Compacts any accidental extra spacing.
 * - Removes leading/trailing whitespace lines
 * - Collapses multiple blank lines into none
 * - Trims end-of-line spaces
 */
export function compactLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = (raw ?? "").replace(/[ \t]+$/g, "");
    // skip truly empty lines to honor "no blank lines" policy
    if (line.trim() === "") continue;
    out.push(line);
  }
  return out;
}

// --- Emoji-free button label enforcement ---
const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

export function assertNoEmoji(label: string): void {
  if (EMOJI_REGEX.test(label)) {
    throw new Error(
      `Button label contains emoji (disallowed): "${label}". Use plain text labels only.`
    );
  }
}

export function kb(rows: Button[][]): InlineKeyboardMarkup {
  // Validate labels
  for (const row of rows) {
    for (const btn of row) {
      assertNoEmoji(btn.text);
      if (!btn.callback_data && !btn.url) {
        throw new Error(`Button "${btn.text}" missing callback_data or url`);
      }
      if (btn.callback_data && btn.url) {
        throw new Error(`Button "${btn.text}" cannot have both callback_data and url`);
      }
    }
  }
  return {
    inline_keyboard: rows.map((row) =>
      row.map((btn) =>
        btn.url ? { text: btn.text, url: btn.url } : { text: btn.text, callback_data: btn.callback_data! }
      )
    ),
  };
}

// --- Core panel renderer ---

export function panel(
  title: string,
  lines: string[],
  buttons?: Button[][],
  opts?: { disable_web_page_preview?: boolean }
): Panel {
  const safeTitle = escapeHtml(title);
  const body = compactLines(lines);

  const textLines = [
    `${DINO} <b>RAPTOR | ${safeTitle}</b>`,
    DIVIDER,
    `<code>${WIDTH_PAD}</code>`,
    ...body,
  ];

  return {
    text: textLines.join("\n"),
    opts: {
      parse_mode: "HTML",
      reply_markup: buttons ? kb(buttons) : undefined,
      disable_web_page_preview: opts?.disable_web_page_preview ?? true,
    },
  };
}

// --- Reusable row builders (UI primitives) ---

/** Section header, bold label (no extra spacing). */
export function section(label: string): string {
  return b(label);
}

/** Standard stat line: "<b>Label:</b> value" */
export function stat(label: string, value: string): string {
  return `${b(`${label}:`)} ${escapeHtml(value)}`;
}

/**
 * Wallet row:
 * 1) <code>ADDRESS</code>
 *    └─ 0.10 SOL
 */
export function walletRow(index: number, address: string, balanceSolText: string): string[] {
  return [
    `${index}) ${code(address)}`,
    join(`${escapeHtml(balanceSolText)} SOL`),
  ];
}

/**
 * Mint row for token:
 * <b>SYMBOL</b>
 *    └─ <code>MINT</code>
 */
export function tokenHeader(symbol: string, mint: string): string[] {
  return [
    `${b(symbol)}`,
    join(`${code(mint)}`),
  ];
}

/**
 * Price + market cap:
 * <b>Entry Price:</b> $0.0000123
 *    └─ <b>Market Cap:</b> $12.3K
 */
export function priceMc(label: string, price: string, mc: string): string[] {
  return [
    stat(label, price),
    join(`${b("Market Cap:")} ${escapeHtml(mc)}`),
  ];
}

/**
 * Amount + detail:
 * <b>Bought:</b> 0.50 SOL
 *    └─ 123,456 TOKEN
 */
export function amountDetail(label: string, amount: string, detail: string): string[] {
  return [
    stat(label, amount),
    join(escapeHtml(detail)),
  ];
}

// --- Link helpers (URLs for buttons) ---
export function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(sig)}`;
}

export function dexscreenerChartUrl(mint: string): string {
  return `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;
}

// --- Numeric formatting helpers (keep minimal, predictable) ---

/**
 * Format SOL balance with readable precision:
 * >=1 => 2dp
 * >=0.01 => 4dp
 * else => 6dp
 */
export function formatSol(sol: number): string {
  if (!Number.isFinite(sol)) return "0";
  const abs = Math.abs(sol);
  const dp = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return sol.toFixed(dp);
}

2) Example usage: HOME panel

Replace your current home render with something like:

import { panel, section, stat, walletRow, formatSol } from "../ui/panelKit";

// Example: addresses and balances already fetched elsewhere
export function renderHome(args: {
  wallets: { address: string; balanceSol: number }[];
  armed: boolean;
  openPositions: number;
  trades: { total: number; wins: number; losses: number };
  pnl: { sol: number; pct: number };
}) {
  const lines: string[] = [];

  lines.push(section("Wallets"));
  args.wallets.forEach((w, i) => {
    const [l1, l2] = walletRow(i + 1, w.address, formatSol(w.balanceSol));
    lines.push(l1, l2);
  });

  lines.push(
    stat("Autohunt", args.armed ? "Armed" : "Disarmed"),
    stat("Open Positions", `${args.openPositions} / 2`),
    stat("Trades", `${args.trades.total} (W ${args.trades.wins} / L ${args.trades.losses})`),
    stat("PnL", `${formatSol(args.pnl.sol)} SOL`),
    `   └─ ${args.pnl.pct.toFixed(2)}%`
  );

  const buttons = [
    [
      { text: args.armed ? "Disarm" : "Arm Autohunt", callback_data: args.armed ? "hunt:disarm" : "hunt:arm" },
      { text: `Positions (${args.openPositions})`, callback_data: "positions:open" },
    ],
    [
      { text: "Withdraw", callback_data: "withdraw:open" },
      { text: "Settings", callback_data: "settings:open" },
    ],
    [
      { text: "Help", callback_data: "help:open" },
      { text: "Refresh", callback_data: "home:refresh" },
    ],
  ] as const;

  return panel("HOME", lines, buttons);
}

3) Example usage: ✅ HUNT EXECUTED notification
import {
  panel, stat, code, join, priceMc, amountDetail,
  dexscreenerChartUrl, solscanTxUrl
} from "../ui/panelKit";

export function renderHuntExecuted(args: {
  name: string;
  symbol: string;
  mint: string;
  entryPrice: string;
  marketCap: string;
  solIn: string;
  tokensOut: string;
  txSig: string;
}) {
  const lines: string[] = [];

  lines.push(
    `${stat("Token", `${args.name} (${args.symbol})`)}`,
    code(args.mint),
    ...priceMc("Entry Price", args.entryPrice, args.marketCap),
    ...amountDetail("Bought", `${args.solIn} SOL`, `${args.tokensOut} ${args.symbol}`),
    `${stat("TX", "View on Solscan")}`
  );

  const buttons = [
    [
      { text: "Chart", url: dexscreenerChartUrl(args.mint) },
      { text: "Emergency Sell", callback_data: `position:emergency_sell_by_mint:${args.mint}` },
      { text: "View TX", url: solscanTxUrl(args.txSig) },
    ],
  ];

  // Title includes emoji in the panel text (allowed); keep buttons emoji-free.
  return panel("HUNT EXECUTED ✅", lines, buttons);
}


Note: The emergency sell callback can be either by positionId (preferred) or by mint lookup if you don’t have positionId at notification time. Prefer positionId.

4) Where to integrate with minimal code churn
Minimal replacement strategy

Keep all current business logic and DB calls.

Only change the “string building” and “reply/edit” calls.

Pattern:

const p = renderHome(data);
await ctx.reply(p.text, p.opts);


or if editing:

await ctx.editMessageText(p.text, p.opts);


This avoids rewriting logic.

Optional: enforce globally via middleware

If you already have a middleware wrapper, you can:

keep it, but ensure it does not add extra blank lines

and standardize to HTML parse_mode for redesigned screens

However, the Panel Kit already enforces consistency per screen, which is safer.

5) Button emoji linting (prevents regressions)

Because kb() throws if emojis exist in button labels, any accidental emoji label will fail fast in development/test. This is intentional.

If you want a softer behavior in production, replace throw with console.warn and strip emojis—but I recommend failing fast.

6) Recommended “Panel Primitives” to use everywhere

panel(title, lines, buttons)

section("Wallets")

stat("Autohunt", "Armed")

walletRow(i, address, balance)

priceMc("Entry Price", price, mc)

amountDetail("Bought", "0.50 SOL", "123 TOKEN")

dexscreenerChartUrl(mint)

solscanTxUrl(sig)

These cover 90% of your bot UI.