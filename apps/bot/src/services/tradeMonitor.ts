/**
 * Trade Monitor Service
 * Manages real-time PnL monitoring messages for active positions
 */

import { Bot, InlineKeyboard, Context, Api, RawApi } from 'grammy';
import {
  upsertTradeMonitor,
  getMonitorsForRefresh,
  updateMonitorData,
  resetMonitorTTL,
  closeMonitor,
  getUserMonitor,
  expireOldMonitors,
  getMonitorById,
  setMonitorView,
  getOrCreateManualSettings,
  getUserActiveMonitors,
  getActiveWallet,
  type TradeMonitor,
  type Chain,
  type ManualSettings,
} from '@raptor/shared';
import type { SolanaExecutor } from '@raptor/executor';

// Refresh interval (15 seconds)
const REFRESH_INTERVAL_MS = 15_000;

// Batch size for refreshing monitors
const REFRESH_BATCH_SIZE = 20;

// Monitor TTL in hours
const MONITOR_TTL_HOURS = 24;

// Price cache to avoid RPC spam
// P0-4 FIX: Added max size and eviction to prevent memory exhaustion
const MAX_CACHE_SIZE = 1000;
const priceCache = new Map<string, { price: number; timestamp: number }>();
const PRICE_CACHE_TTL_MS = 10_000; // 10 seconds

/**
 * P0-4 FIX: Cleanup stale cache entries and enforce max size
 * Call periodically to prevent unbounded memory growth
 */
function cleanupPriceCache(): void {
  const now = Date.now();

  // Remove expired entries
  for (const [key, value] of priceCache.entries()) {
    if (now - value.timestamp > PRICE_CACHE_TTL_MS) {
      priceCache.delete(key);
    }
  }

  // If still too big, remove oldest entries
  if (priceCache.size > MAX_CACHE_SIZE) {
    const entries = [...priceCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, priceCache.size - MAX_CACHE_SIZE);
    for (const [key] of toRemove) {
      priceCache.delete(key);
    }
  }
}

/**
 * Set price in cache with automatic cleanup
 */
function setCachedPrice(mint: string, price: number): void {
  // Cleanup before adding new entry
  if (priceCache.size >= MAX_CACHE_SIZE) {
    cleanupPriceCache();
  }
  priceCache.set(mint, { price, timestamp: Date.now() });
}

/**
 * Get price from cache, returns null if expired
 */
function getCachedPrice(mint: string): number | null {
  const cached = priceCache.get(mint);
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS) {
    return cached.price;
  }
  // Remove stale entry
  if (cached) {
    priceCache.delete(mint);
  }
  return null;
}

/**
 * Format the Trade Monitor message
 * v3.2: Added USD pricing throughout
 * v3.4: Added embedded chart links (E5)
 */
