// =============================================================================
// RAPTOR Phase 1: Bags.fm Signal Parser
// Deterministic parsing of Telegram signals into normalized LaunchCandidates
// =============================================================================

import { isValidSolanaAddress } from '@raptor/shared';

/**
 * Normalized signal extracted from a Bags.fm Telegram message.
 */
export interface BagsSignal {
  mint: string;
  symbol: string | null;
  name: string | null;
  timestamp: number;
  raw: string;
}

/**
 * Parser result type - explicit success or failure per spec.
 * No partial candidates allowed.
 */
export type BagsParseResult =
  | { ok: true; candidate: BagsSignal }
  | { ok: false; reason: string; raw: string };

// =============================================================================
// Regex Patterns
// =============================================================================

/**
 * Primary mint address pattern.
 * Matches: "Mint: <address>" or "CA: <address>" or just a raw base58 address on its own line.
 * Solana addresses are 32-44 characters in base58 alphabet (no 0, O, I, l).
 */
const MINT_PATTERNS = [
  // Explicit "Mint:" or "CA:" labels
  /(?:Mint|CA|Contract|Address)[\s:]+([1-9A-HJ-NP-Za-km-z]{32,44})/i,
  // Standalone base58 address on its own line (fallback)
  /^([1-9A-HJ-NP-Za-km-z]{43,44})$/m,
];

/**
 * Symbol pattern - matches $SYMBOL or (SYMBOL) formats.
 */
const SYMBOL_PATTERNS = [
  /\$([A-Z0-9]{1,10})/i,
  /\(([A-Z0-9]{2,10})\)/i,
  /Symbol[\s:]+([A-Z0-9]{1,10})/i,
];

/**
 * Name pattern - matches "Name: Token Name" format.
 */
const NAME_PATTERNS = [
  /Name[\s:]+([^\n]{1,50})/i,
  /Token[\s:]+([^\n]{1,50})/i,
];

// =============================================================================
// Parser Implementation
// =============================================================================

/**
 * Parse a Bags.fm Telegram message into a normalized signal.
 *
 * Contract (per discovery.md spec):
 * - Returns { ok: true, candidate } on successful parse
 * - Returns { ok: false, reason, raw } on any failure
 * - Never returns partial candidates
 *
 * @param text Raw message text from Telegram
 * @param timestamp Optional timestamp (defaults to now)
 */
export function parseBagsMessage(
  text: string,
  timestamp?: number
): BagsParseResult {
  // Normalize input
  const trimmed = text?.trim() ?? '';
  const now = timestamp ?? Date.now();

  // Guard: empty message
  if (!trimmed) {
    return { ok: false, reason: 'empty_message', raw: '' };
  }

  // Guard: message too short to contain a mint
  if (trimmed.length < 32) {
    return { ok: false, reason: 'message_too_short', raw: trimmed };
  }

  // Step 1: Extract mint address (required)
  let mint: string | null = null;

  for (const pattern of MINT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const candidate = match[1];
      if (isValidSolanaAddress(candidate)) {
        mint = candidate;
        break;
      }
    }
  }

  if (!mint) {
    return { ok: false, reason: 'no_valid_mint', raw: trimmed };
  }

  // Step 2: Extract symbol (optional)
  let symbol: string | null = null;

  for (const pattern of SYMBOL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      symbol = match[1].toUpperCase();
      break;
    }
  }

  // Step 3: Extract name (optional)
  let name: string | null = null;

  for (const pattern of NAME_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      name = match[1].trim();
      break;
    }
  }

  // Success: return normalized signal
  return {
    ok: true,
    candidate: {
      mint,
      symbol,
      name,
      timestamp: now,
      raw: trimmed,
    },
  };
}

/**
 * Validate a mint address without full parsing.
 * Useful for quick pre-checks.
 */
export function isValidMintAddress(address: string): boolean {
  return isValidSolanaAddress(address);
}
