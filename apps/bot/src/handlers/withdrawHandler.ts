/**
 * Withdraw Handler - Routes withdraw:* callbacks
 * Reference: MUST_READ/PROMPT.md
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { MyContext } from '../types.js';
import { CB, SESSION_STEPS } from '../ui/callbackIds.js';
import {
  renderWithdraw,
  renderWithdrawSolPrompt,
  renderWithdrawPercentPrompt,
  renderWithdrawConfirm,
  renderWithdrawSuccess,
  renderWithdrawError,
  type WithdrawData,
  type WithdrawConfirmData,
} from '../ui/panels/withdraw.js';
import { getUserWallets } from '@raptor/shared';
import { processWithdrawal } from '../services/wallet.js';
import { showHome } from './home.js';
import {
  BUFFER_SOL,
  maxWithdraw,
  validateSolAmount,
  validatePercent,
  computeSolFromPercent,
  lamportsToSol,
  isValidSolanaAddress,
} from '../utils/withdrawMath.js';

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Get Solana balance for an address (returns lamports)
 */
async function getSolanaBalanceLamports(address: string): Promise<number> {
  if (!address) return 0;
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const balance = await connection.getBalance(new PublicKey(address), 'finalized');
    return balance;
  } catch {
    return 0;
  }
}

/**
 * Handle withdraw:* callbacks
 */
export async function handleWithdrawCallbacks(ctx: MyContext, data: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  switch (data) {
    case CB.WITHDRAW.OPEN:
      await showWithdrawHome(ctx);
      break;

    case CB.WITHDRAW.SET_DESTINATION:
      await showSetDestination(ctx);
      break;

    case CB.WITHDRAW.AMOUNT_SOL:
      await showAmountSolPrompt(ctx);
      break;

    case CB.WITHDRAW.AMOUNT_PCT:
      await showAmountPercentPrompt(ctx);
      break;

    case CB.WITHDRAW.CONFIRM:
      await confirmWithdraw(ctx);
      break;

    case CB.WITHDRAW.CANCEL:
      await showHome(ctx);
      break;

    default:
      console.warn(`Unknown withdraw callback: ${data}`);
      await ctx.answerCallbackQuery('Unknown action');
  }
}

/**
 * Show withdraw home panel
 */
export async function showWithdrawHome(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // Mark this chat as using the new withdraw panel flow so text input routes correctly.
    if (ctx.session) {
      ctx.session.withdrawUi = 'panel';
    }

    const wallets = await getUserWallets(userId);
    if (wallets.length === 0) {
      await ctx.answerCallbackQuery('No wallet found');
      return;
    }

    const wallet = wallets[0];
    const balanceLamports = await getSolanaBalanceLamports(wallet.solana_address || '');
    const balanceSol = lamportsToSol(balanceLamports);
    const maxWithdrawSol = maxWithdraw(balanceSol);

    // Get destination from session pending withdrawal
    const destination = ctx.session?.pendingWithdrawal?.address || '';

    const withdrawData: WithdrawData = {
      walletAddress: wallet.solana_address || '',
      balanceSol,
      bufferSol: BUFFER_SOL,
      maxWithdrawSol,
      destinationAddress: destination || undefined,
    };

    const panel = renderWithdraw(withdrawData);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error showing withdraw home:', error);
    await ctx.answerCallbackQuery('Error loading wallet');
  }
}

/**
 * Show destination input prompt
 */
