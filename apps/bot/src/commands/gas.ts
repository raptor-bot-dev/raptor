/**
 * Gas Command - Per-chain gas/priority fee settings for RAPTOR v2.2
 *
 * Configure gas settings per chain:
 * - Auto-tip (enabled/disabled)
 * - Tip speed (slow/normal/fast/turbo)
 * - Max tip USD limit
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getGasSettings, saveGasSettings } from '@raptor/shared';
import { chainsWithBackKeyboard, backKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';

type TipSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

interface GasSettings {
  autoTip: boolean;
  tipSpeed: TipSpeed;
  maxTipUSD: number;
}

const defaultGasSettings: Record<Chain, GasSettings> = {
  sol: { autoTip: true, tipSpeed: 'fast', maxTipUSD: 5 },
  bsc: { autoTip: true, tipSpeed: 'normal', maxTipUSD: 3 },
  base: { autoTip: true, tipSpeed: 'fast', maxTipUSD: 5 },
  eth: { autoTip: true, tipSpeed: 'normal', maxTipUSD: 20 },
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
  turbo: { emoji: '🚀', name: 'Turbo', multiplier: '3x' },
};

/**
 * Main gas command - show chain selection
 */
export async function gasCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserGasSettingsAsync(user.id);

  let message = '⛽ *Gas Settings*\n\n';
  message += 'Configure priority fees per chain:\n\n';

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const s = settings[chain];
    const speedInfo = SPEED_INFO[s.tipSpeed];
    const status = s.autoTip ? speedInfo.emoji : '⏸️';
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${status} ${speedInfo.name}\n`;
  }

  message += '\n_Higher priority = faster execution but more cost_';

  const keyboard = chainsWithBackKeyboard('gas_chain', 'settings');

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

  let message = '⛽ *Gas Settings*\n\n';
  message += 'Configure priority fees per chain:\n\n';

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const s = settings[chain];
    const speedInfo = SPEED_INFO[s.tipSpeed];
    const status = s.autoTip ? speedInfo.emoji : '⏸️';
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${status} ${speedInfo.name}\n`;
  }

  message += '\n_Higher priority = faster execution but more cost_';

  const keyboard = chainsWithBackKeyboard('gas_chain', 'settings');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show gas settings for a specific chain
 */
export async function showChainGas(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const allSettings = await getUserGasSettingsAsync(user.id);
  const settings = allSettings[chain];
  const speedInfo = SPEED_INFO[settings.tipSpeed];

  let message = `⛽ *Gas Settings - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n`;

  message += `*Auto-Tip:* ${settings.autoTip ? '✅ Enabled' : '❌ Disabled'}\n`;
  message += `*Speed:* ${speedInfo.emoji} ${speedInfo.name} (${speedInfo.multiplier})\n`;
  message += `*Max Tip:* $${settings.maxTipUSD} USD\n\n`;

  message += '*Speed Guide:*\n';
  message += '🐢 Slow - Cheapest, may miss fast tokens\n';
  message += '🚶 Normal - Balanced (recommended)\n';
  message += '🏃 Fast - Higher priority for hot launches\n';
  message += '🚀 Turbo - Maximum priority, expensive\n\n';

  if (chain === 'eth') {
    message += '⚠️ _ETH gas can be high during congestion_';
  } else if (chain === 'sol') {
    message += '💡 _Solana priority fees are very cheap_';
  }

  const keyboard = gasChainKeyboard(chain, settings);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle auto-tip for a chain
 */
export async function toggleAutoTip(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserGasSettingsAsync(user.id);
  settings[chain].autoTip = !settings[chain].autoTip;
  await saveUserGasSettings(user.id, settings);

  const status = settings[chain].autoTip ? 'enabled' : 'disabled';
  await ctx.answerCallbackQuery({ text: `Auto-tip ${status}` });

  await showChainGas(ctx, chain);
}

/**
 * Show speed selection for a chain
 */
export async function showSpeedSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const allSettings = await getUserGasSettingsAsync(user.id);
  const settings = allSettings[chain];

  const message = `🏃 *Priority Speed - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n` +
    `Current: ${SPEED_INFO[settings.tipSpeed].emoji} ${SPEED_INFO[settings.tipSpeed].name}\n\n` +
    `Select transaction priority:`;

  const keyboard = new InlineKeyboard();

  for (const [speed, info] of Object.entries(SPEED_INFO)) {
    const isActive = speed === settings.tipSpeed;
    const label = isActive ? `${info.emoji} ${info.name} ✓` : `${info.emoji} ${info.name}`;
    keyboard.text(label, `gas_speed_set_${chain}_${speed}`).row();
  }

  keyboard.text('← Back', `gas_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set tip speed for a chain
 */
export async function setTipSpeed(ctx: MyContext, chain: Chain, speed: TipSpeed) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserGasSettingsAsync(user.id);
  settings[chain].tipSpeed = speed;
  await saveUserGasSettings(user.id, settings);

  await ctx.answerCallbackQuery({ text: `Speed set to ${SPEED_INFO[speed].name}` });

  await showChainGas(ctx, chain);
}

/**
 * Show max tip selection for a chain
 */
export async function showMaxTipSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const allSettings = await getUserGasSettingsAsync(user.id);
  const settings = allSettings[chain];

  const message = `💰 *Max Tip - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n` +
    `Current: $${settings.maxTipUSD} USD\n\n` +
    `Set maximum tip per transaction:\n\n` +
    `_This protects against overpaying during congestion_`;

  // Different limits based on chain
  const limits = chain === 'eth'
    ? ['5', '10', '20', '50']
    : chain === 'sol'
    ? ['1', '2', '5', '10']
    : ['2', '5', '10', '20'];

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < limits.length; i += 2) {
    keyboard.text(
      settings.maxTipUSD === parseFloat(limits[i]) ? `$${limits[i]} ✓` : `$${limits[i]}`,
      `gas_max_set_${chain}_${limits[i]}`
    );
    if (i + 1 < limits.length) {
      keyboard.text(
        settings.maxTipUSD === parseFloat(limits[i + 1]) ? `$${limits[i + 1]} ✓` : `$${limits[i + 1]}`,
        `gas_max_set_${chain}_${limits[i + 1]}`
      );
    }
    keyboard.row();
  }

  keyboard.text('← Back', `gas_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set max tip for a chain
 */
export async function setMaxTip(ctx: MyContext, chain: Chain, maxUSD: number) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserGasSettings(user.id);
  settings[chain].maxTipUSD = maxUSD;

  await ctx.answerCallbackQuery({ text: `Max tip set to $${maxUSD}` });

  await showChainGas(ctx, chain);
}

/**
 * Build keyboard for chain gas settings
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
