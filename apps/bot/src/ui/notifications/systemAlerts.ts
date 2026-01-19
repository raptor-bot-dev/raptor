// apps/bot/src/ui/notifications/systemAlerts.ts
// System alert notifications - Budget warnings, circuit breaker, opportunities
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
  type Button,
  type Panel,
} from '../panelKit.js';
import { CB } from '../callbackIds.js';

/**
 * Data for budget warning notification
 */
export interface BudgetWarningData {
  dailySpent: number;
  dailyLimit: number;
  percentUsed: number;
}

/**
 * Render the BUDGET WARNING notification
 *
 * Template:
 * 🦖 <b>RAPTOR | BUDGET WARNING</b> ⚠️
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Daily Spent:</b> {spent} SOL
 * <b>Daily Limit:</b> {limit} SOL
 * <b>Usage:</b> {pct}%
 */
export function renderBudgetWarning(data: BudgetWarningData): Panel {
  const lines: string[] = [];

  // Budget info
  lines.push(stat('Daily Spent', `${formatSol(data.dailySpent)} SOL`));
  lines.push(stat('Daily Limit', `${formatSol(data.dailyLimit)} SOL`));
  lines.push(stat('Usage', `${data.percentUsed.toFixed(0)}%`));

  // Warning message
  lines.push('');
  lines.push('Consider adjusting your daily limit in settings.');

  // Buttons
  const buttons: Button[][] = [
    [
      btn('Settings', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('BUDGET WARNING ⚠️', lines, buttons);
}

/**
 * Data for circuit breaker notification
 */
export interface CircuitBreakerData {
  consecutiveFailures: number;
  reopensAt?: string;
}

/**
 * Render the CIRCUIT BREAKER notification
 *
 * Template:
 * 🦖 <b>RAPTOR | CIRCUIT BREAKER OPEN</b> 🚨
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Consecutive Failures:</b> {count}
 * <b>Auto-trading paused until:</b> {time}
 */
export function renderCircuitBreaker(data: CircuitBreakerData): Panel {
  const lines: string[] = [];

  // Circuit breaker info
  lines.push(stat('Consecutive Failures', `${data.consecutiveFailures}`));
  lines.push(stat('Auto-trading paused until', data.reopensAt || 'manual reset'));

  // Safety message
  lines.push('');
  lines.push('This is a safety measure.');
  lines.push('Check your RPC and wallet status.');

  // Buttons
  const buttons: Button[][] = [
    [
      btn('Settings', CB.SETTINGS.OPEN),
      homeBtn(),
    ],
  ];

  return panel('CIRCUIT BREAKER OPEN 🚨', lines, buttons);
}

/**
 * Data for opportunity detected notification
 */
export interface OpportunityDetectedData {
  tokenName: string;
  tokenSymbol: string;
  tokenMint: string;
  score: number;
  source: string;
}

/**
 * Render the OPPORTUNITY DETECTED notification
 *
 * Template:
 * 🦖 <b>RAPTOR | OPPORTUNITY DETECTED</b> 🎯
 * ━━━━━━━━━━━━━━━━
 * <code>{WIDTH_PAD}</code>
 * <b>Token:</b> {name} ({symbol})
 *    └─ <code>{mint}</code>
 * <b>Score:</b> {score}/100
 * <b>Source:</b> {source}
 */
export function renderOpportunityDetected(data: OpportunityDetectedData): Panel {
  const lines: string[] = [];

  // Token info
  lines.push(stat('Token', `${data.tokenName} (${data.tokenSymbol})`));
  lines.push(join(code(data.tokenMint)));

  // Score
  lines.push(stat('Score', `${data.score}/100`));

  // Source
  lines.push(stat('Source', data.source));

  // Info message
  lines.push('');
  lines.push('Auto-buy will execute if strategy conditions match.');

  // Buttons
  const buttons: Button[][] = [
    [
      urlBtn('Chart', dexscreenerChartUrl(data.tokenMint)),
      btn('Positions', CB.POSITIONS.OPEN),
    ],
    [homeBtn()],
  ];

  return panel('OPPORTUNITY DETECTED 🎯', lines, buttons);
}
