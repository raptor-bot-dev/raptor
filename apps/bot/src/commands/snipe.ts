/**
 * Snipe Command - Manual token sniping for RAPTOR v2.2
 *
 * Enhanced with:
 * - Full token analysis before confirmation
 * - 7-category score display
 * - Hard stop warnings
 * - Confirm/cancel flow
 *
 * Usage: /snipe <contract> <amount> <chain>
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { createSnipeRequest, getUserBalancesByMode, analyzeToken as runTokenAnalysis } from '@raptor/shared';
import { snipeConfirmKeyboard, backKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';
import { formatAddress } from '../utils/formatters.js';

const CHAIN_NAMES: Record<string, Chain> = {
  sol: 'sol',
  solana: 'sol',
};

const CHAIN_SYMBOLS: Record<Chain, string> = {
  sol: 'SOL',
};

const MIN_AMOUNTS: Record<Chain, number> = {
  sol: 0.1,
};

// Pending snipes awaiting confirmation
interface PendingSnipe {
  tokenAddress: string;
  amount: number;
  chain: Chain;
  analysis?: TokenAnalysis;
  createdAt: number;
}

interface TokenAnalysis {
  total: number;
  decision: string;
  categories: {
    sellability: number;
    supplyIntegrity: number;
    liquidityControl: number;
    distribution: number;
    deployerProvenance: number;
    postLaunchControls: number;
    executionRisk: number;
  };
  hardStops: { triggered: boolean; reasons: string[] };
  reasons: string[];
  tokenInfo: {
    name: string;
    symbol: string;
    liquidity: string;
    holders: number;
    age: string;
  };
}

const pendingSnipes = new Map<number, PendingSnipe>();

/**
 * Main snipe command
 */
export async function snipeCommand(ctx: MyContext): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  // Parse arguments: /snipe <contract> <amount> <chain>
  const text = ctx.message?.text || '';
  const parts = text.split(/\s+/);
  const args = parts.slice(1); // Remove command

  if (args.length === 0) {
    await showSnipeHelp(ctx);
    return;
  }

  if (args.length < 3) {
    await ctx.reply(
      '❌ Missing arguments.\n\n' +
      'Usage: `/snipe <contract> <amount> <chain>`\n\n' +
      'Example: `/snipe 0x1234...abcd 0.5 bsc`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [tokenAddress, amountStr, chainInput] = args;

  // Validate chain
  const chain = CHAIN_NAMES[chainInput.toLowerCase()];
  if (!chain) {
    await ctx.reply(
      '❌ Invalid chain.\n\nSupported: `bsc`, `base`, `eth`, `sol`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a positive number.');
    return;
  }

  // Check minimum amount
  const minAmount = MIN_AMOUNTS[chain];
  const symbol = CHAIN_SYMBOLS[chain];
  if (amount < minAmount) {
    await ctx.reply(`❌ Minimum snipe amount is ${minAmount} ${symbol}`);
    return;
  }

  // Validate token address format
  if (!isValidAddress(tokenAddress, chain)) {
    await ctx.reply(
      chain === 'sol'
        ? '❌ Invalid Solana token address.'
        : '❌ Invalid EVM token address (must start with 0x).'
    );
    return;
  }

  // Check user balance
  try {
    const balances = await getUserBalancesByMode(tgId, 'snipe');
    const chainBalance = balances.find((b) => b.chain === chain);
    const currentBalance = chainBalance ? parseFloat(chainBalance.current_value) : 0;

    if (currentBalance < amount) {
      await ctx.reply(
        `❌ *Insufficient Balance*\n\n` +
        `Your snipe balance: ${currentBalance.toFixed(4)} ${symbol}\n` +
        `Required: ${amount} ${symbol}\n\n` +
        `Use /deposit to add funds.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Show analyzing message
    await ctx.reply(
      `🔍 *Analyzing Token...*\n\n` +
      `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}\n` +
      `\`${formatAddress(tokenAddress)}\`\n\n` +
      `_Running full analysis..._`,
      { parse_mode: 'Markdown' }
    );

    // Run full analysis (FULL tier for manual snipes)
    const analysis = await analyzeToken(tokenAddress, chain);

    // Store pending snipe
    pendingSnipes.set(tgId, {
      tokenAddress,
      amount,
      chain,
      analysis,
      createdAt: Date.now(),
    });

    // Format analysis message
    const message = formatSnipeAnalysis(tokenAddress, chain, amount, symbol, analysis);

    // Build confirmation keyboard based on analysis
    const keyboard = buildSnipeKeyboard(tokenAddress, analysis);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

  } catch (error) {
    console.error('[Snipe] Error:', error);
    await ctx.reply('❌ Failed to analyze token. Please try again.');
  }
}

/**
 * Handle snipe confirmation
 */
export async function handleSnipeConfirm(ctx: MyContext) {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const pending = pendingSnipes.get(tgId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: 'No pending snipe found' });
    return;
  }

  // Check if too old (5 minute timeout)
  if (Date.now() - pending.createdAt > 5 * 60 * 1000) {
    pendingSnipes.delete(tgId);
    await ctx.editMessageText(
      '❌ Snipe request expired. Please try again.',
      { reply_markup: backKeyboard('menu') }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    await ctx.editMessageText(
      '⏳ *Executing Snipe...*\n\n' +
      '_Submitting transaction..._',
      { parse_mode: 'Markdown' }
    );

    const request = await createSnipeRequest({
      tg_id: tgId,
      chain: pending.chain,
      token_address: pending.tokenAddress,
      amount: pending.amount.toString(),
      take_profit_percent: 50,
      stop_loss_percent: 30,
      skip_safety_check: false,
    });

    const symbol = CHAIN_SYMBOLS[pending.chain];

    await ctx.editMessageText(
      `✅ *Snipe Submitted*\n\n` +
      `🔖 Request: \`${request.id}\`\n` +
      `📦 Token: \`${formatAddress(pending.tokenAddress)}\`\n` +
      `💰 Amount: ${pending.amount} ${symbol}\n` +
      `${CHAIN_EMOJI[pending.chain]} Chain: ${CHAIN_NAME[pending.chain]}\n\n` +
      `_Execution in progress..._\n` +
      `Use /positions to track.`,
      {
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('menu'),
      }
    );

    pendingSnipes.delete(tgId);
  } catch (error) {
    console.error('[Snipe] Execution error:', error);
    await ctx.editMessageText(
      '❌ *Snipe Failed*\n\n' +
      'Could not execute snipe. Please try again.',
      {
        parse_mode: 'Markdown',
        reply_markup: backKeyboard('menu'),
      }
    );
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handle snipe cancellation
 */
export async function handleSnipeCancel(ctx: MyContext) {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  pendingSnipes.delete(tgId);

  await ctx.editMessageText(
    '❌ Snipe cancelled.',
    { reply_markup: backKeyboard('menu') }
  );

  await ctx.answerCallbackQuery();
}

/**
 * Handle snipe amount adjustment
 */
export async function handleSnipeAdjust(ctx: MyContext, adjustment: string) {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  const pending = pendingSnipes.get(tgId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: 'No pending snipe' });
    return;
  }

  // Adjust amount based on button
  switch (adjustment) {
    case 'half':
      pending.amount = pending.amount / 2;
      break;
    case 'double':
      pending.amount = pending.amount * 2;
      break;
  }

  const symbol = CHAIN_SYMBOLS[pending.chain];
  const message = formatSnipeAnalysis(
    pending.tokenAddress,
    pending.chain,
    pending.amount,
    symbol,
    pending.analysis!
  );

  const keyboard = buildSnipeKeyboard(pending.tokenAddress, pending.analysis!);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery({ text: `Amount: ${pending.amount} ${symbol}` });
}

