// =============================================================================
// RAPTOR Phase 4 (F-005b): Meteora DBC Instruction Decoder
// Proper Anchor IDL-based instruction decoding for Meteora Dynamic Bonding Curve
//
// Uses instruction discriminators from the official Meteora DBC IDL:
// https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
//
// This decoder provides accurate create event detection by checking instruction
// data discriminators rather than relying on log pattern matching.
// =============================================================================

import { isValidSolanaAddress } from '@raptor/shared';
import type { MeteoraCreateEvent } from './meteoraParser.js';

/**
 * Known Meteora DBC instruction discriminators
 * Source: MeteoraAg/dynamic-bonding-curve-sdk IDL
 */
export const METEORA_DISCRIMINATORS = {
  /** initialize_virtual_pool_with_spl_token */
  INIT_POOL_SPL: Buffer.from([140, 85, 215, 176, 102, 54, 104, 79]),
  /** initialize_virtual_pool_with_token2022 */
  INIT_POOL_TOKEN2022: Buffer.from([169, 118, 51, 78, 145, 110, 220, 155]),
  /** swap */
  SWAP: Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]),
  /** swap2 */
  SWAP2: Buffer.from([43, 4, 237, 11, 26, 201, 30, 98]),
  /** migrate_meteora_damm */
  MIGRATE_DAMM: Buffer.from([132, 226, 117, 200, 113, 0, 95, 232]),
  /** migration_damm_v2 */
  MIGRATE_DAMM_V2: Buffer.from([35, 73, 25, 50, 219, 103, 43, 203]),
} as const;

/**
 * Meteora DBC Program ID (mainnet)
 */
export const METEORA_DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

/**
 * Pool Authority PDA (constant for DBC program)
 */
export const METEORA_POOL_AUTHORITY = 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM';

/**
 * Token Metadata Program
 */
export const METAPLEX_METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/**
 * Check if instruction data matches a pool initialization discriminator
 */
export function isInitializePoolInstruction(data: Buffer | Uint8Array): boolean {
  if (data.length < 8) return false;

  const discriminator = Buffer.from(data.slice(0, 8));

  return (
    discriminator.equals(METEORA_DISCRIMINATORS.INIT_POOL_SPL) ||
    discriminator.equals(METEORA_DISCRIMINATORS.INIT_POOL_TOKEN2022)
  );
}

/**
 * Check if instruction data matches a swap discriminator
 */
export function isSwapInstruction(data: Buffer | Uint8Array): boolean {
  if (data.length < 8) return false;

  const discriminator = Buffer.from(data.slice(0, 8));

  return (
    discriminator.equals(METEORA_DISCRIMINATORS.SWAP) ||
    discriminator.equals(METEORA_DISCRIMINATORS.SWAP2)
  );
}

/**
 * Check if instruction data matches a migration discriminator
 */
export function isMigrationInstruction(data: Buffer | Uint8Array): boolean {
  if (data.length < 8) return false;

  const discriminator = Buffer.from(data.slice(0, 8));

  return (
    discriminator.equals(METEORA_DISCRIMINATORS.MIGRATE_DAMM) ||
    discriminator.equals(METEORA_DISCRIMINATORS.MIGRATE_DAMM_V2)
  );
}

/**
 * Determine which type of initialization instruction this is
 */
export function getInitPoolType(data: Buffer | Uint8Array): 'spl' | 'token2022' | null {
  if (data.length < 8) return null;

  const discriminator = Buffer.from(data.slice(0, 8));

  if (discriminator.equals(METEORA_DISCRIMINATORS.INIT_POOL_SPL)) {
    return 'spl';
  }
  if (discriminator.equals(METEORA_DISCRIMINATORS.INIT_POOL_TOKEN2022)) {
    return 'token2022';
  }
  return null;
}

