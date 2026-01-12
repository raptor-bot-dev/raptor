/**
 * Solana Trade Service for RAPTOR Bot
 *
 * Thin adapter layer that delegates to executor's intelligent routing
 * Handles wallet management and user messaging
 */

import { solanaExecutor } from '@raptor/executor/solana';
import {
  Connection,
  PublicKey,
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
  applyBuyFeeDecimal,
} from '@raptor/shared';

const logger = createLogger('SolanaTrade');

export interface SolanaBuyResult {
  success: boolean;
  txHash?: string;
  error?: string;
  amountIn: number;      // SOL amount (gross)
  netAmount?: number;    // SOL after fee
  fee?: number;          // Platform fee
  amountOut?: number;    // Tokens received
  pricePerToken?: number;
  route?: string;        // 'pump.fun' or 'Jupiter'
}

/**
 * Execute a buy transaction on Solana
 * Routes automatically between pump.fun and Jupiter via executor
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

    // 3. Calculate fee breakdown
    const { netAmount, fee } = applyBuyFeeDecimal(solAmount);

    // 4. Load user's keypair
    const keypair = loadSolanaKeypair(
      solanaWallet.solana_private_key_encrypted as EncryptedData,
      tgId
    );

    logger.info('Executing buy via executor', { netAmount, fee });

    // 5. Execute via executor (handles routing automatically)
    const result = await solanaExecutor.executeBuyWithKeypair(
      tokenMint,
      solAmount,  // Pass GROSS amount (executor applies fee)
      keypair,
      { slippageBps: 50 }  // 0.5% slippage
    );

    if (!result.success) {
      // Translate executor errors to user-friendly messages
      const userMessage = translateExecutorError(result.error || 'Unknown error');
      return {
        success: false,
        error: userMessage,
        amountIn: solAmount,
      };
    }

    logger.info('Buy successful', {
      txHash: result.txHash,
      tokensReceived: result.amountOut,
      route: result.route,
    });

    // 6. Record trade in database (single source of truth)
    await recordTrade({
      tg_id: tgId,
      chain: 'sol',
      mode: 'snipe',
      token_address: tokenMint,
      token_symbol: 'UNKNOWN',  // TODO: fetch metadata
      type: 'BUY',
      amount_in: solAmount.toString(),
      amount_out: result.amountOut.toString(),
      price: result.price.toString(),
      fee_amount: fee.toString(),
      source: 'manual',
      tx_hash: result.txHash!,
      status: 'CONFIRMED',
    });

    await recordFee({
      tg_id: tgId,
      chain: 'sol',
      amount: fee.toString(),
      token: 'SOL',
    });

    return {
      success: true,
      txHash: result.txHash,
      amountIn: solAmount,
      netAmount: result.amountIn,
      fee: result.fee,
      amountOut: result.amountOut,
      pricePerToken: result.price,
      route: result.route,
    };
  } catch (error) {
    logger.error('Buy execution failed', error);

    // Translate executor errors to user-friendly messages
    const userMessage = translateExecutorError(error);

    return {
      success: false,
      error: userMessage,
      amountIn: solAmount,
    };
  }
}

/**
 * Translate executor errors to user-friendly messages
 */
function translateExecutorError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown error occurred';
  }

  const message = error.message.toLowerCase();

  // Check for specific error patterns
  if (message.includes('invalid') && message.includes('address')) {
    return '❌ Invalid token address';
  }

  if (message.includes('minimum') || message.includes('min')) {
    return '❌ Amount below minimum position size (0.1 SOL)';
  }

  if (message.includes('not found') || message.includes('does not exist')) {
    return '❌ Token not found on-chain. Check the address.';
  }

  if (message.includes('no route') || message.includes('no liquidity')) {
    return '❌ No liquidity available for this token.\n\n' +
           '• Token may be too new\n' +
           '• No active trading pools\n' +
           '• Try again when liquidity is available';
  }

  if (message.includes('transaction failed') || message.includes('simulation failed')) {
    return '❌ Transaction failed on-chain.\n\n' +
           'Possible causes:\n' +
           '• Slippage too low\n' +
           '• Insufficient SOL for fees\n' +
           '• Token has trading restrictions';
  }

  if (message.includes('rpc') || message.includes('network') || message.includes('timeout')) {
    return '❌ Network error. Please try again.';
  }

  // Default: return the original error message
  return `❌ ${error.message}`;
}
