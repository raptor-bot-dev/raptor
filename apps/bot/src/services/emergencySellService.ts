/**
 * RAPTOR v3.1 Emergency Sell Service
 *
 * Implements emergency sell functionality with:
 * - Idempotency via position ID + EMERGENCY trigger (one emergency sell per position)
 * - Atomic budget reservation
 * - Higher slippage tolerance (15%) for faster execution
 * - Full position exit (100%)
 *
 * Flow:
 * 1. Generate idempotency key using idKeyExitSell with trigger='EMERGENCY'
 * 2. Call reserve_trade_budget('MANUAL', ...) for atomic tracking
 * 3. Execute sell via @raptor/executor with high slippage
 * 4. Call update_execution() with result
 * 5. Close position with exitTrigger='EMERGENCY'
 * 6. Create notification
 */

import type { PositionV31 } from '@raptor/shared';
import {
  reserveTradeBudget,
  updateExecution,
  closePositionV31,
  createNotification,
  getUserWallets,
  createLogger,
  loadSolanaKeypair,
  applySellFeeDecimal,
  type EncryptedData,
} from '@raptor/shared';
import { idKeyExitSell } from '@raptor/shared';
import { parseError } from '@raptor/shared';
import { solanaExecutor } from '@raptor/executor/solana';

const logger = createLogger('EmergencySell');

// Emergency sell uses higher slippage for faster execution
const EMERGENCY_SLIPPAGE_BPS = 1500; // 15%

export interface EmergencySellResult {
  success: boolean;
  alreadyExecuted?: boolean;
  executionId?: string;
  txHash?: string;
  error?: string;
  errorCode?: string;
  tokensSold: number;
  solReceived?: number;
  grossSol?: number;
  fee?: number;
  pricePerToken?: number;
  route?: string;
  pnlSol?: number;
  pnlPercent?: number;
}

/**
 * Execute emergency sell for a position
 *
 * Uses idKeyExitSell for idempotency - same position + EMERGENCY trigger = one sell only
 * This prevents double-selling even if user clicks multiple times
 */
