// =============================================================================
// RAPTOR Phase 2: SwapRouter Interface
// Venue-agnostic swap abstraction for execution layer
// =============================================================================

import { VersionedTransaction, Keypair } from '@solana/web3.js';

/**
 * Lifecycle state of a token on a bonding curve launchpad.
 * PRE_GRADUATION: Token is still on bonding curve (use BagsTradeRouter)
 * POST_GRADUATION: Token has graduated to AMM pool (use JupiterRouter)
 */
export type LifecycleState = 'PRE_GRADUATION' | 'POST_GRADUATION';

/**
 * Trade direction.
 * BUY: SOL -> Token
 * SELL: Token -> SOL
 */
export type TradeSide = 'BUY' | 'SELL';

/**
 * Swap execution options.
 */
export interface ExecuteOptions {
  /** Use Jito bundles for MEV protection */
  useJito?: boolean;
  /** Priority fee in SOL (for compute budget) */
  priorityFeeSol?: number;
  /** Timeout in milliseconds for transaction confirmation */
  confirmTimeoutMs?: number;
  /**
   * Last valid block height for the transaction's recentBlockhash.
   * If omitted, routers will fall back to signature-only confirmation.
   */
  lastValidBlockHeight?: number;
}

/**
 * Venue-agnostic swap intent.
 * Represents a trade request before routing to a specific DEX/router.
 */
export interface SwapIntent {
  /** Token mint address */
  mint: string;
  /** Amount in smallest units (lamports for SOL, raw for tokens) */
  amount: bigint;
  /** Trade direction: BUY = SOL -> Token, SELL = Token -> SOL */
  side: TradeSide;
  /** Slippage tolerance in basis points (100 = 1%) */
  slippageBps: number;
  /** User's wallet public key (base58) */
  userPublicKey: string;
  /** Optional: bonding curve address for pre-graduation tokens */
  bondingCurve?: string;
  /** Optional: lifecycle state for routing decision */
  lifecycleState?: LifecycleState;
  /** Optional: position ID for idempotency tracking */
  positionId?: string;
}

/**
 * Quote result from a SwapRouter.
 * Contains pricing information and route metadata.
 */
export interface SwapQuote {
  /** Router that generated this quote */
  router: string;
  /** Input amount in smallest units */
  inputAmount: bigint;
  /** Expected output amount before slippage */
  expectedOutput: bigint;
  /** Minimum output after slippage (guaranteed minimum) */
  minOutput: bigint;
  /** Price impact percentage (0-100) */
  priceImpact: number;
  /** Slippage applied in basis points */
  slippageBps: number;
  /** Price per token (output/input ratio) */
  pricePerToken?: number;
  /** Route metadata for logging/debugging */
  routePlan?: unknown;
  /** Timestamp when quote was generated (ms) */
  quotedAt: number;
  /** Quote expiry timestamp (ms), e.g., blockhash validity */
  expiresAt?: number;
  /** Last valid block height for transaction */
  lastValidBlockHeight?: number;
}

/**
 * Execution result from a swap.
 */
export interface SwapResult {
  /** Whether the swap succeeded */
  success: boolean;
  /** Transaction signature on success */
  signature?: string;
  /** Actual output received (may differ from quote due to slippage) */
  actualOutput?: bigint;
  /** Actual input spent (may differ for bonding curves) */
  actualInput?: bigint;
  /** Price per token achieved */
  price?: number;
  /** Error message on failure */
  error?: string;
  /** Error code for classification (retryable vs non-retryable) */
  errorCode?: string;
  /** Router name that executed the swap */
  router?: string;
}

/**
 * SwapRouter interface - all router implementations must implement this.
 *
 * Design principles:
 * - Explicit slippage: Passed in intent, not hidden in config
 * - Separation of concerns: quote() -> buildTx() -> execute() allows inspection between steps
 * - canHandle() method: Enables routing logic without try-catch patterns
 */
export interface SwapRouter {
  /** Router identifier (e.g., 'bags-meteora', 'jupiter') */
  readonly name: string;

  /**
   * Check if this router can handle the given intent.
   * Used by RouterFactory to select appropriate router.
   *
   * @param intent - Swap intent to check
   * @returns true if this router can handle the swap
   */
  canHandle(intent: SwapIntent): Promise<boolean>;

  /**
   * Get a quote for the swap.
   * Does not modify state or commit to a transaction.
   *
   * @param intent - Swap intent with all parameters
   * @returns Quote with pricing and route information
   * @throws Error if quote cannot be obtained
   */
  quote(intent: SwapIntent): Promise<SwapQuote>;

  /**
   * Build an unsigned versioned transaction from a quote.
   * Transaction is ready for signing but not yet submitted.
   *
   * @param quote - Quote from a previous quote() call
   * @param intent - Original swap intent (for account derivation)
   * @returns VersionedTransaction ready for signing
   * @throws Error if transaction cannot be built
   */
  buildTx(quote: SwapQuote, intent: SwapIntent): Promise<VersionedTransaction>;

  /**
   * Execute a signed transaction.
   * Signs the transaction and submits to the network.
   *
   * @param tx - Transaction to execute (will be signed)
   * @param keypair - User's keypair for signing
   * @param options - Execution options (Jito, priority fee, timeout)
   * @returns Execution result with signature or error
   */
  execute(
    tx: VersionedTransaction,
    keypair: Keypair,
    options?: ExecuteOptions
  ): Promise<SwapResult>;
}

/**
 * Configuration for BagsTradeRouter.
 */
export interface BagsTradeRouterConfig {
  /** Bags.fm trade API base URL */
  bagsApiUrl?: string;
  /** API key for authentication (if required) */
  apiKey?: string;
  /** Jito client for MEV protection */
  jitoClient?: unknown;
  /** Helius Sender for staked tx submission (primary send method) */
  heliusSender?: unknown;
  /** RPC URL override */
  rpcUrl?: string;
}

/**
 * Configuration for JupiterRouter.
 */
export interface JupiterRouterConfig {
  /** Jupiter API base URL */
  jupiterApiUrl?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Jito client for MEV protection */
  jitoClient?: unknown;
  /** RPC URL override */
  rpcUrl?: string;
}

/**
 * Configuration for RouterFactory.
 */
export interface RouterFactoryConfig {
  /** BagsTradeRouter configuration */
  bags?: BagsTradeRouterConfig;
  /** JupiterRouter configuration */
  jupiter?: JupiterRouterConfig;
  /** Default lifecycle state if not provided in intent */
  defaultLifecycleState?: LifecycleState;
}
