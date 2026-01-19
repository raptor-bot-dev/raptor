/**
 * Settings Handler - Routes settings:* callbacks
 * Reference: MUST_READ/PROMPT.md
 */

import type { MyContext } from '../types.js';
import { CB, SESSION_STEPS } from '../ui/callbackIds.js';
import {
  renderSettings,
  renderEditTradeSize,
  renderEditMaxPositions,
  renderEditTakeProfit,
  renderEditStopLoss,
  renderEditSlippage,
  renderEditPriority,
  renderSnipeModeSelection,
  renderFilterModeSelection,
  renderSettingsUpdated,
  type SettingsData,
} from '../ui/panels/settings.js';
import {
  getOrCreateAutoStrategy,
  updateStrategy,
  getOrCreateChainSettings,
  updateChainSettings,
} from '@raptor/shared';
import { showHome } from './home.js';

/**
 * Handle settings:* callbacks
 */
export async function handleSettingsCallbacks(ctx: MyContext, data: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  switch (data) {
    case CB.SETTINGS.OPEN:
    case CB.SETTINGS.BACK_HOME:
      await showSettings(ctx);
      break;

    case CB.SETTINGS.EDIT_TRADE_SIZE:
      await showEditTradeSize(ctx);
      break;

    case CB.SETTINGS.EDIT_MAX_POSITIONS:
      await showEditMaxPositions(ctx);
      break;

    case CB.SETTINGS.EDIT_TP:
      await showEditTp(ctx);
      break;

    case CB.SETTINGS.EDIT_SL:
      await showEditSl(ctx);
      break;

    case CB.SETTINGS.EDIT_SLIPPAGE:
      await showEditSlippage(ctx);
      break;

    case CB.SETTINGS.EDIT_PRIORITY:
      await showEditPriority(ctx);
      break;

    case CB.SETTINGS.EDIT_SNIPE_MODE:
      await showSnipeMode(ctx);
      break;

    case CB.SETTINGS.SET_SNIPE_MODE_SPEED:
      await setSnipeMode(ctx, 'speed');
      break;

    case CB.SETTINGS.SET_SNIPE_MODE_QUALITY:
      await setSnipeMode(ctx, 'quality');
      break;

    case CB.SETTINGS.EDIT_FILTER_MODE:
      await showFilterMode(ctx);
      break;

    case CB.SETTINGS.SET_FILTER_MODE_STRICT:
      await setFilterMode(ctx, 'strict');
      break;

    case CB.SETTINGS.SET_FILTER_MODE_MODERATE:
      await setFilterMode(ctx, 'moderate');
      break;

    case CB.SETTINGS.SET_FILTER_MODE_LIGHT:
      await setFilterMode(ctx, 'light');
      break;

    case CB.SETTINGS.TOGGLE_MEV:
      await toggleMev(ctx);
      break;

    default:
      console.warn(`Unknown settings callback: ${data}`);
      await ctx.answerCallbackQuery('Unknown action');
  }
}

/**
 * Show settings panel
 */
export async function showSettings(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // Fetch strategy and chain settings in parallel
    const [strategy, chainSettings] = await Promise.all([
      getOrCreateAutoStrategy(userId, 'sol'),
      getOrCreateChainSettings(userId, 'sol'),
    ]);
    const snipeMode = strategy.snipe_mode === 'speed' ? 'speed' : 'quality';
    const filterMode = (['strict', 'moderate', 'light'].includes(strategy.filter_mode)
      ? strategy.filter_mode
      : 'moderate') as 'strict' | 'moderate' | 'light';

    const settingsData: SettingsData = {
      tradeSize: strategy.max_per_trade_sol ?? 0.1,
      maxPositions: strategy.max_positions ?? 2,
      takeProfitPercent: strategy.take_profit_percent ?? 50,
      stopLossPercent: strategy.stop_loss_percent ?? 20,
      slippageBps: strategy.slippage_bps ?? 1000,
      prioritySol: chainSettings.priority_sol ?? 0.0005,
      antiMevEnabled: chainSettings.anti_mev_enabled ?? true,
      snipeMode,
      filterMode,
    };

    const panel = renderSettings(settingsData);

    if (ctx.callbackQuery) {
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error showing settings:', error);
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery('Error loading settings');
    }
  }
}

