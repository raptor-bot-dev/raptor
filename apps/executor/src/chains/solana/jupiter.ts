// Jupiter aggregator integration for Solana swaps
// Used for post-graduation trading when tokens move to Raydium

import { PROGRAM_IDS, solToLamports, lamportsToSol } from '@raptor/shared';

const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';

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
  private apiBase: string;

  constructor(apiBase: string = JUPITER_API_BASE) {
    this.apiBase = apiBase;
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

    const response = await fetch(`${this.apiBase}/quote?${params}`);

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
    const response = await fetch(`${this.apiBase}/swap`, {
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
    });

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
    // Quote 1 token worth to get price in SOL
    const params = new URLSearchParams({
      ids: tokenMint,
      vsToken: PROGRAM_IDS.WSOL,
    });

    const response = await fetch(`https://price.jup.ag/v6/price?${params}`);

    if (!response.ok) {
      throw new Error('Failed to get token price');
    }

    const data = (await response.json()) as { data?: Record<string, { price?: number }> };
    return data.data?.[tokenMint]?.price || 0;
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
