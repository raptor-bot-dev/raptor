/**
 * Strategy Command - DEPRECATED in v5.0
 *
 * Users now configure TP/SL directly in Hunt Settings.
 * This command redirects to Hunt settings for backward compatibility.
 *
 * @deprecated Use /hunt to configure exit settings instead
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext, CustomStrategyStep } from '../types.js';
import type { TradingStrategy } from '@raptor/shared';
import { LINE, STATUS } from '../utils/formatters.js';

// Local interface for custom strategy (snake_case for consistency with bot code)
interface LocalCustomStrategy {
  // Core
  take_profit_percent: number;
  stop_loss_percent: number;
  max_hold_minutes: number;
  // Trailing
  trailing_enabled: boolean;
  trailing_activation_percent: number;
  trailing_distance_percent: number;
  // DCA Ladder
  dca_enabled: boolean;
  dca_levels: Array<{ sell_percent: number; at_profit_percent: number }>;
  // Moon Bag
  moon_bag_percent: number;
  // Filters
  min_liquidity_usd: number;
  max_market_cap_usd: number;
  min_score: number;
  max_buy_tax_percent: number;
  max_sell_tax_percent: number;
  // Protection
  anti_rug_enabled: boolean;
  anti_mev_enabled: boolean;
  auto_approve_enabled: boolean;
  // Execution
  slippage_percent: number;
  gas_priority: 'low' | 'medium' | 'high' | 'turbo';
  retry_failed: boolean;
  // Notifications
  entry_alert: boolean;
  exit_alert: boolean;
  tp_sl_alert: boolean;
}

// In-memory user settings (would be from database in production)
interface LocalUserSettings {
  trading_strategy: TradingStrategy;
  custom_strategy?: LocalCustomStrategy;
}

const userSettingsCache = new Map<number, LocalUserSettings>();

async function getUserSettings(tgId: number): Promise<LocalUserSettings | null> {
  if (!userSettingsCache.has(tgId)) {
    userSettingsCache.set(tgId, { trading_strategy: 'STANDARD' });
  }
  return userSettingsCache.get(tgId) || null;
}

async function updateUserSettings(tgId: number, updates: Partial<LocalUserSettings>): Promise<void> {
  const current = userSettingsCache.get(tgId) || { trading_strategy: 'STANDARD' };
  userSettingsCache.set(tgId, { ...current, ...updates });
}

// Strategy preset details
export const STRATEGY_INFO: Record<
  TradingStrategy,
  {
    name: string;
    emoji: string;
    tp: string;
    sl: string;
    maxHold: string;
    description: string;
    bestFor: string;
    special?: string;
  }
> = {
  MICRO_SCALP: {
    name: 'Micro Scalp',
    emoji: '⚡',
    tp: '15%',
    sl: '8%',
    maxHold: '15 min',
    description: 'Quick in-and-out trades on fresh launches',
    bestFor: 'Fresh launches on low-gas chains',
    special: 'SOL/Base/BSC only (ETH gas too high)',
  },
  STANDARD: {
    name: 'Standard',
    emoji: '📈',
    tp: '50%',
    sl: '30%',
    maxHold: '4 hours',
    description: 'Balanced approach for most tokens',
    bestFor: 'Most tokens',
  },
  MOON_BAG: {
    name: 'Moon Bag',
    emoji: '🌙',
    tp: '75%',
    sl: '30%',
    maxHold: '8 hours',
    description: 'Take 75% profit, keep 25% forever',
    bestFor: 'High-conviction plays',
    special: 'Keeps 25% position indefinitely',
  },
  DCA_EXIT: {
    name: 'DCA Exit',
    emoji: '📊',
    tp: '200%',
    sl: '30%',
    maxHold: '8 hours',
    description: 'Ladder out at multiple price points',
    bestFor: 'Volatile tokens',
    special: '25% at +50%, +100%, +150%, +200%',
  },
  TRAILING: {
    name: 'Trailing Stop',
    emoji: '🎯',
    tp: '100%+',
    sl: '30%',
    maxHold: '8 hours',
    description: 'Let winners run with dynamic stop',
    bestFor: 'Strong momentum plays',
    special: 'Activates at +30%, trails 20% behind peak',
  },
};

// Default custom strategy values
const DEFAULT_CUSTOM_STRATEGY: LocalCustomStrategy = {
  // Core
  take_profit_percent: 75,
  stop_loss_percent: 25,
  max_hold_minutes: 120,
  // Trailing
  trailing_enabled: false,
  trailing_activation_percent: 30,
  trailing_distance_percent: 15,
  // DCA Ladder
  dca_enabled: false,
  dca_levels: [
    { sell_percent: 25, at_profit_percent: 25 },
    { sell_percent: 25, at_profit_percent: 50 },
    { sell_percent: 25, at_profit_percent: 100 },
    { sell_percent: 25, at_profit_percent: 200 },
  ],
  // Moon Bag
  moon_bag_percent: 0,
  // Filters
  min_liquidity_usd: 10000,
  max_market_cap_usd: 10000000,
  min_score: 23,
  max_buy_tax_percent: 5,
  max_sell_tax_percent: 5,
  // Protection
  anti_rug_enabled: true,
  anti_mev_enabled: true,
  auto_approve_enabled: false,
  // Execution
  slippage_percent: 15,
  gas_priority: 'medium',
  retry_failed: true,
  // Notifications
  entry_alert: true,
  exit_alert: true,
  tp_sl_alert: true,
};

// In-memory custom strategies (for session)
const userCustomStrategies = new Map<number, LocalCustomStrategy>();
const customStrategyPages = new Map<number, number>();

function getUserCustomStrategy(tgId: number): LocalCustomStrategy {
  return userCustomStrategies.get(tgId) || { ...DEFAULT_CUSTOM_STRATEGY };
}

function setUserCustomStrategy(tgId: number, strategy: LocalCustomStrategy) {
  userCustomStrategies.set(tgId, strategy);
}

function getCurrentPage(tgId: number): number {
  return customStrategyPages.get(tgId) || 1;
}

function setCurrentPage(tgId: number, page: number) {
  customStrategyPages.set(tgId, page);
}

/**
 * Main strategy command - DEPRECATED
 * Redirects users to Hunt settings where TP/SL is now configured
 */
