import type { MyContext } from '../types.js';
import { getUserBalances } from '@raptor/shared';
import { getOrCreateDepositAddress, processWithdrawal } from '../services/wallet.js';

export async function handleCallbackQuery(ctx: MyContext) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const user = ctx.from;
  if (!user) return;

  try {
    // Deposit chain selection
    if (data.startsWith('deposit_chain_')) {
      const chain = data.replace('deposit_chain_', '') as 'bsc' | 'base';
      await handleDepositChainSelection(ctx, chain);
    }
    // Withdraw chain selection
    else if (data.startsWith('withdraw_chain_')) {
      const chain = data.replace('withdraw_chain_', '') as 'bsc' | 'base';
      await handleWithdrawChainSelection(ctx, chain);
    }
    // Confirm withdrawal
    else if (data === 'confirm_withdraw') {
      await handleWithdrawConfirm(ctx);
    }
    // Cancel
    else if (data === 'cancel') {
      await ctx.editMessageText('Cancelled.');
      ctx.session.step = null;
      ctx.session.pendingWithdrawal = null;
    }
    // Settings toggles
    else if (data === 'toggle_alerts') {
      // TODO: Implement settings toggle
      await ctx.answerCallbackQuery('Settings update coming soon!');
      return;
    }
    else if (data === 'toggle_daily_summary') {
      // TODO: Implement settings toggle
      await ctx.answerCallbackQuery('Settings update coming soon!');
      return;
    }
  } catch (error) {
    console.error('Callback query error:', error);
    await ctx.answerCallbackQuery('An error occurred. Please try again.');
    return;
  }

  await ctx.answerCallbackQuery();
}

async function handleDepositChainSelection(ctx: MyContext, chain: 'bsc' | 'base') {
  const user = ctx.from;
  if (!user) return;

  const address = await getOrCreateDepositAddress(user.id, chain);

  const chainEmoji = chain === 'bsc' ? '🟡' : '🔵';
  const token = chain === 'bsc' ? 'BNB' : 'ETH';
  const minDeposit = chain === 'bsc' ? '0.1 BNB' : '0.05 ETH';

  await ctx.editMessageText(
    `${chainEmoji} *Deposit ${token}*\n\n` +
      `Send ${token} to this address:\n\n` +
      `\`${address}\`\n\n` +
      `_Tap to copy_\n\n` +
      `⚠️ *Important:*\n` +
      `• Minimum deposit: ${minDeposit}\n` +
      `• Only send ${token} on ${chain.toUpperCase()}\n` +
      `• Funds are deployed automatically\n\n` +
      `You'll receive a confirmation once detected.`,
    { parse_mode: 'Markdown' }
  );
}

async function handleWithdrawChainSelection(ctx: MyContext, chain: 'bsc' | 'base') {
  const user = ctx.from;
  if (!user) return;

  const balances = await getUserBalances(user.id);
  const balance = balances.find((b) => b.chain === chain);

  if (!balance || parseFloat(balance.current_value) === 0) {
    await ctx.editMessageText('❌ No funds available on this chain.');
    return;
  }

  const token = chain === 'bsc' ? 'BNB' : 'ETH';

  ctx.session.step = 'awaiting_withdrawal_amount';
  ctx.session.pendingWithdrawal = { chain, amount: '' };

  await ctx.editMessageText(
    `💸 *Withdraw ${token}*\n\n` +
      `Available: ${parseFloat(balance.current_value).toFixed(4)} ${token}\n\n` +
      `Enter amount to withdraw (or "max" for all):`,
    { parse_mode: 'Markdown' }
  );
}

async function handleWithdrawConfirm(ctx: MyContext) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain, amount } = ctx.session.pendingWithdrawal;

  await ctx.editMessageText('⏳ Processing withdrawal...');

  try {
    const tx = await processWithdrawal(user.id, chain, amount);

    const token = chain === 'bsc' ? 'BNB' : 'ETH';
    const explorer = chain === 'bsc' ? 'bscscan.com' : 'basescan.org';

    await ctx.editMessageText(
      `✅ *Withdrawal Sent*\n\n` +
        `Amount: ${parseFloat(amount).toFixed(4)} ${token}\n` +
        `TX: [View on Explorer](https://${explorer}/tx/${tx.hash})\n\n` +
        `_Funds should arrive within a few minutes._`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Withdrawal error:', error);
    await ctx.editMessageText(
      '❌ Withdrawal failed. Please try again or contact support.'
    );
  }

  ctx.session.step = null;
  ctx.session.pendingWithdrawal = null;
}
