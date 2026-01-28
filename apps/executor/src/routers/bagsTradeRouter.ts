// =============================================================================
// RAPTOR Phase 2: BagsTradeRouter
// SwapRouter implementation for Bags.fm/Meteora bonding curve trades
// =============================================================================

import { Connection, VersionedTransaction, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_CONFIG, solToLamports, lamportsToSol } from '@raptor/shared';
import { fetchWithRetry } from '../utils/fetchWithTimeout.js';
import bs58 from 'bs58';
import type { JitoClient } from '../chains/solana/jitoClient.js';
import type {
  SwapRouter,
  SwapIntent,
  SwapQuote,
  SwapResult,
  ExecuteOptions,
  BagsTradeRouterConfig,
} from './swapRouter.js';

// Default configuration - using official BAGS API v2 (from docs.bags.fm)
const DEFAULT_BAGS_API_URL = process.env.BAGS_TRADE_API_URL || 'https://public-api-v2.bags.fm/api/v1';
const TX_CONFIRM_TIMEOUT_MS = 30_000;

/**
 * Bags.fm quote response data (inner response per docs.bags.fm)
 */
interface BagsQuoteData {
  /** Input amount in smallest units */
  inputAmount: string;
  /** Output amount in smallest units */
  outputAmount: string;
  /** Minimum output after slippage */
  minOutputAmount: string;
  /** Price impact percentage */
  priceImpactPct: string;
  /** Slippage applied */
  slippageBps: number;
  /** Bonding curve address */
  bondingCurve?: string;
  /** Route metadata */
  route?: unknown;
}

/**
 * Bags.fm quote response wrapper (per docs.bags.fm API spec)
 */
interface BagsQuoteResponse {
  success: boolean;
  response?: BagsQuoteData;
  error?: string;
}

/**
 * Bags.fm swap response (per official docs.bags.fm/api-reference/create-swap-transaction)
 * Response is wrapped in {success, response: {...}} or {success: false, error: "..."}
 */
interface BagsSwapResponse {
  success: boolean;
  response?: {
    /** Base58 encoded VersionedTransaction */
    swapTransaction: string;
    /** Compute unit limit for the transaction */
    computeUnitLimit: number;
    /** Last valid block height */
    lastValidBlockHeight: number;
    /** Prioritization fee in lamports */
    prioritizationFeeLamports: number;
  };
  error?: string;
}

/**
 * BagsTradeRouter - SwapRouter implementation for Bags.fm/Meteora bonding curve.
 *
 * Handles PRE_GRADUATION tokens that are still on the Meteora bonding curve.
 * Uses the Bags.fm trade API to get quotes and build transactions.
 */
export class BagsTradeRouter implements SwapRouter {
  readonly name = 'bags-meteora';

  private bagsApiUrl: string;
  private apiKey: string | undefined;
  private connection: Connection;
  private jitoClient: JitoClient | null;

  constructor(config: BagsTradeRouterConfig = {}) {
    this.bagsApiUrl = config.bagsApiUrl || DEFAULT_BAGS_API_URL;
    this.apiKey = config.apiKey || process.env.BAGS_API_KEY;
    this.connection = new Connection(config.rpcUrl || SOLANA_CONFIG.rpcUrl, 'confirmed');
    this.jitoClient = (config.jitoClient as JitoClient) || null;
  }

  /**
   * Check if this router can handle the given intent.
   * BagsTradeRouter handles PRE_GRADUATION tokens on Meteora bonding curve.
   */
  async canHandle(intent: SwapIntent): Promise<boolean> {
    // POST_GRADUATION tokens should use Jupiter
    if (intent.lifecycleState === 'POST_GRADUATION') {
      return false;
    }

    // If lifecycle state is PRE_GRADUATION, we can handle it
    if (intent.lifecycleState === 'PRE_GRADUATION') {
      return true;
    }

    // If bonding curve is provided, we can handle it
    if (intent.bondingCurve) {
      return true;
    }

    // For unknown state, check if token is on Meteora bonding curve
    try {
      const isOnBondingCurve = await this.checkBondingCurve(intent.mint);
      return isOnBondingCurve;
    } catch {
      return false;
    }
  }

