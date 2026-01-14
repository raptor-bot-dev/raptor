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

// ============================================
// v4.3: MANUAL SLIPPAGE SETTINGS
// ============================================

/**
 * Show manual slippage settings panel (v4.3)
 */
export async function showManualSlippage(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const settings = await getOrCreateChainSettings(user.id, 'sol');
    const buySlip = settings.buy_slippage_bps / 100;
    const sellSlip = settings.sell_slippage_bps / 100;

    const message = `🎚️ *SLIPPAGE SETTINGS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Buy Slippage:* ${buySlip}%
*Sell Slippage:* ${sellSlip}%

_Higher slippage = more likely to fill_`;

    const keyboard = new InlineKeyboard()
      .text(`📈 Buy: ${buySlip}%`, 'manual_slip_buy')
      .text(`📉 Sell: ${sellSlip}%`, 'manual_slip_sell')
      .row()
      .text('← Back', 'settings');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error loading slippage:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Show buy slippage selection (v4.3)
 */
export async function showBuySlippageSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const settings = await getOrCreateChainSettings(user.id, 'sol');
    const currentBps = settings.buy_slippage_bps;
    const currentPercent = currentBps / 100;

    const message = `🎚️ *SET BUY SLIPPAGE*

Current: *${currentPercent}%*

Select slippage tolerance:`;

    const presets = [500, 1000, 2500, 5000, 10000]; // 5%, 10%, 25%, 50%, 100%
    const keyboard = new InlineKeyboard();

    // First row: 5%, 10%, 25%
    for (const bps of presets.slice(0, 3)) {
      const pct = bps / 100;
      const check = currentBps === bps ? ' ✓' : '';
      keyboard.text(`${pct}%${check}`, `manual_slip_set_buy_${bps}`);
    }
    keyboard.row();

    // Second row: 50%, 100%, Custom
    for (const bps of presets.slice(3)) {
      const pct = bps / 100;
      const check = currentBps === bps ? ' ✓' : '';
      keyboard.text(`${pct}%${check}`, `manual_slip_set_buy_${bps}`);
    }
    keyboard.text('✏️ Custom', 'manual_slip_custom_buy');
    keyboard.row();

    keyboard.text('← Back', 'settings_slippage');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Show sell slippage selection (v4.3)
 */
export async function showSellSlippageSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const settings = await getOrCreateChainSettings(user.id, 'sol');
    const currentBps = settings.sell_slippage_bps;
    const currentPercent = currentBps / 100;

    const message = `🎚️ *SET SELL SLIPPAGE*

Current: *${currentPercent}%*

Select slippage tolerance:`;

    const presets = [500, 1000, 2500, 5000, 10000]; // 5%, 10%, 25%, 50%, 100%
    const keyboard = new InlineKeyboard();

    // First row: 5%, 10%, 25%
    for (const bps of presets.slice(0, 3)) {
      const pct = bps / 100;
      const check = currentBps === bps ? ' ✓' : '';
      keyboard.text(`${pct}%${check}`, `manual_slip_set_sell_${bps}`);
    }
    keyboard.row();

    // Second row: 50%, 100%, Custom
    for (const bps of presets.slice(3)) {
      const pct = bps / 100;
      const check = currentBps === bps ? ' ✓' : '';
      keyboard.text(`${pct}%${check}`, `manual_slip_set_sell_${bps}`);
    }
    keyboard.text('✏️ Custom', 'manual_slip_custom_sell');
    keyboard.row();

    keyboard.text('← Back', 'settings_slippage');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Set buy slippage (v4.3)
 */
export async function setBuySlippage(ctx: MyContext, bps: number) {
  const user = ctx.from;
  if (!user) return;

  try {
    await updateChainSettings({
      userId: user.id,
      chain: 'sol',
      buySlippageBps: bps,
    });

    await ctx.answerCallbackQuery({ text: `Buy slippage set to ${bps / 100}%` });
    await showBuySlippageSelection(ctx);
  } catch (error) {
    console.error('[Settings] Error setting buy slippage:', error);
    await ctx.answerCallbackQuery({ text: 'Error updating setting' });
  }
}

/**
 * Set sell slippage (v4.3)
 */
export async function setSellSlippage(ctx: MyContext, bps: number) {
  const user = ctx.from;
  if (!user) return;

  try {
    await updateChainSettings({
      userId: user.id,
      chain: 'sol',
      sellSlippageBps: bps,
    });

    await ctx.answerCallbackQuery({ text: `Sell slippage set to ${bps / 100}%` });
    await showSellSlippageSelection(ctx);
  } catch (error) {
    console.error('[Settings] Error setting sell slippage:', error);
    await ctx.answerCallbackQuery({ text: 'Error updating setting' });
  }
}

// ============================================
// v4.3: MANUAL PRIORITY TIP SETTINGS
// ============================================

/**
 * Show manual priority tip settings panel (v4.3)
 */
export async function showManualPriority(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const settings = await getOrCreateChainSettings(user.id, 'sol');
    // Note: Currently using same priority_sol for both buy and sell
    // TODO: Add sell_priority_sol field to database for separate values
    const tip = settings.priority_sol || 0.001;

    const message = `⚡ *PRIORITY TIP SETTINGS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Buy Tip:* ${tip} SOL
*Sell Tip:* ${tip} SOL

_Higher tip = faster transaction_`;

    const keyboard = new InlineKeyboard()
      .text(`💰 Buy Tip: ${tip}`, 'manual_tip_buy')
      .text(`💰 Sell Tip: ${tip}`, 'manual_tip_sell')
      .row()
      .text('← Back', 'settings');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error loading priority:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Show buy tip selection (v4.3)
 */
export async function showBuyTipSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const settings = await getOrCreateChainSettings(user.id, 'sol');
    const currentTip = settings.priority_sol || 0.001;

    const message = `⚡ *SET BUY TIP*

Current: *${currentTip} SOL*

Select priority tip:`;

    const presets = [0.0001, 0.0005, 0.001, 0.005, 0.01];
    const keyboard = new InlineKeyboard();

    // First row: 0.0001, 0.0005, 0.001
    for (const tip of presets.slice(0, 3)) {
      const check = currentTip === tip ? ' ✓' : '';
      keyboard.text(`${tip}${check}`, `manual_tip_set_buy_${tip}`);
    }
    keyboard.row();

    // Second row: 0.005, 0.01, Custom
    for (const tip of presets.slice(3)) {
      const check = currentTip === tip ? ' ✓' : '';
      keyboard.text(`${tip}${check}`, `manual_tip_set_buy_${tip}`);
    }
    keyboard.text('✏️ Custom', 'manual_tip_custom_buy');
    keyboard.row();

    keyboard.text('← Back', 'settings_gas');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Show sell tip selection (v4.3)
 */
export async function showSellTipSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const settings = await getOrCreateChainSettings(user.id, 'sol');
    // Note: Currently using same priority_sol for both buy and sell
    const currentTip = settings.priority_sol || 0.001;

    const message = `⚡ *SET SELL TIP*

Current: *${currentTip} SOL*

Select priority tip:`;

    const presets = [0.0001, 0.0005, 0.001, 0.005, 0.01];
    const keyboard = new InlineKeyboard();

    // First row: 0.0001, 0.0005, 0.001
    for (const tip of presets.slice(0, 3)) {
      const check = currentTip === tip ? ' ✓' : '';
      keyboard.text(`${tip}${check}`, `manual_tip_set_sell_${tip}`);
    }
    keyboard.row();

    // Second row: 0.005, 0.01, Custom
    for (const tip of presets.slice(3)) {
      const check = currentTip === tip ? ' ✓' : '';
      keyboard.text(`${tip}${check}`, `manual_tip_set_sell_${tip}`);
    }
    keyboard.text('✏️ Custom', 'manual_tip_custom_sell');
    keyboard.row();

    keyboard.text('← Back', 'settings_gas');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Settings] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading settings' });
  }
}

