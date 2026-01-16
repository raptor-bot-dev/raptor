import type { MyContext } from '../types.js';
import { showHelp } from '../handlers/helpHandler.js';

/**
 * /help command - Shows v3 Help panel
 * Uses the terminal UI per DESIGN.md (no emoji buttons, HTML formatting)
 */
export async function helpCommand(ctx: MyContext) {
  await showHelp(ctx);
}
