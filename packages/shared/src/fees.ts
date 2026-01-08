// Fee calculation utilities for RAPTOR v2
// 1% fee on all trades (buy + sell)

export const FEE_PERCENT = 1; // 1%
export const FEE_BPS = 100; // 100 basis points = 1%

/**
 * Calculate fee amount from a given value
 * @param amount - Amount in wei/lamports
 * @returns Fee amount (1% of input)
 */
export function calculateFee(amount: bigint): bigint {
  return amount / 100n; // 1%
}

/**
 * Calculate fee for decimal amounts (Solana SOL)
 * @param amount - Amount in decimal (e.g., 1.5 SOL)
 * @returns Fee amount
 */
export function calculateFeeDecimal(amount: number): number {
  return amount * (FEE_PERCENT / 100);
}

/**
 * Apply fee to a buy order
 * Fee is deducted from the input amount before swap
 * @param amount - Total amount user wants to spend
 * @returns netAmount (what actually gets swapped) and fee
 */
export function applyBuyFee(amount: bigint): { netAmount: bigint; fee: bigint } {
  const fee = calculateFee(amount);
  return {
    netAmount: amount - fee,
    fee,
  };
}

/**
 * Apply fee to a buy order (decimal version for Solana)
 * @param amount - Total amount in decimal
 * @returns netAmount and fee
 */
export function applyBuyFeeDecimal(amount: number): { netAmount: number; fee: number } {
  const fee = calculateFeeDecimal(amount);
  return {
    netAmount: amount - fee,
    fee,
  };
}

/**
 * Apply fee to a sell order
 * Fee is deducted from the output amount after swap
 * @param amountOut - Amount received from swap
 * @returns netAmount (what user actually receives) and fee
 */
export function applySellFee(amountOut: bigint): { netAmount: bigint; fee: bigint } {
  const fee = calculateFee(amountOut);
  return {
    netAmount: amountOut - fee,
    fee,
  };
}

/**
 * Apply fee to a sell order (decimal version for Solana)
 * @param amountOut - Amount received from swap in decimal
 * @returns netAmount and fee
 */
export function applySellFeeDecimal(amountOut: number): { netAmount: number; fee: number } {
  const fee = calculateFeeDecimal(amountOut);
  return {
    netAmount: amountOut - fee,
    fee,
  };
}

/**
 * Calculate amount before fee was applied (reverse calculation)
 * Useful for displaying "original" amounts
 * @param netAmount - Amount after fee deduction
 * @returns Original amount before fee
 */
export function calculatePreFeeAmount(netAmount: bigint): bigint {
  // netAmount = originalAmount - (originalAmount / 100)
  // netAmount = originalAmount * 99 / 100
  // originalAmount = netAmount * 100 / 99
  return (netAmount * 100n) / 99n;
}

/**
 * Format fee for display
 * @param fee - Fee in wei/lamports
 * @param decimals - Token decimals (18 for EVM, 9 for SOL)
 * @param symbol - Token symbol
 * @returns Formatted string like "0.001 ETH"
 */
export function formatFee(fee: bigint, decimals: number, symbol: string): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = fee / divisor;
  const fractionalPart = fee % divisor;

  // Format with appropriate decimal places
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 6);
  const trimmedFractional = fractionalStr.replace(/0+$/, '') || '0';

  if (wholePart === 0n && trimmedFractional === '0') {
    return `<0.000001 ${symbol}`;
  }

  return `${wholePart}.${trimmedFractional} ${symbol}`;
}

/**
 * Get fee wallet address based on chain
 * @param chain - Chain identifier
 * @returns Fee wallet address
 */
export function getFeeWallet(chain: 'bsc' | 'base' | 'eth' | 'sol'): string {
  if (chain === 'sol') {
    return process.env.FEE_WALLET_SOLANA || '';
  }
  return process.env.FEE_WALLET_EVM || '';
}

/**
 * Validate that fee wallets are configured
 * @throws Error if fee wallets are not configured
 */
export function validateFeeWallets(): void {
  const evmWallet = process.env.FEE_WALLET_EVM;
  const solanaWallet = process.env.FEE_WALLET_SOLANA;

  if (!evmWallet) {
    throw new Error('FEE_WALLET_EVM environment variable is not set');
  }
  if (!solanaWallet) {
    throw new Error('FEE_WALLET_SOLANA environment variable is not set');
  }
}