/**
 * Account indices for initialize_virtual_pool_with_spl_token/token2022 instruction
 *
 * From Meteora DBC IDL:
 * 0: config (readonly)
 * 1: pool_authority (readonly, PDA)
 * 2: creator (signer)
 * 3: base_mint (writable, signer) <-- This is the new token mint
 * 4: quote_mint (readonly) <-- Usually SOL or WSOL
 * 5: pool (writable) <-- The bonding curve PDA
 * 6: base_vault (writable)
 * 7: quote_vault (writable)
 * 8: mint_metadata (writable)
 * 9: metadata_program
 * 10: payer (writable, signer)
 * 11: token_quote_program
 * 12: token_program
 * 13: system_program
 * 14: event_authority
 * 15: program
 */
export const INIT_POOL_ACCOUNT_INDICES = {
  CONFIG: 0,
  POOL_AUTHORITY: 1,
  CREATOR: 2,
  BASE_MINT: 3,
  QUOTE_MINT: 4,
  POOL: 5,
  BASE_VAULT: 6,
  QUOTE_VAULT: 7,
  MINT_METADATA: 8,
  METADATA_PROGRAM: 9,
  PAYER: 10,
  TOKEN_QUOTE_PROGRAM: 11,
  TOKEN_PROGRAM: 12,
  SYSTEM_PROGRAM: 13,
  EVENT_AUTHORITY: 14,
  PROGRAM: 15,
} as const;

/**
 * Decode a Meteora DBC initialize pool instruction from transaction data
 *
 * @param instructionData - Raw instruction data bytes
 * @param accountKeys - Account keys from the transaction
 * @param programIdIndex - Index of the program ID in accountKeys
 * @param accountIndices - Indices into accountKeys for this instruction's accounts
 * @returns MeteoraCreateEvent if successful, null otherwise
 */
export function decodeInitPoolInstruction(
  instructionData: Buffer | Uint8Array,
  accountKeys: string[],
  accountIndices: number[]
): MeteoraCreateEvent | null {
  // Verify this is an initialize pool instruction
  const poolType = getInitPoolType(instructionData);
  if (!poolType) {
    return null;
  }

  // Need at least the critical account indices
  if (accountIndices.length < 6) {
    console.warn('[MeteoraDecoder] Insufficient account indices for init pool');
    return null;
  }

  // Extract account addresses using indices
  const mintIndex = accountIndices[INIT_POOL_ACCOUNT_INDICES.BASE_MINT];
  const poolIndex = accountIndices[INIT_POOL_ACCOUNT_INDICES.POOL];
  const creatorIndex = accountIndices[INIT_POOL_ACCOUNT_INDICES.CREATOR];

  if (
    mintIndex >= accountKeys.length ||
    poolIndex >= accountKeys.length ||
    creatorIndex >= accountKeys.length
  ) {
    console.warn('[MeteoraDecoder] Account index out of bounds');
    return null;
  }

  const mint = accountKeys[mintIndex];
  const bondingCurve = accountKeys[poolIndex];
  const creator = accountKeys[creatorIndex];

  // Validate addresses
  if (
    !isValidSolanaAddress(mint) ||
    !isValidSolanaAddress(bondingCurve) ||
    !isValidSolanaAddress(creator)
  ) {
    console.warn('[MeteoraDecoder] Invalid address in decoded accounts');
    return null;
  }

  console.log(`[MeteoraDecoder] Decoded init pool (${poolType}):`, {
    mint: mint.slice(0, 12) + '...',
    pool: bondingCurve.slice(0, 12) + '...',
    creator: creator.slice(0, 12) + '...',
  });

  return { mint, bondingCurve, creator };
}

/**
 * Find and decode Meteora DBC initialize pool instruction from a transaction.
 *
 * Scans BOTH top-level instructions AND inner instructions (CPI calls).
 * This is critical for bags.fm launches where the Fee Share program
 * CPI-calls Meteora DBC — the init pool instruction appears as an
 * inner instruction, not top-level.
 *
 * @param transaction - Parsed transaction object with message, instructions, and innerInstructions
 * @returns MeteoraCreateEvent if a create instruction was found, null otherwise
 */
