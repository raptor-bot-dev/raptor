/**
 * Hunt Handler - Routes hunt:* callbacks for arm/disarm autohunt
 * Reference: MUST_READ/PROMPT.md
 */

import type { MyContext } from '../types.js';
import { CB } from '../ui/callbackIds.js';
import {
  renderArmConfirm,
  renderDisarmConfirm,
  renderArmed,
  renderDisarmed,
  renderArmError,
  type ArmConfirmData,
} from '../ui/panels/hunt.js';
import {
  getOrCreateAutoStrategy,
  updateStrategy,
  getUserOpenPositions,
} from '@raptor/shared';
import { showHome } from './home.js';

/**
 * Show hunt panel from /hunt command
 * Shows arm or disarm confirmation based on current state
 */
export async function showHunt(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    if (strategy.enabled) {
      // Already armed - show disarm confirmation
      const positions = await getUserOpenPositions(userId);
      const panel = renderDisarmConfirm(positions.length);
      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(panel.text, panel.opts);
        } catch (error) {
          if (!(error instanceof Error && error.message.includes('message is not modified'))) {
            throw error;
          }
        }
      } else {
        await ctx.reply(panel.text, panel.opts);
      }
    } else {
      // Not armed - show arm confirmation with settings
      if (!strategy.max_per_trade_sol || strategy.max_per_trade_sol <= 0) {
        const errorPanel = renderArmError('Trade size not set. Configure in Settings.');
        await ctx.reply(errorPanel.text, errorPanel.opts);
        return;
      }

      const armData: ArmConfirmData = {
        tradeSize: strategy.max_per_trade_sol,
        maxPositions: strategy.max_positions ?? 2,
        takeProfitPercent: strategy.take_profit_percent ?? 50,
        stopLossPercent: strategy.stop_loss_percent ?? 20,
      };

      const panel = renderArmConfirm(armData);
      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(panel.text, panel.opts);
        } catch (error) {
          if (!(error instanceof Error && error.message.includes('message is not modified'))) {
            throw error;
          }
        }
      } else {
        await ctx.reply(panel.text, panel.opts);
      }
    }
  } catch (error) {
    console.error('Error showing hunt:', error);
    const errorPanel = renderArmError('Failed to load. Please try again.');
    await ctx.reply(errorPanel.text, errorPanel.opts);
  }
}

/**
 * Handle hunt:* callbacks
 */
export async function handleHuntCallbacks(ctx: MyContext, data: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  switch (data) {
    case CB.HUNT.ARM:
      await showArmConfirm(ctx);
      break;

    case CB.HUNT.DISARM:
      await showDisarmConfirm(ctx);
      break;

    case CB.HUNT.CONFIRM_ARM:
      await confirmArm(ctx);
      break;

    case CB.HUNT.CONFIRM_DISARM:
      await confirmDisarm(ctx);
      break;

    case CB.HUNT.CANCEL:
      await showHome(ctx);
      break;

    default:
      console.warn(`Unknown hunt callback: ${data}`);
      await ctx.answerCallbackQuery('Unknown action');
  }
}

/**
 * Show arm confirmation panel with current settings
 */
async function showArmConfirm(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    // Validate settings before showing confirm
    if (!strategy.max_per_trade_sol || strategy.max_per_trade_sol <= 0) {
      const errorPanel = renderArmError('Trade size not set. Configure in Settings.');
      await ctx.editMessageText(errorPanel.text, errorPanel.opts);
      await ctx.answerCallbackQuery('Settings required');
      return;
    }

    const armData: ArmConfirmData = {
      tradeSize: strategy.max_per_trade_sol,
      maxPositions: strategy.max_positions ?? 2,
      takeProfitPercent: strategy.take_profit_percent ?? 50,
      stopLossPercent: strategy.stop_loss_percent ?? 20,
    };

    const panel = renderArmConfirm(armData);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error showing arm confirm:', error);
    await ctx.answerCallbackQuery('Error loading settings');
  }
}

/**
 * Show disarm confirmation panel
 */
async function showDisarmConfirm(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const positions = await getUserOpenPositions(userId);
    const panel = renderDisarmConfirm(positions.length);
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error showing disarm confirm:', error);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Confirm arming autohunt
 */
async function confirmArm(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    // Re-validate settings before arming (in case changed since showing panel)
    if (!strategy.max_per_trade_sol || strategy.max_per_trade_sol <= 0) {
      const errorPanel = renderArmError('Trade size not set. Configure in Settings first.');
      await ctx.editMessageText(errorPanel.text, errorPanel.opts);
      await ctx.answerCallbackQuery('Settings required');
      return;
    }

    // Enable the strategy
    await updateStrategy(strategy.id, { enabled: true });

    const panel = renderArmed();
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery('Autohunt armed!');
  } catch (error) {
    console.error('Error arming:', error);
    const errorPanel = renderArmError('Failed to arm. Please try again.');
    await ctx.editMessageText(errorPanel.text, errorPanel.opts);
    await ctx.answerCallbackQuery('Error');
  }
}

/**
 * Confirm disarming autohunt
 */
async function confirmDisarm(ctx: MyContext): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const strategy = await getOrCreateAutoStrategy(userId, 'sol');

    // Disable the strategy
    await updateStrategy(strategy.id, { enabled: false });

    const panel = renderDisarmed();
    await ctx.editMessageText(panel.text, panel.opts);
    await ctx.answerCallbackQuery('Autohunt disarmed');
  } catch (error) {
    console.error('Error disarming:', error);
    const errorPanel = renderArmError('Failed to disarm. Please try again.');
    await ctx.editMessageText(errorPanel.text, errorPanel.opts);
    await ctx.answerCallbackQuery('Error');
  }
}