export async function strategyCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const message = `${LINE}
📢 *STRATEGY SETTINGS MOVED*
${LINE}

Exit strategy settings (Take Profit, Stop Loss) are now configured in Hunt Settings.

Use /hunt or tap below to configure your trading strategy.

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('🦖 Go to Hunt Settings', 'hunt')
    .row()
    .text('« Back to Menu', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show strategy selection via callback - DEPRECATED
 * Redirects users to Hunt settings
 */
export async function showStrategy(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const message = `${LINE}
📢 *STRATEGY SETTINGS MOVED*
${LINE}

Exit strategy settings (Take Profit, Stop Loss) are now configured in Hunt Settings.

Tap below to configure your trading strategy.

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('🦖 Go to Hunt Settings', 'hunt')
    .row()
    .text('« Back to Menu', 'back_to_menu');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show details for a specific strategy preset
 */
export async function showStrategyDetail(ctx: MyContext, strategy: TradingStrategy) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserSettings(user.id);
  const current = settings?.trading_strategy || 'STANDARD';
  const info = STRATEGY_INFO[strategy];
  const isActive = strategy === current;

  const message = `${LINE}
${info.emoji} *${info.name.toUpperCase()} STRATEGY*
${LINE}

${info.description}

*Settings:*
📈 Take Profit: ${info.tp}
📉 Stop Loss: ${info.sl}
⏱️ Max Hold: ${info.maxHold}
${info.special ? `\n⚡ *Special:* ${info.special}` : ''}

*Best For:* ${info.bestFor}

${isActive ? `${STATUS.ON} *Currently Active*` : '_Tap "Use This" to activate_'}

${LINE}`;

  const keyboard = new InlineKeyboard();

  if (!isActive) {
    keyboard.text('✅ Use This Strategy', `strategy_set_${strategy}`).row();
  }

  keyboard.text('« Back to Strategies', 'settings_strategy');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set user's trading strategy preset
 */
export async function setStrategy(ctx: MyContext, strategy: TradingStrategy) {
  const user = ctx.from;
  if (!user) return;

  await updateUserSettings(user.id, { trading_strategy: strategy });

  const info = STRATEGY_INFO[strategy];
  await ctx.answerCallbackQuery({ text: `Strategy set to ${info.name}` });

  // Refresh the strategy menu
  await showStrategy(ctx);
}

/**
 * Show custom strategy editor - Page 1: Core Settings
 */
