// Pump.fun integration for Solana
// Handles bonding curve buys/sells before graduation

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PROGRAM_IDS,
  SOLANA_CONFIG,
  solToLamports,
  lamportsToSol,
  tokenAmountToDecimal,
  SPL_TOKEN_DECIMALS,
  type BondingCurveState,
  calculateBondingCurvePrice,
  calculateBondingCurveProgress,
} from '@raptor/shared';
import bs58 from 'bs58';

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

// =============================================================================
// PDA Derivation Functions
// =============================================================================

const PUMP_FUN_PROGRAM = new PublicKey(PUMP_FUN_PROGRAM_ID);
const PUMP_FUN_GLOBAL = new PublicKey(PUMP_FUN_GLOBAL_STATE);
const PUMP_FUN_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const PUMP_FUN_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');

/**
 * Derive bonding curve PDA for a mint
 */
export function deriveBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derive global volume accumulator PDA
 * Required by pump.fun since August 2025 update for volume tracking
 */
export function deriveGlobalVolumeAccumulatorPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global_volume_accumulator')],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derive user volume accumulator PDA
 * Required by pump.fun since August 2025 update for per-user volume tracking
 */
export function deriveUserVolumeAccumulatorPDA(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), user.toBuffer()],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derive associated bonding curve token account
 * pump.fun uses Token-2022 program for all tokens
 */
export async function deriveAssociatedBondingCurve(
  bondingCurve: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID);
}

/**
 * Get or create associated token account instruction
 * pump.fun uses Token-2022 program for all tokens
 */
export function getOrCreateATAInstruction(
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey
): { ata: PublicKey; instruction: TransactionInstruction | null } {
  // Use Token-2022 program for pump.fun tokens
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Note: We'll check if account exists before adding this instruction
  const instruction = createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID
  );

  return { ata, instruction };
}

// =============================================================================
// Transaction Building Functions
// =============================================================================

export interface PumpFunBuyParams {
  mint: PublicKey;
  solAmount: bigint;
  minTokensOut: bigint;
  slippageBps?: number;
}

export interface PumpFunSellParams {
  mint: PublicKey;
  tokenAmount: bigint;
  minSolOut: bigint;
  slippageBps?: number;
}

export interface PumpFunTradeResult {
  signature: string;
  tokenAmount: bigint;
  solAmount: bigint;
}

/**
 * PumpFunClient - handles all pump.fun transactions
 */
export class PumpFunClient {
  private connection: Connection;
  private wallet: Keypair;

