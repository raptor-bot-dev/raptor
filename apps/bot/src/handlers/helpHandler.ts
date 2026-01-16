/**
 * Help Handler - Routes help:* callbacks
 * Reference: MUST_READ/PROMPT.md
 */

import type { MyContext } from '../types.js';
import { CB } from '../ui/callbackIds.js';
import { renderHelp, renderQuickTips } from '../ui/panels/help.js';

/**
 * Handle help:* callbacks
 */
export async function handleHelpCallbacks(ctx: MyContext, data: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  switch (data) {
    case CB.HELP.OPEN:
      await showHelp(ctx);
      break;

    default:
      console.warn(`Unknown help callback: ${data}`);
      await ctx.answerCallbackQuery('Unknown action');
  }
}

/**
 * Show help panel
 */
export async function showHelp(ctx: MyContext): Promise<void> {
  try {
    const panel = renderHelp();

    if (ctx.callbackQuery) {
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error showing help:', error);
    await ctx.answerCallbackQuery('Error loading help');
  }
}

/**
 * Show quick tips (accessible from various panels)
 */
export async function showQuickTips(ctx: MyContext): Promise<void> {
  try {
    const panel = renderQuickTips();

    if (ctx.callbackQuery) {
      await ctx.editMessageText(panel.text, panel.opts);
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(panel.text, panel.opts);
    }
  } catch (error) {
    console.error('Error showing tips:', error);
    await ctx.answerCallbackQuery('Error');
  }
}
