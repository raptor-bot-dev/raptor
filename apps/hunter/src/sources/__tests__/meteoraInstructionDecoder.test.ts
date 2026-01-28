import { describe, it, expect } from 'vitest';
import {
  METEORA_DISCRIMINATORS,
  isInitializePoolInstruction,
  isSwapInstruction,
  isMigrationInstruction,
  getInitPoolType,
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
});