  constructor(wallet?: Keypair) {
    this.connection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');

    // Load wallet from environment or use provided
    if (wallet) {
      this.wallet = wallet;
    } else {
      const privateKey = process.env.SOLANA_EXECUTOR_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('SOLANA_EXECUTOR_PRIVATE_KEY not set');
      }
      this.wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    }
  }

  /**
   * Get bonding curve state for a token
   */
  async getBondingCurveState(mint: PublicKey): Promise<BondingCurveState | null> {
    try {
      const [bondingCurve] = deriveBondingCurvePDA(mint);
      const accountInfo = await this.connection.getAccountInfo(bondingCurve);

      if (!accountInfo || accountInfo.data.length < 49) {
        return null;
      }

      return decodeBondingCurveState(Buffer.from(accountInfo.data));
    } catch (error) {
      console.error('[PumpFunClient] Error getting bonding curve state:', error);
      return null;
    }
  }

  /**
   * Execute a buy on pump.fun bonding curve
   * Note: pump.fun uses Token-2022 program for all tokens
   */
  async buy(params: PumpFunBuyParams): Promise<PumpFunTradeResult> {
    const { mint, solAmount, minTokensOut, slippageBps = 500 } = params;

    console.log(`[PumpFunClient] Buying with ${lamportsToSol(solAmount)} SOL`);

    // Derive PDAs - use Token-2022 for pump.fun tokens
    const [bondingCurve] = deriveBondingCurvePDA(mint);
    const associatedBondingCurve = await deriveAssociatedBondingCurve(bondingCurve, mint);
    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      this.wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive volume accumulator PDAs (required since August 2025 pump.fun update)
    const [globalVolumeAccumulator] = deriveGlobalVolumeAccumulatorPDA();
    const [userVolumeAccumulator] = deriveUserVolumeAccumulatorPDA(this.wallet.publicKey);

    // Get bonding curve state for calculation
    const state = await this.getBondingCurveState(mint);
    if (!state) {
      throw new Error('Token not found on bonding curve');
    }
    if (state.complete) {
      throw new Error('Token has graduated - use Jupiter instead');
    }

    // Calculate expected tokens
    const expectedTokens = calculateBuyOutput(
      solAmount,
      state.virtualSolReserves,
      state.virtualTokenReserves
    );

    // Apply slippage
    const minTokens = minTokensOut > 0n
      ? minTokensOut
      : (expectedTokens * BigInt(10000 - slippageBps)) / 10000n;

    // Build transaction
    const transaction = new Transaction();

    // Add priority fee for faster inclusion
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
    );

    // Check if user token account exists, if not create it
    // Use Token-2022 program for pump.fun tokens
    const userATAInfo = await this.connection.getAccountInfo(userTokenAccount);
    if (!userATAInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          userTokenAccount,
          this.wallet.publicKey,
          mint,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }

    // Build buy instruction
    // SECURITY: P0-4 - Use minTokens (with slippage) instead of expectedTokens
    // This protects against MEV sandwich attacks by setting a minimum acceptable output
    // Note: pump.fun uses Token-2022 program for all tokens
    // Note: Volume accumulator accounts added in August 2025 pump.fun update
    const buyInstruction = new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
        // Volume accumulator accounts (required since August 2025)
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      ],
      data: encodeBuyData(minTokens, solAmount),
    });

    transaction.add(buyInstruction);

    // Send and confirm
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.wallet],
      { commitment: 'confirmed', maxRetries: 3 }
    );

    console.log(`[PumpFunClient] Buy successful: ${signature}`);

    return {
      signature,
      tokenAmount: expectedTokens,
      solAmount,
    };
  }

  /**
   * Execute a sell on pump.fun bonding curve
   * Note: pump.fun uses Token-2022 program for all tokens
   */
  async sell(params: PumpFunSellParams): Promise<PumpFunTradeResult> {
    const { mint, tokenAmount, minSolOut, slippageBps = 500 } = params;

    console.log(`[PumpFunClient] Selling ${tokenAmount} tokens`);

    // Derive PDAs - use Token-2022 for pump.fun tokens
    const [bondingCurve] = deriveBondingCurvePDA(mint);
    const associatedBondingCurve = await deriveAssociatedBondingCurve(bondingCurve, mint);
    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      this.wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive volume accumulator PDAs (required since August 2025 pump.fun update)
    const [globalVolumeAccumulator] = deriveGlobalVolumeAccumulatorPDA();
    const [userVolumeAccumulator] = deriveUserVolumeAccumulatorPDA(this.wallet.publicKey);

    // Get bonding curve state
    const state = await this.getBondingCurveState(mint);
    if (!state) {
      throw new Error('Token not found on bonding curve');
    }
    if (state.complete) {
      throw new Error('Token has graduated - use Jupiter instead');
    }

    // Calculate expected SOL
    const expectedSol = calculateSellOutput(
      tokenAmount,
      state.virtualSolReserves,
      state.virtualTokenReserves
    );

    // Apply slippage
    const minSol = minSolOut > 0n
      ? minSolOut
      : (expectedSol * BigInt(10000 - slippageBps)) / 10000n;

    // Build transaction
    const transaction = new Transaction();

    // Add priority fee
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 })
    );

    // Build sell instruction
    // Note: pump.fun uses Token-2022 program for all tokens
    const sellInstruction = new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: PUMP_FUN_GLOBAL, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
        // Volume accumulator accounts (required since August 2025)
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
      ],
      data: encodeSellData(tokenAmount, minSol),
    });

    transaction.add(sellInstruction);

    // Send and confirm
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.wallet],
      { commitment: 'confirmed', maxRetries: 3 }
    );

    console.log(`[PumpFunClient] Sell successful: ${signature}`);

    return {
      signature,
      tokenAmount,
      solAmount: expectedSol,
    };
  }

  /**
   * Get wallet public key
   */
  getPublicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /**
   * Get SOL balance
   */
  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }
}

// Singleton instance (lazy initialization)
let pumpFunClient: PumpFunClient | null = null;

export function getPumpFunClient(): PumpFunClient {
  if (!pumpFunClient) {
    pumpFunClient = new PumpFunClient();
  }
  return pumpFunClient;
}
