// apps/bot/src/ui/panels/positionDetail.ts
// POSITION detail panel - Single position view
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  b,
  formatSol,
  formatMarketCap,
  formatCompact,
  formatPercent,
  btn,
  urlBtn,
  homeBtn,
  dexscreenerChartUrl,
  solscanTxUrl,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Position status
 */
export type PositionStatus = 'ACTIVE' | 'CLOSING' | 'CLOSING_EMERGENCY' | 'CLOSED';

/**
 * Full position data for detail view
 * Shows both current MC and entry MC in USD per audit requirement
 */
export interface PositionDetailData {
  id: string;
  tokenName: string;
  symbol: string;
  mint: string;
  entryPrice: number; // SOL per token
  entryMcSol: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  entrySol: number;
  tokenAmount: number;
  status: PositionStatus;
  entryTxSig?: string;
  solPriceUsd?: number;
  // New fields for accurate display (Audit Round 4)
  entryMcUsd?: number;   // Entry MC in USD (from stored value or calculated)
  currentMcUsd?: number; // Current MC in USD
  pnlPercent?: number;   // Quote-based PnL percentage
  pnlSol?: number;       // Quote-based PnL in SOL
}

/**
 * Render the POSITION detail panel
 *
 * Template:
 * 🦖 <b>RAPTOR | POSITION</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {NAME} ({SYMBOL})
 * <code>{MINT}</code>
 * <b>Entry Price:</b> {entryPrice}
 * └─ <b>Entry MC:</b> {entryMc}
 * <b>Exit Rules:</b> TP {tp}% | SL {sl}%
 * <b>Size:</b> {entrySol} SOL
 * └─ {tokens} {SYMBOL}
 * <b>Status:</b> {OPEN|CLOSING}
 */
export function renderPositionDetail(data: PositionDetailData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', `${data.tokenName} (${data.symbol})`));
  lines.push(code(data.mint));

  // Entry price
  const priceFormatted = data.entryPrice < 0.000001
    ? data.entryPrice.toExponential(4)
    : formatSol(data.entryPrice);
  lines.push(stat('Entry Price', `${priceFormatted} SOL`));

  // Market Cap section: Current MC and Entry MC in USD
  if (data.currentMcUsd !== undefined && data.currentMcUsd > 0) {
    lines.push(stat('Current MC', `$${formatCompact(data.currentMcUsd)}`));
    // Entry MC as joiner if available
    if (data.entryMcUsd !== undefined && data.entryMcUsd > 0) {
      lines.push(join(`${b('Entry MC:')} $${formatCompact(data.entryMcUsd)}`));
    } else {
      lines.push(join(`${b('Entry MC:')} ${formatMarketCap(data.entryMcSol, data.solPriceUsd)}`));
    }
  } else {
    // Fallback to original display if no current MC
    lines.push(join(`${b('Entry MC:')} ${formatMarketCap(data.entryMcSol, data.solPriceUsd)}`));
  }

  // PnL section (if available)
  if (data.pnlPercent !== undefined) {
    const pnlLine = data.pnlSol !== undefined
      ? `${formatPercent(data.pnlPercent)} (${formatSol(data.pnlSol)} SOL)`
      : formatPercent(data.pnlPercent);
    lines.push(stat('PnL', pnlLine));
  }

  // Exit rules
  lines.push(stat('Exit Rules', `TP ${data.takeProfitPercent}% | SL ${data.stopLossPercent}%`));

  // Size with token amount joiner
  lines.push(stat('Size', `${formatSol(data.entrySol)} SOL`));
  lines.push(join(`${formatTokenAmount(data.tokenAmount)} ${data.symbol}`));

  // Status
  lines.push(stat('Status', formatStatus(data.status)));

  // Buttons
  const buttons: Button[][] = [];

  // Row 1: Emergency Sell + Chart (only if ACTIVE)
  if (data.status === 'ACTIVE') {
    buttons.push([
      btn('Emergency Sell', CB.POSITION.emergencySell(data.id)),
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
    ]);
  } else {
    buttons.push([
      urlBtn('Chart', dexscreenerChartUrl(data.mint)),
    ]);
  }

  // Row 2: View Entry TX + Back
  const row2: Button[] = [];
  if (data.entryTxSig) {
    row2.push(urlBtn('View Entry TX', solscanTxUrl(data.entryTxSig)));
  }
  row2.push(btn('Back', CB.POSITIONS.OPEN));
  buttons.push(row2);

  // Row 3: Home
  buttons.push([homeBtn()]);

  return panel('POSITION', lines, buttons);
}

/**
 * Format status for display
 */
function formatStatus(status: PositionStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'CLOSING':
      return 'CLOSING...';
    case 'CLOSING_EMERGENCY':
      return 'EMERGENCY CLOSING...';
    case 'CLOSED':
      return 'CLOSED';
    default:
      return status;
  }
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
 * Render position not found error
 */
export function renderPositionNotFound(): Panel {
  const lines: string[] = [
    'Position not found.',
    'It may have been closed or does not exist.',
  ];

  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('POSITION', lines, buttons);
}
