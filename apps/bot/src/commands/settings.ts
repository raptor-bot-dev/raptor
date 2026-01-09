/**
 * Settings Command - Main settings hub for RAPTOR v2.2
 *
 * Organize all user settings:
 * - Trading Strategy
 * - Gas Settings (per chain)
 * - Slippage (per chain)
 * - Position Size
 * - Chains Enabled
 * - Notifications
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain, TradingStrategy } from '@raptor/shared';
import { backKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';

// In-memory settings (would be in database)
interface UserSettingsData {
  strategy: TradingStrategy;
  maxPositionPercent: number;
  chainsEnabled: Chain[];
  notifications: {
    enabled: boolean;
    onEntry: boolean;
    onExit: boolean;
    onHoneypot: boolean;
    dailySummary: boolean;
  };
}

const defaultSettings: UserSettingsData = {
  strategy: 'STANDARD',
  maxPositionPercent: 10,
  chainsEnabled: ['sol', 'bsc', 'base'],
  notifications: {
    enabled: true,
    onEntry: true,
    onExit: true,
    onHoneypot: true,
    dailySummary: true,
  },
};

const userSettings = new Map<number, UserSettingsData>();

function getUserSettings(tgId: number): UserSettingsData {
  if (!userSettings.has(tgId)) {
    userSettings.set(tgId, JSON.parse(JSON.stringify(defaultSettings)));
  }
  return userSettings.get(tgId)!;
}

// Strategy display names
const STRATEGY_NAMES: Record<TradingStrategy, string> = {
  MICRO_SCALP: '⚡ Micro Scalp',
  STANDARD: '📈 Standard',
  MOON_BAG: '🌙 Moon Bag',
  DCA_EXIT: '📊 DCA Exit',
  TRAILING: '🎯 Trailing',
};

/**
 * Main settings command
 */
export async function settingsCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);
  const message = formatSettingsMenu(settings);
  const keyboard = settingsKeyboard();

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show settings via callback
 */
export async function showSettings(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);
  const message = formatSettingsMenu(settings);
  const keyboard = settingsKeyboard();

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show position size settings
 */
export async function showPositionSize(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);

  const message = `💰 *Position Size*\n\n` +
    `Maximum position as % of balance:\n\n` +
    `Current: *${settings.maxPositionPercent}%*\n\n` +
    `_This limits risk per trade_`;

  const keyboard = new InlineKeyboard()
    .text(settings.maxPositionPercent === 5 ? '5% ✓' : '5%', 'size_set_5')
    .text(settings.maxPositionPercent === 10 ? '10% ✓' : '10%', 'size_set_10')
    .text(settings.maxPositionPercent === 15 ? '15% ✓' : '15%', 'size_set_15')
    .row()
    .text(settings.maxPositionPercent === 20 ? '20% ✓' : '20%', 'size_set_20')
    .text(settings.maxPositionPercent === 25 ? '25% ✓' : '25%', 'size_set_25')
    .text(settings.maxPositionPercent === 50 ? '50% ✓' : '50%', 'size_set_50')
    .row()
    .text('← Back', 'back_to_settings');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set position size
 */
export async function setPositionSize(ctx: MyContext, percent: number) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);
  settings.maxPositionPercent = percent;

  await ctx.answerCallbackQuery({ text: `Max position set to ${percent}%` });

  await showPositionSize(ctx);
}

/**
 * Show chains enabled settings
 */
