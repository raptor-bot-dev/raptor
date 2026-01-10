/**
 * Hunt Command - Auto-hunting settings for RAPTOR v2.2
 *
 * Configure automatic token hunting per chain:
 * - Enable/disable hunting
 * - Set minimum score threshold
 * - Configure position sizes
 * - Select launchpads to monitor
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import {
  chainsWithBackKeyboard,
  huntKeyboard,
  backKeyboard,
  percentagesKeyboard,
  CHAIN_EMOJI,
  CHAIN_NAME,
} from '../utils/keyboards.js';
import { formatHuntStatus } from '../utils/formatters.js';

// In-memory hunt settings (would be from database in production)
interface HuntSettings {
  enabled: boolean;
  minScore: number;
  maxPositionSize?: string;
  launchpads: string[];
}

const defaultHuntSettings: Record<Chain, HuntSettings> = {
  sol: { enabled: false, minScore: 23, launchpads: ['pump.fun', 'moonshot', 'bonk.fun'] },
  bsc: { enabled: false, minScore: 23, launchpads: ['four.meme'] },
  base: { enabled: false, minScore: 23, launchpads: ['virtuals.fun', 'base.pump'] },
  eth: { enabled: false, minScore: 25, launchpads: [] }, // Higher threshold for ETH due to gas
};

// Store user hunt settings (would be in database)
const userHuntSettings = new Map<number, Record<Chain, HuntSettings>>();

function getUserHuntSettings(tgId: number): Record<Chain, HuntSettings> {
  if (!userHuntSettings.has(tgId)) {
    userHuntSettings.set(tgId, JSON.parse(JSON.stringify(defaultHuntSettings)));
  }
  return userHuntSettings.get(tgId)!;
}

/**
 * Main hunt command - show chain selection
 */
export async function huntCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);

  // Build status message
  let message = '🦅 *RAPTOR Hunt*\n\n';
  message += '*Browse Opportunities:*\n';
  message += '🌱 New Launches - Fresh tokens on bonding curves\n';
  message += '🔥 Trending - Top performing tokens\n\n';
  message += '*Auto-Hunt Status:*\n';

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const s = settings[chain];
    const status = s.enabled ? '🟢' : '🔴';
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${status}\n`;
  }

  message += '\n_Configure auto-hunt to trade new tokens automatically._';

  const keyboard = new InlineKeyboard()
    .text('🌱 New Launches', 'hunt_new')
    .text('🔥 Trending', 'hunt_trending')
    .row()
    .text(`${CHAIN_EMOJI.sol} Solana`, 'hunt_chain_sol')
    .text(`${CHAIN_EMOJI.bsc} BSC`, 'hunt_chain_bsc')
    .row()
    .text(`${CHAIN_EMOJI.base} Base`, 'hunt_chain_base')
    .text(`${CHAIN_EMOJI.eth} Ethereum`, 'hunt_chain_eth')
    .row()
    .text('« Back', 'menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show hunt settings via callback
 */
export async function showHunt(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);

  let message = '🦅 *RAPTOR Hunt*\n\n';
  message += '*Browse Opportunities:*\n';
  message += '🌱 New Launches - Fresh tokens on bonding curves\n';
  message += '🔥 Trending - Top performing tokens\n\n';
  message += '*Auto-Hunt Status:*\n';

  for (const chain of ['sol', 'bsc', 'base', 'eth'] as Chain[]) {
    const s = settings[chain];
    const status = s.enabled ? '🟢' : '🔴';
    message += `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}: ${status}\n`;
  }

  message += '\n_Configure auto-hunt to trade new tokens automatically._';

  const keyboard = new InlineKeyboard()
    .text('🌱 New Launches', 'hunt_new')
    .text('🔥 Trending', 'hunt_trending')
    .row()
    .text(`${CHAIN_EMOJI.sol} Solana`, 'hunt_chain_sol')
    .text(`${CHAIN_EMOJI.bsc} BSC`, 'hunt_chain_bsc')
    .row()
    .text(`${CHAIN_EMOJI.base} Base`, 'hunt_chain_base')
    .text(`${CHAIN_EMOJI.eth} Ethereum`, 'hunt_chain_eth')
    .row()
    .text('« Back', 'menu');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Show settings for a specific chain
 */
export async function showChainHunt(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id)[chain];
  const message = formatHuntStatus({
    chain,
    enabled: settings.enabled,
    minScore: settings.minScore,
    maxPositionSize: settings.maxPositionSize,
    launchpads: settings.launchpads,
  });

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: huntKeyboard(chain, settings.enabled),
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle hunt on/off for a chain
 */
export async function toggleHunt(ctx: MyContext, chain: Chain, enable: boolean) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);
  settings[chain].enabled = enable;

  const status = enable ? 'started' : 'paused';
  await ctx.answerCallbackQuery({ text: `Hunt ${status} for ${CHAIN_NAME[chain]}` });

  // Refresh the view
  await showChainHunt(ctx, chain);
}

/**
 * Show min score selection
 */
export async function showScoreSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id)[chain];

  const message = `🎚️ *Minimum Score - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}

