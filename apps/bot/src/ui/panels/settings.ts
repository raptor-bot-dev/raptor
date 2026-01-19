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
  snipeMode: 'speed' | 'quality';
  filterMode: 'strict' | 'moderate' | 'light';
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

  const snipeModeLabel = data.snipeMode === 'speed' ? 'Speed' : 'Quality';

  // Filter mode labels
  const filterModeLabels: Record<string, string> = {
    strict: 'Strict',
    moderate: 'Moderate',
    light: 'Light',
  };
  const filterModeLabel = filterModeLabels[data.filterMode] || 'Moderate';

  const lines: string[] = [
    stat('Trade Size', `${data.tradeSize} SOL`),
    stat('Max Positions', `${data.maxPositions}`),
    stat('Take Profit', `${data.takeProfitPercent}%`),
    stat('Stop Loss', `${data.stopLossPercent}%`),
    stat('Slippage', `${data.slippageBps / 100}%`),
    stat('Priority Fee', priorityDisplay),
    stat('Snipe Mode', snipeModeLabel),
    stat('Filter Mode', filterModeLabel),
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
      btn('Edit Snipe Mode', CB.SETTINGS.EDIT_SNIPE_MODE),
      btn('Edit Filter Mode', CB.SETTINGS.EDIT_FILTER_MODE),
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
 * Note: currentValue is in bps, display as %
 */
export function renderEditSlippage(currentValue: number): Panel {
  return renderSettingsEditPrompt(
    'Slippage',
    `${currentValue / 100}%`,
    'percentage (1-99)',
    '10'
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
 * Render snipe mode selection panel
 */
export function renderSnipeModeSelection(currentMode: 'speed' | 'quality'): Panel {
  const currentLabel = currentMode === 'speed' ? 'Speed' : 'Quality';
  const lines: string[] = [
    stat('Current', currentLabel),
    'Speed: Faster entry, stricter timeouts (more skips).',
    'Quality: Slower entry, best filtering (recommended).',
  ];

  // No emojis on buttons per CLAUDE.md - use [x] for selected
  const speedLabel = currentMode === 'speed' ? '[x] Speed' : 'Speed';
  const qualityLabel = currentMode === 'speed' ? 'Quality' : '[x] Quality';

  const buttons: Button[][] = [
    [
      btn(speedLabel, CB.SETTINGS.SET_SNIPE_MODE_SPEED),
      btn(qualityLabel, CB.SETTINGS.SET_SNIPE_MODE_QUALITY),
    ],
    [
      btn('Back', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('SNIPE MODE', lines, buttons);
}

/**
 * Render filter mode selection panel
 */
export function renderFilterModeSelection(currentMode: 'strict' | 'moderate' | 'light'): Panel {
  const modeLabels: Record<string, string> = {
    strict: 'Strict',
    moderate: 'Moderate',
    light: 'Light',
  };

  const lines: string[] = [
    stat('Current', modeLabels[currentMode] || 'Moderate'),
    'Strict: Require socials + activity check (full metadata, 3s delay).',
    'Moderate: Activity check only (3s delay, default).',
    'Light: Require socials only, no delay (fastest).',
  ];

  // No emojis on buttons per CLAUDE.md - use [x] for selected
  const strictLabel = currentMode === 'strict' ? '[x] Strict' : 'Strict';
  const moderateLabel = currentMode === 'moderate' ? '[x] Moderate' : 'Moderate';
  const lightLabel = currentMode === 'light' ? '[x] Light' : 'Light';

  const buttons: Button[][] = [
    [
      btn(strictLabel, CB.SETTINGS.SET_FILTER_MODE_STRICT),
      btn(moderateLabel, CB.SETTINGS.SET_FILTER_MODE_MODERATE),
      btn(lightLabel, CB.SETTINGS.SET_FILTER_MODE_LIGHT),
    ],
    [
      btn('Back', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('FILTER MODE', lines, buttons);
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
