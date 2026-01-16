// apps/bot/src/ui/panels/settings.ts
// SETTINGS panel - User configuration for autohunt
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
 * Data required to render the SETTINGS panel
 */
export interface SettingsData {
  tradeSize: number; // SOL
  maxPositions: number; // 1 or 2
  takeProfitPercent: number;
  stopLossPercent: number;
  slippageBps: number;
  prioritySol: number; // Priority fee in SOL (validator tip)
  antiMevEnabled: boolean; // MEV protection via Jito
}

/**
 * Render the SETTINGS panel
 *
 * Template:
 * 🦖 <b>RAPTOR | SETTINGS</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Trade Size:</b> {tradeSize} SOL
 * <b>Max Positions:</b> {maxPos}
 * <b>Take Profit:</b> {tp}%
 * <b>Stop Loss:</b> {sl}%
 * <b>Max Buys/Hour:</b> {rate}
 * <b>Slippage:</b> {slip} bps
 */
export function renderSettings(data: SettingsData): Panel {
  // Format priority fee for display
  const priorityDisplay = data.prioritySol >= 0.001
    ? `${data.prioritySol} SOL`
    : `${(data.prioritySol * 1000).toFixed(1)} mSOL`;

  const lines: string[] = [
    stat('Trade Size', `${data.tradeSize} SOL`),
    stat('Max Positions', `${data.maxPositions}`),
    stat('Take Profit', `${data.takeProfitPercent}%`),
    stat('Stop Loss', `${data.stopLossPercent}%`),
    stat('Slippage', `${data.slippageBps} bps`),
    stat('Priority Fee', priorityDisplay),
    stat('MEV Protection', data.antiMevEnabled ? 'ON (Jito)' : 'OFF'),
  ];

  const buttons: Button[][] = [
    [
      btn('Edit Trade Size', CB.SETTINGS.EDIT_TRADE_SIZE),
      btn('Edit Max Positions', CB.SETTINGS.EDIT_MAX_POSITIONS),
    ],
    [
      btn('Edit TP', CB.SETTINGS.EDIT_TP),
      btn('Edit SL', CB.SETTINGS.EDIT_SL),
    ],
    [
      btn('Edit Slippage', CB.SETTINGS.EDIT_SLIPPAGE),
      btn('Edit Priority', CB.SETTINGS.EDIT_PRIORITY),
    ],
    [
      btn(data.antiMevEnabled ? 'MEV: ON' : 'MEV: OFF', CB.SETTINGS.TOGGLE_MEV),
    ],
    [homeBtn()],
  ];

  return panel('SETTINGS', lines, buttons);
}

/**
 * Render edit prompt panel for a specific field
 */
export function renderSettingsEditPrompt(
  field: string,
  currentValue: string,
  format: string,
  example: string
): Panel {
  const lines: string[] = [
    stat('Current', currentValue),
    `Enter ${field} as ${format}.`,
    `Example: ${example}`,
  ];

  const buttons: Button[][] = [
    [
      btn('Cancel', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel(`EDIT ${field.toUpperCase()}`, lines, buttons);
}

/**
 * Render trade size edit prompt
 */
export function renderEditTradeSize(currentValue: number): Panel {
  return renderSettingsEditPrompt(
    'Trade Size',
    `${currentValue} SOL`,
    'SOL amount',
    '0.5'
  );
}

/**
 * Render max positions edit prompt
 */
export function renderEditMaxPositions(currentValue: number): Panel {
  return renderSettingsEditPrompt(
    'Max Positions',
    `${currentValue}`,
    '1 or 2',
    '2'
  );
}

/**
 * Render take profit edit prompt
 */
export function renderEditTakeProfit(currentValue: number): Panel {
  return renderSettingsEditPrompt(
    'Take Profit',
    `${currentValue}%`,
    'percentage',
    '50'
  );
}

/**
 * Render stop loss edit prompt
 */
export function renderEditStopLoss(currentValue: number): Panel {
  return renderSettingsEditPrompt(
    'Stop Loss',
    `${currentValue}%`,
    'percentage',
    '20'
  );
}

/**
 * Render slippage edit prompt
 */
export function renderEditSlippage(currentValue: number): Panel {
  return renderSettingsEditPrompt(
    'Slippage',
    `${currentValue} bps`,
    'basis points',
    '1000'
  );
}

/**
 * Render priority fee edit prompt
 */
export function renderEditPriority(currentValue: number): Panel {
  const currentDisplay = currentValue >= 0.001
    ? `${currentValue} SOL`
    : `${(currentValue * 1000).toFixed(1)} mSOL`;

  return renderSettingsEditPrompt(
    'Priority Fee',
    currentDisplay,
    'SOL (0.0001 - 0.01)',
    '0.0005'
  );
}

/**
 * Render settings update confirmation
 */
export function renderSettingsUpdated(field: string, newValue: string): Panel {
  const lines: string[] = [
    `${field} updated to ${newValue}`,
  ];

  const buttons: Button[][] = [
    [
      btn('Settings', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('SETTINGS UPDATED', lines, buttons);
}
