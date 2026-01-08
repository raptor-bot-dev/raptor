import type { MyContext } from '../types.js';
import { upsertUser } from '@raptor/shared';

export async function startCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Upsert user in database
    await upsertUser({
      tg_id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
    });
  } catch (error) {
    console.error('Error upserting user:', error);
  }

  await ctx.reply(
    `🦅 *Welcome to RAPTOR*\n\n` +
      `Strike first. Strike fast.\n\n` +
      `*How it works:*\n` +
      `1. Deposit BNB or ETH\n` +
      `2. Our bots hunt opportunities 24/7\n` +
      `3. Profits are distributed to your balance\n` +
      `4. Withdraw anytime\n\n` +
      `*Commands:*\n` +
      `/deposit — Get deposit address\n` +
      `/status — Check balance & P&L\n` +
      `/positions — View active positions\n` +
      `/withdraw — Withdraw funds\n` +
      `/settings — Configure alerts\n` +
      `/help — Get help\n\n` +
      `Ready to hunt? Use /deposit`,
    { parse_mode: 'Markdown' }
  );
}
