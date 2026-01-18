// Jupiter aggregator integration for Solana swaps
// Used for post-graduation trading when tokens move to Raydium

import { PROGRAM_IDS, solToLamports, lamportsToSol } from '@raptor/shared';
import { fetchWithRetry } from '../../utils/fetchWithTimeout.js';

// Jupiter API endpoints (updated to api.jup.ag - the unified endpoint)
// Old endpoints (quote-api.jup.ag, price.jup.ag) have DNS issues on some platforms
const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1';
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

// v3.3.2: Jupiter API key for authenticated requests (fixes 401 errors)
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

// M-4: Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before opening circuit
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute reset time
const CIRCUIT_BREAKER_HALF_OPEN_REQUESTS = 1; // Test requests when half-open

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlan[];
}

interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string; // Base64 encoded transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

/**
 * M-4: Circuit breaker state
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  halfOpenRequests: number;
}

export class JupiterClient {
  private swapApiBase: string;
  private priceApiBase: string;

  // M-4: Circuit breaker for Jupiter API
  private circuitBreaker: CircuitBreakerState = {
    state: 'CLOSED',
    failures: 0,
    lastFailure: 0,
    halfOpenRequests: 0,
  };

  constructor(swapApiBase: string = JUPITER_SWAP_API, priceApiBase: string = JUPITER_PRICE_API) {
    this.swapApiBase = swapApiBase;
    this.priceApiBase = priceApiBase;
  }

  /**
   * M-4: Check if request should be allowed through circuit breaker
   */
  private checkCircuitBreaker(): void {
    const now = Date.now();

    switch (this.circuitBreaker.state) {
      case 'OPEN':
        // Check if we should transition to half-open
        if (now - this.circuitBreaker.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
          console.log('[Jupiter] Circuit breaker transitioning to HALF_OPEN');
          this.circuitBreaker.state = 'HALF_OPEN';
          this.circuitBreaker.halfOpenRequests = 0;
        } else {
          throw new Error('Jupiter API circuit breaker is OPEN. Try again later.');
        }
        break;

      case 'HALF_OPEN':
        // Only allow limited requests in half-open state
        if (this.circuitBreaker.halfOpenRequests >= CIRCUIT_BREAKER_HALF_OPEN_REQUESTS) {
          throw new Error('Jupiter API circuit breaker is testing. Try again shortly.');
        }
        this.circuitBreaker.halfOpenRequests++;
        break;

      case 'CLOSED':
        // Normal operation
        break;
    }
  }

  /**
   * M-4: Record successful request
   */
  private recordSuccess(): void {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      console.log('[Jupiter] Circuit breaker transitioning to CLOSED (success in half-open)');
      this.circuitBreaker.state = 'CLOSED';
      this.circuitBreaker.failures = 0;
    }
  }

  /**
   * M-4: Record failed request
   */
  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.state === 'HALF_OPEN') {
      console.log('[Jupiter] Circuit breaker transitioning to OPEN (failure in half-open)');
      this.circuitBreaker.state = 'OPEN';
    } else if (this.circuitBreaker.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      console.log(`[Jupiter] Circuit breaker OPEN after ${this.circuitBreaker.failures} failures`);
      this.circuitBreaker.state = 'OPEN';
    }
  }

  /**
   * Get circuit breaker status (for monitoring)
   */
  getCircuitBreakerStatus(): { state: CircuitState; failures: number } {
    return {
      state: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
    };
  }

  /**
   * Get a quote for swapping tokens
   * @param inputMint - Input token mint address
   * @param outputMint - Output token mint address
   * @param amount - Amount in smallest units (lamports for SOL)
   * @param slippageBps - Slippage tolerance in basis points (default 100 = 1%)
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint,
    slippageBps: number = 100
  ): Promise<JupiterQuote> {
    // M-4: Check circuit breaker before making request
    this.checkCircuitBreaker();

    // Clamp slippage to 99% max (9900 bps) to prevent:
    // 1. Jupiter API ParseIntError overflow when value is too large
    // 2. Negative calculations in downstream code
    const effectiveSlippageBps = Math.max(0, Math.min(slippageBps, 9900));

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: effectiveSlippageBps.toString(),
      onlyDirectRoutes: 'false',
      asLegacyTransaction: 'false',
    });

    try {
      // v3.3.2: Add API key header if available
      const headers: Record<string, string> = {};
      if (JUPITER_API_KEY) {
        headers['x-api-key'] = JUPITER_API_KEY;
      }
      const response = await fetchWithRetry(`${this.swapApiBase}/quote?${params}`, { headers }, 5000, 3);

      if (!response.ok) {
        const error = await response.text();
        this.recordFailure();
        throw new Error(`Jupiter quote failed: ${error}`);
      }

      this.recordSuccess();
      return response.json() as Promise<JupiterQuote>;
    } catch (error) {
      // Don't double-count circuit breaker errors
      if (!(error instanceof Error && error.message.includes('circuit breaker'))) {
        this.recordFailure();
      }
      throw error;
    }
  }

  /**
   * Get a swap transaction from a quote
   * @param quote - Quote from getQuote
   * @param userPublicKey - User's wallet public key
   */
  async getSwapTransaction(
    quote: JupiterQuote,
    userPublicKey: string
  ): Promise<JupiterSwapResponse> {
    // M-4: Check circuit breaker before making request
    this.checkCircuitBreaker();

    try {
      // v3.3.2: Add API key header if available
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (JUPITER_API_KEY) {
        headers['x-api-key'] = JUPITER_API_KEY;
      }
      const response = await fetchWithRetry(`${this.swapApiBase}/swap`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        }),
      }, 5000, 3);

      if (!response.ok) {
        const error = await response.text();
        this.recordFailure();
        throw new Error(`Jupiter swap failed: ${error}`);
      }

      this.recordSuccess();
      return response.json() as Promise<JupiterSwapResponse>;
    } catch (error) {
      // Don't double-count circuit breaker errors
      if (!(error instanceof Error && error.message.includes('circuit breaker'))) {
        this.recordFailure();
      }
      throw error;
    }
  }

  /**
   * Get price for a token in SOL
   * @param tokenMint - Token mint address
   */
  async getTokenPrice(tokenMint: string): Promise<number> {
    // Get price via Jupiter Price API v2
    const params = new URLSearchParams({
      ids: tokenMint,
      vsToken: PROGRAM_IDS.WSOL,
    });

    try {
      // v3.3.2: Add API key header if available
      const headers: Record<string, string> = {};
      if (JUPITER_API_KEY) {
        headers['x-api-key'] = JUPITER_API_KEY;
      }
      const response = await fetchWithRetry(`${this.priceApiBase}?${params}`, { headers }, 3000, 3);

      if (!response.ok) {
        throw new Error('Failed to get token price');
      }

      // Price API v2 returns { data: { [mint]: { price: string } } }
      const data = (await response.json()) as { data?: Record<string, { price?: string }> };
      const priceStr = data.data?.[tokenMint]?.price;
      return priceStr ? parseFloat(priceStr) : 0;
    } catch (error) {
      // Return 0 for price failures - non-critical for trading
      console.warn('[Jupiter] Price API failed after retries, returning 0');
      return 0;
    }
  }

  /**
   * Buy tokens with SOL
   * @param tokenMint - Token to buy
   * @param solAmount - Amount of SOL to spend
   * @param slippageBps - Slippage tolerance
   */
  async quoteBuy(
    tokenMint: string,
    solAmount: number,
    slippageBps: number = 100
  ): Promise<JupiterQuote> {
    const lamports = solToLamports(solAmount);
    return this.getQuote(PROGRAM_IDS.WSOL, tokenMint, lamports, slippageBps);
  }

  /**
   * Sell tokens for SOL
   * @param tokenMint - Token to sell
   * @param tokenAmount - Amount of tokens (in smallest units)
   * @param slippageBps - Slippage tolerance
   */
  async quoteSell(
    tokenMint: string,
    tokenAmount: bigint,
    slippageBps: number = 100
  ): Promise<JupiterQuote> {
    return this.getQuote(tokenMint, PROGRAM_IDS.WSOL, tokenAmount, slippageBps);
  }

  /**
   * Calculate expected output from a buy
   * @param quote - Quote from quoteBuy
   */
  getExpectedTokens(quote: JupiterQuote): bigint {
    return BigInt(quote.outAmount);
  }

  /**
   * Calculate expected SOL from a sell
   * @param quote - Quote from quoteSell
   */
  getExpectedSol(quote: JupiterQuote): number {
    return lamportsToSol(BigInt(quote.outAmount));
  }

  /**
   * Get price impact percentage
   * @param quote - Quote to check
   */
  getPriceImpact(quote: JupiterQuote): number {
    return parseFloat(quote.priceImpactPct);
  }
}

// Singleton instance
export const jupiter = new JupiterClient();
