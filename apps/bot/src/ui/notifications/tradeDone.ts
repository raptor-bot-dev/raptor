// apps/bot/src/ui/notifications/tradeDone.ts
// TRADE DONE notification - Sent when autohunt BUY completes (per CLAUDE.md: BUY-only)
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  urlBtn,
  btn,
  homeBtn,
  solscanTxUrl,
  dexscreenerChartUrl,
  formatSol,
  formatTokens,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data for trade done notification
 */
export interface TradeDoneData {
  mint: string;
  amountSol: number;
  tokens: number;
  txSig: string;
  tokenSymbol?: string;
  marketCapSol?: number;  // Market cap in SOL at entry time
}

/**
 * Render the TRADE DONE notification (BUY-only)
 *
 * Template:
 * 🦖 <b>RAPTOR | HUNT BUY</b> ✅
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {symbol}
 *    └─ <code>{mint}</code>
 * <b>Spent:</b> {sol} SOL
 *    └─ {tokens} tokens
 */
export function renderTradeDone(data: TradeDoneData): Panel {
  const lines: string[] = [];

  // Token info
  const symbol = data.tokenSymbol || 'Unknown';
  lines.push(stat('Token', symbol));
  lines.push(`   └─ ${code(data.mint)}`);

  // Amount spent
  lines.push(stat('Spent', `${formatSol(data.amountSol)} SOL`));
  lines.push(`   └─ ${formatTokens(data.tokens)} tokens`);

  // Market cap at entry (if available)
  if (data.marketCapSol !== undefined && data.marketCapSol > 0) {
    lines.push(stat('Entry MC', `${formatSol(data.marketCapSol)} SOL`));
  }

  // Buttons
  const buttons: Button[][] = [
    [
      urlBtn('View TX', solscanTxUrl(data.txSig)),
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
    ],
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('HUNT BUY ✅', lines, buttons);
}
