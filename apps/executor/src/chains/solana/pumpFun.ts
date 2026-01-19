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
  TOKEN_PROGRAM_ID,
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
// AUDIT FIX: pump.pro program ID (upgraded pump.fun, late 2025)
export const PUMP_PRO_PROGRAM_ID = PROGRAM_IDS.PUMP_PRO;

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

/**
 * Calculate amount of tokens received for SOL input on bonding curve
 * Uses constant product formula: x * y = k
 */
export function calculateBuyOutput(
  solAmountIn: bigint,
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint
): bigint {
  // Defensive: validate inputs are positive
  if (solAmountIn <= 0n || virtualSolReserves <= 0n || virtualTokenReserves <= 0n) {
    console.warn('[calculateBuyOutput] Invalid input: all values must be positive', {
      solAmountIn: solAmountIn.toString(),
      virtualSolReserves: virtualSolReserves.toString(),
      virtualTokenReserves: virtualTokenReserves.toString(),
    });
    return 0n;
  }

  // Apply 1% fee
  const solAfterFee = (solAmountIn * 99n) / 100n;

  // Constant product formula
  const k = virtualSolReserves * virtualTokenReserves;
  const newSolReserves = virtualSolReserves + solAfterFee;
  const newTokenReserves = k / newSolReserves;
  const tokensOut = virtualTokenReserves - newTokenReserves;

  // Defensive: ensure non-negative output (corrupted curve state could cause negative)
  if (tokensOut < 0n) {
    console.warn('[calculateBuyOutput] Calculation resulted in negative tokensOut, returning 0', {
      tokensOut: tokensOut.toString(),
      solAmountIn: solAmountIn.toString(),
    });
    return 0n;
  }

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
  // Defensive: validate inputs are positive
  if (tokenAmountIn <= 0n || virtualSolReserves <= 0n || virtualTokenReserves <= 0n) {
    console.warn('[calculateSellOutput] Invalid input: all values must be positive', {
      tokenAmountIn: tokenAmountIn.toString(),
      virtualSolReserves: virtualSolReserves.toString(),
      virtualTokenReserves: virtualTokenReserves.toString(),
    });
    return 0n;
  }

  // Constant product formula
  const k = virtualSolReserves * virtualTokenReserves;
  const newTokenReserves = virtualTokenReserves + tokenAmountIn;
  const newSolReserves = k / newTokenReserves;
  const solOut = virtualSolReserves - newSolReserves;

  // Defensive: ensure non-negative output
  if (solOut < 0n) {
    console.warn('[calculateSellOutput] Calculation resulted in negative solOut, returning 0', {
      solOut: solOut.toString(),
      tokenAmountIn: tokenAmountIn.toString(),
    });
    return 0n;
  }

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
  offset += 1;

  // Read creator pubkey (32 bytes) - required for creator_vault PDA
  const creatorBytes = data.slice(offset, offset + 32);
  const creator = new PublicKey(creatorBytes).toBase58();

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    creator,
  };
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
// Fee program for pump.fun (Sep 2025 update) - required for buy/sell instructions
const PUMP_FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
// AUDIT FIX: pump.pro program (upgraded pump.fun, late 2025)
const PUMP_PRO_PROGRAM = new PublicKey(PUMP_PRO_PROGRAM_ID);
const PUMP_PRO_GLOBAL = process.env.PUMP_PRO_GLOBAL_STATE
  ? new PublicKey(process.env.PUMP_PRO_GLOBAL_STATE)
  : PUMP_FUN_GLOBAL;
const PUMP_PRO_FEE_RECIPIENT = process.env.PUMP_PRO_FEE_RECIPIENT
  ? new PublicKey(process.env.PUMP_PRO_FEE_RECIPIENT)
  : PUMP_FUN_FEE_RECIPIENT;
const PUMP_PRO_EVENT_AUTHORITY = process.env.PUMP_PRO_EVENT_AUTHORITY
  ? new PublicKey(process.env.PUMP_PRO_EVENT_AUTHORITY)
  : PUMP_FUN_EVENT_AUTHORITY;
const PUMP_PRO_FEE_PROGRAM = process.env.PUMP_PRO_FEE_PROGRAM
  ? new PublicKey(process.env.PUMP_PRO_FEE_PROGRAM)
  : PUMP_FEE_PROGRAM;

