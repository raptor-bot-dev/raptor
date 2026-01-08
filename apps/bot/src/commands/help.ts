import type { MyContext } from '../types.js';

export async function helpCommand(ctx: MyContext) {
  await ctx.reply(
    '🦅 *RAPTOR Help*\n\n' +
      '*Commands:*\n' +
      '/start — Welcome message\n' +
      '/deposit — Get deposit address\n' +
      '/status — Check balance & P&L\n' +
      '/positions — View active positions\n' +
      '/withdraw — Withdraw funds\n' +
      '/settings — Configure alerts\n' +
      '/help — This message\n\n' +
      '*How it works:*\n' +
      '1. Deposit BNB (BSC) or ETH (Base)\n' +
      '2. RAPTOR automatically hunts MEV opportunities\n' +
      '3. Profits accumulate in your balance\n' +
      '4. Withdraw anytime to your wallet\n\n' +
      '*Supported Chains:*\n' +
      '🟡 BSC — BNB deposits, four.meme hunting\n' +
      '🔵 Base — ETH deposits, pump.fun hunting\n\n' +
      '*Risk Warning:*\n' +
      'MEV hunting involves risk. Only deposit what you can afford to lose.\n\n' +
      '*Support:*\n' +
      'Join our community for help and updates.',
    { parse_mode: 'Markdown' }
  );
}
