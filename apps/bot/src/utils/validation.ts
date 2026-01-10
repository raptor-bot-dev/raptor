/**
 * Input Validation Utilities for RAPTOR Bot
 *
 * SECURITY: Validates all callback parameters to prevent injection,
 * integer overflow, and parameter manipulation attacks.
 */

import type { Chain } from '@raptor/shared';

/**
 * Parse a positive integer from string with bounds checking
 * Returns null if invalid
 */
export function parsePositiveInt(value: string, max: number = 1000000): number | null {
  // Remove any non-digit characters
  const cleaned = value.replace(/[^0-9]/g, '');
  if (cleaned.length === 0) return null;

  const num = parseInt(cleaned, 10);

  if (isNaN(num) || num < 0 || num > max) {
    return null;
  }

  return num;
}

/**
 * Parse a wallet index (1-5 range)
 */
export function parseWalletIndex(value: string): number | null {
  const index = parsePositiveInt(value, 5);
  if (index === null || index < 1) return null;
  return index;
}

/**
 * Validate chain parameter
 */
export function isValidChain(chain: string): chain is Chain {
  return ['sol', 'bsc', 'base', 'eth'].includes(chain);
}

/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
  // Solana: base58, 32-44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return true;
  }
  // EVM: 0x + 40 hex
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return true;
  }
  return false;
}

/**
 * Validate amount string (positive decimal)
 */
export function isValidAmount(amount: string): boolean {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0 && isFinite(num);
}

/**
 * Parse and validate amount with bounds
 */
export function parseAmount(
  value: string,
  min: number = 0,
  max: number = 1000000
): number | null {
  const num = parseFloat(value);
  if (isNaN(num) || !isFinite(num) || num < min || num > max) {
    return null;
  }
  return num;
}

/**
 * Validate percentage (0-100)
 */
export function isValidPercent(value: number): boolean {
  return typeof value === 'number' && value >= 0 && value <= 100;
}

/**
 * Parse percentage from string
 */
export function parsePercent(value: string): number | null {
  const num = parsePositiveInt(value, 100);
  if (num === null) return null;
  return num;
}

/**
 * Sanitize callback data to prevent injection
 * Removes any control characters or suspicious patterns
 */
export function sanitizeCallbackData(data: string): string {
  // Remove control characters and limit length
  return data
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, 256);
}

/**
 * Validate token address based on chain
 */
export function isValidTokenAddress(address: string, chain: Chain): boolean {
  if (chain === 'sol') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Parse callback data segments safely
 * Returns null if format is invalid
 */
export function parseCallbackSegments(
  data: string,
  prefix: string,
  expectedCount: number
): string[] | null {
  if (!data.startsWith(prefix)) return null;

  const rest = data.slice(prefix.length);
  const segments = rest.split('_').filter(s => s.length > 0);

  if (segments.length !== expectedCount) return null;

  return segments;
}

/**
 * Validate launchpad name
 */
export function isValidLaunchpad(name: string): boolean {
  const validLaunchpads = [
    'pump.fun', 'pumpswap', 'moonshot', 'bonk.fun', 'believe.app',
    'four.meme', 'virtuals.fun', 'wow.xyz', 'base.pump'
  ];
  return validLaunchpads.includes(name);
}

/**
 * Validate trading mode
 */
export function isValidTradingMode(mode: string): mode is 'pool' | 'solo' | 'snipe' {
  return ['pool', 'solo', 'snipe'].includes(mode);
}