function getProgramAccounts(programId: PublicKey): {
  global: PublicKey;
  feeRecipient: PublicKey;
  eventAuthority: PublicKey;
  feeProgram: PublicKey;
} {
  if (programId.equals(PUMP_PRO_PROGRAM)) {
    return {
      global: PUMP_PRO_GLOBAL,
      feeRecipient: PUMP_PRO_FEE_RECIPIENT,
      eventAuthority: PUMP_PRO_EVENT_AUTHORITY,
      feeProgram: PUMP_PRO_FEE_PROGRAM,
    };
  }
  return {
    global: PUMP_FUN_GLOBAL,
    feeRecipient: PUMP_FUN_FEE_RECIPIENT,
    eventAuthority: PUMP_FUN_EVENT_AUTHORITY,
    feeProgram: PUMP_FEE_PROGRAM,
  };
}

/**
 * Derive bonding curve PDA for a mint (pump.fun only - legacy)
 */
export function deriveBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_FUN_PROGRAM
  );
}

/**
 * AUDIT FIX: Derive bonding curve PDA for any pump program (pump.fun or pump.pro)
 */
export function deriveBondingCurvePDAForProgram(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    programId
  );
}

/**
 * AUDIT FIX: Find bonding curve and determine which program owns it
 * Checks both pump.fun and pump.pro programs to find the active bonding curve
 *
 * @returns The bonding curve PDA, program ID, and bump if found, null otherwise
 */
export async function findBondingCurveAndProgram(
  connection: Connection,
  mint: PublicKey
): Promise<{
  bondingCurve: PublicKey;
  programId: PublicKey;
  bump: number;
} | null> {
  const programs = [PUMP_FUN_PROGRAM, PUMP_PRO_PROGRAM];

  for (const programId of programs) {
    const [bondingCurve, bump] = deriveBondingCurvePDAForProgram(mint, programId);

    try {
      const accountInfo = await connection.getAccountInfo(bondingCurve);

      // Check if account exists and has valid bonding curve data (min 49 bytes)
      if (accountInfo && accountInfo.data.length >= 49 && accountInfo.owner.equals(programId)) {
        return { bondingCurve, programId, bump };
      }
    } catch (error) {
      // Continue to next program on error
      console.warn(`[findBondingCurveAndProgram] Error checking ${programId.toBase58()}:`, error);
    }
  }

  return null;
}

/**
 * Derive global volume accumulator PDA
 * Required by pump.fun since August 2025 update for volume tracking
 * AUDIT FIX: Added programId parameter for pump.pro support
 */
export function deriveGlobalVolumeAccumulatorPDA(programId: PublicKey = PUMP_FUN_PROGRAM): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global_volume_accumulator')],
    programId
  );
}

/**
 * Derive user volume accumulator PDA
 * Required by pump.fun since August 2025 update for per-user volume tracking
 * AUDIT FIX: Added programId parameter for pump.pro support
 */
export function deriveUserVolumeAccumulatorPDA(user: PublicKey, programId: PublicKey = PUMP_FUN_PROGRAM): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), user.toBuffer()],
    programId
  );
}

/**
 * Derive fee config PDA
 * Required by pump.fun since September 2025 update for fee handling
 * AUDIT FIX: Added programId parameter for pump.pro support
 */
export function deriveFeeConfigPDA(
  programId: PublicKey = PUMP_FUN_PROGRAM,
  feeProgramId: PublicKey = PUMP_FEE_PROGRAM
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config'), programId.toBuffer()],
    feeProgramId
  );
}

/**
 * Derive creator vault PDA
 * Required by pump.fun for creator fee distribution (late 2025 update)
 * This replaced SysvarRent in the account list
 * AUDIT FIX: Added programId parameter for pump.pro support
 */
export function deriveCreatorVaultPDA(creator: PublicKey, programId: PublicKey = PUMP_FUN_PROGRAM): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    programId
  );
}

/**
 * Derive associated bonding curve token account
 * pump.fun uses Token-2022 program for all tokens
 */
export async function deriveAssociatedBondingCurve(
  bondingCurve: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, bondingCurve, true, tokenProgramId);
}

/**
 * Get or create associated token account instruction
 * pump.fun uses Token-2022 program for all tokens
 */