Current: *${settings.minScore}/35*

Select minimum score for auto-trades:

*Score Guide:*
• 15-22: Tiny positions only
• 23-28: Normal tradable
• 29-35: Best quality

_Higher score = safer but fewer trades_`;

  const keyboard = new InlineKeyboard()
    .text(settings.minScore === 15 ? '15 ✓' : '15', `hunt_score_set_${chain}_15`)
    .text(settings.minScore === 20 ? '20 ✓' : '20', `hunt_score_set_${chain}_20`)
    .text(settings.minScore === 23 ? '23 ✓' : '23', `hunt_score_set_${chain}_23`)
    .row()
    .text(settings.minScore === 25 ? '25 ✓' : '25', `hunt_score_set_${chain}_25`)
    .text(settings.minScore === 28 ? '28 ✓' : '28', `hunt_score_set_${chain}_28`)
    .text(settings.minScore === 30 ? '30 ✓' : '30', `hunt_score_set_${chain}_30`)
    .row()
    .text('← Back', `hunt_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set min score for a chain
 */
export async function setMinScore(ctx: MyContext, chain: Chain, score: number) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);
  settings[chain].minScore = score;

  await ctx.answerCallbackQuery({ text: `Min score set to ${score}` });

  // Refresh score selection view
  await showScoreSelection(ctx, chain);
}

/**
 * Show position size selection
 */
export async function showSizeSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id)[chain];
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  const message = `💰 *Position Size - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}

Current: ${settings.maxPositionSize ? `${settings.maxPositionSize} ${symbol}` : 'Auto (% of balance)'}

Set maximum position size per trade:`;

  // Size options based on chain
  const sizes = chain === 'sol'
    ? ['0.5', '1', '2', '5']
    : chain === 'bsc'
    ? ['0.1', '0.25', '0.5', '1']
    : ['0.05', '0.1', '0.25', '0.5'];

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < sizes.length; i += 2) {
    if (i > 0) keyboard.row();
    keyboard.text(`${sizes[i]} ${symbol}`, `hunt_size_set_${chain}_${sizes[i]}`);
    if (i + 1 < sizes.length) {
      keyboard.text(`${sizes[i + 1]} ${symbol}`, `hunt_size_set_${chain}_${sizes[i + 1]}`);
    }
  }

  keyboard
    .row()
    .text('🔄 Auto (% of balance)', `hunt_size_set_${chain}_auto`)
    .row()
    .text('← Back', `hunt_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set position size for a chain
 */
export async function setPositionSize(ctx: MyContext, chain: Chain, size: string) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);
  settings[chain].maxPositionSize = size === 'auto' ? undefined : size;

  await ctx.answerCallbackQuery({ text: `Position size updated` });

  // Refresh size selection view
  await showSizeSelection(ctx, chain);
}

/**
 * Show launchpad selection
 */
export async function showLaunchpadSelection(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id)[chain];

  // Available launchpads per chain
  const availableLaunchpads: Record<Chain, string[]> = {
    sol: ['pump.fun', 'pumpswap', 'moonshot', 'bonk.fun', 'believe.app'],
    bsc: ['four.meme'],
    base: ['virtuals.fun', 'wow.xyz', 'base.pump'],
    eth: [],
  };

  const launchpads = availableLaunchpads[chain];

  if (launchpads.length === 0) {
    await ctx.editMessageText(
      `🚀 *Launchpads - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n` +
      `No specific launchpads configured for this chain.\n` +
      `All new token launches will be monitored.`,
      {
        parse_mode: 'Markdown',
        reply_markup: backKeyboard(`hunt_chain_${chain}`),
      }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  let message = `🚀 *Launchpads - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n`;
  message += 'Select launchpads to monitor:\n\n';

  const keyboard = new InlineKeyboard();

  for (const lp of launchpads) {
    const isEnabled = settings.launchpads.includes(lp);
    const emoji = isEnabled ? '✅' : '⬜';
    keyboard.text(`${emoji} ${lp}`, `hunt_lp_toggle_${chain}_${lp}`).row();
  }

  keyboard
    .text('✅ Enable All', `hunt_lp_all_${chain}`)
    .text('❌ Disable All', `hunt_lp_none_${chain}`)
    .row()
    .text('← Back', `hunt_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Toggle a launchpad
 */
export async function toggleLaunchpad(ctx: MyContext, chain: Chain, launchpad: string) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);
  const idx = settings[chain].launchpads.indexOf(launchpad);

  if (idx >= 0) {
    settings[chain].launchpads.splice(idx, 1);
  } else {
    settings[chain].launchpads.push(launchpad);
  }

  await ctx.answerCallbackQuery();

  // Refresh launchpad selection view
  await showLaunchpadSelection(ctx, chain);
}

