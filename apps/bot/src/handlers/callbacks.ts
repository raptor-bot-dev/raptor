/**
 * Callback Query Handler for RAPTOR v2.3
 *
 * Routes all inline keyboard callbacks to appropriate handlers.
 * Organized by category:
 * - Navigation (menu, back)
 * - Wallet (multi-wallet management, deposit, withdraw)
 * - Hunt (enable/disable, settings)
 * - Positions (view, sell, edit)
 * - Settings (strategy, gas, slippage, notifications)
 * - Custom Strategy (5-page editor)
 * - Address Detection (send native/token)
 *
 * SECURITY: v2.3.1 - All wallet operations require ownership verification
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain, TradingMode, TradingStrategy } from '@raptor/shared';
import { getUserBalances } from '@raptor/shared';

// Security imports
import {
  parseWalletCallback,
  requireWalletOwnership,
  logWalletOperation,
} from '../middleware/walletAuth.js';
import {
  isValidChain,
  parseWalletIndex,
  sanitizeCallbackData,
} from '../utils/validation.js';

// Import command handlers
import { handleModeSelection, handleChainSelection } from '../commands/deposit.js';
// v5.0: Legacy sell handlers no longer used - sells now go through handleSellPctFromMonitor
import { showMenu } from '../commands/menu.js';
import { showStart } from '../commands/start.js';
import { handleBackupConfirm, showWalletInfo } from '../commands/backup.js';
import { showPositions } from '../commands/positions.js';
import { showHistory } from '../commands/history.js';

// v2.3 Wallet imports
import {
  showWallets,
  showPortfolio,
  showWalletCreate,
  showWalletImport,
  createNewWallet,
  startWalletImport,
  handleWalletSaved,
  showChainWallets,
  showWalletDetails,
  startWithdrawal,
  selectWithdrawalPercentage,
  startCustomWithdrawal,
  exportWalletKey,
  activateWallet,
  startDeleteWallet,
  showWalletDeposit,
} from '../commands/wallet.js';

// Utilities
import { escapeMarkdown, escapeMarkdownV2, LINE } from '../utils/formatters.js';
import { CHAIN_NAME } from '../utils/keyboards.js';

// Hunt imports
import {
  showHunt,
  showChainHunt,
  toggleHunt,
  showScoreSelection,
  setMinScore,
  showSizeSelection,
  setPositionSize as setHuntPositionSize,
  showLaunchpadSelection,
  toggleLaunchpad,
  enableAllLaunchpads,
  disableAllLaunchpads,
  showOpportunities,
  showHuntSlippage,     // v4.2: Hunt-specific slippage
  setHuntSlippage,      // v4.2: Hunt-specific slippage
  showHuntPriority,     // v4.2: Hunt-specific priority
  setHuntPriority,      // v4.2: Hunt-specific priority
  showSnipeMode,        // v4.3: Snipe mode selection
  setSnipeMode,         // v4.3: Set snipe mode
  showTpSelection as showHuntTpSelection,      // v5.0: Take profit selection
  setTakeProfit as setHuntTakeProfit,          // v5.0: Set take profit
  showSlSelection as showHuntSlSelection,      // v5.0: Stop loss selection
  setStopLoss as setHuntStopLoss,              // v5.0: Set stop loss
} from '../commands/hunt.js';

// Settings imports
import {
  showSettings,
  showPositionSize,
  setPositionSize,
  showChainsEnabled,
  toggleChainEnabled,
  showNotifications,
  toggleNotification,
  toggleAntiMev,           // v4.2: Anti-MEV toggle
  showManualSlippage,      // v4.3: Direct slippage panel
  showManualPriority,      // v4.3: Direct priority panel
  showBuySlippageSelection,
  showSellSlippageSelection,
  setBuySlippage,
  setSellSlippage,
  showBuyTipSelection,
  showSellTipSelection,
  setBuyTip,
  setSellTip,
} from '../commands/settings.js';

// Strategy imports (v2.3 - full custom strategy support)
import {
  showStrategy,
  showStrategyDetail,
  setStrategy,
  showCustomStrategyPage1,
  showCustomStrategyPage2,
  showCustomStrategyPage3,
  showCustomStrategyPage4,
  showCustomStrategyPage5,
  toggleCustomTrailing,
  toggleCustomDca,
  toggleCustomAntiRug,
  toggleCustomAntiMev,
  toggleCustomAutoApprove,
  toggleCustomRetry,
  showTpSelection,
  showSlSelection,
  showMaxHoldSelection,
  showMoonBagSelection,
  showCustomSlippageSelection,
  showCustomGasSelection,
  showLiquiditySelection,
  showMcapSelection,
  showMinScoreSelection,
  showTaxSelection,
  setCustomTp,
  setCustomSl,
  setCustomHold,
  setCustomMoonBag,
  setCustomSlippage,
  setCustomGas,
  setCustomLiquidity,
  setCustomMcap,
  setCustomMinScore,
  setCustomTax,
  saveCustomStrategy,
  resetCustomStrategy,
  requestCustomInput,
} from '../commands/strategy.js';

// Gas imports
import {
  showGas,
  showChainGas,
  toggleAutoTip,
  showSpeedSelection,
  setTipSpeed,
  showMaxTipSelection,
  setMaxTip,
} from '../commands/gas.js';

// Slippage imports
import {
  showSlippage,
  showChainSlippage,
  toggleAutoSlippage,
  showSlippageSelection,
  setSlippage,
} from '../commands/slippage.js';

// Snipe imports
import {
  handleSnipeConfirm,
  handleSnipeCancel,
  handleSnipeAdjust,
} from '../commands/snipe.js';

import { handleScoreRequest } from '../commands/score.js';
import { getOrCreateDepositAddress, processWithdrawal } from '../services/wallet.js';

// Trade Monitor imports
import {
  createTradeMonitor,
  handleManualRefresh,
  openSellPanel,
  closeMonitorAfterSell,
  formatTradeMonitorMessage,
  buildTradeMonitorKeyboard,
  resetToMonitorView,
} from '../services/tradeMonitor.js';
import { getMonitorById, getUserMonitor, createPositionV31, getOrCreateManualStrategy, setMonitorView } from '@raptor/shared';
import { solanaExecutor } from '@raptor/executor/solana';

export async function handleCallbackQuery(ctx: MyContext) {
  const rawData = ctx.callbackQuery?.data;
  if (!rawData) return;

  // M-1: Sanitize callback data to prevent injection attacks
  const data = sanitizeCallbackData(rawData);

  const user = ctx.from;
  if (!user) return;

  try {
    // === V3 TERMINAL UI CALLBACKS ===
    // Route new-style callbacks (home:*, hunt:*, settings:*, etc.) first
    const { routeNewCallbacks } = await import('./callbackRouter.js');
    if (await routeNewCallbacks(ctx)) {
      return; // Handled by new router
    }

    // v4.4: Route legacy hunt callbacks to new autohunt panels
    if (
      data === 'back_to_hunt' ||
      data === 'menu_hunt' ||
      data === 'hunt' ||
      data.startsWith('hunt_')
    ) {
      const { showHunt } = await import('./huntHandler.js');
      await showHunt(ctx);
      await ctx.answerCallbackQuery('Hunt settings moved to Settings');
      return;
    }

    // === NAVIGATION ===
    // v3.5: Redirect legacy navigation callbacks to v3 Home panel
    if (data === 'back_to_menu' || data === 'menu' || data === 'back_to_start') {
      const { showHome } = await import('./home.js');
      await showHome(ctx);
      return;
    }

    // === START / ONBOARDING ===
    // v5.0: Wallet is auto-generated on /start, redirect legacy callbacks
    if (data === 'start_generate_wallet' || data.startsWith('generate_wallet_')) {
      await showStart(ctx);
      return;
    }

    if (data === 'help_start') {
      await showHowItWorks(ctx);
      return;
    }

    if (data === 'help_deposits') {
      await showHelpDeposits(ctx);
      return;
    }

    if (data === 'help_hunt') {
      await showHelpHunt(ctx);
      return;
    }

    if (data === 'help_strategies') {
      await showHelpStrategies(ctx);
      return;
    }

    if (data === 'help_fees') {
      await showHelpFees(ctx);
      return;
    }

    // v4.1 FIX: Add missing help handlers
    if (data === 'help_sniping') {
      const message =
        `🎯 *SNIPING GUIDE*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*How to Snipe Tokens:*\n\n` +
        `1. Paste any token address in chat\n` +
        `2. Review the token analysis\n` +
        `3. Click buy amount buttons\n` +
        `4. Confirm your trade\n\n` +
        `*Tips:*\n` +
        `• Use Hunt to find new launches\n` +
        `• Check security score before buying\n` +
        `• Set stop-loss to protect gains`;

      const keyboard = new InlineKeyboard()
        .text('← Back', 'help');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'help_settings') {
      const message =
        `⚙️ *SETTINGS GUIDE*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Available Settings:*\n\n` +
        `• *Slippage* - Max price impact %\n` +
        `• *Priority Fee* - Transaction speed\n` +
        `• *Anti-MEV* - Jito protection\n` +
        `• *Notifications* - Alert preferences\n\n` +
        `Access via: Menu → Settings`;

      const keyboard = new InlineKeyboard()
        .text('← Back', 'help');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // === v2.3 MULTI-WALLET CALLBACKS ===
    if (data === 'wallets') {
      await showWallets(ctx);
      return;
    }

    if (data === 'wallet_create') {
      await showWalletCreate(ctx);
      return;
    }

    if (data === 'wallet_refresh') {
      await ctx.answerCallbackQuery('🔄 Refreshing balances...');
      await showWallets(ctx);
      return;
    }

    if (data === 'wallet_portfolio') {
      await showPortfolio(ctx);
      return;
    }

    if (data === 'wallet_import') {
      await showWalletImport(ctx);
      return;
    }

    // Import wallet for chain (wallet_import_sol, wallet_import_bsc, etc.)
    if (data.startsWith('wallet_import_')) {
      const chain = data.replace('wallet_import_', '') as Chain;
      await startWalletImport(ctx, chain);
      return;
    }

    // Create wallet for chain (wallet_create_sol, wallet_create_bsc, etc.)
    if (data.startsWith('wallet_create_')) {
      const chain = data.replace('wallet_create_', '') as Chain;
      await createNewWallet(ctx, chain);
      return;
    }

    // Show wallets for chain (wallet_chain_sol, wallet_chain_bsc, etc.)
    if (data.startsWith('wallet_chain_')) {
      const chain = data.replace('wallet_chain_', '') as Chain;
      await showChainWallets(ctx, chain);
      return;
    }

    // Show wallet details (wallet_select_sol_1, wallet_select_bsc_2, etc.)
    if (data.startsWith('wallet_select_')) {
      const parsed = parseWalletCallback(data, 'wallet_select_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before showing details
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          await showWalletDetails(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Wallet saved confirmation (wallet_saved_sol_1, etc.)
    if (data.startsWith('wallet_saved_')) {
      const parsed = parseWalletCallback(data, 'wallet_saved_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before confirming saved
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          await handleWalletSaved(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Export wallet key (wallet_export_sol_1, etc.) - SECURITY CRITICAL
    if (data.startsWith('wallet_export_')) {
      const parsed = parseWalletCallback(data, 'wallet_export_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before allowing key export
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'export', chain as Chain, walletIndex, true);
          await exportWalletKey(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Activate wallet (wallet_activate_sol_1, etc.) - SECURITY CRITICAL
    if (data.startsWith('wallet_activate_')) {
      const parsed = parseWalletCallback(data, 'wallet_activate_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before allowing activation
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'activate', chain as Chain, walletIndex, true);
          await activateWallet(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Delete wallet (wallet_delete_sol_1, etc.) - SECURITY CRITICAL
    if (data.startsWith('wallet_delete_')) {
      const parsed = parseWalletCallback(data, 'wallet_delete_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before allowing deletion
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'delete', chain as Chain, walletIndex, true);
          await startDeleteWallet(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Deposit to wallet (wallet_deposit_sol_1, etc.)
    if (data.startsWith('wallet_deposit_')) {
      const parsed = parseWalletCallback(data, 'wallet_deposit_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before showing deposit address
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'deposit', chain as Chain, walletIndex, true);
          await showWalletDeposit(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Withdraw from wallet (wallet_withdraw_sol_1, etc.)
    if (data.startsWith('wallet_withdraw_')) {
      const parsed = parseWalletCallback(data, 'wallet_withdraw_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        // Verify ownership before starting withdrawal
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'withdraw_start', chain as Chain, walletIndex, true);
          await startWithdrawal(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Withdraw percentage (withdraw_pct_sol_1_25, etc.)
    if (data.startsWith('withdraw_pct_')) {
      const parts = data.replace('withdraw_pct_', '').split('_');
      if (parts.length === 3) {
        const chain = parts[0] as Chain;
        const indexStr = parts[1];
        const percentage = parseInt(parts[2]);
        if (isNaN(percentage)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }

        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'withdraw_amount', chain as Chain, walletIndex, true);
          await selectWithdrawalPercentage(ctx, chain, walletIndex, percentage);
        });
        return;
      }
    }

    // Custom withdrawal amount (withdraw_custom_sol_1, etc.)
    if (data.startsWith('withdraw_custom_')) {
      const parsed = parseWalletCallback(data, 'withdraw_custom_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        await requireWalletOwnership(ctx, chain, indexStr, async (wallet) => {
          const walletIndex = parseWalletIndex(indexStr)!;
          logWalletOperation(user.id, 'withdraw_custom', chain as Chain, walletIndex, true);
          await startCustomWithdrawal(ctx, chain as Chain, walletIndex);
        });
        return;
      }
    }

    // Confirm withdrawal
    if (data === 'confirm_withdrawal') {
      await handleConfirmWithdrawal(ctx);
      return;
    }

    // v4.1 FIX: Add wallet rename handler
    if (data.startsWith('wallet_rename_')) {
      const parsed = parseWalletCallback(data, 'wallet_rename_');
      if (parsed) {
        const { chain, indexStr } = parsed;
        await requireWalletOwnership(ctx, chain, indexStr, async () => {
          const walletIndex = parseWalletIndex(indexStr)!;
          ctx.session.step = 'awaiting_wallet_rename';
          ctx.session.pendingRename = { chain: chain as Chain, walletIndex };

          const message =
            `✏️ *RENAME WALLET*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `Renaming Wallet ${walletIndex + 1}\n\n` +
            `Enter a new name for this wallet:`;

          await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        });
        return;
      }
    }

    // v4.1 FIX: Add send_native_sol and send_token_sol handlers
    if (data === 'send_native_sol') {
      ctx.session.step = 'awaiting_send_address';
      ctx.session.pendingSend = { toAddress: '', chain: 'sol' as Chain, sendType: 'native' };

      const message =
        `📤 *SEND SOL*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Enter the destination wallet address:`;

      await ctx.editMessageText(message, { parse_mode: 'Markdown' });
      return;
    }

    if (data === 'send_token_sol') {
      ctx.session.step = 'awaiting_send_token_ca';
      ctx.session.pendingSend = { toAddress: '', chain: 'sol' as Chain, sendType: 'token' };

      const message =
        `🪙 *SEND TOKEN*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Paste the token contract address (CA):`;

      await ctx.editMessageText(message, { parse_mode: 'Markdown' });
      return;
    }

    // v4.1 FIX: Add limit order handler (coming soon)
    if (data.match(/^limit_\d+$/)) {
      await ctx.answerCallbackQuery({ text: 'Limit orders coming soon' });
      return;
    }

    // v4.1 FIX: Add edit_tpsl handler (alternative pattern)
    if (data.match(/^edit_tpsl_\d+$/)) {
      const positionId = parseInt(data.replace('edit_tpsl_', ''));
      if (isNaN(positionId)) {
        await ctx.answerCallbackQuery({ text: 'Invalid position' });
        return;
      }
      await showEditTpSl(ctx, positionId);
      return;
    }

    // === ADDRESS DETECTION CALLBACKS ===
    // Chain selection for detected address (address_chain_bsc_0x..., etc.)
    if (data.startsWith('address_chain_')) {
      const rest = data.replace('address_chain_', '');
      const firstUnderscore = rest.indexOf('_');
      if (firstUnderscore > 0) {
        const chain = rest.substring(0, firstUnderscore) as Chain;
        const address = rest.substring(firstUnderscore + 1);
        await handleAddressChainSelected(ctx, chain, address);
        return;
      }
    }

    // Chain selection for trading token CA (trade_chain_bsc_0x..., etc.)
    if (data.startsWith('trade_chain_')) {
      const rest = data.replace('trade_chain_', '');
      const firstUnderscore = rest.indexOf('_');
      if (firstUnderscore > 0) {
        const chain = rest.substring(0, firstUnderscore) as Chain;
        const address = rest.substring(firstUnderscore + 1);
        await handleTradeChainSelected(ctx, chain, address);
        return;
      }
    }

    // Send options (send_sol_0.1, send_bsc_0.5, etc.)
    if (data.startsWith('send_')) {
      const parts = data.replace('send_', '').split('_');
      if (parts.length >= 2) {
        const chain = parts[0] as Chain;
        const amount = parts[1];
        await handleSendAmount(ctx, chain, amount);
        return;
      }
    }

    // Confirm send
    if (data === 'confirm_send') {
      await handleConfirmSendTransaction(ctx);
      return;
    }

    // Cancel send
    if (data === 'cancel_send') {
      await handleCancelSend(ctx);
      return;
    }

    // === BACKUP / KEY EXPORT ===
    if (data === 'backup_confirm') {
      await handleBackupConfirm(ctx);
      return;
    }

    if (data === 'backup_start') {
      // Show backup warning from wallet info screen
      const wallet = await import('@raptor/shared').then((m) => m.getUserWallet(user.id));
      if (wallet) {
        const message = `🔐 *Export Private Keys*

⚠️ *WARNING - READ CAREFULLY:*

• Your private keys give *FULL ACCESS* to your funds
• *NEVER* share them with anyone
• Keys will be shown *ONCE*
• Message auto-deletes after 60 seconds

Tap "Show Keys" to reveal your private keys.`;

        const keyboard = new InlineKeyboard()
          .text('🔓 Show Keys', 'backup_confirm')
          .row()
          .text('❌ Cancel', 'wallet_info');

        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      }
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'wallet_info') {
      await showWalletInfo(ctx);
      return;
    }

    // v3.4.2 FIX: Added back_to_wallets (was unhandled)
    if (data === 'back_to_wallet' || data === 'back_to_wallets' || data === 'menu_wallet' || data === 'wallets') {
      await showWallets(ctx);
      return;
    }

    if (data === 'back_to_hunt' || data === 'menu_hunt' || data === 'hunt') {
      await showHunt(ctx);
      return;
    }

    if (data === 'menu_positions' || data === 'positions') {
      await showPositions(ctx, 'all');
      return;
    }

    // v5.0: Positions filter callbacks
    if (data.startsWith('positions_filter_')) {
      const filter = data.replace('positions_filter_', '') as 'all' | 'manual' | 'hunt';
      await showPositions(ctx, filter, true);
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'menu_snipe' || data === 'quick_trade') {
      await ctx.answerCallbackQuery({ text: 'Paste a token address to trade' });
      return;
    }

    if (data === 'menu_settings' || data === 'settings') {
      await showSettings(ctx);
      return;
    }

    if (data === 'menu_help' || data === 'help') {
      await showHelpMenu(ctx);
      return;
    }

    // Coming soon features
    if (data === 'chains') {
      await ctx.answerCallbackQuery({ text: 'Chain selection coming soon' });
      return;
    }

    if (data === 'copytrade') {
      await ctx.answerCallbackQuery({ text: 'Copytrade coming soon' });
      return;
    }

    if (data === 'orders') {
      await ctx.answerCallbackQuery({ text: 'Limit orders coming soon' });
      return;
    }

    if (data === 'premium') {
      await ctx.answerCallbackQuery({ text: 'Premium features coming soon' });
      return;
    }

    if (data === 'bridge') {
      await ctx.answerCallbackQuery({ text: 'Bridge coming soon' });
      return;
    }

    if (data === 'cashback') {
      await ctx.answerCallbackQuery({ text: 'Cashback coming soon' });
      return;
    }

    if (data === 'referral') {
      await ctx.answerCallbackQuery({ text: 'Referral program coming soon' });
      return;
    }

    // Back to settings
    if (data === 'back_to_settings') {
      await showSettings(ctx);
      return;
    }

    // v4.1 FIX: Add missing back button handlers
    if (data === 'back_to_gas') {
      await showGas(ctx);
      return;
    }

    if (data === 'back_to_slippage') {
      await showSlippage(ctx);
      return;
    }

    if (data === 'back_to_strategy') {
      await showStrategy(ctx);
      return;
    }

    if (data === 'back_to_custom') {
      // Return to custom strategy page 1
      const { showCustomStrategyPage1 } = await import('../commands/strategy.js');
      await showCustomStrategyPage1(ctx);
      return;
    }

    // v4.1 FIX: Add mixer handler
    if (data === 'mixer') {
      await ctx.answerCallbackQuery({ text: 'Mixer coming soon' });
      return;
    }

    // v4.1 FIX: Add orphaned settings button handlers
    if (data === 'settings_buy') {
      // Redirect to manual settings which has buy slippage
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, 'sol');
      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);

      const message =
        `🛒 *BUY SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Buy Slippage:* ${buySlip}%\n` +
        `*Priority Fee:* ${settings.priority_sol} SOL\n\n` +
        `_Adjust settings for buy transactions_`;

      const keyboard = new InlineKeyboard()
        .text(`🎚️ Slippage: ${buySlip}%`, `chain_buy_slip:sol`)
        .row()
        .text(`⚡ Priority: ${settings.priority_sol} SOL`, `chain_priority:sol`)
        .row()
        .text('← Back', 'settings');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'settings_sell') {
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, 'sol');
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);

      const message =
        `💰 *SELL SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Sell Slippage:* ${sellSlip}%\n` +
        `*Priority Fee:* ${settings.priority_sol} SOL\n\n` +
        `_Adjust settings for sell transactions_`;

      const keyboard = new InlineKeyboard()
        .text(`🎚️ Slippage: ${sellSlip}%`, `chain_sell_slip:sol`)
        .row()
        .text(`⚡ Priority: ${settings.priority_sol} SOL`, `chain_priority:sol`)
        .row()
        .text('← Back', 'settings');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'settings_antirug') {
      await ctx.answerCallbackQuery({ text: 'Anti-Rug settings coming soon' });
      return;
    }

    if (data === 'settings_mev') {
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, 'sol');
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';

      const message =
        `🔒 *MEV PROTECTION*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Status:* ${mevStatus}\n\n` +
        `Anti-MEV uses Jito bundles to protect\n` +
        `your transactions from sandwich attacks.\n\n` +
        `_Recommended for larger trades_`;

      const keyboard = new InlineKeyboard()
        .text(settings.anti_mev_enabled ? '❌ Disable Anti-MEV' : '✅ Enable Anti-MEV', `chain_mev_toggle:sol`)
        .row()
        .text('← Back', 'settings');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    if (data === 'settings_degen') {
      await ctx.answerCallbackQuery({ text: 'Degen Mode coming soon' });
      return;
    }

    if (data === 'settings_tokenview') {
      await ctx.answerCallbackQuery({ text: 'Token View settings coming soon' });
      return;
    }

    if (data === 'settings_fees') {
      await ctx.answerCallbackQuery({ text: 'Fee settings coming soon' });
      return;
    }

    // v4.1 FIX: Handle settings_notifications (keyboard uses this, handler was settings_notif)
    if (data === 'settings_notifications') {
      await showNotifications(ctx);
      return;
    }

    // === SETTINGS CALLBACKS ===
    if (data === 'settings_strategy') {
      await showStrategy(ctx);
      return;
    }

    // v4.3: Direct routing to priority panel (no intermediate "Solana" step)
    if (data === 'settings_gas') {
      await showManualPriority(ctx);
      return;
    }

    // v4.3: Direct routing to slippage panel (no intermediate "Solana" step)
    if (data === 'settings_slippage') {
      await showManualSlippage(ctx);
      return;
    }

    // v4.3: Manual slippage handlers
    if (data === 'manual_slip_buy') {
      await showBuySlippageSelection(ctx);
      return;
    }

    if (data === 'manual_slip_sell') {
      await showSellSlippageSelection(ctx);
      return;
    }

    if (data.startsWith('manual_slip_set_buy_')) {
      const bps = parseInt(data.replace('manual_slip_set_buy_', ''));
      if (!isNaN(bps)) {
        await setBuySlippage(ctx, bps);
      }
      return;
    }

    if (data.startsWith('manual_slip_set_sell_')) {
      const bps = parseInt(data.replace('manual_slip_set_sell_', ''));
      if (!isNaN(bps)) {
        await setSellSlippage(ctx, bps);
      }
      return;
    }

    if (data === 'manual_slip_custom_buy') {
      ctx.session.step = 'awaiting_manual_buy_slip';
      await ctx.editMessageText(
        '🎚️ *CUSTOM BUY SLIPPAGE*\n\n' +
        'Enter slippage percentage (e.g., 15 for 15%):\n\n' +
        '_Valid range: 1-100%_',
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'manual_slip_custom_sell') {
      ctx.session.step = 'awaiting_manual_sell_slip';
      await ctx.editMessageText(
        '🎚️ *CUSTOM SELL SLIPPAGE*\n\n' +
        'Enter slippage percentage (e.g., 15 for 15%):\n\n' +
        '_Valid range: 1-100%_',
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    // v4.3: Manual priority tip handlers
    if (data === 'manual_tip_buy') {
      await showBuyTipSelection(ctx);
      return;
    }

    if (data === 'manual_tip_sell') {
      await showSellTipSelection(ctx);
      return;
    }

    if (data.startsWith('manual_tip_set_buy_')) {
      const sol = parseFloat(data.replace('manual_tip_set_buy_', ''));
      if (!isNaN(sol)) {
        await setBuyTip(ctx, sol);
      }
      return;
    }

    if (data.startsWith('manual_tip_set_sell_')) {
      const sol = parseFloat(data.replace('manual_tip_set_sell_', ''));
      if (!isNaN(sol)) {
        await setSellTip(ctx, sol);
      }
      return;
    }

    if (data === 'manual_tip_custom_buy') {
      ctx.session.step = 'awaiting_manual_buy_tip';
      await ctx.editMessageText(
        '⚡ *CUSTOM BUY TIP*\n\n' +
        'Enter tip amount in SOL (e.g., 0.005):\n\n' +
        '_Example: 0.001 = 0.001 SOL_',
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'manual_tip_custom_sell') {
      ctx.session.step = 'awaiting_manual_sell_tip';
      await ctx.editMessageText(
        '⚡ *CUSTOM SELL TIP*\n\n' +
        'Enter tip amount in SOL (e.g., 0.005):\n\n' +
        '_Example: 0.001 = 0.001 SOL_',
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === 'settings_size') {
      await showPositionSize(ctx);
      return;
    }

    if (data === 'settings_chains') {
      await showChainsEnabled(ctx);
      return;
    }

    if (data === 'settings_notif') {
      await showNotifications(ctx);
      return;
    }

    // v4.2: Anti-MEV toggle
    if (data === 'settings_antimev') {
      await toggleAntiMev(ctx);
      return;
    }

    // ============================================
    // v3.3 FIX (Issue 3): AUTOHUNT SETTINGS HANDLER
    // ============================================

    if (data === 'settings_autohunt') {
      // v3.4 FIX: Standard line format (35 chars, below heading only)
      const message =
        `⚙️ *AUTOHUNT SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Configure your automated sniping strategies.\n\n` +
        `• Create/edit strategies\n` +
        `• Set filters and limits\n` +
        `• Enable/disable auto-execute`;

      const keyboard = new InlineKeyboard()
        .text('View Strategies', 'settings_strategy')
        .row()
        .text('Gas Settings', 'settings_gas')
        .text('Slippage', 'settings_slippage')
        .row()
        .text('Back', 'menu');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // ============================================
    // v4.0: SOLANA-ONLY MANUAL SETTINGS
    // ============================================

    // Manual settings - go directly to Solana settings
    if (data === 'settings_manual') {
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, 'sol');

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';

      const message =
        `⚙️ *SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `*Priority Fee:* ${settings.priority_sol} SOL\n\n` +
        `*Anti-MEV (Jito)*\n` +
        `${mevStatus}\n\n` +
        `_Configure your trading preferences_`;

      const keyboard = new InlineKeyboard()
        .text(`🎚️ Buy Slip: ${buySlip}%`, `chain_buy_slip:sol`)
        .text(`🎚️ Sell Slip: ${sellSlip}%`, `chain_sell_slip:sol`)
        .row()
        .text(`⚡ Priority: ${settings.priority_sol} SOL`, `chain_priority:sol`)
        .row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:sol`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:sol`)
        .row()
        .text('« Back', 'menu');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Chain-specific settings panel
    if (data.startsWith('chain_settings:')) {
      const chain = data.replace('chain_settings:', '');
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = {
        sol: 'SOLANA',
        eth: 'ETHEREUM',
        base: 'BASE',
        bsc: 'BSC',
      };
      const chainEmoji: Record<string, string> = {
        sol: '☀️',
        eth: 'Ξ',
        base: '🔵',
        bsc: '🟡',
      };
      const mevProvider: Record<string, string> = {
        sol: 'Jito',
        eth: 'Flashbots',
        base: 'Flashbots',
        bsc: 'bloXroute',
      };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';

      let gasLine = '';
      if (chain === 'sol') {
        gasLine = `*Priority Fee:* ${settings.priority_sol} SOL`;
      } else {
        gasLine = `*Gas Price:* ${settings.gas_gwei} gwei`;
      }

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row();

      if (chain === 'sol') {
        keyboard.text(`Priority: ${settings.priority_sol} SOL`, `chain_priority:${chain}`);
      } else {
        keyboard.text(`Gas: ${settings.gas_gwei} gwei`, `chain_gas:${chain}`);
      }
      keyboard.row();

      keyboard
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Buy slippage selection for chain
    if (data.startsWith('chain_buy_slip:')) {
      const chain = data.replace('chain_buy_slip:', '');
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);
      const currentBps = settings.buy_slippage_bps;

      const message =
        `*BUY SLIPPAGE - ${chain.toUpperCase()}*\n\n` +
        `Current: ${(currentBps / 100).toFixed(1)}%\n\n` +
        `_Higher = more likely to execute_\n` +
        `_Lower = better price or fail_`;

      const keyboard = new InlineKeyboard()
        .text(currentBps === 100 ? '> 1%' : '1%', `set_chain_buy_slip:${chain}_100`)
        .text(currentBps === 300 ? '> 3%' : '3%', `set_chain_buy_slip:${chain}_300`)
        .text(currentBps === 500 ? '> 5%' : '5%', `set_chain_buy_slip:${chain}_500`)
        .row()
        .text(currentBps === 1000 ? '> 10%' : '10%', `set_chain_buy_slip:${chain}_1000`)
        .text(currentBps === 1500 ? '> 15%' : '15%', `set_chain_buy_slip:${chain}_1500`)
        .text(currentBps === 2000 ? '> 20%' : '20%', `set_chain_buy_slip:${chain}_2000`)
        .row()
        .text('Custom', `chain_buy_slip_custom:${chain}`)
        .row()
        .text('« Back', `chain_settings:${chain}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set buy slippage value
    if (data.startsWith('set_chain_buy_slip:')) {
      const parts = data.replace('set_chain_buy_slip:', '').split('_');
      const chain = parts[0];
      const bps = parseInt(parts[1]);
      if (isNaN(bps)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, buySlippageBps: bps });

      await ctx.answerCallbackQuery({ text: `✓ Buy slippage set to ${(bps / 100).toFixed(1)}%` });

      // Return to chain settings panel
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = { sol: 'SOLANA', eth: 'ETHEREUM', base: 'BASE', bsc: 'BSC' };
      const chainEmoji: Record<string, string> = { sol: '☀️', eth: 'Ξ', base: '🔵', bsc: '🟡' };
      const mevProvider: Record<string, string> = { sol: 'Jito', eth: 'Flashbots', base: 'Flashbots', bsc: 'bloXroute' };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';
      const gasLine = chain === 'sol' ? `*Priority Fee:* ${settings.priority_sol} SOL` : `*Gas Price:* ${settings.gas_gwei} gwei`;

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row();
      if (chain === 'sol') {
        keyboard.text(`Priority: ${settings.priority_sol} SOL`, `chain_priority:${chain}`);
      } else {
        keyboard.text(`Gas: ${settings.gas_gwei} gwei`, `chain_gas:${chain}`);
      }
      keyboard.row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    // Sell slippage selection for chain
    if (data.startsWith('chain_sell_slip:')) {
      const chain = data.replace('chain_sell_slip:', '');
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);
      const currentBps = settings.sell_slippage_bps;

      const message =
        `*SELL SLIPPAGE - ${chain.toUpperCase()}*\n\n` +
        `Current: ${(currentBps / 100).toFixed(1)}%\n\n` +
        `_Higher = more likely to execute_\n` +
        `_Lower = better price or fail_`;

      const keyboard = new InlineKeyboard()
        .text(currentBps === 100 ? '> 1%' : '1%', `set_chain_sell_slip:${chain}_100`)
        .text(currentBps === 300 ? '> 3%' : '3%', `set_chain_sell_slip:${chain}_300`)
        .text(currentBps === 500 ? '> 5%' : '5%', `set_chain_sell_slip:${chain}_500`)
        .row()
        .text(currentBps === 1000 ? '> 10%' : '10%', `set_chain_sell_slip:${chain}_1000`)
        .text(currentBps === 1500 ? '> 15%' : '15%', `set_chain_sell_slip:${chain}_1500`)
        .text(currentBps === 2000 ? '> 20%' : '20%', `set_chain_sell_slip:${chain}_2000`)
        .row()
        .text('Custom', `chain_sell_slip_custom:${chain}`)
        .row()
        .text('« Back', `chain_settings:${chain}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set sell slippage value
    if (data.startsWith('set_chain_sell_slip:')) {
      const parts = data.replace('set_chain_sell_slip:', '').split('_');
      const chain = parts[0];
      const bps = parseInt(parts[1]);
      if (isNaN(bps)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, sellSlippageBps: bps });

      await ctx.answerCallbackQuery({ text: `✓ Sell slippage set to ${(bps / 100).toFixed(1)}%` });

      // Return to chain settings - redirect to chain_settings handler
      // Simulate the callback by calling the handler logic
      const newData = `chain_settings:${chain}`;
      // Re-trigger chain settings panel
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = { sol: 'SOLANA', eth: 'ETHEREUM', base: 'BASE', bsc: 'BSC' };
      const chainEmoji: Record<string, string> = { sol: '☀️', eth: 'Ξ', base: '🔵', bsc: '🟡' };
      const mevProvider: Record<string, string> = { sol: 'Jito', eth: 'Flashbots', base: 'Flashbots', bsc: 'bloXroute' };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';
      const gasLine = chain === 'sol' ? `*Priority Fee:* ${settings.priority_sol} SOL` : `*Gas Price:* ${settings.gas_gwei} gwei`;

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row();
      if (chain === 'sol') {
        keyboard.text(`Priority: ${settings.priority_sol} SOL`, `chain_priority:${chain}`);
      } else {
        keyboard.text(`Gas: ${settings.gas_gwei} gwei`, `chain_gas:${chain}`);
      }
      keyboard.row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    // Gas price selection (EVM chains)
    if (data.startsWith('chain_gas:')) {
      const chain = data.replace('chain_gas:', '');
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);
      const currentGwei = settings.gas_gwei || 0;

      // Different presets per chain
      const presets: Record<string, number[]> = {
        eth: [20, 30, 50, 75, 100, 150],
        base: [0.05, 0.1, 0.2, 0.5, 1, 2],
        bsc: [3, 5, 7, 10, 15, 20],
      };
      const chainPresets = presets[chain] || [5, 10, 20, 30, 50, 100];

      const message =
        `*GAS PRICE - ${chain.toUpperCase()}*\n\n` +
        `Current: ${currentGwei} gwei\n\n` +
        `_Higher gas = faster execution_\n` +
        `_Lower gas = cheaper but slower_`;

      const keyboard = new InlineKeyboard();
      for (let i = 0; i < chainPresets.length; i += 3) {
        const row = chainPresets.slice(i, i + 3);
        for (const gwei of row) {
          keyboard.text(currentGwei === gwei ? `> ${gwei}` : `${gwei}`, `set_chain_gas:${chain}_${gwei}`);
        }
        keyboard.row();
      }
      keyboard
        .text('Custom', `chain_gas_custom:${chain}`)
        .row()
        .text('« Back', `chain_settings:${chain}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set gas value
    if (data.startsWith('set_chain_gas:')) {
      const parts = data.replace('set_chain_gas:', '').split('_');
      const chain = parts[0];
      const gwei = parseFloat(parts[1]);
      if (isNaN(gwei)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }

      const { updateChainSettings, getOrCreateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, gasGwei: gwei });

      await ctx.answerCallbackQuery({ text: `✓ Gas price set to ${gwei} gwei` });

      // Return to chain settings panel
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = { sol: 'SOLANA', eth: 'ETHEREUM', base: 'BASE', bsc: 'BSC' };
      const chainEmoji: Record<string, string> = { sol: '☀️', eth: 'Ξ', base: '🔵', bsc: '🟡' };
      const mevProvider: Record<string, string> = { sol: 'Jito', eth: 'Flashbots', base: 'Flashbots', bsc: 'bloXroute' };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';
      const gasLine = `*Gas Price:* ${settings.gas_gwei} gwei`;

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row()
        .text(`Gas: ${settings.gas_gwei} gwei`, `chain_gas:${chain}`)
        .row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    // Priority fee selection (Solana)
    if (data.startsWith('chain_priority:')) {
      const chain = data.replace('chain_priority:', '');
      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);
      const currentPriority = settings.priority_sol || 0;

      const presets = [0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01];

      const message =
        `*PRIORITY FEE - SOLANA*\n\n` +
        `Current: ${currentPriority} SOL\n\n` +
        `_Higher priority = faster execution_\n` +
        `_Lower priority = cheaper_`;

      const keyboard = new InlineKeyboard();
      for (let i = 0; i < presets.length; i += 3) {
        const row = presets.slice(i, i + 3);
        for (const p of row) {
          keyboard.text(currentPriority === p ? `> ${p}` : `${p}`, `set_chain_priority:${chain}_${p}`);
        }
        keyboard.row();
      }
      keyboard
        .text('Custom', `chain_priority_custom:${chain}`)
        .row()
        .text('« Back', `chain_settings:${chain}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set priority value
    if (data.startsWith('set_chain_priority:')) {
      const parts = data.replace('set_chain_priority:', '').split('_');
      const chain = parts[0];
      const priority = parseFloat(parts[1]);
      if (isNaN(priority)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }

      const { updateChainSettings, getOrCreateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, prioritySol: priority });

      await ctx.answerCallbackQuery({ text: `✓ Priority fee set to ${priority} SOL` });

      // Return to chain settings panel
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = { sol: 'SOLANA', eth: 'ETHEREUM', base: 'BASE', bsc: 'BSC' };
      const chainEmoji: Record<string, string> = { sol: '☀️', eth: 'Ξ', base: '🔵', bsc: '🟡' };
      const mevProvider: Record<string, string> = { sol: 'Jito', eth: 'Flashbots', base: 'Flashbots', bsc: 'bloXroute' };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';
      const gasLine = `*Priority Fee:* ${settings.priority_sol} SOL`;

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row()
        .text(`Priority: ${settings.priority_sol} SOL`, `chain_priority:${chain}`)
        .row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    // Toggle anti-MEV
    if (data.startsWith('chain_mev_toggle:')) {
      const chain = data.replace('chain_mev_toggle:', '');
      const { getOrCreateChainSettings, updateChainSettings } = await import('@raptor/shared');
      const currentSettings = await getOrCreateChainSettings(user.id, chain);
      const newValue = !currentSettings.anti_mev_enabled;

      await updateChainSettings({ userId: user.id, chain, antiMevEnabled: newValue });

      const mevProvider: Record<string, string> = { sol: 'Jito', eth: 'Flashbots', base: 'Flashbots', bsc: 'bloXroute' };
      await ctx.answerCallbackQuery({
        text: newValue ? `✓ Anti-MEV (${mevProvider[chain]}) enabled` : `✓ Anti-MEV disabled`,
      });

      // Return to chain settings panel
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = { sol: 'SOLANA', eth: 'ETHEREUM', base: 'BASE', bsc: 'BSC' };
      const chainEmoji: Record<string, string> = { sol: '☀️', eth: 'Ξ', base: '🔵', bsc: '🟡' };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';
      const gasLine = chain === 'sol' ? `*Priority Fee:* ${settings.priority_sol} SOL` : `*Gas Price:* ${settings.gas_gwei} gwei`;

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row();
      if (chain === 'sol') {
        keyboard.text(`Priority: ${settings.priority_sol} SOL`, `chain_priority:${chain}`);
      } else {
        keyboard.text(`Gas: ${settings.gas_gwei} gwei`, `chain_gas:${chain}`);
      }
      keyboard.row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    // Reset chain settings to defaults
    if (data.startsWith('chain_reset:')) {
      const chain = data.replace('chain_reset:', '');
      const { resetChainSettings, getOrCreateChainSettings } = await import('@raptor/shared');
      await resetChainSettings(user.id, chain);

      await ctx.answerCallbackQuery({ text: '✓ Settings reset to defaults' });

      // Return to chain settings panel
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainNames: Record<string, string> = { sol: 'SOLANA', eth: 'ETHEREUM', base: 'BASE', bsc: 'BSC' };
      const chainEmoji: Record<string, string> = { sol: '☀️', eth: 'Ξ', base: '🔵', bsc: '🟡' };
      const mevProvider: Record<string, string> = { sol: 'Jito', eth: 'Flashbots', base: 'Flashbots', bsc: 'bloXroute' };

      const buySlip = (settings.buy_slippage_bps / 100).toFixed(1);
      const sellSlip = (settings.sell_slippage_bps / 100).toFixed(1);
      const mevStatus = settings.anti_mev_enabled ? '✅ Enabled' : '❌ Disabled';
      const gasLine = chain === 'sol' ? `*Priority Fee:* ${settings.priority_sol} SOL` : `*Gas Price:* ${settings.gas_gwei} gwei`;

      const message =
        `${chainEmoji[chain]} *${chainNames[chain]} SETTINGS*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `*Slippage*\n` +
        `Buy: ${buySlip}%\n` +
        `Sell: ${sellSlip}%\n\n` +
        `${gasLine}\n\n` +
        `*Anti-MEV (${mevProvider[chain]})*\n` +
        `${mevStatus}`;

      const keyboard = new InlineKeyboard()
        .text(`Buy Slip: ${buySlip}%`, `chain_buy_slip:${chain}`)
        .text(`Sell Slip: ${sellSlip}%`, `chain_sell_slip:${chain}`)
        .row();
      if (chain === 'sol') {
        keyboard.text(`Priority: ${settings.priority_sol} SOL`, `chain_priority:${chain}`);
      } else {
        keyboard.text(`Gas: ${settings.gas_gwei} gwei`, `chain_gas:${chain}`);
      }
      keyboard.row()
        .text(settings.anti_mev_enabled ? '✅ Anti-MEV' : '❌ Anti-MEV', `chain_mev_toggle:${chain}`)
        .row()
        .text('🔄 Reset to Defaults', `chain_reset:${chain}`)
        .row()
        .text('« Back', 'settings_manual');

      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    }

    // Custom input handlers for chain settings
    if (data.startsWith('chain_buy_slip_custom:')) {
      const chain = data.replace('chain_buy_slip_custom:', '');
      ctx.session.step = 'awaiting_chain_buy_slip';
      ctx.session.chainSettingsTarget = chain;
      await ctx.editMessageText(
        `*CUSTOM BUY SLIPPAGE - ${chain.toUpperCase()}*\n\n` +
          `Enter a slippage percentage (0.1 - 50):\n\n` +
          `_Example: 7.5 for 7.5%_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (data.startsWith('chain_sell_slip_custom:')) {
      const chain = data.replace('chain_sell_slip_custom:', '');
      ctx.session.step = 'awaiting_chain_sell_slip';
      ctx.session.chainSettingsTarget = chain;
      await ctx.editMessageText(
        `*CUSTOM SELL SLIPPAGE - ${chain.toUpperCase()}*\n\n` +
          `Enter a slippage percentage (0.1 - 50):\n\n` +
          `_Example: 7.5 for 7.5%_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (data.startsWith('chain_gas_custom:')) {
      const chain = data.replace('chain_gas_custom:', '');
      ctx.session.step = 'awaiting_chain_gas';
      ctx.session.chainSettingsTarget = chain;
      await ctx.editMessageText(
        `*CUSTOM GAS PRICE - ${chain.toUpperCase()}*\n\n` +
          `Enter gas price in gwei:\n\n` +
          `_Example: 25 for 25 gwei_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (data.startsWith('chain_priority_custom:')) {
      const chain = data.replace('chain_priority_custom:', '');
      ctx.session.step = 'awaiting_chain_priority';
      ctx.session.chainSettingsTarget = chain;
      await ctx.editMessageText(
        `*CUSTOM PRIORITY FEE - SOLANA*\n\n` +
          `Enter priority fee in SOL:\n\n` +
          `_Example: 0.0002 for 0.0002 SOL_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Legacy: Keep old manual settings handlers for backwards compatibility
    // ============================================
    // v3.3 FIX (Issue 2): MANUAL SETTINGS HANDLERS (LEGACY)
    // ============================================

    // Slippage selection menu
    if (data === 'manual_slippage_menu') {
      const { getOrCreateManualSettings } = await import('@raptor/shared');
      const settings = await getOrCreateManualSettings(user.id);
      const currentBps = settings.default_slippage_bps;

      const message =
        `*SLIPPAGE SETTINGS*\n\n` +
        `Current: ${(currentBps / 100).toFixed(1)}%\n\n` +
        `_Higher slippage = more likely to execute_\n` +
        `_Lower slippage = better price or fail_`;

      const keyboard = new InlineKeyboard()
        .text(currentBps === 100 ? '> 1%' : '1%', 'manual_slippage:100')
        .text(currentBps === 300 ? '> 3%' : '3%', 'manual_slippage:300')
        .text(currentBps === 500 ? '> 5%' : '5%', 'manual_slippage:500')
        .row()
        .text(currentBps === 1000 ? '> 10%' : '10%', 'manual_slippage:1000')
        .text(currentBps === 1500 ? '> 15%' : '15%', 'manual_slippage:1500')
        .text(currentBps === 2000 ? '> 20%' : '20%', 'manual_slippage:2000')
        .row()
        .text('Custom', 'manual_slippage_custom')
        .row()
        .text('Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Handle slippage preset selection
    if (data.startsWith('manual_slippage:')) {
      const bps = parseInt(data.replace('manual_slippage:', ''));
      if (isNaN(bps)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const { updateManualSettings, getOrCreateManualSettings } = await import('@raptor/shared');

      await updateManualSettings({ userId: user.id, slippageBps: bps });

      await ctx.answerCallbackQuery({ text: `Slippage set to ${(bps / 100).toFixed(1)}%` });

      // Refresh the menu
      const settings = await getOrCreateManualSettings(user.id);
      const currentBps = settings.default_slippage_bps;

      const message =
        `*SLIPPAGE SETTINGS*\n\n` +
        `Current: ${(currentBps / 100).toFixed(1)}%\n\n` +
        `_Higher slippage = more likely to execute_\n` +
        `_Lower slippage = better price or fail_`;

      const keyboard = new InlineKeyboard()
        .text(currentBps === 100 ? '> 1%' : '1%', 'manual_slippage:100')
        .text(currentBps === 300 ? '> 3%' : '3%', 'manual_slippage:300')
        .text(currentBps === 500 ? '> 5%' : '5%', 'manual_slippage:500')
        .row()
        .text(currentBps === 1000 ? '> 10%' : '10%', 'manual_slippage:1000')
        .text(currentBps === 1500 ? '> 15%' : '15%', 'manual_slippage:1500')
        .text(currentBps === 2000 ? '> 20%' : '20%', 'manual_slippage:2000')
        .row()
        .text('Custom', 'manual_slippage_custom')
        .row()
        .text('Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Custom slippage input
    if (data === 'manual_slippage_custom') {
      ctx.session.step = 'awaiting_manual_slippage';
      await ctx.editMessageText(
        `*CUSTOM SLIPPAGE*\n\n` +
        `Enter slippage percentage (0.1 - 50):\n\n` +
        `_Example: 7.5 for 7.5%_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Priority selection menu
    if (data === 'manual_priority_menu') {
      const { getOrCreateManualSettings } = await import('@raptor/shared');
      const settings = await getOrCreateManualSettings(user.id);
      const currentPriority = settings.default_priority_sol;

      const message =
        `*PRIORITY FEE SETTINGS*\n\n` +
        `Current: ${currentPriority} SOL\n\n` +
        `_Higher priority = faster execution_\n` +
        `_Lower priority = lower cost_`;

      const keyboard = new InlineKeyboard()
        .text(currentPriority === 0.00005 ? '> 0.00005' : '0.00005', 'manual_priority:0.00005')
        .text(currentPriority === 0.0001 ? '> 0.0001' : '0.0001', 'manual_priority:0.0001')
        .row()
        .text(currentPriority === 0.0005 ? '> 0.0005' : '0.0005', 'manual_priority:0.0005')
        .text(currentPriority === 0.001 ? '> 0.001' : '0.001', 'manual_priority:0.001')
        .row()
        .text(currentPriority === 0.005 ? '> 0.005' : '0.005', 'manual_priority:0.005')
        .text(currentPriority === 0.01 ? '> 0.01' : '0.01', 'manual_priority:0.01')
        .row()
        .text('Custom', 'manual_priority_custom')
        .row()
        .text('Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Handle priority preset selection
    if (data.startsWith('manual_priority:')) {
      const priority = parseFloat(data.replace('manual_priority:', ''));
      if (isNaN(priority)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const { updateManualSettings, getOrCreateManualSettings } = await import('@raptor/shared');

      await updateManualSettings({ userId: user.id, prioritySol: priority });

      await ctx.answerCallbackQuery({ text: `Priority set to ${priority} SOL` });

      // Refresh menu
      const settings = await getOrCreateManualSettings(user.id);
      const currentPriority = settings.default_priority_sol;

      const message =
        `*PRIORITY FEE SETTINGS*\n\n` +
        `Current: ${currentPriority} SOL\n\n` +
        `_Higher priority = faster execution_\n` +
        `_Lower priority = lower cost_`;

      const keyboard = new InlineKeyboard()
        .text(currentPriority === 0.00005 ? '> 0.00005' : '0.00005', 'manual_priority:0.00005')
        .text(currentPriority === 0.0001 ? '> 0.0001' : '0.0001', 'manual_priority:0.0001')
        .row()
        .text(currentPriority === 0.0005 ? '> 0.0005' : '0.0005', 'manual_priority:0.0005')
        .text(currentPriority === 0.001 ? '> 0.001' : '0.001', 'manual_priority:0.001')
        .row()
        .text(currentPriority === 0.005 ? '> 0.005' : '0.005', 'manual_priority:0.005')
        .text(currentPriority === 0.01 ? '> 0.01' : '0.01', 'manual_priority:0.01')
        .row()
        .text('Custom', 'manual_priority_custom')
        .row()
        .text('Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Custom priority input
    if (data === 'manual_priority_custom') {
      ctx.session.step = 'awaiting_manual_priority';
      await ctx.editMessageText(
        `*CUSTOM PRIORITY*\n\n` +
        `Enter priority fee in SOL (0.00001 - 0.1):\n\n` +
        `_Example: 0.0025_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Quick buy amounts menu
    if (data === 'manual_buyamts_menu') {
      const { getOrCreateManualSettings } = await import('@raptor/shared');
      const settings = await getOrCreateManualSettings(user.id);
      const amounts = settings.quick_buy_amounts as number[];

      const message =
        `*QUICK BUY AMOUNTS*\n\n` +
        `Current buttons: ${amounts.map(a => `${a} SOL`).join(', ')}\n\n` +
        `_These appear on the token buy panel._`;

      const keyboard = new InlineKeyboard()
        .text('Reset to Default', 'manual_buyamts_reset')
        .row()
        .text('Customize', 'manual_buyamts_custom')
        .row()
        .text('Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Reset buy amounts to default
    if (data === 'manual_buyamts_reset') {
      const { updateManualSettings } = await import('@raptor/shared');
      await updateManualSettings({ userId: user.id, quickBuyAmounts: [0.1, 0.25, 0.5, 1, 2] });
      await ctx.answerCallbackQuery({ text: 'Reset to default amounts' });

      // Show updated menu
      const message =
        `*QUICK BUY AMOUNTS*\n\n` +
        `Current buttons: 0.1 SOL, 0.25 SOL, 0.5 SOL, 1 SOL, 2 SOL\n\n` +
        `_These appear on the token buy panel._`;

      const keyboard = new InlineKeyboard()
        .text('Reset to Default', 'manual_buyamts_reset')
        .row()
        .text('Customize', 'manual_buyamts_custom')
        .row()
        .text('Back', 'settings_manual');

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Custom buy amounts input
    if (data === 'manual_buyamts_custom') {
      ctx.session.step = 'awaiting_manual_buyamts';
      await ctx.editMessageText(
        `*CUSTOM BUY AMOUNTS*\n\n` +
        `Enter 5 amounts separated by commas:\n\n` +
        `_Example: 0.05, 0.1, 0.25, 0.5, 1_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // === STRATEGY CALLBACKS ===
    // View strategy detail
    if (data.startsWith('strategy_view_')) {
      const strategy = data.replace('strategy_view_', '') as TradingStrategy;
      await showStrategyDetail(ctx, strategy);
      return;
    }

    // Set strategy
    if (data.startsWith('strategy_set_')) {
      const strategy = data.replace('strategy_set_', '') as TradingStrategy;
      await setStrategy(ctx, strategy);
      return;
    }

    // Custom strategy page navigation
    if (data === 'custom_page_1') {
      await showCustomStrategyPage1(ctx);
      return;
    }
    if (data === 'custom_page_2') {
      await showCustomStrategyPage2(ctx);
      return;
    }
    if (data === 'custom_page_3') {
      await showCustomStrategyPage3(ctx);
      return;
    }
    if (data === 'custom_page_4') {
      await showCustomStrategyPage4(ctx);
      return;
    }
    if (data === 'custom_page_5') {
      await showCustomStrategyPage5(ctx);
      return;
    }

    // Custom strategy toggles
    if (data === 'custom_toggle_trailing') {
      await toggleCustomTrailing(ctx);
      return;
    }
    if (data === 'custom_toggle_dca') {
      await toggleCustomDca(ctx);
      return;
    }
    if (data === 'custom_toggle_antirug') {
      await toggleCustomAntiRug(ctx);
      return;
    }
    if (data === 'custom_toggle_antimev') {
      await toggleCustomAntiMev(ctx);
      return;
    }
    if (data === 'custom_toggle_autoapprove') {
      await toggleCustomAutoApprove(ctx);
      return;
    }
    if (data === 'custom_toggle_retry') {
      await toggleCustomRetry(ctx);
      return;
    }

    // Custom strategy setters - show selection screens
    if (data === 'custom_set_tp') {
      await showTpSelection(ctx);
      return;
    }
    if (data === 'custom_set_sl') {
      await showSlSelection(ctx);
      return;
    }
    if (data === 'custom_set_maxhold') {
      await showMaxHoldSelection(ctx);
      return;
    }
    if (data === 'custom_set_moonbag') {
      await showMoonBagSelection(ctx);
      return;
    }
    if (data === 'custom_set_slippage') {
      await showCustomSlippageSelection(ctx);
      return;
    }
    if (data === 'custom_set_gas') {
      await showCustomGasSelection(ctx);
      return;
    }
    if (data === 'custom_set_liquidity') {
      await showLiquiditySelection(ctx);
      return;
    }
    if (data === 'custom_set_mcap') {
      await showMcapSelection(ctx);
      return;
    }
    if (data === 'custom_set_minscore') {
      await showMinScoreSelection(ctx);
      return;
    }
    if (data === 'custom_set_taxes') {
      await showTaxSelection(ctx);
      return;
    }

    // Custom strategy value setters - TP
    if (data.startsWith('custom_tp_')) {
      const value = data.replace('custom_tp_', '');
      if (value === 'input') {
        await requestCustomInput(ctx, 'tp');
      } else {
        const parsed = parseInt(value);
        if (isNaN(parsed)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }
        await setCustomTp(ctx, parsed);
      }
      return;
    }

    // Custom strategy value setters - SL
    if (data.startsWith('custom_sl_')) {
      const value = data.replace('custom_sl_', '');
      if (value === 'input') {
        await requestCustomInput(ctx, 'sl');
      } else {
        const parsed = parseInt(value);
        if (isNaN(parsed)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }
        await setCustomSl(ctx, parsed);
      }
      return;
    }

    // Custom strategy value setters - Max Hold
    if (data.startsWith('custom_hold_')) {
      const value = data.replace('custom_hold_', '');
      if (value === 'input') {
        await requestCustomInput(ctx, 'maxhold');
      } else {
        const parsed = parseInt(value);
        if (isNaN(parsed)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }
        await setCustomHold(ctx, parsed);
      }
      return;
    }

    // Custom strategy value setters - Moon Bag
    if (data.startsWith('custom_moon_')) {
      const value = parseInt(data.replace('custom_moon_', ''));
      if (isNaN(value)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setCustomMoonBag(ctx, value);
      return;
    }

    // Custom strategy value setters - Slippage
    if (data.startsWith('custom_slip_')) {
      const value = parseInt(data.replace('custom_slip_', ''));
      if (isNaN(value)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setCustomSlippage(ctx, value);
      return;
    }

    // Custom strategy value setters - Gas Priority
    if (data.startsWith('custom_gas_')) {
      const priority = data.replace('custom_gas_', '') as 'low' | 'medium' | 'high' | 'turbo';
      await setCustomGas(ctx, priority);
      return;
    }

    // Custom strategy value setters - Liquidity
    if (data.startsWith('custom_liq_')) {
      const value = parseInt(data.replace('custom_liq_', ''));
      if (isNaN(value)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setCustomLiquidity(ctx, value);
      return;
    }

    // Custom strategy value setters - Market Cap
    if (data.startsWith('custom_mcap_')) {
      const value = parseInt(data.replace('custom_mcap_', ''));
      if (isNaN(value)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setCustomMcap(ctx, value);
      return;
    }

    // Custom strategy value setters - Min Score
    if (data.startsWith('custom_score_')) {
      const value = parseInt(data.replace('custom_score_', ''));
      if (isNaN(value)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setCustomMinScore(ctx, value);
      return;
    }

    // Custom strategy value setters - Max Tax
    if (data.startsWith('custom_tax_')) {
      const value = parseInt(data.replace('custom_tax_', ''));
      if (isNaN(value)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setCustomTax(ctx, value);
      return;
    }

    // Custom strategy save/reset
    if (data === 'custom_save') {
      await saveCustomStrategy(ctx);
      return;
    }
    if (data === 'custom_reset') {
      await resetCustomStrategy(ctx);
      return;
    }

    // Legacy custom TP/SL (redirects to page 1)
    if (data === 'strategy_custom') {
      await showCustomStrategyPage1(ctx);
      return;
    }

    // === GAS CALLBACKS ===
    // Chain gas settings
    if (data.startsWith('gas_chain_')) {
      const chain = data.replace('gas_chain_', '') as Chain;
      await showChainGas(ctx, chain);
      return;
    }

    // Toggle auto-tip
    if (data.startsWith('gas_toggle_')) {
      const chain = data.replace('gas_toggle_', '') as Chain;
      await toggleAutoTip(ctx, chain);
      return;
    }

    // Speed selection menu
    if (data.startsWith('gas_speed_') && !data.includes('_set_')) {
      const chain = data.replace('gas_speed_', '') as Chain;
      await showSpeedSelection(ctx, chain);
      return;
    }

    // Set tip speed
    if (data.startsWith('gas_speed_set_')) {
      const parts = data.replace('gas_speed_set_', '').split('_');
      if (parts.length === 2) {
        const [chain, speed] = parts;
        await setTipSpeed(ctx, chain as Chain, speed as 'slow' | 'normal' | 'fast' | 'turbo');
        return;
      }
      return;
    }

    // Max tip selection menu
    if (data.startsWith('gas_max_') && !data.includes('_set_')) {
      const chain = data.replace('gas_max_', '') as Chain;
      await showMaxTipSelection(ctx, chain);
      return;
    }

    // Set max tip
    if (data.startsWith('gas_max_set_')) {
      const parts = data.replace('gas_max_set_', '').split('_');
      if (parts.length === 2) {
        const [chain, maxStr] = parts;
        const maxTip = parseFloat(maxStr);
        if (isNaN(maxTip)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }
        await setMaxTip(ctx, chain as Chain, maxTip);
        return;
      }
      return;
    }

    // === SLIPPAGE CALLBACKS ===
    // Chain slippage settings
    if (data.startsWith('slip_chain_')) {
      const chain = data.replace('slip_chain_', '') as Chain;
      await showChainSlippage(ctx, chain);
      return;
    }

    // Toggle auto-slippage
    if (data.startsWith('slip_toggle_')) {
      const chain = data.replace('slip_toggle_', '') as Chain;
      await toggleAutoSlippage(ctx, chain);
      return;
    }

    // Slippage value selection menu
    if (data.startsWith('slip_value_')) {
      const chain = data.replace('slip_value_', '') as Chain;
      await showSlippageSelection(ctx, chain);
      return;
    }

    // Set slippage
    if (data.startsWith('slip_set_')) {
      const parts = data.replace('slip_set_', '').split('_');
      if (parts.length === 2) {
        const [chain, bpsStr] = parts;
        const bps = parseInt(bpsStr);
        if (isNaN(bps)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }
        await setSlippage(ctx, chain as Chain, bps);
        return;
      }
      return;
    }

    // === POSITION SIZE CALLBACKS ===
    if (data.startsWith('size_set_')) {
      const percent = parseInt(data.replace('size_set_', ''));
      if (isNaN(percent)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setPositionSize(ctx, percent);
      return;
    }

    // === CHAIN TOGGLE CALLBACKS ===
    if (data.startsWith('chain_toggle_')) {
      const chain = data.replace('chain_toggle_', '') as Chain;
      await toggleChainEnabled(ctx, chain);
      return;
    }

    // === NOTIFICATION CALLBACKS ===
    if (data.startsWith('notif_toggle_')) {
      const type = data.replace('notif_toggle_', '');
      await toggleNotification(ctx, type);
      return;
    }

    // === SNIPE CALLBACKS ===
    if (data === 'snipe_confirm') {
      await handleSnipeConfirm(ctx);
      return;
    }

    if (data === 'snipe_cancel') {
      await handleSnipeCancel(ctx);
      return;
    }

    if (data.startsWith('snipe_adjust_')) {
      const adjustment = data.replace('snipe_adjust_', '');
      await handleSnipeAdjust(ctx, adjustment);
      return;
    }

    if (data.startsWith('snipe_force_')) {
      // Force snipe with hard stops - same as confirm but with warning
      await handleSnipeConfirm(ctx);
      return;
    }

    // === SCORE CALLBACKS ===
    if (data.startsWith('score_')) {
      const tokenAddress = data.replace('score_', '');
      await handleScoreRequest(ctx, tokenAddress);
      return;
    }

    // === WALLET CALLBACKS (Legacy) ===
    if (data === 'wallet_deposit') {
      // Legacy - redirect to new wallet list
      await showWallets(ctx);
      return;
    }

    if (data === 'wallet_withdraw') {
      // Legacy - redirect to new wallet list
      await showWallets(ctx);
      return;
    }

    if (data === 'wallet_balances') {
      // Legacy - redirect to new wallet list
      await showWallets(ctx);
      return;
    }

    if (data === 'wallet_history') {
      await showHistory(ctx, 1);
      return;
    }

    // === HUNT CALLBACKS ===
    // Browse new launches
    if (data === 'hunt_new') {
      await showOpportunities(ctx, 'new');
      return;
    }

    // Browse trending tokens
    if (data === 'hunt_trending') {
      await showOpportunities(ctx, 'trending');
      return;
    }

    // Chain selection for hunt (hunt_chain_sol, etc.)
    if (data.startsWith('hunt_chain_')) {
      const chain = data.replace('hunt_chain_', '') as Chain;
      await showChainHunt(ctx, chain);
      return;
    }

    // Start/pause hunt (hunt_start_sol, hunt_pause_sol)
    if (data.startsWith('hunt_start_')) {
      const chain = data.replace('hunt_start_', '') as Chain;
      await toggleHunt(ctx, chain, true);
      return;
    }

    if (data.startsWith('hunt_pause_')) {
      const chain = data.replace('hunt_pause_', '') as Chain;
      await toggleHunt(ctx, chain, false);
      return;
    }

    // Min score selection (hunt_score_sol)
    if (data.startsWith('hunt_score_') && !data.includes('_set_')) {
      const chain = data.replace('hunt_score_', '') as Chain;
      await showScoreSelection(ctx, chain);
      return;
    }

    // Set min score (hunt_score_set_sol_23)
    if (data.startsWith('hunt_score_set_')) {
      const parts = data.replace('hunt_score_set_', '').split('_');
      if (parts.length === 2) {
        const [chain, scoreStr] = parts;
        const score = parseInt(scoreStr);
        if (isNaN(score)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }
        await setMinScore(ctx, chain as Chain, score);
        return;
      }
      return;
    }

    // Position size selection (hunt_size_sol)
    if (data.startsWith('hunt_size_') && !data.includes('_set_')) {
      const chain = data.replace('hunt_size_', '') as Chain;
      await showSizeSelection(ctx, chain);
      return;
    }

    // Set position size (hunt_size_set_sol_0.5)
    if (data.startsWith('hunt_size_set_')) {
      const parts = data.replace('hunt_size_set_', '').split('_');
      if (parts.length === 2) {
        const [chain, size] = parts;
        await setHuntPositionSize(ctx, chain as Chain, size);
        return;
      }
      return;
    }

    // Launchpad selection (hunt_launchpads_sol)
    if (data.startsWith('hunt_launchpads_')) {
      const chain = data.replace('hunt_launchpads_', '') as Chain;
      await showLaunchpadSelection(ctx, chain);
      return;
    }

    // Toggle launchpad (hunt_lp_toggle_sol_pump.fun)
    if (data.startsWith('hunt_lp_toggle_')) {
      const rest = data.replace('hunt_lp_toggle_', '');
      const underscoreIdx = rest.indexOf('_');
      if (underscoreIdx > 0) {
        const chain = rest.substring(0, underscoreIdx) as Chain;
        const launchpad = rest.substring(underscoreIdx + 1);
        await toggleLaunchpad(ctx, chain, launchpad);
        return;
      }
      return;
    }

    // Enable all launchpads (hunt_lp_all_sol)
    if (data.startsWith('hunt_lp_all_')) {
      const chain = data.replace('hunt_lp_all_', '') as Chain;
      await enableAllLaunchpads(ctx, chain);
      return;
    }

    // Disable all launchpads (hunt_lp_none_sol)
    if (data.startsWith('hunt_lp_none_')) {
      const chain = data.replace('hunt_lp_none_', '') as Chain;
      await disableAllLaunchpads(ctx, chain);
      return;
    }

    // v4.2: Hunt slippage (hunt_slippage_sol)
    if (data.startsWith('hunt_slippage_')) {
      const chain = data.replace('hunt_slippage_', '') as Chain;
      await showHuntSlippage(ctx, chain);
      return;
    }

    // v4.2: Set hunt slippage (hunt_slip_set_sol_1500)
    if (data.startsWith('hunt_slip_set_')) {
      const rest = data.replace('hunt_slip_set_', '');
      const underscoreIdx = rest.indexOf('_');
      if (underscoreIdx > 0) {
        const chain = rest.substring(0, underscoreIdx) as Chain;
        const bps = parseInt(rest.substring(underscoreIdx + 1));
        if (!isNaN(bps)) {
          await setHuntSlippage(ctx, chain, bps);
        }
      }
      return;
    }

    // v4.2: Hunt priority (hunt_priority_sol)
    if (data.startsWith('hunt_priority_')) {
      const chain = data.replace('hunt_priority_', '') as Chain;
      await showHuntPriority(ctx, chain);
      return;
    }

    // v4.2: Set hunt priority (hunt_prio_set_sol_0.001)
    if (data.startsWith('hunt_prio_set_')) {
      const rest = data.replace('hunt_prio_set_', '');
      const underscoreIdx = rest.indexOf('_');
      if (underscoreIdx > 0) {
        const chain = rest.substring(0, underscoreIdx) as Chain;
        const sol = parseFloat(rest.substring(underscoreIdx + 1));
        if (!isNaN(sol)) {
          await setHuntPriority(ctx, chain, sol);
        }
      }
      return;
    }

    // v4.3: Show snipe mode selection (hunt_snipe_sol)
    if (data.startsWith('hunt_snipe_') && !data.includes('_set_')) {
      const chain = data.replace('hunt_snipe_', '') as Chain;
      await showSnipeMode(ctx, chain);
      return;
    }

    // v4.3: Set snipe mode (hunt_snipe_set_sol_balanced)
    if (data.startsWith('hunt_snipe_set_')) {
      const rest = data.replace('hunt_snipe_set_', '');
      const underscoreIdx = rest.indexOf('_');
      if (underscoreIdx > 0) {
        const chain = rest.substring(0, underscoreIdx) as Chain;
        const mode = rest.substring(underscoreIdx + 1) as 'speed' | 'balanced' | 'quality';
        if (['speed', 'balanced', 'quality'].includes(mode)) {
          await setSnipeMode(ctx, chain, mode);
        }
      }
      return;
    }

    // v5.0: Show take profit selection (hunt_tp_sol)
    if (data.startsWith('hunt_tp_') && !data.includes('_set_')) {
      const chain = data.replace('hunt_tp_', '') as Chain;
      await showHuntTpSelection(ctx, chain);
      return;
    }

    // v5.0: Set take profit (hunt_tp_set_sol_50)
    if (data.startsWith('hunt_tp_set_')) {
      const rest = data.replace('hunt_tp_set_', '');
      const underscoreIdx = rest.indexOf('_');
      if (underscoreIdx > 0) {
        const chain = rest.substring(0, underscoreIdx) as Chain;
        const tp = parseInt(rest.substring(underscoreIdx + 1));
        if (!isNaN(tp)) {
          await setHuntTakeProfit(ctx, chain, tp);
        }
      }
      return;
    }

    // v5.0: Show stop loss selection (hunt_sl_sol)
    if (data.startsWith('hunt_sl_') && !data.includes('_set_')) {
      const chain = data.replace('hunt_sl_', '') as Chain;
      await showHuntSlSelection(ctx, chain);
      return;
    }

    // v5.0: Set stop loss (hunt_sl_set_sol_30)
    if (data.startsWith('hunt_sl_set_')) {
      const rest = data.replace('hunt_sl_set_', '');
      const underscoreIdx = rest.indexOf('_');
      if (underscoreIdx > 0) {
        const chain = rest.substring(0, underscoreIdx) as Chain;
        const sl = parseInt(rest.substring(underscoreIdx + 1));
        if (!isNaN(sl)) {
          await setHuntStopLoss(ctx, chain, sl);
        }
      }
      return;
    }

    // === POSITION CALLBACKS ===
    // View position (pos_view_123)
    if (data.startsWith('pos_view_')) {
      const positionId = parseInt(data.replace('pos_view_', ''));
      if (isNaN(positionId)) {
        await ctx.answerCallbackQuery({ text: 'Invalid position' });
        return;
      }
      await showPositionDetail(ctx, positionId);
      return;
    }

    // Sell position (pos_123_sell_25, etc.)
    // v5.0: Updated to use working sell execution instead of legacy stub
    if (data.match(/^pos_\d+_sell_\d+$/)) {
      const parts = data.split('_');
      const positionId = parseInt(parts[1]);
      const percent = parseInt(parts[3]);
      if (isNaN(positionId) || isNaN(percent)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }

      // Get position to extract mint address
      const { getPosition } = await import('@raptor/shared');
      const position = await getPosition(positionId);

      if (!position) {
        await ctx.answerCallbackQuery({ text: 'Position not found', show_alert: true });
        return;
      }

      // Use the working sell execution flow
      await handleSellPctFromMonitor(ctx, position.token_address, percent, (position.chain || 'sol') as Chain);
      return;
    }

    // Edit position TP/SL (pos_123_edit)
    if (data.match(/^pos_\d+_edit$/)) {
      const positionId = parseInt(data.replace('pos_', '').replace('_edit', ''));
      if (isNaN(positionId)) {
        await ctx.answerCallbackQuery({ text: 'Invalid position' });
        return;
      }
      await showEditTpSl(ctx, positionId);
      return;
    }

    // Back to positions
    if (data === 'back_to_positions') {
      await showPositionsList(ctx);
      return;
    }

    // Refresh positions list (from /positions command)
    if (data === 'refresh_positions') {
      await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });
      // Import and call positionsCommand to refresh
      const { positionsCommand } = await import('../commands/positions.js');
      await positionsCommand(ctx);
      return;
    }

    // Set TP for position (set_tp_123_50)
    if (data.match(/^set_tp_\d+_\d+$/)) {
      const parts = data.split('_');
      const positionId = parseInt(parts[2]);
      const tp = parseInt(parts[3]);
      if (isNaN(positionId) || isNaN(tp)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setPositionTp(ctx, positionId, tp);
      return;
    }

    // Set SL for position (set_sl_123_30)
    if (data.match(/^set_sl_\d+_\d+$/)) {
      const parts = data.split('_');
      const positionId = parseInt(parts[2]);
      const sl = parseInt(parts[3]);
      if (isNaN(positionId) || isNaN(sl)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      await setPositionSl(ctx, positionId, sl);
      return;
    }

    // === TOKEN BUY/SELL CALLBACKS ===
    // Buy token (buy_sol_<address>_0.1, etc.)
    if (data.startsWith('buy_')) {
      const parts = data.replace('buy_', '').split('_');
      if (parts.length >= 3) {
        const chain = parts[0] as Chain;
        const tokenAddress = parts[1];
        const amount = parts[2];
        await handleBuyToken(ctx, chain, tokenAddress, amount);
        return;
      }
    }

    // Analyze token (analyze_sol_<address>, etc.)
    if (data.startsWith('analyze_')) {
      const parts = data.replace('analyze_', '').split('_');
      if (parts.length >= 2) {
        const chain = parts[0] as Chain;
        const tokenAddress = parts[1];
        await handleAnalyzeToken(ctx, chain, tokenAddress);
        return;
      }
    }

    // Refresh token (refresh_sol_<address>, etc.)
    if (data.startsWith('refresh_')) {
      const parts = data.replace('refresh_', '').split('_');
      if (parts.length >= 2) {
        const chain = parts[0] as Chain;
        const tokenAddress = parts[1];
        await ctx.answerCallbackQuery({ text: 'Refreshing...' });
        // TODO: Refresh token card
        return;
      }
    }

    // === LEGACY CALLBACKS (backward compatibility) ===
    // Sell position callbacks (sell:<positionId>:<percent>)
    // v5.0: Updated to use working sell execution
    if (data.startsWith('sell:')) {
      const [, positionIdStr, percentStr] = data.split(':');
      const positionId = parseInt(positionIdStr, 10);
      const percent = parseInt(percentStr, 10);
      if (isNaN(positionId) || isNaN(percent)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }

      // Get position to extract mint address
      const { getPosition } = await import('@raptor/shared');
      const position = await getPosition(positionId);

      if (!position) {
        await ctx.answerCallbackQuery({ text: 'Position not found', show_alert: true });
        return;
      }

      // Use the working sell execution flow
      await handleSellPctFromMonitor(ctx, position.token_address, percent, (position.chain || 'sol') as Chain);
      return;
    }

    // Confirm sell callback - v5.0: No longer used, kept for safety
    if (data.startsWith('confirm_sell:')) {
      await ctx.answerCallbackQuery({ text: 'Please use the sell panel' });
      return;
    }

    // Cancel sell - v5.0: Just dismiss
    if (data === 'cancel_sell') {
      await ctx.answerCallbackQuery({ text: 'Cancelled' });
      try {
        await ctx.editMessageText('❌ Sell cancelled.');
      } catch {
        // Message may be deleted
      }
      return;
    }

    // === TRADE MONITOR CALLBACKS ===

    // Copy CA button (copy_ca:<mint>)
    if (data.startsWith('copy_ca:')) {
      const mint = data.replace('copy_ca:', '');
      await ctx.answerCallbackQuery({ text: `📋 ${mint}`, show_alert: true });
      return;
    }

    // Refresh monitor (refresh_monitor:<monitorId>)
    if (data.startsWith('refresh_monitor:')) {
      const monitorId = parseInt(data.replace('refresh_monitor:', ''));
      if (isNaN(monitorId)) {
        await ctx.answerCallbackQuery({ text: 'Invalid monitor' });
        return;
      }
      await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });

      try {
        const monitor = await handleManualRefresh(ctx.api, monitorId, solanaExecutor);
        if (monitor) {
          await ctx.answerCallbackQuery({ text: '✅ Refreshed!' });
        } else {
          await ctx.answerCallbackQuery({ text: '❌ Monitor not found' });
        }
      } catch (error) {
        console.error('[Callbacks] Refresh monitor error:', error);
        await ctx.answerCallbackQuery({ text: '❌ Refresh failed' });
      }
      return;
    }

    // Open sell panel (open_sell:<mint> or open_sell:<chain>_<mint>) - from monitor
    // v3.5: Now supports chain prefix in callback data
    if (data.startsWith('open_sell:')) {
      const payload = data.replace('open_sell:', '');
      let chain: Chain = 'sol';
      let mint: string;

      // v3.5: Check if chain is included (new format: chain_mint)
      if (payload.includes('_') && ['sol', 'eth', 'base', 'bsc'].includes(payload.split('_')[0])) {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_');
      } else {
        mint = payload;
      }

      await ctx.answerCallbackQuery({ text: '💰 Opening sell panel...' });

      try {
        await openSellPanel(
          ctx.api,
          user.id,
          ctx.chat!.id,
          ctx.callbackQuery?.message?.message_id || 0,
          mint,
          solanaExecutor,
          undefined,
          undefined,
          chain  // v3.5: Pass chain override
        );
      } catch (error) {
        console.error('[Callbacks] Open sell panel error:', error);
        await ctx.reply('❌ Failed to open sell panel');
      }
      return;
    }

    // Open sell panel directly from token card (open_sell_direct:<mint> or open_sell_direct:<chain>_<mint>)
    // v3.2: Opens sell as a NEW message (doesn't edit token card)
    // v3.5: Now supports chain prefix in callback data
    if (data.startsWith('open_sell_direct:')) {
      const payload = data.replace('open_sell_direct:', '');
      let chain: Chain = 'sol';
      let mint: string;

      // v3.5: Check if chain is included (new format: chain_mint)
      if (payload.includes('_') && ['sol', 'eth', 'base', 'bsc'].includes(payload.split('_')[0])) {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_');
      } else {
        mint = payload;
      }

      await ctx.answerCallbackQuery({ text: '💰 Opening sell panel...' });

      try {
        // Create a new sell panel message instead of editing
        const { openSellPanelNew } = await import('../services/tradeMonitor.js');
        await openSellPanelNew(
          ctx.api,
          user.id,
          ctx.chat!.id,
          mint,
          solanaExecutor,
          undefined,
          undefined,
          chain  // v3.5: Pass chain
        );
      } catch (error) {
        console.error('[Callbacks] Open sell direct error:', error);
        await ctx.reply('❌ Failed to open sell panel');
      }
      return;
    }

    // View monitor (view_monitor:<mint>) - go back from sell panel
    // v3.2 FIX: Uses resetToMonitorView to properly reset view state
    if (data.startsWith('view_monitor:')) {
      const mint = data.replace('view_monitor:', '');
      await ctx.answerCallbackQuery();

      try {
        // Use the new function that resets view state
        const success = await resetToMonitorView(
          ctx.api,
          user.id,
          ctx.chat!.id,
          ctx.callbackQuery?.message?.message_id || 0,
          mint
        );
        
        if (!success) {
          await ctx.reply('Monitor not found. Position may have been closed.');
        }
      } catch (error) {
        console.error('[Callbacks] View monitor error:', error);
      }
      return;
    }

    // Sell percentage (sell_pct:<mint>:<percent> or sell_pct:<chain>_<mint>:<percent>)
    // v3.5: Now supports chain prefix in callback data
    if (data.startsWith('sell_pct:')) {
      const parts = data.replace('sell_pct:', '').split(':');
      if (parts.length === 2) {
        let mintPart = parts[0];
        const percentStr = parts[1];
        const percent = parseInt(percentStr);
        if (isNaN(percent)) {
          await ctx.answerCallbackQuery({ text: 'Invalid value' });
          return;
        }

        // v3.5: Extract chain if present (new format: chain_mint)
        let chain: Chain = 'sol';
        let mint: string;
        if (mintPart.includes('_') && ['sol', 'eth', 'base', 'bsc'].includes(mintPart.split('_')[0])) {
          const mintParts = mintPart.split('_');
          chain = mintParts[0] as Chain;
          mint = mintParts.slice(1).join('_');
        } else {
          mint = mintPart;
        }

        await handleSellPctFromMonitor(ctx, mint, percent, chain);
        return;
      }
    }

    // Custom sell amount (sell_custom:<mint>:<type> or sell_custom:<chain>_<mint>:<type>)
    // v3.5: Now supports chain prefix in callback data
    if (data.startsWith('sell_custom:')) {
      const parts = data.replace('sell_custom:', '').split(':');
      if (parts.length === 2) {
        let mintPart = parts[0];
        const type = parts[1];

        // v3.5: Extract chain if present (new format: chain_mint)
        let chain: Chain = 'sol';
        let mint: string;
        if (mintPart.includes('_') && ['sol', 'eth', 'base', 'bsc'].includes(mintPart.split('_')[0])) {
          const mintParts = mintPart.split('_');
          chain = mintParts[0] as Chain;
          mint = mintParts.slice(1).join('_');
        } else {
          mint = mintPart;
        }

        // Store in session for next message
        ctx.session.step = type === 'tokens' ? 'awaiting_sell_tokens' : 'awaiting_sell_percent';
        ctx.session.pendingSellMint = mint;
        ctx.session.pendingSellChain = chain;  // v3.5: Store chain in session
        await ctx.answerCallbackQuery();
        await ctx.reply(
          type === 'tokens'
            ? 'Enter the number of tokens to sell:'
            : 'Enter the percentage to sell (1-100):'
        );
        return;
      }
    }

    // ============================================
    // v3.5: SELL PANEL SLIPPAGE/GWEI - Chain-aware
    // ============================================

    // Sell slippage adjustment - v3.5: Uses chain_settings
    // Format: sell_slippage:<chain>_<mint> or sell_slippage:<mint> (legacy, defaults to sol)
    if (data.startsWith('sell_slippage:')) {
      const payload = data.replace('sell_slippage:', '');
      let chain: Chain = 'sol';
      let mint: string;

      // Check if chain is included (new format)
      if (payload.includes('_') && ['sol', 'eth', 'base', 'bsc'].includes(payload.split('_')[0])) {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_');
      } else {
        mint = payload;
      }

      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);
      const currentBps = settings.sell_slippage_bps;
      const chainName = 'SOL';

      const message =
        `*SELL SLIPPAGE* | ${chainName}\n\n` +
        `Current: ${(currentBps / 100).toFixed(1)}%\n\n` +
        `Select slippage for sells:`;

      const keyboard = new InlineKeyboard()
        .text(currentBps === 100 ? '> 1%' : '1%', `set_sell_slip:${chain}_${mint}_100`)
        .text(currentBps === 300 ? '> 3%' : '3%', `set_sell_slip:${chain}_${mint}_300`)
        .text(currentBps === 500 ? '> 5%' : '5%', `set_sell_slip:${chain}_${mint}_500`)
        .row()
        .text(currentBps === 1000 ? '> 10%' : '10%', `set_sell_slip:${chain}_${mint}_1000`)
        .text(currentBps === 1500 ? '> 15%' : '15%', `set_sell_slip:${chain}_${mint}_1500`)
        .text(currentBps === 2000 ? '> 20%' : '20%', `set_sell_slip:${chain}_${mint}_2000`)
        .row()
        .text('« Back', `open_sell:${chain}_${mint}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set sell slippage - v3.5: Updates chain_settings
    if (data.startsWith('set_sell_slip:')) {
      const parts = data.replace('set_sell_slip:', '').split('_');
      const bps = parseInt(parts[parts.length - 1]);
      if (isNaN(bps)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const chain = parts[0] as Chain;
      const mint = parts.slice(1, -1).join('_');

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, sellSlippageBps: bps });

      await ctx.answerCallbackQuery({ text: `Sell slippage set to ${(bps / 100).toFixed(1)}%` });

      // v3.5: Return to sell panel with chain
      await openSellPanel(
        ctx.api,
        user.id,
        ctx.chat!.id,
        ctx.callbackQuery?.message?.message_id || 0,
        mint,
        solanaExecutor,
        undefined,
        undefined,
        chain
      );
      return;
    }

    // Sell priority/GWEI adjustment - v3.5: Chain-aware
    // Format: sell_priority:<chain>_<mint> or sell_priority:<mint> (legacy)
    if (data.startsWith('sell_priority:')) {
      const payload = data.replace('sell_priority:', '');
      let chain: Chain = 'sol';
      let mint: string;

      // Solana-only build - check if chain is included
      if (payload.includes('_') && payload.split('_')[0] === 'sol') {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_');
      } else {
        mint = payload;
      }

      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);

      // Solana: Show priority fee options
      const current = settings.priority_sol;
      const message =
        `*PRIORITY FEE* | SOL\n\n` +
        `Current: ${current ?? 0.0001} SOL\n\n` +
        `Select priority fee:`;

      const keyboard = new InlineKeyboard()
        .text(current === 0.00005 ? '> 0.00005' : '0.00005', `set_sell_prio:${chain}_${mint}_0.00005`)
        .text(current === 0.0001 ? '> 0.0001' : '0.0001', `set_sell_prio:${chain}_${mint}_0.0001`)
        .row()
        .text(current === 0.0005 ? '> 0.0005' : '0.0005', `set_sell_prio:${chain}_${mint}_0.0005`)
        .text(current === 0.001 ? '> 0.001' : '0.001', `set_sell_prio:${chain}_${mint}_0.001`)
        .row()
        .text(current === 0.005 ? '> 0.005' : '0.005', `set_sell_prio:${chain}_${mint}_0.005`)
        .text(current === 0.01 ? '> 0.01' : '0.01', `set_sell_prio:${chain}_${mint}_0.01`)
        .row()
        .text('« Back', `open_sell:${chain}_${mint}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set sell GWEI (EVM chains) - v3.5
    if (data.startsWith('set_sell_gwei:')) {
      const parts = data.replace('set_sell_gwei:', '').split('_');
      const gwei = parseFloat(parts[parts.length - 1]);
      if (isNaN(gwei)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const chain = parts[0] as Chain;
      const mint = parts.slice(1, -1).join('_');

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, gasGwei: gwei });

      await ctx.answerCallbackQuery({ text: `Gas set to ${gwei} GWEI` });

      // Return to sell panel
      await openSellPanel(
        ctx.api,
        user.id,
        ctx.chat!.id,
        ctx.callbackQuery?.message?.message_id || 0,
        mint,
        solanaExecutor,
        undefined,
        undefined,
        chain
      );
      return;
    }

    // Set sell priority (Solana) - v3.5: Updates chain_settings
    if (data.startsWith('set_sell_prio:')) {
      const parts = data.replace('set_sell_prio:', '').split('_');
      const priority = parseFloat(parts[parts.length - 1]);
      if (isNaN(priority)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const chain = parts[0] as Chain;
      const mint = parts.slice(1, -1).join('_');

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, prioritySol: priority });

      await ctx.answerCallbackQuery({ text: `Priority set to ${priority} SOL` });

      // Return to sell panel
      await openSellPanel(
        ctx.api,
        user.id,
        ctx.chat!.id,
        ctx.callbackQuery?.message?.message_id || 0,
        mint,
        solanaExecutor,
        undefined,
        undefined,
        chain
      );
      return;
    }

    // v3.4: Refresh sell panel - v3.5: Chain-aware
    if (data.startsWith('refresh_sell:')) {
      const payload = data.replace('refresh_sell:', '');
      let chain: Chain = 'sol';
      let mint: string;

      if (payload.includes('_') && ['sol', 'eth', 'base', 'bsc'].includes(payload.split('_')[0])) {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_');
      } else {
        mint = payload;
      }

      await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });

      await openSellPanel(
        ctx.api,
        user.id,
        ctx.chat!.id,
        ctx.callbackQuery?.message?.message_id || 0,
        mint,
        solanaExecutor,
        undefined,
        undefined,
        chain
      );
      return;
    }

    // ============================================
    // v3.3 FIX (Issue 4): BUY PANEL SLIPPAGE/PRIORITY
    // ============================================

    // Buy panel slippage adjustment - v3.5: Uses chain_settings
    if (data.startsWith('buy_slippage:')) {
      const parts = data.replace('buy_slippage:', '').split('_');
      const chain = parts[0] as Chain;
      const mint = parts.slice(1).join('_');

      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);
      const currentBps = settings.buy_slippage_bps;

      const chainName = 'SOL';

      const message =
        `*BUY SLIPPAGE* | ${chainName}\n\n` +
        `Current: ${(currentBps / 100).toFixed(1)}%\n\n` +
        `Select slippage for buys:`;

      const keyboard = new InlineKeyboard()
        .text(currentBps === 100 ? '> 1%' : '1%', `set_buy_slip:${chain}_${mint}_100`)
        .text(currentBps === 300 ? '> 3%' : '3%', `set_buy_slip:${chain}_${mint}_300`)
        .text(currentBps === 500 ? '> 5%' : '5%', `set_buy_slip:${chain}_${mint}_500`)
        .row()
        .text(currentBps === 1000 ? '> 10%' : '10%', `set_buy_slip:${chain}_${mint}_1000`)
        .text(currentBps === 1500 ? '> 15%' : '15%', `set_buy_slip:${chain}_${mint}_1500`)
        .text(currentBps === 2000 ? '> 20%' : '20%', `set_buy_slip:${chain}_${mint}_2000`)
        .row()
        .text('« Back to Token', `token:${chain}_${mint}`);

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set buy slippage - v3.5: Updates chain_settings
    if (data.startsWith('set_buy_slip:')) {
      const parts = data.replace('set_buy_slip:', '').split('_');
      const bps = parseInt(parts[parts.length - 1]);
      if (isNaN(bps)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const chain = parts[0] as Chain;
      const mint = parts.slice(1, -1).join('_');

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, buySlippageBps: bps });

      await ctx.answerCallbackQuery({ text: `Buy slippage set to ${(bps / 100).toFixed(1)}%` });

      // Return to token panel
      await handleTradeChainSelected(ctx, chain, mint);
      return;
    }

    // Buy panel priority/GWEI adjustment - v3.5: Chain-aware
    if (data.startsWith('buy_priority:')) {
      const parts = data.replace('buy_priority:', '').split('_');
      const chain = parts[0] as Chain;
      const mint = parts.slice(1).join('_');
      const isEvm = chain !== 'sol';

      const { getOrCreateChainSettings } = await import('@raptor/shared');
      const settings = await getOrCreateChainSettings(user.id, chain);

      const chainName = 'SOL';

      let message: string;
      let keyboard: InlineKeyboard;

      if (isEvm) {
        // EVM chains: Show GWEI options
        const currentGwei = settings.gas_gwei;
        message =
          `*GAS PRICE* | ${chainName}\n\n` +
          `Current: ${currentGwei ?? 'Auto'} GWEI\n\n` +
          `Select gas price:`;

        // Different gwei presets per chain
        if (chain === 'bsc') {
          keyboard = new InlineKeyboard()
            .text(currentGwei === 3 ? '> 3' : '3', `set_buy_gwei:${chain}_${mint}_3`)
            .text(currentGwei === 5 ? '> 5' : '5', `set_buy_gwei:${chain}_${mint}_5`)
            .text(currentGwei === 7 ? '> 7' : '7', `set_buy_gwei:${chain}_${mint}_7`)
            .row()
            .text(currentGwei === 10 ? '> 10' : '10', `set_buy_gwei:${chain}_${mint}_10`)
            .text(currentGwei === 15 ? '> 15' : '15', `set_buy_gwei:${chain}_${mint}_15`)
            .text(currentGwei === 20 ? '> 20' : '20', `set_buy_gwei:${chain}_${mint}_20`)
            .row()
            .text('« Back to Token', `token:${chain}_${mint}`);
        } else if (chain === 'base') {
          keyboard = new InlineKeyboard()
            .text(currentGwei === 0.01 ? '> 0.01' : '0.01', `set_buy_gwei:${chain}_${mint}_0.01`)
            .text(currentGwei === 0.05 ? '> 0.05' : '0.05', `set_buy_gwei:${chain}_${mint}_0.05`)
            .text(currentGwei === 0.1 ? '> 0.1' : '0.1', `set_buy_gwei:${chain}_${mint}_0.1`)
            .row()
            .text(currentGwei === 0.5 ? '> 0.5' : '0.5', `set_buy_gwei:${chain}_${mint}_0.5`)
            .text(currentGwei === 1 ? '> 1' : '1', `set_buy_gwei:${chain}_${mint}_1`)
            .text(currentGwei === 2 ? '> 2' : '2', `set_buy_gwei:${chain}_${mint}_2`)
            .row()
            .text('« Back to Token', `token:${chain}_${mint}`);
        } else {
          // ETH
          keyboard = new InlineKeyboard()
            .text(currentGwei === 10 ? '> 10' : '10', `set_buy_gwei:${chain}_${mint}_10`)
            .text(currentGwei === 20 ? '> 20' : '20', `set_buy_gwei:${chain}_${mint}_20`)
            .text(currentGwei === 30 ? '> 30' : '30', `set_buy_gwei:${chain}_${mint}_30`)
            .row()
            .text(currentGwei === 50 ? '> 50' : '50', `set_buy_gwei:${chain}_${mint}_50`)
            .text(currentGwei === 75 ? '> 75' : '75', `set_buy_gwei:${chain}_${mint}_75`)
            .text(currentGwei === 100 ? '> 100' : '100', `set_buy_gwei:${chain}_${mint}_100`)
            .row()
            .text('« Back to Token', `token:${chain}_${mint}`);
        }
      } else {
        // Solana: Show priority fee options
        const current = settings.priority_sol;
        message =
          `*PRIORITY FEE* | SOL\n\n` +
          `Current: ${current ?? 0.0001} SOL\n\n` +
          `Select priority fee:`;

        keyboard = new InlineKeyboard()
          .text(current === 0.00005 ? '> 0.00005' : '0.00005', `set_buy_prio:${chain}_${mint}_0.00005`)
          .text(current === 0.0001 ? '> 0.0001' : '0.0001', `set_buy_prio:${chain}_${mint}_0.0001`)
          .row()
          .text(current === 0.0005 ? '> 0.0005' : '0.0005', `set_buy_prio:${chain}_${mint}_0.0005`)
          .text(current === 0.001 ? '> 0.001' : '0.001', `set_buy_prio:${chain}_${mint}_0.001`)
          .row()
          .text(current === 0.005 ? '> 0.005' : '0.005', `set_buy_prio:${chain}_${mint}_0.005`)
          .text(current === 0.01 ? '> 0.01' : '0.01', `set_buy_prio:${chain}_${mint}_0.01`)
          .row()
          .text('« Back to Token', `token:${chain}_${mint}`);
      }

      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
      return;
    }

    // Set buy GWEI (EVM chains) - v3.5
    if (data.startsWith('set_buy_gwei:')) {
      const parts = data.replace('set_buy_gwei:', '').split('_');
      const gwei = parseFloat(parts[parts.length - 1]);
      if (isNaN(gwei)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const chain = parts[0] as Chain;
      const mint = parts.slice(1, -1).join('_');

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, gasGwei: gwei });

      await ctx.answerCallbackQuery({ text: `Gas set to ${gwei} GWEI` });

      // Return to token panel
      await handleTradeChainSelected(ctx, chain, mint);
      return;
    }

    // Set buy priority (Solana) - v3.5: Updates chain_settings
    if (data.startsWith('set_buy_prio:')) {
      const parts = data.replace('set_buy_prio:', '').split('_');
      const priority = parseFloat(parts[parts.length - 1]);
      if (isNaN(priority)) {
        await ctx.answerCallbackQuery({ text: 'Invalid value' });
        return;
      }
      const chain = parts[0] as Chain;
      const mint = parts.slice(1, -1).join('_');

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: user.id, chain, prioritySol: priority });

      await ctx.answerCallbackQuery({ text: `Priority set to ${priority} SOL` });

      // Return to token panel
      await handleTradeChainSelected(ctx, chain, mint);
      return;
    }

    /// v3.4 FIX: Token details (token:<chain>_<mint> or token:<mint>) - back to token card
    if (data.startsWith('token:')) {
      const payload = data.replace('token:', '');
      // Support both formats: token:chain_mint and token:mint (legacy)
      let chain: Chain = 'sol';
      let mint: string;
      if (payload.includes('_')) {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_'); // Handle mints that might contain underscores
      } else {
        mint = payload;
      }
      await handleTradeChainSelected(ctx, chain, mint);
      return;
    }

    // v3.4 FIX: Chart link (chart:<chain>_<mint> or chart:<mint>)
    if (data.startsWith('chart:')) {
      const payload = data.replace('chart:', '');
      // Support both formats: chart:chain_mint and chart:mint (legacy, defaults to Solana)
      let chain: Chain = 'sol';
      let mint: string;
      if (payload.includes('_')) {
        const parts = payload.split('_');
        chain = parts[0] as Chain;
        mint = parts.slice(1).join('_');
      } else {
        mint = payload;
      }
      // Map chain to DexScreener path
      const chainPath = 'solana';
      const chartUrl = `https://dexscreener.com/${chainPath}/${mint}`;
      await ctx.answerCallbackQuery({ text: '📊 Opening chart...', url: chartUrl });
      return;
    }

    // Confirm withdrawal
    if (data === 'confirm_withdraw') {
      await handleWithdrawConfirm(ctx);
      return;
    }

    // Cancel
    if (data === 'cancel') {
      await ctx.editMessageText('Cancelled.');
      ctx.session.step = null;
      ctx.session.pendingWithdrawal = null;
      return;
    }

    // Settings toggles (legacy)
    if (data === 'toggle_alerts' || data === 'toggle_daily_summary') {
      await ctx.answerCallbackQuery({ text: 'Settings update coming soon!' });
      return;
    }

    // Copy address (copy_<address>)
    if (data.startsWith('copy_')) {
      await ctx.answerCallbackQuery({ text: 'Address copied!' });
      return;
    }

    // No-op for display-only buttons
    if (data === 'noop') {
      await ctx.answerCallbackQuery();
      return;
    }

    // Unhandled callback - v4.1 FIX: Provide user feedback instead of silent fail
    console.log(`[Callbacks] Unhandled callback: ${data}`);
    await ctx.answerCallbackQuery({ text: 'This feature is not available yet' });
  } catch (error) {
    console.error('[Callbacks] Error:', error);
    await ctx.answerCallbackQuery({ text: 'An error occurred. Please try again.' });
  }
}

// === HELPER HANDLERS ===

async function handleAddressChainSelected(ctx: MyContext, chain: Chain, address: string) {
  const user = ctx.from;
  if (!user) return;

  // Store in session for the send flow
  ctx.session.pendingSend = {
    toAddress: address,
    chain,
  };

  const symbol = 'SOL';

  // v3.4 FIX: Standard line format (below heading only)
  const message = `📤 *SEND ${symbol}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*To:* \`${address.slice(0, 10)}...${address.slice(-8)}\`

Select amount to send:`;

  const keyboard = new InlineKeyboard()
    .text(`0.01 ${symbol}`, `send_${chain}_0.01`)
    .text(`0.05 ${symbol}`, `send_${chain}_0.05`)
    .row()
    .text(`0.1 ${symbol}`, `send_${chain}_0.1`)
    .text(`0.5 ${symbol}`, `send_${chain}_0.5`)
    .row()
    .text(`1 ${symbol}`, `send_${chain}_1`)
    .text('Max', `send_${chain}_max`)
    .row()
    .text('✏️ Custom Amount', `send_${chain}_custom`)
    .row()
    .text('❌ Cancel', 'back_to_menu');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function handleTradeChainSelected(ctx: MyContext, chain: Chain, address: string) {
  const user = ctx.from;
  if (!user) return;

  await ctx.answerCallbackQuery({ text: 'Loading...' });

  // v3.4 FIX (E2): Set monitor view to TOKEN to prevent refresh loop overwrites
  // This ensures the monitor message isn't updated while showing the token panel
  try {
    await setMonitorView(user.id, address, 'TOKEN');
  } catch {
    // Ignore if no monitor exists for this token
  }

  const chainName = 'SOL';
  const chainEmoji = '🟢';
  const symbol = 'SOL';
  const isEvm = chain !== 'sol';

  // Fetch all data in parallel for speed
  const { tokenData, goplus, pumpfun, getOrCreateChainSettings } = await import('@raptor/shared');

  try {
    // v3.5: Fetch chain settings for slippage/gas display
    const chainSettings = await getOrCreateChainSettings(user.id, chain);
    const buySlippage = (chainSettings.buy_slippage_bps / 100).toFixed(1);
    const gasOrPriority = isEvm
      ? `${chainSettings.gas_gwei ?? 'Auto'} GWEI`
      : `${chainSettings.priority_sol ?? 0.0001} SOL`;

    // Parallel fetch: DexScreener + GoPlus + PumpFun (if Solana)
    const [tokenInfo, security, pumpInfo] = await Promise.all([
      tokenData.getTokenInfo(address, chain).catch(() => null),
      goplus.getTokenSecurity(address, chain).catch(() => null),
      chain === 'sol' ? pumpfun.getTokenInfo(address).catch(() => null) : Promise.resolve(null),
    ]);

    let message: string;

    // Check if it's a PumpFun token (not yet graduated)
    if (pumpInfo && !pumpInfo.complete) {
      const curveStatus = pumpfun.getBondingCurveStatus(pumpInfo);
      const progressBar = pumpfun.formatBondingCurveBar(pumpInfo.bondingCurveProgress);
      const links = pumpfun.getPumpFunLinks(address);

      message = `🎰 *BUY ${pumpInfo.symbol}* | Pump.fun
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*${pumpInfo.name}*
${curveStatus.emoji} ${curveStatus.label}

💰 *Price:* ${pumpInfo.priceInSol.toFixed(9)} SOL
📊 *MCap:* ${pumpInfo.marketCapSol.toFixed(2)} SOL

*Bonding Curve:*
${progressBar} ${pumpInfo.bondingCurveProgress.toFixed(1)}%
💎 ${pumpInfo.realSolReserves.toFixed(2)} / ~85 SOL

*Settings*
Slippage: ${buySlippage}%
Priority: ${gasOrPriority}

🔗 [Pump.fun](${links.pumpfun}) • [DexScreener](${links.dexscreener})
\`${address}\``;
    } else if (tokenInfo) {
      const mcapStr = tokenData.formatLargeNumber(tokenInfo.marketCap);
      const liqStr = tokenData.formatLargeNumber(tokenInfo.liquidity);
      const volStr = tokenData.formatLargeNumber(tokenInfo.volume24h);

      // v3.5: Build chain-specific explorer links
      let explorerLink: string;
      let explorerName: string;
      if (chain === 'sol') {
        explorerLink = `https://solscan.io/token/${address}`;
        explorerName = 'Solscan';
      } else if (chain === 'bsc') {
        explorerLink = `https://bscscan.com/token/${address}`;
        explorerName = 'BscScan';
      } else if (chain === 'base') {
        explorerLink = `https://basescan.org/token/${address}`;
        explorerName = 'Basescan';
      } else {
        explorerLink = `https://etherscan.io/token/${address}`;
        explorerName = 'Etherscan';
      }

      const dexLink = `https://dexscreener.com/${chain === 'sol' ? 'solana' : chain}/${address}`;
      const dextoolsLink = `https://www.dextools.io/app/en/${chain === 'sol' ? 'solana' : chain === 'bsc' ? 'bnb' : chain}/pair-explorer/${address}`;
      const birdeyeLink = `https://birdeye.so/token/${address}?chain=${chain === 'sol' ? 'solana' : chain === 'bsc' ? 'bsc' : chain === 'base' ? 'base' : 'ethereum'}`;

      // v3.5: Format taxes from GoPlus
      let taxStr = '0%B / 0%S';
      if (security && (security.buyTax > 0 || security.sellTax > 0)) {
        taxStr = `${security.buyTax.toFixed(0)}%B / ${security.sellTax.toFixed(0)}%S`;
      }

      // v3.5: Build security section for EVM
      let securitySection = '';
      if (isEvm && security) {
        const honeypotStatus = security.isHoneypot ? '⚠️ Risk' : 'Safe ✅';
        const blacklistStatus = security.isBlacklisted ? '⚠️ Risk' : 'Safe ✅';
        securitySection = `
*Security*
Honeypot: ${honeypotStatus}
Blacklist: ${blacklistStatus}
`;
      } else if (!isEvm) {
        // Solana security badge
        const securityBadge = security
          ? goplus.getRiskBadge(security)
          : tokenData.getSecurityBadge(tokenInfo.riskScore);
        securitySection = `\n*Security:* ${securityBadge.emoji} ${securityBadge.label}\n`;
      }

      // v3.5: Updated panel format
      message = `${chainEmoji} *BUY ${tokenInfo.symbol}* | ${chainName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*${tokenInfo.name}*
\`${address}\`

📊 *MC:* ${mcapStr}
💧 *Liquidity:* ${liqStr}
⚡️ *Volume:* ${volStr}
💳 *Taxes:* ${taxStr}

*Settings*
Slippage: ${buySlippage}%
${isEvm ? 'Gas' : 'Priority'}: ${gasOrPriority}
${securitySection}
🔗 [DexScreener](${dexLink}) • [Dextools](${dextoolsLink}) • [Birdeye](${birdeyeLink}) • [${explorerName}](${explorerLink})`;
    } else {
      // v3.5: Unknown token panel
      message = `${chainEmoji} *BUY TOKEN* | ${chainName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *New/Unlisted Token*
\`${address}\`

Data not available. Proceed with caution.

*Settings*
Slippage: ${buySlippage}%
${isEvm ? 'Gas' : 'Priority'}: ${gasOrPriority}`;
    }

    // Build keyboard with appropriate buy amounts
    const keyboard = new InlineKeyboard();

    if (chain === 'sol') {
      keyboard
        .text('🛒 0.1', `buy_sol_${address}_0.1`)
        .text('🛒 0.25', `buy_sol_${address}_0.25`)
        .text('🛒 0.5', `buy_sol_${address}_0.5`)
        .row()
        .text('🛒 1', `buy_sol_${address}_1`)
        .text('🛒 2', `buy_sol_${address}_2`)
        .text('✏️ X', `buy_sol_${address}_custom`);
    } else if (chain === 'bsc') {
      keyboard
        .text('🛒 0.01', `buy_bsc_${address}_0.01`)
        .text('🛒 0.05', `buy_bsc_${address}_0.05`)
        .text('🛒 0.1', `buy_bsc_${address}_0.1`)
        .row()
        .text('🛒 0.25', `buy_bsc_${address}_0.25`)
        .text('🛒 0.5', `buy_bsc_${address}_0.5`)
        .text('✏️ X', `buy_bsc_${address}_custom`);
    } else {
      keyboard
        .text('🛒 0.005', `buy_${chain}_${address}_0.005`)
        .text('🛒 0.01', `buy_${chain}_${address}_0.01`)
        .text('🛒 0.025', `buy_${chain}_${address}_0.025`)
        .row()
        .text('🛒 0.05', `buy_${chain}_${address}_0.05`)
        .text('🛒 0.1', `buy_${chain}_${address}_0.1`)
        .text('✏️ X', `buy_${chain}_${address}_custom`);
    }

    // v3.5: Add Slippage and GWEI/Priority buttons to buy panel
    keyboard
      .row()
      .text('⚙️ Slippage', `buy_slippage:${chain}_${address}`)
      .text(isEvm ? '⛽ GWEI' : '⚡ Priority', `buy_priority:${chain}_${address}`)
      .row()
      .text('🔍 Scan', `analyze_${chain}_${address}`)
      .text('🔄 Refresh', `refresh_${chain}_${address}`)
      .row()
      .text('« Back', 'back_to_menu');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error('[Callbacks] Token fetch error:', error);
    // Show error message with retry option
    await ctx.editMessageText(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${chainEmoji} *TOKEN* — ${chainName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ *Error loading data*

Network issue or API timeout.
Please try again.

\`${address}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('🔄 Retry', `trade_chain_${chain}_${address}`)
          .row()
          .text('« Back', 'back_to_menu'),
      }
    );
  }
}

async function handleSendAmount(ctx: MyContext, chain: Chain, amount: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingSend) return;

  if (amount === 'custom') {
    ctx.session.step = 'awaiting_send_amount';
    await ctx.reply('Enter the amount to send:');
    await ctx.answerCallbackQuery();
    return;
  }

  ctx.session.pendingSend.amount = amount;
  ctx.session.step = 'awaiting_send_confirm';

  const { toAddress } = ctx.session.pendingSend;
  const symbol = 'SOL';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Send', 'confirm_send')
    .text('❌ Cancel', 'cancel_send');

  await ctx.editMessageText(
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *Confirm Send*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Amount:* ${amount === 'max' ? 'Maximum' : amount} ${symbol}
*To:* \`${toAddress.slice(0, 10)}...${toAddress.slice(-8)}\`
*Chain:* ${chain.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );

  await ctx.answerCallbackQuery();
}

async function handleConfirmSendTransaction(ctx: MyContext) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingSend) return;

  const { amount } = ctx.session.pendingSend;
  if (!amount) {
    await ctx.answerCallbackQuery({ text: 'No amount specified' });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Processing...' });

  // NOTE: This flow is intentionally disabled in the Solana-only build.
  // We prefer a hard stop over a "fake" success message.
  await ctx.editMessageText(
    `❌ *Send Disabled*

Wallet-to-wallet sends are not enabled in this build.

Use *Withdraw* for outbound transfers, or export the wallet and send from your preferred wallet UI.
`,
    { parse_mode: 'Markdown' }
  );

  ctx.session.step = null;
  ctx.session.pendingSend = undefined;
}

async function handleCancelSend(ctx: MyContext) {
  ctx.session.step = null;
  ctx.session.pendingSend = undefined;

  await ctx.editMessageText('Transaction cancelled.');
  await ctx.answerCallbackQuery();
}

async function handleBuyToken(ctx: MyContext, chain: Chain, tokenAddress: string, amount: string) {
  const user = ctx.from;
  if (!user) return;

  if (amount === 'custom') {
    // v3.4: Implement custom buy amount flow
    const symbol = 'SOL';
    ctx.session.step = 'awaiting_custom_buy_amount';
    ctx.session.pendingBuy = { chain, mint: tokenAddress };

    await ctx.editMessageText(
      `✏️ *CUSTOM BUY AMOUNT*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Enter the amount of ${symbol} you want to spend:\n\n` +
      `_Example: 0.5 or 1.25_\n\n` +
      `Token: \`${tokenAddress.slice(0, 8)}...${tokenAddress.slice(-6)}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Cancel', `token:${chain}_${tokenAddress}`)
      }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // Only Solana is supported currently
  if (chain !== 'sol') {
    await ctx.answerCallbackQuery({ text: 'Only Solana is supported currently', show_alert: true });
    return;
  }

  const solAmount = parseFloat(amount);
  if (isNaN(solAmount) || solAmount <= 0) {
    await ctx.answerCallbackQuery({ text: 'Invalid amount', show_alert: true });
    return;
  }

  // Show processing message
  await ctx.answerCallbackQuery({ text: `🔄 Processing ${solAmount} SOL buy...` });

  try {
    // Import the Solana trade service and fee calculator
    const { executeSolanaBuy } = await import('../services/solanaTrade.js');
    const { applyBuyFeeDecimal } = await import('@raptor/shared');

    // Calculate fee for display
    const { netAmount, fee } = applyBuyFeeDecimal(solAmount);

    // Show initial status message with fee breakdown
    await ctx.reply(
      `⏳ *PROCESSING BUY*\n\n` +
      `Amount: ${solAmount} SOL\n` +
      `Platform Fee (1%): ${fee.toFixed(4)} SOL\n` +
      `Net Buy Amount: ${netAmount.toFixed(4)} SOL\n\n` +
      `_Finding best route (pump.fun or Jupiter)..._`,
      { parse_mode: 'Markdown' }
    );

    // Execute the buy
    const result = await executeSolanaBuy(user.id, tokenAddress, solAmount);

    if (result.success && result.txHash) {
      // v3.4.2: Fetch token metadata from DexScreener BEFORE success message (for MC display)
      const explorerUrl = `https://solscan.io/tx/${result.txHash}`;
      const tokensReceived = result.amountOut || 0;
      const pricePerToken = result.pricePerToken || 0;

      let tokenSymbol: string | undefined;
      let tokenName: string | undefined;
      let entryMarketCapUsd: number | undefined;
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
        const dexData = await dexRes.json() as { pairs?: Array<{ baseToken?: { symbol?: string; name?: string }; fdv?: number }> };
        if (dexData.pairs?.[0]) {
          tokenSymbol = dexData.pairs[0].baseToken?.symbol;
          tokenName = dexData.pairs[0].baseToken?.name;
          entryMarketCapUsd = dexData.pairs[0].fdv; // Market cap at entry
        }
      } catch {
        // Fallback to undefined
      }

      // v3.4.2: Format market cap for display
      const formatMc = (mc: number | undefined) => {
        if (!mc) return '—';
        if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
        if (mc >= 1_000) return `$${(mc / 1_000).toFixed(2)}K`;
        return `$${mc.toFixed(0)}`;
      };

      // Success message with Market Cap
      await ctx.reply(
        `✅ *BUY SUCCESSFUL*\n\n` +
        `*Route:* ${result.route || 'Unknown'}\n` +
        `*Gross Amount:* ${result.amountIn} SOL\n` +
        `*Platform Fee:* ${result.fee?.toFixed(4)} SOL (1%)\n` +
        `*Net Amount:* ${result.netAmount?.toFixed(4)} SOL\n` +
        `*Tokens Received:* ${tokensReceived.toLocaleString()}\n` +
        `*Entry MC:* ${formatMc(entryMarketCapUsd)}\n\n` +
        `[View Transaction](${explorerUrl})`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }
      );

      // Create Position record for this buy
      let positionId: number | undefined;
      try {
        // Get or create a MANUAL strategy for this user+chain (required FK)
        const strategy = await getOrCreateManualStrategy(user.id, 'sol');

        const position = await createPositionV31({
          userId: user.id,
          strategyId: strategy.id,
          chain: 'sol',
          tokenMint: tokenAddress,
          tokenSymbol: tokenSymbol || 'UNKNOWN',
          entryExecutionId: undefined,
          entryTxSig: result.txHash!,
          entryCostSol: result.netAmount || solAmount,
          entryPrice: pricePerToken,
          sizeTokens: tokensReceived,
        });
        // position.id is typed as string but DB returns number (SERIAL)
        positionId = typeof position.id === 'string' ? parseInt(position.id, 10) : position.id;
        console.log('[Callbacks] Position created:', positionId, 'with strategy:', strategy.id);
      } catch (positionError) {
        console.error('[Callbacks] Failed to create position:', positionError);
        // Continue to create monitor even if position fails
      }

      // Create Trade Monitor for this position
      try {
        await createTradeMonitor(
          ctx.api,
          user.id,
          ctx.chat!.id,
          'sol',
          tokenAddress,
          tokenSymbol,
          tokenName,
          result.netAmount || solAmount,
          tokensReceived,
          pricePerToken,
          result.route || 'Unknown',
          positionId,
          entryMarketCapUsd  // v3.4.1: Pass entry market cap
        );
      } catch (monitorError) {
        console.error('[Callbacks] Failed to create trade monitor:', monitorError);
        // Don't fail the buy if monitor creation fails
      }
    } else {
      // Error message - escape special chars to prevent Markdown parse errors
      await ctx.reply(
        `❌ *BUY FAILED*\n\n` +
        `${escapeMarkdown(result.error || 'Unknown error')}\n\n` +
        `Please check your wallet balance and try again.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('[Callbacks] Buy token error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(
      `❌ *BUY FAILED*\n\n` +
      `An unexpected error occurred: ${escapeMarkdown(errorMsg)}\n\n` +
      `Please try again or contact support.`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function handleAnalyzeToken(ctx: MyContext, chain: Chain, tokenAddress: string) {
  const user = ctx.from;
  if (!user) return;

  await ctx.answerCallbackQuery({ text: 'Analyzing token...' });

  // TODO: Show token analysis
  await handleScoreRequest(ctx, tokenAddress);
}

/**
 * Handle withdrawal confirmation
 */
