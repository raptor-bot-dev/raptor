import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain, TradingMode } from '@raptor/shared';
import { getOrCreateDepositAddress } from '../services/wallet.js';

export async function depositCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  // First show mode selection
  const keyboard = new InlineKeyboard()
    .text('🏊 Pool Mode', 'deposit_mode_pool')
    .row()
    .text('👤 Solo Mode', 'deposit_mode_solo')
    .row()
    .text('🎯 Snipe Mode', 'deposit_mode_snipe');

  await ctx.reply(
    '💰 *Select Trading Mode*\n\n' +
      '*Pool Mode* 🏊\n' +
      'Join the collective pool. Trades are made automatically based on opportunities. P&L is shared proportionally.\n\n' +
      '*Solo Mode* 👤\n' +
      'Your personal vault. Same auto-trading, but only your funds. 100% of P&L is yours.\n\n' +
      '*Snipe Mode* 🎯\n' +
      'Manual control. Use /snipe to buy tokens yourself. Full control over entries and exits.',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

// Handle mode selection callback - Solana-only build
export async function handleModeSelection(ctx: MyContext, mode: string) {
  // Solana-only build - go directly to Solana deposit
  await handleChainSelection(ctx, 'sol', mode);
}

// Handle chain selection callback
export async function handleChainSelection(
  ctx: MyContext,
  chain: string,
  mode: string
) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only build
  const chainInfo: Record<string, { name: string; symbol: string; emoji: string; minDeposit: string }> = {
    sol: { name: 'Solana', symbol: 'SOL', emoji: '🟢', minDeposit: '0.05 SOL' },
  };

  const info = chainInfo[chain];
  if (!info) {
    await ctx.answerCallbackQuery({ text: 'Invalid chain' });
    return;
  }

  // Generate or get deposit address from wallet service
  const depositAddress = await getOrCreateDepositAddress(
    user.id,
    chain as Chain,
    mode as TradingMode
  );

  const modeEmoji = mode === 'pool' ? '🏊' : mode === 'solo' ? '👤' : '🎯';
  const modeName = mode.charAt(0).toUpperCase() + mode.slice(1);

  await ctx.editMessageText(
    `${info.emoji} *Deposit to ${modeName} Mode*\n\n` +
      `*Chain:* ${info.name}\n` +
      `*Mode:* ${modeName} ${modeEmoji}\n\n` +
      `Send ${info.symbol} to this address:\n` +
      `\`${depositAddress}\`\n\n` +
      `*Minimum deposit:* ${info.minDeposit}\n\n` +
      `⚠️ *Important:*\n` +
      `• Only send ${info.symbol} to this address\n` +
      `• Deposits are auto-detected (usually within 1-2 minutes)\n` +
      `• 1% fee applies to all trades (not deposits)`,
    {
      parse_mode: 'Markdown',
    }
  );

  await ctx.answerCallbackQuery();
}
