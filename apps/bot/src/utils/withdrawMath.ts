/**
 * Withdraw Math - Pure functions for withdrawal calculations
 * These functions are extracted for testability.
 */

/** Buffer to keep in wallet for rent/fees (0.01 SOL) */
export const BUFFER_SOL = 0.01;

/** Lamports per SOL */
export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Calculate maximum withdrawable SOL (balance minus buffer)
 * @param balanceSol Current balance in SOL
 * @returns Maximum withdrawable amount in SOL (never negative)
 */
export function maxWithdraw(balanceSol: number): number {
  return Math.max(0, balanceSol - BUFFER_SOL);
}

/**
 * Validate a SOL withdrawal amount
 * @param amount Amount to withdraw in SOL
 * @param balanceSol Current balance in SOL
 * @returns true if amount is valid (0 < amount <= maxWithdraw)
 */
export function validateSolAmount(amount: number, balanceSol: number): boolean {
  if (amount <= 0) return false;
  if (isNaN(amount)) return false;
  const max = maxWithdraw(balanceSol);
  return amount <= max;
}

/**
 * Validate a percentage withdrawal amount
 * @param percent Percentage to withdraw (1-100)
 * @returns true if percentage is valid (1 <= percent <= 100)
 */
export function validatePercent(percent: number): boolean {
  if (isNaN(percent)) return false;
  return percent >= 1 && percent <= 100;
}

/**
 * Compute SOL amount from percentage of max withdrawable
 * @param balanceSol Current balance in SOL
 * @param percent Percentage to withdraw (1-100)
 * @returns Amount in SOL
 */
export function computeSolFromPercent(balanceSol: number, percent: number): number {
  const max = maxWithdraw(balanceSol);
  return (max * percent) / 100;
}

/**
 * Convert SOL to lamports (integer)
 * @param sol Amount in SOL
 * @returns Amount in lamports (floored to integer)
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

/**
 * Convert lamports to SOL
 * @param lamports Amount in lamports
 * @returns Amount in SOL
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Compute lamports to withdraw from percentage
 * @param balanceSol Current balance in SOL
 * @param percent Percentage to withdraw (1-100)
 * @returns Amount in lamports (floored integer)
 */
export function computeLamportsFromPercent(balanceSol: number, percent: number): number {
  const sol = computeSolFromPercent(balanceSol, percent);
  return solToLamports(sol);
}

/**
 * Validate a Solana address (basic length check)
 * @param address Address string
 * @returns true if address has valid length (32-44 chars, base58)
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  return trimmed.length >= 32 && trimmed.length <= 44;
}
