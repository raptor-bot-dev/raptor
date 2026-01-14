/**
 * Gas Command - Priority fee settings for RAPTOR v4.0
 * Solana-only build
 *
 * Configure priority fee settings:
 * - Auto-tip (enabled/disabled)
 * - Tip speed (slow/normal/fast/turbo)
 * - Max tip USD limit
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getGasSettings, saveGasSettings } from '@raptor/shared';
import { backKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';

type TipSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

interface GasSettings {
  autoTip: boolean;
  tipSpeed: TipSpeed;
  maxTipUSD: number;
}

const defaultGasSettings: Record<Chain, GasSettings> = {
  sol: { autoTip: true, tipSpeed: 'fast', maxTipUSD: 5 },
};

// In-memory cache with database persistence (SECURITY: P0-2)
const userGasSettings = new Map<number, Record<Chain, GasSettings>>();

async function getUserGasSettingsAsync(tgId: number): Promise<Record<Chain, GasSettings>> {
  if (userGasSettings.has(tgId)) {
    return userGasSettings.get(tgId)!;
  }

  const dbSettings = await getGasSettings(tgId);
  if (dbSettings) {
    const settings = dbSettings as Record<Chain, GasSettings>;
    userGasSettings.set(tgId, settings);
    return settings;
  }

  const defaults = JSON.parse(JSON.stringify(defaultGasSettings));
  userGasSettings.set(tgId, defaults);
  await saveGasSettings(tgId, defaults);
  return defaults;
}

async function saveUserGasSettings(tgId: number, settings: Record<Chain, GasSettings>): Promise<void> {
  userGasSettings.set(tgId, settings);
  await saveGasSettings(tgId, settings);
}

// Speed descriptions and multipliers
const SPEED_INFO: Record<TipSpeed, { emoji: string; name: string; multiplier: string }> = {
  slow: { emoji: '🐢', name: 'Slow', multiplier: '0.5x' },
  normal: { emoji: '🚶', name: 'Normal', multiplier: '1x' },
  fast: { emoji: '🏃', name: 'Fast', multiplier: '2x' },
  turbo: { emoji: '⚡', name: 'Turbo', multiplier: '3x' },
};

/**
 * Main gas command - show Solana settings
 */
export async function gasCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserGasSettingsAsync(user.id);

  let message = '⛽ *Priority Fee Settings*\n\n';
  message += 'Configure Solana priority fees:\n\n';

  const s = settings.sol;
  const speedInfo = SPEED_INFO[s.tipSpeed];
  const status = s.autoTip ? speedInfo.emoji : '⏸️';
  message += `${CHAIN_EMOJI.sol} ${CHAIN_NAME.sol}: ${status} ${speedInfo.name}\n`;

  message += '\n_Higher priority = faster execution but more cost_';

  const keyboard = new InlineKeyboard()
    .text(`${CHAIN_EMOJI.sol} Solana Settings`, 'gas_chain_sol')
    .row()
    .text('← Back', 'settings');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show gas settings via callback
 */
