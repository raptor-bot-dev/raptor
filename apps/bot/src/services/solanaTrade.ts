/**
 * Solana Trade Service for RAPTOR Bot
 *
 * Handles buy/sell transactions via Jupiter aggregator
 * Automatically finds best routes with optimal liquidity
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  SOLANA_CONFIG,
  getUserWallets,
  loadSolanaKeypair,
  type EncryptedData,
  createLogger,
  recordTrade,
  recordFee,
} from '@raptor/shared';

const logger = createLogger('SolanaTrade');

const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: Array<{
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
  }>;
}

interface JupiterSwapResponse {
  swapTransaction: string; // Base64 encoded transaction
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

export interface SolanaBuyResult {
  success: boolean;
  txHash?: string;
  error?: string;
  amountIn: number; // SOL amount
  amountOut?: number; // Tokens received
  pricePerToken?: number;
  priceImpact?: number;
  route?: string; // Route description (e.g. "Raydium -> Orca")
}

/**
 * Execute a buy transaction on Solana
 * Uses Jupiter aggregator to find best route with optimal liquidity
 */
export async function executeSolanaBuy(
  tgId: number,
  tokenMint: string,
  solAmount: number
): Promise<SolanaBuyResult> {
  logger.info('Starting Solana buy', { tgId, tokenMint, solAmount });

  try {
    // 1. Get user's active Solana wallet
    const wallets = await getUserWallets(tgId);
    const solanaWallet = wallets.find((w) => w.chain === 'sol' && w.is_active);

    if (!solanaWallet) {
      return {
        success: false,
        error: 'No active Solana wallet found. Please create a wallet first.',
        amountIn: solAmount,
      };
    }

    // 2. Check balance
    const connection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');
    const publicKey = new PublicKey(solanaWallet.solana_address);
    const balance = await connection.getBalance(publicKey, 'finalized');
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    logger.info('Wallet balance', { address: solanaWallet.solana_address, balanceSOL });

    if (balanceSOL < solAmount) {
      return {
        success: false,
        error: `Insufficient funds. Balance: ${balanceSOL.toFixed(4)} SOL, Required: ${solAmount} SOL`,
        amountIn: solAmount,
      };
    }

    // 3. Get best quote from Jupiter
    const lamportsIn = Math.floor(solAmount * LAMPORTS_PER_SOL);

    logger.info('Requesting Jupiter quote', { tokenMint, solAmount, lamportsIn });
    const quote = await getJupiterQuote(tokenMint, lamportsIn);

    if (!quote) {
      logger.error('No Jupiter quote available', { tokenMint, solAmount });
      return {
        success: false,
        error: 'No liquidity available for this token. The token may be:\n' +
               '• Too new (no DEX pools yet)\n' +
               '• On a bonding curve (try pump.fun)\n' +
               '• Graduated but not listed yet\n\n' +
               'Please try again later when liquidity is available.',
        amountIn: solAmount,
      };
    }

    const priceImpact = parseFloat(quote.priceImpactPct);
    logger.info('Jupiter quote received', {
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      priceImpact: `${priceImpact.toFixed(2)}%`,
      routePlan: quote.routePlan.map((r) => r.swapInfo.label).join(' -> '),
    });

    // Check price impact (warn if > 5%)
    if (priceImpact > 5) {
      logger.warn('High price impact detected', { priceImpact });
    }

    // 4. Get swap transaction
    const swapResponse = await getJupiterSwapTransaction(quote, solanaWallet.solana_address);

    if (!swapResponse) {
      return {
        success: false,
        error: 'Failed to create swap transaction from Jupiter.',
        amountIn: solAmount,
      };
    }

    // 5. Load user's keypair for signing
    const keypair = loadSolanaKeypair(
      solanaWallet.solana_private_key_encrypted as EncryptedData,
      tgId
    );

    // 6. Deserialize, sign, and send transaction
    let signature: string;
    try {
      const txBuffer = Buffer.from(swapResponse.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);

      // Sign the transaction
      transaction.sign([keypair]);

      logger.info('Sending transaction to Solana network...');

      // Send transaction
      signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      logger.info('Transaction sent', { signature });
    } catch (error) {
      logger.error('Failed to send transaction', error);
      return {
        success: false,
        error: `Failed to send transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        amountIn: solAmount,
      };
    }

    // 7. Confirm transaction
    let confirmation;
    try {
      logger.info('Waiting for transaction confirmation...');
      confirmation = await connection.confirmTransaction(signature, 'confirmed');
    } catch (error) {
      logger.error('Transaction confirmation failed', { signature, error });
      return {
        success: false,
        error: `Transaction confirmation timeout. It may still succeed. Check Solscan: https://solscan.io/tx/${signature}`,
        amountIn: solAmount,
        txHash: signature,
      };
    }

    if (confirmation.value.err) {
      logger.error('Transaction failed on-chain', { signature, error: confirmation.value.err });
      return {
        success: false,
        error: `Transaction failed on-chain. Check Solscan for details: https://solscan.io/tx/${signature}`,
        amountIn: solAmount,
        txHash: signature,
      };
    }

    // 8. Calculate output
    const tokensReceived = parseInt(quote.outAmount);
    const pricePerToken = solAmount / tokensReceived;

    // 9. Build route description
    const route = quote.routePlan.map((r) => r.swapInfo.label).join(' → ');

    logger.info('Buy successful', {
      signature,
      tokensReceived,
      pricePerToken,
      route,
    });

    // 10. Record trade in database
    await recordTrade({
      tg_id: tgId,
      chain: 'sol',
      mode: 'snipe',
      token_address: tokenMint,
      token_symbol: 'UNKNOWN', // TODO: fetch token metadata
      type: 'BUY',
      amount_in: solAmount.toString(),
      amount_out: tokensReceived.toString(),
      price: pricePerToken.toString(),
      fee_amount: '0', // Jupiter fees included in output
      source: 'manual',
      tx_hash: signature,
      status: 'CONFIRMED',
    });

    return {
      success: true,
      txHash: signature,
      amountIn: solAmount,
      amountOut: tokensReceived,
      pricePerToken,
      priceImpact,
      route,
    };
  } catch (error) {
    logger.error('Buy execution failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      amountIn: solAmount,
    };
  }
}

