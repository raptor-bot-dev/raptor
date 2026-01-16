import { Bot, session, GrammyError, HttpError } from 'grammy';
import { run, sequentialize } from '@grammyjs/runner';
import type { MyContext, SessionData } from './types.js';
import { startCommand } from './commands/start.js';
import { depositCommand } from './commands/deposit.js';
import { withdrawCommand } from './commands/withdraw.js';
import { statusCommand } from './commands/status.js';
import { positionsCommand } from './commands/positions.js';
import { settingsCommand } from './commands/settings.js';
import { helpCommand } from './commands/help.js';
import { snipeCommand } from './commands/snipe.js';
import { sellCommand } from './commands/sell.js';
import { chainsCommand } from './commands/chains.js';
// v2.2 new commands
import { menuCommand } from './commands/menu.js';
import { walletCommand } from './commands/wallet.js';
import { balanceCommand } from './commands/balance.js';
import { huntCommand } from './commands/hunt.js';
import { historyCommand } from './commands/history.js';
import { scoreCommand } from './commands/score.js';
import { strategyCommand } from './commands/strategy.js';
import { gasCommand } from './commands/gas.js';
import { slippageCommand } from './commands/slippage.js';
// v2.3 self-custodial
import { backupCommand } from './commands/backup.js';
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

// Register commands
bot.command('start', startCommand);
bot.command('menu', menuCommand);  // v2.2 main hub
bot.command('wallet', walletCommand);  // v2.2 wallet management
bot.command('balance', balanceCommand);  // v2.2 quick balance check
bot.command('hunt', huntCommand);  // v2.2 auto-hunt settings
bot.command('history', historyCommand);  // v2.2 trade history
bot.command('score', scoreCommand);  // v2.2 token analysis
bot.command('strategy', strategyCommand);  // v2.2 trading strategy
bot.command('gas', gasCommand);  // v2.2 per-chain gas
bot.command('slippage', slippageCommand);  // v2.2 per-chain slippage
bot.command('deposit', depositCommand);
bot.command('withdraw', withdrawCommand);
bot.command('status', statusCommand);
bot.command('positions', positionsCommand);
bot.command('settings', settingsCommand);
bot.command('help', helpCommand);
bot.command('snipe', snipeCommand);
bot.command('sell', sellCommand);
bot.command('chains', chainsCommand);
bot.command('backup', backupCommand);  // v2.3 private key backup

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

// v3.4.2: Set bot commands for the menu (added missing commands)
bot.api.setMyCommands([
  { command: 'menu', description: '🏠 Main menu' },
  { command: 'wallet', description: '💳 Wallet management' },
  { command: 'balance', description: '💰 Check balances' },
  { command: 'sell', description: '💰 Sell tokens' },
  { command: 'positions', description: '📊 View positions' },
  { command: 'snipe', description: '🎯 Snipe a token' },
  { command: 'hunt', description: '🦅 Hunt settings' },
  { command: 'score', description: '🔍 Analyze token' },
  { command: 'history', description: '📜 Trade history' },
  { command: 'deposit', description: '📥 Deposit funds' },
  { command: 'withdraw', description: '📤 Withdraw funds' },
  { command: 'strategy', description: '📈 Trading strategy' },
  { command: 'settings', description: '⚙️ User settings' },
  { command: 'gas', description: '⛽ Gas settings' },
  { command: 'slippage', description: '📉 Slippage settings' },
  { command: 'chains', description: '🔗 Chain selection' },
  { command: 'backup', description: '🔐 Export private keys' },
  { command: 'status', description: '📡 Bot status' },
  { command: 'help', description: '❓ Help & guides' },
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
