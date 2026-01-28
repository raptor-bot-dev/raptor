// =============================================================================
// RAPTOR Phase 2: JupiterRouter
// SwapRouter implementation wrapping existing JupiterClient for graduated tokens
// =============================================================================

import { Connection, VersionedTransaction, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_CONFIG, PROGRAM_IDS, solToLamports, lamportsToSol } from '@raptor/shared';
import { JupiterClient, type JupiterQuote } from '../chains/solana/jupiter.js';
import bs58 from 'bs58';
import type { JitoClient } from '../chains/solana/jitoClient.js';
import type {
  SwapRouter,
  SwapIntent,
  SwapQuote,
  SwapResult,
  ExecuteOptions,
  JupiterRouterConfig,
} from './swapRouter.js';

// Default confirmation timeout (30 seconds)
const TX_CONFIRM_TIMEOUT_MS = 30_000;

/**
 * JupiterRouter - SwapRouter implementation for Jupiter aggregator.
 *
 * Handles POST_GRADUATION tokens that have migrated to AMM pools.
 * Also serves as fallback for any token with a Jupiter route.
 */
export class JupiterRouter implements SwapRouter {
  readonly name = 'jupiter';

  private jupiterClient: JupiterClient;
  private connection: Connection;
  private jitoClient: JitoClient | null;

  constructor(config: JupiterRouterConfig = {}) {
    this.jupiterClient = new JupiterClient(config.jupiterApiUrl);
    this.connection = new Connection(config.rpcUrl || SOLANA_CONFIG.rpcUrl, 'confirmed');
    this.jitoClient = (config.jitoClient as JitoClient) || null;
  }

  /**
   * Check if this router can handle the given intent.
   * Jupiter handles POST_GRADUATION tokens and serves as fallback.
   */
  async canHandle(intent: SwapIntent): Promise<boolean> {
    // Jupiter handles post-graduation tokens
    if (intent.lifecycleState === 'POST_GRADUATION') {
      return true;
    }

    // For PRE_GRADUATION or unknown, check if Jupiter has a route
    // This allows Jupiter to serve as fallback
    try {
      const testAmount = intent.side === 'BUY'
        ? solToLamports(0.001) // Tiny test amount
        : BigInt(1_000_000); // 1 token

      const quote = intent.side === 'BUY'
        ? await this.jupiterClient.quoteBuy(intent.mint, 0.001, 100)
        : await this.jupiterClient.quoteSell(intent.mint, testAmount, 100);

      // If we got a quote, Jupiter can handle it
      return BigInt(quote.outAmount) > 0n;
    } catch {
      // No route available
      return false;
    }
  }

  /**
   * Get a quote for the swap via Jupiter.
   */
  async quote(intent: SwapIntent): Promise<SwapQuote> {
    const jupiterQuote = intent.side === 'BUY'
      ? await this.jupiterClient.quoteBuy(
          intent.mint,
          lamportsToSol(intent.amount),
          intent.slippageBps
        )
      : await this.jupiterClient.quoteSell(
          intent.mint,
          intent.amount,
          intent.slippageBps
        );

    const inputAmount = BigInt(jupiterQuote.inAmount);
    const expectedOutput = BigInt(jupiterQuote.outAmount);
    const minOutput = BigInt(jupiterQuote.otherAmountThreshold);

    return {
      router: this.name,
      inputAmount,
      expectedOutput,
      minOutput,
      priceImpact: parseFloat(jupiterQuote.priceImpactPct),
      slippageBps: jupiterQuote.slippageBps,
      pricePerToken: intent.side === 'BUY'
        ? Number(inputAmount) / Number(expectedOutput)
        : Number(expectedOutput) / Number(inputAmount),
      routePlan: jupiterQuote,
      quotedAt: Date.now(),
    };
  }

  /**
   * Build an unsigned versioned transaction from a Jupiter quote.
   */
  async buildTx(quote: SwapQuote, intent: SwapIntent): Promise<VersionedTransaction> {
    const jupiterQuote = quote.routePlan as JupiterQuote;

    const swapResponse = await this.jupiterClient.getSwapTransaction(
      jupiterQuote,
      intent.userPublicKey
    );

    // Store lastValidBlockHeight in quote for later use
    (quote as SwapQuote & { lastValidBlockHeight: number }).lastValidBlockHeight =
      swapResponse.lastValidBlockHeight;

    // Deserialize the transaction
    const transactionBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
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
        console.log('[JupiterRouter] Sending via Jito for MEV protection');
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

        // Prefer explicit signature from Jito result (base58), otherwise derive from signed tx.
        signature =
          jitoResult.signatures?.[0] ||
          (tx.signatures[0] ? bs58.encode(tx.signatures[0]) : jitoResult.bundleId || '');

        // Wait for Jito bundle confirmation
        if (jitoResult.bundleId && jitoResult.signatures?.[0]) {
          const confirmed = await this.jitoClient.waitForBundleConfirmation(
            jitoResult.bundleId,
            jitoResult.signatures[0],
            options.confirmTimeoutMs || TX_CONFIRM_TIMEOUT_MS
          );
          if (!confirmed) {
            console.warn('[JupiterRouter] Jito bundle confirmation timeout, checking RPC...');
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

        console.log(`[JupiterRouter] Transaction sent: ${signature}`);

        // Wait for confirmation with timeout. If we have the blockhash expiry window, use it;
        // otherwise fall back to signature-only confirmation.
        const timeoutMs = options?.confirmTimeoutMs || TX_CONFIRM_TIMEOUT_MS;
        if (options?.lastValidBlockHeight !== undefined) {
          await this.confirmTransactionWithTimeout(
            signature,
            tx.message.recentBlockhash,
            options.lastValidBlockHeight,
            timeoutMs
          );
        } else {
          await this.confirmSignatureOnlyWithTimeout(signature, timeoutMs);
        }
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
   * Confirm a transaction using signature-only strategy (fallback).
   * This is less strict than the blockhash strategy, but avoids false negatives when
   * lastValidBlockHeight is unavailable.
   */
  private async confirmSignatureOnlyWithTimeout(signature: string, timeoutMs: number): Promise<void> {
    const confirmPromise = (
      this.connection as unknown as {
        confirmTransaction: (sig: string, commitment: 'confirmed') => Promise<{ value: { err: unknown | null } }>;
      }
    ).confirmTransaction(signature, 'confirmed');

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Transaction confirmation timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const confirmation = await Promise.race([confirmPromise, timeoutPromise]);
    if (confirmation?.value?.err) {
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
    if (lowerMessage.includes('circuit breaker')) return 'CIRCUIT_BREAKER_OPEN';
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

      // Try Token-2022 first (pump.fun tokens), fall back to standard SPL
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