export async function showChainsEnabled(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);

  let message = `⛓️ *Chains Enabled*\n\n`;
  message += `Select which chains to trade on:\n\n`;

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const enabled = settings.chainsEnabled.includes(chain);
    const status = enabled ? '✅' : '❌';
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${status}\n`;
  }

  message += '\n_Disabled chains are ignored for auto-hunt_';

  const keyboard = new InlineKeyboard();

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const enabled = settings.chainsEnabled.includes(chain);
    const label = enabled ? `✅ ${CHAIN_NAME[chain]}` : `❌ ${CHAIN_NAME[chain]}`;
    keyboard.text(label, `chain_toggle_${chain}`).row();
  }

  keyboard.text('← Back', 'back_to_settings');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle chain enabled
 */
export async function toggleChainEnabled(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);
  const idx = settings.chainsEnabled.indexOf(chain);

  if (idx >= 0) {
    // Don't allow disabling all chains
    if (settings.chainsEnabled.length <= 1) {
      await ctx.answerCallbackQuery({ text: 'Must have at least one chain enabled' });
      return;
    }
    settings.chainsEnabled.splice(idx, 1);
  } else {
    settings.chainsEnabled.push(chain);
  }

  await ctx.answerCallbackQuery();

  await showChainsEnabled(ctx);
}

/**
 * Show notification settings
 */
export async function showNotifications(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);
  const notif = settings.notifications;

  let message = `🔔 *Notifications*\n\n`;
  message += `*Master Toggle:* ${notif.enabled ? '✅ ON' : '❌ OFF'}\n\n`;

  if (notif.enabled) {
    message += `*Active Notifications:*\n`;
    message += `📥 Entry alerts: ${notif.onEntry ? '✅' : '❌'}\n`;
    message += `📤 Exit alerts: ${notif.onExit ? '✅' : '❌'}\n`;
    message += `🚨 Honeypot warnings: ${notif.onHoneypot ? '✅' : '❌'}\n`;
    message += `📊 Daily summary: ${notif.dailySummary ? '✅' : '❌'}\n`;
  } else {
    message += `_All notifications are disabled_`;
  }

  const keyboard = new InlineKeyboard()
    .text(
      notif.enabled ? '🔔 Notifications ON' : '🔕 Notifications OFF',
      'notif_toggle_master'
    )
    .row();

  if (notif.enabled) {
    keyboard
      .text(notif.onEntry ? '✅ Entry' : '❌ Entry', 'notif_toggle_entry')
      .text(notif.onExit ? '✅ Exit' : '❌ Exit', 'notif_toggle_exit')
      .row()
      .text(notif.onHoneypot ? '✅ Honeypot' : '❌ Honeypot', 'notif_toggle_honeypot')
      .text(notif.dailySummary ? '✅ Summary' : '❌ Summary', 'notif_toggle_summary')
      .row();
  }

  keyboard.text('← Back', 'back_to_settings');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle notification setting
 */
export async function toggleNotification(ctx: MyContext, type: string) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSettings(user.id);

  switch (type) {
    case 'master':
      settings.notifications.enabled = !settings.notifications.enabled;
      break;
    case 'entry':
      settings.notifications.onEntry = !settings.notifications.onEntry;
      break;
    case 'exit':
      settings.notifications.onExit = !settings.notifications.onExit;
      break;
    case 'honeypot':
      settings.notifications.onHoneypot = !settings.notifications.onHoneypot;
      break;
    case 'summary':
      settings.notifications.dailySummary = !settings.notifications.dailySummary;
      break;
  }

  await ctx.answerCallbackQuery();

  await showNotifications(ctx);
}

/**
 * Format settings menu
 */
function formatSettingsMenu(settings: UserSettingsData): string {
  let message = '⚙️ *Settings*\n\n';

  message += `📊 *Strategy:* ${STRATEGY_NAMES[settings.strategy]}\n`;
  message += `💰 *Max Position:* ${settings.maxPositionPercent}%\n`;
  message += `⛓️ *Chains:* ${settings.chainsEnabled.length} enabled\n`;
  message += `🔔 *Notifications:* ${settings.notifications.enabled ? 'ON' : 'OFF'}\n\n`;

  message += '_Configure your trading preferences_';

  return message;
}

/**
 * Build settings keyboard
 */
function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Strategy', 'settings_strategy')
    .text('⛽ Gas', 'settings_gas')
    .row()
    .text('🎚️ Slippage', 'settings_slippage')
    .text('💰 Position Size', 'settings_size')
    .row()
    .text('⛓️ Chains', 'settings_chains')
    .text('🔔 Notifications', 'settings_notif')
    .row()
    .text('← Back', 'back_to_menu');
}