/**
 * Show snipe help
 */
async function showSnipeHelp(ctx: MyContext) {
  await ctx.reply(
    '🎯 *Manual Snipe*\n\n' +
    'Snipe a token with full analysis.\n\n' +
    '*Usage:* `/snipe <contract> <amount> sol`\n\n' +
    '*Examples:*\n' +
    '`/snipe 6EF8...xyz 1.0 sol`\n\n' +
    '*Supported chains:*\n' +
    `${CHAIN_EMOJI.sol} sol - Solana\n\n` +
    '*Process:*\n' +
    '1. Token is analyzed (FULL check)\n' +
    '2. Score and risks are shown\n' +
    '3. You confirm or cancel\n' +
    '4. Trade is executed\n\n' +
    '_1% fee on all trades_',
    { parse_mode: 'Markdown' }
  );
}

/**
 * Validate address format
 */
function isValidAddress(address: string, chain: Chain): boolean {
  if (chain === 'sol') {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Analyze token using the real analysis service
 */
async function analyzeToken(address: string, chain: Chain): Promise<TokenAnalysis> {
  try {
    // Call the real token analysis service
    const result = await runTokenAnalysis(address, chain);

    return {
      total: result.total,
      decision: result.decision,
      categories: result.categories,
      hardStops: result.hardStops,
      reasons: result.reasons,
      tokenInfo: result.tokenInfo,
    };
  } catch (error) {
    console.error('[Snipe] Analysis error:', error);
    // Return failed analysis on error
    return {
      total: 0,
      decision: 'SKIP',
      categories: {
        sellability: 0,
        supplyIntegrity: 0,
        liquidityControl: 0,
        distribution: 0,
        deployerProvenance: 0,
        postLaunchControls: 0,
        executionRisk: 0,
      },
      hardStops: {
        triggered: true,
        reasons: ['Analysis failed - please try again'],
      },
      reasons: ['Analysis failed'],
      tokenInfo: {
        name: 'Unknown',
        symbol: '???',
        liquidity: '0',
        holders: 0,
        age: 'Unknown',
      },
    };
  }
}

/**
 * Format snipe analysis message
 */
function formatSnipeAnalysis(
  address: string,
  chain: Chain,
  amount: number,
  symbol: string,
  analysis: TokenAnalysis
): string {
  const decisionEmoji: Record<string, string> = {
    SKIP: '🚫',
    TINY: '🔸',
    TRADABLE: '✅',
    BEST: '🌟',
  };

  let message = `🎯 *Snipe Analysis*\n\n`;

  // Token info
  message += `${CHAIN_EMOJI[chain]} *${analysis.tokenInfo.name}* (${analysis.tokenInfo.symbol})\n`;
  message += `\`${formatAddress(address)}\`\n\n`;

  // Your trade
  message += `💰 *Your Trade:* ${amount} ${symbol}\n`;
  message += `💧 *Liquidity:* ${analysis.tokenInfo.liquidity}\n`;
  message += `👥 *Holders:* ${analysis.tokenInfo.holders}\n`;
  message += `⏱️ *Age:* ${analysis.tokenInfo.age}\n\n`;

  // Score and decision
  message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `*Score:* ${analysis.total}/35 ${decisionEmoji[analysis.decision]} *${analysis.decision}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Category breakdown
  const cats = analysis.categories;
  message += `📊 *Analysis:*\n`;
  message += `Sellability: ${'█'.repeat(cats.sellability)}${'░'.repeat(5 - cats.sellability)} ${cats.sellability}/5\n`;
  message += `Supply: ${'█'.repeat(cats.supplyIntegrity)}${'░'.repeat(5 - cats.supplyIntegrity)} ${cats.supplyIntegrity}/5\n`;
  message += `Liquidity: ${'█'.repeat(cats.liquidityControl)}${'░'.repeat(5 - cats.liquidityControl)} ${cats.liquidityControl}/5\n`;
  message += `Distribution: ${'█'.repeat(cats.distribution)}${'░'.repeat(5 - cats.distribution)} ${cats.distribution}/5\n`;
  message += `Deployer: ${'█'.repeat(cats.deployerProvenance)}${'░'.repeat(5 - cats.deployerProvenance)} ${cats.deployerProvenance}/5\n`;
  message += `Controls: ${'█'.repeat(cats.postLaunchControls)}${'░'.repeat(5 - cats.postLaunchControls)} ${cats.postLaunchControls}/5\n`;
  message += `Execution: ${'█'.repeat(cats.executionRisk)}${'░'.repeat(5 - cats.executionRisk)} ${cats.executionRisk}/5\n`;

  // Hard stops warning
  if (analysis.hardStops.triggered) {
    message += '\n🚨 *HARD STOPS TRIGGERED:*\n';
    for (const reason of analysis.hardStops.reasons) {
      message += `  ⛔ ${reason}\n`;
    }
    message += '\n⚠️ *This token has critical issues!*\n';
  }

  // Issues
  if (analysis.reasons.length > 0 && !analysis.hardStops.triggered) {
    message += '\n⚠️ *Issues:*\n';
    for (const reason of analysis.reasons) {
      message += `  • ${reason}\n`;
    }
  }

  return message;
}

/**
 * Build snipe confirmation keyboard
 */
function buildSnipeKeyboard(address: string, analysis: TokenAnalysis): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (analysis.hardStops.triggered) {
    // Hard stop - only allow cancel or force
    keyboard
      .text('⚠️ Force Snipe (RISKY)', `snipe_force_${address}`)
      .row()
      .text('❌ Cancel', 'snipe_cancel');
  } else if (analysis.decision === 'SKIP') {
    // Skip recommendation
    keyboard
      .text('⚠️ Snipe Anyway', `snipe_confirm`)
      .row()
      .text('❌ Cancel (Recommended)', 'snipe_cancel');
  } else {
    // Normal confirmation
    keyboard
      .text('✅ Confirm Snipe', 'snipe_confirm')
      .text('❌ Cancel', 'snipe_cancel')
      .row()
      .text('➗ Half', 'snipe_adjust_half')
      .text('✖️ Double', 'snipe_adjust_double');
  }

  return keyboard;
}

// Legacy advanced snipe command (kept for compatibility)
export async function snipeAdvancedCommand(ctx: MyContext): Promise<void> {
  await ctx.reply(
    '⚠️ Advanced snipe is deprecated.\n\n' +
    'Use `/snipe <contract> <amount> <chain>` instead.\n' +
    'Custom TP/SL can be set in Settings.',
    { parse_mode: 'Markdown' }
  );
}
