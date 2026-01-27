// =============================================================================
// RAPTOR Phase 2: SwapRouter Tests
// Unit tests for router implementations and RouterFactory
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import type { SwapIntent, SwapQuote, LifecycleState } from '../swapRouter.js';
import { RouterFactory } from '../routerFactory.js';
import { JupiterRouter } from '../jupiterRouter.js';
import { BagsTradeRouter } from '../bagsTradeRouter.js';

// Test constants
const TEST_MINT = 'TestMint11111111111111111111111111111111111';
const TEST_WALLET = 'TestWallet1111111111111111111111111111111111';
const TEST_BONDING_CURVE = 'TestBondingCurve11111111111111111111111111';

// Helper to create a test intent
function createTestIntent(overrides: Partial<SwapIntent> = {}): SwapIntent {
  return {
    mint: TEST_MINT,
    amount: BigInt(1_000_000_000), // 1 SOL
    side: 'BUY',
    slippageBps: 1000, // 10%
    userPublicKey: TEST_WALLET,
    ...overrides,
  };
}

// Helper to create a test quote
function createTestQuote(router: string, overrides: Partial<SwapQuote> = {}): SwapQuote {
  return {
    router,
    inputAmount: BigInt(1_000_000_000),
    expectedOutput: BigInt(1_000_000_000_000),
    minOutput: BigInt(900_000_000_000),
    priceImpact: 0.5,
    slippageBps: 1000,
    quotedAt: Date.now(),
    ...overrides,
  };
}

describe('SwapRouter Interface', () => {
  describe('SwapIntent validation', () => {
    it('should have all required fields', () => {
      const intent = createTestIntent();

      expect(intent.mint).toBeDefined();
      expect(intent.amount).toBeDefined();
      expect(intent.side).toBeDefined();
      expect(intent.slippageBps).toBeDefined();
      expect(intent.userPublicKey).toBeDefined();
    });

    it('should support optional lifecycleState', () => {
      const preGradIntent = createTestIntent({ lifecycleState: 'PRE_GRADUATION' });
      const postGradIntent = createTestIntent({ lifecycleState: 'POST_GRADUATION' });

      expect(preGradIntent.lifecycleState).toBe('PRE_GRADUATION');
      expect(postGradIntent.lifecycleState).toBe('POST_GRADUATION');
    });

    it('should support both BUY and SELL sides', () => {
      const buyIntent = createTestIntent({ side: 'BUY' });
      const sellIntent = createTestIntent({ side: 'SELL' });

      expect(buyIntent.side).toBe('BUY');
      expect(sellIntent.side).toBe('SELL');
    });
  });

  describe('SwapQuote validation', () => {
    it('should have all required fields', () => {
      const quote = createTestQuote('test-router');

      expect(quote.router).toBeDefined();
      expect(quote.inputAmount).toBeDefined();
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.minOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      expect(quote.slippageBps).toBeDefined();
      expect(quote.quotedAt).toBeDefined();
    });

    it('should have minOutput less than or equal to expectedOutput', () => {
      const quote = createTestQuote('test-router');

      expect(quote.minOutput).toBeLessThanOrEqual(quote.expectedOutput);
    });
  });
});

describe('JupiterRouter', () => {
  describe('canHandle', () => {
    it('should handle POST_GRADUATION tokens', async () => {
      const router = new JupiterRouter();
      const intent = createTestIntent({ lifecycleState: 'POST_GRADUATION' });

      const canHandle = await router.canHandle(intent);

      expect(canHandle).toBe(true);
    });

    it('should report correct router name', () => {
      const router = new JupiterRouter();

      expect(router.name).toBe('jupiter');
    });
  });
});

describe('BagsTradeRouter', () => {
  describe('canHandle', () => {
    it('should not handle POST_GRADUATION tokens', async () => {
      const router = new BagsTradeRouter();
      const intent = createTestIntent({ lifecycleState: 'POST_GRADUATION' });

      const canHandle = await router.canHandle(intent);

      expect(canHandle).toBe(false);
    });

    it('should handle PRE_GRADUATION tokens', async () => {
      const router = new BagsTradeRouter();
      const intent = createTestIntent({ lifecycleState: 'PRE_GRADUATION' });

      const canHandle = await router.canHandle(intent);

      expect(canHandle).toBe(true);
    });

    it('should handle intents with bonding curve address', async () => {
      const router = new BagsTradeRouter();
      const intent = createTestIntent({ bondingCurve: TEST_BONDING_CURVE });

      const canHandle = await router.canHandle(intent);

      expect(canHandle).toBe(true);
    });

    it('should report correct router name', () => {
      const router = new BagsTradeRouter();

      expect(router.name).toBe('bags-meteora');
    });
  });
});

