// apps/bot/src/ui/panels/hunt.ts
// ARM/DISARM confirmation panels for autohunt
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  btn,
  homeBtn,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data required to render the ARM confirmation panel
 */
export interface ArmConfirmData {
  tradeSize: number;
  maxPositions: number;
  takeProfitPercent: number;
  stopLossPercent: number;
}

/**
 * Render the ARM AUTOHUNT confirmation panel
 *
 * Template:
 * 🦖 <b>RAPTOR | ARM AUTOHUNT</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Trade Size:</b> {tradeSize} SOL
 * <b>Max Positions:</b> {maxPos}
 * <b>TP:</b> {tp}%
 * <b>SL:</b> {sl}%
 * <b>Max Buys/Hour:</b> {rate}
 * <b>Warning:</b> Trades execute automatically.
 */
export function renderArmConfirm(data: ArmConfirmData): Panel {
  const lines: string[] = [
    stat('Trade Size', `${data.tradeSize} SOL`),
    stat('Max Positions', `${data.maxPositions}`),
    stat('TP', `${data.takeProfitPercent}%`),
    stat('SL', `${data.stopLossPercent}%`),
    stat('Warning', 'Trades execute automatically.'),
  ];

  const buttons: Button[][] = [
    [
      btn('Confirm', CB.HUNT.CONFIRM_ARM),
      btn('Cancel', CB.HUNT.CANCEL),
    ],
    [
      btn('Settings', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('ARM AUTOHUNT', lines, buttons);
}

/**
 * Render the DISARM AUTOHUNT confirmation panel
 *
 * Template:
 * 🦖 <b>RAPTOR | DISARM AUTOHUNT</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * Autohunt will stop taking new entries.
 * Open positions can still close automatically unless you emergency sell.
 */
export function renderDisarmConfirm(openPositions: number): Panel {
  const lines: string[] = [
    'Autohunt will stop taking new entries.',
    'Open positions can still close automatically unless you emergency sell.',
  ];

  if (openPositions > 0) {
    lines.push(`You have ${openPositions} open position(s).`);
  }

  const buttons: Button[][] = [
    [
      btn('Confirm', CB.HUNT.CONFIRM_DISARM),
      btn('Cancel', CB.HUNT.CANCEL),
    ],
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('DISARM AUTOHUNT', lines, buttons);
}

/**
 * Render the armed confirmation panel (after arming)
 */
export function renderArmed(): Panel {
  const lines: string[] = [
    'Autohunt is now ARMED.',
    'The hunter will automatically open positions when opportunities are detected.',
  ];

  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('AUTOHUNT ARMED', lines, buttons);
}

/**
 * Render the disarmed confirmation panel (after disarming)
 */
export function renderDisarmed(): Panel {
  const lines: string[] = [
    'Autohunt is now DISARMED.',
    'No new positions will be opened.',
  ];

  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('AUTOHUNT DISARMED', lines, buttons);
}

/**
 * Render error when trying to arm with invalid settings
 */
export function renderArmError(reason: string): Panel {
  const lines: string[] = [
    'Cannot arm autohunt.',
    stat('Reason', reason),
  ];

  const buttons: Button[][] = [
    [
      btn('Settings', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('ARM ERROR', lines, buttons);
}