  /**
   * Check if a token is on Meteora bonding curve.
   */
  private async checkBondingCurve(mint: string): Promise<boolean> {
    try {
      // Call Bags API to check token status
      const headers = this.getHeaders();
      const response = await fetchWithRetry(
        `${this.bagsApiUrl}/token/${mint}/status`,
        { headers },
        5000,
        2
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json() as { graduated?: boolean; bondingCurve?: string };
      return !data.graduated && !!data.bondingCurve;
    } catch {
      return false;
    }
  }

  /**
   * Get headers for Bags API requests.
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Get a quote for the swap via Bags.fm trade API.
   * Uses official BAGS API v2 endpoint per docs.bags.fm
   */
  async quote(intent: SwapIntent): Promise<SwapQuote> {
    const headers = this.getHeaders();

    // Per docs.bags.fm trade tokens guide:
    // Quote params: inputMint, outputMint, amount, slippageMode, slippageBps
    const requestBody = {
      inputMint: intent.side === 'BUY' ? 'So11111111111111111111111111111111111111112' : intent.mint,
      outputMint: intent.side === 'BUY' ? intent.mint : 'So11111111111111111111111111111111111111112',
      amount: intent.amount.toString(),
      slippageMode: 'manual',
      slippageBps: intent.slippageBps,
      userPublicKey: intent.userPublicKey,
    };

    const response = await fetchWithRetry(
      `${this.bagsApiUrl}/trade/quote`,  // Official endpoint per docs.bags.fm
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      },
      10000, // 10s timeout for quote
      3
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bags quote failed (HTTP ${response.status}): ${errorText}`);
    }

    const quoteResponse = await response.json() as BagsQuoteResponse;

    // Handle response wrapper per docs.bags.fm spec
    if (!quoteResponse.success || !quoteResponse.response) {
      throw new Error(`Bags quote failed: ${quoteResponse.error || 'Unknown error'}`);
    }

    const bagsQuote = quoteResponse.response;

    const inputAmount = BigInt(bagsQuote.inputAmount);
    const expectedOutput = BigInt(bagsQuote.outputAmount);
    const minOutput = BigInt(bagsQuote.minOutputAmount);

    return {
      router: this.name,
      inputAmount,
      expectedOutput,
      minOutput,
      priceImpact: parseFloat(bagsQuote.priceImpactPct),
      slippageBps: bagsQuote.slippageBps,
      pricePerToken: intent.side === 'BUY'
        ? Number(inputAmount) / Number(expectedOutput)
        : Number(expectedOutput) / Number(inputAmount),
      routePlan: {
        bagsQuote,  // Pass full quote for swap request
        bondingCurve: bagsQuote.bondingCurve,
      },
      quotedAt: Date.now(),
    };
  }

  /**
   * Build an unsigned versioned transaction from a Bags quote.
   * Uses official BAGS API v2 endpoint: POST /trade/swap
   */
  async buildTx(quote: SwapQuote, intent: SwapIntent): Promise<VersionedTransaction> {
    const headers = this.getHeaders();

    // Per docs.bags.fm/api-reference/create-swap-transaction:
    // Request body requires quoteResponse and userPublicKey
    const requestBody = {
      quoteResponse: quote.routePlan,
      userPublicKey: intent.userPublicKey,
    };

    const response = await fetchWithRetry(
      `${this.bagsApiUrl}/trade/swap`,  // Official endpoint per docs.bags.fm
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      },
      10000, // 10s timeout for swap build
      3
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bags swap build failed (HTTP ${response.status}): ${errorText}`);
    }

    const swapResponse = await response.json() as BagsSwapResponse;

    // Handle response wrapper per docs.bags.fm spec
    if (!swapResponse.success || !swapResponse.response) {
      throw new Error(`Bags swap build failed: ${swapResponse.error || 'Unknown error'}`);
    }

    const swapData = swapResponse.response;

    // Store lastValidBlockHeight in quote for later use
    quote.lastValidBlockHeight = swapData.lastValidBlockHeight;

