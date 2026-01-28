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
  getOrCreateManualSettings,
  type EncryptedData,
  createLogger,
  recordTrade,
  recordFee,
  applyBuyFeeDecimal,
  getTokenInfo,
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

export interface SolanaSellResult {
  success: boolean;
  txHash?: string;
  error?: string;
  tokensSold: number;
  solReceived?: number;
  route?: string;
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

    // 4. Load user's keypair (v3.3.2: with integrity check)
    const walletAddress = solanaWallet.public_key || solanaWallet.solana_address;
    const keypair = loadSolanaKeypair(
      solanaWallet.solana_private_key_encrypted as EncryptedData,
      tgId,
      walletAddress  // v3.3.2: validate derived pubkey matches stored address
    );

    // v3.5: Pass tgId to executor to fetch chain-specific settings
    logger.info('Executing buy via executor', { netAmount, fee, tgId });

    // 5. Execute via executor (handles routing automatically)
    const result = await solanaExecutor.executeBuyWithKeypair(
      tokenMint,
      solAmount,  // Pass GROSS amount (executor applies fee)
      keypair,
      { tgId }  // v3.5: Let executor fetch chain settings
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
    const pumpToken = await getTokenInfo(tokenMint).catch(() => null);
    const tokenSymbol = pumpToken?.symbol || 'UNKNOWN';

    await recordTrade({
      tg_id: tgId,
      chain: 'sol',
      mode: 'snipe',
      token_address: tokenMint,
      token_symbol: tokenSymbol,
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
  // Extract error message from various formats
  let errorMessage = 'Unknown error occurred';

  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (error && typeof error === 'object') {
    // Handle executor result objects and other error shapes
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') {
      errorMessage = err.message;
    } else if (typeof err.error === 'string') {
      errorMessage = err.error;
    } else if (typeof err.reason === 'string') {
      errorMessage = err.reason;
    } else {
      // Last resort: stringify for debugging
      try {
        errorMessage = JSON.stringify(error);
      } catch {
        errorMessage = 'Error details unavailable';
      }
    }
  }

  const message = errorMessage.toLowerCase();

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

  if (message.includes('simulation failed') || message.includes('custom program error')) {
    return `❌ Transaction simulation failed:\n${errorMessage}`;
  }

  if (message.includes('transaction failed')) {
    return '❌ Transaction failed on-chain.\n\n' +
           'Possible causes:\n' +
           '• Slippage too low\n' +
           '• Insufficient SOL for fees\n' +
           '• Token has trading restrictions';
  }

  if (message.includes('rpc') || message.includes('network') || message.includes('timeout') || message.includes('enotfound')) {
    return '❌ Network error. Please try again.';
  }

  if (message.includes('insufficient') || message.includes('not enough')) {
    return '❌ Insufficient SOL balance. Please add funds.';
  }

  if (message.includes('graduated')) {
    return '❌ Token has graduated from bonding curve. Routing via Jupiter...';
  }

  if (message.includes('accountnotenoughkeys') || message.includes('3005')) {
    return '❌ Bonding curve program error detected. Please report this error.';
  }

  // Default: return the actual error message (not generic)
  return `❌ ${errorMessage}`;
}

/**
 * Execute a sell transaction on Solana
 * Routes automatically between pump.fun and Jupiter via executor
 */
export async function executeSolanaSell(
  tgId: number,
  tokenMint: string,
  tokenAmount: number
): Promise<SolanaSellResult> {
  logger.info('Starting Solana sell', { tgId, tokenMint, tokenAmount });

  try {
    // 1. Get user's active Solana wallet
    const wallets = await getUserWallets(tgId);
    const solanaWallet = wallets.find((w) => w.chain === 'sol' && w.is_active);

    if (!solanaWallet) {
      return {
        success: false,
        error: 'No active Solana wallet found. Please create a wallet first.',
        tokensSold: tokenAmount,
      };
    }

    // 2. Load user's keypair (v3.3.2: with integrity check)
    const walletAddress = solanaWallet.public_key || solanaWallet.solana_address;
    const keypair = loadSolanaKeypair(
      solanaWallet.solana_private_key_encrypted as EncryptedData,
      tgId,
      walletAddress  // v3.3.2: validate derived pubkey matches stored address
    );

    // v3.5: Pass tgId to executor to fetch chain-specific settings
    logger.info('Executing sell via executor', { tokenAmount, tgId });

    // 3. Execute via executor (handles routing automatically)
    const result = await solanaExecutor.executeSellWithKeypair(
      tokenMint,
      tokenAmount,
      keypair,
      { tgId }  // v3.5: Let executor fetch chain settings
    );

    if (!result.success) {
      const userMessage = translateExecutorError(result.error || 'Unknown error');
      return {
        success: false,
        error: userMessage,
        tokensSold: tokenAmount,
      };
    }

    logger.info('Sell successful', {
      txHash: result.txHash,
      solReceived: result.amountOut,
      route: result.route,
    });

    // 4. Record trade in database
    await recordTrade({
      tg_id: tgId,
      chain: 'sol',
      mode: 'snipe',
      token_address: tokenMint,
      token_symbol: 'UNKNOWN',
      type: 'SELL',
      amount_in: tokenAmount.toString(),
      amount_out: result.amountOut.toString(),
      price: result.price.toString(),
      fee_amount: '0',  // No fee on sells currently
      source: 'manual',
      tx_hash: result.txHash!,
      status: 'CONFIRMED',
    });

    return {
      success: true,
      txHash: result.txHash,
      tokensSold: tokenAmount,
      solReceived: result.amountOut,
      route: result.route,
    };
  } catch (error) {
    logger.error('Sell execution failed', error);
    const userMessage = translateExecutorError(error);

    return {
      success: false,
      error: userMessage,
      tokensSold: tokenAmount,
    };
  }
}
