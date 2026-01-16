// apps/bot/src/ui/panels/positions.ts
// POSITIONS list panel - Shows open positions (0-2)
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  section,
  stat,
  code,
  join,
  b,
  formatSol,
  formatPercent,
  formatMarketCap,
  btn,
  urlBtn,
  homeBtn,
  dexscreenerChartUrl,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Position data for list view
 */
export interface PositionListItem {
  id: string;
  symbol: string;
  mint: string;
  entrySol: number;
  entryMcSol?: number;
  pnlPercent?: number; // Only if available
}

/**
 * Render the POSITIONS list panel (0-2 positions)
 *
 * Template:
 * 🦖 <b>RAPTOR | POSITIONS</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Open:</b> {n} / 2
 *
 * <b>{SYMBOL}</b>
 * └─ <code>{MINT}</code>
 * └─ Entry: {entrySol} SOL └─ MC: {entryMc} └─ PnL: {pnlPct}%
 */
export function renderPositionsList(
  positions: PositionListItem[],
  maxPositions: number = 2,
  solPriceUsd?: number
): Panel {
  const lines: string[] = [];

  lines.push(stat('Open', `${positions.length} / ${maxPositions}`));

  if (positions.length === 0) {
    lines.push('No open positions.');
  } else {
    for (const pos of positions) {
      // Symbol header
      lines.push(b(pos.symbol));
      // Mint
      lines.push(join(code(pos.mint)));

      // Entry details line
      let detailLine = `Entry: ${formatSol(pos.entrySol)} SOL`;
      if (pos.entryMcSol !== undefined) {
        detailLine += ` | MC: ${formatMarketCap(pos.entryMcSol, solPriceUsd)}`;
      }
      if (pos.pnlPercent !== undefined) {
        detailLine += ` | PnL: ${formatPercent(pos.pnlPercent)}`;
      }
      lines.push(join(detailLine));
    }
  }

  // Build buttons
  const buttons: Button[][] = [];

  // Per-position action rows
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const idx = i + 1;
    buttons.push([
      btn(`${idx} Details`, CB.POSITION.details(pos.id)),
      btn(`${idx} Emergency Sell`, CB.POSITION.emergencySell(pos.id)),
      urlBtn(`${idx} Chart`, dexscreenerChartUrl(pos.mint)),
    ]);
  }

  // Bottom row
  buttons.push([
    btn('Refresh', CB.POSITIONS.REFRESH),
    homeBtn(),
  ]);

  return panel('POSITIONS', lines, buttons);
}

/**
 * Render empty positions panel
 */
export function renderNoPositions(): Panel {
  const lines: string[] = [
    stat('Open', '0 / 2'),
    'No open positions.',
  ];

  const buttons: Button[][] = [
    [
      btn('Refresh', CB.POSITIONS.REFRESH),
      homeBtn(),
    ],
  ];

  return panel('POSITIONS', lines, buttons);
}