export function findAndDecodeCreateInstruction(
  transaction: {
    message: {
      accountKeys: string[];
      instructions: Array<{
        programIdIndex: number;
        accounts: number[];
        data: string; // Base58-encoded instruction data
      }>;
      innerInstructions?: Array<{
        programIdIndex: number;
        accounts: number[];
        data: string;
      }>;
    };
  },
  programId: string = METEORA_DBC_PROGRAM_ID
): MeteoraCreateEvent | null {
  const { accountKeys, instructions, innerInstructions } = transaction.message;

  console.log(`[MeteoraDecoder] findAndDecode: ${instructions.length} top-level ixs, ${innerInstructions?.length || 0} inner ixs, ${accountKeys.length} keys`);

  // Helper: try to decode a single instruction
  const tryDecodeInstruction = (ix: {
    programIdIndex: number;
    accounts: number[];
    data: string;
  }, label: string): MeteoraCreateEvent | null => {
    const ixProgramId = accountKeys[ix.programIdIndex];
    if (ixProgramId !== programId) {
      return null;
    }

    console.log(`[MeteoraDecoder] ${label}: matched DBC program, data=${ix.data.slice(0, 20)}..., accounts=${ix.accounts.length}`);

    // Decode base58 instruction data
    let data: Buffer;
    try {
      data = Buffer.from(decodeBase58(ix.data));
    } catch {
      console.warn('[MeteoraDecoder] Failed to decode instruction data');
      return null;
    }

    // Check if this is an init pool instruction
    const isInit = isInitializePoolInstruction(data);
    console.log(`[MeteoraDecoder] ${label}: first8=[${Array.from(data.slice(0, 8)).join(',')}], isInit=${isInit}`);
    if (isInit) {
      return decodeInitPoolInstruction(data, accountKeys, ix.accounts);
    }

    return null;
  };

  // Pass 1: Scan top-level instructions
  for (let i = 0; i < instructions.length; i++) {
    const event = tryDecodeInstruction(instructions[i], `top[${i}]`);
    if (event) {
      return event;
    }
  }

  // Pass 2: Scan inner instructions (CPI calls)
  // Bags.fm launches invoke Meteora DBC via CPI through their Fee Share program,
  // so the initializeVirtualPool instruction appears here, not top-level.
  if (innerInstructions && innerInstructions.length > 0) {
    for (let i = 0; i < innerInstructions.length; i++) {
      const event = tryDecodeInstruction(innerInstructions[i], `inner[${i}]`);
      if (event) {
        console.log('[MeteoraDecoder] Found init pool in inner instruction (CPI)');
        return event;
      }
    }
  }

  return null;
}

/**
 * Simple base58 decoder (Solana style)
 * For production, consider using @solana/web3.js bs58
 */
function decodeBase58(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = 58;

  if (str.length === 0) return new Uint8Array(0);

  // Count leading zeros
  let leadingZeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    leadingZeros++;
  }

  // Decode
  const bytes: number[] = [];
  for (let i = leadingZeros; i < str.length; i++) {
    const charIndex = ALPHABET.indexOf(str[i]);
    if (charIndex === -1) {
      throw new Error(`Invalid base58 character: ${str[i]}`);
    }

    let carry = charIndex;
    for (let j = bytes.length - 1; j >= 0; j--) {
      carry += bytes[j] * BASE;
      bytes[j] = carry % 256;
      carry = Math.floor(carry / 256);
    }

    while (carry > 0) {
      bytes.unshift(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }

  // Add leading zeros
  const result = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[leadingZeros + i] = bytes[i];
  }

  return result;
}

/**
 * Validate that a decoded event has the expected account relationships
 * Additional heuristic validation to reduce false positives
 */
export function validateDecodedEvent(event: MeteoraCreateEvent): boolean {
  // Basic address validation
  if (
    !isValidSolanaAddress(event.mint) ||
    !isValidSolanaAddress(event.bondingCurve) ||
    !isValidSolanaAddress(event.creator)
  ) {
    return false;
  }

  // Mint should not equal pool (they're different accounts)
  if (event.mint === event.bondingCurve) {
    return false;
  }

  // Creator should not be a system program
  const SYSTEM_PROGRAMS = [
    '11111111111111111111111111111111',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    METEORA_DBC_PROGRAM_ID,
    METEORA_POOL_AUTHORITY,
    METAPLEX_METADATA_PROGRAM,
  ];

  if (SYSTEM_PROGRAMS.includes(event.creator)) {
    return false;
  }

  return true;
}
