/**
 * Message Formatters for RAPTOR v2.3
 *
 * Consistent message formatting across all bot screens.
 * Uses Markdown for rich text formatting.
 * Features wider panels and improved spacing.
 */

import type {
  Chain,
  Position,
  UserBalance,
  TradingStrategy,
  Trade,
  UserWallet,
  CustomStrategy,
} from '@raptor/shared';
import { CHAIN_EMOJI, CHAIN_NAME, STRATEGY_EMOJI } from './keyboards.js';

// ============================================================================
// UI Layout Constants (v2.3 Wider Panels)
// ============================================================================

/** Wide separator for panel headers */
export const LINE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** Section separator within panels */
export const SECTION = '━━━';

/** Status indicators */
export const STATUS = {
  ON: '🟢',
  OFF: '🔴',
  WARNING: '🟡',
  INFO: '🔵',
  PREMIUM: '🟣',
} as const;

/** Chain-specific colors */
export const CHAIN_STATUS: Record<Chain, string> = {
  sol: '🟢',
  bsc: '🟡',
  base: '🔵',
  eth: '🟣',
};

/**
 * Escape special characters for Telegram MarkdownV2
 * Characters that must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Note: Do NOT use this on text inside code blocks (backticks)
 */
export function escapeMarkdownV2(text: string): string {
  // Regex to match all special characters that need escaping in MarkdownV2
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// Format numbers with commas
export function formatNumber(num: number, decimals: number = 2): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Format USD amount
export function formatUSD(amount: number): string {
  return `$${formatNumber(amount, 2)}`;
}

// Format crypto amount
export function formatCrypto(amount: string | number, symbol: string, decimals: number = 4): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `${formatNumber(num, decimals)} ${symbol}`;
}

