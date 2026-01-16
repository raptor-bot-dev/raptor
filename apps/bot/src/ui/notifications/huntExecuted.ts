// apps/bot/src/ui/notifications/huntExecuted.ts
// HUNT EXECUTED notification - Sent when autohunt buys a token
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  priceMc,
  amountDetail,
  urlBtn,
  btn,
  dexscreenerChartUrl,
  solscanTxUrl,
  formatSol,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data for hunt executed notification
 */
export interface HuntExecutedData {
  positionId: string;
  tokenName: string;
  symbol: string;
  mint: string;
  entryPrice: string; // Formatted price
  marketCap: string; // Formatted market cap
  solIn: number;
  tokensOut: number;
  txSig: string;
}

/**
 * Render the HUNT EXECUTED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | HUNT EXECUTED</b> ✅
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {NAME} ({SYMBOL})
 * <code>{MINT}</code>
 * <b>Entry Price:</b> {price}
 * └─ <b>Market Cap:</b> {mc}
 * <b>Bought:</b> {solIn} SOL
 * └─ {tokensOut} {SYMBOL}
 * <b>TX:</b> View on Solscan
 */
export function renderHuntExecuted(data: HuntExecutedData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', `${data.tokenName} (${data.symbol})`));
  lines.push(code(data.mint));

  // Entry price with market cap joiner
  const [priceLine, mcLine] = priceMc('Entry Price', data.entryPrice, data.marketCap);
  lines.push(priceLine, mcLine);

  // Amount bought with tokens joiner
  const [amtLine, tokenLine] = amountDetail(
    'Bought',
    `${formatSol(data.solIn)} SOL`,
    `${formatTokens(data.tokensOut)} ${data.symbol}`
  );
  lines.push(amtLine, tokenLine);

  // TX reference
  lines.push(stat('TX', 'View on Solscan'));

  // Buttons
  const buttons: Button[][] = [
    [
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
      btn('Emergency Sell', CB.POSITION.emergencySell(data.positionId)),
      urlBtn('View TX', solscanTxUrl(data.txSig)),
    ],
  ];

  // Title includes emoji (allowed in panel text)
  return panel('HUNT EXECUTED ✅', lines, buttons);
}

/**
 * Format token amount with K/M/B suffixes
 */
function formatTokens(amount: number): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
