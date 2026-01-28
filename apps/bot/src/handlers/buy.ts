/**
 * RAPTOR v3.1 Manual Buy Handler
 *
 * Implements direct manual trade execution with:
 * - Idempotency via callbackQuery.id
 * - Atomic budget reservation
 * - Direct execution (not queued) for <500ms latency
 *
 * Flow per RAPTOR_V31_ARCHITECTURE.md §8.1:
 * 1. Generate idempotency key from ctx.callbackQuery.id
 * 2. Call reserve_trade_budget('MANUAL', ...)
 * 3. Execute trade directly via @raptor/executor
 * 4. Call update_execution() with result
 * 5. Create position
 * 6. Set cooldown
 */

import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import {
  reserveTradeBudget,
  updateExecution,
  createPositionV31,
  setCooldown,
  createNotification,
  getActiveWallet,
  getUserWallets,
  getUserDefaultStrategy,
  getOrCreateManualSettings,
  createLogger,
  loadSolanaKeypair,
  applyBuyFeeDecimal,
  type EncryptedData,
} from '@raptor/shared';
import { idKeyManualBuy } from '@raptor/shared';
import { parseError, isRetryableError } from '@raptor/shared';
import { solanaExecutor } from '@raptor/executor/solana';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { escapeMarkdown } from '../utils/formatters.js';
import { createTradeMonitor } from '../services/tradeMonitor.js';
import { Bot, Context } from 'grammy';

const logger = createLogger('ManualBuy');

// Solana RPC URL
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export interface ManualBuyResult {
  success: boolean;
  alreadyExecuted?: boolean;
  executionId?: string;
  positionId?: string;
  txHash?: string;
  error?: string;
  errorCode?: string;
  amountIn: number;
  netAmount?: number;
  fee?: number;
  tokensReceived?: number;
  pricePerToken?: number;
  route?: string;
}

/**
 * Handle manual buy from callback (inline keyboard)
 * Called when user taps a buy button (e.g., buy:sol:ABC123:0.5)
 */
