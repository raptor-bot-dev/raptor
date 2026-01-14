import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';

/**
 * v3.4.2: /help now shows the same Help & Guides panel as the Help button
 */
export async function helpCommand(ctx: MyContext) {
  const message = `❓ *HELP & GUIDES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select a topic to learn more:

📖 *Getting Started*
How to set up and start trading

💰 *Deposits & Withdrawals*
Managing your funds

🦖 *Hunt*
Automatic token sniping

📊 *Strategies*
Trading strategy explanations

💸 *Fees*
How fees work`;

  const keyboard = new InlineKeyboard()
    .text('📖 Getting Started', 'help_start')
    .row()
    .text('💰 Deposits', 'help_deposits')
    .text('🦖 Hunt', 'help_hunt')
    .row()
    .text('📊 Strategies', 'help_strategies')
    .text('💸 Fees', 'help_fees')
    .row()
    .text('« Back', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
