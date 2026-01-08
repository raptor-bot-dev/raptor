import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';

export async function depositCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  // Show chain selection
  const keyboard = new InlineKeyboard()
    .text('🟡 BSC (BNB)', 'deposit_chain_bsc')
    .text('🔵 Base (ETH)', 'deposit_chain_base');

  await ctx.reply(
    '💰 *Select Chain to Deposit*\n\n' +
      'Choose which chain you want to deposit to:',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}