async function showSetDestination(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    if (ctx.session) {
      ctx.session.withdrawUi = 'panel';
      ctx.session.step = SESSION_STEPS.AWAITING_WITHDRAWAL_ADDRESS;
    }

    await ctx.editMessageText(
      '📤 <b>Set Withdrawal Destination</b>\n\n' +
        'Enter the Solana address to send funds to:\n\n' +
        '<i>Must be a valid base58 Solana address</i>',
      { parse_mode: 'HTML' }
    );
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show SOL amount input prompt
 */
async function showAmountSolPrompt(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const wallets = await getUserWallets(userId);
    if (wallets.length === 0) return;

    const wallet = wallets[0];
    const balanceLamports = await getSolanaBalanceLamports(wallet.solana_address || '');
    const balanceSol = lamportsToSol(balanceLamports);
    const maxWithdrawSol = maxWithdraw(balanceSol);

    if (ctx.session) {
      ctx.session.withdrawUi = 'panel';
      ctx.session.step = SESSION_STEPS.AWAITING_WITHDRAWAL_AMOUNT;
    }

    const panel = renderWithdrawSolPrompt(maxWithdrawSol);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show percent amount input prompt
 */
async function showAmountPercentPrompt(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    if (ctx.session) {
      ctx.session.withdrawUi = 'panel';
      ctx.session.step = SESSION_STEPS.AWAITING_WITHDRAWAL_PERCENT;
    }

    const panel = renderWithdrawPercentPrompt();
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Execute withdrawal
 */
async function confirmWithdraw(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const destination = ctx.session?.pendingWithdrawal?.address;
    const amountStr = ctx.session?.pendingWithdrawal?.amount;
    const amountSol = amountStr ? parseFloat(amountStr) : undefined;

    if (!destination || !amountSol) {
      await ctx.answerCallbackQuery('Missing withdrawal info');
      return;
    }

    // Re-check balance before send
    const wallets = await getUserWallets(userId);
    if (wallets.length === 0) {
      const panel = renderWithdrawError('No wallet found');
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery('Error');
      return;
    }

    const wallet = wallets[0];
    const balanceLamports = await getSolanaBalanceLamports(wallet.solana_address || '');
    const balanceSol = lamportsToSol(balanceLamports);
    const maxWithdrawSol = maxWithdraw(balanceSol);

    if (!validateSolAmount(amountSol, balanceSol)) {
      const panel = renderWithdrawError(
        `Insufficient balance. Max withdraw: ${maxWithdrawSol.toFixed(4)} SOL`
      );
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery('Insufficient balance');
      return;
    }

    // Execute withdrawal using wallet service (wallet_index starts at 1)
    const result = await processWithdrawal(
      userId,
      'sol',
      wallet.wallet_index,
      amountSol.toString(),
      destination
    );
    const txSig = result.hash;

    // Clear session
    if (ctx.session) {
      ctx.session.pendingWithdrawal = null;
      ctx.session.step = null;
      ctx.session.withdrawUi = null;
    }

    const panel = renderWithdrawSuccess(amountSol, destination, txSig);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery('Withdrawal submitted');
  } catch (error) {
    console.error('Error executing withdraw:', error);
    const panel = renderWithdrawError('Failed to send transaction');
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Handle withdraw input from text messages
 */
export async function handleWithdrawInput(
  ctx: MyContext,
  step: string,
  input: string
): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  try {
    switch (step) {
      case SESSION_STEPS.AWAITING_WITHDRAWAL_ADDRESS: {
        // Validate Solana address (basic check)
        const trimmed = input.trim();
        if (!isValidSolanaAddress(trimmed)) {
          await ctx.reply('Invalid address. Must be a valid Solana address.');
          return true;
        }

        // Store destination in pendingWithdrawal
        if (ctx.session) {
          ctx.session.pendingWithdrawal = {
            ...(ctx.session.pendingWithdrawal || { chain: 'sol', walletIndex: 1 }),
            address: trimmed,
          };
          ctx.session.step = null;
        }

        await ctx.reply('Destination set. Returning to withdraw panel...');
        await showWithdrawHome(ctx);
        return true;
      }

      case SESSION_STEPS.AWAITING_WITHDRAWAL_AMOUNT: {
        const amount = parseFloat(input);
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply('Invalid amount. Enter a positive number.');
          return true;
        }

        // Get max withdraw
        const wallets = await getUserWallets(userId);
        if (wallets.length === 0) {
          await ctx.reply('No wallet found.');
          return true;
        }

        const wallet = wallets[0];
        const balanceLamports = await getSolanaBalanceLamports(wallet.solana_address || '');
        const balanceSol = lamportsToSol(balanceLamports);
        const maxWithdrawSol = maxWithdraw(balanceSol);

        if (!validateSolAmount(amount, balanceSol)) {
          await ctx.reply(`Amount exceeds max withdraw: ${maxWithdrawSol.toFixed(4)} SOL`);
          return true;
        }

        // Store amount in pendingWithdrawal and show confirm
        if (ctx.session) {
          ctx.session.pendingWithdrawal = {
            ...(ctx.session.pendingWithdrawal || { chain: 'sol', walletIndex: 1 }),
            amount: amount.toString(),
          };
          ctx.session.step = null;
        }

        await showWithdrawConfirm(ctx, amount);
        return true;
      }

      case SESSION_STEPS.AWAITING_WITHDRAWAL_PERCENT: {
        const percent = parseFloat(input);
        if (!validatePercent(percent)) {
          await ctx.reply('Invalid percent. Enter a value between 1 and 100.');
          return true;
        }

        // Calculate amount from percent
        const walletsPct = await getUserWallets(userId);
        if (walletsPct.length === 0) {
          await ctx.reply('No wallet found.');
          return true;
        }

        const walletPct = walletsPct[0];
        const balanceLamportsPct = await getSolanaBalanceLamports(walletPct.solana_address || '');
        const balanceSolPct = lamportsToSol(balanceLamportsPct);
        const amountPct = computeSolFromPercent(balanceSolPct, percent);

        if (amountPct <= 0) {
          await ctx.reply('Insufficient balance for withdrawal.');
          return true;
        }

        // Store amount in pendingWithdrawal and show confirm
        if (ctx.session) {
          ctx.session.pendingWithdrawal = {
            ...(ctx.session.pendingWithdrawal || { chain: 'sol', walletIndex: 1 }),
            amount: amountPct.toString(),
          };
          ctx.session.step = null;
        }

        await showWithdrawConfirm(ctx, amountPct);
        return true;
      }

      default:
        return false;
    }
  } catch (error) {
    console.error('Error handling withdraw input:', error);
    await ctx.reply('Error processing input. Please try again.');
    return true;
  }
}

/**
 * Show withdraw confirmation panel
 */
async function showWithdrawConfirm(ctx: MyContext, amountSol: number): Promise<void> {
  const destination = ctx.session?.pendingWithdrawal?.address;
  if (!destination) {
    await ctx.reply('Please set a destination address first.');
    await showWithdrawHome(ctx);
    return;
  }

  const estimatedFeeSol = 0.000005; // ~5000 lamports
  const receiveApproxSol = amountSol - estimatedFeeSol;

  const confirmData: WithdrawConfirmData = {
    toAddress: destination,
    amountSol,
    estimatedFeeSol,
    receiveApproxSol,
  };

  const panel = renderWithdrawConfirm(confirmData);
  await ctx.reply(panel.text, panel.opts);
}
