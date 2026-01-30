// =============================================================================
// RAPTOR Phase 1: Bags Parser Tests
// Unit tests for deterministic Telegram message parsing
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseBagsMessage, isValidMintAddress, type BagsParseResult } from '../bagsParser.js';

// Valid test addresses (base58, decode to 32 bytes)
const VALID_MINT = 'So11111111111111111111111111111111111111112';
const VALID_MINT_2 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const VALID_MINT_3 = 'Es9vMFrzaCERmJfrF4H2FY2qg7xE5Kq1d9Y9ycYzaqj';

// Invalid addresses
const INVALID_MINT_TOO_SHORT = 'So1111';
const INVALID_MINT_BAD_CHARS = 'BagsToken0OIl111111111111111111111111111111'; // Contains 0, O, I, l

describe('parseBagsMessage', () => {
  describe('valid signals', () => {
    it('should parse message with explicit Mint: label', () => {
      const text = `🚀 New Launch: $BAGS
Mint: ${VALID_MINT}
Name: Bags Test Token`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT);
        expect(result.candidate.symbol).toBe('BAGS');
        expect(result.candidate.name).toBe('Bags Test Token');
        expect(result.candidate.raw).toBe(text);
      }
    });

    it('should parse message with CA: label', () => {
      const text = `New token alert!
CA: ${VALID_MINT}
$TEST token`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT);
        expect(result.candidate.symbol).toBe('TEST');
      }
    });

    it('should parse message with Contract: label', () => {
      const text = `Contract: ${VALID_MINT}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT);
      }
    });

    it('should parse standalone mint address on its own line', () => {
      const text = `New launch detected
${VALID_MINT_2}
Get in early!`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT_2);
      }
    });

    it('should parse mint from a dexscreener URL', () => {
      const text = `Dexscreener: https://dexscreener.com/solana/${VALID_MINT_2}
$URL`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT_2);
        expect(result.candidate.symbol).toBe('URL');
      }
    });

    it('should parse mint from a Solscan token URL', () => {
      const text = `Solscan https://solscan.io/token/${VALID_MINT_2}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT_2);
      }
    });

    it('should parse mint from a Birdeye token URL', () => {
      const text = `Birdeye: https://birdeye.so/token/${VALID_MINT_2}?chain=solana`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT_2);
      }
    });

    it('should extract symbol from $SYMBOL format', () => {
      const text = `$MOON token launched!
Mint: ${VALID_MINT}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.symbol).toBe('MOON');
      }
    });

    it('should extract symbol from (SYMBOL) format', () => {
      const text = `Token (PEPE) is live!
Mint: ${VALID_MINT}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.symbol).toBe('PEPE');
      }
    });

    it('should normalize symbol to uppercase', () => {
      const text = `$lower token
Mint: ${VALID_MINT}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.symbol).toBe('LOWER');
      }
    });

    it('should extract name from Name: label', () => {
      const text = `Mint: ${VALID_MINT}
Name: Super Cool Token`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.name).toBe('Super Cool Token');
      }
    });

    it('should handle missing optional fields gracefully', () => {
      const text = `Mint: ${VALID_MINT}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT);
        expect(result.candidate.symbol).toBeNull();
        expect(result.candidate.name).toBeNull();
      }
    });

    it('should use provided timestamp', () => {
      const text = `Mint: ${VALID_MINT}`;
      const timestamp = 1700000000000;

      const result = parseBagsMessage(text, timestamp);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.timestamp).toBe(timestamp);
      }
    });

    it('should default to current time if no timestamp provided', () => {
      const text = `Mint: ${VALID_MINT}`;
      const before = Date.now();
      const result = parseBagsMessage(text);
      const after = Date.now();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.timestamp).toBeGreaterThanOrEqual(before);
        expect(result.candidate.timestamp).toBeLessThanOrEqual(after);
      }
    });
  });

  describe('invalid signals', () => {
    it('should reject empty message', () => {
      const result = parseBagsMessage('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('empty_message');
        expect(result.raw).toBe('');
      }
    });

    it('should reject whitespace-only message', () => {
      const result = parseBagsMessage('   \n\t  ');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('empty_message');
      }
    });

    it('should reject null/undefined message', () => {
      const result = parseBagsMessage(null as unknown as string);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('empty_message');
      }
    });

    it('should reject message too short for mint', () => {
      const result = parseBagsMessage('Short message');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('message_too_short');
        expect(result.raw).toBe('Short message');
      }
    });

    it('should reject message with no valid mint address', () => {
      const text = `Check out this new token!
It's going to moon!
Buy now!`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('no_valid_mint');
      }
    });

    it('should reject message with too-short mint address', () => {
      // Message must be 32+ chars to pass length check, but mint is invalid
      const text = `New token launch detected today!
Mint: ${INVALID_MINT_TOO_SHORT}
Get in early!`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('no_valid_mint');
      }
    });

    it('should reject message with invalid base58 characters in mint', () => {
      const text = `Mint: ${INVALID_MINT_BAD_CHARS}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('no_valid_mint');
      }
    });

    it('should fail closed if multiple mint candidates exist without a clear label', () => {
      const text = `New token
${VALID_MINT_2}
${VALID_MINT_3}
Get in early!`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('ambiguous_mint_candidates');
      }
    });
  });

  describe('channel noise filtering', () => {
    it('should reject promotional messages without mint', () => {
      const text = `🚀🚀🚀 JOIN OUR TELEGRAM 🚀🚀🚀
Best signals in the game!
Follow @bagsfm for more`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('no_valid_mint');
      }
    });

    it('should reject admin announcements', () => {
      const text = `📢 ANNOUNCEMENT 📢
We're upgrading our systems. Stay tuned for more signals!`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
    });

    it('should reject messages with URL-like patterns but no mint', () => {
      const text = `Check out https://bags.fm/token/example
Great project with huge potential!`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple addresses - take first valid one', () => {
      const text = `Mint: ${VALID_MINT}
Also check: ${VALID_MINT_2}`;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.mint).toBe(VALID_MINT);
      }
    });

    it('should preserve raw message in result', () => {
      const text = `  Some signal with spaces
Mint: ${VALID_MINT}
Extra line  `;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.raw).toBe(text.trim());
      }
    });

    it('should handle various whitespace around mint label', () => {
      const variations = [
        `Mint:${VALID_MINT}`,
        `Mint: ${VALID_MINT}`,
        `Mint:  ${VALID_MINT}`,
        `Mint:\t${VALID_MINT}`,
      ];

      for (const text of variations) {
        const result = parseBagsMessage(text);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.candidate.mint).toBe(VALID_MINT);
        }
      }
    });

    it('should trim name field', () => {
      const text = `Mint: ${VALID_MINT}
Name:   Spaced Name   `;

      const result = parseBagsMessage(text);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.candidate.name).toBe('Spaced Name');
      }
    });
  });
});

describe('isValidMintAddress', () => {
  it('should return true for valid Solana addresses', () => {
    expect(isValidMintAddress(VALID_MINT)).toBe(true);
    expect(isValidMintAddress(VALID_MINT_2)).toBe(true);
  });

  it('should return false for too-short addresses', () => {
    expect(isValidMintAddress(INVALID_MINT_TOO_SHORT)).toBe(false);
  });

  it('should return false for addresses with invalid characters', () => {
    expect(isValidMintAddress(INVALID_MINT_BAD_CHARS)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isValidMintAddress('')).toBe(false);
  });
});