export function formatTradeMonitorMessage(
  monitor: TradeMonitor,
  solPriceUsd: number = 180 // Default SOL price, should be fetched
): string {
  const {
    token_symbol,
    token_name,
    mint,
    route_label,
    entry_amount_sol,
    entry_tokens,
    entry_price_sol,
    current_price_sol,
    current_tokens,
    current_value_sol,
    pnl_sol,
    pnl_percent,
    market_cap_usd,
    liquidity_usd,
  } = monitor;

  // PnL emoji
  const pnlEmoji = (pnl_percent || 0) >= 0 ? '🟢' : '🔴';
  const pnlSign = (pnl_percent || 0) >= 0 ? '+' : '';

  // Format numbers
  const formatSol = (n: number | null) => (n !== null ? n.toFixed(4) : '—');
  // v3.4 FIX: Handle small token values properly (avoid showing 0.00 for small amounts)
  const formatTokens = (n: number | null) => {
    if (n === null) return '—';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
    if (n < 0.01 && n > 0) return n.toFixed(6);
    return n.toFixed(2);
  };
  const formatUsd = (n: number | null) => {
    if (n === null) return '—';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return '$' + (n / 1_000).toFixed(2) + 'K';
    return '$' + n.toFixed(2);
  };
  // v3.4 FIX: Avoid scientific notation for very small prices
  const formatPrice = (n: number | null) => {
    if (n === null) return '—';
    if (n === 0) return '0';
    if (n < 0.000000001) return '<0.000000001';
    if (n < 0.000001) return n.toFixed(12);
    if (n < 0.001) return n.toFixed(9);
    return n.toFixed(6);
  };
  const solToUsd = (sol: number | null) => {
    if (sol === null) return '—';
    return formatUsd(sol * solPriceUsd);
  };

  // Calculate USD values
  const entryValueUsd = entry_amount_sol !== null ? entry_amount_sol * solPriceUsd : null;
  const currentValueUsd = current_value_sol !== null ? current_value_sol * solPriceUsd : null;
  const pnlUsd = pnl_sol !== null ? pnl_sol * solPriceUsd : null;

  // Truncate mint for display - tap to copy
  const shortMint = `${mint.slice(0, 6)}...${mint.slice(-4)}`;

  let message = `📊 *TRADE MONITOR*\n\n`;
  message += `*${token_symbol || 'Unknown'}* ${token_name ? `(${token_name})` : ''}\n`;
  message += `\`${shortMint}\`\n`;
  message += `Route: ${route_label || 'Unknown'}\n\n`;

  message += `━━━━ *Position* ━━━━\n`;
  message += `Entry: ${formatSol(entry_amount_sol)} SOL (${solToUsd(entry_amount_sol)})\n`;
  message += `Tokens: ${formatTokens(current_tokens ?? entry_tokens)}\n`;
  message += `Value: ${formatSol(current_value_sol)} SOL (${solToUsd(current_value_sol)})\n\n`;

  message += `━━━━ *Price* ━━━━\n`;
  const entryPriceUsd = entry_price_sol !== null ? entry_price_sol * solPriceUsd : null;
  const currentPriceUsd = current_price_sol !== null ? current_price_sol * solPriceUsd : null;
  message += `Entry: ${formatPrice(entry_price_sol)} SOL`;
  if (entryPriceUsd !== null) message += ` ($${entryPriceUsd.toFixed(8)})`;
  message += `\n`;
  message += `Current: ${formatPrice(current_price_sol)} SOL`;
  if (currentPriceUsd !== null) message += ` ($${currentPriceUsd.toFixed(8)})`;
  message += `\n\n`;

  message += `━━━━ *P&L* ━━━━\n`;
  message += `${pnlEmoji} ${pnlSign}${formatSol(pnl_sol)} SOL (${pnlSign}${(pnl_percent || 0).toFixed(2)}%)\n`;
  if (pnlUsd !== null) {
    message += `   ${pnlSign}${formatUsd(Math.abs(pnlUsd))} USD\n`;
  }
  message += '\n';

  if (market_cap_usd || liquidity_usd) {
    message += `━━━━ *Market* ━━━━\n`;
    if (market_cap_usd) message += `MCap: ${formatUsd(market_cap_usd)}\n`;
    if (liquidity_usd) message += `Liq: ${formatUsd(liquidity_usd)}\n`;
    message += '\n';
  }

  // v3.4: Add embedded chart links (E5)
  const chain = monitor.chain || 'sol';
  const chainPath = chain === 'sol' ? 'solana' : chain === 'bsc' ? 'bsc' : chain === 'base' ? 'base' : 'ethereum';
  const dexUrl = `https://dexscreener.com/${chainPath}/${mint}`;
  const birdeyeUrl = chain === 'sol' ? `https://birdeye.so/token/${mint}` : null;
  const solscanUrl = chain === 'sol' ? `https://solscan.io/token/${mint}` : null;

  let links = `🔗 [DexScreener](${dexUrl})`;
  if (birdeyeUrl) links += ` • [Birdeye](${birdeyeUrl})`;
  if (solscanUrl) links += ` • [Solscan](${solscanUrl})`;
  message += links + `\n\n`;

  // Last updated timestamp
  const lastRefresh = new Date(monitor.last_refreshed_at);
  const now = new Date();
  const ageSeconds = Math.floor((now.getTime() - lastRefresh.getTime()) / 1000);
  message += `_Updated ${ageSeconds}s ago_`;

  return message;
}

/**
 * Build Trade Monitor keyboard
 * v3.2: Removed Copy CA button (use tap-to-copy on CA in message)
 * v3.4: Added chain parameter for correct DexScreener URL and token return
 */
export function buildTradeMonitorKeyboard(mint: string, monitorId: number, chain: Chain = 'sol'): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('💰 → Sell', `open_sell:${mint}`)
    .text('🔄 Refresh', `refresh_monitor:${monitorId}`)
    .row()
    // v3.4 FIX: Include chain for correct DexScreener URL
    .text('📊 Chart', `chart:${chain}_${mint}`)
    .text('« Back to Token', `token:${chain}_${mint}`);

  return keyboard;
}

