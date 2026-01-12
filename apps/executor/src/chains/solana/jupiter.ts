// Jupiter aggregator integration for Solana swaps
// Used for post-graduation trading when tokens move to Raydium

import { PROGRAM_IDS, solToLamports, lamportsToSol } from '@raptor/shared';
import { fetchWithRetry } from '../../utils/fetchWithTimeout.js';

// Jupiter API endpoints (updated to api.jup.ag - the unified endpoint)
// Old endpoints (quote-api.jup.ag, price.jup.ag) have DNS issues on some platforms
const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1';
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

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

export class JupiterClient {
  private swapApiBase: string;
  private priceApiBase: string;

  constructor(swapApiBase: string = JUPITER_SWAP_API, priceApiBase: string = JUPITER_PRICE_API) {
    this.swapApiBase = swapApiBase;
    this.priceApiBase = priceApiBase;
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
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false',
      asLegacyTransaction: 'false',
    });

    const response = await fetchWithRetry(`${this.swapApiBase}/quote?${params}`, {}, 5000, 3);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    return response.json() as Promise<JupiterQuote>;
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
    const response = await fetchWithRetry(`${this.swapApiBase}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
      throw new Error(`Jupiter swap failed: ${error}`);
    }

    return response.json() as Promise<JupiterSwapResponse>;
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
      const response = await fetchWithRetry(`${this.priceApiBase}?${params}`, {}, 3000, 3);

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
