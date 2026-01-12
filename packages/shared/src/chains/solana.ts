// Solana chain utilities for RAPTOR v2

import { SOLANA_CONFIG } from '../constants.js';

// Solana constants
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SOL_DECIMALS = 9;
export const SPL_TOKEN_DECIMALS = 6; // Most SPL tokens use 6 decimals

// Known program IDs
export const PROGRAM_IDS = {
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMP_FUN_GLOBAL: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', // Global state
  PUMP_FUN_FEE: 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', // Fee recipient
  PUMP_FUN_EVENT_AUTHORITY: 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1', // Event authority
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  MOONSHOT: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG',
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  WSOL: 'So11111111111111111111111111111111111111112',
};

// Base58 alphabet for validation
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Validate a Solana address (base58 encoded public key)
 * @param address - Address string to validate
 * @returns true if valid Solana address
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are 32-44 characters in base58
  if (!address || address.length < 32 || address.length > 44) {
    return false;
  }

  // Check all characters are valid base58
  for (const char of address) {
    if (!BASE58_ALPHABET.includes(char)) {
      return false;
    }
  }

  return true;
}

/**
 * Convert SOL to lamports
 * @param sol - Amount in SOL
 * @returns Amount in lamports
 */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

/**
 * Convert lamports to SOL
 * @param lamports - Amount in lamports
 * @returns Amount in SOL
 */
export function lamportsToSol(lamports: bigint | number): number {
  const lamportsBigInt = typeof lamports === 'number' ? BigInt(lamports) : lamports;
  return Number(lamportsBigInt) / LAMPORTS_PER_SOL;
}

/**
 * Format SOL amount for display
 * @param lamports - Amount in lamports
 * @param decimals - Number of decimal places (default 4)
 * @returns Formatted string like "1.2345 SOL"
 */
export function formatSol(lamports: bigint | number, decimals: number = 4): string {
  const sol = lamportsToSol(lamports);
  return `${sol.toFixed(decimals)} SOL`;
}

/**
 * Convert SPL token amount to decimal
 * @param amount - Raw token amount
 * @param tokenDecimals - Token decimals (usually 6 or 9)
 * @returns Decimal amount
 */
export function tokenAmountToDecimal(amount: bigint | number, tokenDecimals: number): number {
  const amountBigInt = typeof amount === 'number' ? BigInt(amount) : amount;
  return Number(amountBigInt) / Math.pow(10, tokenDecimals);
}

/**
 * Convert decimal to SPL token amount
 * @param decimal - Decimal amount
 * @param tokenDecimals - Token decimals
 * @returns Raw token amount
 */
export function decimalToTokenAmount(decimal: number, tokenDecimals: number): bigint {
  return BigInt(Math.floor(decimal * Math.pow(10, tokenDecimals)));
}

/**
 * Get explorer URL for a transaction or address
 * @param value - Transaction signature or address
 * @param type - Type of value ('tx' or 'address')
 * @returns Solscan URL
 */
export function getSolanaExplorerUrl(value: string, type: 'tx' | 'address' = 'tx'): string {
  if (type === 'tx') {
    return `https://solscan.io/tx/${value}`;
  }
  return `https://solscan.io/account/${value}`;
}

/**
 * Get pump.fun URL for a token
 * @param mintAddress - Token mint address
 * @returns pump.fun URL
 */
export function getPumpFunUrl(mintAddress: string): string {
  return `https://pump.fun/${mintAddress}`;
}

/**
 * Check if a program ID is a known launchpad
 * @param programId - Program ID to check
 * @returns Launchpad name or null
 */
export function identifyLaunchpad(programId: string): string | null {
  const launchpad = SOLANA_CONFIG.launchpads.find((lp) => lp.programId === programId);
  return launchpad?.name || null;
}

/**
 * Check if a program ID is a known DEX
 * @param programId - Program ID to check
 * @returns DEX name or null
 */
export function identifyDex(programId: string): string | null {
  const dex = SOLANA_CONFIG.dexes.find((d) => d.programId === programId);
  return dex?.name || null;
}

/**
 * Calculate minimum rent exemption for an account
 * Approximate values for common account types
 */
export const RENT_EXEMPTION = {
  TOKEN_ACCOUNT: 2_039_280, // lamports for SPL token account
  MINT_ACCOUNT: 1_461_600, // lamports for mint account
  ASSOCIATED_TOKEN_ACCOUNT: 2_039_280,
};

/**
 * Estimate transaction fee based on number of signatures
 * Base fee is 5000 lamports per signature
 * @param numSignatures - Number of signatures in transaction
 * @returns Estimated fee in lamports
 */
export function estimateTransactionFee(numSignatures: number = 1): number {
  return numSignatures * 5000;
}

/**
 * Parse a pump.fun bonding curve state
 * This is a simplified representation
 */
export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string; // Creator pubkey - required for creator_vault PDA (late 2025 update)
}

/**
 * Calculate token price from bonding curve state
 * @param state - Bonding curve state
 * @returns Price in SOL per token
 */
export function calculateBondingCurvePrice(state: BondingCurveState): number {
  if (state.virtualTokenReserves === 0n) {
    return 0;
  }
  const solReserves = lamportsToSol(state.virtualSolReserves);
  const tokenReserves = tokenAmountToDecimal(state.virtualTokenReserves, SPL_TOKEN_DECIMALS);
  return solReserves / tokenReserves;
}

/**
 * Calculate market cap from bonding curve state
 * @param state - Bonding curve state
 * @returns Market cap in SOL
 */
export function calculateMarketCap(state: BondingCurveState): number {
  const price = calculateBondingCurvePrice(state);
  const totalSupply = tokenAmountToDecimal(state.tokenTotalSupply, SPL_TOKEN_DECIMALS);
  return price * totalSupply;
}

/**
 * Check if token has graduated from bonding curve
 * (Moved to Raydium after reaching threshold)
 * @param state - Bonding curve state
 * @returns true if graduated
 */
export function hasGraduated(state: BondingCurveState): boolean {
  return state.complete;
}

/**
 * Calculate bonding curve progress (0-100%)
 * Token graduates at ~85 SOL raised
 */
export function calculateBondingCurveProgress(state: BondingCurveState): number {
  const GRADUATION_THRESHOLD_SOL = 85;
  const currentSol = lamportsToSol(state.realSolReserves);
  return Math.min(100, (currentSol / GRADUATION_THRESHOLD_SOL) * 100);
}