/**
 * Build Sell Panel keyboard
 * v3.2: Added 10% option and improved layout
 * v3.4: Added refresh button and chain support for correct navigation
 */
export function buildSellPanelKeyboard(
  mint: string,
  hasBalance: boolean = true,
  chain: Chain = 'sol'
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (hasBalance) {
    keyboard
      .text('10%', `sell_pct:${mint}:10`)
      .text('25%', `sell_pct:${mint}:25`)
      .text('50%', `sell_pct:${mint}:50`)
      .row()
      .text('75%', `sell_pct:${mint}:75`)
      .text('100%', `sell_pct:${mint}:100`)
      .row()
      .text('✏️ X Tokens', `sell_custom:${mint}:tokens`)
      .text('✏️ X%', `sell_custom:${mint}:percent`)
      .row();
  }

  keyboard
    .text('⚙️ Slippage', `sell_slippage:${mint}`)
    .text('⚡ Priority', `sell_priority:${mint}`)
    // v3.4: Added refresh button
    .text('🔄 Refresh', `refresh_sell:${mint}`)
    .row()
    .text('« Back to Monitor', `view_monitor:${mint}`)
    // v3.4: Include chain for correct token panel navigation
    .text('« Back to Token', `token:${chain}_${mint}`);

  return keyboard;
}

/**
 * Reset view state back to MONITOR when navigating away from sell panel
 * v3.2: Call this when user clicks "Back to Monitor"
 */
