/**
 * Withdrawal Validation for RAPTOR v4.0
 * Solana-only build
 *
 * SECURITY: H-007 - Comprehensive withdrawal validation
 * - Amount bounds checking
 * - Address format validation
 * - Balance verification
 * - Rate limiting for withdrawals
 */

import { PublicKey } from '@solana/web3.js';
import type { Chain } from '@raptor/shared';

/**
 * Minimum withdrawal amounts (in SOL)
 * Prevents dust withdrawals that cost more in gas than value
 */
const MIN_WITHDRAWAL: Record<Chain, number> = {
  sol: 0.001,  // ~$0.15 at $150/SOL
};

/**
 * Maximum withdrawal amounts per transaction (safety limit)
 */
const MAX_WITHDRAWAL: Record<Chain, number> = {
  sol: 1000,
};

/**
 * Withdrawal validation result
 */
export interface WithdrawalValidation {
  valid: boolean;
  error?: string;
  warnings?: string[];
  sanitizedAmount?: string;
  sanitizedAddress?: string;
}

/**
 * Validate withdrawal parameters
 */
export function validateWithdrawal(
  chain: Chain,
  amount: string,
  toAddress: string,
  availableBalance: number
): WithdrawalValidation {
  // Solana-only build
  if (chain !== 'sol') {
    return { valid: false, error: 'This build is Solana-only' };
  }

  const warnings: string[] = [];

  // Parse and validate amount
  const parsedAmount = parseFloat(amount);

  if (isNaN(parsedAmount)) {
    return { valid: false, error: 'Invalid amount format' };
  }

  if (parsedAmount <= 0) {
    return { valid: false, error: 'Amount must be positive' };
  }

  // Check minimum
  const minAmount = MIN_WITHDRAWAL.sol;
  if (parsedAmount < minAmount) {
    return {
      valid: false,
      error: `Minimum withdrawal is ${minAmount} SOL`,
    };
  }

  // Check maximum
  const maxAmount = MAX_WITHDRAWAL.sol;
  if (parsedAmount > maxAmount) {
    return {
      valid: false,
      error: `Maximum withdrawal per transaction is ${maxAmount} SOL. Please split into multiple withdrawals.`,
    };
  }

  // Check balance
  if (parsedAmount > availableBalance) {
    return {
      valid: false,
      error: `Insufficient balance. Available: ${availableBalance.toFixed(6)} SOL`,
    };
  }

  // Warn if withdrawing more than 90% of balance
  if (parsedAmount > availableBalance * 0.9) {
    warnings.push('Withdrawing most of your balance. Ensure you have enough for gas.');
  }

  // Validate address
  const addressValidation = validateAddress('sol', toAddress);
  if (!addressValidation.valid) {
    return { valid: false, error: addressValidation.error };
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
    sanitizedAmount: parsedAmount.toFixed(9), // Standardize precision
    sanitizedAddress: toAddress,
  };
}

/**
 * Validate address format for Solana
 */
export function validateAddress(
  chain: Chain,
  address: string
): { valid: boolean; error?: string; checksumAddress?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Address is required' };
  }

  const trimmed = address.trim();
  return validateSolanaAddress(trimmed);
}

/**
 * Validate Solana address
 */
function validateSolanaAddress(
  address: string
): { valid: boolean; error?: string } {
  try {
    // Check base58 format and length
    const pubkey = new PublicKey(address);

    // Verify it's on the ed25519 curve (valid public key)
    if (!PublicKey.isOnCurve(pubkey.toBytes())) {
      return { valid: false, error: 'Invalid Solana address (not on curve)' };
    }

    // Check for common invalid addresses
    if (address === '11111111111111111111111111111111') {
      return { valid: false, error: 'Cannot withdraw to system program' };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid Solana address format' };
  }
}

/**
 * Check if address is a known contract (Solana doesn't have same distinction)
 */
export async function isContractAddress(
  _chain: Chain,
  _address: string
): Promise<boolean> {
  // Solana doesn't have the same contract distinction as EVM
  return false;
}

/**
 * Withdrawal rate limit tracking
 * Prevents rapid successive withdrawals (potential compromise indicator)
 */
const withdrawalHistory = new Map<number, { timestamps: number[]; totalAmount: number }>();

const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour
const MAX_WITHDRAWALS_PER_HOUR = 5;
const MAX_TOTAL_PER_HOUR_USD = 10000; // Rough USD equivalent limit

/**
 * Check withdrawal rate limit
 */
export function checkWithdrawalRateLimit(
  tgId: number,
  amountUsd: number
): { allowed: boolean; error?: string; remainingWithdrawals?: number } {
  const now = Date.now();
  const history = withdrawalHistory.get(tgId) || { timestamps: [], totalAmount: 0 };

  // Filter to last hour only
  const recentTimestamps = history.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

  // Check count limit
  if (recentTimestamps.length >= MAX_WITHDRAWALS_PER_HOUR) {
    const oldestRecent = Math.min(...recentTimestamps);
    const waitMinutes = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldestRecent)) / 60000);
    return {
      allowed: false,
      error: `Too many withdrawals. Please wait ${waitMinutes} minutes.`,
      remainingWithdrawals: 0,
    };
  }

  // Check total amount limit (would need price feeds in production)
  if (history.totalAmount + amountUsd > MAX_TOTAL_PER_HOUR_USD) {
    return {
      allowed: false,
      error: `Hourly withdrawal limit reached. Please try again later.`,
      remainingWithdrawals: MAX_WITHDRAWALS_PER_HOUR - recentTimestamps.length,
    };
  }

  return {
    allowed: true,
    remainingWithdrawals: MAX_WITHDRAWALS_PER_HOUR - recentTimestamps.length,
  };
}

/**
 * Record a withdrawal for rate limiting
 */
export function recordWithdrawal(tgId: number, amountUsd: number): void {
  const now = Date.now();
  const history = withdrawalHistory.get(tgId) || { timestamps: [], totalAmount: 0 };

  // Filter to last hour and add new
  history.timestamps = history.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  history.timestamps.push(now);
  history.totalAmount += amountUsd;

  withdrawalHistory.set(tgId, history);
}

/**
 * Clean up old rate limit data (call periodically)
 */
export function cleanupRateLimitData(): void {
  const now = Date.now();

  for (const [tgId, history] of withdrawalHistory) {
    history.timestamps = history.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

    if (history.timestamps.length === 0) {
      withdrawalHistory.delete(tgId);
    } else {
      // Recalculate total (decay over time)
      history.totalAmount = history.totalAmount * 0.5; // Decay factor
    }
  }
}

// Cleanup every 30 minutes
setInterval(cleanupRateLimitData, 30 * 60 * 1000);
