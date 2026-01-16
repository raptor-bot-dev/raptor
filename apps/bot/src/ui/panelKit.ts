// apps/bot/src/ui/panelKit.ts
// RAPTOR Panel Kit (HTML) - Terminal-style UI renderer
// Reference: MUST_READ/DESIGN.md

import type { InlineKeyboardMarkup } from 'grammy/types';

/**
 * Panel return type for ctx.reply() or ctx.editMessageText()
 */
export type Panel = {
  text: string;
  opts: {
    parse_mode: 'HTML';
    reply_markup?: InlineKeyboardMarkup;
    disable_web_page_preview?: boolean;
  };
};

export type Button = {
  text: string;
  callback_data?: string;
  url?: string;
};

// --- Constants ---

const DINO = '🦖';
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━';

/**
 * WIDTH_PAD: U+2800 Braille Pattern Blank repeated ~80 chars
 * Visually empty but contributes width to expand Telegram bubbles
 */
export const WIDTH_PAD =
  '⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀';

// --- Safety / formatting helpers ---

/**
 * Escape HTML special characters for safe rendering
 */
export function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Wrap text in bold tags (with escaping)
 */
export function b(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

/**
 * Wrap text in code tags (monospace, with escaping)
 */
export function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

/**
 * Create a joiner line (parent -> detail)
 * Keep indentation consistent: 3 spaces + joiner
 * Example: "   └─ 0.10 SOL"
 */
export function join(detail: string): string {
  return `   └─ ${detail}`;
}

/**
 * Compact lines - removes blank lines and trailing whitespace
 * Enforces "no blank lines" policy for tight panels
 */
export function compactLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = (raw ?? '').replace(/[ \t]+$/g, '');
    // Skip truly empty lines to honor "no blank lines" policy
    if (line.trim() === '') continue;
    out.push(line);
  }
  return out;
}

// --- Emoji validation for buttons ---

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/**
 * Assert that a button label contains no emoji
 * Throws in development to catch violations early
 */
export function assertNoEmoji(label: string): void {
  if (EMOJI_REGEX.test(label)) {
    throw new Error(
      `Button label contains emoji (disallowed): "${label}". Use plain text labels only.`
    );
  }
}

/**
 * Build inline keyboard markup from button rows
 * Validates all labels have no emojis
 */
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
        btn.url
          ? { text: btn.text, url: btn.url }
          : { text: btn.text, callback_data: btn.callback_data! }
      )
    ),
  };
}

// --- Core panel renderer ---

/**
 * Render a complete panel with header, divider, width pad, and content
 *
 * @param title - Panel title (appears after "RAPTOR | ")
 * @param lines - Content lines (will be compacted)
 * @param buttons - Optional keyboard button rows
 * @param opts - Additional options
 */
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
    text: textLines.join('\n'),
    opts: {
      parse_mode: 'HTML',
      reply_markup: buttons ? kb(buttons) : undefined,
      disable_web_page_preview: opts?.disable_web_page_preview ?? true,
    },
  };
}

// --- Reusable row builders (UI primitives) ---

/**
 * Section header - bold label with no extra spacing
 */
export function section(label: string): string {
  return b(label);
}

/**
 * Standard stat line: "<b>Label:</b> value"
 */
export function stat(label: string, value: string): string {
  return `${b(`${label}:`)} ${escapeHtml(value)}`;
}

/**
 * Wallet row with address and balance joiner:
 * 1) <code>ADDRESS</code>
 *    └─ 0.10 SOL
 */
export function walletRow(
  index: number,
  address: string,
  balanceSolText: string
): string[] {
  return [
    `${index}) ${code(address)}`,
    join(`${escapeHtml(balanceSolText)} SOL`),
  ];
}

/**
 * Token header with symbol and mint:
 * <b>SYMBOL</b>
 *    └─ <code>MINT</code>
 */
export function tokenHeader(symbol: string, mint: string): string[] {
  return [b(symbol), join(code(mint))];
}

/**
 * Price with market cap joiner:
 * <b>Entry Price:</b> $0.0000123
 *    └─ <b>Market Cap:</b> $12.3K
 */
export function priceMc(label: string, price: string, mc: string): string[] {
  return [stat(label, price), join(`${b('Market Cap:')} ${escapeHtml(mc)}`)];
}

/**
 * Amount with detail joiner:
 * <b>Bought:</b> 0.50 SOL
 *    └─ 123,456 TOKEN
 */
export function amountDetail(
  label: string,
  amount: string,
  detail: string
): string[] {
  return [stat(label, amount), join(escapeHtml(detail))];
}

// --- Link helpers ---

/**
 * Generate Solscan transaction URL
 */
export function solscanTxUrl(sig: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(sig)}`;
}

/**
 * Generate Dexscreener chart URL
 */
export function dexscreenerChartUrl(mint: string): string {
  return `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;
}

/**
 * Generate Birdeye chart URL (alternative)
 */
export function birdeyeChartUrl(mint: string): string {
  return `https://birdeye.so/token/${encodeURIComponent(mint)}?chain=solana`;
}

// --- Numeric formatting helpers ---

/**
 * Format SOL balance with readable precision:
 * >= 1 => 2 decimal places
 * >= 0.01 => 4 decimal places
 * else => 6 decimal places
 */
export function formatSol(sol: number): string {
  if (!Number.isFinite(sol)) return '0';
  const abs = Math.abs(sol);
  const dp = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return sol.toFixed(dp);
}

/**
 * Format percentage with optional sign
 */
export function formatPercent(pct: number, showSign = true): string {
  if (!Number.isFinite(pct)) return '0%';
  const sign = showSign && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * Format large numbers with K/M/B suffixes
 */
export function formatCompact(num: number): string {
  if (!Number.isFinite(num)) return '0';
  const abs = Math.abs(num);
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

/**
 * Format market cap for display
 */
export function formatMarketCap(mcSol: number, solPriceUsd?: number): string {
  if (solPriceUsd && solPriceUsd > 0) {
    const mcUsd = mcSol * solPriceUsd;
    return `$${formatCompact(mcUsd)}`;
  }
  return `${formatCompact(mcSol)} SOL`;
}

/**
 * Format token amount with appropriate precision
 */
export function formatTokens(amount: number, decimals = 2): string {
  if (!Number.isFinite(amount)) return '0';
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(decimals)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(decimals)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(decimals)}K`;
  return amount.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
  });
}

// --- Button helpers ---

/**
 * Create a callback button
 */
export function btn(text: string, callback_data: string): Button {
  return { text, callback_data };
}

/**
 * Create a URL button
 */
export function urlBtn(text: string, url: string): Button {
  return { text, url };
}

// --- Common button rows ---

/**
 * Standard "Home" button
 */
export function homeBtn(): Button {
  return btn('Home', 'home:open');
}

/**
 * Standard "Back" button with custom callback
 */
export function backBtn(callback_data: string): Button {
  return btn('Back', callback_data);
}

/**
 * Standard "Refresh" button with custom callback
 */
export function refreshBtn(callback_data: string): Button {
  return btn('Refresh', callback_data);
}

/**
 * Standard "Cancel" button with custom callback
 */
export function cancelBtn(callback_data: string): Button {
  return btn('Cancel', callback_data);
}

/**
 * Standard "Confirm" button with custom callback
 */
export function confirmBtn(callback_data: string): Button {
  return btn('Confirm', callback_data);
}
