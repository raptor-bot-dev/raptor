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
import { getHuntSettings, saveHuntSettings } from '@raptor/shared';
import {
  chainsWithBackKeyboard,
  huntKeyboard,
  backKeyboard,
  percentagesKeyboard,
  CHAIN_EMOJI,
  CHAIN_NAME,
} from '../utils/keyboards.js';
import { formatHuntStatus } from '../utils/formatters.js';

// Hunt settings interface (SECURITY: P0-2 - Now persisted to database)
interface HuntSettings {
  enabled: boolean;
  minScore: number;
  maxPositionSize?: string;
  launchpads: string[];
  slippageBps?: number;    // v4.2: Hunt-specific buy slippage (default: 1500 = 15%)
  prioritySol?: number;    // v4.2: Hunt-specific priority fee (default: 0.001 SOL)
}

const defaultHuntSettings: Record<Chain, HuntSettings> = {
  sol: {
    enabled: false,
    minScore: 23,
    launchpads: ['pump.fun', 'moonshot', 'bonk.fun'],
    slippageBps: 1500,   // v4.2: 15% default for hunt (higher than manual 10%)
    prioritySol: 0.001,  // v4.2: 0.001 SOL default tip
  },
};

// In-memory cache with database persistence
const userHuntSettings = new Map<number, Record<Chain, HuntSettings>>();

async function getUserHuntSettingsAsync(tgId: number): Promise<Record<Chain, HuntSettings>> {
  // Check in-memory cache first
  if (userHuntSettings.has(tgId)) {
    return userHuntSettings.get(tgId)!;
  }

  // Load from database
  const dbSettings = await getHuntSettings(tgId);
  if (dbSettings) {
    const settings = dbSettings as Record<Chain, HuntSettings>;
    userHuntSettings.set(tgId, settings);
    return settings;
  }

  // Use defaults and save to database
  const defaults = JSON.parse(JSON.stringify(defaultHuntSettings));
  userHuntSettings.set(tgId, defaults);
  await saveHuntSettings(tgId, defaults);
  return defaults;
}

async function saveUserHuntSettings(tgId: number, settings: Record<Chain, HuntSettings>): Promise<void> {
  userHuntSettings.set(tgId, settings);
  await saveHuntSettings(tgId, settings);
}

/**
 * Main hunt command - merged panel with settings inline (v4.0)
 */
export async function huntCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserHuntSettingsAsync(user.id);
  const s = settings.sol;

  // Build merged hunt panel
  let message = '🦖 *HUNT*\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  // Status and settings inline
  const status = s.enabled ? '🟢 Active' : '🔴 Paused';
  message += `*Status:* ${status}\n`;
  message += `*Min Score:* *${s.minScore}*/100\n`;
  message += `*Position:* *${s.maxPositionSize || 'Auto'} SOL*\n`;

  // Show enabled launchpads
  message += `*Launchpads:* ${s.launchpads.length > 0 ? s.launchpads.join(', ') : 'None'}\n\n`;

  message += '_Auto-snipe new token launches_';

  const toggleText = s.enabled ? '🔴 Stop Hunt' : '🟢 Start Hunt';
  const keyboard = new InlineKeyboard()
    .text(toggleText, 'hunt_start_sol')
    .text('⚙️ Configure', 'hunt_chain_sol')
    .row()
    .text('🌱 New Launches', 'hunt_new')
    .text('🔥 Trending', 'hunt_trending')
    .row()
    .text('« Back', 'menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show hunt settings via callback - merged panel (v4.0)
 */
export async function showHunt(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserHuntSettingsAsync(user.id);
  const s = settings.sol;

  // Build merged hunt panel
  let message = '🦖 *HUNT*\n';
  message += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

  // Status and settings inline
  const status = s.enabled ? '🟢 Active' : '🔴 Paused';
  message += `*Status:* ${status}\n`;
  message += `*Min Score:* *${s.minScore}*/100\n`;
  message += `*Position:* *${s.maxPositionSize || 'Auto'} SOL*\n`;

  // Show enabled launchpads
  message += `*Launchpads:* ${s.launchpads.length > 0 ? s.launchpads.join(', ') : 'None'}\n\n`;

  message += '_Auto-snipe new token launches_';

  const toggleText = s.enabled ? '🔴 Stop Hunt' : '🟢 Start Hunt';
  const keyboard = new InlineKeyboard()
    .text(toggleText, 'hunt_start_sol')
    .text('⚙️ Configure', 'hunt_chain_sol')
    .row()
    .text('🌱 New Launches', 'hunt_new')
    .text('🔥 Trending', 'hunt_trending')
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

  const allSettings = await getUserHuntSettingsAsync(user.id);
  const settings = allSettings[chain];
  const message = formatHuntStatus({
    chain,
    enabled: settings.enabled,
    minScore: settings.minScore,
    maxPositionSize: settings.maxPositionSize,
    launchpads: settings.launchpads,
    slippageBps: settings.slippageBps,      // v4.2: Pass hunt-specific slippage
    prioritySol: settings.prioritySol,      // v4.2: Pass hunt-specific priority
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

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].enabled = enable;
  await saveUserHuntSettings(user.id, settings);

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

  const allSettings = await getUserHuntSettingsAsync(user.id);
  const settings = allSettings[chain];

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

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].minScore = score;
  await saveUserHuntSettings(user.id, settings);

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

  const allSettings = await getUserHuntSettingsAsync(user.id);
  const settings = allSettings[chain];
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

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].maxPositionSize = size === 'auto' ? undefined : size;
  await saveUserHuntSettings(user.id, settings);

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

  const allSettings = await getUserHuntSettingsAsync(user.id);
  const settings = allSettings[chain];

  // Available launchpads per chain (Solana-only build)
  const availableLaunchpads: Record<Chain, string[]> = {
    sol: ['pump.fun', 'pumpswap', 'moonshot', 'bonk.fun', 'believe.app'],
  };

  const launchpads = availableLaunchpads[chain];

  if (launchpads.length === 0) {
    await ctx.editMessageText(
      `🎯 *Launchpads - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n` +
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

  let message = `🎯 *Launchpads - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}\n\n`;
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

  const settings = await getUserHuntSettingsAsync(user.id);
  const idx = settings[chain].launchpads.indexOf(launchpad);

  if (idx >= 0) {
    settings[chain].launchpads.splice(idx, 1);
  } else {
    settings[chain].launchpads.push(launchpad);
  }
  await saveUserHuntSettings(user.id, settings);

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

  // Solana-only build
  const availableLaunchpads: Record<Chain, string[]> = {
    sol: ['pump.fun', 'pumpswap', 'moonshot', 'bonk.fun', 'believe.app'],
  };

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].launchpads = [...availableLaunchpads[chain]];
  await saveUserHuntSettings(user.id, settings);

  await ctx.answerCallbackQuery({ text: 'All launchpads enabled' });
  await showLaunchpadSelection(ctx, chain);
}

/**
 * Disable all launchpads for a chain
 */
export async function disableAllLaunchpads(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].launchpads = [];
  await saveUserHuntSettings(user.id, settings);

  await ctx.answerCallbackQuery({ text: 'All launchpads disabled' });
  await showLaunchpadSelection(ctx, chain);
}

