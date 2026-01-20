/**
 * RAPTOR v3.1 Manual Sell Handler
 *
 * Implements direct manual sell execution with:
 * - Idempotency via callbackQuery.id
 * - Atomic budget reservation
 * - Direct execution (not queued) for <500ms latency
 *
 * Flow similar to buy but for sell:
 * 1. Generate idempotency key from ctx.callbackQuery.id + positionId
 * 2. Call reserve_trade_budget('MANUAL', ...)
 * 3. Execute sell directly via @raptor/executor
 * 4. Call update_execution() with result
 * 5. Update/close position
 * 6. Create notification
 */

import type { MyContext } from '../types.js';
import type { Chain, PositionV31 } from '@raptor/shared';
import {
  reserveTradeBudget,
  updateExecution,
  closePositionV31,
  createNotification,
  getActiveWallet,
  getUserWallets,
  getUserOpenPositions,
  getOrCreateManualSettings,
  createLogger,
  loadSolanaKeypair,
  applySellFeeDecimal,
  type EncryptedData,
} from '@raptor/shared';
import { idKeyManualSell } from '@raptor/shared';
import { parseError, isRetryableError } from '@raptor/shared';
import { solanaExecutor } from '@raptor/executor/solana';
import { InlineKeyboard } from 'grammy';
import { escapeMarkdown } from '../utils/formatters.js';

const logger = createLogger('ManualSell');

const CHAIN_SYMBOLS: Record<Chain, string> = {
  sol: 'SOL',
};

export interface ManualSellResult {
  success: boolean;
  alreadyExecuted?: boolean;
  executionId?: string;
  txHash?: string;
  error?: string;
  errorCode?: string;
  amountSold: number;
  solReceived?: number;
  grossSol?: number;
  fee?: number;
  pricePerToken?: number;
  route?: string;
  pnlSol?: number;
  pnlPercent?: number;
}

/**
 * Handle manual sell from callback (inline keyboard)
 * Called when user taps a sell button (e.g., sell:positionId:50)
 */
