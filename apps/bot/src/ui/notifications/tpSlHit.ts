// apps/bot/src/ui/notifications/tpSlHit.ts
// TP/SL HIT notifications - Sent when take profit or stop loss triggers
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  urlBtn,
  btn,
  homeBtn,
  solscanTxUrl,
  dexscreenerChartUrl,
  formatSol,
  formatPercent,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data for TP hit notification
 */
export interface TpHitData {
  tokenSymbol: string;
  mint: string;
  pnlPercent: number;
  solReceived: number;
  txHash: string;
}

/**
 * Render the TP HIT notification
 *
 * Template:
 * 🦖 <b>RAPTOR | TAKE PROFIT HIT</b> 🎯
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {symbol}
 *    └─ <code>{mint}</code>
 * <b>Profit:</b> +{pnl}%
 * <b>SOL Received:</b> {sol}
 */
export function renderTpHit(data: TpHitData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', data.tokenSymbol));
  lines.push(join(code(data.mint)));

  // Profit
  lines.push(stat('Profit', `${formatPercent(data.pnlPercent)} 🟢`));

  // SOL received
  lines.push(stat('SOL Received', `${formatSol(data.solReceived)} SOL`));

  // Buttons
  const buttons: Button[][] = [];
  if (data.txHash) {
    buttons.push([
      urlBtn('View TX', solscanTxUrl(data.txHash)),
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
    ]);
  }
  buttons.push([
    btn('Positions', CB.POSITIONS.OPEN),
    homeBtn(),
  ]);

  return panel('TAKE PROFIT HIT 🎯', lines, buttons);
}

/**
 * Data for SL hit notification
 */
export interface SlHitData {
  tokenSymbol: string;
  mint: string;
  pnlPercent: number;
  solReceived: number;
  txHash: string;
}

/**
 * Render the SL HIT notification
 *
 * Template:
 * 🦖 <b>RAPTOR | STOP LOSS HIT</b> 🛑
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {symbol}
 *    └─ <code>{mint}</code>
 * <b>Loss:</b> -{pnl}%
 * <b>SOL Received:</b> {sol}
 */
export function renderSlHit(data: SlHitData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', data.tokenSymbol));
  lines.push(join(code(data.mint)));

  // Loss
  lines.push(stat('Loss', `${formatPercent(data.pnlPercent)} 🔴`));

  // SOL received
  lines.push(stat('SOL Received', `${formatSol(data.solReceived)} SOL`));

  // Buttons
  const buttons: Button[][] = [];
  if (data.txHash) {
    buttons.push([
      urlBtn('View TX', solscanTxUrl(data.txHash)),
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
    ]);
  }
  buttons.push([
    btn('Positions', CB.POSITIONS.OPEN),
    homeBtn(),
  ]);

  return panel('STOP LOSS HIT 🛑', lines, buttons);
}

/**
 * Data for trailing stop hit notification
 */
export interface TrailingStopHitData {
  tokenSymbol: string;
  mint: string;
  pnlPercent: number;
  peakPercent: number;
  solReceived: number;
  txHash: string;
}

/**
 * Render the TRAILING STOP HIT notification
 *
 * Template:
 * 🦖 <b>RAPTOR | TRAILING STOP HIT</b> 📉
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {symbol}
 *    └─ <code>{mint}</code>
 * <b>Peak Profit:</b> +{peak}%
 * <b>Locked Profit:</b> +{pnl}%
 * <b>SOL Received:</b> {sol}
 */
export function renderTrailingStopHit(data: TrailingStopHitData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', data.tokenSymbol));
  lines.push(join(code(data.mint)));

  // Peak and locked profit
  lines.push(stat('Peak Profit', `${formatPercent(data.peakPercent)}`));
  lines.push(stat('Locked Profit', `${formatPercent(data.pnlPercent)} 🟢`));

  // SOL received
  lines.push(stat('SOL Received', `${formatSol(data.solReceived)} SOL`));

  // Buttons
  const buttons: Button[][] = [];
  if (data.txHash) {
    buttons.push([
      urlBtn('View TX', solscanTxUrl(data.txHash)),
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
    ]);
  }
  buttons.push([
    btn('Positions', CB.POSITIONS.OPEN),
    homeBtn(),
  ]);

  return panel('TRAILING STOP HIT 📉', lines, buttons);
}
