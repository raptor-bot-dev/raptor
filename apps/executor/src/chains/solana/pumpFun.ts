// Pump.fun integration for Solana
// Handles bonding curve buys/sells before graduation

import {
  PROGRAM_IDS,
  solToLamports,
  lamportsToSol,
  tokenAmountToDecimal,
  SPL_TOKEN_DECIMALS,
  type BondingCurveState,
  calculateBondingCurvePrice,
  calculateBondingCurveProgress,
} from '@raptor/shared';

// Pump.fun program constants
export const PUMP_FUN_PROGRAM_ID = PROGRAM_IDS.PUMP_FUN;
export const PUMP_FUN_GLOBAL_STATE = PROGRAM_IDS.PUMP_FUN_GLOBAL;

// Fee structure
export const PUMP_FUN_FEE_BPS = 100; // 1% fee

// Bonding curve parameters
export const VIRTUAL_TOKEN_RESERVES = 1_073_000_000_000_000n; // ~1.073B tokens
export const VIRTUAL_SOL_RESERVES = 30_000_000_000n; // 30 SOL in lamports
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n; // ~793M tokens
export const GRADUATION_THRESHOLD_SOL = 85; // ~85 SOL to graduate

// Discriminators for pump.fun instructions
export const PUMP_FUN_DISCRIMINATORS = {
  CREATE: Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]),
  BUY: Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]),
  SELL: Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]),
};

export interface PumpFunTokenCreate {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurve: string;
  associatedBondingCurve: string;
  creator: string;
  timestamp: number;
}

export interface PumpFunTrade {
  mint: string;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: string;
  timestamp: number;
  bondingCurveComplete: boolean;
}

/**
 * Calculate amount of tokens received for SOL input on bonding curve
 * Uses constant product formula: x * y = k
 */
export function calculateBuyOutput(
  solAmountIn: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): bigint {
  // Apply 1% fee
  const solAfterFee = (solAmountIn * 99n) / 100n;

  // Constant product formula
  const k = virtualSolReserves * virtualTokenReserves;
  const newSolReserves = virtualSolReserves + solAfterFee;
  const newTokenReserves = k / newSolReserves;
  const tokensOut = virtualTokenReserves - newTokenReserves;

  return tokensOut;
}

/**
 * Calculate amount of SOL received for token input on bonding curve
 */
export function calculateSellOutput(
  tokenAmountIn: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): bigint {
  // Constant product formula
  const k = virtualSolReserves * virtualTokenReserves;
  const newTokenReserves = virtualTokenReserves + tokenAmountIn;
  const newSolReserves = k / newTokenReserves;
  const solOut = virtualSolReserves - newSolReserves;

  // Apply 1% fee
  const solAfterFee = (solOut * 99n) / 100n;

  return solAfterFee;
}

/**
 * Get current price from bonding curve state
 */
export function getCurrentPrice(state: BondingCurveState): number {
  return calculateBondingCurvePrice(state);
}

/**
 * Get progress towards graduation (0-100%)
 */
export function getGraduationProgress(state: BondingCurveState): number {
  return calculateBondingCurveProgress(state);
}

/**
 * Check if token has graduated from pump.fun to Raydium
 */
export function hasGraduated(state: BondingCurveState): boolean {
  return state.complete;
}

/**
 * Estimate market cap from bonding curve state
 */
export function estimateMarketCap(state: BondingCurveState): number {
  const price = getCurrentPrice(state);
  const totalSupply = tokenAmountToDecimal(state.tokenTotalSupply, SPL_TOKEN_DECIMALS);
  return price * totalSupply;
}

/**
 * Calculate max buy amount before significant price impact
 * Limits to 2% price impact
 */
export function calculateMaxBuyAmount(state: BondingCurveState): number {
  // 2% price impact = buying about 2% of virtual sol reserves
  const maxLamports = state.virtualSolReserves / 50n;
  return lamportsToSol(maxLamports);
}

/**
 * Decode bonding curve state from account data
 * Note: This is a simplified decoder - actual implementation needs full anchor deserialization
 */