export async function resetToMonitorView(
  api: Api<RawApi>,
  userId: number,
  chatId: number,
  messageId: number,
  mint: string
): Promise<boolean> {
  try {
    // Reset view state first
    await setMonitorView(userId, mint, 'MONITOR');

    // Get updated monitor
    const monitor = await getUserMonitor(userId, mint);
    if (!monitor) {
      console.warn(`[TradeMonitor] No monitor found for ${mint}`);
      return false;
    }

    // Render monitor view
    const message = formatTradeMonitorMessage(monitor);
    const keyboard = buildTradeMonitorKeyboard(mint, monitor.id, monitor.chain);

    await api.editMessageText(chatId, messageId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    return true;
  } catch (error) {
    console.error('[TradeMonitor] Error resetting to monitor view:', error);
    return false;
  }
}

/**
 * Token info for sell panel display
 * v3.4: Added to show market data like buy panel
 */
export interface SellPanelTokenInfo {
  name?: string | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
  priceChangePercent?: number | null;
}

/**
 * Format the Sell Panel message
 * v3.2: Added USD pricing
 * v3.4: Added token info (name, mcap, liquidity, links) like buy panel
 */
export function formatSellPanelMessage(
  tokenSymbol: string,
  mint: string,
  tokensHeld: number | null,
  estimatedValueSol: number | null,
  currentPriceSol: number | null,
  slippageBps: number = 500,
  priorityFee: number = 100000,
  solPriceUsd: number = 180,
  chain: Chain = 'sol',
  tokenInfo?: SellPanelTokenInfo
): string {
  // v3.4 FIX: Handle small token values properly
  const formatTokens = (n: number | null) => {
    if (n === null || n === 0) return 'No Balance';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
    if (n < 0.01) return n.toFixed(6);
    return n.toFixed(4);
  };

  const formatUsd = (n: number | null) => {
    if (n === null) return '—';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return '$' + (n / 1_000).toFixed(2) + 'K';
    return '$' + n.toFixed(2);
  };

  const formatSolToUsd = (sol: number | null) => {
    if (sol === null) return '—';
    return formatUsd(sol * solPriceUsd);
  };

  // v3.4 FIX: Standard 35-char line width below headings only
  let message = `💰 *SELL ${tokenSymbol}*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // v3.4: Show token name if available
  if (tokenInfo?.name) {
    message += `*${tokenInfo.name}*\n\n`;
  }

  // v3.4: Show market data if available
  if (tokenInfo?.marketCapUsd || tokenInfo?.liquidityUsd) {
    if (tokenInfo.marketCapUsd) {
      message += `📊 *MCap:* ${formatUsd(tokenInfo.marketCapUsd)}\n`;
    }
    if (tokenInfo.liquidityUsd) {
      message += `💧 *Liq:* ${formatUsd(tokenInfo.liquidityUsd)}\n`;
    }
    if (tokenInfo.priceChangePercent !== undefined && tokenInfo.priceChangePercent !== null) {
      const changeEmoji = tokenInfo.priceChangePercent >= 0 ? '🟢' : '🔴';
      const changeSign = tokenInfo.priceChangePercent >= 0 ? '+' : '';
      message += `${changeEmoji} *24h:* ${changeSign}${tokenInfo.priceChangePercent.toFixed(2)}%\n`;
    }
    message += `\n`;
  }

  message += `*Holdings*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (tokensHeld === null || tokensHeld === 0) {
    message += `⚠️ *No Balance Detected*\n`;
    message += `_Wallet has no tokens for this mint_\n\n`;
  } else {
    message += `Tokens: ${formatTokens(tokensHeld)}\n`;
    message += `Est. Value: ${estimatedValueSol !== null ? estimatedValueSol.toFixed(4) : '—'} SOL`;
    if (estimatedValueSol !== null) {
      message += ` (${formatSolToUsd(estimatedValueSol)})`;
    }
    message += `\n`;
    if (currentPriceSol !== null) {
      const priceUsd = currentPriceSol * solPriceUsd;
      message += `Price: ${currentPriceSol.toFixed(9)} SOL ($${priceUsd.toFixed(6)})\n`;
    }
    message += `\n`;
  }

  message += `*Settings*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `Slippage: ${(slippageBps / 100).toFixed(1)}%\n`;
  message += `Priority: ${(priorityFee / 1_000_000).toFixed(4)} SOL\n\n`;

  // v3.4: Add links like buy panel
  const chainPath = chain === 'sol' ? 'solana' : chain === 'bsc' ? 'bsc' : chain === 'base' ? 'base' : 'ethereum';
  const dexUrl = `https://dexscreener.com/${chainPath}/${mint}`;
  const birdeyeUrl = chain === 'sol' ? `https://birdeye.so/token/${mint}` : null;
  const solscanUrl = chain === 'sol' ? `https://solscan.io/token/${mint}` : null;

  let links = `🔗 [DexScreener](${dexUrl})`;
  if (birdeyeUrl) links += ` • [Birdeye](${birdeyeUrl})`;
  if (solscanUrl) links += ` • [Solscan](${solscanUrl})`;
  message += links + `\n`;
  message += `\`${mint}\`\n\n`;

  if (tokensHeld && tokensHeld > 0) {
    message += `_Select amount to sell:_`;
  }

  return message;
}

/**
 * Create a trade monitor after successful buy
 */
export async function createTradeMonitor(
  api: Api<RawApi>,
  userId: number,
  chatId: number,
  chain: Chain,
  mint: string,
  tokenSymbol: string | undefined,
  tokenName: string | undefined,
  entryAmountSol: number,
  entryTokens: number,
  entryPriceSol: number,
  routeLabel: string,
  positionId?: number
): Promise<TradeMonitor | null> {
  try {
    // Send initial monitor message
    const tempMonitor: Partial<TradeMonitor> = {
      token_symbol: tokenSymbol || null,
      token_name: tokenName || null,
      mint,
      route_label: routeLabel,
      entry_amount_sol: entryAmountSol,
      entry_tokens: entryTokens,
      entry_price_sol: entryPriceSol,
      current_price_sol: entryPriceSol,
      current_tokens: entryTokens,
      current_value_sol: entryAmountSol,
      pnl_sol: 0,
      pnl_percent: 0,
      market_cap_usd: null,
      liquidity_usd: null,
      last_refreshed_at: new Date().toISOString(),
    };

    const message = formatTradeMonitorMessage(tempMonitor as TradeMonitor);
    const keyboard = buildTradeMonitorKeyboard(mint, 0, chain); // Will update with real ID

    const sentMessage = await api.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });

    // Save monitor to database
    const monitor = await upsertTradeMonitor({
      user_id: userId,
      chain,
      mint,
      token_symbol: tokenSymbol,
      token_name: tokenName,
      chat_id: chatId,
      message_id: sentMessage.message_id,
      position_id: positionId,
      entry_price_sol: entryPriceSol,
      entry_amount_sol: entryAmountSol,
      entry_tokens: entryTokens,
      route_label: routeLabel,
      ttl_hours: MONITOR_TTL_HOURS,
    });

    // Update message with real monitor ID in keyboard
    const updatedKeyboard = buildTradeMonitorKeyboard(mint, monitor.id, chain);
    await api.editMessageReplyMarkup(chatId, sentMessage.message_id, {
      reply_markup: updatedKeyboard,
    });

    console.log(`[TradeMonitor] Created monitor ${monitor.id} for ${tokenSymbol} (${mint})`);
    return monitor;
  } catch (error) {
    console.error('[TradeMonitor] Error creating monitor:', error);
    return null;
  }
}

