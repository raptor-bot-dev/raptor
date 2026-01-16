import type { MyContext } from '../types.js';
import { upsertUser, userHasWallet } from '@raptor/shared';
import { initializeUserWallet } from '../services/wallet.js';
import { showHome } from '../handlers/home.js';

/**
 * Main /start command - Entry point for RAPTOR v3
 *
 * Flow:
 * - First-time user: Auto-generate wallet, show v3 Home panel
 * - Returning user: Show v3 Home panel with balance & stats
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

    if (!hasWallet) {
      // New user - auto-generate wallet first
      await initializeUserWallet(user.id);
    }

    // Show v3 Home panel for all users
    await showHome(ctx);
  } catch (error) {
    console.error('Error in start command:', error);
    // Fallback to basic error message
    await ctx.reply('Error loading. Please try again with /start');
  }
}

/**
 * Show start/home via callback (for back navigation)
 * Re-exports showHome for backward compatibility
 */
export { showHome as showStart } from '../handlers/home.js';

/**
 * Show main menu via callback (for back navigation)
 * Re-exports showHome for backward compatibility
 */
export { showHome as showMenu } from '../handlers/home.js';