    // Deserialize the transaction - BAGS API returns Base58 encoded (not base64)
    const transactionBuffer = bs58.decode(swapData.swapTransaction);
    return VersionedTransaction.deserialize(transactionBuffer);
  }

  /**
   * Execute a signed transaction.
   */
  async execute(
    tx: VersionedTransaction,
    keypair: Keypair,
    options?: ExecuteOptions
  ): Promise<SwapResult> {
    try {
      // Sign the transaction
      tx.sign([keypair]);

      let signature: string;

      if (options?.useJito && this.jitoClient) {
        // Send via Jito for MEV protection
        console.log('[BagsTradeRouter] Sending via Jito for MEV protection');
        const jitoResult = await this.jitoClient.sendTransaction(tx, keypair, {
          priorityFeeSol: options.priorityFeeSol,
        });

        if (!jitoResult.success) {
          return {
            success: false,
            error: `Jito bundle failed: ${jitoResult.error}`,
            errorCode: 'JITO_BUNDLE_FAILED',
            router: this.name,
          };
        }

        // Get signature from transaction
        const sig = tx.signatures[0];
        signature = sig ? Buffer.from(sig).toString('base64') : jitoResult.bundleId || '';

        // Wait for Jito bundle confirmation
        if (jitoResult.bundleId && jitoResult.signatures?.[0]) {
          const confirmed = await this.jitoClient.waitForBundleConfirmation(
            jitoResult.bundleId,
            jitoResult.signatures[0],
            options.confirmTimeoutMs || TX_CONFIRM_TIMEOUT_MS
          );
          if (!confirmed) {
            console.warn('[BagsTradeRouter] Jito bundle confirmation timeout, checking RPC...');
          }
        }
      } else {
        // Send via standard RPC
        const rawTransaction = tx.serialize();
        signature = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        });

        console.log(`[BagsTradeRouter] Transaction sent: ${signature}`);

        // Wait for confirmation with timeout
        await this.confirmTransactionWithTimeout(
          signature,
          tx.message.recentBlockhash,
          Number.MAX_SAFE_INTEGER, // Will use quote's lastValidBlockHeight if available
          options?.confirmTimeoutMs || TX_CONFIRM_TIMEOUT_MS
        );
      }

      return {
        success: true,
        signature,
        router: this.name,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = this.classifyError(message);

      return {
        success: false,
        error: message,
        errorCode,
        router: this.name,
      };
    }
  }

  /**
   * Confirm transaction with timeout.
   */
  private async confirmTransactionWithTimeout(
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number,
    timeoutMs: number
  ): Promise<void> {
    const confirmPromise = this.connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed'
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Transaction confirmation timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const confirmation = await Promise.race([confirmPromise, timeoutPromise]);

    if (confirmation.value.err) {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
    }
  }

  /**
   * Classify error for retry logic.
   */
  private classifyError(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('timeout')) return 'RPC_TIMEOUT';
    if (lowerMessage.includes('rate limit')) return 'RPC_RATE_LIMITED';
    if (lowerMessage.includes('blockhash')) return 'BLOCKHASH_EXPIRED';
    if (lowerMessage.includes('insufficient')) return 'INSUFFICIENT_FUNDS';
    if (lowerMessage.includes('slippage')) return 'SLIPPAGE_EXCEEDED';
    if (lowerMessage.includes('bonding curve')) return 'BONDING_CURVE_ERROR';
    if (lowerMessage.includes('graduated')) return 'TOKEN_GRADUATED';
    if (lowerMessage.includes('simulation failed')) return 'SIMULATION_FAILED';

    return 'UNKNOWN_ERROR';
  }

  /**
   * Get token balance (for verification after swap).
   */
  async getTokenBalance(tokenMint: string, walletAddress: string): Promise<bigint> {
    try {
      const mint = new PublicKey(tokenMint);
      const wallet = new PublicKey(walletAddress);

      // Meteora tokens typically use Token-2022
      let tokenProgramId = TOKEN_2022_PROGRAM_ID;
      try {
        const mintInfo = await this.connection.getAccountInfo(mint);
        if (mintInfo && mintInfo.owner.equals(TOKEN_PROGRAM_ID)) {
          tokenProgramId = TOKEN_PROGRAM_ID;
        }
      } catch {
        // Default to Token-2022
      }

      const ata = await getAssociatedTokenAddress(mint, wallet, false, tokenProgramId);
      const accountInfo = await this.connection.getTokenAccountBalance(ata);

      return BigInt(accountInfo.value.amount);
    } catch {
      return 0n;
    }
  }
}