/**
 * Refresh a single monitor with fresh price data
 */
export async function refreshMonitor(
  api: Api<RawApi>,
  monitor: TradeMonitor,
  executor: SolanaExecutor
): Promise<boolean> {
  try {
    const { mint, chat_id, message_id, entry_price_sol, entry_amount_sol, user_id } = monitor;

    // Check price cache first (P0-4 FIX: use helper that handles cleanup)
    let currentPrice: number | null = getCachedPrice(mint);
    let currentTokens: number | null = null;

    if (currentPrice === null) {
      // Fetch fresh price from Jupiter
      try {
        const quote = await executor.jupiter.getQuote(
          mint,
          'So11111111111111111111111111111111111111112', // SOL
          BigInt(1_000_000_000), // 1 token (adjusted for decimals)
          100
        );
        if (quote) {
          // v3.4 FIX: Use Number() instead of parseInt() for precision
          currentPrice = Number(quote.outAmount) / 1_000_000_000;
          setCachedPrice(mint, currentPrice); // P0-4 FIX: use helper
        }
      } catch (priceError) {
        console.warn(`[TradeMonitor] Price fetch failed for ${mint}:`, priceError);
      }
    }

    // Fetch token balance - MUST use user's wallet, not executor wallet
    try {
      const userWallet = await getActiveWallet(user_id, 'sol');
      if (userWallet) {
        const balance = await executor.getTokenBalance(mint, userWallet.public_key);
        currentTokens = balance;
      } else {
        console.warn(`[TradeMonitor] No active wallet for user ${user_id}`);
        currentTokens = monitor.current_tokens;
      }
    } catch (balanceError) {
      console.warn(`[TradeMonitor] Balance fetch failed for ${mint}:`, balanceError);
      currentTokens = monitor.current_tokens;
    }

    // Calculate PnL
    let currentValueSol = 0;
    let pnlSol = 0;
    let pnlPercent = 0;

    if (currentPrice && currentTokens && entry_price_sol && entry_amount_sol) {
      currentValueSol = currentTokens * currentPrice;
      pnlSol = currentValueSol - entry_amount_sol;
      pnlPercent = (pnlSol / entry_amount_sol) * 100;
    }

    // Update database
    const updatedMonitor = await updateMonitorData({
      monitor_id: monitor.id,
      current_price_sol: currentPrice || monitor.current_price_sol || 0,
      current_tokens: currentTokens || monitor.current_tokens || 0,
      current_value_sol: currentValueSol,
      pnl_sol: pnlSol,
      pnl_percent: pnlPercent,
    });

    // Update Telegram message
    const message = formatTradeMonitorMessage(updatedMonitor);
    const keyboard = buildTradeMonitorKeyboard(mint, monitor.id, monitor.chain);

    try {
      await api.editMessageText(chat_id, message_id, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (editError: unknown) {
      // Message may be unchanged or deleted
      const errMsg = editError instanceof Error ? editError.message : String(editError);
      if (!errMsg.includes('message is not modified')) {
        console.warn(`[TradeMonitor] Edit failed for monitor ${monitor.id}:`, errMsg);
      }
    }

    return true;
  } catch (error) {
    console.error(`[TradeMonitor] Refresh error for monitor ${monitor.id}:`, error);
    return false;
  }
}

// P1-3 FIX: Add stop mechanism to prevent memory leaks on restart
let refreshLoopRunning = false;
let refreshLoopTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Monitor refresh loop - runs in the background
 * P1-3 FIX: Now has stop mechanism to prevent memory leaks
 */
export async function startMonitorRefreshLoop(
  bot: Bot<Context>,
  executor: SolanaExecutor
): Promise<void> {
  // Prevent multiple instances
  if (refreshLoopRunning) {
    console.log('[TradeMonitor] Refresh loop already running, skipping');
    return;
  }

  refreshLoopRunning = true;
  console.log('[TradeMonitor] Starting refresh loop');

  // Periodic cache cleanup (every 5 minutes)
  const cacheCleanupInterval = setInterval(() => {
    cleanupPriceCache();
  }, 5 * 60 * 1000);

  const refreshLoop = async () => {
    // Check if we should stop
    if (!refreshLoopRunning) {
      console.log('[TradeMonitor] Refresh loop stopped');
      clearInterval(cacheCleanupInterval);
      return;
    }

    try {
      // Expire old monitors first
      const expired = await expireOldMonitors();
      if (expired > 0) {
        console.log(`[TradeMonitor] Expired ${expired} old monitors`);
      }

      // Get monitors that need refresh
      const monitors = await getMonitorsForRefresh(REFRESH_BATCH_SIZE, 15);

      if (monitors.length > 0) {
        console.log(`[TradeMonitor] Refreshing ${monitors.length} monitors`);

        // Process in parallel with concurrency limit
        const concurrency = 5;
        for (let i = 0; i < monitors.length; i += concurrency) {
          // Check if stopped during processing
          if (!refreshLoopRunning) break;

          const batch = monitors.slice(i, i + concurrency);
          await Promise.allSettled(
            batch.map((m) => refreshMonitor(bot.api, m, executor))
          );
          // Small delay between batches to avoid rate limiting
          if (i + concurrency < monitors.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
      }
    } catch (error) {
      console.error('[TradeMonitor] Refresh loop error:', error);
    }

    // Schedule next run if still running
    if (refreshLoopRunning) {
      refreshLoopTimeout = setTimeout(refreshLoop, REFRESH_INTERVAL_MS);
    }
  };

  // Start the loop
  refreshLoop();
}

/**
 * P1-3 FIX: Stop the monitor refresh loop gracefully
 */
export function stopMonitorRefreshLoop(): void {
  console.log('[TradeMonitor] Stopping refresh loop...');
  refreshLoopRunning = false;

  if (refreshLoopTimeout) {
    clearTimeout(refreshLoopTimeout);
    refreshLoopTimeout = null;
  }
}

/**
 * Handle manual refresh button click
 */
export async function handleManualRefresh(
  api: Api<RawApi>,
  monitorId: number,
  executor: SolanaExecutor
): Promise<TradeMonitor | null> {
  try {
    // Reset TTL
    const monitor = await resetMonitorTTL(monitorId, MONITOR_TTL_HOURS);
    if (!monitor) return null;

    // Force refresh
    await refreshMonitor(api, monitor, executor);

    return monitor;
  } catch (error) {
    console.error(`[TradeMonitor] Manual refresh error for ${monitorId}:`, error);
    return null;
  }
}

/**
 * Handle opening sell panel
 * v3.2 FIX: Sets current_view to 'SELL' to prevent refresh loop overwrites
 * v3.4: Added token info fetching (name, mcap, liquidity, links)
 */
export async function openSellPanel(
  api: Api<RawApi>,
  userId: number,
  chatId: number,
  messageId: number,
  mint: string,
  executor: SolanaExecutor,
  slippageBps?: number,
  priorityFee?: number
): Promise<void> {
  try {
    // v3.2 FIX: Set view state to SELL FIRST
    // This prevents the refresh loop from overwriting this message
    await setMonitorView(userId, mint, 'SELL');

    // Get monitor for token info
    const monitor = await getUserMonitor(userId, mint);
    const chain = monitor?.chain || 'sol';

    // Get user's manual settings for slippage/priority
    // v3.3.1 FIX: Use ?? instead of || to properly use user settings
    const settings = await getOrCreateManualSettings(userId);
    const effectiveSlippage = slippageBps ?? settings.default_slippage_bps ?? 500;
    const effectivePriority = priorityFee ?? Math.round(settings.default_priority_sol * 1_000_000) ?? 100000;

    // Fetch current balance - MUST use user's wallet
    let tokensHeld: number | null = null;
    let estimatedValueSol: number | null = null;
    let currentPriceSol: number | null = null;
    // v3.4: Token info for enhanced sell panel
    let tokenInfo: SellPanelTokenInfo = {};

    try {
      // Get user's active wallet
      const userWallet = await getActiveWallet(userId, chain);
      if (userWallet) {
        const walletAddress = userWallet.public_key || userWallet.solana_address;
        tokensHeld = await executor.getTokenBalance(mint, walletAddress);
      } else {
        console.warn(`[TradeMonitor] No active wallet for user ${userId} in sell panel`);
      }

      // Get price (P0-4 FIX: use cache helper)
      currentPriceSol = getCachedPrice(mint);

      // v3.4: Always try DexScreener first to get full token info
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        const dexData = await dexRes.json() as {
          pairs?: {
            priceNative?: string;
            baseToken?: { name?: string; symbol?: string };
            fdv?: number;
            liquidity?: { usd?: number };
            priceChange?: { h24?: number };
          }[]
        };

        if (dexData.pairs?.[0]) {
          const pair = dexData.pairs[0];
          // v3.4: Extract token info for enhanced display
          tokenInfo = {
            name: pair.baseToken?.name || monitor?.token_name || null,
            marketCapUsd: pair.fdv || null,
            liquidityUsd: pair.liquidity?.usd || null,
            priceChangePercent: pair.priceChange?.h24 || null,
          };

          if (pair.priceNative && currentPriceSol === null) {
            currentPriceSol = parseFloat(pair.priceNative);
            setCachedPrice(mint, currentPriceSol);
          }
        }
      } catch (dexErr) {
        console.warn('[TradeMonitor] DexScreener fetch failed:', dexErr);
      }

      // Fallback to Jupiter for price if DexScreener didn't have it
      if (currentPriceSol === null) {
        try {
          const quote = await executor.jupiter.getQuote(
            mint,
            'So11111111111111111111111111111111111111112',
            BigInt(1_000_000_000),
            100
          );
          if (quote) {
            // v3.4 FIX: Use Number() instead of parseInt() for precision
            currentPriceSol = Number(quote.outAmount) / 1_000_000_000;
            setCachedPrice(mint, currentPriceSol);
          }
        } catch (jupiterErr) {
          console.warn('[TradeMonitor] Jupiter quote failed');
        }
      }

      if (tokensHeld && currentPriceSol) {
        estimatedValueSol = tokensHeld * currentPriceSol;
      }
    } catch (error) {
      console.warn(`[TradeMonitor] Error fetching balance for sell panel:`, error);
    }

    const tokenSymbol = monitor?.token_symbol || 'TOKEN';
    const hasBalance = tokensHeld !== null && tokensHeld > 0;

    // v3.4: Pass chain and tokenInfo for enhanced display
    const message = formatSellPanelMessage(
      tokenSymbol,
      mint,
      tokensHeld,
      estimatedValueSol,
      currentPriceSol,
      effectiveSlippage,
      effectivePriority,
      180, // SOL price USD (TODO: fetch dynamically)
      chain,
      tokenInfo
    );
    const keyboard = buildSellPanelKeyboard(mint, hasBalance, chain);

    await api.editMessageText(chatId, messageId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error('[TradeMonitor] Error opening sell panel:', error);
    // If view state was set but message edit failed, reset to MONITOR
    try {
      await setMonitorView(userId, mint, 'MONITOR');
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Close monitor after successful sell
 */
export async function closeMonitorAfterSell(
  api: Api<RawApi>,
  userId: number,
  mint: string
): Promise<void> {
  try {
    const monitor = await getUserMonitor(userId, mint);
    if (monitor) {
      // Update message to show closed state
      try {
        const closedMessage =
          `📊 *TRADE CLOSED*\n\n` +
          `*${monitor.token_symbol || 'TOKEN'}*\n` +
          `Final P&L: ${(monitor.pnl_percent || 0) >= 0 ? '+' : ''}${(monitor.pnl_percent || 0).toFixed(2)}%\n\n` +
          `_Position closed_`;

        await api.editMessageText(monitor.chat_id, monitor.message_id, closedMessage, {
          parse_mode: 'Markdown',
        });
      } catch {
        // Message may be deleted
      }

      // Mark as closed in DB
      await closeMonitor(userId, mint);
    }
  } catch (error) {
    console.error('[TradeMonitor] Error closing monitor:', error);
  }
}

/**
 * Open sell panel as a NEW message (not editing existing)
 * v3.2: Used when opening sell directly from token card
 * v3.4: Added token info, refresh button, chain support
 */
export async function openSellPanelNew(
  api: Api<RawApi>,
  userId: number,
  chatId: number,
  mint: string,
  executor: SolanaExecutor,
  slippageBps?: number,
  priorityFee?: number,
  chain: Chain = 'sol'
): Promise<void> {
  try {
    // Get user's manual settings for slippage/priority
    // v3.3.1 FIX: Use ?? instead of || to properly use user settings
    const settings = await getOrCreateManualSettings(userId);
    const effectiveSlippage = slippageBps ?? settings.default_slippage_bps ?? 500;
    const effectivePriority = priorityFee ?? Math.round(settings.default_priority_sol * 1_000_000) ?? 100000;

    // Fetch current balance from user's wallet
    let tokensHeld: number | null = null;
    let estimatedValueSol: number | null = null;
    let currentPriceSol: number | null = null;
    let tokenSymbol = 'TOKEN';
    // v3.4: Token info for enhanced sell panel
    let tokenInfo: SellPanelTokenInfo = {};

    try {
      // Try to get token symbol from cache/API
      const monitor = await getUserMonitor(userId, mint);
      if (monitor?.token_symbol) {
        tokenSymbol = monitor.token_symbol;
      }

      // Get balance from user's wallet
      const { getUserWallets } = await import('@raptor/shared');
      const wallets = await getUserWallets(userId);
      const activeWallet = wallets.find(w => w.chain === chain && w.is_active);

      if (activeWallet) {
        const walletAddress = activeWallet.public_key || activeWallet.solana_address;
        tokensHeld = await executor.getTokenBalance(mint, walletAddress);
      }

      // v3.4: Always try DexScreener first to get full token info
      currentPriceSol = getCachedPrice(mint);
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        const dexData = await dexRes.json() as {
          pairs?: {
            priceNative?: string;
            baseToken?: { name?: string; symbol?: string };
            fdv?: number;
            liquidity?: { usd?: number };
            priceChange?: { h24?: number };
          }[]
        };

        if (dexData.pairs?.[0]) {
          const pair = dexData.pairs[0];
          // v3.4: Extract token info for enhanced display
          tokenInfo = {
            name: pair.baseToken?.name || null,
            marketCapUsd: pair.fdv || null,
            liquidityUsd: pair.liquidity?.usd || null,
            priceChangePercent: pair.priceChange?.h24 || null,
          };

          // Update symbol if available
          if (pair.baseToken?.symbol && tokenSymbol === 'TOKEN') {
            tokenSymbol = pair.baseToken.symbol;
          }

          if (pair.priceNative && currentPriceSol === null) {
            currentPriceSol = parseFloat(pair.priceNative);
            setCachedPrice(mint, currentPriceSol);
          }
        }
      } catch (dexErr) {
        console.warn('[TradeMonitor] DexScreener fetch failed:', dexErr);
      }

      // Fallback to Jupiter for price if DexScreener didn't have it
      if (currentPriceSol === null) {
        try {
          const quote = await executor.jupiter.getQuote(
            mint,
            'So11111111111111111111111111111111111111112',
            BigInt(1_000_000_000),
            100
          );
          if (quote) {
            // v3.4 FIX: Use Number() instead of parseInt() for precision
            currentPriceSol = Number(quote.outAmount) / 1_000_000_000;
            setCachedPrice(mint, currentPriceSol);
          }
        } catch (jupiterErr) {
          console.warn('[TradeMonitor] Jupiter quote failed');
        }
      }

      if (tokensHeld && currentPriceSol) {
        estimatedValueSol = tokensHeld * currentPriceSol;
      }
    } catch (error) {
      console.warn(`[TradeMonitor] Error fetching data for sell panel:`, error);
    }

    const hasBalance = tokensHeld !== null && tokensHeld > 0;

    // v3.4: Pass chain and tokenInfo for enhanced display
    const message = formatSellPanelMessage(
      tokenSymbol,
      mint,
      tokensHeld,
      estimatedValueSol,
      currentPriceSol,
      effectiveSlippage,
      effectivePriority,
      180, // SOL price USD (TODO: fetch dynamically)
      chain,
      tokenInfo
    );

    // Build keyboard without "Back to Monitor" since we came from token card
    // v3.4: Added refresh button
    const keyboard = new InlineKeyboard();

    if (hasBalance) {
      keyboard
        .text('10%', `sell_pct:${mint}:10`)
        .text('25%', `sell_pct:${mint}:25`)
        .text('50%', `sell_pct:${mint}:50`)
        .row()
        .text('75%', `sell_pct:${mint}:75`)
        .text('100%', `sell_pct:${mint}:100`)
        .row()
        .text('✏️ X Tokens', `sell_custom:${mint}:tokens`)
        .text('✏️ X%', `sell_custom:${mint}:percent`)
        .row();
    }

    keyboard
      .text('⚙️ Slippage', `sell_slippage:${mint}`)
      .text('⚡ Priority', `sell_priority:${mint}`)
      // v3.4: Added refresh button
      .text('🔄 Refresh', `refresh_sell:${mint}`)
      .row()
      // v3.4: Include chain for correct token panel navigation
      .text('« Back to Token', `token:${chain}_${mint}`);

    // Send as new message
    await api.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error('[TradeMonitor] Error opening sell panel new:', error);
  }
}
