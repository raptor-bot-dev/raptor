import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import { getUserBalances } from '@raptor/shared';

export async function withdrawCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  let balances;
  try {
    balances = await getUserBalances(user.id);
  } catch (error) {
    console.error('Error fetching balances:', error);
    await ctx.reply('❌ Error fetching balances. Please try again.');
    return;
  }

  if (
    balances.length === 0 ||
    balances.every((b) => parseFloat(b.current_value) === 0)
  ) {
    await ctx.reply('❌ No funds available to withdraw.');
    return;
  }

  // Show chain selection with balances
  const keyboard = new InlineKeyboard();

  for (const balance of balances) {
    if (parseFloat(balance.current_value) > 0) {
      // Solana-only build
      const token = 'SOL';
      const emoji = '🟢';
      keyboard
        .text(
          `${emoji} ${parseFloat(balance.current_value).toFixed(4)} ${token}`,
          `withdraw_chain_${balance.chain}`
        )
        .row();
    }
  }

  keyboard.text('❌ Cancel', 'cancel');

  await ctx.reply(
    '💸 *Withdraw Funds*\n\n' + 'Select which balance to withdraw from:',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}