export function getOrCreateATAInstruction(
  mint: PublicKey,
  owner: PublicKey,
  payer: PublicKey,
  tokenProgramId: PublicKey = TOKEN_2022_PROGRAM_ID
): { ata: PublicKey; instruction: TransactionInstruction | null } {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    tokenProgramId
  );

  // Note: We'll check if account exists before adding this instruction
  const instruction = createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    tokenProgramId
  );

  return { ata, instruction };
}

// =============================================================================
// Token Program Detection
// =============================================================================

/**
 * Detect which token program a mint uses by checking the mint account owner.
 * pump.fun tokens created after mid-2024 use Token-2022, but some older tokens
 * or tokens from other sources may use the standard SPL Token program.
 *
 * @returns TOKEN_2022_PROGRAM_ID or TOKEN_PROGRAM_ID
 */
export async function getTokenProgramForMint(
  connection: Connection,
  mint: PublicKey
): Promise<PublicKey> {
  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (!mintInfo) {
      console.warn(`[getTokenProgramForMint] Mint not found: ${mint.toBase58()}, defaulting to Token-2022`);
      return TOKEN_2022_PROGRAM_ID;
    }

    // The mint account owner tells us which token program manages it
    if (mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
      console.log(`[getTokenProgramForMint] Mint ${mint.toBase58()} uses standard SPL Token program`);
      return TOKEN_PROGRAM_ID;
    } else if (mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      console.log(`[getTokenProgramForMint] Mint ${mint.toBase58()} uses Token-2022 program`);
      return TOKEN_2022_PROGRAM_ID;
    } else {
      console.warn(`[getTokenProgramForMint] Unknown mint owner: ${mintInfo.owner.toBase58()}, defaulting to Token-2022`);
      return TOKEN_2022_PROGRAM_ID;
    }
  } catch (error) {
    console.error(`[getTokenProgramForMint] Error detecting token program for ${mint.toBase58()}:`, error);
    // Default to Token-2022 as most pump.fun tokens use it
    return TOKEN_2022_PROGRAM_ID;
  }
}

// =============================================================================
// Transaction Building Functions
// =============================================================================

export interface PumpFunBuyParams {
  mint: PublicKey;
  solAmount: bigint;
  minTokensOut: bigint;
  slippageBps?: number;
  priorityFeeSol?: number;
}

