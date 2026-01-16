import { Bot, session, GrammyError, HttpError } from 'grammy';
import { run, sequentialize } from '@grammyjs/runner';
import type { MyContext, SessionData } from './types.js';
import { startCommand } from './commands/start.js';
import { helpCommand } from './commands/help.js';
// v3.5: Import showHome to redirect legacy commands
import { showHome } from './handlers/home.js';
import { handleCallbackQuery } from './handlers/callbacks.js';
import { handleTextMessage } from './handlers/messages.js';
import { depositMonitor } from './services/depositMonitor.js';
// v2.3.1 Security middleware
import { rateLimitMiddleware } from './middleware/rateLimit.js';
// v3.1 Trade monitor service
import { startMonitorRefreshLoop, stopMonitorRefreshLoop } from './services/tradeMonitor.js';
import { solanaExecutor } from '@raptor/executor/solana';
import { shouldWrapTelegramText, wrapTelegramMarkdown, clampTelegramText } from './utils/panelWrap.js';

// SECURITY: L-007 - Global promise rejection and error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Promise Rejection:', reason);
  // Log but don't crash - let the bot continue serving other users
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  // For uncaught exceptions, we should exit gracefully
  process.exit(1);
});

// Validate environment
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

// Build info for debugging production deployments
console.log('==================================================');
console.log('RAPTOR Bot - Solana-only build');
console.log(`  Version:  ${process.env.npm_package_version || '3.5.0'}`);
console.log(`  Commit:   ${process.env.GIT_COMMIT || process.env.FLY_IMAGE_REF || 'unknown'}`);
console.log(`  Env:      ${process.env.NODE_ENV || 'development'}`);
console.log(`  Region:   ${process.env.FLY_REGION || 'local'}`);
console.log(`  App:      ${process.env.FLY_APP_NAME || 'raptor-bot'}`);
console.log(`  Started:  ${new Date().toISOString()}`);
console.log('==================================================');

// Initialize bot
const bot = new Bot<MyContext>(process.env.TELEGRAM_BOT_TOKEN);

// ---------------------------------------------------------------------------
// Global UI middleware (panel wrapper)
// ---------------------------------------------------------------------------
// Applies a consistent RAPTOR header + divider to Markdown (v1) messages.
// This yields a premium, uniform look across commands/callback panels without
// forcing a full rewrite.
bot.api.config.use(async (prev, method, payload, signal) => {
  try {
    // Only wrap text-based methods.
    if ((method === 'sendMessage' || method === 'editMessageText') && shouldWrapTelegramText(payload)) {
      // Type assertion: shouldWrapTelegramText validates payload has text field
      const textPayload = payload as { text: string; parse_mode?: string; disable_web_page_preview?: boolean };
      const wrapped = wrapTelegramMarkdown(textPayload.text);
      textPayload.text = clampTelegramText(wrapped);

      // Ensure consistent defaults.
      textPayload.parse_mode = textPayload.parse_mode || 'Markdown';
      if (textPayload.disable_web_page_preview === undefined) {
        textPayload.disable_web_page_preview = true;
      }
    }
  } catch (e) {
    // Never fail the request due to UI wrapping.
    console.error('[UI] wrap error:', e);
  }

  return prev(method, payload, signal);
});

// Session middleware
// M-5 LIMITATION: Uses in-memory storage - session state is lost on restart/redeploy.
// This affects users in multi-step flows (withdrawal, import) who will need to restart.
// For production scaling, consider @grammyjs/storage-supabase or Redis adapter.
// Current impact is minimal since most flows complete quickly (<30s).
bot.use(
  session({
    initial: (): SessionData => ({
      step: null,
      pendingWithdrawal: null,
    }),
  })
);

// Sequentialize updates per user to prevent race conditions
bot.use(sequentialize((ctx) => ctx.from?.id.toString()));

// Rate limiting middleware - SECURITY: Prevent DoS and abuse
bot.use(rateLimitMiddleware());

// v3.5: Register only v3 commands per DESIGN.md
bot.command('start', startCommand);
bot.command('help', helpCommand);

// v3.5: Redirect legacy commands to v3 Home panel
// Users who type old commands get redirected gracefully
bot.command('menu', async (ctx) => showHome(ctx));
bot.command('wallet', async (ctx) => showHome(ctx));
bot.command('balance', async (ctx) => showHome(ctx));
bot.command('hunt', async (ctx) => showHome(ctx));
bot.command('history', async (ctx) => showHome(ctx));
bot.command('positions', async (ctx) => showHome(ctx));
bot.command('settings', async (ctx) => showHome(ctx));
bot.command('withdraw', async (ctx) => showHome(ctx));
bot.command('deposit', async (ctx) => showHome(ctx));
bot.command('snipe', async (ctx) => showHome(ctx));
bot.command('sell', async (ctx) => showHome(ctx));
bot.command('status', async (ctx) => showHome(ctx));
bot.command('backup', async (ctx) => showHome(ctx));
bot.command('score', async (ctx) => showHome(ctx));
bot.command('strategy', async (ctx) => showHome(ctx));
bot.command('gas', async (ctx) => showHome(ctx));
bot.command('slippage', async (ctx) => showHome(ctx));
bot.command('chains', async (ctx) => showHome(ctx));

// Handle callback queries (inline button presses)
bot.on('callback_query:data', handleCallbackQuery);

// Handle text messages (for multi-step flows)
bot.on('message:text', handleTextMessage);

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);

  const e = err.error;
  if (e instanceof GrammyError) {
    console.error('Error in request:', e.description);
  } else if (e instanceof HttpError) {
    console.error('Could not contact Telegram:', e);
  } else {
    console.error('Unknown error:', e);
  }
});

// Start the bot
console.log('🦅 RAPTOR Bot starting...');

// v3.5: Simplified menu commands - only /start and /help per DESIGN.md
bot.api.setMyCommands([
  { command: 'start', description: 'Home - Dashboard and controls' },
  { command: 'help', description: 'Help and quick tips' },
]).catch((err) => {
  console.error('Failed to set bot commands:', err);
});

const runner = run(bot);

// Start deposit monitoring service
depositMonitor.start().catch((err) => {
  console.error('Failed to start deposit monitor:', err);
});

// Start trade monitor refresh loop
// Cast to any to avoid Bot<MyContext> vs Bot<Context> type mismatch
startMonitorRefreshLoop(bot as any, solanaExecutor).catch((err) => {
  console.error('Failed to start trade monitor loop:', err);
});

console.log('✅ RAPTOR Bot is running');

// Graceful shutdown
const stopRunner = async () => {
  console.log('Shutting down...');
  // P1-3 FIX: Stop trade monitor refresh loop
  stopMonitorRefreshLoop();
  await depositMonitor.stop();
  if (runner.isRunning()) {
    runner.stop();
  }
};

process.once('SIGINT', () => void stopRunner());
process.once('SIGTERM', () => void stopRunner());
