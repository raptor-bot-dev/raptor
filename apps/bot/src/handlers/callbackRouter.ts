/**
 * New Callback Router for RAPTOR v3 Terminal UI
 *
 * Routes new callback IDs (home:*, hunt:*, settings:*, etc.) to handlers.
 * Falls back to legacy handler for old callback patterns.
 *
 * Reference: MUST_READ/PROMPT.md for callback ID specification
 */

import type { MyContext } from '../types.js';
import { CALLBACK_PREFIXES } from '../ui/callbackIds.js';

// Import new handlers
import { handleHomeCallbacks } from './home.js';
import { handleHuntCallbacks } from './huntHandler.js';
import { handleSettingsCallbacks } from './settingsHandler.js';
import { handlePositionCallbacks } from './positionsHandler.js';
import { handleWithdrawCallbacks } from './withdrawHandler.js';
import { handleHelpCallbacks } from './helpHandler.js';

/**
 * Route new-style callbacks to appropriate handlers
 * Returns true if handled, false to fall through to legacy handler
 */
export async function routeNewCallbacks(ctx: MyContext): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) return false;

  // Route by prefix
  if (data.startsWith(CALLBACK_PREFIXES.HOME)) {
    await handleHomeCallbacks(ctx, data);
    return true;
  }

  if (data.startsWith(CALLBACK_PREFIXES.HUNT)) {
    await handleHuntCallbacks(ctx, data);
    return true;
  }

  if (data.startsWith(CALLBACK_PREFIXES.SETTINGS)) {
    await handleSettingsCallbacks(ctx, data);
    return true;
  }

  if (data.startsWith(CALLBACK_PREFIXES.POSITIONS) || data.startsWith(CALLBACK_PREFIXES.POSITION)) {
    await handlePositionCallbacks(ctx, data);
    return true;
  }

  if (data.startsWith(CALLBACK_PREFIXES.WITHDRAW)) {
    await handleWithdrawCallbacks(ctx, data);
    return true;
  }

  if (data.startsWith(CALLBACK_PREFIXES.HELP)) {
    await handleHelpCallbacks(ctx, data);
    return true;
  }

  // Not a new-style callback, fall through to legacy
  return false;
}