describe('RouterFactory', () => {
  describe('getRouter', () => {
    it('should select BagsTradeRouter for PRE_GRADUATION tokens', async () => {
      const factory = new RouterFactory();
      const intent = createTestIntent({ lifecycleState: 'PRE_GRADUATION' });

      const router = await factory.getRouter(intent);

      expect(router.name).toBe('bags-meteora');
    });

    it('should select JupiterRouter for POST_GRADUATION tokens', async () => {
      const factory = new RouterFactory();
      const intent = createTestIntent({ lifecycleState: 'POST_GRADUATION' });

      const router = await factory.getRouter(intent);

      expect(router.name).toBe('jupiter');
    });

    it('should select BagsTradeRouter when bonding curve is provided', async () => {
      const factory = new RouterFactory();
      const intent = createTestIntent({ bondingCurve: TEST_BONDING_CURVE });

      const router = await factory.getRouter(intent);

      expect(router.name).toBe('bags-meteora');
    });
  });

  describe('getRouters', () => {
    it('should return all available routers', () => {
      const factory = new RouterFactory();
      const routers = factory.getRouters();

      expect(routers).toHaveLength(2);
      expect(routers.map(r => r.name)).toContain('bags-meteora');
      expect(routers.map(r => r.name)).toContain('jupiter');
    });
  });

  describe('getRouterByName', () => {
    it('should find router by name', () => {
      const factory = new RouterFactory();

      const jupiterRouter = factory.getRouterByName('jupiter');
      const bagsRouter = factory.getRouterByName('bags-meteora');

      expect(jupiterRouter?.name).toBe('jupiter');
      expect(bagsRouter?.name).toBe('bags-meteora');
    });

    it('should return undefined for unknown router', () => {
      const factory = new RouterFactory();

      const unknownRouter = factory.getRouterByName('unknown-router');

      expect(unknownRouter).toBeUndefined();
    });
  });

  describe('configuration', () => {
    it('should apply default lifecycle state from config', async () => {
      const factory = new RouterFactory({
        defaultLifecycleState: 'PRE_GRADUATION',
      });

      // Intent without lifecycle state should use default
      const intent = createTestIntent({ lifecycleState: undefined });
      const router = await factory.getRouter(intent);

      expect(router.name).toBe('bags-meteora');
    });
  });
});

describe('Router Priority', () => {
  it('should prefer BagsTradeRouter over JupiterRouter for bonding curve tokens', async () => {
    const factory = new RouterFactory();

    // PRE_GRADUATION should route to Bags
    const preGradIntent = createTestIntent({ lifecycleState: 'PRE_GRADUATION' });
    const preGradRouter = await factory.getRouter(preGradIntent);
    expect(preGradRouter.name).toBe('bags-meteora');

    // POST_GRADUATION should route to Jupiter
    const postGradIntent = createTestIntent({ lifecycleState: 'POST_GRADUATION' });
    const postGradRouter = await factory.getRouter(postGradIntent);
    expect(postGradRouter.name).toBe('jupiter');
  });
});

describe('Error Classification', () => {
  it('JupiterRouter should classify errors correctly', () => {
    const router = new JupiterRouter();

    // Access the private classifyError method via type casting for testing
    const classifyError = (router as unknown as { classifyError: (msg: string) => string }).classifyError.bind(router);

    expect(classifyError('Connection timeout')).toBe('RPC_TIMEOUT');
    expect(classifyError('Rate limit exceeded')).toBe('RPC_RATE_LIMITED');
    expect(classifyError('Blockhash expired')).toBe('BLOCKHASH_EXPIRED');
    expect(classifyError('Insufficient funds')).toBe('INSUFFICIENT_FUNDS');
    expect(classifyError('Slippage exceeded')).toBe('SLIPPAGE_EXCEEDED');
  });

  it('BagsTradeRouter should classify errors correctly', () => {
    const router = new BagsTradeRouter();

    // Access the private classifyError method via type casting for testing
    const classifyError = (router as unknown as { classifyError: (msg: string) => string }).classifyError.bind(router);

    expect(classifyError('Connection timeout')).toBe('RPC_TIMEOUT');
    expect(classifyError('Bonding curve error')).toBe('BONDING_CURVE_ERROR');
    expect(classifyError('Token has graduated')).toBe('TOKEN_GRADUATED');
  });
});
