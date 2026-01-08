import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import { getUserBalances } from '@raptor/shared';

export async function handleTextMessage(ctx: MyContext) {
  const user = ctx.from;
  const text = ctx.message?.text;

  if (!user || !text) return;

  // Handle withdrawal amount input
  if (ctx.session.step === 'awaiting_withdrawal_amount') {
    await handleWithdrawalAmountInput(ctx, text);
  }
}

async function handleWithdrawalAmountInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain } = ctx.session.pendingWithdrawal;
  const balances = await getUserBalances(user.id);
  const balance = balances.find((b) => b.chain === chain);

  if (!balance) {
    await ctx.reply('❌ Error: Balance not found.');
    ctx.session.step = null;
    ctx.session.pendingWithdrawal = null;
    return;
  }

  const available = parseFloat(balance.current_value);
  let amount: number;

  if (text.toLowerCase() === 'max') {
    amount = available;
  } else {
    amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Invalid amount. Please enter a valid number.');
      return;
    }
    if (amount > available) {
      await ctx.reply(`❌ Insufficient balance. Maximum: ${available.toFixed(4)}`);
      return;
    }
  }

  ctx.session.pendingWithdrawal.amount = amount.toString();
  ctx.session.step = 'awaiting_withdrawal_confirm';

  const token = chain === 'bsc' ? 'BNB' : 'ETH';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', 'confirm_withdraw')
    .text('❌ Cancel', 'cancel');

  await ctx.reply(
    `⚠️ *Confirm Withdrawal*\n\n` +
      `Amount: ${amount.toFixed(4)} ${token}\n` +
      `Chain: ${chain.toUpperCase()}\n\n` +
      `Funds will be sent to your deposit address.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}
