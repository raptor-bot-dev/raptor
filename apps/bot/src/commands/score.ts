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

  // Send initial loading message
  await ctx.reply(
    `🔍 *Detecting chain & analyzing...*\n\n` +
    `\`${formatAddress(tokenAddress)}\`\n\n` +
    `_This may take a few seconds..._`,
    { parse_mode: 'Markdown' }
  );

  // Detect chain from address format (with async detection for EVM)
  const chain = await detectChainAsync(tokenAddress);

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
 * Detect chain from address format - with auto-detection for EVM
 */
async function detectChainAsync(address: string): Promise<Chain> {
  if (!address.startsWith('0x')) {
    return 'sol';
  }

  // For EVM addresses, try to detect the chain
  const { chainDetector } = await import('@raptor/shared');
  const result = await chainDetector.detectChain(address);

  // Return first detected chain, or default to ETH
  return result.primaryChain || 'eth';
}

/**
 * Detect chain from address format (sync version)
 */
function detectChain(address: string): Chain {
  if (address.startsWith('0x')) {
    return 'eth'; // Default, will be overridden by async detection
  }
  return 'sol';
}

/**
 * Analyze a token using real APIs and analysis
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
    bondingProgress?: number;
    graduated?: boolean;
  };
}> {
  // Import real APIs
  const { tokenData, birdeye, analyzeToken: runAnalysis } = await import('@raptor/shared');

  // Fetch token data and bonding curve info in parallel
  const fetchTasks: Promise<any>[] = [
    tokenData.getTokenInfo(address, chain),
    chain === 'sol' && birdeye.isConfigured()
      ? birdeye.analyzeTokenRisk(address)
      : Promise.resolve(null),
  ];

  // For Solana tokens, also fetch bonding curve info
  if (chain === 'sol') {
    const { solanaExecutor } = await import('@raptor/executor/solana');
    fetchTasks.push(solanaExecutor.getTokenInfo(address));
  } else {
    fetchTasks.push(Promise.resolve(null));
  }

  const [tokenInfo, birdeyeSecurity, bondingInfo] = await Promise.all(fetchTasks);

  // Calculate scores based on real data
  const categories = {
    sellability: 3,
    supplyIntegrity: 3,
    liquidityControl: 3,
    distribution: 3,
    deployerProvenance: 3,
    postLaunchControls: 3,
    executionRisk: 3,
  };

  const reasons: string[] = [];
  const hardStopReasons: string[] = [];

  // Calculate liquidity score
  const liquidity = tokenInfo?.liquidity ?? 0;
  if (liquidity >= 100000) {
    categories.liquidityControl = 5;
  } else if (liquidity >= 50000) {
    categories.liquidityControl = 4;
  } else if (liquidity >= 10000) {
    categories.liquidityControl = 3;
  } else if (liquidity >= 1000) {
    categories.liquidityControl = 2;
    reasons.push(`Low liquidity: ${tokenData.formatLargeNumber(liquidity)}`);
  } else {
    categories.liquidityControl = 1;
    reasons.push(`Very low liquidity: ${tokenData.formatLargeNumber(liquidity)}`);
  }

  // Use Birdeye security data if available (Solana)
  if (birdeyeSecurity) {
    // Incorporate Birdeye risk score
    if (birdeyeSecurity.score < 30) {
      categories.sellability = 1;
      hardStopReasons.push('High risk token (Birdeye score < 30)');
    } else if (birdeyeSecurity.score < 50) {
      categories.sellability = 2;
      reasons.push(`Moderate risk (score: ${birdeyeSecurity.score})`);
    } else if (birdeyeSecurity.score >= 80) {
      categories.sellability = 5;
    } else {
      categories.sellability = 3;
    }

    // Add security flags as reasons
    for (const flag of birdeyeSecurity.flags.slice(0, 5)) {
      reasons.push(flag);
    }
  } else if (tokenInfo?.securityFlags.length) {
    // Use DexScreener security flags
    for (const flag of tokenInfo.securityFlags.slice(0, 3)) {
      reasons.push(flag);
    }
  }

  // Check holders
  const holders = tokenInfo?.holders ?? 0;
  if (holders >= 1000) {
    categories.distribution = 5;
  } else if (holders >= 500) {
    categories.distribution = 4;
  } else if (holders >= 100) {
    categories.distribution = 3;
  } else if (holders >= 50) {
    categories.distribution = 2;
    reasons.push(`Low holder count: ${holders}`);
  } else {
    categories.distribution = 1;
    reasons.push(`Very few holders: ${holders}`);
  }

  // Check volume
  const volume = tokenInfo?.volume24h ?? 0;
  if (volume >= 100000) {
    categories.executionRisk = 5;
  } else if (volume >= 10000) {
    categories.executionRisk = 4;
  } else if (volume >= 1000) {
    categories.executionRisk = 3;
  } else {
    categories.executionRisk = 2;
    reasons.push(`Low 24h volume: ${tokenData.formatLargeNumber(volume)}`);
  }

  // Calculate total score
  const total = Object.values(categories).reduce((sum, val) => sum + val, 0);

  // Determine decision
  let decision: string;
  if (hardStopReasons.length > 0 || total < 15) {
    decision = 'SKIP';
  } else if (total < 20) {
    decision = 'TINY';
  } else if (total < 28) {
    decision = 'TRADABLE';
  } else {
    decision = 'BEST';
  }

  // Calculate age if pair creation time available
  let age = 'Unknown';
  if (tokenInfo?.pairCreatedAt) {
    const ageMs = Date.now() - tokenInfo.pairCreatedAt;
    const hours = Math.floor(ageMs / (1000 * 60 * 60));
    const mins = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      age = `${days}d ${hours % 24}h`;
    } else {
      age = `${hours}h ${mins}m`;
    }
  }

  // Format liquidity string
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
  const liqString = tokenInfo?.liquidity
    ? tokenData.formatLargeNumber(tokenInfo.liquidity)
    : 'Unknown';

  return {
    total,
    decision,
    categories,
    hardStops: {
      triggered: hardStopReasons.length > 0,
      reasons: hardStopReasons,
    },
    reasons: reasons.slice(0, 6),
    tokenInfo: {
      name: tokenInfo?.name || 'Unknown Token',
      symbol: tokenInfo?.symbol || '???',
      liquidity: liqString,
      holders: tokenInfo?.holders ?? 0,
      age,
      bondingProgress: bondingInfo?.bondingCurveProgress,
      graduated: bondingInfo?.graduated,
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
  message += `⏱️ *Age:* ${analysis.tokenInfo.age}\n`;

  // Bonding curve info for Solana tokens
  if (chain === 'sol' && analysis.tokenInfo.bondingProgress !== undefined) {
    if (analysis.tokenInfo.graduated) {
      message += `🎓 *Status:* Graduated (on DEX)\n`;
    } else {
      const progress = analysis.tokenInfo.bondingProgress;
      const barLength = 10;
      const filled = Math.floor((progress / 100) * barLength);
      const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
      message += `🔄 *Bonding:* ${bar} ${progress.toFixed(1)}%\n`;
    }
  }

  message += `\n`;

  // Score and decision
  message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `*Score:* ${analysis.total}/35 ${decisionEmoji[analysis.decision]} *${analysis.decision}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

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
  await ctx.editMessageText(
    `🔍 *Analyzing...*\n\n` +
    `\`${formatAddress(tokenAddress)}\`\n\n` +
    `_Detecting chain and fetching data..._`,
    { parse_mode: 'Markdown' }
  );

  try {
    // Use async chain detection for EVM addresses
    const chain = await detectChainAsync(tokenAddress);
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
    console.error('[Score] Analysis callback error:', error);
    await ctx.editMessageText(
      '❌ Analysis failed. Please try again.',
      { reply_markup: backKeyboard('menu') }
    );
  }

  await ctx.answerCallbackQuery();
}
