import type { MyContext } from '../types.js';
import { upsertUser, userHasWallet, getUserBalances, getUserStats } from '@raptor/shared';
import { formatWelcome, formatMainMenu } from '../utils/formatters.js';
import { welcomeKeyboard, mainMenuKeyboard } from '../utils/keyboards.js';
import { initializeUserWallet } from '../services/wallet.js';

/**
 * Main /start command - Entry point for RAPTOR v5.0
 *
 * Flow:
 * - First-time user: Auto-generate wallet, show deposit address
 * - Returning user: Show main menu with balance & P&L stats
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
      // Returning user - show main menu with stats
      await showMainMenu(ctx);
    } else {
      // New user - auto-generate wallet and show welcome
      await showNewUserWelcome(ctx);
    }
  } catch (error) {
    console.error('Error in start command:', error);
    // Fallback to basic menu on error
    await ctx.reply('❌ Error loading. Please try again with /start', {
      reply_markup: mainMenuKeyboard(),
    });
  }
}

/**
 * Welcome screen for first-time users (v5.0)
 * Auto-generates wallet and shows deposit address
 */
async function showNewUserWelcome(ctx: MyContext) {
  const userId = ctx.from!.id;

  try {
    // Auto-generate wallet
    const { solana } = await initializeUserWallet(userId);

    // Show welcome with deposit address
    const message = formatWelcome(solana.address);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: welcomeKeyboard(),
    });
  } catch (error) {
    console.error('[Start] Error generating wallet:', error);
    await ctx.reply(
      '❌ Error creating wallet. Please try again with /start\n\nMake sure USER_WALLET_ENCRYPTION_KEY is set.',
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

/**
 * Main menu for returning users (v5.0)
 * Shows balance and P&L stats
 */
async function showMainMenu(ctx: MyContext) {
  const userId = ctx.from!.id;

  try {
    // Fetch balance and stats in parallel
    const [balances, stats] = await Promise.all([
      getUserBalances(userId),
      getUserStats(userId),
    ]);

    // Calculate SOL balance
    let solBalance = 0;
    for (const bal of balances) {
      if (bal.chain === 'sol') {
        solBalance += parseFloat(bal.current_value) || 0;
      }
    }

    const message = formatMainMenu(solBalance, {
      totalPnl: stats.totalPnl,
      totalTrades: stats.totalTrades,
      winRate: stats.winRate,
    });

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  } catch (error) {
    console.error('[Start] Error loading menu:', error);

    // Fallback to basic menu
    const message = formatMainMenu(0, {
      totalPnl: 0,
      totalTrades: 0,
      winRate: 0,
    });

    await ctx.reply(message, {
      parse_mode: 'HTML',
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
      await showMainMenuEdit(ctx);
    } else {
      await showNewUserWelcomeEdit(ctx);
    }

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Start] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading menu' });
  }
}

/**
 * Show main menu via callback (for back navigation)
 */
export async function showMenu(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  try {
    await showMainMenuEdit(ctx);
    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('[Menu] Error:', error);
    await ctx.answerCallbackQuery({ text: 'Error loading menu' });
  }
}

/**
 * Edit message version of welcome (for callbacks)
 */
async function showNewUserWelcomeEdit(ctx: MyContext) {
  const userId = ctx.from!.id;

  try {
    const { solana } = await initializeUserWallet(userId);
    const message = formatWelcome(solana.address);

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: welcomeKeyboard(),
    });
  } catch (error) {
    console.error('[Start] Error in welcome edit:', error);
  }
}

/**
 * Edit message version of main menu (for callbacks)
 */
async function showMainMenuEdit(ctx: MyContext) {
  const userId = ctx.from!.id;

  try {
    const [balances, stats] = await Promise.all([
      getUserBalances(userId),
      getUserStats(userId),
    ]);

    let solBalance = 0;
    for (const bal of balances) {
      if (bal.chain === 'sol') {
        solBalance += parseFloat(bal.current_value) || 0;
      }
    }

    const message = formatMainMenu(solBalance, {
      totalPnl: stats.totalPnl,
      totalTrades: stats.totalTrades,
      winRate: stats.winRate,
    });

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  } catch (error) {
    console.error('[Menu] Error:', error);

    const message = formatMainMenu(0, {
      totalPnl: 0,
      totalTrades: 0,
      winRate: 0,
    });

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  }
}
