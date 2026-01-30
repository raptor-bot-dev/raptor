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
const LABELED_MINT_PATTERNS = [
  // Explicit "Mint:" or "CA:" labels
  /(?:Mint|CA|Contract|Address)[\s:]+([1-9A-HJ-NP-Za-km-z]{32,44})/gi,
];

/**
 * URL patterns that commonly embed the Solana mint address.
 * We intentionally keep the allowlist small and deterministic.
 */
const MINT_URL_PATTERNS = [
  /dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/gi,
  /birdeye\.so\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/gi,
  /solscan\.io\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/gi,
];

const NON_MINT_ADDRESSES = new Set<string>([
  // Common program / placeholder addresses that show up in messages and should not be treated as a token mint.
  '11111111111111111111111111111111', // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token Program
  'So11111111111111111111111111111111111111112', // Wrapped SOL mint
]);

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

function extractUniqueMintFromTextByPatterns(text: string, patterns: RegExp[]): string | null | 'ambiguous' {
  const matches = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match?.[1];
      if (!candidate) continue;
      if (isValidSolanaAddress(candidate)) {
        matches.add(candidate);
      }
    }
  }
  if (matches.size === 0) return null;
  if (matches.size > 1) return 'ambiguous';
  return [...matches][0] ?? null;
}

function extractUniqueMintFromAnyAddress(text: string): string | null | 'ambiguous' {
  const candidates = new Set<string>();
  const re = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const value = match[0];
    if (NON_MINT_ADDRESSES.has(value)) continue;
    if (!isValidSolanaAddress(value)) continue;
    candidates.add(value);
    if (candidates.size > 1) break;
  }

  if (candidates.size === 0) return null;
  if (candidates.size > 1) return 'ambiguous';
  return [...candidates][0] ?? null;
}

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

  // 1a) Prefer explicit labels (Mint/CA/etc).
  const labeled = extractUniqueMintFromTextByPatterns(trimmed, LABELED_MINT_PATTERNS);
  if (labeled === 'ambiguous') {
    return { ok: false, reason: 'ambiguous_mint_candidates', raw: trimmed };
  }
  if (labeled) {
    mint = labeled;
  }

  // 1b) Extract from common token URLs (dexscreener/birdeye/solscan).
  if (!mint) {
    const fromUrl = extractUniqueMintFromTextByPatterns(trimmed, MINT_URL_PATTERNS);
    if (fromUrl === 'ambiguous') {
      return { ok: false, reason: 'ambiguous_mint_candidates', raw: trimmed };
    }
    if (fromUrl) {
      mint = fromUrl;
    }
  }

  // 1c) Fallback: accept exactly one valid Solana address anywhere in the message.
  // If multiple are present, fail-closed to avoid trading the wrong token.
  if (!mint) {
    const fromAny = extractUniqueMintFromAnyAddress(trimmed);
    if (fromAny === 'ambiguous') {
      return { ok: false, reason: 'ambiguous_mint_candidates', raw: trimmed };
    }
    if (fromAny) {
      mint = fromAny;
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
