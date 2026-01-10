/**
 * Withdrawal Validation for RAPTOR v2.3.1
 *
 * SECURITY: H-007 - Comprehensive withdrawal validation
 * - Amount bounds checking
 * - Address format validation
 * - Balance verification
 * - Rate limiting for withdrawals
 */

import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import type { Chain } from '@raptor/shared';

/**
 * Minimum withdrawal amounts per chain (in native token)
 * Prevents dust withdrawals that cost more in gas than value
 */
const MIN_WITHDRAWAL: Record<Chain, number> = {
  sol: 0.001,  // ~$0.15 at $150/SOL
  bsc: 0.001,  // ~$0.60 at $600/BNB
  base: 0.0001, // ~$0.30 at $3000/ETH
  eth: 0.0001,  // ~$0.30 at $3000/ETH
};

/**
 * Maximum withdrawal amounts per transaction (safety limit)
 */
const MAX_WITHDRAWAL: Record<Chain, number> = {
  sol: 1000,
  bsc: 100,
  base: 10,
  eth: 10,
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
  const minAmount = MIN_WITHDRAWAL[chain];
  if (parsedAmount < minAmount) {
    return {
      valid: false,
      error: `Minimum withdrawal is ${minAmount} ${getChainSymbol(chain)}`,
    };
  }

  // Check maximum
  const maxAmount = MAX_WITHDRAWAL[chain];
  if (parsedAmount > maxAmount) {
    return {
      valid: false,
      error: `Maximum withdrawal per transaction is ${maxAmount} ${getChainSymbol(chain)}. Please split into multiple withdrawals.`,
    };
  }

  // Check balance
  if (parsedAmount > availableBalance) {
    return {
      valid: false,
      error: `Insufficient balance. Available: ${availableBalance.toFixed(6)} ${getChainSymbol(chain)}`,
    };
  }

  // Warn if withdrawing more than 90% of balance
  if (parsedAmount > availableBalance * 0.9) {
    warnings.push('Withdrawing most of your balance. Ensure you have enough for gas.');
  }

  // Validate address
  const addressValidation = validateAddress(chain, toAddress);
  if (!addressValidation.valid) {
    return { valid: false, error: addressValidation.error };
  }

  // Check for self-transfer (waste of gas)
  // This would need the user's address passed in for full check

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
    sanitizedAmount: parsedAmount.toFixed(9), // Standardize precision
    sanitizedAddress: addressValidation.checksumAddress || toAddress,
  };
}

/**
 * Validate address format for chain
 */
export function validateAddress(
  chain: Chain,
  address: string
): { valid: boolean; error?: string; checksumAddress?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'Address is required' };
  }

  const trimmed = address.trim();

  if (chain === 'sol') {
    return validateSolanaAddress(trimmed);
  } else {
    return validateEvmAddress(trimmed);
  }
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
 * Validate EVM address with checksum
 */
function validateEvmAddress(
  address: string
): { valid: boolean; error?: string; checksumAddress?: string } {
  // Check basic format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { valid: false, error: 'Invalid EVM address format' };
  }

  // Check for zero address
  if (address === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Cannot withdraw to zero address' };
  }

  // Checksum validation
  try {
    const checksumAddress = ethers.getAddress(address);
    return { valid: true, checksumAddress };
  } catch {
    return { valid: false, error: 'Invalid EVM address checksum' };
  }
}

/**
 * Get native token symbol for chain
 */
function getChainSymbol(chain: Chain): string {
  switch (chain) {
    case 'sol': return 'SOL';
    case 'bsc': return 'BNB';
    default: return 'ETH';
  }
}

/**
 * Check if address is a known contract (potential scam)
 * This would query the blockchain in production
 */
export async function isContractAddress(
  chain: Chain,
  address: string,
  provider?: ethers.JsonRpcProvider
): Promise<boolean> {
  if (chain === 'sol') {
    // Solana doesn't have the same contract distinction
    return false;
  }

  if (!provider) {
    return false; // Can't check without provider
  }

  try {
    const code = await provider.getCode(address);
    return code !== '0x'; // Has code = is contract
  } catch {
    return false;
  }
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
