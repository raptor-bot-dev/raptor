import { describe, it, expect } from 'vitest';
import {
  METEORA_DISCRIMINATORS,
  METEORA_DBC_PROGRAM_ID,
  isInitializePoolInstruction,
  isSwapInstruction,
  isMigrationInstruction,
  getInitPoolType,
  findAndDecodeCreateInstruction,
  validateDecodedEvent,
} from '../meteoraInstructionDecoder.js';

describe('meteoraInstructionDecoder', () => {
  describe('discriminator matching', () => {
    it('should detect initialize_virtual_pool_with_spl_token instruction', () => {
      const data = Buffer.concat([
        METEORA_DISCRIMINATORS.INIT_POOL_SPL,
        Buffer.alloc(32), // Additional instruction data
      ]);

      expect(isInitializePoolInstruction(data)).toBe(true);
      expect(getInitPoolType(data)).toBe('spl');
      expect(isSwapInstruction(data)).toBe(false);
    });

    it('should detect initialize_virtual_pool_with_token2022 instruction', () => {
      const data = Buffer.concat([
        METEORA_DISCRIMINATORS.INIT_POOL_TOKEN2022,
        Buffer.alloc(32),
      ]);

      expect(isInitializePoolInstruction(data)).toBe(true);
      expect(getInitPoolType(data)).toBe('token2022');
      expect(isSwapInstruction(data)).toBe(false);
    });

    it('should detect swap instruction', () => {
      const data = Buffer.concat([
        METEORA_DISCRIMINATORS.SWAP,
        Buffer.alloc(32),
      ]);

      expect(isSwapInstruction(data)).toBe(true);
      expect(isInitializePoolInstruction(data)).toBe(false);
    });

    it('should detect swap2 instruction', () => {
      const data = Buffer.concat([
        METEORA_DISCRIMINATORS.SWAP2,
        Buffer.alloc(32),
      ]);

      expect(isSwapInstruction(data)).toBe(true);
      expect(isInitializePoolInstruction(data)).toBe(false);
    });

    it('should detect migration instructions', () => {
      const dataV1 = Buffer.concat([
        METEORA_DISCRIMINATORS.MIGRATE_DAMM,
        Buffer.alloc(32),
      ]);
      const dataV2 = Buffer.concat([
        METEORA_DISCRIMINATORS.MIGRATE_DAMM_V2,
        Buffer.alloc(32),
      ]);

      expect(isMigrationInstruction(dataV1)).toBe(true);
      expect(isMigrationInstruction(dataV2)).toBe(true);
      expect(isInitializePoolInstruction(dataV1)).toBe(false);
    });

    it('should reject unknown discriminators', () => {
      const unknownData = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      expect(isInitializePoolInstruction(unknownData)).toBe(false);
      expect(isSwapInstruction(unknownData)).toBe(false);
      expect(isMigrationInstruction(unknownData)).toBe(false);
      expect(getInitPoolType(unknownData)).toBe(null);
    });

    it('should reject data shorter than 8 bytes', () => {
      const shortData = Buffer.from([140, 85, 215, 176]); // Only 4 bytes

      expect(isInitializePoolInstruction(shortData)).toBe(false);
      expect(getInitPoolType(shortData)).toBe(null);
    });
  });

  describe('validateDecodedEvent', () => {
    it('should accept valid event', () => {
      const event = {
        mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
        bondingCurve: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        creator: '9WzDXwBbmPELPRCheThSFdwpTTcy2cHt5Rd8xVx8FkQ3',
      };

      expect(validateDecodedEvent(event)).toBe(true);
    });

    it('should reject invalid mint address', () => {
      const event = {
        mint: 'invalid-address',
        bondingCurve: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        creator: '9WzDXwBbmPELPRCheThSFdwpTTcy2cHt5Rd8xVx8FkQ3',
      };

      expect(validateDecodedEvent(event)).toBe(false);
    });

    it('should reject when mint equals bondingCurve', () => {
      const event = {
        mint: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        bondingCurve: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        creator: '9WzDXwBbmPELPRCheThSFdwpTTcy2cHt5Rd8xVx8FkQ3',
      };

      expect(validateDecodedEvent(event)).toBe(false);
    });

    it('should reject system program as creator', () => {
      const event = {
        mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
        bondingCurve: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        creator: '11111111111111111111111111111111', // System Program
      };

      expect(validateDecodedEvent(event)).toBe(false);
    });

    it('should reject Token Program as creator', () => {
      const event = {
        mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
        bondingCurve: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        creator: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      };

      expect(validateDecodedEvent(event)).toBe(false);
    });

    it('should reject DBC Program ID as creator', () => {
      const event = {
        mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
        bondingCurve: 'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p',
        creator: 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN',
      };

      expect(validateDecodedEvent(event)).toBe(false);
    });
  });

  describe('discriminator values', () => {
    it('should have correct byte values for INIT_POOL_SPL', () => {
      expect(Array.from(METEORA_DISCRIMINATORS.INIT_POOL_SPL)).toEqual([
        140, 85, 215, 176, 102, 54, 104, 79,
      ]);
    });

    it('should have correct byte values for INIT_POOL_TOKEN2022', () => {
      expect(Array.from(METEORA_DISCRIMINATORS.INIT_POOL_TOKEN2022)).toEqual([
        169, 118, 51, 78, 145, 110, 220, 155,
      ]);
    });
  });

  describe('findAndDecodeCreateInstruction — CPI inner instructions', () => {
    // Simulates a bags.fm launch where the Fee Share program CPI-calls Meteora DBC.
    // The init pool instruction is in innerInstructions, not top-level.

    // Helper: base58-encode bytes (matches the decoder's expectation)
    function encodeBase58(bytes: Uint8Array): string {
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      if (bytes.length === 0) return '';
      let num = BigInt(0);
      for (const b of bytes) {
        num = num * 256n + BigInt(b);
      }
      let encoded = '';
      while (num > 0n) {
        const remainder = Number(num % 58n);
        num = num / 58n;
        encoded = ALPHABET[remainder] + encoded;
      }
      // Leading zeros
      for (const b of bytes) {
        if (b !== 0) break;
        encoded = '1' + encoded;
      }
      return encoded;
    }

    // Build a fake init pool instruction data (discriminator + padding)
    const initPoolData = Buffer.concat([
      METEORA_DISCRIMINATORS.INIT_POOL_SPL,
      Buffer.alloc(64), // params
    ]);
    const initPoolDataB58 = encodeBase58(initPoolData);

    // Swap discriminator data (should NOT match)
    const swapData = Buffer.concat([
      METEORA_DISCRIMINATORS.SWAP,
      Buffer.alloc(32),
    ]);
    const swapDataB58 = encodeBase58(swapData);

    // Account keys: [0]=config, [1]=poolAuthority, [2]=creator, [3]=baseMint, [4]=quoteMint, [5]=pool, ...
    const accountKeys = [
      '7nYBuL3wPMcsHE1XGfHFRXjMSmNa9igf9pMQTFjwSQM9', // 0: config
      'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM', // 1: pool authority
      '9WzDXwBbmPELPRCheThSFdwpTTcy2cHt5Rd8xVx8FkQ3', // 2: creator
      '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // 3: base mint (new token)
      'So11111111111111111111111111111111111111112',      // 4: quote mint (SOL)
      'BSwp6bEBihVLdqJRKGgzjcGLHkcTuzmSo1TQkHepzH8p', // 5: pool (bonding curve)
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // 6: ATA program
      '11111111111111111111111111111111',                 // 7: system
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',    // 8: token program
      METEORA_DBC_PROGRAM_ID,                             // 9: DBC program
      'FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK',  // 10: Bags Fee Share v2
    ];

    it('should find init pool in top-level instructions', () => {
      const tx = {
        message: {
          accountKeys,
          instructions: [
            {
              programIdIndex: 9, // DBC program
              accounts: [0, 1, 2, 3, 4, 5],
              data: initPoolDataB58,
            },
          ],
          innerInstructions: [],
        },
      };

      const event = findAndDecodeCreateInstruction(tx, METEORA_DBC_PROGRAM_ID);
      expect(event).not.toBeNull();
      expect(event!.mint).toBe(accountKeys[3]);       // base mint
      expect(event!.creator).toBe(accountKeys[2]);     // creator
      expect(event!.bondingCurve).toBe(accountKeys[5]); // pool
    });

    it('should find init pool in inner instructions (CPI from Bags Fee Share)', () => {
      // Top-level: only the Bags Fee Share program call (not Meteora DBC)
      // Inner: Meteora DBC init pool as CPI
      const tx = {
        message: {
          accountKeys,
          instructions: [
            {
              programIdIndex: 10, // Bags Fee Share program (top-level)
              accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
              data: swapDataB58, // irrelevant data for the fee share call
            },
          ],
          innerInstructions: [
            {
              programIdIndex: 9, // Meteora DBC program (CPI)
              accounts: [0, 1, 2, 3, 4, 5],
              data: initPoolDataB58,
            },
          ],
        },
      };

      const event = findAndDecodeCreateInstruction(tx, METEORA_DBC_PROGRAM_ID);
      expect(event).not.toBeNull();
      expect(event!.mint).toBe(accountKeys[3]);
      expect(event!.creator).toBe(accountKeys[2]);
      expect(event!.bondingCurve).toBe(accountKeys[5]);
    });

    it('should return null when no init pool exists in either level', () => {
      const tx = {
        message: {
          accountKeys,
          instructions: [
            {
              programIdIndex: 9, // DBC program but SWAP, not init
              accounts: [0, 1, 2, 3, 4, 5],
              data: swapDataB58,
            },
          ],
          innerInstructions: [
            {
              programIdIndex: 8, // Token program, not DBC
              accounts: [0, 1],
              data: swapDataB58,
            },
          ],
        },
      };

      const event = findAndDecodeCreateInstruction(tx, METEORA_DBC_PROGRAM_ID);
      expect(event).toBeNull();
    });

    it('should work when innerInstructions is undefined (backwards compat)', () => {
      const tx = {
        message: {
          accountKeys,
          instructions: [
            {
              programIdIndex: 10, // Not DBC
              accounts: [0, 1, 2],
              data: swapDataB58,
            },
          ],
          // No innerInstructions field at all
        },
      };

      const event = findAndDecodeCreateInstruction(tx, METEORA_DBC_PROGRAM_ID);
      expect(event).toBeNull();
    });
  });
});
