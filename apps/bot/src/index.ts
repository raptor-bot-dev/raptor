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
import { handleCallbackQuery } from './handlers/callbacks.js';
import { handleTextMessage } from './handlers/messages.js';

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

// Register commands
bot.command('start', startCommand);
bot.command('deposit', depositCommand);
bot.command('withdraw', withdrawCommand);
bot.command('status', statusCommand);
bot.command('positions', positionsCommand);
bot.command('settings', settingsCommand);
bot.command('help', helpCommand);

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

const runner = run(bot);

console.log('✅ RAPTOR Bot is running');

// Graceful shutdown
const stopRunner = () => {
  if (runner.isRunning()) {
    runner.stop();
  }
};

process.once('SIGINT', stopRunner);
process.once('SIGTERM', stopRunner);