export async function executeEmergencySell(params: {
  userId: number;
  position: PositionV31;
}): Promise<EmergencySellResult> {
  const { userId, position } = params;
  const chain = position.chain;
  const tokensToSell = position.size_tokens;

  logger.info('Starting emergency sell', { userId, positionId: position.uuid_id, tokensToSell });

  // Step 1: Generate idempotency key using exit trigger
  // This ensures only ONE emergency sell per position (regardless of how many times clicked)
  const idempotencyKey = idKeyExitSell({
    chain,
    mint: position.token_mint,
    positionId: position.uuid_id,
    trigger: 'EMERGENCY',
    sellPercent: 100,
  });

  logger.debug('Generated idempotency key', { idempotencyKey });

  // Step 2: Reserve budget atomically (SELL doesn't spend budget, but tracks execution)
  const reservation = await reserveTradeBudget({
    mode: 'MANUAL', // Use MANUAL mode for bot-initiated sells
    userId,
    strategyId: position.strategy_id,
    chain,
    action: 'SELL',
    tokenMint: position.token_mint,
    amountSol: 0, // SELL doesn't spend SOL budget
    idempotencyKey,
  });

  logger.debug('Budget reservation result', { reservation });

  // Check if already executed (idempotency check)
  if (!reservation.allowed) {
    if (reservation.reason === 'Already executed') {
      logger.info('Emergency sell already executed', { positionId: position.uuid_id, executionId: reservation.execution_id });
      return {
        success: false,
        alreadyExecuted: true,
        executionId: reservation.execution_id,
        error: 'Emergency sell already submitted for this position',
        tokensSold: tokensToSell,
      };
    }

    return {
      success: false,
      error: reservation.reason || 'Trade not allowed',
      tokensSold: tokensToSell,
    };
  }

  const executionId = reservation.execution_id;
  if (!executionId) {
    return {
      success: false,
      error: 'Failed to create execution record',
      tokensSold: tokensToSell,
    };
  }

  // Step 3: Get user's active wallet
  const wallets = await getUserWallets(userId);
  const activeWallet = wallets.find((w) => w.chain === chain && w.is_active);

  if (!activeWallet) {
    await updateExecution({
      executionId,
      status: 'FAILED',
      error: 'No active wallet found',
      errorCode: 'NO_WALLET',
    });
    return {
      success: false,
      error: 'No active Solana wallet found.',
      tokensSold: tokensToSell,
    };
  }

  // Step 4: Load keypair with integrity check
  const walletAddress = activeWallet.public_key || activeWallet.solana_address;
  let keypair;
  try {
    keypair = loadSolanaKeypair(
      activeWallet.solana_private_key_encrypted as EncryptedData,
      userId,
      walletAddress
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await updateExecution({
      executionId,
      status: 'FAILED',
      error: errorMsg,
      errorCode: 'KEYPAIR_ERROR',
    });
    return {
      success: false,
      error: 'Failed to load wallet keypair.',
      tokensSold: tokensToSell,
    };
  }

  // Step 5: Mark execution as SUBMITTED
  await updateExecution({
    executionId,
    status: 'SUBMITTED',
  });

  // Step 6: Execute sell via executor with high slippage for emergency
  logger.info('Executing emergency sell via executor', { tokensToSell, userId, slippageBps: EMERGENCY_SLIPPAGE_BPS });

  try {
    const result = await solanaExecutor.executeSellWithKeypair(
      position.token_mint,
      tokensToSell,
      keypair,
      {
        tgId: userId,
        slippageBps: EMERGENCY_SLIPPAGE_BPS, // Override with high slippage
      }
    );

    if (!result.success) {
      const { code, message } = parseError(result.error || 'Unknown error');

      await updateExecution({
        executionId,
        status: 'FAILED',
        error: message,
        errorCode: code,
      });

      return {
        success: false,
        executionId,
        error: translateEmergencySellError(message),
        errorCode: code,
        tokensSold: tokensToSell,
      };
    }

    // Calculate fee
    const grossSol = result.amountOut;
    const { netAmount, fee } = applySellFeeDecimal(grossSol);

    // Calculate P&L
    const pnlSol = netAmount - position.entry_cost_sol;
    const pnlPercent = position.entry_cost_sol > 0
      ? ((netAmount - position.entry_cost_sol) / position.entry_cost_sol) * 100
      : 0;

    // Step 7: Update execution as CONFIRMED
    await updateExecution({
      executionId,
      status: 'CONFIRMED',
      txSig: result.txHash,
      tokensOut: grossSol,
      pricePerToken: result.price,
      result: {
        route: result.route,
        tokensSold: tokensToSell,
        fee,
        netSol: netAmount,
        pnlSol,
        pnlPercent,
        trigger: 'EMERGENCY',
      },
    });

    // Step 8: Close position with EMERGENCY trigger
    await closePositionV31({
      positionId: position.uuid_id,
      exitExecutionId: executionId,
      exitTxSig: result.txHash,
      exitPrice: result.price,
      exitTrigger: 'EMERGENCY',
      realizedPnlSol: pnlSol,
      realizedPnlPercent: pnlPercent,
    });

    logger.info('Emergency sell completed', { executionId, pnlSol, pnlPercent, txHash: result.txHash });

    // Step 9: Create notification
    await createNotification({
      userId,
      type: 'SELL_CONFIRMED',
      payload: {
        chain,
        tokenMint: position.token_mint,
        tokenSymbol: position.token_symbol,
        tokensSold: tokensToSell,
        solReceived: netAmount,
        price: result.price,
        txHash: result.txHash,
        route: result.route,
        pnlSol,
        pnlPercent,
        positionId: position.id,
        trigger: 'EMERGENCY',
      },
    });

    return {
      success: true,
      executionId,
      txHash: result.txHash,
      tokensSold: tokensToSell,
      solReceived: netAmount,
      grossSol,
      fee,
      pricePerToken: result.price,
      route: result.route,
      pnlSol,
      pnlPercent,
    };
  } catch (error) {
    const { code, message } = parseError(error);
    logger.error('Emergency sell execution error', { error, executionId });

    await updateExecution({
      executionId,
      status: 'FAILED',
      error: message,
      errorCode: code,
    });

    return {
      success: false,
      executionId,
      error: translateEmergencySellError(message),
      errorCode: code,
      tokensSold: tokensToSell,
    };
  }
}

/**
 * Translate error messages to user-friendly text
 */
function translateEmergencySellError(errorMessage: string): string {
  const lowered = errorMessage.toLowerCase();

  if (lowered.includes('insufficient') || lowered.includes('balance')) {
    return 'Insufficient token balance. The position may have already been sold.';
  }
  if (lowered.includes('slippage') || lowered.includes('price')) {
    return 'Price moved too much. Please try again.';
  }
  if (lowered.includes('timeout') || lowered.includes('network')) {
    return 'Network error. Please try again in a moment.';
  }
  if (lowered.includes('rate limit')) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  return errorMessage;
}