export async function handleManualSell(
  ctx: MyContext,
  positionId: string,
  sellPercent: number
): Promise<void> {
  const user = ctx.from;
  if (!user) return;

  // Validate percent
  if (isNaN(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
    await ctx.answerCallbackQuery({ text: 'Invalid sell percentage', show_alert: true });
    return;
  }

  // Get the callback query ID for idempotency
  const callbackQueryId = ctx.callbackQuery?.id;
  if (!callbackQueryId) {
    await ctx.reply('Invalid request. Please try again.');
    return;
  }

  // Show processing message immediately
  await ctx.answerCallbackQuery({ text: `Processing ${sellPercent}% sell...` });

  try {
    // M-2: Get user's positions with server-side filtering
    const positions = await getUserOpenPositions(user.id);
    const position = positions.find((p) => p.uuid_id === positionId);

    if (!position) {
      await ctx.reply('Position not found or already closed.');
      return;
    }

    // Only Solana supported currently
    if (position.chain !== 'sol') {
      await ctx.reply('Only Solana positions can be sold currently.');
      return;
    }

    // Calculate tokens to sell
    const tokensToSell = (position.size_tokens * sellPercent) / 100;

    // L-2 FIX: Fetch user's manual settings for slippage instead of hardcoding
    const manualSettings = await getOrCreateManualSettings(user.id);
    const slippageBps = manualSettings.default_slippage_bps || 100; // Fallback to 1%

    // Execute the manual sell with v3.1 flow
    const result = await executeManualSell({
      userId: user.id,
      position,
      tokensToSell,
      sellPercent,
      tgEventId: callbackQueryId,
      slippageBps,
    });

    // v3.4 FIX (E4): Send result as new message to preserve sell panel
    if (result.success && result.txHash) {
      const explorerUrl = `https://solscan.io/tx/${result.txHash}`;
      const pnlEmoji = (result.pnlSol || 0) >= 0 ? '📈' : '📉';

      // v3.4.2: Fetch exit market cap from DexScreener
      let exitMarketCapUsd: number | undefined;
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${position.token_mint}`);
        const dexData = await dexRes.json() as { pairs?: Array<{ fdv?: number }> };
        if (dexData.pairs?.[0]?.fdv) {
          exitMarketCapUsd = dexData.pairs[0].fdv;
        }
      } catch {
        // Ignore - will show "—" for exit MC
      }

      // Format market cap for display
      const formatMc = (mc: number | undefined) => {
        if (!mc) return '—';
        if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
        if (mc >= 1_000) return `$${(mc / 1_000).toFixed(2)}K`;
        return `$${mc.toFixed(0)}`;
      };

      await ctx.reply(
        `✅ *SELL SUCCESSFUL*\n\n` +
          `*Token:* ${position.token_symbol || 'Unknown'}\n` +
          `*Route:* ${result.route || 'Unknown'}\n` +
          `*Tokens Sold:* ${result.amountSold.toLocaleString()} (${sellPercent}%)\n` +
          `*Gross SOL:* ${result.grossSol?.toFixed(4) || '0'} SOL\n` +
          `*Platform Fee:* ${result.fee?.toFixed(4) || '0'} SOL (1%)\n` +
          `*Net SOL Received:* ${result.solReceived?.toFixed(4) || '0'} SOL\n` +
          `*Exit MC:* ${formatMc(exitMarketCapUsd)}\n\n` +
          `${pnlEmoji} *P&L:* ${(result.pnlSol || 0) >= 0 ? '+' : ''}${result.pnlSol?.toFixed(4) || '0'} SOL (${(result.pnlPercent || 0) >= 0 ? '+' : ''}${result.pnlPercent?.toFixed(2) || '0'}%)\n\n` +
          `[View Transaction](${explorerUrl})`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }
      );
    } else if (result.alreadyExecuted) {
      await ctx.reply(
        `This sell has already been processed.\n\n` +
          `Execution ID: \`${result.executionId}\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `❌ *SELL FAILED*\n\n` +
          `${escapeMarkdown(result.error || 'Unknown error')}\n\n` +
          `Please try again.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    logger.error('Manual sell handler error', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(
      `❌ *SELL FAILED*\n\n` +
        `An unexpected error occurred: ${escapeMarkdown(errorMsg)}\n\n` +
        `Please try again or contact support.`,
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Show positions for selling
 */
export async function showPositionsForSell(ctx: MyContext): Promise<void> {
  const user = ctx.from;
  if (!user) return;

  // M-2: Get user's positions with server-side filtering
  const userPositions = await getUserOpenPositions(user.id);

  if (userPositions.length === 0) {
    await ctx.reply(
      'You have no active positions to sell.\n\n' +
        'Use /snipe to open a new position.'
    );
    return;
  }

  let message = '*Your Active Positions*\n\n';
  const keyboard = new InlineKeyboard();

  for (let i = 0; i < userPositions.length && i < 10; i++) {
    const p = userPositions[i];
    const pnlPercent = calculatePnlPercent(p);
    const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';
    const symbol = CHAIN_SYMBOLS[p.chain];

    message += `${pnlEmoji} *${p.token_symbol || 'Unknown'}* (${p.chain.toUpperCase()})\n`;
    message += `   Entry: ${p.entry_price.toFixed(9)} ${symbol}\n`;
    message += `   Current: ${(p.current_price || p.entry_price).toFixed(9)} ${symbol}\n`;
    message += `   P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%\n\n`;

    // Add sell buttons
    keyboard
      .text(`Sell 50% ${p.token_symbol || 'Token'}`, `sell_v31:${p.id}:50`)
      .text(`Sell 100% ${p.token_symbol || 'Token'}`, `sell_v31:${p.id}:100`)
      .row();
  }

  message += 'Select a position to sell.';

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Execute a manual sell with v3.1 idempotency and budget reservation
 */
export async function executeManualSell(params: {
  userId: number;
  position: PositionV31;
  tokensToSell: number;
  sellPercent: number;
  tgEventId: string | number;
  slippageBps: number; // L-2 FIX: Use user's slippage setting
}): Promise<ManualSellResult> {
  const { userId, position, tokensToSell, sellPercent, tgEventId, slippageBps } = params;
  const chain = position.chain;

  logger.info('Starting manual sell', { userId, positionId: position.uuid_id, tokensToSell });

  // Step 1: Generate idempotency key
  const idempotencyKey = idKeyManualSell({
    chain,
    userId,
    mint: position.token_mint,
    positionId: position.uuid_id,
    tgEventId,
    sellPercent,
  });

  logger.debug('Generated idempotency key', { idempotencyKey });

  // Step 2: Reserve budget atomically (SELL doesn't spend budget, but tracks execution)
  const reservation = await reserveTradeBudget({
    mode: 'MANUAL',
    userId,
    strategyId: position.strategy_id,
    chain,
    action: 'SELL',
    tokenMint: position.token_mint,
    amountSol: 0, // SELL doesn't spend SOL budget
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
        error: 'This sell has already been processed',
        amountSold: tokensToSell,
      };
    }

    return {
      success: false,
      error: reservation.reason || 'Trade not allowed',
      amountSold: tokensToSell,
    };
  }

  const executionId = reservation.execution_id;
  if (!executionId) {
    return {
      success: false,
      error: 'Failed to create execution record',
      amountSold: tokensToSell,
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
      amountSold: tokensToSell,
    };
  }

  // Step 4: Load keypair (v3.3.2: with integrity check)
  const walletAddress = activeWallet.public_key || activeWallet.solana_address;
  const keypair = loadSolanaKeypair(
    activeWallet.solana_private_key_encrypted as EncryptedData,
    userId,
    walletAddress  // v3.3.2: validate derived pubkey matches stored address
  );

  // Step 5: Mark execution as SUBMITTED
  await updateExecution({
    executionId,
    status: 'SUBMITTED',
  });

  // Step 6: Execute sell via executor
  // v3.5: Pass tgId to executor to fetch chain-specific settings (slippage, priority, anti-MEV)
  // v4.6 DECIMALS FIX: Use sellPercent option - executor will fetch fresh balance from chain
  logger.info('Executing sell via executor', { sellPercent, userId });

  try {
    const result = await solanaExecutor.executeSellWithKeypair(
      position.token_mint,
      0,  // v4.6: tokenAmount is ignored when sellPercent is provided
      keypair,
      { tgId: userId, sellPercent }  // v4.6: Use percent-based selling with fresh on-chain balance
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
        error: translateSellError(message),
        errorCode: code,
        amountSold: tokensToSell,
      };
    }

    // Calculate fee
    const grossSol = result.amountOut; // SOL received before fee
    const { netAmount, fee } = applySellFeeDecimal(grossSol);

    // Calculate P&L
    const proportionalEntryCost = (position.entry_cost_sol * sellPercent) / 100;
    const pnlSol = netAmount - proportionalEntryCost;
    const pnlPercent = proportionalEntryCost > 0
      ? ((netAmount - proportionalEntryCost) / proportionalEntryCost) * 100
      : 0;

    // Step 7: Update execution as CONFIRMED
    await updateExecution({
      executionId,
      status: 'CONFIRMED',
      txSig: result.txHash,
      tokensOut: grossSol, // For sells, tokensOut is SOL received
      pricePerToken: result.price,
      result: {
        route: result.route,
        tokensSold: tokensToSell,
        fee,
        netSol: netAmount,
        pnlSol,
        pnlPercent,
      },
    });

    // Step 8: Close or update position
    if (sellPercent >= 100) {
      // Full sell - close position
      await closePositionV31({
        positionId: position.uuid_id,
        exitExecutionId: executionId,
        exitTxSig: result.txHash,
        exitPrice: result.price,
        exitTrigger: 'MANUAL', // Manual exit
        realizedPnlSol: pnlSol,
        realizedPnlPercent: pnlPercent,
      });
    } else {
      // Partial sell - update position size
      // Note: For simplicity, we're closing on any sell.
      // A more complete implementation would track partial exits.
      await closePositionV31({
        positionId: position.uuid_id,
        exitExecutionId: executionId,
        exitTxSig: result.txHash,
        exitPrice: result.price,
        exitTrigger: 'MANUAL',
        realizedPnlSol: pnlSol,
        realizedPnlPercent: pnlPercent,
      });
    }

    logger.info('Sell completed', { executionId, pnlSol, pnlPercent });

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
        positionId: position.uuid_id,
      },
    });

    return {
      success: true,
      executionId,
      txHash: result.txHash,
      amountSold: tokensToSell,
      grossSol,
      fee,
      solReceived: netAmount,
      pricePerToken: result.price,
      route: result.route,
      pnlSol,
      pnlPercent,
    };
  } catch (error) {
    logger.error('Sell execution failed', error);

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
      error: translateSellError(message),
      errorCode: code,
      amountSold: tokensToSell,
    };
  }
}

/**
 * Calculate P&L percent for a position
 */
function calculatePnlPercent(position: PositionV31): number {
  if (position.entry_price <= 0) return 0;
  const currentPrice = position.current_price || position.entry_price;
  return ((currentPrice - position.entry_price) / position.entry_price) * 100;
}

/**
 * Translate sell errors to user-friendly messages
 */
function translateSellError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('insufficient') || lower.includes('not enough')) {
    return 'Insufficient token balance. You may have already sold this position.';
  }
  if (lower.includes('no route') || lower.includes('no liquidity')) {
    return 'No liquidity available. The token may have been rugged or has no buyers.';
  }
  if (lower.includes('simulation failed')) {
    return `Transaction simulation failed: ${message}`;
  }
  if (lower.includes('transaction failed')) {
    return 'Transaction failed on-chain. The token may have sell restrictions.';
  }
  if (lower.includes('rpc') || lower.includes('network') || lower.includes('timeout')) {
    return 'Network error. Please try again.';
  }
  if (lower.includes('frozen')) {
    return 'Token is frozen and cannot be sold.';
  }

  return message;
}
