// =============================================================================
// RAPTOR Phase 2: RouterFactory
// Router selection and swap orchestration
// =============================================================================

import { Keypair } from '@solana/web3.js';
import type {
  SwapRouter,
  SwapIntent,
  SwapQuote,
  SwapResult,
  ExecuteOptions,
  RouterFactoryConfig,
  LifecycleState,
} from './swapRouter.js';
import { BagsTradeRouter } from './bagsTradeRouter.js';
import { JupiterRouter } from './jupiterRouter.js';

/**
 * Extended swap options for executeSwap.
 */
export interface SwapExecutionOptions extends ExecuteOptions {
  /** Skip the quote step and use provided quote */
  quote?: SwapQuote;
  /** Execution ID for logging */
  executionId?: string;
}

/**
 * Full swap result including quote information.
 */
export interface FullSwapResult extends SwapResult {
  /** Quote used for the swap */
  quote?: SwapQuote;
}

/**
 * RouterFactory - Orchestrates router selection and swap execution.
 *
 * Priority order:
 * 1. BagsTradeRouter - for PRE_GRADUATION tokens on Meteora bonding curve
 * 2. JupiterRouter - for POST_GRADUATION tokens and as fallback
 */
export class RouterFactory {
  private routers: SwapRouter[];
  private defaultLifecycleState: LifecycleState | undefined;

  constructor(config: RouterFactoryConfig = {}) {
    // Initialize routers in priority order
    this.routers = [
      new BagsTradeRouter(config.bags),
      new JupiterRouter(config.jupiter),
    ];
    this.defaultLifecycleState = config.defaultLifecycleState;
  }

  /**
   * Get all available routers.
   */
  getRouters(): SwapRouter[] {
    return [...this.routers];
  }

  /**
   * Get router by name.
   */
  getRouterByName(name: string): SwapRouter | undefined {
    return this.routers.find((r) => r.name === name);
  }

  /**
   * Get the appropriate router for an intent.
   * Tries routers in priority order until one can handle the intent.
   *
   * @param intent - Swap intent to route
   * @returns Router that can handle the intent
   * @throws Error if no router can handle the intent
   */
  async getRouter(intent: SwapIntent): Promise<SwapRouter> {
    // Apply default lifecycle state if not provided
    const intentWithDefaults: SwapIntent = {
      ...intent,
      lifecycleState: intent.lifecycleState ?? this.defaultLifecycleState,
    };

    for (const router of this.routers) {
      try {
        if (await router.canHandle(intentWithDefaults)) {
          console.log(`[RouterFactory] Selected router: ${router.name} for mint ${intent.mint.slice(0, 12)}...`);
          return router;
        }
      } catch (error) {
        console.warn(`[RouterFactory] Router ${router.name} check failed:`, error);
        // Continue to next router
      }
    }

    throw new Error(`No router available for mint ${intent.mint}`);
  }

  /**
   * Get a quote from the appropriate router.
   *
   * @param intent - Swap intent
   * @returns Quote from the selected router
   */
  async getQuote(intent: SwapIntent): Promise<SwapQuote> {
    const router = await this.getRouter(intent);
    return router.quote(intent);
  }

  /**
   * Execute a swap through the appropriate router.
   * Handles the full quote -> buildTx -> execute flow.
   *
   * @param intent - Swap intent with all parameters
   * @param keypair - User's keypair for signing
   * @param options - Execution options
   * @returns Full swap result with signature or error
   */
  async executeSwap(
    intent: SwapIntent,
    keypair: Keypair,
    options?: SwapExecutionOptions
  ): Promise<FullSwapResult> {
    const logPrefix = options?.executionId
      ? `[RouterFactory:${options.executionId}]`
      : '[RouterFactory]';

    try {
      // Get router
      const router = await this.getRouter(intent);
      console.log(`${logPrefix} Using ${router.name} for ${intent.side} ${intent.mint.slice(0, 12)}...`);

      // Get or use provided quote
      const quote = options?.quote ?? await router.quote(intent);
      console.log(
        `${logPrefix} Quote: ${quote.expectedOutput} output, ${quote.priceImpact}% impact, ` +
        `min ${quote.minOutput} (${quote.slippageBps}bps slippage)`
      );

      // Build transaction
      const tx = await router.buildTx(quote, intent);
      console.log(`${logPrefix} Transaction built`);

      // Execute
      const result = await router.execute(tx, keypair, {
        ...options,
        lastValidBlockHeight: quote.lastValidBlockHeight ?? options?.lastValidBlockHeight,
      });

      if (result.success) {
        console.log(`${logPrefix} Swap successful: ${result.signature}`);
      } else {
        console.error(`${logPrefix} Swap failed: ${result.error} (${result.errorCode})`);
      }

      return {
        ...result,
        quote,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`${logPrefix} Swap execution error:`, message);

      return {
        success: false,
        error: message,
        errorCode: 'ROUTER_ERROR',
      };
    }
  }

  /**
   * Execute a buy swap.
   * Convenience method that constructs the intent for a buy.
   *
   * @param tokenMint - Token to buy
   * @param solAmount - Amount of SOL to spend (in SOL, not lamports)
   * @param keypair - User's keypair
   * @param options - Additional options
   */
  async executeBuy(
    tokenMint: string,
    solAmount: number,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      lifecycleState?: LifecycleState;
      bondingCurve?: string;
      useJito?: boolean;
      priorityFeeSol?: number;
      executionId?: string;
    }
  ): Promise<FullSwapResult> {
    const { solToLamports } = await import('@raptor/shared');

    const intent: SwapIntent = {
      mint: tokenMint,
      amount: solToLamports(solAmount),
      side: 'BUY',
      slippageBps: options?.slippageBps ?? 1000, // Default 10%
      userPublicKey: keypair.publicKey.toBase58(),
      lifecycleState: options?.lifecycleState,
      bondingCurve: options?.bondingCurve,
    };

    return this.executeSwap(intent, keypair, {
      useJito: options?.useJito,
      priorityFeeSol: options?.priorityFeeSol,
      executionId: options?.executionId,
    });
  }

  /**
   * Execute a sell swap.
   * Convenience method that constructs the intent for a sell.
   *
   * @param tokenMint - Token to sell
   * @param tokenAmount - Amount of tokens to sell (in raw units)
   * @param keypair - User's keypair
   * @param options - Additional options
   */
  async executeSell(
    tokenMint: string,
    tokenAmount: bigint,
    keypair: Keypair,
    options?: {
      slippageBps?: number;
      lifecycleState?: LifecycleState;
      bondingCurve?: string;
      useJito?: boolean;
      priorityFeeSol?: number;
      executionId?: string;
      positionId?: string;
    }
  ): Promise<FullSwapResult> {
    const intent: SwapIntent = {
      mint: tokenMint,
      amount: tokenAmount,
      side: 'SELL',
      slippageBps: options?.slippageBps ?? 800, // Default 8%
      userPublicKey: keypair.publicKey.toBase58(),
      lifecycleState: options?.lifecycleState,
      bondingCurve: options?.bondingCurve,
      positionId: options?.positionId,
    };

    return this.executeSwap(intent, keypair, {
      useJito: options?.useJito,
      priorityFeeSol: options?.priorityFeeSol,
      executionId: options?.executionId,
    });
  }
}

/**
 * Create a RouterFactory with default configuration.
 * Uses environment variables for API URLs and keys.
 */
export function createRouterFactory(config?: RouterFactoryConfig): RouterFactory {
  return new RouterFactory(config);
}
