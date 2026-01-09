/**
 * Score Command - Token analysis for RAPTOR v2.2
 *
 * Analyzes a token and displays:
 * - 7-category scoring breakdown
 * - Hard stop warnings
 * - Trading decision (SKIP/TINY/TRADABLE/BEST)
 * - Issues found
 *
 * Usage: /score <token_address>
 */

import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { backKeyboard, snipeConfirmKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';
import { formatAnalysis, formatAddress } from '../utils/formatters.js';

/**
 * Main score command
 */
export async function scoreCommand(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  // Get token address from message
  const text = ctx.message?.text || '';
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await ctx.reply(
      '🔍 *Token Analysis*\n\n' +
      'Analyze any token before trading.\n\n' +
      '*Usage:* `/score <token_address>`\n\n' +
      '*Example:*\n' +
      '`/score 0x1234...` (EVM)\n' +
      '`/score ABC123...` (Solana)\n\n' +
      '_Paste a token contract address to analyze._',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const tokenAddress = parts[1].trim();

  // Validate address format
  if (!isValidAddress(tokenAddress)) {
    await ctx.reply(
      '❌ Invalid token address.\n\n' +
      'Please provide a valid contract address.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Detect chain from address format
  const chain = detectChain(tokenAddress);

  await ctx.reply(
    `🔍 *Analyzing token...*\n\n` +
    `${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}\n` +
    `\`${formatAddress(tokenAddress)}\`\n\n` +
    `_This may take a few seconds..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Perform analysis
    const analysis = await analyzeToken(tokenAddress, chain);

    const message = formatTokenAnalysis(tokenAddress, chain, analysis);

    // Show snipe button if tradable
    const keyboard = analysis.decision === 'SKIP'
      ? backKeyboard('menu')
      : snipeConfirmKeyboard(tokenAddress);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('[Score] Analysis error:', error);
    await ctx.reply(
      '❌ *Analysis Failed*\n\n' +
      'Could not analyze this token. It may be:\n' +
      '• Not a valid token contract\n' +
      '• On an unsupported chain\n' +
      '• Too new to analyze\n\n' +
      '_Try again or use a different token._',
      { parse_mode: 'Markdown' }
    );
  }
}

/**
 * Validate address format
 */
function isValidAddress(address: string): boolean {
  // EVM address (0x...)
  if (address.startsWith('0x') && address.length === 42) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  // Solana address (base58, 32-44 chars)
  if (address.length >= 32 && address.length <= 44) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  return false;
}

/**
 * Detect chain from address format
 */
function detectChain(address: string): Chain {
  if (address.startsWith('0x')) {
    // Default to BSC for EVM, could be improved with chain detection
    return 'bsc';
  }
  return 'sol';
}

/**
 * Analyze a token (placeholder - would call real analyzer)
 */
async function analyzeToken(
  address: string,
  chain: Chain
): Promise<{
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
}> {
  // Simulated delay for analysis
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Placeholder analysis result
  // In production, this would call the actual analyzer
  return {
    total: 24,
    decision: 'TRADABLE',
    categories: {
      sellability: 4,
      supplyIntegrity: 4,
      liquidityControl: 3,
      distribution: 3,
      deployerProvenance: 3,
      postLaunchControls: 4,
      executionRisk: 3,
    },
    hardStops: {
      triggered: false,
      reasons: [],
    },
    reasons: ['LP not locked', 'Top holder: 25%'],
    tokenInfo: {
      name: 'Sample Token',
      symbol: 'SAMPLE',
      liquidity: '50 SOL',
      holders: 150,
      age: '2h 30m',
    },
  };
}

/**
 * Format complete token analysis message
 */
function formatTokenAnalysis(
  address: string,
  chain: Chain,
  analysis: Awaited<ReturnType<typeof analyzeToken>>
): string {
  const decisionEmoji: Record<string, string> = {
    SKIP: '🚫',
    TINY: '🔸',
    TRADABLE: '✅',
    BEST: '🌟',
  };

  let message = `🔍 *Token Analysis*\n\n`;

  // Token info
  message += `${CHAIN_EMOJI[chain]} *${analysis.tokenInfo.name}* (${analysis.tokenInfo.symbol})\n`;
  message += `\`${formatAddress(address)}\`\n\n`;

  // Basic stats
  message += `💧 *Liquidity:* ${analysis.tokenInfo.liquidity}\n`;
  message += `👥 *Holders:* ${analysis.tokenInfo.holders}\n`;
  message += `⏱️ *Age:* ${analysis.tokenInfo.age}\n\n`;

  // Score and decision
  message += `━━━━━━━━━━━━━━━━━━\n`;
  message += `*Score:* ${analysis.total}/35 ${decisionEmoji[analysis.decision]} *${analysis.decision}*\n`;
  message += `━━━━━━━━━━━━━━━━━━\n\n`;

  // Category breakdown with visual bars
  const cats = analysis.categories;
  message += `📊 *Breakdown:*\n`;
  message += `Sellability: ${'█'.repeat(cats.sellability)}${'░'.repeat(5 - cats.sellability)} ${cats.sellability}/5\n`;
  message += `Supply: ${'█'.repeat(cats.supplyIntegrity)}${'░'.repeat(5 - cats.supplyIntegrity)} ${cats.supplyIntegrity}/5\n`;
  message += `Liquidity: ${'█'.repeat(cats.liquidityControl)}${'░'.repeat(5 - cats.liquidityControl)} ${cats.liquidityControl}/5\n`;
  message += `Distribution: ${'█'.repeat(cats.distribution)}${'░'.repeat(5 - cats.distribution)} ${cats.distribution}/5\n`;
  message += `Deployer: ${'█'.repeat(cats.deployerProvenance)}${'░'.repeat(5 - cats.deployerProvenance)} ${cats.deployerProvenance}/5\n`;
  message += `Controls: ${'█'.repeat(cats.postLaunchControls)}${'░'.repeat(5 - cats.postLaunchControls)} ${cats.postLaunchControls}/5\n`;
  message += `Execution: ${'█'.repeat(cats.executionRisk)}${'░'.repeat(5 - cats.executionRisk)} ${cats.executionRisk}/5\n`;

  // Hard stops
  if (analysis.hardStops.triggered) {
    message += '\n🚨 *HARD STOPS:*\n';
    for (const reason of analysis.hardStops.reasons) {
      message += `  ⛔ ${reason}\n`;
    }
  }

  // Issues
  if (analysis.reasons.length > 0) {
    message += '\n⚠️ *Issues:*\n';
    for (const reason of analysis.reasons) {
      message += `  • ${reason}\n`;
    }
  }

  // Recommendation
  message += '\n';
  switch (analysis.decision) {
    case 'SKIP':
      message += '❌ *Recommendation:* Do not trade this token.';
      break;
    case 'TINY':
      message += '⚠️ *Recommendation:* Small position only (high risk).';
      break;
    case 'TRADABLE':
      message += '✅ *Recommendation:* Normal position size.';
      break;
    case 'BEST':
      message += '🌟 *Recommendation:* Strong token, full position.';
      break;
  }

  return message;
}

/**
 * Handle score callback for quick analysis from menu
 */
export async function handleScoreRequest(ctx: MyContext, tokenAddress: string) {
  const chain = detectChain(tokenAddress);

  await ctx.editMessageText(
    `🔍 *Analyzing...*\n\n` +
    `\`${formatAddress(tokenAddress)}\``,
    { parse_mode: 'Markdown' }
  );

  try {
    const analysis = await analyzeToken(tokenAddress, chain);
    const message = formatTokenAnalysis(tokenAddress, chain, analysis);

    const keyboard = analysis.decision === 'SKIP'
      ? backKeyboard('menu')
      : snipeConfirmKeyboard(tokenAddress);

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    await ctx.editMessageText(
      '❌ Analysis failed. Please try again.',
      { reply_markup: backKeyboard('menu') }
    );
  }

  await ctx.answerCallbackQuery();
}
