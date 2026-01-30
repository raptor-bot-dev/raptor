// =============================================================================
// RAPTOR Phase 4: Meteora Parser Tests
// Unit tests for Meteora DBC instruction log parsing
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  parseMeteoraLogs,
  isCreateInstruction,
  extractAddressesFromLogs,
  validateCreateEvent,
  KNOWN_PROGRAM_IDS,
  type MeteoraCreateEvent,
} from '../meteoraParser.js';

// Valid test addresses (real non-program Solana addresses)
const VALID_MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const VALID_BONDING_CURVE = 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq';
const VALID_CREATOR = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

// System accounts (should be filtered)
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const METEORA_DBC = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

describe('isCreateInstruction', () => {
  describe('create patterns', () => {
    it('should detect InitializeVirtualPoolWithSplToken instruction', () => {
      const logs = [
        'Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]',
        'Program log: Instruction: InitializeVirtualPoolWithSplToken',
        'Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN success',
      ];

      expect(isCreateInstruction(logs)).toBe(true);
    });

    it('should detect InitializeVirtualPoolWithToken2022 instruction', () => {
      const logs = [
        'Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]',
        'Program log: Instruction: InitializeVirtualPoolWithToken2022',
        'Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN success',
      ];

      expect(isCreateInstruction(logs)).toBe(true);
    });

    it('should detect InitializeVirtualPool instruction (catch-all)', () => {
      const logs = ['Program log: Instruction: InitializeVirtualPool'];

      expect(isCreateInstruction(logs)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const logs = ['Program log: instruction: initializevirtualpoolwithspltoken'];

      expect(isCreateInstruction(logs)).toBe(true);
    });
  });

  describe('non-create patterns', () => {
    it('should reject Swap instruction', () => {
      const logs = [
        'Program log: Instruction: Swap',
        'Program log: Some other log',
      ];

      expect(isCreateInstruction(logs)).toBe(false);
    });

    it('should reject AddLiquidity instruction', () => {
      const logs = ['Program log: Instruction: AddLiquidity'];

      expect(isCreateInstruction(logs)).toBe(false);
    });

    it('should reject RemoveLiquidity instruction', () => {
      const logs = ['Program log: Instruction: RemoveLiquidity'];

      expect(isCreateInstruction(logs)).toBe(false);
    });

    it('should reject Claim instruction', () => {
      const logs = ['Program log: Instruction: Claim'];

      expect(isCreateInstruction(logs)).toBe(false);
    });

    it('should reject unrelated logs', () => {
      const logs = [
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program log: Transfer complete',
        'Program 11111111111111111111111111111111 success',
      ];

      expect(isCreateInstruction(logs)).toBe(false);
    });

    it('should reject empty logs', () => {
      expect(isCreateInstruction([])).toBe(false);
    });
  });

  describe('mixed-instruction transactions', () => {
    it('should accept create even if Swap appears in the same transaction logs', () => {
      const logs = [
        'Program log: Instruction: Swap',
        'Program log: Instruction: InitializeVirtualPoolWithSplToken',
      ];

      expect(isCreateInstruction(logs)).toBe(true);
    });
  });
});

describe('extractAddressesFromLogs', () => {
  it('should extract valid Solana addresses from logs', () => {
    const logs = [
      `Program log: Mint: ${VALID_MINT}`,
      `Program log: Pool: ${VALID_BONDING_CURVE}`,
      `Program log: Creator: ${VALID_CREATOR}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).toContain(VALID_MINT);
    expect(addresses).toContain(VALID_BONDING_CURVE);
    expect(addresses).toContain(VALID_CREATOR);
    expect(addresses).toHaveLength(3);
  });

  it('should filter out duplicate addresses', () => {
    const logs = [
      `Program log: First: ${VALID_MINT}`,
      `Program log: Second: ${VALID_MINT}`,
      `Program log: Third: ${VALID_MINT}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toBe(VALID_MINT);
  });

  it('should reject addresses with invalid characters', () => {
    const logs = [
      'Program log: Invalid: BagsToken0OIl111111111111111111111111111111', // 0, O, I, l
      `Program log: Valid: ${VALID_MINT}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toBe(VALID_MINT);
  });

  it('should reject addresses that are too short', () => {
    const logs = [
      'Program log: Short: BagsToken111111',
      `Program log: Valid: ${VALID_MINT}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).toHaveLength(1);
  });

  it('should return empty array for logs with no addresses', () => {
    const logs = ['Program log: No addresses here', 'Program log: Just text'];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).toHaveLength(0);
  });

  it('should return empty array for empty logs', () => {
    expect(extractAddressesFromLogs([])).toHaveLength(0);
  });
});

describe('parseMeteoraLogs', () => {
  describe('successful parsing', () => {
    it('should parse create instruction with addresses from logs', () => {
      // Note: The parser extracts addresses in order of appearance
      // We put the expected addresses first to ensure correct extraction
      const logs = [
        `Program log: Pool: ${VALID_BONDING_CURVE}`,
        `Program log: Mint: ${VALID_MINT}`,
        `Program log: Creator: ${VALID_CREATOR}`,
        'Program log: Instruction: InitializeVirtualPoolWithSplToken',
        'Program log: Pool initialized successfully',
      ];

      const result = parseMeteoraLogs(logs);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event.bondingCurve).toBe(VALID_BONDING_CURVE);
        expect(result.event.mint).toBe(VALID_MINT);
        expect(result.event.creator).toBe(VALID_CREATOR);
      }
    });

    it('should use account keys when provided', () => {
      const logs = [
        'Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]',
        'Program log: Instruction: InitializeVirtualPoolWithSplToken',
        'Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN success',
      ];
      const accountKeys = [
        SYSTEM_PROGRAM,
        TOKEN_PROGRAM,
        METEORA_DBC,
        VALID_BONDING_CURVE,
        VALID_MINT,
        VALID_CREATOR,
      ];

      const result = parseMeteoraLogs(logs, accountKeys);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.event.bondingCurve).toBe(VALID_BONDING_CURVE);
        expect(result.event.mint).toBe(VALID_MINT);
        expect(result.event.creator).toBe(VALID_CREATOR);
      }
    });
  });

  describe('parsing failures', () => {
    it('should return not_create_instruction for non-create logs', () => {
      const logs = [
        'Program log: Instruction: Swap',
        'Program log: Swap complete',
      ];

      const result = parseMeteoraLogs(logs);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('not_create_instruction');
      }
    });

    it('should return insufficient_addresses for create with no addresses', () => {
      const logs = [
        'Program log: Instruction: InitializeVirtualPoolWithSplToken',
        'Program log: No addresses in these logs',
      ];

      const result = parseMeteoraLogs(logs);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('insufficient_addresses');
      }
    });

    it('should return insufficient_addresses for create with only one address', () => {
      const logs = [
        'Program log: Instruction: InitializeVirtualPoolWithSplToken',
        `Program log: Only one: ${VALID_MINT}`,
      ];

      const result = parseMeteoraLogs(logs);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('insufficient_addresses');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty logs', () => {
      const result = parseMeteoraLogs([]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('not_create_instruction');
      }
    });

    it('should handle account keys with too few valid accounts', () => {
      const logs = ['Program log: Instruction: InitializeVirtualPoolWithSplToken'];
      const accountKeys = [SYSTEM_PROGRAM, TOKEN_PROGRAM]; // All system accounts

      const result = parseMeteoraLogs(logs, accountKeys);

      // Should fall back to log extraction, which will fail
      expect(result.ok).toBe(false);
    });

    it('should assign addresses heuristically when extracted from logs', () => {
      const logs = [
        'Program log: Instruction: InitializeVirtualPool',
        `First: ${VALID_BONDING_CURVE}`,
        `Second: ${VALID_MINT}`,
        `Third: ${VALID_CREATOR}`,
      ];

      const result = parseMeteoraLogs(logs);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Heuristic: first address is bonding curve, second is mint
        expect(result.event.bondingCurve).toBe(VALID_BONDING_CURVE);
        expect(result.event.mint).toBe(VALID_MINT);
        // Creator is last address
        expect(result.event.creator).toBe(VALID_CREATOR);
      }
    });
  });
});