// Format percentage
export function formatPercent(percent: number, showSign: boolean = true): string {
  const sign = showSign && percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

// Format PnL with color emoji
export function formatPnL(percent: number): string {
  const emoji = percent >= 0 ? '🟢' : '🔴';
  const sign = percent >= 0 ? '+' : '';
  return `${emoji} ${sign}${percent.toFixed(2)}%`;
}

// Format address (truncated)
export function formatAddress(address: string, chars: number = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Format timestamp
export function formatTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format duration
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format main menu message (v2.3 wide layout)
 */
export function formatMainMenu(
  firstName: string,
  totalBalance: number,
  activePositions: number,
  todayPnL: number,
  activeOrders: number = 0
): string {
  const pnlEmoji = todayPnL >= 0 ? '🟢' : '🔴';
  const pnlSign = todayPnL >= 0 ? '+' : '';

  return `🦖 *RAPTOR*
${LINE}

Welcome back, *${firstName}*!

💰 *Total:* ${formatUSD(totalBalance)}
📈 *Today:* ${pnlSign}${formatUSD(Math.abs(todayPnL))} (${pnlSign}${todayPnL.toFixed(1)}%)

${SECTION} Active ${SECTION}
${STATUS.ON} ${activePositions} positions | 📋 ${activeOrders} orders

⚡ Paste a CA to trade instantly!`;
}

/**
 * Format welcome screen for first-time users (v2.3)
 */
export function formatWelcome(firstName: string): string {
  return `🦖 *Welcome to RAPTOR*
${LINE}

The fastest MEV hunter in the game.

⚡ *WHAT RAPTOR DOES:*
• Snipe new tokens before anyone else
• Auto-detect scams & honeypots
• Execute trades in milliseconds
• Monitor positions 24/7

🔐 *YOUR KEYS, YOUR COINS:*
Self-custody. We never store your keys.

⚡ Quick: Paste any contract address
   to get instant token info + buy!`;
}

/**
 * Format wallet credentials message (shown once, then deleted)
 */
export function formatWalletCredentials(
  chain: Chain,
  address: string,
  privateKey: string,
  walletIndex: number
): string {
  const chainEmoji = CHAIN_STATUS[chain];
  const chainName = CHAIN_NAME[chain];

  return `🔐 *WALLET CREDENTIALS*
${LINE}

${chainEmoji} *${chainName}* - Wallet #${walletIndex}

⚠️ *SAVE THIS NOW - MESSAGE WILL BE DELETED IN 2 MINUTES*

${SECTION} Address ${SECTION}
\`${address}\`

${SECTION} Private Key ${SECTION}
\`${privateKey}\`

🚨 *NEVER SHARE YOUR PRIVATE KEY*
Anyone with this key can access your funds.`;
}

/**
 * Format wallets overview (multi-wallet v2.3)
 */
export function formatWalletsOverview(
  wallets: UserWallet[],
  balances: Map<string, { balance: number; usdValue: number }>
): string {
  if (wallets.length === 0) {
    return `*💼 WALLETS*\n\nNo wallets yet\\. Generate your first wallet to get started\\!`;
  }

  let message = '*💼 WALLETS*\n';
  message += `${LINE}\n`;
  message += '_Manage your wallets across chains\\._\n\n';

  // Group wallets by chain
  const byChain = new Map<Chain, UserWallet[]>();
  for (const wallet of wallets) {
    if (!byChain.has(wallet.chain)) {
      byChain.set(wallet.chain, []);
    }
    byChain.get(wallet.chain)!.push(wallet);
  }

  // Track totals per chain
  const chainTotals = new Map<Chain, number>();

  for (const [chain, chainWallets] of byChain) {
    const chainEmoji = CHAIN_STATUS[chain];
    const chainName = CHAIN_NAME[chain];
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

    // Initialize chain total
    let chainTotal = 0;

    // Chain header with bold + underline
    message += `*__${chainEmoji} ${chainName}__*\n\n`;

    for (const wallet of chainWallets.sort((a, b) => a.wallet_index - b.wallet_index)) {
      const address = chain === 'sol' ? wallet.solana_address : wallet.evm_address;
      const key = `${chain}_${wallet.wallet_index}`;
      const balanceInfo = balances.get(key) || { balance: 0, usdValue: 0 };
      const activeMarker = wallet.is_active ? ' ✓' : '';

      // Wallet entry - full address in monospace
      // Escape # for MarkdownV2 (both in index AND in label)
      const label = wallet.wallet_label || `Wallet \\#${wallet.wallet_index}`;
      const escapedLabel = label.replace(/#/g, '\\#');
      message += `\\#${wallet.wallet_index} ${escapedLabel}${activeMarker}\n`;
      message += `\`${address}\`\n`;

      // CRITICAL FIX: Escape decimal points in balance
      const balanceText = `${balanceInfo.balance.toFixed(4)} ${symbol}`;
      message += `${escapeMarkdownV2(balanceText)}\n\n`;

      chainTotal += balanceInfo.balance;
    }

    // Store chain total
    chainTotals.set(chain, chainTotal);
  }

  // Display per-chain totals in native tokens
  message += '\n*Totals:*\n';
  for (const [chain, total] of chainTotals) {
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
    const totalText = `${total.toFixed(4)} ${symbol}`;
    message += `${CHAIN_STATUS[chain]} ${escapeMarkdownV2(totalText)}\n`;
  }

  return message;
}

/**
 * Format wallet overview message
 */
export function formatWallet(balances: UserBalance[]): string {
  if (balances.length === 0) {
    return `💰 *Wallet*

No balances yet. Deposit to get started!

Use the buttons below to deposit or view history.`;
  }

  let message = '💰 *Wallet Overview*\n\n';

  // Group by chain
  const byChain = new Map<Chain, UserBalance[]>();
  for (const bal of balances) {
    const chain = bal.chain as Chain;
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain)!.push(bal);
  }

  for (const [chain, chainBalances] of byChain) {
    const emoji = CHAIN_EMOJI[chain];
    const name = CHAIN_NAME[chain];
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

    message += `${emoji} *${name}*\n`;

    for (const bal of chainBalances) {
      const modeEmoji = bal.mode === 'pool' ? '🏊' : bal.mode === 'solo' ? '👤' : '🎯';
      const current = parseFloat(bal.current_value);
      message += `  ${modeEmoji} ${formatCrypto(current, symbol)}\n`;
    }
    message += '\n';
  }

  return message.trim();
}

/**
 * Format balances by chain message
 */
export function formatBalances(balances: UserBalance[]): string {
  if (balances.length === 0) {
    return `📊 *Balances*

You don't have any balances yet.

Use /deposit to add funds.`;
  }

  let message = '📊 *Your Balances*\n\n';
  let totalUSD = 0;

  for (const bal of balances) {
    const chain = bal.chain as Chain;
    const emoji = CHAIN_EMOJI[chain];
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
    const modeEmoji = bal.mode === 'pool' ? '🏊' : bal.mode === 'solo' ? '👤' : '🎯';

    const deposited = parseFloat(bal.deposited);
    const current = parseFloat(bal.current_value);
    const pnl = deposited > 0 ? ((current - deposited) / deposited) * 100 : 0;

    message += `${emoji} *${CHAIN_NAME[chain]}* ${modeEmoji}\n`;
    message += `  Deposited: ${formatCrypto(deposited, symbol)}\n`;
    message += `  Current: ${formatCrypto(current, symbol)}\n`;
    message += `  P&L: ${formatPnL(pnl)}\n\n`;
  }

  return message.trim();
}

/**
 * Format single position message
 */
export function formatPosition(position: Position): string {
  const chain = position.chain as Chain;
  const emoji = CHAIN_EMOJI[chain];
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  const entryPrice = parseFloat(position.entry_price);
  const currentPrice = parseFloat(position.current_price);
  const pnlPercent = position.unrealized_pnl_percent;
  const holdTime = Date.now() - new Date(position.created_at).getTime();

  const strategyEmoji = position.strategy ? STRATEGY_EMOJI[position.strategy] : '📊';
  const strategyName = position.strategy || 'Standard';

  let message = `${emoji} *${position.token_symbol}*

*Chain:* ${CHAIN_NAME[chain]}
*Strategy:* ${strategyEmoji} ${strategyName}
*Status:* ${position.status}

📈 *Entry:* ${formatCrypto(entryPrice, symbol, 8)}
📊 *Current:* ${formatCrypto(currentPrice, symbol, 8)}
${formatPnL(pnlPercent)} *Unrealized P&L*

⏱️ *Hold Time:* ${formatDuration(holdTime)}
🎯 *Take Profit:* ${position.take_profit_percent}%
🛑 *Stop Loss:* ${position.stop_loss_percent}%`;

  // Add trailing stop info if applicable
  if (position.trailing_stop_price) {
    message += `\n📍 *Trailing Stop:* ${formatCrypto(parseFloat(position.trailing_stop_price), symbol, 8)}`;
  }

  // Add peak price if tracked
  if (position.peak_price) {
    message += `\n🏔️ *Peak:* ${formatCrypto(parseFloat(position.peak_price), symbol, 8)}`;
  }

  // Add partial exit info
  if (position.partial_exit_taken) {
    if (position.exit_levels_hit) {
      message += `\n📤 *DCA Levels Hit:* ${position.exit_levels_hit}/4`;
    }
    if (position.moon_bag_amount) {
      message += `\n🌙 *Moon Bag:* ${formatCrypto(position.moon_bag_amount, 'tokens')}`;
    }
  }

  message += `\n\n🔗 \`${formatAddress(position.token_address)}\``;

  return message;
}

/**
 * Format positions list message
 */
export function formatPositionsList(positions: Position[]): string {
  if (positions.length === 0) {
    return `📊 *Positions*

No active positions.

Use /hunt to enable auto-hunting or /snipe to enter manually.`;
  }

  let message = `📊 *Active Positions* (${positions.length})\n\n`;

  for (let i = 0; i < positions.length && i < 10; i++) {
    const pos = positions[i];
    const chain = pos.chain as Chain;
    const emoji = CHAIN_EMOJI[chain];
    const pnlPercent = pos.unrealized_pnl_percent;
    const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';
    const pnlStr = pnlPercent >= 0 ? `+${pnlPercent.toFixed(1)}%` : `${pnlPercent.toFixed(1)}%`;

    message += `${i + 1}. ${emoji} *${pos.token_symbol}* ${pnlEmoji} ${pnlStr}\n`;
  }

  if (positions.length > 10) {
    message += `\n_...and ${positions.length - 10} more_`;
  }

  message += '\n\n_Tap a position to view details_';

  return message;
}

/**
 * Format token analysis message
 */
export function formatAnalysis(analysis: {
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
}): string {
  const decisionEmoji: Record<string, string> = {
    SKIP: '🚫',
    TINY: '🔸',
    TRADABLE: '✅',
    BEST: '🌟',
  };

  let message = `🔍 *Token Analysis*

*Score:* ${analysis.total}/35 ${decisionEmoji[analysis.decision]} *${analysis.decision}*

📊 *Category Breakdown:*
`;

  const cats = analysis.categories;
  message += `  Sellability: ${'█'.repeat(cats.sellability)}${'░'.repeat(5 - cats.sellability)} ${cats.sellability}/5\n`;
  message += `  Supply: ${'█'.repeat(cats.supplyIntegrity)}${'░'.repeat(5 - cats.supplyIntegrity)} ${cats.supplyIntegrity}/5\n`;
  message += `  Liquidity: ${'█'.repeat(cats.liquidityControl)}${'░'.repeat(5 - cats.liquidityControl)} ${cats.liquidityControl}/5\n`;
  message += `  Distribution: ${'█'.repeat(cats.distribution)}${'░'.repeat(5 - cats.distribution)} ${cats.distribution}/5\n`;
  message += `  Deployer: ${'█'.repeat(cats.deployerProvenance)}${'░'.repeat(5 - cats.deployerProvenance)} ${cats.deployerProvenance}/5\n`;
  message += `  Controls: ${'█'.repeat(cats.postLaunchControls)}${'░'.repeat(5 - cats.postLaunchControls)} ${cats.postLaunchControls}/5\n`;
  message += `  Execution: ${'█'.repeat(cats.executionRisk)}${'░'.repeat(5 - cats.executionRisk)} ${cats.executionRisk}/5\n`;

  // Hard stops
  if (analysis.hardStops.triggered) {
    message += '\n🚨 *HARD STOPS TRIGGERED:*\n';
    for (const reason of analysis.hardStops.reasons) {
      message += `  • ${reason}\n`;
    }
  }

  // Issues
  if (analysis.reasons.length > 0) {
    message += '\n⚠️ *Issues Found:*\n';
    for (const reason of analysis.reasons) {
      message += `  • ${reason}\n`;
    }
  }

  return message.trim();
}

/**
 * Format settings overview message
 */
export function formatSettings(settings: {
  strategy: TradingStrategy;
  customTp?: number;
  customSl?: number;
  maxPositionPercent: number;
  chainsEnabled: Chain[];
  notifications: {
    enabled: boolean;
    onEntry: boolean;
    onExit: boolean;
    dailySummary: boolean;
  };
}): string {
  const strategyEmoji = STRATEGY_EMOJI[settings.strategy];

  let message = `⚙️ *Settings*

📈 *Strategy:* ${strategyEmoji} ${settings.strategy}`;

  if (settings.customTp) {
    message += `\n  Custom TP: ${settings.customTp}%`;
  }
  if (settings.customSl) {
    message += `\n  Custom SL: ${settings.customSl}%`;
  }

  message += `\n\n📐 *Max Position:* ${settings.maxPositionPercent}% of balance`;

  message += '\n\n🔗 *Enabled Chains:*\n';
  for (const chain of settings.chainsEnabled) {
    message += `  ${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]}\n`;
  }

  message += '\n🔔 *Notifications:*\n';
  message += `  ${settings.notifications.enabled ? '✅' : '❌'} Enabled\n`;
  message += `  ${settings.notifications.onEntry ? '✅' : '❌'} Entry alerts\n`;
  message += `  ${settings.notifications.onExit ? '✅' : '❌'} Exit alerts\n`;
  message += `  ${settings.notifications.dailySummary ? '✅' : '❌'} Daily summary`;

  return message;
}

/**
 * Format hunt status message
 */
export function formatHuntStatus(huntSettings: {
  chain: Chain;
  enabled: boolean;
  minScore: number;
  maxPositionSize?: string;
  launchpads: string[];
}): string {
  const chain = huntSettings.chain;
  const emoji = CHAIN_EMOJI[chain];
  const status = huntSettings.enabled ? '🟢 Active' : '🔴 Paused';

  let message = `🦅 *Hunt Settings - ${CHAIN_NAME[chain]}* ${emoji}

*Status:* ${status}
*Min Score:* ${huntSettings.minScore}/35`;

  if (huntSettings.maxPositionSize) {
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
    message += `\n*Max Position:* ${formatCrypto(huntSettings.maxPositionSize, symbol)}`;
  }

  if (huntSettings.launchpads.length > 0) {
    message += '\n\n*Active Launchpads:*\n';
    for (const lp of huntSettings.launchpads) {
      message += `  • ${lp}\n`;
    }
  } else {
    message += '\n\n*Launchpads:* All';
  }

  return message.trim();
}

/**
 * Format trade history message
 */
export function formatTradeHistory(trades: Trade[]): string {
  if (trades.length === 0) {
    return `📜 *Trade History*

No trades yet. Your trading history will appear here.`;
  }

  let message = `📜 *Trade History*\n\n`;

  for (let i = 0; i < trades.length && i < 10; i++) {
    const trade = trades[i];
    const chain = trade.chain as Chain;
    const emoji = CHAIN_EMOJI[chain];
    const typeEmoji = trade.type === 'BUY' ? '🟢' : '🔴';
    const pnl = trade.pnl_percent;
    const pnlStr = pnl ? formatPnL(pnl) : '';

    message += `${typeEmoji} ${emoji} *${trade.token_symbol}* ${trade.type}`;
    if (pnlStr) message += ` ${pnlStr}`;
    message += `\n   ${formatTime(trade.created_at)}\n`;
  }

  if (trades.length > 10) {
    message += `\n_Showing 10 of ${trades.length} trades_`;
  }

  return message.trim();
}

/**
 * Format deposit confirmation message
 */
export function formatDepositConfirmed(
  chain: Chain,
  amount: string,
  txHash: string
): string {
  const emoji = CHAIN_EMOJI[chain];
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  return `✅ *Deposit Confirmed!*

${emoji} *${CHAIN_NAME[chain]}*
💰 *Amount:* ${formatCrypto(amount, symbol)}

Your funds are now available for trading.

🔗 \`${formatAddress(txHash, 8)}\``;
}

/**
 * Format withdrawal confirmation message
 */
export function formatWithdrawalSent(
  chain: Chain,
  amount: string,
  toAddress: string,
  txHash: string
): string {
  const emoji = CHAIN_EMOJI[chain];
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  return `✅ *Withdrawal Sent!*

${emoji} *${CHAIN_NAME[chain]}*
💸 *Amount:* ${formatCrypto(amount, symbol)}
📤 *To:* \`${formatAddress(toAddress)}\`

🔗 \`${formatAddress(txHash, 8)}\``;
}

/**
 * Format error message
 */
export function formatError(message: string): string {
  return `❌ *Error*

${message}

If this persists, please contact support.`;
}

/**
 * Format success message
 */
export function formatSuccess(message: string): string {
  return `✅ *Success*

${message}`;
}

// ============================================================================
// v2.3 Strategy Formatters
// ============================================================================

/**
 * Strategy information for display
 */
export const STRATEGY_INFO: Record<
  TradingStrategy,
  {
    name: string;
    emoji: string;
    tp: string;
    sl: string;
    maxHold: string;
    description: string;
    bestFor: string;
    special?: string;
  }
> = {
  MICRO_SCALP: {
    name: 'Micro Scalp',
    emoji: '⚡',
    tp: '15%',
    sl: '8%',
    maxHold: '15 min',
    description: 'Quick 15% gains, tight 8% stop',
    bestFor: 'Fresh launches on low-gas chains',
    special: 'SOL/Base/BSC only (ETH gas too high)',
  },
  STANDARD: {
    name: 'Standard',
    emoji: '📈',
    tp: '50%',
    sl: '30%',
    maxHold: '4 hours',
    description: 'Balanced 50% TP, 30% SL',
    bestFor: 'Most tokens',
  },
  MOON_BAG: {
    name: 'Moon Bag',
    emoji: '🌙',
    tp: '50%',
    sl: '30%',
    maxHold: '8 hours',
    description: 'Take 75% profit, keep 25% forever',
    bestFor: 'High-conviction plays',
    special: 'Keeps 25% position indefinitely',
  },
  DCA_EXIT: {
    name: 'DCA Exit',
    emoji: '📊',
    tp: '200%',
    sl: '30%',
    maxHold: '8 hours',
    description: 'Ladder out: 25% at each milestone',
    bestFor: 'Volatile tokens',
    special: 'Exits: 25% @ +25%, 25% @ +50%, 25% @ +100%, 25% @ +200%',
  },
  TRAILING: {
    name: 'Trailing Stop',
    emoji: '🎯',
    tp: '100%+',
    sl: '30%',
    maxHold: '8 hours',
    description: 'Let winners run with dynamic stop',
    bestFor: 'Strong momentum plays',
    special: 'Activates at +30%, trails 20% behind peak',
  },
};

/**
 * Format strategy panel (v2.3 wide layout)
 */
export function formatStrategyPanel(currentStrategy: TradingStrategy): string {
  let message = `🎯 *TRADING STRATEGIES*
${LINE}

Select a strategy or create custom.

${SECTION} PRESETS ${SECTION}

`;

  for (const [key, info] of Object.entries(STRATEGY_INFO)) {
    const isActive = key === currentStrategy;
    const marker = isActive ? '▶️ ' : '';

    message += `${marker}${info.emoji} *${info.name}*\n`;
    message += `   ${info.description}\n`;
    message += `   Best for: ${info.bestFor}\n\n`;
  }

  return message;
}

/**
 * Format strategy detail view
 */
export function formatStrategyDetail(strategy: TradingStrategy): string {
  const info = STRATEGY_INFO[strategy];

  let message = `${info.emoji} *${info.name} Strategy*
${LINE}

${info.description}

${SECTION} Settings ${SECTION}
📈 *Take Profit:* ${info.tp}
📉 *Stop Loss:* ${info.sl}
⏱️ *Max Hold:* ${info.maxHold}
`;

  if (info.special) {
    message += `\n⚡ *Special:* ${info.special}`;
  }

  message += `\n\n🎯 *Best for:* ${info.bestFor}`;

  return message;
}

/**
 * Format custom strategy editor (multi-page)
 */
export function formatCustomStrategyPage(
  page: number,
  settings: Partial<CustomStrategy>
): string {
  const pages = [
    // Page 1: Core Settings
    () => `🔧 *CUSTOM STRATEGY — Core*
${LINE}

Configure your exit targets and timing.

📈 *Take Profit:* ${settings.take_profit_percent || 50}%
📉 *Stop Loss:* ${settings.stop_loss_percent || 30}%
⏱️ *Max Hold:* ${formatMaxHold(settings.max_hold_minutes || 240)}`,

    // Page 2: Advanced Exits
    () => `🔧 *CUSTOM STRATEGY — Exits*
${LINE}

Configure trailing stops, ladders, moon bags.

🎯 *Trailing:* ${settings.trailing_enabled ? STATUS.ON : STATUS.OFF} OFF
📊 *DCA Ladder:* ${settings.dca_enabled ? STATUS.ON : STATUS.OFF} OFF
🌙 *Moon Bag:* ${settings.moon_bag_percent || 0}%`,

    // Page 3: Filters
    () => `🔧 *CUSTOM STRATEGY — Filters*
${LINE}

Set token requirements before entry.

💧 *Min Liquidity:* ${formatUSD(settings.min_liquidity_usd || 10000)}
💰 *Max Market Cap:* ${formatUSD(settings.max_market_cap_usd || 10000000)}
📊 *Min Score:* ${settings.min_score || 23}/35
📈 *Max Buy Tax:* ${settings.max_buy_tax_percent || 5}%
📉 *Max Sell Tax:* ${settings.max_sell_tax_percent || 5}%`,

    // Page 4: Protection & Execution
    () => `🔧 *CUSTOM STRATEGY — Protection*
${LINE}

Safety features and execution settings.

🛡️ *Anti-Rug:* ${settings.anti_rug_enabled ? `${STATUS.ON} ON` : `${STATUS.OFF} OFF`}
🔒 *Anti-MEV:* ${settings.anti_mev_enabled ? `${STATUS.ON} ON` : `${STATUS.OFF} OFF`}
✅ *Auto-Approve:* ${settings.auto_approve_enabled ? `${STATUS.ON} ON` : `${STATUS.OFF} OFF`}
Ⓢ *Slippage:* ${settings.slippage_percent || 15}%
⛽ *Gas Priority:* ${(settings.gas_priority || 'medium').charAt(0).toUpperCase() + (settings.gas_priority || 'medium').slice(1)}
🔄 *Retry Failed:* ${settings.retry_failed ? `${STATUS.ON} ON` : `${STATUS.OFF} OFF`}`,

    // Page 5: Review
    () => {
      const s = settings;
      return `🔧 *CUSTOM STRATEGY — Review*
${LINE}

Review your custom strategy:

${SECTION} Exits ${SECTION}
📈 TP: ${s.take_profit_percent || 50}% | 📉 SL: ${s.stop_loss_percent || 30}% | ⏱️ ${formatMaxHold(s.max_hold_minutes || 240)}

${SECTION} Advanced ${SECTION}
🎯 Trailing: ${s.trailing_enabled ? 'ON' : 'OFF'}
📊 Ladder: ${s.dca_enabled ? 'ON' : 'OFF'}
🌙 Moon Bag: ${s.moon_bag_percent || 0}%

${SECTION} Filters ${SECTION}
💧 Min Liq: ${formatShortUSD(s.min_liquidity_usd || 10000)} | 💰 Max MC: ${formatShortUSD(s.max_market_cap_usd || 10000000)}
📊 Score: ${s.min_score || 23}+ | Max Tax: ${s.max_buy_tax_percent || 5}%

${SECTION} Protection ${SECTION}
🛡️ Anti-Rug ${s.anti_rug_enabled ? '✓' : '✗'} | 🔒 Anti-MEV ${s.anti_mev_enabled ? '✓' : '✗'}`;
    },
  ];

  return pages[Math.min(page - 1, pages.length - 1)]();
}

/**
 * Format max hold time for display
 */
function formatMaxHold(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
}

/**
 * Format short USD (with K, M suffixes)
 */
function formatShortUSD(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount}`;
}

// ============================================================================
// v2.3 Transfer/Send Formatters
// ============================================================================

/**
 * Format send to address panel
 */
export function formatSendToAddress(toAddress: string, chain: Chain): string {
  const chainEmoji = CHAIN_STATUS[chain];
  const chainName = CHAIN_NAME[chain];

  return `📤 *SEND TO ADDRESS*
${LINE}

${chainEmoji} *${chainName}*

To: \`${formatAddress(toAddress)}\`

What would you like to send?`;
}

/**
 * Format global settings panel (v2.3)
 */
export function formatGlobalSettings(settings: {
  antiRug: boolean;
  antiMEV: boolean;
  degenMode: boolean;
  tokenReportView: 'minimal' | 'detailed';
  includesFees: boolean;
}): string {
  return `⚙️ *GLOBAL SETTINGS*
${LINE}

Configure your general settings.
Click 🛒 Buy or 💰 Sell to customize
per-action settings.

ℹ️ Global Settings apply to all chains.
   Override in per-chain settings.`;
}

/**
 * Format chains selection panel
 */
export function formatChainsSelection(
  enabledChains: Chain[],
  chainBalances: Map<Chain, { balance: number; symbol: string; usdValue: number }>
): string {
  let message = `🔗 *CHAINS*
${LINE}

Select chains to enable for trading.

`;

  const allChains: Chain[] = ['sol', 'bsc', 'base', 'eth'];

  for (const chain of allChains) {
    const isEnabled = enabledChains.includes(chain);
    const chainEmoji = CHAIN_STATUS[chain];
    const chainName = CHAIN_NAME[chain];
    const status = isEnabled ? 'ENABLED' : 'DISABLED';
    const balanceInfo = chainBalances.get(chain);

    message += `${chainEmoji} *${chainName}* — ${status}\n`;

    if (balanceInfo && balanceInfo.balance > 0) {
      message += `   ${balanceInfo.balance.toFixed(4)} ${balanceInfo.symbol} (${formatUSD(balanceInfo.usdValue)})\n`;
    } else if (!isEnabled) {
      message += `   No wallet\n`;
    }

    message += '\n';
  }

  return message;
}

/**
 * Format delete wallet warning
 */
export function formatDeleteWalletWarning(
  chain: Chain,
  walletIndex: number,
  walletLabel: string
): string {
  const chainEmoji = CHAIN_STATUS[chain];
  const chainName = CHAIN_NAME[chain];

  return `⚠️ *DELETE WALLET*
${LINE}

You are about to delete:

${chainEmoji} *${chainName}* — ${walletLabel} (#${walletIndex})

🚨 *THIS ACTION CANNOT BE UNDONE*

All funds in this wallet will be lost if you
haven't backed up the private key.

Type *DELETE* to confirm:`;
}