export async function showGas(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserGasSettingsAsync(user.id);

  let message = '⛽ *Priority Fee Settings*\n\n';
  message += 'Configure Solana priority fees:\n\n';

  const s = settings.sol;
  const speedInfo = SPEED_INFO[s.tipSpeed];
  const status = s.autoTip ? speedInfo.emoji : '⏸️';
  message += `${CHAIN_EMOJI.sol} ${CHAIN_NAME.sol}: ${status} ${speedInfo.name}\n`;

  message += '\n_Higher priority = faster execution but more cost_';

  const keyboard = new InlineKeyboard()
    .text(`${CHAIN_EMOJI.sol} Solana Settings`, 'gas_chain_sol')
    .row()
    .text('← Back', 'settings');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show gas settings for Solana
 */
export async function showChainGas(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only build
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  const allSettings = await getUserGasSettingsAsync(user.id);
  const settings = allSettings.sol;
  const speedInfo = SPEED_INFO[settings.tipSpeed];

  let message = `⛽ *Priority Fee Settings - Solana* ${CHAIN_EMOJI.sol}\n\n`;

  message += `*Auto-Tip:* ${settings.autoTip ? '✅ Enabled' : '❌ Disabled'}\n`;
  message += `*Speed:* ${speedInfo.emoji} ${speedInfo.name} (${speedInfo.multiplier})\n`;
  message += `*Max Tip:* $${settings.maxTipUSD} USD\n\n`;

  message += '*Speed Guide:*\n';
  message += '🐢 Slow - Cheapest, may miss fast tokens\n';
  message += '🚶 Normal - Balanced (recommended)\n';
  message += '🏃 Fast - Higher priority for hot launches\n';
  message += '⚡ Turbo - Maximum priority, expensive\n\n';

  message += '💡 _Solana priority fees are very cheap_';

  const keyboard = gasChainKeyboard('sol', settings);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle auto-tip for Solana
 */
export async function toggleAutoTip(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  const settings = await getUserGasSettingsAsync(user.id);
  settings.sol.autoTip = !settings.sol.autoTip;
  await saveUserGasSettings(user.id, settings);

  const status = settings.sol.autoTip ? 'enabled' : 'disabled';
  await ctx.answerCallbackQuery({ text: `Auto-tip ${status}` });

  await showChainGas(ctx, 'sol');
}

/**
 * Show speed selection for Solana
 */
export async function showSpeedSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  const allSettings = await getUserGasSettingsAsync(user.id);
  const settings = allSettings.sol;

  const message = `🏃 *Priority Speed - Solana* ${CHAIN_EMOJI.sol}\n\n` +
    `Current: ${SPEED_INFO[settings.tipSpeed].emoji} ${SPEED_INFO[settings.tipSpeed].name}\n\n` +
    `Select transaction priority:`;

  const keyboard = new InlineKeyboard();

  for (const [speed, info] of Object.entries(SPEED_INFO)) {
    const isActive = speed === settings.tipSpeed;
    const label = isActive ? `${info.emoji} ${info.name} ✓` : `${info.emoji} ${info.name}`;
    keyboard.text(label, `gas_speed_set_sol_${speed}`).row();
  }

  keyboard.text('← Back', 'gas_chain_sol');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set tip speed for Solana
 */
export async function setTipSpeed(ctx: MyContext, chain: Chain, speed: TipSpeed) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  const settings = await getUserGasSettingsAsync(user.id);
  settings.sol.tipSpeed = speed;
  await saveUserGasSettings(user.id, settings);

  await ctx.answerCallbackQuery({ text: `Speed set to ${SPEED_INFO[speed].name}` });

  await showChainGas(ctx, 'sol');
}

/**
 * Show max tip selection for Solana
 */
export async function showMaxTipSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  const allSettings = await getUserGasSettingsAsync(user.id);
  const settings = allSettings.sol;

  const message = `💰 *Max Tip - Solana* ${CHAIN_EMOJI.sol}\n\n` +
    `Current: $${settings.maxTipUSD} USD\n\n` +
    `Set maximum tip per transaction:\n\n` +
    `_This protects against overpaying during congestion_`;

  const limits = ['1', '2', '5', '10'];

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < limits.length; i += 2) {
    keyboard.text(
      settings.maxTipUSD === parseFloat(limits[i]) ? `$${limits[i]} ✓` : `$${limits[i]}`,
      `gas_max_set_sol_${limits[i]}`
    );
    if (i + 1 < limits.length) {
      keyboard.text(
        settings.maxTipUSD === parseFloat(limits[i + 1]) ? `$${limits[i + 1]} ✓` : `$${limits[i + 1]}`,
        `gas_max_set_sol_${limits[i + 1]}`
      );
    }
    keyboard.row();
  }

  keyboard.text('← Back', 'gas_chain_sol');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set max tip for Solana
 */
export async function setMaxTip(ctx: MyContext, chain: Chain, maxUSD: number) {
  const user = ctx.from;
  if (!user) return;

  // Solana-only
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'This build is Solana-only', show_alert: true });
    return;
  }

  const settings = await getUserGasSettingsAsync(user.id);
  settings.sol.maxTipUSD = maxUSD;

  await ctx.answerCallbackQuery({ text: `Max tip set to $${maxUSD}` });

  await showChainGas(ctx, 'sol');
}

/**
 * Build keyboard for Solana gas settings
 */
function gasChainKeyboard(chain: Chain, settings: GasSettings): InlineKeyboard {
  const speedInfo = SPEED_INFO[settings.tipSpeed];

  return new InlineKeyboard()
    .text(
      settings.autoTip ? '✅ Auto-Tip ON' : '❌ Auto-Tip OFF',
      `gas_toggle_${chain}`
    )
    .row()
    .text(`${speedInfo.emoji} Speed: ${speedInfo.name}`, `gas_speed_${chain}`)
    .row()
    .text(`💰 Max: $${settings.maxTipUSD}`, `gas_max_${chain}`)
    .row()
    .text('← Back', 'settings_gas');
}
