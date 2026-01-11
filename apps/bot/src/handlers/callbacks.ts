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
import { handleSellCallback, handleConfirmSell, handleCancelSell } from '../commands/sell.js';
import { showMenu } from '../commands/menu.js';
import { showStart } from '../commands/start.js';
import { handleBackupConfirm, showWalletInfo } from '../commands/backup.js';

// v2.3 Wallet imports
import {
  showWallets,
  showWalletCreate,
  createNewWallet,
  handleWalletSaved,
  showChainWallets,
  showWalletDetails,
  exportWalletKey,
  activateWallet,
  startDeleteWallet,
  showWalletDeposit,
} from '../commands/wallet.js';

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

export async function handleCallbackQuery(ctx: MyContext) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const user = ctx.from;
  if (!user) return;

  try {
    // === NAVIGATION ===
    if (data === 'back_to_menu' || data === 'menu') {
      await showMenu(ctx);
      return;
    }

    if (data === 'back_to_start') {
      await showStart(ctx);
      return;
    }

    // === START / ONBOARDING ===
    if (data === 'start_generate_wallet') {
      await showGenerateWallet(ctx);
      return;
    }

    if (data.startsWith('generate_wallet_')) {
      const chain = data.replace('generate_wallet_', '') as Chain;
      await generateWalletForChain(ctx, chain);
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

    if (data === 'back_to_wallet' || data === 'menu_wallet' || data === 'wallets') {
      await showWallets(ctx);
      return;
    }

    if (data === 'back_to_hunt' || data === 'menu_hunt' || data === 'hunt') {
      await showHunt(ctx);
      return;
    }

    if (data === 'menu_positions' || data === 'positions') {
      await showPositionsList(ctx);
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

    // === SETTINGS CALLBACKS ===
    if (data === 'settings_strategy') {
      await showStrategy(ctx);
      return;
    }

    if (data === 'settings_gas') {
      await showGas(ctx);
      return;
    }

    if (data === 'settings_slippage') {
      await showSlippage(ctx);
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
        await setCustomTp(ctx, parseInt(value));
      }
      return;
    }

    // Custom strategy value setters - SL
    if (data.startsWith('custom_sl_')) {
      const value = data.replace('custom_sl_', '');
      if (value === 'input') {
        await requestCustomInput(ctx, 'sl');
      } else {
        await setCustomSl(ctx, parseInt(value));
      }
      return;
    }

    // Custom strategy value setters - Max Hold
    if (data.startsWith('custom_hold_')) {
      const value = data.replace('custom_hold_', '');
      if (value === 'input') {
        await requestCustomInput(ctx, 'maxhold');
      } else {
        await setCustomHold(ctx, parseInt(value));
      }
      return;
    }

    // Custom strategy value setters - Moon Bag
    if (data.startsWith('custom_moon_')) {
      const value = parseInt(data.replace('custom_moon_', ''));
      await setCustomMoonBag(ctx, value);
      return;
    }

    // Custom strategy value setters - Slippage
    if (data.startsWith('custom_slip_')) {
      const value = parseInt(data.replace('custom_slip_', ''));
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
      await setCustomLiquidity(ctx, value);
      return;
    }

    // Custom strategy value setters - Market Cap
    if (data.startsWith('custom_mcap_')) {
      const value = parseInt(data.replace('custom_mcap_', ''));
      await setCustomMcap(ctx, value);
      return;
    }

    // Custom strategy value setters - Min Score
    if (data.startsWith('custom_score_')) {
      const value = parseInt(data.replace('custom_score_', ''));
      await setCustomMinScore(ctx, value);
      return;
    }

    // Custom strategy value setters - Max Tax
    if (data.startsWith('custom_tax_')) {
      const value = parseInt(data.replace('custom_tax_', ''));
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
        await setMaxTip(ctx, chain as Chain, parseFloat(maxStr));
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
        await setSlippage(ctx, chain as Chain, parseInt(bpsStr));
        return;
      }
      return;
    }

    // === POSITION SIZE CALLBACKS ===
    if (data.startsWith('size_set_')) {
      const percent = parseInt(data.replace('size_set_', ''));
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
      // TODO: Show transaction history
      await ctx.answerCallbackQuery({ text: 'History coming soon' });
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
        await setMinScore(ctx, chain as Chain, parseInt(scoreStr));
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

    // === POSITION CALLBACKS ===
    // View position (pos_view_123)
    if (data.startsWith('pos_view_')) {
      const positionId = parseInt(data.replace('pos_view_', ''));
      await showPositionDetail(ctx, positionId);
      return;
    }

    // Sell position (pos_123_sell_25, etc.)
    if (data.match(/^pos_\d+_sell_\d+$/)) {
      const parts = data.split('_');
      const positionId = parseInt(parts[1]);
      const percent = parseInt(parts[3]);
      // Convert to legacy format for existing handler
      await handleSellCallback(ctx, `sell:${positionId}:${percent}`);
      return;
    }

    // Edit position TP/SL (pos_123_edit)
    if (data.match(/^pos_\d+_edit$/)) {
      const positionId = parseInt(data.replace('pos_', '').replace('_edit', ''));
      await showEditTpSl(ctx, positionId);
      return;
    }

    // Back to positions
    if (data === 'back_to_positions') {
      await showPositionsList(ctx);
      return;
    }

    // Set TP for position (set_tp_123_50)
    if (data.match(/^set_tp_\d+_\d+$/)) {
      const parts = data.split('_');
      const positionId = parseInt(parts[2]);
      const tp = parseInt(parts[3]);
      await setPositionTp(ctx, positionId, tp);
      return;
    }

    // Set SL for position (set_sl_123_30)
    if (data.match(/^set_sl_\d+_\d+$/)) {
      const parts = data.split('_');
      const positionId = parseInt(parts[2]);
      const sl = parseInt(parts[3]);
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
    if (data.startsWith('sell:')) {
      await handleSellCallback(ctx, data);
      return;
    }

    // Confirm sell callback (confirm_sell:<positionId>:<amount>)
    if (data.startsWith('confirm_sell:')) {
      await handleConfirmSell(ctx, data);
      return;
    }

    // Cancel sell
    if (data === 'cancel_sell') {
      await handleCancelSell(ctx);
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

    // Unhandled callback
    console.log(`[Callbacks] Unhandled callback: ${data}`);
    await ctx.answerCallbackQuery();
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

  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 *SEND ${symbol}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*To:* \`${address.slice(0, 10)}...${address.slice(-8)}\`

Select amount to send:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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

  const chainName = chain === 'sol' ? 'Solana' : chain === 'bsc' ? 'BSC' : chain === 'base' ? 'Base' : 'Ethereum';
  const chainEmoji = chain === 'sol' ? '🟢' : chain === 'bsc' ? '🟡' : chain === 'base' ? '🔵' : '🟣';
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  // Fetch all data in parallel for speed
  const { tokenData, goplus, pumpfun } = await import('@raptor/shared');

  try {
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

      message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎰 *${pumpInfo.symbol}* — Pump.fun
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*${pumpInfo.name}*
${curveStatus.emoji} ${curveStatus.label}

💰 *Price:* ${pumpInfo.priceInSol.toFixed(9)} SOL
📊 *MCap:* ${pumpInfo.marketCapSol.toFixed(2)} SOL

*Bonding Curve:*
${progressBar} ${pumpInfo.bondingCurveProgress.toFixed(1)}%
💎 ${pumpInfo.realSolReserves.toFixed(2)} / ~85 SOL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 [Pump.fun](${links.pumpfun}) • [DexScreener](${links.dexscreener})
\`${address}\``;
    } else if (tokenInfo) {
      const priceStr = tokenData.formatPrice(tokenInfo.priceUsd);
      const mcapStr = tokenData.formatLargeNumber(tokenInfo.marketCap);
      const liqStr = tokenData.formatLargeNumber(tokenInfo.liquidity);
      const volStr = tokenData.formatLargeNumber(tokenInfo.volume24h);
      const changeStr = tokenData.formatPercentage(tokenInfo.priceChange24h);
      const changeEmoji = (tokenInfo.priceChange24h ?? 0) >= 0 ? '🟢' : '🔴';

      const securityBadge = security
        ? goplus.getRiskBadge(security)
        : tokenData.getSecurityBadge(tokenInfo.riskScore);

      let securitySection = `\n*Security:* ${securityBadge.emoji} ${securityBadge.label}`;
      if (security) {
        if (security.buyTax > 0 || security.sellTax > 0) {
          securitySection += `\n💸 Tax: ${security.buyTax.toFixed(1)}%/${security.sellTax.toFixed(1)}%`;
        }
        if (security.risks.length > 0) {
          securitySection += `\n${security.risks.slice(0, 2).join('\n')}`;
        }
      }

      const dexLink = `https://dexscreener.com/${chain === 'sol' ? 'solana' : chain}/${address}`;

      message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${chainEmoji} *${tokenInfo.symbol}* — ${chainName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*${tokenInfo.name}*

💰 *Price:* ${priceStr}
${changeEmoji} *24h:* ${changeStr}

📊 *MCap:* ${mcapStr}
💧 *Liq:* ${liqStr}
📈 *Vol:* ${volStr}
${tokenInfo.holders ? `👥 *Holders:* ${tokenInfo.holders.toLocaleString()}` : ''}
${securitySection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 [DexScreener](${dexLink})
\`${address}\``;
    } else {
      message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${chainEmoji} *TOKEN* — ${chainName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *New/Unlisted Token*

Data not available. Proceed with caution.

\`${address}\``;
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

    keyboard
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
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

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

  const { toAddress, chain, amount } = ctx.session.pendingSend;
  if (!amount) {
    await ctx.answerCallbackQuery({ text: 'No amount specified' });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Processing...' });

  // TODO: Implement actual send transaction
  await ctx.editMessageText(
    `✅ *Transaction Submitted*

Sending ${amount} to \`${toAddress.slice(0, 10)}...${toAddress.slice(-8)}\`

_Transaction processing..._`,
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
    // TODO: Prompt for custom amount
    await ctx.answerCallbackQuery({ text: 'Enter custom amount via /snipe' });
    return;
  }

  // TODO: Execute buy transaction
  await ctx.answerCallbackQuery({ text: `Buying ${amount} worth on ${chain}...` });
}

async function handleAnalyzeToken(ctx: MyContext, chain: Chain, tokenAddress: string) {
  const user = ctx.from;
  if (!user) return;

  await ctx.answerCallbackQuery({ text: 'Analyzing token...' });

  // TODO: Show token analysis
  await handleScoreRequest(ctx, tokenAddress);
}

async function handleWithdrawConfirm(ctx: MyContext) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain, amount, address } = ctx.session.pendingWithdrawal;

  if (!address || !amount) {
    await ctx.editMessageText('❌ Missing withdrawal details. Please try again.');
    ctx.session.step = null;
    ctx.session.pendingWithdrawal = null;
    return;
  }

  await ctx.editMessageText('⏳ Processing withdrawal...');

  try {
    const tx = await processWithdrawal(user.id, chain, amount, address);

    const token = chain === 'bsc' ? 'BNB' : 'ETH';
    const explorer = chain === 'bsc' ? 'bscscan.com' : 'basescan.org';

    await ctx.editMessageText(
      `✅ *Withdrawal Sent*\n\n` +
        `Amount: ${parseFloat(amount).toFixed(4)} ${token}\n` +
        `TX: [View on Explorer](https://${explorer}/tx/${tx.hash})\n\n` +
        `_Funds should arrive within a few minutes._`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('[Callbacks] Withdrawal error:', error);
    await ctx.editMessageText('❌ Withdrawal failed. Please try again or contact support.');
  }

  ctx.session.step = null;
  ctx.session.pendingWithdrawal = null;
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

async function generateWalletForChain(ctx: MyContext, chain: Chain) {
  const user = ctx.from;
  if (!user) return;

  await ctx.answerCallbackQuery({ text: 'Generating wallet...' });

  try {
    // Import the new wallet service
    const { initializeUserWallet } = await import('../services/wallet.js');

    // Generate wallet (creates both Solana and EVM keypairs)
    const { solana, evm, isNew } = await initializeUserWallet(user.id);

    // Get the address for the selected chain
    const address = chain === 'sol' ? solana.address : evm.address;
    const chainEmoji = chain === 'sol' ? '🟣' : chain === 'bsc' ? '🟡' : chain === 'base' ? '🔵' : '⚪';
    const chainName = chain === 'sol' ? 'Solana' : chain === 'bsc' ? 'BSC' : chain === 'base' ? 'Base' : 'Ethereum';
    const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
    const minDeposit =
      chain === 'sol' ? '0.05 SOL' : chain === 'bsc' ? '0.01 BNB' : chain === 'base' ? '0.005 ETH' : '0.01 ETH';

    const message = `✅ *Wallet ${isNew ? 'Created' : 'Ready'}!*

${chainEmoji} *${chainName} Deposit Address:*
\`${address}\`

_(tap to copy)_

━━━━━━━━━━━━━━━━━━━━━━

*Your Wallet Addresses:*
🟣 Solana: \`${solana.address.slice(0, 8)}...${solana.address.slice(-6)}\`
⚪ EVM: \`${evm.address.slice(0, 8)}...${evm.address.slice(-4)}\`

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
      .text('🦅 Setup Hunt', 'menu_hunt')
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
  const message = `📖 *How RAPTOR Works*

━━━━━━━━━━━━━━━━━━━━━━

🔐 *1. Generate Wallet*
Create a trading wallet for SOL, ETH, or BNB. Each chain has its own address.

💰 *2. Deposit Funds*
Send crypto to your deposit address. Funds are detected automatically.

🦅 *3. Hunt Mode*
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

━━━━━━━━━━━━━━━━━━━━━━

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
      .text('🦅 Hunt Settings', 'menu_hunt')
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
    const chainEmoji = pos.chain === 'sol' ? '🟢' : pos.chain === 'bsc' ? '🟡' : pos.chain === 'base' ? '🔵' : '🟣';

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

  const chainEmoji = pos.chain === 'sol' ? '🟢' : pos.chain === 'bsc' ? '🟡' : pos.chain === 'base' ? '🔵' : '🟣';
  const chainName = pos.chain === 'sol' ? 'Solana' : pos.chain === 'bsc' ? 'BSC' : pos.chain === 'base' ? 'Base' : 'ETH';
  const symbol = pos.chain === 'sol' ? 'SOL' : pos.chain === 'bsc' ? 'BNB' : 'ETH';
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

async function showHelpMenu(ctx: MyContext) {
  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❓ *HELP & GUIDES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Select a topic to learn more:

📖 *Getting Started*
How to set up and start trading

💰 *Deposits & Withdrawals*
Managing your funds

🦅 *Auto-Hunt*
Automatic token sniping

📊 *Strategies*
Trading strategy explanations

💸 *Fees*
How fees work

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard()
    .text('📖 Getting Started', 'help_start')
    .row()
    .text('💰 Deposits', 'help_deposits')
    .text('🦅 Auto-Hunt', 'help_hunt')
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
  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 *DEPOSITS & WITHDRAWALS*
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
⚠️ Double-check addresses before sending

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🦅 *AUTO-HUNT GUIDE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

*What is Auto-Hunt?*
RAPTOR monitors new token launches 24/7
and automatically buys tokens that pass
our safety scoring system.

*How It Works:*
1. New token detected on launchpad
2. Safety analysis runs (0-35 score)
3. If score >= your minimum, buy executes
4. Position tracked with your strategy

*Safety Score Breakdown:*
• 0-14: Skip (dangerous)
• 15-22: Tiny positions only
• 23-28: Normal tradable
• 29-35: Highest quality

*Configurable Settings:*
• Min Score: Higher = safer, fewer trades
• Position Size: Max bet per trade
• Launchpads: Which platforms to monitor

*Supported Launchpads:*
🟢 SOL: Pump.fun, PumpSwap, Moonshot
🟡 BSC: Four.meme
🔵 Base: Virtuals, WOW.xyz

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const keyboard = new InlineKeyboard()
    .text('🦅 Configure Hunt', 'menu_hunt')
    .row()
    .text('« Back', 'help');

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });

  await ctx.answerCallbackQuery();
}

async function showHelpStrategies(ctx: MyContext) {
  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *TRADING STRATEGIES*
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
filters, and protection settings.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
  const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💸 *FEES EXPLAINED*
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
This aligns our incentives with yours.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
