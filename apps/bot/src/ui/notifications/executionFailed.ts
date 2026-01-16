// apps/bot/src/ui/notifications/executionFailed.ts
// EXECUTION FAILED notification - Sent when a trade fails
// Reference: MUST_READ/DESIGN.md

import {
  panel,
  stat,
  code,
  join,
  btn,
  homeBtn,
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Trade action types
 */
export type TradeAction = 'BUY' | 'SELL';

/**
 * Retry policy types
 */
export type RetryPolicy = 'NO_RETRY' | 'AUTO_RETRY' | 'MANUAL_RETRY';

/**
 * Data for execution failed notification
 */
export interface ExecutionFailedData {
  action: TradeAction;
  symbol: string;
  mint: string;
  reason: string;
  retryPolicy: RetryPolicy;
}

/**
 * Render the EXECUTION FAILED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | EXECUTION FAILED</b> ⚠️
 * ━━━━━━━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Action:</b> {BUY|SELL}
 * <b>Token:</b> {symbol}
 * └─ <code>{mint}</code>
 * <b>Reason:</b> {shortError}
 * <b>Next:</b> {retryPolicy}
 */
export function renderExecutionFailed(data: ExecutionFailedData): Panel {
  const lines: string[] = [];

  // Action
  lines.push(stat('Action', data.action));

  // Token with mint joiner
  lines.push(stat('Token', data.symbol));
  lines.push(join(code(data.mint)));

  // Reason
  lines.push(stat('Reason', truncateReason(data.reason)));

  // Next steps
  lines.push(stat('Next', formatRetryPolicy(data.retryPolicy)));

  // Buttons
  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      homeBtn(),
    ],
  ];

  // Title with warning emoji
  return panel('EXECUTION FAILED ⚠️', lines, buttons);
}

/**
 * Truncate long error reasons
 */
function truncateReason(reason: string): string {
  const maxLength = 100;
  if (reason.length <= maxLength) return reason;
  return reason.slice(0, maxLength - 3) + '...';
}

/**
 * Format retry policy for display
 */
function formatRetryPolicy(policy: RetryPolicy): string {
  switch (policy) {
    case 'NO_RETRY':
      return 'No automatic retry';
    case 'AUTO_RETRY':
      return 'Will retry automatically';
    case 'MANUAL_RETRY':
      return 'Manual retry available';
    default:
      return policy;
  }
}

/**
 * Render buy failed notification
 */
export function renderBuyFailed(symbol: string, mint: string, reason: string): Panel {
  return renderExecutionFailed({
    action: 'BUY',
    symbol,
    mint,
    reason,
    retryPolicy: 'NO_RETRY',
  });
}

/**
 * Render sell failed notification
 */
export function renderSellFailed(symbol: string, mint: string, reason: string): Panel {
  return renderExecutionFailed({
    action: 'SELL',
    symbol,
    mint,
    reason,
    retryPolicy: 'AUTO_RETRY', // Sells often retry
  });
}

/**
 * Render emergency sell failed notification
 */
export function renderEmergencySellFailed(symbol: string, mint: string, reason: string): Panel {
  const lines: string[] = [
    stat('Action', 'EMERGENCY SELL'),
    stat('Token', symbol),
    join(code(mint)),
    stat('Reason', truncateReason(reason)),
    stat('Next', 'Please try again or contact support'),
  ];

  const buttons: Button[][] = [
    [
      btn('Positions', CB.POSITIONS.OPEN),
      btn('Settings', CB.SETTINGS.OPEN),
    ],
    [homeBtn()],
  ];

  return panel('EMERGENCY SELL FAILED ⚠️', lines, buttons);
}