/**
 * Get a quote from Jupiter aggregator
 * Finds the best route with optimal liquidity
 */
async function getJupiterQuote(
  tokenMint: string,
  lamportsIn: number,
  slippageBps: number = 50 // 0.5% slippage
): Promise<JupiterQuote | null> {
  try {
    const params = new URLSearchParams({
      inputMint: WSOL_MINT,
      outputMint: tokenMint,
      amount: lamportsIn.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false', // Allow multi-hop routes for better prices
      asLegacyTransaction: 'false', // Use versioned transactions
    });

    logger.info('Fetching Jupiter quote', {
      tokenMint,
      lamportsIn,
      url: `${JUPITER_API_BASE}/quote?${params.toString()}`,
    });

    // Add timeout to fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(`${JUPITER_API_BASE}/quote?${params}`, {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Jupiter quote API returned error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });

        // Parse error to provide helpful message
        if (response.status === 404 || errorText.includes('No routes found')) {
          return null; // No liquidity available
        }

        return null;
      }

      const quote = (await response.json()) as JupiterQuote;
      logger.info('Jupiter quote received successfully', {
        inputAmount: quote.inAmount,
        outputAmount: quote.outAmount,
        priceImpact: quote.priceImpactPct,
      });

      return quote;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Jupiter quote request timed out');
        throw new Error('Jupiter API timeout. Please try again.');
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Failed to get Jupiter quote', {
      error: error instanceof Error ? error.message : String(error),
      tokenMint,
    });
    return null;
  }
}

/**
 * Get swap transaction from Jupiter
 */
async function getJupiterSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string
): Promise<JupiterSwapResponse | null> {
  try {
    const response = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true, // Automatically wrap/unwrap SOL
        dynamicComputeUnitLimit: true, // Optimize compute units
        prioritizationFeeLamports: 'auto', // Auto priority fee
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Jupiter swap failed', { status: response.status, error: errorText });
      return null;
    }

    const swapResponse = await response.json() as JupiterSwapResponse;
    return swapResponse;
  } catch (error) {
    logger.error('Failed to get Jupiter swap transaction', error);
    return null;
  }
}