/**
 * Set buy tip (v4.3)
 * Note: Currently both buy and sell use the same priority_sol field
 */
export async function setBuyTip(ctx: MyContext, sol: number) {
  const user = ctx.from;
  if (!user) return;

  try {
    await updateChainSettings({
      userId: user.id,
      chain: 'sol',
      prioritySol: sol,
    });

    await ctx.answerCallbackQuery({ text: `Buy tip set to ${sol} SOL` });
    await showBuyTipSelection(ctx);
  } catch (error) {
    console.error('[Settings] Error setting buy tip:', error);
    await ctx.answerCallbackQuery({ text: 'Error updating setting' });
  }
}

/**
 * Set sell tip (v4.3)
 * Note: Currently both buy and sell use the same priority_sol field
 */
export async function setSellTip(ctx: MyContext, sol: number) {
  const user = ctx.from;
  if (!user) return;

  try {
    // TODO: Use separate sell_priority_sol when database field is added
    await updateChainSettings({
      userId: user.id,
      chain: 'sol',
      prioritySol: sol,
    });

    await ctx.answerCallbackQuery({ text: `Sell tip set to ${sol} SOL` });
    await showSellTipSelection(ctx);
  } catch (error) {
    console.error('[Settings] Error setting sell tip:', error);
    await ctx.answerCallbackQuery({ text: 'Error updating setting' });
  }
}

// ============================================
// LEGACY EXPORTS (backward compatibility)
// ============================================

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
