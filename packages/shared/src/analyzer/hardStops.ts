/**
 * Hard Stops Module for RAPTOR v4.0
 * Solana-only build
 *
 * Absolute blockers that prevent trading regardless of score.
 * If ANY hard stop triggers, the token is UNSAFE.
 *
 * Solana Hard Stops:
 * - freeze_authority: Can freeze token accounts
 * - mint_authority: Can mint unlimited tokens
 * - permanent_delegate: Third party can transfer tokens
 */

import type { Chain } from '../types.js';

// Hard stop types for Solana
export type SolanaHardStop =
  | 'freeze_authority'
  | 'mint_authority'
  | 'permanent_delegate'
  | 'close_authority';

export type HardStop = SolanaHardStop;

// Human-readable descriptions for hard stops
export const HARD_STOP_DESCRIPTIONS: Record<HardStop, string> = {
  freeze_authority: 'Can freeze your token account',
  mint_authority: 'Can mint unlimited tokens, diluting value',
  permanent_delegate: 'Third party can transfer your tokens',
  close_authority: 'Can close token accounts',
};

// Severity levels for hard stops
export type HardStopSeverity = 'CRITICAL' | 'HIGH';

export const HARD_STOP_SEVERITY: Record<HardStop, HardStopSeverity> = {
  // Critical - immediate danger of losing funds
  freeze_authority: 'CRITICAL',
  permanent_delegate: 'CRITICAL',

  // High - significant risk
  mint_authority: 'HIGH',
  close_authority: 'HIGH',
};

/**
 * Determine the highest severity from a list of hard stops
 */
function determineSeverity(stops: HardStop[]): HardStopSeverity | null {
  if (stops.length === 0) return null;

  // Check if any are critical
  for (const stop of stops) {
    if (HARD_STOP_SEVERITY[stop] === 'CRITICAL') {
      return 'CRITICAL';
    }
  }

  // If no critical, check for high
  for (const stop of stops) {
    if (HARD_STOP_SEVERITY[stop] === 'HIGH') {
      return 'HIGH';
    }
  }

  return null;
}

export interface HardStopResult {
  triggered: boolean;
  stops: HardStop[];
  reasons: string[];
  severity: HardStopSeverity | null;
  chain: Chain;
}

export interface SolanaTokenInfo {
  hasFreezeAuthority: boolean;
  hasMintAuthority: boolean;
  hasPermanentDelegate: boolean;
  hasCloseAuthority: boolean;
}

/**
 * Check Solana hard stops
 */
export function checkSolanaHardStops(info: SolanaTokenInfo): HardStopResult {
  const stops: SolanaHardStop[] = [];
  const reasons: string[] = [];

  if (info.hasFreezeAuthority) {
    stops.push('freeze_authority');
    reasons.push(HARD_STOP_DESCRIPTIONS.freeze_authority);
  }

  if (info.hasMintAuthority) {
    stops.push('mint_authority');
    reasons.push(HARD_STOP_DESCRIPTIONS.mint_authority);
  }

  if (info.hasPermanentDelegate) {
    stops.push('permanent_delegate');
    reasons.push(HARD_STOP_DESCRIPTIONS.permanent_delegate);
  }

  if (info.hasCloseAuthority) {
    stops.push('close_authority');
    reasons.push(HARD_STOP_DESCRIPTIONS.close_authority);
  }

  // Determine highest severity
  const severity = determineSeverity(stops);

  return {
    triggered: stops.length > 0,
    stops,
    reasons,
    severity,
    chain: 'sol',
  };
}

/**
 * Check hard stops for Solana
 */
export function checkHardStops(
  _chain: Chain,
  solanaInfo?: SolanaTokenInfo
): HardStopResult {
  if (!solanaInfo) {
    return {
      triggered: false,
      stops: [],
      reasons: [],
      severity: null,
      chain: 'sol',
    };
  }
  return checkSolanaHardStops(solanaInfo);
}

/**
 * Format hard stop result for display
 */
export function formatHardStopResult(result: HardStopResult): string {
  if (!result.triggered) {
    return 'No hard stops triggered';
  }

  const severityEmoji = result.severity === 'CRITICAL' ? '🚨' : '⚠️';
  const header = `${severityEmoji} ${result.severity} HARD STOP`;

  const stopsList = result.reasons.map(r => `• ${r}`).join('\n');

  return `${header}\n${stopsList}`;
}

/**
 * Check if a specific hard stop is triggered
 */
export function hasHardStop(result: HardStopResult, stop: HardStop): boolean {
  return result.stops.includes(stop);
}

/**
 * Get all hard stops for Solana
 */
export function getHardStopsForChain(_chain: Chain): HardStop[] {
  return ['freeze_authority', 'mint_authority', 'permanent_delegate', 'close_authority'];
}
