/**
 * Hard Stops Module for RAPTOR v2.2
 *
 * Absolute blockers that prevent trading regardless of score.
 * If ANY hard stop triggers, the token is UNSAFE.
 *
 * EVM Hard Stops:
 * - honeypot: Can't sell
 * - transfer_pausable: Owner can pause transfers
 * - blacklist: Owner can blacklist addresses
 * - proxy+not_open_source: Upgradeable without verified source
 * - owner_change_balance: Owner can modify balances
 * - selfdestruct: Contract can be destroyed
 *
 * Solana Hard Stops:
 * - freeze_authority: Can freeze token accounts
 * - mint_authority: Can mint unlimited tokens
 * - permanent_delegate: Third party can transfer tokens
 */

import type { Chain } from '../types.js';

// Hard stop types for EVM chains
export type EVMHardStop =
  | 'honeypot'
  | 'transfer_pausable'
  | 'blacklist'
  | 'proxy_not_open_source'
  | 'owner_change_balance'
  | 'selfdestruct'
  | 'hidden_owner'
  | 'external_call'
  | 'trading_cooldown';

// Hard stop types for Solana
export type SolanaHardStop =
  | 'freeze_authority'
  | 'mint_authority'
  | 'permanent_delegate'
  | 'close_authority';

export type HardStop = EVMHardStop | SolanaHardStop;

// Human-readable descriptions for hard stops
export const HARD_STOP_DESCRIPTIONS: Record<HardStop, string> = {
  // EVM
  honeypot: 'Cannot sell tokens - honeypot detected',
  transfer_pausable: 'Owner can pause all transfers',
  blacklist: 'Owner can blacklist addresses from trading',
  proxy_not_open_source: 'Upgradeable contract without verified source code',
  owner_change_balance: 'Owner can modify token balances',
  selfdestruct: 'Contract can be destroyed, taking funds with it',
  hidden_owner: 'Hidden owner with elevated privileges',
  external_call: 'Dangerous external calls detected',
  trading_cooldown: 'Trading cooldown restricts selling',

  // Solana
  freeze_authority: 'Can freeze your token account',
  mint_authority: 'Can mint unlimited tokens, diluting value',
  permanent_delegate: 'Third party can transfer your tokens',
  close_authority: 'Can close token accounts',
};

// Severity levels for hard stops
export type HardStopSeverity = 'CRITICAL' | 'HIGH';

export const HARD_STOP_SEVERITY: Record<HardStop, HardStopSeverity> = {
  // Critical - immediate danger of losing funds
  honeypot: 'CRITICAL',
  selfdestruct: 'CRITICAL',
  owner_change_balance: 'CRITICAL',
  freeze_authority: 'CRITICAL',
  permanent_delegate: 'CRITICAL',

  // High - significant risk
  transfer_pausable: 'HIGH',
  blacklist: 'HIGH',
  proxy_not_open_source: 'HIGH',
  hidden_owner: 'HIGH',
  external_call: 'HIGH',
  trading_cooldown: 'HIGH',
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

export interface EVMContractInfo {
  isHoneypot: boolean;
  canPauseTransfers: boolean;
  hasBlacklist: boolean;
  isProxy: boolean;
  isOpenSource: boolean;
  canChangeBalance: boolean;
  hasSelfDestruct: boolean;
  hasHiddenOwner: boolean;
  hasExternalCall: boolean;
  hasTradingCooldown: boolean;
}

export interface SolanaTokenInfo {
  hasFreezeAuthority: boolean;
  hasMintAuthority: boolean;
  hasPermanentDelegate: boolean;
  hasCloseAuthority: boolean;
}

/**
 * Check EVM hard stops
 */
export function checkEVMHardStops(info: EVMContractInfo): HardStopResult {
  const stops: EVMHardStop[] = [];
  const reasons: string[] = [];

  if (info.isHoneypot) {
    stops.push('honeypot');
    reasons.push(HARD_STOP_DESCRIPTIONS.honeypot);
  }

  if (info.canPauseTransfers) {
    stops.push('transfer_pausable');
    reasons.push(HARD_STOP_DESCRIPTIONS.transfer_pausable);
  }

  if (info.hasBlacklist) {
    stops.push('blacklist');
    reasons.push(HARD_STOP_DESCRIPTIONS.blacklist);
  }

  if (info.isProxy && !info.isOpenSource) {
    stops.push('proxy_not_open_source');
    reasons.push(HARD_STOP_DESCRIPTIONS.proxy_not_open_source);
  }

  if (info.canChangeBalance) {
    stops.push('owner_change_balance');
    reasons.push(HARD_STOP_DESCRIPTIONS.owner_change_balance);
  }

  if (info.hasSelfDestruct) {
    stops.push('selfdestruct');
    reasons.push(HARD_STOP_DESCRIPTIONS.selfdestruct);
  }

  if (info.hasHiddenOwner) {
    stops.push('hidden_owner');
    reasons.push(HARD_STOP_DESCRIPTIONS.hidden_owner);
  }

  if (info.hasExternalCall) {
    stops.push('external_call');
    reasons.push(HARD_STOP_DESCRIPTIONS.external_call);
  }

  if (info.hasTradingCooldown) {
    stops.push('trading_cooldown');
    reasons.push(HARD_STOP_DESCRIPTIONS.trading_cooldown);
  }

  // Determine highest severity
  const severity = determineSeverity(stops);

  return {
    triggered: stops.length > 0,
    stops,
    reasons,
    severity,
    chain: 'bsc', // Will be set by caller
  };
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
 * Check hard stops for any chain
 */
export function checkHardStops(
  chain: Chain,
  evmInfo?: EVMContractInfo,
  solanaInfo?: SolanaTokenInfo
): HardStopResult {
  if (chain === 'sol') {
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

  // EVM chains
  if (!evmInfo) {
    return {
      triggered: false,
      stops: [],
      reasons: [],
      severity: null,
      chain,
    };
  }

  const result = checkEVMHardStops(evmInfo);
  result.chain = chain;
  return result;
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
 * Get all hard stops for a chain type
 */
export function getHardStopsForChain(chain: Chain): HardStop[] {
  if (chain === 'sol') {
    return ['freeze_authority', 'mint_authority', 'permanent_delegate', 'close_authority'];
  }
  return [
    'honeypot',
    'transfer_pausable',
    'blacklist',
    'proxy_not_open_source',
    'owner_change_balance',
    'selfdestruct',
    'hidden_owner',
    'external_call',
    'trading_cooldown',
  ];
}