export function decodeBondingCurveState(data: Buffer): BondingCurveState {
  // Skip 8-byte discriminator
  let offset = 8;

  // Read virtual token reserves (u64)
  const virtualTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;

  // Read virtual sol reserves (u64)
  const virtualSolReserves = data.readBigUInt64LE(offset);
  offset += 8;

  // Read real token reserves (u64)
  const realTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;

  // Read real sol reserves (u64)
  const realSolReserves = data.readBigUInt64LE(offset);
  offset += 8;

  // Read token total supply (u64)
  const tokenTotalSupply = data.readBigUInt64LE(offset);
  offset += 8;

  // Read complete flag (bool)
  const complete = data.readUInt8(offset) === 1;

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
  };
}

/**
 * Parse a CreateEvent from transaction logs
 */
export function parseCreateEvent(logs: string[]): PumpFunTokenCreate | null {
  // Look for the create instruction log
  const createLog = logs.find(
    (log) => log.includes('Program log: Create') || log.includes('Instruction: Create')
  );

  if (!createLog) {
    return null;
  }

  // In production, you'd parse the actual event data from logs
  // This is a placeholder that would need the actual log format
  return null;
}

/**
 * Parse a TradeEvent from transaction logs
 */
export function parseTradeEvent(logs: string[]): PumpFunTrade | null {
  // Look for the trade instruction log
  const tradeLog = logs.find(
    (log) => log.includes('Program log: Trade') || log.includes('Instruction: Buy') || log.includes('Instruction: Sell')
  );

  if (!tradeLog) {
    return null;
  }

  // In production, you'd parse the actual event data from logs
  return null;
}

/**
 * Build buy instruction accounts
 * This returns the account metas needed for a pump.fun buy
 */
export function getBuyAccounts(
  mint: string,
  bondingCurve: string,
  associatedBondingCurve: string,
  userWallet: string,
  userTokenAccount: string
): Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> {
  return [
    { pubkey: PUMP_FUN_GLOBAL_STATE, isSigner: false, isWritable: false }, // Global state
    { pubkey: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', isSigner: false, isWritable: true }, // Fee recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // Mint
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // Bonding curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // Associated bonding curve
    { pubkey: userTokenAccount, isSigner: false, isWritable: true }, // User token account
    { pubkey: userWallet, isSigner: true, isWritable: true }, // User wallet
    { pubkey: PROGRAM_IDS.SYSTEM_PROGRAM, isSigner: false, isWritable: false }, // System program
    { pubkey: PROGRAM_IDS.TOKEN_PROGRAM, isSigner: false, isWritable: false }, // Token program
    { pubkey: 'SysvarRent111111111111111111111111111111111', isSigner: false, isWritable: false }, // Rent sysvar
    { pubkey: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', isSigner: false, isWritable: false }, // Associated token program
  ];
}

/**
 * Build sell instruction accounts
 */
export function getSellAccounts(
  mint: string,
  bondingCurve: string,
  associatedBondingCurve: string,
  userWallet: string,
  userTokenAccount: string
): Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> {
  return [
    { pubkey: PUMP_FUN_GLOBAL_STATE, isSigner: false, isWritable: false }, // Global state
    { pubkey: '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf', isSigner: false, isWritable: true }, // Fee recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // Mint
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // Bonding curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // Associated bonding curve
    { pubkey: userTokenAccount, isSigner: false, isWritable: true }, // User token account
    { pubkey: userWallet, isSigner: true, isWritable: true }, // User wallet
    { pubkey: PROGRAM_IDS.SYSTEM_PROGRAM, isSigner: false, isWritable: false }, // System program
    { pubkey: PROGRAM_IDS.ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false }, // Associated token program
    { pubkey: PROGRAM_IDS.TOKEN_PROGRAM, isSigner: false, isWritable: false }, // Token program
  ];
}

/**
 * Encode buy instruction data
 */
export function encodeBuyData(tokenAmount: bigint, maxSolCost: bigint): Buffer {
  const data = Buffer.alloc(24);
  PUMP_FUN_DISCRIMINATORS.BUY.copy(data, 0);
  data.writeBigUInt64LE(tokenAmount, 8);
  data.writeBigUInt64LE(maxSolCost, 16);
  return data;
}

/**
 * Encode sell instruction data
 */
export function encodeSellData(tokenAmount: bigint, minSolOutput: bigint): Buffer {
  const data = Buffer.alloc(24);
  PUMP_FUN_DISCRIMINATORS.SELL.copy(data, 0);
  data.writeBigUInt64LE(tokenAmount, 8);
  data.writeBigUInt64LE(minSolOutput, 16);
  return data;
}
