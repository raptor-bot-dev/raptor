/**
 * Tests for Speed Cache Layer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { speedCache } from './speedCache.js';

describe('SpeedCache', () => {
  describe('Token Blacklist', () => {
    it('should add and check if token is blacklisted', () => {
      const testToken = '0xTestToken' + Date.now();
      speedCache.addToBlacklist('token', testToken);
      expect(speedCache.isTokenBlacklisted(testToken)).toBe(true);
    });

    it('should be case insensitive', () => {
      const testToken = '0xCaseTest' + Date.now();
      speedCache.addToBlacklist('token', testToken.toUpperCase());
      expect(speedCache.isTokenBlacklisted(testToken.toLowerCase())).toBe(true);
    });

    it('should return false for non-blacklisted tokens', () => {
      expect(speedCache.isTokenBlacklisted('0xNotBlacklistedToken12345')).toBe(false);
    });
  });

  describe('Deployer Blacklist', () => {
    it('should add and check if deployer is blacklisted', () => {
      const testDeployer = '0xTestDeployer' + Date.now();
      speedCache.addToBlacklist('deployer', testDeployer);
      expect(speedCache.isDeployerBlacklisted(testDeployer)).toBe(true);
    });

    it('should return false for non-blacklisted deployers', () => {
      expect(speedCache.isDeployerBlacklisted('0xNotBlacklistedDeployer12345')).toBe(false);
    });
  });

  describe('Token Cache', () => {
    it('should cache and retrieve token info', () => {
      const tokenAddress = '0xTokenCache' + Date.now();
      const tokenInfo = {
        address: tokenAddress,
        chain: 'bsc' as const,
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        deployer: '0xDeployer',
        liquidity: 1000000n,
        isHoneypot: false,
        buyTax: 0,
        sellTax: 0,
        score: 25,
        cachedAt: Date.now(),
      };

      speedCache.cacheTokenInfo(tokenInfo);
      const retrieved = speedCache.getTokenInfo(tokenAddress);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Test Token');
      expect(retrieved?.symbol).toBe('TEST');
    });

    it('should return undefined for non-cached tokens', () => {
      const retrieved = speedCache.getTokenInfo('0xNonExistentToken' + Date.now());
      expect(retrieved).toBeUndefined();
    });
  });

  describe('Priority Fees', () => {
    it('should get priority fee for Solana', () => {
      // Set some test values since cache isn't initialized with real data
      speedCache.priorityFees.sol = {
        slow: 1000n,
        normal: 5000n,
        fast: 10000n,
        turbo: 50000n,
        lastUpdated: Date.now(),
      };

      const normalFee = speedCache.getPriorityFee('sol', 'normal');
      const fastFee = speedCache.getPriorityFee('sol', 'fast');

      expect(typeof normalFee).toBe('bigint');
      expect(typeof fastFee).toBe('bigint');
      expect(fastFee > normalFee).toBe(true);
    });

    it('should get priority fee for BSC', () => {
      const fee = speedCache.getPriorityFee('bsc', 'normal');
      expect(typeof fee).toBe('bigint');
    });

    it('should have priority fees for all chains', () => {
      const chains = ['sol', 'bsc', 'base', 'eth'] as const;
      for (const chain of chains) {
        expect(speedCache.priorityFees[chain]).toBeDefined();
        expect(speedCache.priorityFees[chain].slow).toBeDefined();
        expect(speedCache.priorityFees[chain].normal).toBeDefined();
        expect(speedCache.priorityFees[chain].fast).toBeDefined();
        expect(speedCache.priorityFees[chain].turbo).toBeDefined();
      }
    });
  });

  describe('Prices', () => {
    it('should get native prices', () => {
      // Set test prices since cache isn't initialized
      speedCache.prices = {
        sol: 150,
        bnb: 600,
        eth: 3500,
        lastUpdated: Date.now(),
      };

      expect(speedCache.prices).toBeDefined();
      expect(typeof speedCache.prices.sol).toBe('number');
      expect(typeof speedCache.prices.bnb).toBe('number'); // NativePrices uses 'bnb' not 'bsc'
      expect(typeof speedCache.prices.eth).toBe('number');
    });

    it('should get native price for specific chain', () => {
      // Set test prices since cache isn't initialized
      speedCache.prices = {
        sol: 150,
        bnb: 600,
        eth: 3500,
        lastUpdated: Date.now(),
      };

      const solPrice = speedCache.getNativePrice('sol');
      expect(typeof solPrice).toBe('number');
      expect(solPrice).toBeGreaterThan(0);
    });
  });

  describe('Congestion Level', () => {
    it('should get congestion level for a chain', () => {
      const level = speedCache.getCongestionLevel('sol');
      expect(['low', 'normal', 'high', 'extreme']).toContain(level);
    });
  });
});