export async function showCustomStrategyPage1(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  setCurrentPage(user.id, 1);
  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
🔧 *CUSTOM STRATEGY — Core*
${LINE}

Configure your exit targets and timing.

📈 *Take Profit:* ${strategy.take_profit_percent}%
📉 *Stop Loss:* ${strategy.stop_loss_percent}%
⏱️ *Max Hold:* ${formatHoldTime(strategy.max_hold_minutes)}

${LINE}
_Page 1 of 5_`;

  const keyboard = new InlineKeyboard()
    .text('📈 Set TP', 'custom_set_tp')
    .text('📉 Set SL', 'custom_set_sl')
    .row()
    .text('⏱️ Set Max Hold', 'custom_set_maxhold')
    .row()
    .text('Next →', 'custom_page_2')
    .row()
    .text('« Back to Strategies', 'settings_strategy');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show custom strategy editor - Page 2: Advanced Exits
 */
export async function showCustomStrategyPage2(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  setCurrentPage(user.id, 2);
  const strategy = getUserCustomStrategy(user.id);

  const trailingStatus = strategy.trailing_enabled ? STATUS.ON : STATUS.OFF;
  const dcaStatus = strategy.dca_enabled ? STATUS.ON : STATUS.OFF;

  const message = `${LINE}
🔧 *CUSTOM STRATEGY — Exits*
${LINE}

Configure trailing stops, ladders, moon bags.

🎯 *Trailing:* ${trailingStatus} ${strategy.trailing_enabled ? `(+${strategy.trailing_activation_percent}%, -${strategy.trailing_distance_percent}%)` : ''}
📊 *DCA Ladder:* ${dcaStatus}
🌙 *Moon Bag:* ${strategy.moon_bag_percent}%

${LINE}
_Page 2 of 5_`;

  const keyboard = new InlineKeyboard()
    .text(`🎯 Trailing | ${trailingStatus}`, 'custom_toggle_trailing')
    .row()
    .text(`📊 DCA Ladder | ${dcaStatus}`, 'custom_toggle_dca')
    .row()
    .text('🌙 Moon Bag %', 'custom_set_moonbag')
    .row()
    .text('← Prev', 'custom_page_1')
    .text('Next →', 'custom_page_3')
    .row()
    .text('« Back to Strategies', 'settings_strategy');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show custom strategy editor - Page 3: Filters
 */
export async function showCustomStrategyPage3(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  setCurrentPage(user.id, 3);
  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
🔧 *CUSTOM STRATEGY — Filters*
${LINE}

Set token requirements before entry.

💧 *Min Liquidity:* $${formatNumber(strategy.min_liquidity_usd)}
💰 *Max Market Cap:* $${formatNumber(strategy.max_market_cap_usd)}
📊 *Min Score:* ${strategy.min_score}/35
📈 *Max Buy Tax:* ${strategy.max_buy_tax_percent}%
📉 *Max Sell Tax:* ${strategy.max_sell_tax_percent}%

${LINE}
_Page 3 of 5_`;

  const keyboard = new InlineKeyboard()
    .text('💧 Liquidity', 'custom_set_liquidity')
    .text('💰 Max MCap', 'custom_set_mcap')
    .row()
    .text('📊 Min Score', 'custom_set_minscore')
    .text('📈📉 Max Taxes', 'custom_set_taxes')
    .row()
    .text('← Prev', 'custom_page_2')
    .text('Next →', 'custom_page_4')
    .row()
    .text('« Back to Strategies', 'settings_strategy');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show custom strategy editor - Page 4: Protection & Execution
 */
export async function showCustomStrategyPage4(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  setCurrentPage(user.id, 4);
  const strategy = getUserCustomStrategy(user.id);

  const antiRug = strategy.anti_rug_enabled ? STATUS.ON : STATUS.OFF;
  const antiMev = strategy.anti_mev_enabled ? STATUS.ON : STATUS.OFF;
  const autoApprove = strategy.auto_approve_enabled ? STATUS.ON : STATUS.OFF;
  const retryFailed = strategy.retry_failed ? STATUS.ON : STATUS.OFF;

  const gasPriority =
    strategy.gas_priority === 'low'
      ? 'Low'
      : strategy.gas_priority === 'medium'
        ? 'Medium'
        : strategy.gas_priority === 'high'
          ? 'High'
          : 'Turbo';

  const message = `${LINE}
🔧 *CUSTOM STRATEGY — Protection*
${LINE}

Safety features and execution settings.

🛡️ *Anti-Rug:* ${antiRug}
🔒 *Anti-MEV:* ${antiMev}
✅ *Auto-Approve:* ${autoApprove}
Ⓢ *Slippage:* ${strategy.slippage_percent}%
⛽ *Gas Priority:* ${gasPriority}
🔄 *Retry Failed:* ${retryFailed}

${LINE}
_Page 4 of 5_`;

  const keyboard = new InlineKeyboard()
    .text(`🛡️ Anti-Rug | ${antiRug}`, 'custom_toggle_antirug')
    .row()
    .text(`🔒 Anti-MEV | ${antiMev}`, 'custom_toggle_antimev')
    .row()
    .text(`✅ Auto-Approve | ${autoApprove}`, 'custom_toggle_autoapprove')
    .row()
    .text('Ⓢ Slippage', 'custom_set_slippage')
    .text('⛽ Gas', 'custom_set_gas')
    .row()
    .text(`🔄 Retry | ${retryFailed}`, 'custom_toggle_retry')
    .row()
    .text('← Prev', 'custom_page_3')
    .text('Next →', 'custom_page_5')
    .row()
    .text('« Back to Strategies', 'settings_strategy');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show custom strategy editor - Page 5: Review & Save
 */
export async function showCustomStrategyPage5(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  setCurrentPage(user.id, 5);
  const s = getUserCustomStrategy(user.id);

  const trailingStatus = s.trailing_enabled ? 'ON' : 'OFF';
  const dcaStatus = s.dca_enabled ? 'ON' : 'OFF';

  const message = `${LINE}
🔧 *CUSTOM STRATEGY — Review*
${LINE}

Review your custom strategy:

━━━ *Exits* ━━━
📈 TP: ${s.take_profit_percent}% | 📉 SL: ${s.stop_loss_percent}% | ⏱️ ${formatHoldTime(s.max_hold_minutes)}

━━━ *Advanced* ━━━
🎯 Trailing: ${trailingStatus}
📊 DCA Ladder: ${dcaStatus}
🌙 Moon Bag: ${s.moon_bag_percent}%

━━━ *Filters* ━━━
💧 Min Liq: $${formatNumber(s.min_liquidity_usd)} | 💰 Max MC: $${formatNumber(s.max_market_cap_usd)}
📊 Score: ${s.min_score}+ | Max Tax: ${s.max_buy_tax_percent}%/${s.max_sell_tax_percent}%

━━━ *Protection* ━━━
🛡️ Anti-Rug ${s.anti_rug_enabled ? '✓' : '✗'} | 🔒 Anti-MEV ${s.anti_mev_enabled ? '✓' : '✗'}

${LINE}
_Page 5 of 5_`;

  const keyboard = new InlineKeyboard()
    .text('💾 Save as My Strategy', 'custom_save')
    .row()
    .text('🔄 Reset to Default', 'custom_reset')
    .row()
    .text('← Prev', 'custom_page_4')
    .row()
    .text('« Back to Strategies', 'settings_strategy');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle trailing stop
 */
export async function toggleCustomTrailing(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.trailing_enabled = !strategy.trailing_enabled;
  setUserCustomStrategy(user.id, strategy);

  await showCustomStrategyPage2(ctx);
}

/**
 * Toggle DCA ladder
 */
export async function toggleCustomDca(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.dca_enabled = !strategy.dca_enabled;
  setUserCustomStrategy(user.id, strategy);

  await showCustomStrategyPage2(ctx);
}

/**
 * Toggle anti-rug protection
 */
export async function toggleCustomAntiRug(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.anti_rug_enabled = !strategy.anti_rug_enabled;
  setUserCustomStrategy(user.id, strategy);

  await showCustomStrategyPage4(ctx);
}

/**
 * Toggle anti-MEV protection
 */
export async function toggleCustomAntiMev(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.anti_mev_enabled = !strategy.anti_mev_enabled;
  setUserCustomStrategy(user.id, strategy);

  await showCustomStrategyPage4(ctx);
}

/**
 * Toggle auto-approve
 */
export async function toggleCustomAutoApprove(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.auto_approve_enabled = !strategy.auto_approve_enabled;
  setUserCustomStrategy(user.id, strategy);

  await showCustomStrategyPage4(ctx);
}

/**
 * Toggle retry failed transactions
 */
export async function toggleCustomRetry(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.retry_failed = !strategy.retry_failed;
  setUserCustomStrategy(user.id, strategy);

  await showCustomStrategyPage4(ctx);
}

/**
 * Show TP selection
 */
export async function showTpSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
📈 *SET TAKE PROFIT*
${LINE}

Current: ${strategy.take_profit_percent}%

Select your take profit target:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('15%', 'custom_tp_15')
    .text('25%', 'custom_tp_25')
    .text('50%', 'custom_tp_50')
    .row()
    .text('75%', 'custom_tp_75')
    .text('100%', 'custom_tp_100')
    .text('150%', 'custom_tp_150')
    .row()
    .text('200%', 'custom_tp_200')
    .text('300%', 'custom_tp_300')
    .text('500%', 'custom_tp_500')
    .row()
    .text('✏️ Custom', 'custom_tp_input')
    .row()
    .text('« Back', 'custom_page_1');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show SL selection
 */
export async function showSlSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
📉 *SET STOP LOSS*
${LINE}

Current: ${strategy.stop_loss_percent}%

Select your stop loss:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('5%', 'custom_sl_5')
    .text('8%', 'custom_sl_8')
    .text('10%', 'custom_sl_10')
    .row()
    .text('15%', 'custom_sl_15')
    .text('20%', 'custom_sl_20')
    .text('25%', 'custom_sl_25')
    .row()
    .text('30%', 'custom_sl_30')
    .text('40%', 'custom_sl_40')
    .text('50%', 'custom_sl_50')
    .row()
    .text('✏️ Custom', 'custom_sl_input')
    .row()
    .text('« Back', 'custom_page_1');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show max hold time selection
 */
export async function showMaxHoldSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
⏱️ *SET MAX HOLD TIME*
${LINE}

Current: ${formatHoldTime(strategy.max_hold_minutes)}

Select maximum position hold time:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('5 min', 'custom_hold_5')
    .text('15 min', 'custom_hold_15')
    .text('30 min', 'custom_hold_30')
    .row()
    .text('1 hour', 'custom_hold_60')
    .text('2 hours', 'custom_hold_120')
    .text('4 hours', 'custom_hold_240')
    .row()
    .text('8 hours', 'custom_hold_480')
    .text('12 hours', 'custom_hold_720')
    .text('24 hours', 'custom_hold_1440')
    .row()
    .text('✏️ Custom', 'custom_hold_input')
    .row()
    .text('« Back', 'custom_page_1');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show moon bag selection
 */
export async function showMoonBagSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
🌙 *SET MOON BAG*
${LINE}

Current: ${strategy.moon_bag_percent}%

Keep this percentage of your position forever (never sell):

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('0%', 'custom_moon_0')
    .text('10%', 'custom_moon_10')
    .text('15%', 'custom_moon_15')
    .row()
    .text('20%', 'custom_moon_20')
    .text('25%', 'custom_moon_25')
    .text('30%', 'custom_moon_30')
    .row()
    .text('40%', 'custom_moon_40')
    .text('50%', 'custom_moon_50')
    .row()
    .text('« Back', 'custom_page_2');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show slippage selection
 */
export async function showCustomSlippageSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
Ⓢ *SET SLIPPAGE*
${LINE}

Current: ${strategy.slippage_percent}%

Maximum slippage tolerance for trades:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('1%', 'custom_slip_1')
    .text('3%', 'custom_slip_3')
    .text('5%', 'custom_slip_5')
    .row()
    .text('10%', 'custom_slip_10')
    .text('15%', 'custom_slip_15')
    .text('20%', 'custom_slip_20')
    .row()
    .text('25%', 'custom_slip_25')
    .text('30%', 'custom_slip_30')
    .text('50%', 'custom_slip_50')
    .row()
    .text('« Back', 'custom_page_4');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show gas priority selection
 */
export async function showCustomGasSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  const current = strategy.gas_priority;

  const message = `${LINE}
⛽ *SET GAS PRIORITY*
${LINE}

Current: ${current.charAt(0).toUpperCase() + current.slice(1)}

Higher priority = faster transactions, higher cost:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text(`🐢 Low${current === 'low' ? ' ✓' : ''}`, 'custom_gas_low')
    .text(`🚶 Medium${current === 'medium' ? ' ✓' : ''}`, 'custom_gas_medium')
    .row()
    .text(`🏃 High${current === 'high' ? ' ✓' : ''}`, 'custom_gas_high')
    .text(`⚡ Turbo${current === 'turbo' ? ' ✓' : ''}`, 'custom_gas_turbo')
    .row()
    .text('« Back', 'custom_page_4');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show min liquidity selection
 */
export async function showLiquiditySelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
💧 *SET MIN LIQUIDITY*
${LINE}

Current: $${formatNumber(strategy.min_liquidity_usd)}

Minimum liquidity required for token entry:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('$1K', 'custom_liq_1000')
    .text('$5K', 'custom_liq_5000')
    .text('$10K', 'custom_liq_10000')
    .row()
    .text('$25K', 'custom_liq_25000')
    .text('$50K', 'custom_liq_50000')
    .text('$100K', 'custom_liq_100000')
    .row()
    .text('$250K', 'custom_liq_250000')
    .text('$500K', 'custom_liq_500000')
    .text('$1M', 'custom_liq_1000000')
    .row()
    .text('« Back', 'custom_page_3');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show max market cap selection
 */
export async function showMcapSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
💰 *SET MAX MARKET CAP*
${LINE}

Current: $${formatNumber(strategy.max_market_cap_usd)}

Skip tokens with market cap above this:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('$10K', 'custom_mcap_10000')
    .text('$50K', 'custom_mcap_50000')
    .text('$100K', 'custom_mcap_100000')
    .row()
    .text('$500K', 'custom_mcap_500000')
    .text('$1M', 'custom_mcap_1000000')
    .text('$5M', 'custom_mcap_5000000')
    .row()
    .text('$10M', 'custom_mcap_10000000')
    .text('$50M', 'custom_mcap_50000000')
    .text('$100M', 'custom_mcap_100000000')
    .row()
    .text('« Back', 'custom_page_3');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show min score selection
 */
export async function showMinScoreSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
📊 *SET MIN SAFETY SCORE*
${LINE}

Current: ${strategy.min_score}/35

Minimum safety score to trade a token:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('0 (Any)', 'custom_score_0')
    .text('10', 'custom_score_10')
    .text('15', 'custom_score_15')
    .row()
    .text('18', 'custom_score_18')
    .text('20', 'custom_score_20')
    .text('23', 'custom_score_23')
    .row()
    .text('25', 'custom_score_25')
    .text('28', 'custom_score_28')
    .text('30', 'custom_score_30')
    .row()
    .text('« Back', 'custom_page_3');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show tax selection
 */
export async function showTaxSelection(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  const message = `${LINE}
📈📉 *SET MAX TAXES*
${LINE}

Current Buy Tax: ${strategy.max_buy_tax_percent}%
Current Sell Tax: ${strategy.max_sell_tax_percent}%

Skip tokens with higher taxes:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('0%', 'custom_tax_0')
    .text('1%', 'custom_tax_1')
    .text('2%', 'custom_tax_2')
    .row()
    .text('3%', 'custom_tax_3')
    .text('5%', 'custom_tax_5')
    .text('10%', 'custom_tax_10')
    .row()
    .text('15%', 'custom_tax_15')
    .text('20%', 'custom_tax_20')
    .row()
    .text('« Back', 'custom_page_3');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set take profit value
 */
export async function setCustomTp(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.take_profit_percent = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Take Profit set to ${value}%` });
  await showCustomStrategyPage1(ctx);
}

/**
 * Set stop loss value
 */
export async function setCustomSl(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.stop_loss_percent = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Stop Loss set to ${value}%` });
  await showCustomStrategyPage1(ctx);
}

/**
 * Set max hold time
 */
export async function setCustomHold(ctx: MyContext, minutes: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.max_hold_minutes = minutes;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Max Hold set to ${formatHoldTime(minutes)}` });
  await showCustomStrategyPage1(ctx);
}

/**
 * Set moon bag percentage
 */
export async function setCustomMoonBag(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.moon_bag_percent = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Moon Bag set to ${value}%` });
  await showCustomStrategyPage2(ctx);
}

