// apps/bot/src/ui/panels/home.ts
// HOME panel - Main dashboard with wallet, autohunt status, positions, PnL
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  section,
  stat,
  walletRow,
  join,
  formatSol,
  formatPercent,
  btn,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data required to render the HOME panel
 */
export interface HomeData {
  wallets: Array<{
    address: string;
    balanceSol: number;
  }>;
  armed: boolean;
  openPositions: number;
  maxPositions: number;
  trades: {
    total: number;
    wins: number;
    losses: number;
  };
  pnl: {
    sol: number;
    percent: number;
  };
}

/**
 * Render the HOME panel
 *
 * Template:
 * 🦖 <b>RAPTOR | HOME</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Wallets</b>
 * <code>{wallet1}</code>
 * └─ {bal1} SOL
 * <b>Autohunt:</b> Armed|Disarmed
 * <b>Open Positions:</b> {n} / 2
 * <b>Trades:</b> {t} (W {w} / L {l})
 * <b>PnL:</b> {pnlSol} SOL
 * └─ {pnlPct}%
 */
export function renderHome(data: HomeData): Panel {
  const lines: string[] = [];

  // Wallets section
  lines.push(section('Wallets'));
  data.wallets.forEach((w, i) => {
    const [addrLine, balLine] = walletRow(i + 1, w.address, formatSol(w.balanceSol));
    lines.push(addrLine, balLine);
  });

  // Status lines
  lines.push(stat('Autohunt', data.armed ? 'Armed' : 'Disarmed'));
  lines.push(stat('Open Positions', `${data.openPositions} / ${data.maxPositions}`));
  lines.push(
    stat(
      'Trades',
      `${data.trades.total} (W ${data.trades.wins} / L ${data.trades.losses})`
    )
  );

  // PnL with joiner
  lines.push(stat('PnL', `${formatSol(data.pnl.sol)} SOL`));
  lines.push(join(formatPercent(data.pnl.percent)));

  // Buttons
  const buttons: Button[][] = [
    [
      btn(data.armed ? 'Disarm' : 'Arm Autohunt', data.armed ? CB.HUNT.DISARM : CB.HUNT.ARM),
      btn(`Positions (${data.openPositions})`, CB.POSITIONS.OPEN),
    ],
    [
      btn('Withdraw', CB.WITHDRAW.OPEN),
      btn('Settings', CB.SETTINGS.OPEN),
    ],
    [
      btn('Help', CB.HELP.OPEN),
      btn('Refresh', CB.HOME.REFRESH),
    ],
  ];

  return panel('HOME', lines, buttons);
}

/**
 * Render a minimal HOME panel for loading/error states
 */
export function renderHomeLoading(): Panel {
  return panel('HOME', ['Loading...'], [[btn('Refresh', CB.HOME.REFRESH)]]);
}

/**
 * Render HOME panel with error message
 */
export function renderHomeError(errorMessage: string): Panel {
  return panel(
    'HOME',
    [`Error: ${errorMessage}`, 'Please try again.'],
    [[btn('Refresh', CB.HOME.REFRESH)]]
  );
}