export interface PumpFunSellParams {
  mint: PublicKey;
  tokenAmount: bigint;
  minSolOut: bigint;
  slippageBps?: number;
  priorityFeeSol?: number;
  programId?: PublicKey;  // AUDIT FIX: For pump.pro support
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
   * AUDIT FIX: Added programId parameter for pump.pro support
   */
  async getBondingCurveState(mint: PublicKey, programId: PublicKey = PUMP_FUN_PROGRAM): Promise<BondingCurveState | null> {
    try {
      // AUDIT FIX: Use program-agnostic PDA derivation for pump.pro support
      const [bondingCurve] = deriveBondingCurvePDAForProgram(mint, programId);
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
   * AUDIT FIX: Detects correct token program (Token-2022 or SPL Token) dynamically
   */
  async buy(params: PumpFunBuyParams): Promise<PumpFunTradeResult> {
    // Clamp slippage to 99% max (9900 bps) to prevent negative minTokens calculation
    // At 100% slippage, minTokens = 0 which is valid but useless
    const effectiveSlippageBps = Math.min(params.slippageBps ?? 500, 9900);
    const { mint, solAmount, minTokensOut, priorityFeeSol } = params;

    console.log(`[PumpFunClient] Buying with ${lamportsToSol(solAmount)} SOL, slippage: ${effectiveSlippageBps}bps, priorityFee: ${priorityFeeSol ?? 'default'} SOL`);

    // AUDIT FIX: Detect which token program the mint uses (Token-2022 or standard SPL)
    // Most pump.fun tokens use Token-2022, but some older tokens may use standard SPL
    const tokenProgramId = await getTokenProgramForMint(this.connection, mint);

    // Derive PDAs
    const [bondingCurve] = deriveBondingCurvePDA(mint);
    const associatedBondingCurve = await deriveAssociatedBondingCurve(bondingCurve, mint, tokenProgramId);
    // AUDIT FIX: Use detected token program for ATA derivation
    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      this.wallet.publicKey,
      false,
      tokenProgramId
    );

    // Derive volume accumulator PDAs (required since August 2025 pump.fun update)
    const [globalVolumeAccumulator] = deriveGlobalVolumeAccumulatorPDA();
    const [userVolumeAccumulator] = deriveUserVolumeAccumulatorPDA(this.wallet.publicKey);

    // Derive fee config PDA (required since September 2025 pump.fun update)
    const { global, feeRecipient, eventAuthority, feeProgram } = getProgramAccounts(PUMP_FUN_PROGRAM);
    const [feeConfig] = deriveFeeConfigPDA(PUMP_FUN_PROGRAM, feeProgram);

    // Get bonding curve state for calculation
    const state = await this.getBondingCurveState(mint);
    if (!state) {
      throw new Error('Token not found on bonding curve');
    }
    if (state.complete) {
      throw new Error('Token has graduated - use Jupiter instead');
    }

    // Derive creator vault PDA (required since late 2025 pump.fun update)
    // This replaced SysvarRent in the account list
    const [creatorVault] = deriveCreatorVaultPDA(new PublicKey(state.creator));

    // Calculate expected tokens
    const expectedTokens = calculateBuyOutput(
      solAmount,
      state.virtualSolReserves,
      state.virtualTokenReserves
    );

    // Fail early if calculation returned 0 (indicates corrupted bonding curve state)
    if (expectedTokens <= 0n) {
      throw new Error(
        `Bonding curve calculation failed: expectedTokens=${expectedTokens}. ` +
        `State may be corrupted or token may have graduated.`
      );
    }

    // Apply slippage (using clamped effectiveSlippageBps)
    const minTokens = minTokensOut > 0n
      ? minTokensOut
      : (expectedTokens * BigInt(10000 - effectiveSlippageBps)) / 10000n;

    // Build transaction
    const transaction = new Transaction();

    // Add priority fee for faster inclusion
    // Convert priorityFeeSol to microLamports/CU: (SOL * LAMPORTS_PER_SOL / CU) * 1e6
    // With 200k CU: microLamports = priorityFeeSol * 5_000_000_000
    const computeUnits = 200000;
    const microLamports = priorityFeeSol
      ? Math.floor(priorityFeeSol * LAMPORTS_PER_SOL * 1_000_000 / computeUnits)
      : 100000; // Default ~0.00002 SOL
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
    );

    // Check if user token account exists, if not create it
    // AUDIT FIX: Use detected token program for ATA creation
    const userATAInfo = await this.connection.getAccountInfo(userTokenAccount);
    if (!userATAInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          this.wallet.publicKey,
          userTokenAccount,
          this.wallet.publicKey,
          mint,
          tokenProgramId
        )
      );
    }

    // Build buy instruction
    // SECURITY: P0-4 - Use minTokens (with slippage) instead of expectedTokens
    // This protects against MEV sandwich attacks by setting a minimum acceptable output
    // AUDIT FIX: Use detected tokenProgramId (Token-2022 or SPL Token)
    // Note: Volume accumulator accounts added in August 2025 pump.fun update
    const buyInstruction = new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },  // AUDIT FIX: Use detected token program
        { pubkey: creatorVault, isSigner: false, isWritable: true }, // creator_vault (late 2025 update - replaced SysvarRent)
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
        // Volume accumulator accounts (required since August 2025)
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        // Fee accounts (required since September 2025)
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: feeProgram, isSigner: false, isWritable: false },
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
   * Execute a sell on pump.fun/pump.pro bonding curve
   * AUDIT FIX: Detects correct token program (Token-2022 or SPL Token) dynamically
   * AUDIT FIX: Added programId support for pump.pro tokens
   */
  async sell(params: PumpFunSellParams): Promise<PumpFunTradeResult> {
    // Clamp slippage to 99% max (9900 bps) to prevent negative minSol calculation
    const effectiveSlippageBps = Math.min(params.slippageBps ?? 500, 9900);
    const { mint, tokenAmount, minSolOut, priorityFeeSol, programId } = params;

    // AUDIT FIX: Use provided programId or default to pump.fun
    const effectiveProgram = programId ?? PUMP_FUN_PROGRAM;
    const programName = effectiveProgram.equals(PUMP_PRO_PROGRAM) ? 'pump.pro' : 'pump.fun';

    console.log(`[PumpFunClient] Selling ${tokenAmount} tokens via ${programName}, slippage: ${effectiveSlippageBps}bps, priorityFee: ${priorityFeeSol ?? 'default'} SOL`);

    // AUDIT FIX: Detect which token program the mint uses (Token-2022 or standard SPL)
    // This is critical because some tokens may use the standard SPL Token program
    // while most pump.fun tokens use Token-2022
    const tokenProgramId = await getTokenProgramForMint(this.connection, mint);

    // AUDIT FIX: Derive PDAs using program-agnostic function for pump.pro support
    const [bondingCurve] = deriveBondingCurvePDAForProgram(mint, effectiveProgram);
    const associatedBondingCurve = await deriveAssociatedBondingCurve(bondingCurve, mint, tokenProgramId);
    // AUDIT FIX: Use detected token program for ATA derivation
    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      this.wallet.publicKey,
      false,
      tokenProgramId
    );

    // AUDIT FIX: Derive volume accumulator PDAs using effectiveProgram for pump.pro support
    const [globalVolumeAccumulator] = deriveGlobalVolumeAccumulatorPDA(effectiveProgram);
    const [userVolumeAccumulator] = deriveUserVolumeAccumulatorPDA(this.wallet.publicKey, effectiveProgram);

    // AUDIT FIX: Derive fee config PDA using effectiveProgram for pump.pro support
    const { global, feeRecipient, eventAuthority, feeProgram } = getProgramAccounts(effectiveProgram);
    const [feeConfig] = deriveFeeConfigPDA(effectiveProgram, feeProgram);

    // AUDIT FIX: Get bonding curve state using effectiveProgram for pump.pro support
    const state = await this.getBondingCurveState(mint, effectiveProgram);
    if (!state) {
      throw new Error(`Token not found on ${programName} bonding curve`);
    }
    if (state.complete) {
      throw new Error('Token has graduated - use Jupiter instead');
    }

    // AUDIT FIX: Derive creator vault PDA using effectiveProgram for pump.pro support
    const [creatorVault] = deriveCreatorVaultPDA(new PublicKey(state.creator), effectiveProgram);

    // Calculate expected SOL
    const expectedSol = calculateSellOutput(
      tokenAmount,
      state.virtualSolReserves,
      state.virtualTokenReserves
    );

    // Fail early if calculation returned 0 (indicates corrupted bonding curve state)
    if (expectedSol <= 0n) {
      throw new Error(
        `Bonding curve calculation failed: expectedSol=${expectedSol}. ` +
        `State may be corrupted or token may have graduated.`
      );
    }

    // Apply slippage (using clamped effectiveSlippageBps)
    const minSol = minSolOut > 0n
      ? minSolOut
      : (expectedSol * BigInt(10000 - effectiveSlippageBps)) / 10000n;

    // Build transaction
    const transaction = new Transaction();

    // Add priority fee for faster inclusion
    // Convert priorityFeeSol to microLamports/CU: (SOL * LAMPORTS_PER_SOL / CU) * 1e6
    const computeUnits = 200000;
    const microLamports = priorityFeeSol
      ? Math.floor(priorityFeeSol * LAMPORTS_PER_SOL * 1_000_000 / computeUnits)
      : 100000; // Default ~0.00002 SOL
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })
    );

    // Build sell instruction
    // AUDIT FIX: Use effectiveProgram for pump.pro support
    // AUDIT FIX: Use detected tokenProgramId (Token-2022 or SPL Token)
    const sellInstruction = new TransactionInstruction({
      programId: effectiveProgram,  // AUDIT FIX: Use effectiveProgram instead of hardcoded PUMP_FUN_PROGRAM
      keys: [
        { pubkey: global, isSigner: false, isWritable: false },
        { pubkey: feeRecipient, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },  // AUDIT FIX: Use detected token program
        { pubkey: creatorVault, isSigner: false, isWritable: true }, // creator_vault (late 2025 update)
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: effectiveProgram, isSigner: false, isWritable: false },  // AUDIT FIX: Use effectiveProgram
        // Volume accumulator accounts (required since August 2025)
        { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
        { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        // Fee accounts (required since September 2025)
        { pubkey: feeConfig, isSigner: false, isWritable: false },
        { pubkey: feeProgram, isSigner: false, isWritable: false },
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
