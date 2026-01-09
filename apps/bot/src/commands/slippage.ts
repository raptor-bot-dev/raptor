/**
 * Slippage Command - Per-chain slippage settings for RAPTOR v2.2
 *
 * Configure slippage tolerance per chain:
 * - Default slippage in BPS (basis points)
 * - Auto-slippage mode
 * - Per-chain customization
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { chainsWithBackKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';

interface SlippageSettings {
  auto: boolean;
  slippageBps: number; // Basis points (100 = 1%)
}

const defaultSlippageSettings: Record<Chain, SlippageSettings> = {
  sol: { auto: true, slippageBps: 1500 },   // 15% default for memecoin volatility
  bsc: { auto: true, slippageBps: 1200 },   // 12%
  base: { auto: true, slippageBps: 1000 },  // 10%
  eth: { auto: true, slippageBps: 500 },    // 5% (less volatile typically)
};

// In-memory slippage settings (would be in database)
const userSlippageSettings = new Map<number, Record<Chain, SlippageSettings>>();

function getUserSlippageSettings(tgId: number): Record<Chain, SlippageSettings> {
  if (!userSlippageSettings.has(tgId)) {
    userSlippageSettings.set(tgId, JSON.parse(JSON.stringify(defaultSlippageSettings)));
  }
  return userSlippageSettings.get(tgId)!;
}

/**
 * Convert BPS to percentage string
 */
function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/**
 * Main slippage command - show chain selection
 */
export async function slippageCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSlippageSettings(user.id);

  let message = '🎚️ *Slippage Settings*\n\n';
  message += 'Configure slippage tolerance per chain:\n\n';

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const s = settings[chain];
    const mode = s.auto ? '🔄 Auto' : bpsToPercent(s.slippageBps);
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${mode}\n`;
  }

  message += '\n_Higher slippage = more likely to fill but worse price_';

  const keyboard = chainsWithBackKeyboard('slip_chain', 'settings');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show slippage settings via callback
 */
export async function showSlippage(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSlippageSettings(user.id);

  let message = '🎚️ *Slippage Settings*\n\n';
  message += 'Configure slippage tolerance per chain:\n\n';

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const s = settings[chain];
    const mode = s.auto ? '🔄 Auto' : bpsToPercent(s.slippageBps);
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${mode}\n`;
  }

  message += '\n_Higher slippage = more likely to fill but worse price_';

  const keyboard = chainsWithBackKeyboard('slip_chain', 'settings');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show slippage settings for a specific chain
 */
export async function showChainSlippage(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSlippageSettings(user.id)[chain];

  let message = `🎚️ *Slippage - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n`;

  message += `*Mode:* ${settings.auto ? '🔄 Auto' : '📌 Fixed'}\n`;
  message += `*Slippage:* ${bpsToPercent(settings.slippageBps)}\n\n`;

  message += '*What is Slippage?*\n';
  message += 'The maximum price difference you accept between ';
  message += 'quote and execution.\n\n';

  message += '*Recommendations:*\n';
  if (chain === 'sol') {
    message += '• Fresh launches: 15-25%\n';
    message += '• Established tokens: 5-10%\n';
  } else if (chain === 'eth') {
    message += '• Most tokens: 3-5%\n';
    message += '• Volatile tokens: 10-15%\n';
  } else {
    message += '• Fresh launches: 10-20%\n';
    message += '• Established tokens: 5-10%\n';
  }

  message += '\n_Auto mode adjusts based on token volatility_';

  const keyboard = slippageChainKeyboard(chain, settings);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle auto-slippage for a chain
 */
export async function toggleAutoSlippage(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSlippageSettings(user.id);
  settings[chain].auto = !settings[chain].auto;

  const mode = settings[chain].auto ? 'Auto' : 'Fixed';
  await ctx.answerCallbackQuery({ text: `Slippage mode: ${mode}` });

  await showChainSlippage(ctx, chain);
}

/**
 * Show slippage value selection for a chain
 */
export async function showSlippageSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSlippageSettings(user.id)[chain];

  const message = `🎚️ *Set Slippage - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n` +
    `Current: ${bpsToPercent(settings.slippageBps)}\n\n` +
    `Select slippage tolerance:`;

  // Common slippage values
  const values = [
    { bps: 300, label: '3%' },
    { bps: 500, label: '5%' },
    { bps: 1000, label: '10%' },
    { bps: 1500, label: '15%' },
    { bps: 2000, label: '20%' },
    { bps: 2500, label: '25%' },
  ];

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < values.length; i += 3) {
    for (let j = i; j < i + 3 && j < values.length; j++) {
      const v = values[j];
      const isActive = settings.slippageBps === v.bps;
      const label = isActive ? `${v.label} ✓` : v.label;
      keyboard.text(label, `slip_set_${chain}_${v.bps}`);
    }
    keyboard.row();
  }

  keyboard.text('← Back', `slip_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set slippage for a chain
 */
export async function setSlippage(ctx: MyContext, chain: Chain, bps: number) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserSlippageSettings(user.id);
  settings[chain].slippageBps = bps;
  settings[chain].auto = false; // Disable auto when setting manual

  await ctx.answerCallbackQuery({ text: `Slippage set to ${bpsToPercent(bps)}` });

  await showChainSlippage(ctx, chain);
}

/**
 * Build keyboard for chain slippage settings
 */
function slippageChainKeyboard(chain: Chain, settings: SlippageSettings): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      settings.auto ? '🔄 Auto Mode ON' : '📌 Fixed Mode',
      `slip_toggle_${chain}`
    )
    .row()
    .text(`📊 Set: ${bpsToPercent(settings.slippageBps)}`, `slip_value_${chain}`)
    .row()
    .text('← Back', 'settings_slippage');
}
