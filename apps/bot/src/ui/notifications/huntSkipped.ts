// apps/bot/src/ui/notifications/huntSkipped.ts
// HUNT SKIPPED notification - Sent when a trade opportunity is skipped
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  join,
  btn,
  homeBtn,
  formatSol,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Skip reason types
 */
export type SkipReason =
  | 'INSUFFICIENT_BALANCE'
  | 'MAX_POSITIONS'
  | 'RATE_LIMIT'
  | 'COOLDOWN'
  | 'AUTOHUNT_DISABLED'
  | 'LOW_SCORE'
  | 'FILTER_FAILED'
  | 'OTHER';

/**
 * Data for hunt skipped notification
 */
export interface HuntSkippedData {
  reason: SkipReason;
  reasonText?: string; // Optional custom reason text
  neededSol?: number;
  haveSol?: number;
  tokenSymbol?: string;
}

/**
 * Render the HUNT SKIPPED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | HUNT SKIPPED</b>
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Reason:</b> {reason}
 * <b>Needed:</b> {need} SOL
 * └─ <b>Have:</b> {have} SOL
 */
export function renderHuntSkipped(data: HuntSkippedData): Panel {
  const lines: string[] = [];

  // Reason
  lines.push(stat('Reason', data.reasonText || formatReason(data.reason)));

  // Token if available
  if (data.tokenSymbol) {
    lines.push(stat('Token', data.tokenSymbol));
  }

  // Balance info if applicable
  if (data.reason === 'INSUFFICIENT_BALANCE' && data.neededSol !== undefined && data.haveSol !== undefined) {
    lines.push(stat('Needed', `${formatSol(data.neededSol)} SOL`));
    lines.push(join(`Have: ${formatSol(data.haveSol)} SOL`));
  }

  // Buttons
  const buttons: Button[][] = [
    [
      btn('Settings', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('HUNT SKIPPED', lines, buttons);
}

/**
 * Format skip reason for display
 */
function formatReason(reason: SkipReason): string {
  switch (reason) {
    case 'INSUFFICIENT_BALANCE':
      return 'Insufficient balance';
    case 'MAX_POSITIONS':
      return 'Maximum positions reached (2/2)';
    case 'RATE_LIMIT':
      return 'Rate limit reached (max buys/hour)';
    case 'COOLDOWN':
      return 'Token on cooldown';
    case 'AUTOHUNT_DISABLED':
      return 'Autohunt is disabled';
    case 'LOW_SCORE':
      return 'Token score too low';
    case 'FILTER_FAILED':
      return 'Token failed filters';
    case 'OTHER':
    default:
      return 'Trade skipped';
  }
}

/**
 * Render insufficient balance skip
 */
export function renderHuntSkippedBalance(neededSol: number, haveSol: number, tokenSymbol?: string): Panel {
  return renderHuntSkipped({
    reason: 'INSUFFICIENT_BALANCE',
    neededSol,
    haveSol,
    tokenSymbol,
  });
}

/**
 * Render max positions skip
 */
export function renderHuntSkippedMaxPositions(tokenSymbol?: string): Panel {
  return renderHuntSkipped({
    reason: 'MAX_POSITIONS',
    tokenSymbol,
  });
}

/**
 * Render rate limit skip
 */
export function renderHuntSkippedRateLimit(tokenSymbol?: string): Panel {
  return renderHuntSkipped({
    reason: 'RATE_LIMIT',
    tokenSymbol,
  });
}
