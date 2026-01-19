// apps/bot/src/ui/notifications/positionState.ts
// Position state notifications - Position opened/closed
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  urlBtn,
  btn,
  homeBtn,
  dexscreenerChartUrl,
  formatSol,
  formatPercent,
  formatTokens,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';
import { type ExitTrigger } from './huntClosed.js';

/**
 * Data for position opened notification
 */
export interface PositionOpenedData {
  tokenSymbol: string;
  mint: string;
  amountSol: number;
  tokens: number;
  source: 'auto' | 'manual';
}

/**
 * Render the POSITION OPENED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | POSITION OPENED</b> 📥
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {symbol}
 *    └─ <code>{mint}</code>
 * <b>Entry:</b> {sol} SOL
 *    └─ {tokens} tokens
 * <b>Source:</b> {source}
 */
export function renderPositionOpened(data: PositionOpenedData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', data.tokenSymbol));
  lines.push(join(code(data.mint)));

  // Entry amount
  lines.push(stat('Entry', `${formatSol(data.amountSol)} SOL`));
  lines.push(join(`${formatTokens(data.tokens)} tokens`));

  // Source
  const sourceLabel = data.source === 'auto' ? 'Auto Hunt' : 'Manual';
  lines.push(stat('Source', sourceLabel));

  // Buttons
  const buttons: Button[][] = [
    [
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
      btn('Positions', CB.POSITIONS.OPEN),
    ],
    [homeBtn()],
  ];

  return panel('POSITION OPENED 📥', lines, buttons);
}

/**
 * Data for position closed notification
 */
export interface PositionClosedData {
  tokenSymbol: string;
  mint: string;
  pnlSol: number;
  pnlPercent: number;
  trigger: ExitTrigger;
  txHash?: string;
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
 * Render the POSITION CLOSED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | POSITION CLOSED</b> 📤
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {symbol}
 *    └─ <code>{mint}</code>
 * <b>Trigger:</b> {trigger}
 * <b>PnL:</b> {pnl}%
 *    └─ {pnlSol} SOL
 */
export function renderPositionClosed(data: PositionClosedData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', data.tokenSymbol));
  lines.push(join(code(data.mint)));

  // Trigger
  lines.push(stat('Trigger', formatTrigger(data.trigger)));

  // PnL
  const pnlEmoji = data.pnlSol >= 0 ? '🟢' : '🔴';
  lines.push(stat('PnL', `${formatPercent(data.pnlPercent)} ${pnlEmoji}`));
  lines.push(join(`${formatSol(data.pnlSol)} SOL`));

  // Buttons
  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('POSITION CLOSED 📤', lines, buttons);
}
