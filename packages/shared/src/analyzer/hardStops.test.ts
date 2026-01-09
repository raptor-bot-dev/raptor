/**
 * Tests for Hard Stops Detection
 */

import { describe, it, expect } from 'vitest';
import {
  checkEVMHardStops,
  checkSolanaHardStops,
  checkHardStops,
  hasHardStop,
  getHardStopsForChain,
  HARD_STOP_DESCRIPTIONS,
  type EVMContractInfo,
  type SolanaTokenInfo,
} from './hardStops.js';

describe('HardStops', () => {
  describe('checkEVMHardStops', () => {
    const cleanEVMToken: EVMContractInfo = {
      isHoneypot: false,
      canPauseTransfers: false,
      hasBlacklist: false,
      isProxy: false,
      isOpenSource: true,
      canChangeBalance: false,
      hasSelfDestruct: false,
      hasHiddenOwner: false,
      hasExternalCall: false,
      hasTradingCooldown: false,
    };

    it('should detect honeypot', () => {
      const info: EVMContractInfo = {
        ...cleanEVMToken,
        isHoneypot: true,
      };

      const result = checkEVMHardStops(info);

      expect(result.triggered).toBe(true);
      expect(result.stops.length).toBeGreaterThan(0);
      expect(hasHardStop(result, 'honeypot')).toBe(true);
    });

    it('should detect transfer pausable', () => {
      const info: EVMContractInfo = {
        ...cleanEVMToken,
        canPauseTransfers: true,
      };

      const result = checkEVMHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'transfer_pausable')).toBe(true);
    });

    it('should detect hidden proxy (proxy + not open source)', () => {
      const info: EVMContractInfo = {
        ...cleanEVMToken,
        isProxy: true,
        isOpenSource: false,
      };

      const result = checkEVMHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'proxy_not_open_source')).toBe(true);
    });

    it('should detect blacklist capability', () => {
      const info: EVMContractInfo = {
        ...cleanEVMToken,
        hasBlacklist: true,
      };

      const result = checkEVMHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'blacklist')).toBe(true);
    });

    it('should detect owner can change balance', () => {
      const info: EVMContractInfo = {
        ...cleanEVMToken,
        canChangeBalance: true,
      };

      const result = checkEVMHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'owner_change_balance')).toBe(true);
    });

    it('should not trigger on proxy with open source', () => {
      const info: EVMContractInfo = {
        ...cleanEVMToken,
        isProxy: true,
        isOpenSource: true,
      };

      const result = checkEVMHardStops(info);

      expect(hasHardStop(result, 'proxy_not_open_source')).toBe(false);
    });

    it('should pass clean EVM token', () => {
      const result = checkEVMHardStops(cleanEVMToken);

      expect(result.triggered).toBe(false);
      expect(result.stops.length).toBe(0);
    });
  });

  describe('checkSolanaHardStops', () => {
    const cleanSolToken: SolanaTokenInfo = {
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      hasPermanentDelegate: false,
      hasCloseAuthority: false,
    };

    it('should detect freeze authority', () => {
      const info: SolanaTokenInfo = {
        ...cleanSolToken,
        hasFreezeAuthority: true,
      };

      const result = checkSolanaHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'freeze_authority')).toBe(true);
    });

    it('should detect mint authority', () => {
      const info: SolanaTokenInfo = {
        ...cleanSolToken,
        hasMintAuthority: true,
      };

      const result = checkSolanaHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'mint_authority')).toBe(true);
    });

    it('should detect permanent delegate', () => {
      const info: SolanaTokenInfo = {
        ...cleanSolToken,
        hasPermanentDelegate: true,
      };

      const result = checkSolanaHardStops(info);

      expect(result.triggered).toBe(true);
      expect(hasHardStop(result, 'permanent_delegate')).toBe(true);
    });

    it('should pass clean Solana token', () => {
      const result = checkSolanaHardStops(cleanSolToken);

      expect(result.triggered).toBe(false);
      expect(result.stops.length).toBe(0);
    });
  });

  describe('checkHardStops (generic)', () => {
    it('should route EVM chains correctly', () => {
      const evmInfo: EVMContractInfo = {
        isHoneypot: true,
        canPauseTransfers: false,
        hasBlacklist: false,
        isProxy: false,
        isOpenSource: true,
        canChangeBalance: false,
        hasSelfDestruct: false,
        hasHiddenOwner: false,
        hasExternalCall: false,
        hasTradingCooldown: false,
      };

      const result = checkHardStops('bsc', evmInfo);
      expect(result.triggered).toBe(true);
    });

    it('should route Solana correctly', () => {
      const solInfo: SolanaTokenInfo = {
        hasFreezeAuthority: true,
        hasMintAuthority: false,
        hasPermanentDelegate: false,
        hasCloseAuthority: false,
      };

      // checkHardStops takes (chain, evmInfo?, solanaInfo?) - Solana info is 3rd arg
      const result = checkHardStops('sol', undefined, solInfo);
      expect(result.triggered).toBe(true);
    });
  });

  describe('Multiple Hard Stops', () => {
    it('should detect multiple issues', () => {
      const info: EVMContractInfo = {
        isHoneypot: true,
        canPauseTransfers: true,
        hasBlacklist: true,
        isProxy: false,
        isOpenSource: true,
        canChangeBalance: true,
        hasSelfDestruct: false,
        hasHiddenOwner: false,
        hasExternalCall: false,
        hasTradingCooldown: false,
      };

      const result = checkEVMHardStops(info);

      expect(result.triggered).toBe(true);
      expect(result.stops.length).toBeGreaterThan(1);
    });
  });

  describe('getHardStopsForChain', () => {
    it('should return EVM hard stops for BSC', () => {
      const stops = getHardStopsForChain('bsc');
      expect(stops.length).toBeGreaterThan(0);
      expect(stops).toContain('honeypot');
    });

    it('should return Solana hard stops for SOL', () => {
      const stops = getHardStopsForChain('sol');
      expect(stops.length).toBeGreaterThan(0);
      expect(stops).toContain('freeze_authority');
    });
  });

  describe('HARD_STOP_DESCRIPTIONS', () => {
    it('should have descriptions for all hard stops', () => {
      expect(HARD_STOP_DESCRIPTIONS).toBeDefined();
      expect(HARD_STOP_DESCRIPTIONS.honeypot).toBeDefined();
      expect(HARD_STOP_DESCRIPTIONS.freeze_authority).toBeDefined();
      expect(typeof HARD_STOP_DESCRIPTIONS.honeypot).toBe('string');
    });
  });
});