describe('validateCreateEvent', () => {
  it('should return true for valid event', () => {
    const event: MeteoraCreateEvent = {
      mint: VALID_MINT,
      bondingCurve: VALID_BONDING_CURVE,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(true);
  });

  it('should return false for invalid mint', () => {
    const event: MeteoraCreateEvent = {
      mint: 'invalid',
      bondingCurve: VALID_BONDING_CURVE,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should return false for invalid bonding curve', () => {
    const event: MeteoraCreateEvent = {
      mint: VALID_MINT,
      bondingCurve: 'invalid',
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should return false for invalid creator', () => {
    const event: MeteoraCreateEvent = {
      mint: VALID_MINT,
      bondingCurve: VALID_BONDING_CURVE,
      creator: 'invalid',
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should return false for empty addresses', () => {
    const event: MeteoraCreateEvent = {
      mint: '',
      bondingCurve: '',
      creator: '',
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should reject System Program as mint', () => {
    const event: MeteoraCreateEvent = {
      mint: SYSTEM_PROGRAM,
      bondingCurve: VALID_BONDING_CURVE,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should reject Token Program as mint', () => {
    const event: MeteoraCreateEvent = {
      mint: TOKEN_PROGRAM,
      bondingCurve: VALID_BONDING_CURVE,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should reject ATA Program as creator', () => {
    const event: MeteoraCreateEvent = {
      mint: VALID_MINT,
      bondingCurve: VALID_BONDING_CURVE,
      creator: ATA_PROGRAM,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should reject Compute Budget as bonding curve', () => {
    const event: MeteoraCreateEvent = {
      mint: VALID_MINT,
      bondingCurve: COMPUTE_BUDGET,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should reject Wrapped SOL as mint', () => {
    const event: MeteoraCreateEvent = {
      mint: WRAPPED_SOL,
      bondingCurve: VALID_BONDING_CURVE,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });

  it('should reject when mint equals bondingCurve', () => {
    const event: MeteoraCreateEvent = {
      mint: VALID_MINT,
      bondingCurve: VALID_MINT,
      creator: VALID_CREATOR,
    };

    expect(validateCreateEvent(event)).toBe(false);
  });
});

describe('extractAddressesFromLogs - known program filtering', () => {
  it('should filter out System Program address', () => {
    const logs = [
      `Program log: Account: ${SYSTEM_PROGRAM}`,
      `Program log: Mint: ${VALID_MINT}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).not.toContain(SYSTEM_PROGRAM);
    expect(addresses).toContain(VALID_MINT);
  });

  it('should filter out Token Program address', () => {
    const logs = [
      `Program log: Token: ${TOKEN_PROGRAM}`,
      `Program log: Mint: ${VALID_MINT}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).not.toContain(TOKEN_PROGRAM);
    expect(addresses).toContain(VALID_MINT);
  });

  it('should filter out Compute Budget address', () => {
    const logs = [
      `Program log: Budget: ${COMPUTE_BUDGET}`,
      `Program log: Mint: ${VALID_MINT}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).not.toContain(COMPUTE_BUDGET);
    expect(addresses).toContain(VALID_MINT);
  });

  it('should filter out all known program IDs', () => {
    const programLogs = Array.from(KNOWN_PROGRAM_IDS).map(
      (id) => `Program log: Addr: ${id}`
    );
    const logs = [...programLogs, `Program log: Real: ${VALID_MINT}`];

    const addresses = extractAddressesFromLogs(logs);

    for (const programId of KNOWN_PROGRAM_IDS) {
      expect(addresses).not.toContain(programId);
    }
    expect(addresses).toContain(VALID_MINT);
  });

  it('should return empty when only system programs are present', () => {
    const logs = [
      `Program log: Addr: ${SYSTEM_PROGRAM}`,
      `Program log: Addr: ${TOKEN_PROGRAM}`,
      `Program log: Addr: ${ATA_PROGRAM}`,
    ];

    const addresses = extractAddressesFromLogs(logs);

    expect(addresses).toHaveLength(0);
  });
});