/**
 * Show trade size edit prompt
 */
async function showEditTradeSize(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const panel = renderEditTradeSize(strategy.max_per_trade_sol ?? 0.1);

    // Set session state
    if (ctx.session) {
      ctx.session.step = SESSION_STEPS.AWAITING_TRADE_SIZE;
    }

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show max positions edit prompt
 */
async function showEditMaxPositions(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const panel = renderEditMaxPositions(strategy.max_positions ?? 2);

    if (ctx.session) {
      ctx.session.step = SESSION_STEPS.AWAITING_MAX_POSITIONS;
    }

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show take profit edit prompt
 */
async function showEditTp(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const panel = renderEditTakeProfit(strategy.take_profit_percent ?? 50);

    if (ctx.session) {
      ctx.session.step = SESSION_STEPS.AWAITING_TP_PERCENT;
    }

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show stop loss edit prompt
 */
async function showEditSl(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const panel = renderEditStopLoss(strategy.stop_loss_percent ?? 20);

    if (ctx.session) {
      ctx.session.step = SESSION_STEPS.AWAITING_SL_PERCENT;
    }

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show slippage edit prompt
 */
async function showEditSlippage(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const panel = renderEditSlippage(strategy.slippage_bps ?? 1000);

    if (ctx.session) {
      ctx.session.step = SESSION_STEPS.AWAITING_SLIPPAGE_BPS;
    }

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show priority fee edit prompt
 */
async function showEditPriority(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const chainSettings = await getOrCreateChainSettings(userId, 'sol');
    const panel = renderEditPriority(chainSettings.priority_sol ?? 0.0005);

    if (ctx.session) {
      ctx.session.step = SESSION_STEPS.AWAITING_PRIORITY_SOL;
    }

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show snipe mode selection panel
 */
async function showSnipeMode(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const mode = strategy.snipe_mode === 'speed' ? 'speed' : 'quality';
    const panel = renderSnipeModeSelection(mode);

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error showing snipe mode:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Set snipe mode (speed or quality)
 */
async function setSnipeMode(ctx: MyContext, mode: 'speed' | 'quality'): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    // Skip update if already set to this mode (prevents "message not modified" error)
    if (strategy.snipe_mode === mode) {
      await ctx.answerCallbackQuery(`Already set to ${mode === 'speed' ? 'Speed' : 'Quality'}`);
      return;
    }

    await updateStrategy(strategy.id, { snipe_mode: mode });
    await showSnipeMode(ctx);
  } catch (error) {
    console.error('Error setting snipe mode:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Show filter mode selection panel
 */
async function showFilterMode(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    const mode = (['strict', 'moderate', 'light'].includes(strategy.filter_mode)
      ? strategy.filter_mode
      : 'moderate') as 'strict' | 'moderate' | 'light';
    const panel = renderFilterModeSelection(mode);

    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error showing filter mode:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Set filter mode (strict, moderate, or light)
 */
async function setFilterMode(ctx: MyContext, mode: 'strict' | 'moderate' | 'light'): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    // Skip update if already set to this mode (prevents "message not modified" error)
    if (strategy.filter_mode === mode) {
      const modeLabels = { strict: 'Strict', moderate: 'Moderate', light: 'Light' };
      await ctx.answerCallbackQuery(`Already set to ${modeLabels[mode]}`);
      return;
    }

    await updateStrategy(strategy.id, { filter_mode: mode });
    await showFilterMode(ctx);
  } catch (error) {
    console.error('Error setting filter mode:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Toggle MEV protection on/off
 */
async function toggleMev(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // Get current setting
    const chainSettings = await getOrCreateChainSettings(userId, 'sol');
    const newValue = !chainSettings.anti_mev_enabled;

    // Update setting
    await updateChainSettings({
      userId,
      chain: 'sol',
      antiMevEnabled: newValue,
    });

    // Refresh settings panel
    await showSettings(ctx);
  } catch (error) {
    console.error('Error toggling MEV:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Handle settings input from text messages
 * Called from message handler when session step matches
 */
export async function handleSettingsInput(
  ctx: MyContext,
  step: string,
  input: string
): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');
    let field = '';
    let newValue = '';

    switch (step) {
      case SESSION_STEPS.AWAITING_TRADE_SIZE: {
        const amount = parseFloat(input);
        if (isNaN(amount) || amount <= 0 || amount > 100) {
          await ctx.reply('Invalid amount. Enter a value between 0.01 and 100 SOL.');
          return true;
        }
        await updateStrategy(strategy.id, { max_per_trade_sol: amount });
        field = 'Trade Size';
        newValue = `${amount} SOL`;
        break;
      }

      case SESSION_STEPS.AWAITING_MAX_POSITIONS: {
        const max = parseInt(input, 10);
        if (isNaN(max) || max < 1 || max > 5) {
          await ctx.reply('Invalid value. Enter 1 to 5.');
          return true;
        }
        await updateStrategy(strategy.id, { max_positions: max });
        field = 'Max Positions';
        newValue = `${max}`;
        break;
      }

      case SESSION_STEPS.AWAITING_TP_PERCENT: {
        const tp = parseFloat(input);
        if (isNaN(tp) || tp <= 0 || tp > 1000) {
          await ctx.reply('Invalid value. Enter a percentage between 1 and 1000.');
          return true;
        }
        await updateStrategy(strategy.id, { take_profit_percent: tp });
        field = 'Take Profit';
        newValue = `${tp}%`;
        break;
      }

      case SESSION_STEPS.AWAITING_SL_PERCENT: {
        const sl = parseFloat(input);
        if (isNaN(sl) || sl <= 0 || sl > 100) {
          await ctx.reply('Invalid value. Enter a percentage between 1 and 100.');
          return true;
        }
        await updateStrategy(strategy.id, { stop_loss_percent: sl });
        field = 'Stop Loss';
        newValue = `${sl}%`;
        break;
      }

      case SESSION_STEPS.AWAITING_SLIPPAGE_BPS: {
        // Accept percentage input (1-99%), store as bps (*100)
        // Note: 100% slippage = accept 0 output, so cap at 99%
        const slipPercent = parseFloat(input);
        if (isNaN(slipPercent) || slipPercent < 1 || slipPercent > 99) {
          await ctx.reply('Invalid value. Enter percentage between 1 and 99.');
          return true;
        }
        const slipBps = Math.round(slipPercent * 100);
        await updateStrategy(strategy.id, { slippage_bps: slipBps });
        field = 'Slippage';
        newValue = `${slipPercent}%`;
        break;
      }

      case SESSION_STEPS.AWAITING_PRIORITY_SOL: {
        const priority = parseFloat(input);
        if (isNaN(priority) || priority < 0.0001 || priority > 0.01) {
          await ctx.reply('Invalid value. Enter SOL between 0.0001 and 0.01.');
          return true;
        }
        await updateChainSettings({
          userId,
          chain: 'sol',
          prioritySol: priority,
        });
        field = 'Priority Fee';
        newValue = priority >= 0.001 ? `${priority} SOL` : `${(priority * 1000).toFixed(1)} mSOL`;
        break;
      }

      default:
        return false;
    }

    // Clear session step
    if (ctx.session) {
      ctx.session.step = null;
    }

    // Show confirmation
    const panel = renderSettingsUpdated(field, newValue);
    await ctx.reply(panel.text, panel.opts);
    return true;
  } catch (error) {
    console.error('Error handling settings input:', error);
    await ctx.reply('Error saving setting. Please try again.');
    return true;
  }
}