async function handleConfirmWithdrawal(ctx: MyContext) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain, walletIndex, amount, address } = ctx.session.pendingWithdrawal;

  if (!address || !amount) {
    await ctx.editMessageText('❌ Missing withdrawal details. Please try again.', {
      reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
    });
    ctx.session.step = null;
    ctx.session.pendingWithdrawal = null;
    return;
  }

  await ctx.editMessageText('⏳ Processing withdrawal...\n\n_This may take a few moments..._', {
    parse_mode: 'Markdown',
  });

  try {
    // Import processWithdrawal from wallet service
    const { processWithdrawal } = await import('../services/wallet.js');

    const tx = await processWithdrawal(user.id, chain, walletIndex, amount, address);

    // Solana-only build
    const symbol = 'SOL';
    const explorerUrl = `https://solscan.io/tx/${tx.hash}`;

    // v3.4 FIX: Standard line format (below heading only)
    const amountText = `${parseFloat(amount).toFixed(6)} ${symbol}`;
    await ctx.editMessageText(
      `✅ *WITHDRAWAL SUCCESSFUL*
${LINE}

*Amount:* ${escapeMarkdownV2(amountText)}
*Chain:* ${CHAIN_NAME[chain]}

*Transaction:*
[View on Explorer](${explorerUrl})

_Funds should arrive within a few minutes\\._`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );
  } catch (error) {
    console.error('[Callbacks] Withdrawal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // v3.4 FIX: Standard line format (below heading only)
    await ctx.editMessageText(
      `❌ *WITHDRAWAL FAILED*
${LINE}

*Error:* ${escapeMarkdown(errorMessage)}

Please check:
• Sufficient balance for amount \\+ gas fees
• Valid destination address
• Network congestion`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );
  }

  ctx.session.step = null;
  ctx.session.pendingWithdrawal = null;
}

