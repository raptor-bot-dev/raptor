// apps/bot/src/ui/notifications/huntClosed.ts
// HUNT CLOSED notification - Sent when a position is closed (TP/SL/Emergency)
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  b,
  urlBtn,
  btn,
  homeBtn,
  dexscreenerChartUrl,
  solscanTxUrl,
  formatSol,
  formatPercent,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Exit trigger types
 */
export type ExitTrigger = 'TP' | 'SL' | 'TRAIL' | 'MAXHOLD' | 'EMERGENCY' | 'MANUAL';

/**
 * Data for hunt closed notification
 */
export interface HuntClosedData {
  symbol: string;
  mint: string;
  entryPrice: string; // Formatted
  entryMc: string; // Formatted
  exitPrice: string; // Formatted
  exitMc: string; // Formatted
  receivedSol: number;
  pnlPercent: number;
  pnlSol: number;
  txSig: string;
  trigger: ExitTrigger;
}

/**
 * Render the HUNT CLOSED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | HUNT CLOSED</b> 🎯
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {SYMBOL}
 * <code>{MINT}</code>
 * <b>Entry Price:</b> {entryPrice}
 * └─ <b>Entry MC:</b> {entryMc}
 * <b>Exit Price:</b> {exitPrice}
 * └─ <b>Exit MC:</b> {exitMc}
 * <b>Received:</b> {solOut} SOL
 * <b>PnL:</b> {pnlPct}%
 * └─ {pnlSol} SOL
 * <b>TX:</b> View on Solscan
 */
export function renderHuntClosed(data: HuntClosedData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', data.symbol));
  lines.push(code(data.mint));

  // Entry price with MC joiner
  lines.push(stat('Entry Price', data.entryPrice));
  lines.push(join(`${b('Entry MC:')} ${data.entryMc}`));

  // Exit price with MC joiner
  lines.push(stat('Exit Price', data.exitPrice));
  lines.push(join(`${b('Exit MC:')} ${data.exitMc}`));

  // Received SOL
  lines.push(stat('Received', `${formatSol(data.receivedSol)} SOL`));

  // PnL with SOL joiner
  const pnlEmoji = data.pnlSol >= 0 ? '🟢' : '🔴';
  lines.push(stat('PnL', `${formatPercent(data.pnlPercent)} ${pnlEmoji}`));
  lines.push(join(`${formatSol(data.pnlSol)} SOL`));

  // Trigger info
  lines.push(stat('Trigger', formatTrigger(data.trigger)));

  // Buttons
  const buttons: Button[][] = [
    [
      urlBtn('View TX', solscanTxUrl(data.txSig)),
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  // Title with emoji
  return panel('HUNT CLOSED 🎯', lines, buttons);
}

/**
 * Format trigger for display
 */
function formatTrigger(trigger: ExitTrigger): string {
  switch (trigger) {
    case 'TP':
      return 'Take Profit';
    case 'SL':
      return 'Stop Loss';
    case 'TRAIL':
      return 'Trailing Stop';
    case 'MAXHOLD':
      return 'Max Hold Time';
    case 'EMERGENCY':
      return 'Emergency Sell';
    case 'MANUAL':
      return 'Manual';
    default:
      return trigger;
  }
}

/**
 * Render a simplified closed notification for wins
 */
export function renderHuntClosedWin(data: HuntClosedData): Panel {
  return renderHuntClosed(data);
}

/**
 * Render a simplified closed notification for losses
 */
export function renderHuntClosedLoss(data: HuntClosedData): Panel {
  return renderHuntClosed(data);
}
