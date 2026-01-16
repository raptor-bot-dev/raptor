// apps/bot/src/ui/panels/emergencySell.ts
// EMERGENCY SELL confirmation panel
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  btn,
  urlBtn,
  homeBtn,
  dexscreenerChartUrl,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data for emergency sell confirmation
 */
export interface EmergencySellData {
  positionId: string;
  symbol: string;
  mint: string;
  tokenBalance: number;
}

/**
 * Render the EMERGENCY SELL confirmation panel
 *
 * Template:
 * 🦖 <b>RAPTOR | EMERGENCY SELL</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {SYMBOL}
 * <code>{MINT}</code>
 * <b>Sell:</b> 100%
 * └─ {tokenBal} {SYMBOL}
 * <b>Note:</b> This closes immediately and may execute at a worse price.
 */
export function renderEmergencySellConfirm(data: EmergencySellData): Panel {
  const lines: string[] = [
    stat('Token', data.symbol),
    code(data.mint),
    stat('Sell', '100%'),
    join(`${formatTokenAmount(data.tokenBalance)} ${data.symbol}`),
    stat('Note', 'This closes immediately and may execute at a worse price than waiting for TP.'),
  ];

  const buttons: Button[][] = [
    [
      btn('Confirm Sell', CB.POSITION.confirmEmergencySell(data.positionId)),
      btn('Cancel', CB.POSITION.cancelEmergencySell(data.positionId)),
    ],
    [
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
      btn('Back', CB.POSITION.details(data.positionId)),
    ],
    [homeBtn()],
  ];

  return panel('EMERGENCY SELL', lines, buttons);
}

/**
 * Format token amount with K/M/B suffixes
 */
function formatTokenAmount(amount: number): string {
  if (amount >= 1e9) return `${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(2)}K`;
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Render emergency sell submitted confirmation
 */
export function renderEmergencySellSubmitted(symbol: string, mint: string): Panel {
  const lines: string[] = [
    stat('Status', 'Submitted'),
    stat('Token', symbol),
    code(mint),
    'Emergency sell order has been submitted.',
    'You will be notified when it completes.',
  ];

  const buttons: Button[][] = [
    [
      urlBtn('Chart', dexscreenerChartUrl(mint)),
      btn('Positions', CB.POSITIONS.OPEN),
    ],
    [homeBtn()],
  ];

  return panel('EMERGENCY SELL', lines, buttons);
}

/**
 * Render emergency sell already in progress
 */
export function renderEmergencySellInProgress(symbol: string): Panel {
  const lines: string[] = [
    stat('Status', 'In Progress'),
    stat('Token', symbol),
    'An emergency sell is already in progress for this position.',
    'Please wait for it to complete.',
  ];

  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('EMERGENCY SELL', lines, buttons);
}

/**
 * Render emergency sell error
 */
export function renderEmergencySellError(reason: string): Panel {
  const lines: string[] = [
    stat('Status', 'Failed'),
    stat('Reason', reason),
    'Please try again or contact support.',
  ];

  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('EMERGENCY SELL ERROR', lines, buttons);
}