async function handleWithdrawConfirm(ctx: MyContext) {
  // Legacy function - redirect to new handler
  await handleConfirmWithdrawal(ctx);
}

// === WALLET GENERATION HANDLERS ===

async function showGenerateWallet(ctx: MyContext) {
  const message = `🔐 *Generate Trading Wallet*

Select which chain to generate your first wallet on:

🟣 *Solana* — Fastest, lowest fees
🟡 *BSC* — BNB ecosystem
🔵 *Base* — Coinbase L2, low fees
⚪ *Ethereum* — Original, higher fees

_You can add more chains later in Settings_`;

  const keyboard = new InlineKeyboard()
    .text('🟣 Solana', 'generate_wallet_sol')
    .text('🟡 BSC', 'generate_wallet_bsc')
    .row()
    .text('🔵 Base', 'generate_wallet_base')
    .text('⚪ Ethereum', 'generate_wallet_eth')
    .row()
    .text('← Back', 'back_to_start');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function generateWalletForChain(ctx: MyContext, _chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  await ctx.answerCallbackQuery({ text: 'Generating wallet...' });

  try {
    // Import the new wallet service
    const { initializeUserWallet } = await import('../services/wallet.js');

    // Solana-only build - generate wallet
    const { solana, isNew } = await initializeUserWallet(user.id);

    // Solana-only build
    const address = solana.address;
    const chainEmoji = '🟢';
    const chainName = 'Solana';
    const symbol = 'SOL';
    const minDeposit = '0.05 SOL';

    const message = `✅ *Wallet ${isNew ? 'Created' : 'Ready'}!*

${chainEmoji} *${chainName} Deposit Address:*
\`${address}\`

_(tap to copy)_

━━━━━━━━━━━━━━━━━━━━━━

*Your Wallet Address:*
🟢 Solana: \`${solana.address.slice(0, 8)}...${solana.address.slice(-6)}\`

━━━━━━━━━━━━━━━━━━━━━━

*Next Steps:*
1️⃣ Send ${symbol} to the address above
2️⃣ Min deposit: ${minDeposit}
3️⃣ Start trading with /snipe or /hunt

⚠️ Only send ${symbol} on ${chainName}!

🔐 Use /backup to export your private keys`;

    const keyboard = new InlineKeyboard()
      .text('🔐 Backup Keys', 'backup_start')
      .row()
      .text('🎯 Start Sniping', 'menu_snipe')
      .text('🦖 Setup Hunt', 'menu_hunt')
      .row()
      .text('🏠 Main Menu', 'back_to_start');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('[Callbacks] Error generating wallet:', error);
    await ctx.editMessageText(
      '❌ Error generating wallet. Please try again.\n\nMake sure USER_WALLET_ENCRYPTION_KEY is set.',
      {
        reply_markup: new InlineKeyboard().text('← Back', 'back_to_start'),
      }
    );
  }
}

async function showHowItWorks(ctx: MyContext) {
  const message = `📖 *GETTING STARTED*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔐 *1. Generate Wallet*
Create a trading wallet for SOL, ETH, or BNB. Each chain has its own address.

💰 *2. Deposit Funds*
Send crypto to your deposit address. Funds are detected automatically.

🦖 *3. Hunt Mode*
Enable auto-trading. RAPTOR scans for new token launches and scores them (0-35). High-scoring tokens are bought automatically.

🎯 *4. Snipe Mode*
Manual trading. Use \`/snipe <token>\` to analyze and buy specific tokens.

📈 *5. Strategies*
Choose how to trade:
• ⚡ Micro Scalp — Quick 15% gains
• 📊 Standard — Balanced 50% target
• 🌙 Moon Bag — Keep 25% forever
• 📈 DCA Exit — Ladder out gradually
• 🎯 Trailing — Let winners run

💸 *6. Take Profits*
Sell positions anytime from /positions. Auto-exits trigger at your TP/SL.

*Fees:* 1% on profitable trades only`;

  const keyboard = new InlineKeyboard()
    .text('🔐 Generate Wallet', 'start_generate_wallet')
    .row()
    .text('📈 View Strategies', 'settings_strategy')
    .row()
    .text('← Back', 'back_to_start');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

// === POSITIONS UI HANDLERS ===

async function showPositionsList(ctx: MyContext) {
  const user = ctx.from;
  if (!user) return;

  // Get positions from database
  const { getUserPositions } = await import('@raptor/shared');
  const positions = await getUserPositions(user.id);

  if (!positions || positions.length === 0) {
    const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *POSITIONS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

No active positions.

Use /hunt to enable auto-trading or
paste a token address to snipe.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const keyboard = new InlineKeyboard()
      .text('🦖 Hunt Settings', 'menu_hunt')
      .row()
      .text('« Back', 'back_to_menu');

    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
    await ctx.answerCallbackQuery();
    return;
  }

  // Build positions list
  let message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *ACTIVE POSITIONS* (${positions.length})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  const keyboard = new InlineKeyboard();

  for (let i = 0; i < Math.min(positions.length, 8); i++) {
    const pos = positions[i];
    const pnlPercent = pos.unrealized_pnl_percent || 0;
    const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';
    const pnlStr = pnlPercent >= 0 ? `+${pnlPercent.toFixed(1)}%` : `${pnlPercent.toFixed(1)}%`;
    const chainEmoji = '🟢';

    message += `${i + 1}. ${chainEmoji} *${pos.token_symbol}* ${pnlEmoji} ${pnlStr}\n`;

    keyboard.text(`${pos.token_symbol} ${pnlStr}`, `pos_view_${pos.id}`);
    if ((i + 1) % 2 === 0) keyboard.row();
  }

  if (positions.length > 8) {
    message += `\n_...and ${positions.length - 8} more_`;
  }

  message += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
_Tap a position to view details_`;

  keyboard.row().text('🔄 Refresh', 'positions').text('« Back', 'back_to_menu');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showPositionDetail(ctx: MyContext, positionId: number) {
  const user = ctx.from;
  if (!user) return;

  // Get position from database
  const { getPosition } = await import('@raptor/shared');
  const pos = await getPosition(positionId);

  if (!pos) {
    await ctx.answerCallbackQuery({ text: 'Position not found' });
    return;
  }

  const chainEmoji = '🟢';
  const chainName = 'Solana';
  const symbol = 'SOL';
  const pnlPercent = pos.unrealized_pnl_percent || 0;
  const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';
  const pnlStr = pnlPercent >= 0 ? `+${pnlPercent.toFixed(2)}%` : `${pnlPercent.toFixed(2)}%`;

  const entryPrice = parseFloat(pos.entry_price);
  const currentPrice = parseFloat(pos.current_price);
  const holdTime = Date.now() - new Date(pos.created_at).getTime();
  const holdHours = Math.floor(holdTime / (1000 * 60 * 60));
  const holdMins = Math.floor((holdTime % (1000 * 60 * 60)) / (1000 * 60));

  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${chainEmoji} *${pos.token_symbol}* — ${chainName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${pnlEmoji} *P&L:* ${pnlStr}

📈 *Entry:* ${entryPrice.toFixed(8)} ${symbol}
📊 *Current:* ${currentPrice.toFixed(8)} ${symbol}

⏱️ *Hold Time:* ${holdHours}h ${holdMins}m
🎯 *Take Profit:* +${pos.take_profit_percent}%
🛑 *Stop Loss:* -${pos.stop_loss_percent}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\`${pos.token_address}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard()
    .text('💰 Sell 25%', `pos_${positionId}_sell_25`)
    .text('💰 Sell 50%', `pos_${positionId}_sell_50`)
    .row()
    .text('💰 Sell 75%', `pos_${positionId}_sell_75`)
    .text('💰 Sell 100%', `pos_${positionId}_sell_100`)
    .row()
    .text('✏️ Edit TP/SL', `pos_${positionId}_edit`)
    .row()
    .text('🔄 Refresh', `pos_view_${positionId}`)
    .text('« Back', 'back_to_positions');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showEditTpSl(ctx: MyContext, positionId: number) {
  const user = ctx.from;
  if (!user) return;

  const { getPosition } = await import('@raptor/shared');
  const pos = await getPosition(positionId);

  if (!pos) {
    await ctx.answerCallbackQuery({ text: 'Position not found' });
    return;
  }

  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✏️ *EDIT TP/SL — ${pos.token_symbol}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current Settings:
🎯 *Take Profit:* +${pos.take_profit_percent}%
🛑 *Stop Loss:* -${pos.stop_loss_percent}%

Select new values:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard()
    .text('🎯 TP 25%', `set_tp_${positionId}_25`)
    .text('🎯 TP 50%', `set_tp_${positionId}_50`)
    .text('🎯 TP 100%', `set_tp_${positionId}_100`)
    .row()
    .text('🛑 SL 10%', `set_sl_${positionId}_10`)
    .text('🛑 SL 20%', `set_sl_${positionId}_20`)
    .text('🛑 SL 30%', `set_sl_${positionId}_30`)
    .row()
    .text('« Back', `pos_view_${positionId}`);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function setPositionTp(ctx: MyContext, positionId: number, tp: number) {
  const user = ctx.from;
  if (!user) return;

  const { updatePositionTpSl } = await import('@raptor/shared');
  await updatePositionTpSl(positionId, { take_profit_percent: tp });

  await ctx.answerCallbackQuery({ text: `Take Profit set to +${tp}%` });
  await showEditTpSl(ctx, positionId);
}

async function setPositionSl(ctx: MyContext, positionId: number, sl: number) {
  const user = ctx.from;
  if (!user) return;

  const { updatePositionTpSl } = await import('@raptor/shared');
  await updatePositionTpSl(positionId, { stop_loss_percent: sl });

  await ctx.answerCallbackQuery({ text: `Stop Loss set to -${sl}%` });
  await showEditTpSl(ctx, positionId);
}

// === HELP UI HANDLERS ===

// v3.4.2 FIX: Removed line above heading
async function showHelpMenu(ctx: MyContext) {
  const message = `❓ *HELP & GUIDES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select a topic to learn more:

📖 *Getting Started*
How to set up and start trading

💰 *Deposits & Withdrawals*
Managing your funds

🦖 *Hunt*
Automatic token sniping

📊 *Strategies*
Trading strategy explanations

💸 *Fees*
How fees work`;

  const keyboard = new InlineKeyboard()
    .text('📖 Getting Started', 'help_start')
    .row()
    .text('💰 Deposits', 'help_deposits')
    .text('🦖 Hunt', 'help_hunt')
    .row()
    .text('📊 Strategies', 'help_strategies')
    .text('💸 Fees', 'help_fees')
    .row()
    .text('« Back', 'back_to_menu');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showHelpDeposits(ctx: MyContext) {
  const message = `💰 *DEPOSITS & WITHDRAWALS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*How to Deposit:*
1. Go to 💳 Wallets
2. Select a chain (SOL, BSC, Base, ETH)
3. Copy your deposit address
4. Send funds to that address
5. Deposits are detected automatically

*Minimum Deposits:*
• SOL: 0.05 SOL (~$10)
• BSC: 0.01 BNB (~$6)
• Base: 0.005 ETH (~$18)
• ETH: 0.01 ETH (~$35)

*How to Withdraw:*
1. Go to 💳 Wallets
2. Select the wallet to withdraw from
3. Tap 📤 Withdraw
4. Enter amount and destination

*Important:*
⚠️ Only send the correct asset to each chain
⚠️ Double-check addresses before sending`;

  const keyboard = new InlineKeyboard()
    .text('💳 Go to Wallets', 'wallets')
    .row()
    .text('« Back', 'help');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showHelpHunt(ctx: MyContext) {
  const message = `🦖 *HUNT GUIDE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*What is Hunt Mode?*
RAPTOR monitors new token launches 24/7
and automatically buys tokens that pass
our safety scoring system.

*How It Works:*
1. New token detected on launchpad
2. Safety analysis runs (0-100 score)
3. If score >= your minimum, buy executes
4. Position tracked with your strategy

*Safety Score Breakdown:*
• 0-25: Skip (dangerous)
• 25-50: Cautious positions
• 50-75: Normal tradable
• 75-100: Highest quality

*Configurable Settings:*
• Min Score: Higher = safer, fewer trades
• Position Size: Max bet per trade
• Launchpads: Which platforms to monitor

*Supported Launchpads:*
🟢 pump.fun, PumpSwap, Moonshot`;

  const keyboard = new InlineKeyboard()
    .text('🦖 Configure Hunt', 'menu_hunt')
    .row()
    .text('« Back', 'help');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showHelpStrategies(ctx: MyContext) {
  const message = `📊 *TRADING STRATEGIES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*Available Strategies:*

⚡ *Micro Scalp*
TP: 15% | SL: 8% | Max: 15 min
Quick in-and-out on fresh launches.
Best for: Low-gas chains (SOL, Base)

📈 *Standard*
TP: 50% | SL: 30% | Max: 4 hours
Balanced approach for most tokens.
Best for: General trading

🌙 *Moon Bag*
TP: 75% | SL: 30% | Max: 8 hours
Take 75% profit, keep 25% forever.
Best for: High-conviction plays

📊 *DCA Exit*
TP: 200% | SL: 30% | Max: 8 hours
Ladder out at multiple price points.
Best for: Volatile tokens

🎯 *Trailing Stop*
TP: 100%+ | SL: 30% | Max: 8 hours
Let winners run with dynamic stop.
Best for: Strong momentum plays

*Custom Strategy:*
Create your own with exact TP/SL,
filters, and protection settings.`;

  const keyboard = new InlineKeyboard()
    .text('📊 Configure Strategy', 'settings_strategy')
    .row()
    .text('« Back', 'help');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showHelpFees(ctx: MyContext) {
  const message = `💸 *FEES EXPLAINED*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*RAPTOR Fees:*
• 1% on profitable trades only
• No fee on losing trades
• No deposit/withdrawal fees

*Example:*
Buy: 1 SOL → Token worth 1.5 SOL
Profit: 0.5 SOL
Fee: 0.005 SOL (1% of profit)
You receive: 1.495 SOL

*Network Fees (Gas):*
These are paid to the blockchain,
not RAPTOR. They vary by chain:

🟢 Solana: ~$0.01 per tx
🟡 BSC: ~$0.05-0.20 per tx
🔵 Base: ~$0.01-0.10 per tx
🟣 ETH: ~$5-50 per tx (varies)

*Priority Fees:*
Optional tips for faster execution.
Configure in ⛽ Gas Settings.

*Why Fee on Profit Only?*
We only make money when you do.
This aligns our incentives with yours.`;

  const keyboard = new InlineKeyboard()
    .text('⛽ Gas Settings', 'settings_gas')
    .row()
    .text('« Back', 'help');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

// === TRADE MONITOR SELL HANDLER ===

/**
 * Handle sell from trade monitor panel
 * P0-1 FIX: Now uses idempotency via callbackQuery.id to prevent double-sells
 */
async function handleSellPctFromMonitor(ctx: MyContext, mint: string, percent: number, chain: Chain = 'sol') {
  const user = ctx.from;
  if (!user) return;

  // P0-1: Get callback query ID for idempotency
  const callbackQueryId = ctx.callbackQuery?.id;
  if (!callbackQueryId) {
    await ctx.answerCallbackQuery({ text: 'Invalid request', show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: `Processing ${percent}% sell...` });

  try {
    // Import required functions
    const { getActivePositions, getUserWallets, loadSolanaKeypair } = await import('@raptor/shared');
    const { idKeyManualSell, reserveTradeBudget, updateExecution, closePositionV31 } = await import('@raptor/shared');

    // v3.5: Get user's active wallet for the correct chain
    const wallets = await getUserWallets(user.id);
    const activeWallet = wallets.find(w => w.chain === chain && w.is_active);

    if (!activeWallet) {
      const chainName = 'Solana';
      await ctx.reply(`⚠️ *No Active Wallet*\n\nPlease create a ${chainName} wallet first.`, {
        parse_mode: 'Markdown',
      });
      return;
    }

    // v3.5: Get token balance from USER's wallet - currently only Solana supported for sell
    // TODO: Add EVM sell support
    if (chain !== 'sol') {
      await ctx.reply('⚠️ *Not Supported*\n\nSelling is currently only supported on Solana.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const walletAddress = activeWallet.public_key || activeWallet.solana_address;
    const tokensHeld = await solanaExecutor.getTokenBalance(mint, walletAddress);

    if (!tokensHeld || tokensHeld <= 0) {
      await ctx.reply('⚠️ *No Balance Detected*\n\nYour wallet has no tokens for this mint.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    // Find position for this token (needed for idempotency key)
    const positions = await getActivePositions(user.id);
    const position = positions.find(p => p.token_address === mint && p.chain === chain);

    // Generate idempotency key - P0-1 core fix
    const idempotencyKey = idKeyManualSell({
      chain,
      userId: user.id,
      mint,
      positionId: position?.id?.toString() || 'no-position',
      tgEventId: callbackQueryId,
      sellPercent: percent,
    });

    // Reserve budget (tracks execution, prevents duplicates)
    const reservation = await reserveTradeBudget({
      mode: 'MANUAL',
      userId: user.id,
      strategyId: '00000000-0000-0000-0000-000000000000', // Manual sells use default strategy
      chain,
      action: 'SELL',
      tokenMint: mint,
      amountSol: 0, // SELL doesn't spend SOL
      idempotencyKey,
    });

    // Check if already executed (idempotency protection)
    if (!reservation.allowed) {
      if (reservation.reason === 'Already executed') {
        await ctx.reply(
          `⚠️ *Already Processed*\n\n` +
            `This sell was already executed.\n` +
            `Execution ID: \`${reservation.execution_id}\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      await ctx.reply(
        `❌ *SELL BLOCKED*\n\n${escapeMarkdown(reservation.reason || 'Trade not allowed')}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const executionId = reservation.execution_id;
    const sellAmount = (tokensHeld * percent) / 100;

    // Show processing message
    await ctx.reply(
      `⏳ *PROCESSING SELL*\n\n` +
        `Selling ${percent}% (${sellAmount.toLocaleString()} tokens)...\n\n` +
        `_Finding best route..._`,
      { parse_mode: 'Markdown' }
    );

    // Mark execution as SUBMITTED
    if (executionId) {
      await updateExecution({
        executionId,
        status: 'SUBMITTED',
      });
    }

    // Import sell execution
    const { executeSolanaSell } = await import('../services/solanaTrade.js');

    const result = await executeSolanaSell(user.id, mint, sellAmount);

    if (result.success && result.txHash) {
      // Update execution as CONFIRMED
      if (executionId) {
        await updateExecution({
          executionId,
          status: 'CONFIRMED',
          txSig: result.txHash,
          tokensOut: result.solReceived,
          result: { route: result.route },
        });
      }

      const explorerUrl = `https://solscan.io/tx/${result.txHash}`;

      // v3.4.2: Fetch exit market cap from DexScreener
      let exitMarketCapUsd: number | undefined;
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        const dexData = await dexRes.json() as { pairs?: Array<{ fdv?: number }> };
        if (dexData.pairs?.[0]?.fdv) {
          exitMarketCapUsd = dexData.pairs[0].fdv;
        }
      } catch {
        // Ignore
      }

      const formatMc = (mc: number | undefined) => {
        if (!mc) return '—';
        if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
        if (mc >= 1_000) return `$${(mc / 1_000).toFixed(2)}K`;
        return `$${mc.toFixed(0)}`;
      };

      await ctx.reply(
        `✅ *SELL SUCCESSFUL*\n\n` +
          `*Tokens Sold:* ${sellAmount.toLocaleString()}\n` +
          `*SOL Received:* ${result.solReceived?.toFixed(4) || '—'} SOL\n` +
          `*Route:* ${result.route || 'Unknown'}\n` +
          `*Exit MC:* ${formatMc(exitMarketCapUsd)}\n\n` +
          `[View Transaction](${explorerUrl})`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }
      );

      // If 100% sell, close the monitor
      if (percent >= 100) {
        await closeMonitorAfterSell(ctx.api, user.id, mint);
      }
    } else {
      // Update execution as FAILED
      if (executionId) {
        await updateExecution({
          executionId,
          status: 'FAILED',
          error: result.error || 'Unknown error',
        });
      }

      await ctx.reply(
        `❌ *SELL FAILED*\n\n` +
          `${escapeMarkdown(result.error || 'Unknown error')}\n\n` +
          `Please try again.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('[Callbacks] Sell from monitor error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(
      `❌ *SELL FAILED*\n\n` +
        `${escapeMarkdown(errorMsg)}\n\n` +
        `Please try again.`,
      { parse_mode: 'Markdown' }
    );
  }
}