export async function handleManualBuy(
  ctx: MyContext,
  chain: Chain,
  tokenMint: string,
  amountSol: number
): Promise<void> {
  const user = ctx.from;
  if (!user) return;

  // Only Solana supported currently
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({
      text: 'Only Solana is supported currently',
      show_alert: true,
    });
    return;
  }

  // Validate amount
  if (isNaN(amountSol) || amountSol <= 0) {
    await ctx.answerCallbackQuery({ text: 'Invalid amount', show_alert: true });
    return;
  }

  // Minimum amount check
  if (amountSol < 0.01) {
    await ctx.answerCallbackQuery({
      text: 'Minimum buy amount is 0.01 SOL',
      show_alert: true,
    });
    return;
  }

  // Get the callback query ID for idempotency
  const callbackQueryId = ctx.callbackQuery?.id;
  if (!callbackQueryId) {
    await ctx.reply('Invalid request. Please try again.');
    return;
  }

  // Show processing message immediately
  await ctx.answerCallbackQuery({ text: `Processing ${amountSol} SOL buy...` });

  try {
    // L-2 FIX: Fetch user's manual settings for slippage instead of hardcoding
    const manualSettings = await getOrCreateManualSettings(user.id);
    const slippageBps = manualSettings.default_slippage_bps || 50; // Fallback to 0.5%

    // Execute the manual buy with v3.1 flow
    const result = await executeManualBuy({
      userId: user.id,
      chain,
      tokenMint,
      amountSol,
      tgEventId: callbackQueryId,
      slippageBps,
    });

    // Display result
    if (result.success && result.txHash) {
      const explorerUrl = `https://solscan.io/tx/${result.txHash}`;

      await ctx.reply(
        `✅ *BUY SUCCESSFUL*\n\n` +
          `*Route:* ${result.route || 'Unknown'}\n` +
          `*Gross Amount:* ${result.amountIn} SOL\n` +
          `*Platform Fee:* ${result.fee?.toFixed(4) || '0'} SOL (1%)\n` +
          `*Net Amount:* ${result.netAmount?.toFixed(4) || '0'} SOL\n` +
          `*Tokens Received:* ${result.tokensReceived?.toLocaleString() || '0'}\n` +
          `*Price:* ${result.pricePerToken?.toFixed(9) || '0'} SOL per token\n\n` +
          `[View Transaction](${explorerUrl})`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }
      );
    } else if (result.alreadyExecuted) {
      // Idempotency check - already executed
      await ctx.reply(
        `This buy has already been executed.\n\n` +
          `Execution ID: \`${result.executionId}\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      // Error message
      await ctx.reply(
        `❌ *BUY FAILED*\n\n` +
          `${escapeMarkdown(result.error || 'Unknown error')}\n\n` +
          `Please check your wallet balance and try again.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    logger.error('Manual buy handler error', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(
      `❌ *BUY FAILED*\n\n` +
        `An unexpected error occurred: ${escapeMarkdown(errorMsg)}\n\n` +
        `Please try again or contact support.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Execute a manual buy with v3.1 idempotency and budget reservation
 */
export async function executeManualBuy(params: {
  userId: number;
  chain: Chain;
  tokenMint: string;
  amountSol: number;
  tgEventId: string | number;
  slippageBps: number;
}): Promise<ManualBuyResult> {
  const { userId, chain, tokenMint, amountSol, tgEventId, slippageBps } = params;

  logger.info('Starting manual buy', { userId, chain, tokenMint, amountSol });

  // Step 1: Generate idempotency key
  const idempotencyKey = idKeyManualBuy({
    chain,
    userId,
    mint: tokenMint,
    tgEventId,
    amountSol,
    slippageBps,
  });

  logger.debug('Generated idempotency key', { idempotencyKey });

  // Step 2: Get user's default strategy (or use NULL for manual-only)
  let strategyId: string | null = null;
  try {
    const strategy = await getUserDefaultStrategy(userId, chain);
    strategyId = strategy?.id || null;
  } catch {
    // No default strategy is fine for manual trades
  }

  // Step 3: Reserve budget atomically
  const reservation = await reserveTradeBudget({
    mode: 'MANUAL',
    userId,
    strategyId: strategyId || '00000000-0000-0000-0000-000000000000', // NULL UUID for manual-only
    chain,
    action: 'BUY',
    tokenMint,
    amountSol,
    idempotencyKey,
  });

  logger.debug('Budget reservation result', { reservation });

  // Check if already executed
  if (!reservation.allowed) {
    if (reservation.reason === 'Already executed') {
      return {
        success: false,
        alreadyExecuted: true,
        executionId: reservation.execution_id,
        error: 'This buy has already been processed',
        amountIn: amountSol,
      };
    }

    // Other rejection (paused, circuit open, budget exceeded, etc.)
    return {
      success: false,
      error: reservation.reason || 'Trade not allowed',
      amountIn: amountSol,
    };
  }

  const executionId = reservation.execution_id;
  if (!executionId) {
    return {
      success: false,
      error: 'Failed to create execution record',
      amountIn: amountSol,
    };
  }

  // Step 4: Get user's active wallet
  const wallets = await getUserWallets(userId);
  const activeWallet = wallets.find((w) => w.chain === chain && w.is_active);

  if (!activeWallet) {
    // Update execution as FAILED
    await updateExecution({
      executionId,
      status: 'FAILED',
      error: 'No active wallet found',
      errorCode: 'NO_WALLET',
    });
    return {
      success: false,
      error: 'No active Solana wallet found. Please create a wallet first.',
      amountIn: amountSol,
    };
  }

  // Step 5: Check balance
  // Use public_key (v3.1) with fallback to solana_address (legacy)
  const walletAddress = activeWallet.public_key || activeWallet.solana_address;
  if (!walletAddress) {
    await updateExecution({
      executionId,
      status: 'FAILED',
      error: 'Wallet address not found',
      errorCode: 'INVALID_WALLET',
    });
    return {
      success: false,
      error: 'Wallet address not found. Please recreate your wallet.',
      amountIn: amountSol,
    };
  }

  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const publicKey = new PublicKey(walletAddress);
  const balance = await connection.getBalance(publicKey, 'finalized');
  const balanceSOL = balance / LAMPORTS_PER_SOL;

  logger.info('Wallet balance', { address: walletAddress, balanceSOL });

  if (balanceSOL < amountSol) {
    await updateExecution({
      executionId,
      status: 'FAILED',
      error: `Insufficient funds. Balance: ${balanceSOL.toFixed(4)} SOL`,
      errorCode: 'INSUFFICIENT_FUNDS',
    });
    return {
      success: false,
      error: `Insufficient funds. Balance: ${balanceSOL.toFixed(4)} SOL, Required: ${amountSol} SOL`,
      amountIn: amountSol,
    };
  }

  // Step 6: Calculate fee breakdown
  const { netAmount, fee } = applyBuyFeeDecimal(amountSol);

  // Step 7: Load keypair (v3.3.2: with integrity check)
  const keypair = loadSolanaKeypair(
    activeWallet.solana_private_key_encrypted as EncryptedData,
    userId,
    walletAddress  // v3.3.2: validate derived pubkey matches stored address
  );

  // Step 8: Mark execution as SUBMITTED
  await updateExecution({
    executionId,
    status: 'SUBMITTED',
  });

  // Step 9: Execute via executor
  // v3.5: Pass tgId to executor to fetch chain-specific settings (slippage, priority, anti-MEV)
  logger.info('Executing buy via executor', { netAmount, fee, userId });

  try {
    const result = await solanaExecutor.executeBuyWithKeypair(
      tokenMint,
      amountSol, // Pass GROSS amount (executor applies fee)
      keypair,
      { tgId: userId } // v3.5: Let executor fetch chain settings
    );

    if (!result.success) {
      // Parse error for classification
      const { code, message } = parseError(result.error || 'Unknown error');
      const retryable = isRetryableError(code);

      await updateExecution({
        executionId,
        status: 'FAILED',
        error: message,
        errorCode: code,
      });

      return {
        success: false,
        executionId,
        error: translateError(message),
        errorCode: code,
        amountIn: amountSol,
      };
    }

    // Step 10: Update execution as CONFIRMED
    await updateExecution({
      executionId,
      status: 'CONFIRMED',
      txSig: result.txHash,
      tokensOut: result.amountOut,
      pricePerToken: result.price,
      result: {
        route: result.route,
        amountIn: result.amountIn,
        fee: result.fee,
      },
    });

    // Step 11: Create position
    const position = await createPositionV31({
      userId,
      strategyId: strategyId || '00000000-0000-0000-0000-000000000000',
      chain,
      tokenMint,
      tokenSymbol: 'UNKNOWN', // TODO: fetch metadata
      entryExecutionId: executionId,
      entryTxSig: result.txHash,
      entryCostSol: netAmount,
      entryPrice: result.price,
      sizeTokens: result.amountOut,
    });

    logger.info('Position created', { positionId: position.uuid_id });

    // Step 12: Set cooldown (prevent immediate re-buy of same token)
    await setCooldown({
      chain,
      cooldownType: 'USER_MINT',
      target: `${userId}:${tokenMint}`,
      durationSeconds: 300, // 5 minute cooldown
      reason: 'Manual buy completed',
    });

    // Step 13: Create notification for the user
    await createNotification({
      userId,
      type: 'BUY_CONFIRMED',
      payload: {
        chain,
        tokenMint,
        amountSol: netAmount,
        tokensReceived: result.amountOut,
        price: result.price,
        txHash: result.txHash,
        route: result.route,
        positionId: position.uuid_id,
      },
    });

    return {
      success: true,
      executionId,
      positionId: position.uuid_id,
      txHash: result.txHash,
      amountIn: amountSol,
      netAmount: result.amountIn,
      fee: result.fee,
      tokensReceived: result.amountOut,
      pricePerToken: result.price,
      route: result.route,
    };
  } catch (error) {
    logger.error('Buy execution failed', error);

    // Parse and classify error
    const { code, message } = parseError(error);

    await updateExecution({
      executionId,
      status: 'FAILED',
      error: message,
      errorCode: code,
    });

    return {
      success: false,
      executionId,
      error: translateError(message),
      errorCode: code,
      amountIn: amountSol,
    };
  }
}

/**
 * Translate executor errors to user-friendly messages
 */
function translateError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid') && lower.includes('address')) {
    return 'Invalid token address';
  }
  if (lower.includes('minimum') || lower.includes('min')) {
    return 'Amount below minimum position size (0.01 SOL)';
  }
  if (lower.includes('not found') || lower.includes('does not exist')) {
    return 'Token not found on-chain. Check the address.';
  }
  if (lower.includes('no route') || lower.includes('no liquidity')) {
    return 'No liquidity available for this token. Token may be too new or has no active trading pools.';
  }
  if (lower.includes('simulation failed') || lower.includes('custom program error')) {
    return `Transaction simulation failed: ${message}`;
  }
  if (lower.includes('transaction failed')) {
    return 'Transaction failed on-chain. Possible causes: slippage too low, insufficient SOL for fees, or trading restrictions.';
  }
  if (lower.includes('rpc') || lower.includes('network') || lower.includes('timeout')) {
    return 'Network error. Please try again.';
  }
  if (lower.includes('insufficient') || lower.includes('not enough')) {
    return 'Insufficient SOL balance. Please add funds.';
  }
  if (lower.includes('graduated')) {
    return 'Token has graduated from bonding curve. Routing via Jupiter...';
  }

  return message;
}