/**
 * Set slippage
 */
export async function setCustomSlippage(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.slippage_percent = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Slippage set to ${value}%` });
  await showCustomStrategyPage4(ctx);
}

/**
 * Set gas priority
 */
export async function setCustomGas(ctx: MyContext, priority: 'low' | 'medium' | 'high' | 'turbo') {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.gas_priority = priority;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Gas Priority set to ${priority}` });
  await showCustomStrategyPage4(ctx);
}

/**
 * Set min liquidity
 */
export async function setCustomLiquidity(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.min_liquidity_usd = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Min Liquidity set to $${formatNumber(value)}` });
  await showCustomStrategyPage3(ctx);
}

/**
 * Set max market cap
 */
export async function setCustomMcap(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.max_market_cap_usd = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Max MCap set to $${formatNumber(value)}` });
  await showCustomStrategyPage3(ctx);
}

/**
 * Set min score
 */
export async function setCustomMinScore(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.min_score = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Min Score set to ${value}` });
  await showCustomStrategyPage3(ctx);
}

/**
 * Set max taxes
 */
export async function setCustomTax(ctx: MyContext, value: number) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);
  strategy.max_buy_tax_percent = value;
  strategy.max_sell_tax_percent = value;
  setUserCustomStrategy(user.id, strategy);

  await ctx.answerCallbackQuery({ text: `Max Taxes set to ${value}%` });
  await showCustomStrategyPage3(ctx);
}

/**
 * Save custom strategy
 */
export async function saveCustomStrategy(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const strategy = getUserCustomStrategy(user.id);

  await updateUserSettings(user.id, {
    trading_strategy: 'CUSTOM' as TradingStrategy,
    custom_strategy: strategy,
  });

  await ctx.answerCallbackQuery({ text: 'Custom strategy saved!' });

  // Show confirmation
  const message = `${LINE}
✅ *STRATEGY SAVED*
${LINE}

Your custom strategy is now active!

All new trades will use your custom settings.

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text('« Back to Strategies', 'settings_strategy')
    .row()
    .text('« Back to Menu', 'back_to_menu');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Reset custom strategy to defaults
 */
export async function resetCustomStrategy(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  setUserCustomStrategy(user.id, { ...DEFAULT_CUSTOM_STRATEGY });

  await ctx.answerCallbackQuery({ text: 'Strategy reset to defaults' });
  await showCustomStrategyPage5(ctx);
}

/**
 * Request custom input for a field
 */
export async function requestCustomInput(ctx: MyContext, field: string) {
  const user = ctx.from;
  if (!user) return;

  ctx.session.step = `awaiting_custom_${field}` as CustomStrategyStep;

  let prompt = '';
  switch (field) {
    case 'tp':
      prompt = 'Enter your custom take profit percentage (10-500):';
      break;
    case 'sl':
      prompt = 'Enter your custom stop loss percentage (5-50):';
      break;
    case 'maxhold':
      prompt = 'Enter your custom max hold time in minutes (5-1440):';
      break;
    default:
      prompt = 'Enter your custom value:';
  }

  await ctx.reply(prompt);
  await ctx.answerCallbackQuery();
}

// === LEGACY EXPORTS (backward compatibility) ===

/**
 * Show custom TP/SL (legacy - redirects to page 1)
 */
export async function showCustomTpSl(ctx: MyContext) {
  await showCustomStrategyPage1(ctx);
}

// === HELPER FUNCTIONS ===

function formatStrategyMenu(current: TradingStrategy): string {
  let message = `${LINE}\n🎯 *TRADING STRATEGIES*\n${LINE}\n\n`;
  message += 'Select a preset or create custom:\n\n';

  for (const [key, info] of Object.entries(STRATEGY_INFO)) {
    const isActive = key === current;
    const marker = isActive ? '▶️' : '  ';
    message += `${marker} ${info.emoji} *${info.name}*\n`;
    message += `    ${info.description}\n`;
    message += `    _Best for: ${info.bestFor}_\n\n`;
  }

  const currentInfo = STRATEGY_INFO[current];
  if (currentInfo) {
    message += `${LINE}\n_Current: ${currentInfo.emoji} ${currentInfo.name}_`;
  }

  return message;
}

function strategyKeyboard(current: TradingStrategy): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const strategies: TradingStrategy[] = ['MICRO_SCALP', 'STANDARD', 'MOON_BAG', 'DCA_EXIT', 'TRAILING'];

  for (const strategy of strategies) {
    const info = STRATEGY_INFO[strategy];
    const label = strategy === current ? `${info.emoji} ${info.name} ✓` : `${info.emoji} ${info.name}`;
    keyboard.text(label, `strategy_view_${strategy}`).row();
  }

  keyboard.text('🔧 Create Custom Strategy', 'custom_page_1').row().text('« Back to Settings', 'menu_settings');

  return keyboard;
}

function formatHoldTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes === 60) return '1 hour';
  if (minutes < 1440) return `${minutes / 60} hours`;
  return '24 hours';
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}K`;
  return num.toString();
}