/**
 * Show hunt slippage selection (v4.2)
 */
export async function showHuntSlippage(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const allSettings = await getUserHuntSettingsAsync(user.id);
  const settings = allSettings[chain];
  const currentBps = settings.slippageBps || 1500;
  const currentPercent = currentBps / 100;

  const message = `🎚️ *Hunt Slippage - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}

Current: *${currentPercent}%*

Set slippage tolerance for auto-hunt trades:

_Higher slippage = faster fills but worse prices_
_Hunt default is higher than manual for speed_`;

  const slippageOptions = [
    { bps: 1000, label: '10%' },
    { bps: 1500, label: '15%' },
    { bps: 2000, label: '20%' },
    { bps: 2500, label: '25%' },
    { bps: 3000, label: '30%' },
  ];

  const keyboard = new InlineKeyboard();
  for (let i = 0; i < slippageOptions.length; i += 3) {
    if (i > 0) keyboard.row();
    for (let j = i; j < Math.min(i + 3, slippageOptions.length); j++) {
      const opt = slippageOptions[j];
      const check = currentBps === opt.bps ? ' ✓' : '';
      keyboard.text(`${opt.label}${check}`, `hunt_slip_set_${chain}_${opt.bps}`);
    }
  }
  keyboard.row().text('← Back', `hunt_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set hunt slippage (v4.2)
 */
export async function setHuntSlippage(ctx: MyContext, chain: Chain, bps: number) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].slippageBps = bps;
  await saveUserHuntSettings(user.id, settings);

  await ctx.answerCallbackQuery({ text: `Hunt slippage set to ${bps / 100}%` });

  // Refresh slippage selection view
  await showHuntSlippage(ctx, chain);
}

/**
 * Show hunt priority fee selection (v4.2)
 */
export async function showHuntPriority(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  const allSettings = await getUserHuntSettingsAsync(user.id);
  const settings = allSettings[chain];
  const currentPriority = settings.prioritySol || 0.001;

  const message = `⚡ *Hunt Priority Fee - ${CHAIN_NAME[chain]}* ${CHAIN_EMOJI[chain]}

Current: *${currentPriority} SOL*

Set priority fee (tip) for auto-hunt trades:

_Higher priority = faster transaction inclusion_
_Paid to validators for priority processing_`;

  const priorityOptions = [
    { sol: 0.0005, label: '0.0005' },
    { sol: 0.001, label: '0.001' },
    { sol: 0.002, label: '0.002' },
    { sol: 0.005, label: '0.005' },
    { sol: 0.01, label: '0.01' },
  ];

  const keyboard = new InlineKeyboard();
  for (let i = 0; i < priorityOptions.length; i += 3) {
    if (i > 0) keyboard.row();
    for (let j = i; j < Math.min(i + 3, priorityOptions.length); j++) {
      const opt = priorityOptions[j];
      const check = currentPriority === opt.sol ? ' ✓' : '';
      keyboard.text(`${opt.label} SOL${check}`, `hunt_prio_set_${chain}_${opt.sol}`);
    }
  }
  keyboard.row().text('← Back', `hunt_chain_${chain}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

/**
 * Set hunt priority fee (v4.2)
 */
export async function setHuntPriority(ctx: MyContext, chain: Chain, sol: number) {
  const user = ctx.from;
  if (!user) return;

  const settings = await getUserHuntSettingsAsync(user.id);
  settings[chain].prioritySol = sol;
  await saveUserHuntSettings(user.id, settings);

  await ctx.answerCallbackQuery({ text: `Hunt priority set to ${sol} SOL` });

  // Refresh priority selection view
  await showHuntPriority(ctx, chain);
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
        `🌱 *${type === 'new' ? 'New Launches' : 'Trending Tokens'}*\n\n` +
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

    let message = `🌱 *${type === 'new' ? 'New Launches' : 'Trending Tokens'}*\n\n`;

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
      `🌱 *${type === 'new' ? 'New Launches' : 'Trending Tokens'}*\n\n` +
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
