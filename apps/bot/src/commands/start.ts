import type { MyContext } from '../types.js';
import { upsertUser, userHasWallet, getUserWallets, getActivePositions } from '@raptor/shared';
import { formatWelcome, formatMainMenu } from '../utils/formatters.js';
import { welcomeKeyboard, mainMenuKeyboard } from '../utils/keyboards.js';

/**
 * Main /start command - Entry point for RAPTOR v2.3
 *
 * Flow:
 * - First-time user: Show welcome screen with "Get Started" button
 * - Returning user: Show main menu with all options
 */
export async function startCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    // Upsert user in database
    await upsertUser({
      tg_id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
    });

    // Check if user has any wallets (returning user)
    const hasWallet = await userHasWallet(user.id);

    if (hasWallet) {
      // Returning user - show main menu
      await showMainMenu(ctx, user.first_name || 'Trader');
    } else {
      // New user - show welcome with wallet generation prompt
      await showWelcomeScreen(ctx, user.first_name || 'Trader');
    }
  } catch (error) {
    console.error('Error in start command:', error);
    // Fallback to welcome screen on error
    await showWelcomeScreen(ctx, user.first_name || 'Trader');
  }
}

/**
 * Welcome screen for first-time users (v2.3)
 */
async function showWelcomeScreen(ctx: MyContext, firstName: string) {
  const message = formatWelcome(firstName);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: welcomeKeyboard(),
  });
}

/**
 * Main menu for returning users (v2.3)
 */
async function showMainMenu(ctx: MyContext, firstName: string) {
  const userId = ctx.from!.id;

  try {
    // Get user stats for dashboard
    const positions = await getActivePositions(userId);
    const wallets = await getUserWallets(userId);

    // Calculate total balance (simplified)
    let totalUSD = 0;
    let todayPnL = 0;

    for (const pos of positions) {
      const pnl = pos.unrealized_pnl_percent || 0;
      todayPnL += pnl;
    }

    // TODO: Get actual balance from wallets
    // For now, show placeholder

    const message = formatMainMenu(firstName, totalUSD, positions.length, todayPnL, 0);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  } catch (error) {
    console.error('[Start] Error loading menu:', error);

    // Fallback to basic menu
    const message = formatMainMenu(firstName, 0, 0, 0, 0);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  }
}

/**
 * Show start menu via callback (for back navigation)
 */
export async function showStart(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    const hasWallet = await userHasWallet(user.id);

    if (hasWallet) {
      await showMainMenuEdit(ctx, user.first_name || 'Trader');
    } else {
      await showWelcomeEdit(ctx, user.first_name || 'Trader');
    }

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Start] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading menu' });
  }
}

/**
 * Show main menu (callback / back navigation)
 */
export async function showMenu(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    await showMainMenuEdit(ctx, user.first_name || 'Trader');
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Menu] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading menu' });
  }
}

/**
 * Edit message version of welcome
 */
async function showWelcomeEdit(ctx: MyContext, firstName: string) {
  const message = formatWelcome(firstName);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: welcomeKeyboard(),
  });
}

/**
 * Edit message version of main menu
 */
async function showMainMenuEdit(ctx: MyContext, firstName: string) {
  const userId = ctx.from!.id;

  try {
    const positions = await getActivePositions(userId);

    let todayPnL = 0;
    for (const pos of positions) {
      todayPnL += pos.unrealized_pnl_percent || 0;
    }

    const message = formatMainMenu(firstName, 0, positions.length, todayPnL, 0);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  } catch (error) {
    console.error('[Menu] Error:', error);

    const message = formatMainMenu(firstName, 0, 0, 0, 0);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    });
  }
}
