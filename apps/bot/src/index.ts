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

// Initialize bot
const bot = new Bot<MyContext>(process.env.TELEGRAM_BOT_TOKEN);

// Session middleware
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

// Set bot commands for the menu
bot.api.setMyCommands([
  { command: 'menu', description: '🏠 Main menu' },
  { command: 'wallet', description: '💳 Wallet management' },
  { command: 'balance', description: '💰 Check balances' },
  { command: 'hunt', description: '🦅 Auto-hunt settings' },
  { command: 'score', description: '🔍 Analyze token' },
  { command: 'snipe', description: '🎯 Snipe a token' },
  { command: 'positions', description: '📊 View positions' },
  { command: 'strategy', description: '📈 Trading strategy' },
  { command: 'gas', description: '⛽ Gas settings' },
  { command: 'slippage', description: '📉 Slippage settings' },
  { command: 'backup', description: '🔐 Export private keys' },
  { command: 'help', description: '❓ Help & guides' },
]).catch((err) => {
  console.error('Failed to set bot commands:', err);
});

const runner = run(bot);

// Start deposit monitoring service
depositMonitor.start().catch((err) => {
  console.error('Failed to start deposit monitor:', err);
});

console.log('✅ RAPTOR Bot is running');

// Graceful shutdown
const stopRunner = async () => {
  console.log('Shutting down...');
  await depositMonitor.stop();
  if (runner.isRunning()) {
    runner.stop();
  }
};

process.once('SIGINT', () => void stopRunner());
process.once('SIGTERM', () => void stopRunner());
