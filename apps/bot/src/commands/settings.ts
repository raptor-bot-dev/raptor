import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';

export async function settingsCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  // TODO: Fetch actual user settings from database
  const alertsEnabled = true;
  const dailySummaryEnabled = true;

  const keyboard = new InlineKeyboard()
    .text(
      `${alertsEnabled ? '✅' : '❌'} Trade Alerts`,
      'toggle_alerts'
    )
    .row()
    .text(
      `${dailySummaryEnabled ? '✅' : '❌'} Daily Summary`,
      'toggle_daily_summary'
    )
    .row()
    .text('↩️ Back', 'cancel');

  await ctx.reply(
    '⚙️ *Settings*\n\n' +
      'Configure your RAPTOR experience:\n\n' +
      `*Trade Alerts:* ${alertsEnabled ? 'Enabled' : 'Disabled'}\n` +
      'Get notified when positions open/close\n\n' +
      `*Daily Summary:* ${dailySummaryEnabled ? 'Enabled' : 'Disabled'}\n` +
      'Receive a daily P&L report',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}