/**
 * Enable all launchpads for a chain
 */
export async function enableAllLaunchpads(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const availableLaunchpads: Record<Chain, string[]> = {
    sol: ['pump.fun', 'pumpswap', 'moonshot', 'bonk.fun', 'believe.app'],
    bsc: ['four.meme'],
    base: ['virtuals.fun', 'wow.xyz', 'base.pump'],
    eth: [],
  };

  const settings = getUserHuntSettings(user.id);
  settings[chain].launchpads = [...availableLaunchpads[chain]];

  await ctx.answerCallbackQuery({ text: 'All launchpads enabled' });
  await showLaunchpadSelection(ctx, chain);
}

/**
 * Disable all launchpads for a chain
 */
export async function disableAllLaunchpads(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = getUserHuntSettings(user.id);
  settings[chain].launchpads = [];

  await ctx.answerCallbackQuery({ text: 'All launchpads disabled' });
  await showLaunchpadSelection(ctx, chain);
}

/**
 * Show live opportunities from all launchpads
 */
export async function showOpportunities(ctx: MyContext, type: 'new' | 'trending') {
  const user = ctx.from;
  if (!user) return;

  try {
    const { launchpadDetector } = await import('@raptor/shared');

    const tokens = type === 'new'
      ? await launchpadDetector.getNewLaunches(10)
      : await launchpadDetector.getTrending(10);

    if (tokens.length === 0) {
      await ctx.editMessageText(
        `🦅 *${type === 'new' ? 'New Launches' : 'Trending Tokens'}*\n\n` +
        `No tokens found at the moment.\n` +
        `Try again in a few minutes.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('🔄 Refresh', `hunt_${type}`)
            .text('« Back', 'hunt'),
        }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    let message = `🦅 *${type === 'new' ? 'New Launches' : 'Trending Tokens'}*\n\n`;

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < Math.min(tokens.length, 8); i++) {
      const t = tokens[i];
      const lpEmoji = launchpadDetector.getLaunchpadEmoji(t.launchpad.launchpad);
      const lpName = launchpadDetector.getLaunchpadName(t.launchpad.launchpad);

      // Format price
      const priceStr = t.priceInSol > 0
        ? `${t.priceInSol.toFixed(6)} SOL`
        : 'N/A';

      // Status
      const statusEmoji = t.launchpad.status === 'bonding'
        ? (t.launchpad.bondingProgress >= 90 ? '🔥' : t.launchpad.bondingProgress >= 50 ? '📈' : '🌱')
        : '🎓';

      message += `${lpEmoji} *${t.symbol}* — ${lpName}\n`;
      message += `${statusEmoji} ${t.launchpad.bondingProgress.toFixed(0)}% | 💰 ${priceStr}\n`;
      if (t.security) {
        const secEmoji = t.security.riskScore >= 70 ? '✅' : t.security.riskScore >= 40 ? '🟡' : '⚠️';
        message += `${secEmoji} Security: ${t.security.riskScore}/100\n`;
      }
      message += '\n';

      // Add button for each token
      keyboard.text(`${lpEmoji} ${t.symbol}`, `analyze_sol_${t.mint}`);
      if ((i + 1) % 2 === 0) keyboard.row();
    }

    keyboard
      .row()
      .text('🔄 Refresh', `hunt_${type}`)
      .text('« Back', 'hunt');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('[Hunt] Opportunities error:', error);
    await ctx.editMessageText(
      `🦅 *${type === 'new' ? 'New Launches' : 'Trending Tokens'}*\n\n` +
      `⚠️ Error fetching data. Try again later.`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('🔄 Retry', `hunt_${type}`)
          .text('« Back', 'hunt'),
      }
    );
  }

  await ctx.answerCallbackQuery();
}
