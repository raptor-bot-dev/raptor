/**
 * Settings Command - Manual Trading Settings for RAPTOR v4.2
 *
 * Configure settings for manual buys/sells:
 * - Slippage (buy/sell)
 * - Priority Fee
 * - Anti-MEV (Jito bundles)
 *
 * Note: Strategy, Position Size, and Notifications are in Hunt settings
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getOrCreateChainSettings, updateChainSettings } from '@raptor/shared';
import { CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';

/**
 * Main settings command
 */
export async function settingsCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const chainSettings = await getOrCreateChainSettings(user.id, 'sol');
    const message = formatSettingsMenu(chainSettings);
    const keyboard = settingsKeyboard(chainSettings);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('[Settings] Error loading settings:', error);
    await ctx.reply('⚠️ Error loading settings. Please try again.');
  }
}

/**
 * Show settings via callback
 */
export async function showSettings(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const chainSettings = await getOrCreateChainSettings(user.id, 'sol');
    const message = formatSettingsMenu(chainSettings);
    const keyboard = settingsKeyboard(chainSettings);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error loading settings:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Toggle Anti-MEV (Jito) setting
 */
export async function toggleAntiMev(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const chainSettings = await getOrCreateChainSettings(user.id, 'sol');
    const newValue = !chainSettings.anti_mev_enabled;

    await updateChainSettings({
      userId: user.id,
      chain: 'sol',
      antiMevEnabled: newValue,
    });

    await ctx.answerCallbackQuery({
      text: newValue ? '🛡️ Anti-MEV enabled (using Jito)' : '⚠️ Anti-MEV disabled',
    });

    await showSettings(ctx);
  } catch (error) {
    console.error('[Settings] Error toggling Anti-MEV:', error);
    await ctx.answerCallbackQuery({ text: 'Error updating setting' });
  }
}

// ChainSettings type for formatting
interface ChainSettingsData {
  buy_slippage_bps: number;
  sell_slippage_bps: number;
  priority_sol: number | null;
  anti_mev_enabled: boolean;
}

/**
 * Format settings menu (v4.2 Manual Settings Only)
 */
function formatSettingsMenu(settings: ChainSettingsData): string {
  let message = '⚙️ *SETTINGS*\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  const buySlip = settings.buy_slippage_bps / 100;
  const sellSlip = settings.sell_slippage_bps / 100;
  const priority = settings.priority_sol || 0.001;
  const antiMev = settings.anti_mev_enabled;

  message += `*Buy Slippage:* ${buySlip}%\n`;
  message += `*Sell Slippage:* ${sellSlip}%\n`;
  message += `*Priority Fee:* ${priority} SOL\n`;
  message += `*Anti-MEV:* ${antiMev ? '🛡️ ON (Jito)' : '❌ OFF'}\n\n`;

  message += '_Configure manual trading preferences_';

  return message;
}

/**
 * Build settings keyboard (v4.2 Manual Settings Only)
 */
function settingsKeyboard(settings: ChainSettingsData): InlineKeyboard {
  const antiMevLabel = settings.anti_mev_enabled ? '🛡️ Anti-MEV ON' : '⚠️ Anti-MEV OFF';

  return new InlineKeyboard()
    .text('⚡ Priority', 'settings_gas')
    .text('🎚️ Slippage', 'settings_slippage')
    .row()
    .text(antiMevLabel, 'settings_antimev')
    .row()
    .text('← Back', 'back_to_menu');
}

// Keep these exports for backward compatibility but they're no longer used in main settings
export async function showPositionSize(ctx: MyContext) {
  await ctx.answerCallbackQuery({ text: 'Position settings moved to Hunt' });
}

export async function setPositionSize(ctx: MyContext, _percent: number) {
  await ctx.answerCallbackQuery({ text: 'Position settings moved to Hunt' });
}

export async function showChainsEnabled(ctx: MyContext) {
  await ctx.answerCallbackQuery({ text: 'This is a Solana-only build' });
}

export async function toggleChainEnabled(ctx: MyContext, _chain: Chain) {
  await ctx.answerCallbackQuery({ text: 'This is a Solana-only build' });
}

export async function showNotifications(ctx: MyContext) {
  await ctx.answerCallbackQuery({ text: 'Notifications moved to Hunt settings' });
}

export async function toggleNotification(ctx: MyContext, _type: string) {
  await ctx.answerCallbackQuery({ text: 'Notifications moved to Hunt settings' });
}
