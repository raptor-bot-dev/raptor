// =============================================================================
// RAPTOR Phase 4: Meteora DBC Parser (HEURISTIC — F-005)
// Parses Meteora Dynamic Bonding Curve instruction logs to detect token creates.
//
// WARNING: This parser uses log-pattern regex matching, NOT Anchor IDL
// instruction decoding. It may produce false positives or miss events
// if Meteora changes their log format. Do not enable in production
// without the METEORA_ONCHAIN_ENABLED feature flag.
//
// Proper IDL decoding is tracked as F-005b.
// =============================================================================

import { isValidSolanaAddress } from '@raptor/shared';

/**
 * Known Solana system/infrastructure program IDs that must never be
 * treated as token mints, bonding curves, or creators.
 */
export const KNOWN_PROGRAM_IDS = new Set([
  '11111111111111111111111111111111',                 // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',    // Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',    // Token 2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',   // ATA Program
  'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',    // Meteora DBC Program
  'SysvarRent111111111111111111111111111111111',       // Rent Sysvar
  'Sysvar1111111111111111111111111111111111111',       // Sysvar
  'ComputeBudget111111111111111111111111111111',       // Compute Budget
  'So11111111111111111111111111111111111111112',       // Wrapped SOL
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',    // Metaplex Metadata
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',    // Memo Program
  'Memo1UhkJBfCR6MNBroCUJCQMNahk79PNJ5sk7SYPU8P',   // Memo Program v1
]);

/**
 * Parsed Meteora DBC create event
 */
export interface MeteoraCreateEvent {
  mint: string;
  bondingCurve: string;
  creator: string;
}

/**
 * Result type for parser operations
 */
export type MeteoraParseResult =
  | { ok: true; event: MeteoraCreateEvent }
  | { ok: false; reason: string };

/**
 * Known Meteora DBC instruction patterns
 * These patterns appear in program logs when a new pool is created
 */
const METEORA_CREATE_PATTERNS = [
  // Anchor-generated log lines for Meteora DBC pool initialization
  /(?:Program log:\s*)?Instruction:\s*InitializeVirtualPoolWithSplToken/i,
  /(?:Program log:\s*)?Instruction:\s*InitializeVirtualPoolWithToken2022/i,
  // Catch-all for future variants (still specific to virtual pool init)
  /(?:Program log:\s*)?Instruction:\s*InitializeVirtualPool/i,
];

/**
 * Check if logs indicate a create/initialize event
 */
export function isCreateInstruction(logs: string[]): boolean {
  const logsText = logs.join(' ');

  // Check for create patterns
  for (const pattern of METEORA_CREATE_PATTERNS) {
    if (pattern.test(logsText)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract Solana addresses from log text
 * Returns array of valid base58 addresses found in logs
 */
export function extractAddressesFromLogs(logs: string[]): string[] {
  const addresses: string[] = [];
  const addressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

  for (const log of logs) {
    const matches = log.match(addressRegex);
    if (matches) {
      for (const match of matches) {
        if (isValidSolanaAddress(match) && !KNOWN_PROGRAM_IDS.has(match) && !addresses.includes(match)) {
          addresses.push(match);
        }
      }
    }
  }

  return addresses;
}

/**
 * Try to identify mint, bonding curve, and creator from account list
 *
 * Typical Meteora DBC create instruction account layout:
 * - Account 0: Pool state (PDA)
 * - Account 1: Mint
 * - Account 2-N: Various PDAs, creator, system accounts
 *
 * This is a heuristic - may need refinement based on actual Meteora DBC IDL
 */
export function extractAccountsFromTransaction(
  accountKeys: string[],
  logs: string[]
): MeteoraCreateEvent | null {
  if (accountKeys.length < 3) {
    return null;
  }

  // Filter out system programs and well-known accounts
  const candidateAccounts = accountKeys.filter(
    (addr) => !KNOWN_PROGRAM_IDS.has(addr) && isValidSolanaAddress(addr)
  );

  if (candidateAccounts.length < 2) {
    return null;
  }

  // Heuristic: First non-system account is often the pool/bonding curve
  // Second is often the mint
  // Creator is typically near the end
  const bondingCurve = candidateAccounts[0];
  const mint = candidateAccounts[1];
  const creator = candidateAccounts[candidateAccounts.length - 1];

  // Validate mint looks like a token mint (not a PDA)
  // Mints typically start with certain characters
  if (!isValidSolanaAddress(mint)) {
    return null;
  }

  return {
    mint,
    bondingCurve,
    creator,
  };
}

/**
 * Parse Meteora DBC logs to extract create event data
 *
 * @param logs - Program logs from WebSocket notification
 * @param accountKeys - Optional account keys from transaction (if available)
 * @returns Parse result with event data or error reason
 */
export function parseMeteoraLogs(
  logs: string[],
  accountKeys?: string[]
): MeteoraParseResult {
  // First check if this is a create instruction
  if (!isCreateInstruction(logs)) {
    return { ok: false, reason: 'not_create_instruction' };
  }

  // If we have account keys, try to extract structured data
  if (accountKeys && accountKeys.length > 0) {
    const event = extractAccountsFromTransaction(accountKeys, logs);
    if (event) {
      return { ok: true, event };
    }
  }

  // Fall back to extracting addresses from log text
  const addresses = extractAddressesFromLogs(logs);
  if (addresses.length < 2) {
    return { ok: false, reason: 'insufficient_addresses' };
  }

  // Use heuristics for address assignment
  return {
    ok: true,
    event: {
      mint: addresses[1] || addresses[0],
      bondingCurve: addresses[0],
      creator: addresses[addresses.length - 1] || addresses[0],
    },
  };
}

/**
 * Validate a MeteoraCreateEvent
 */
export function validateCreateEvent(event: MeteoraCreateEvent): boolean {
  return (
    isValidSolanaAddress(event.mint) &&
    isValidSolanaAddress(event.bondingCurve) &&
    isValidSolanaAddress(event.creator) &&
    !KNOWN_PROGRAM_IDS.has(event.mint) &&
    !KNOWN_PROGRAM_IDS.has(event.bondingCurve) &&
    !KNOWN_PROGRAM_IDS.has(event.creator) &&
    event.mint !== event.bondingCurve &&
    event.mint !== event.creator
  );
}
