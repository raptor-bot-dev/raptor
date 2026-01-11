/**
 * Reusable Keyboard Builders for RAPTOR v2.3
 *
 * Provides consistent UI patterns across all bot commands.
 * Features wider 2-column layouts and back buttons on all screens.
 */

import { InlineKeyboard } from 'grammy';
import type { Chain, TradingStrategy, TradingMode } from '@raptor/shared';

// ============================================================================
// Constants
// ============================================================================

// Chain emoji mapping (v2.3 uses status colors)
export const CHAIN_EMOJI: Record<Chain, string> = {
  sol: '🟢',  // Green for Solana
  bsc: '🟡',  // Yellow for BSC
  base: '🔵', // Blue for Base
  eth: '🟣',  // Purple for Ethereum
};

// Chain name mapping
export const CHAIN_NAME: Record<Chain, string> = {
  sol: 'Solana',
  bsc: 'BSC',
  base: 'Base',
  eth: 'Ethereum',
};

// Strategy emoji mapping
export const STRATEGY_EMOJI: Record<TradingStrategy, string> = {
  MICRO_SCALP: '⚡',
  STANDARD: '📊',
  MOON_BAG: '🌙',
  DCA_EXIT: '📈',
  TRAILING: '🎯',
};

// Mode emoji mapping
export const MODE_EMOJI: Record<TradingMode, string> = {
  pool: '🏊',
  solo: '👤',
  snipe: '🎯',
};

/**
 * Main menu keyboard (v2.3 wide layout)
 */
export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔗 Chains', 'chains')
    .row()
    .text('💳 Wallets', 'wallets')
    .text('⚙️ Settings', 'settings')
    .row()
    .text('🦖 Auto Hunt', 'hunt')
    .text('📋 Copytrade', 'copytrade')
    .row()
    .text('📊 Positions', 'positions')
    .text('📜 Orders', 'orders')
    .row()
    .text('💎 Premium', 'premium')
    .text('🌉 Bridge', 'bridge')
    .row()
    .text('💸 Cashback', 'cashback')
    .text('🎁 Referral', 'referral')
    .row()
    .text('⚡ BUY & SELL NOW!', 'quick_trade');
}

/**
 * Welcome screen keyboard (first-time user)
 */
export function welcomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🦖 Get Started', 'start_generate_wallet');
}

/**
 * Back button keyboard
 */
export function backKeyboard(destination: string = 'menu'): InlineKeyboard {
  return new InlineKeyboard().text('← Back', `back_to_${destination}`);
}

/**
 * Back button with additional action
 */
export function backWithActionKeyboard(
  destination: string,
  actionText: string,
  actionCallback: string
): InlineKeyboard {
  return new InlineKeyboard()
    .text(actionText, actionCallback)
    .row()
    .text('← Back', `back_to_${destination}`);
}

/**
 * Chain selection keyboard
 */
export function chainsKeyboard(callbackPrefix: string, showAll: boolean = true): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(`${CHAIN_EMOJI.sol} Solana`, `${callbackPrefix}_sol`)
    .text(`${CHAIN_EMOJI.bsc} BSC`, `${callbackPrefix}_bsc`)
    .row()
    .text(`${CHAIN_EMOJI.base} Base`, `${callbackPrefix}_base`)
    .text(`${CHAIN_EMOJI.eth} ETH`, `${callbackPrefix}_eth`);

  if (showAll) {
    kb.row().text('📋 All Chains', `${callbackPrefix}_all`);
  }

  return kb;
}

/**
 * Chain selection with back button
 */
export function chainsWithBackKeyboard(
  callbackPrefix: string,
  backDestination: string = 'menu'
): InlineKeyboard {
  return new InlineKeyboard()
    .text(`${CHAIN_EMOJI.sol} Solana`, `${callbackPrefix}_sol`)
    .text(`${CHAIN_EMOJI.bsc} BSC`, `${callbackPrefix}_bsc`)
    .row()
    .text(`${CHAIN_EMOJI.base} Base`, `${callbackPrefix}_base`)
    .text(`${CHAIN_EMOJI.eth} ETH`, `${callbackPrefix}_eth`)
    .row()
    .text('← Back', `back_to_${backDestination}`);
}

/**
 * Confirm/Cancel keyboard
 */
export function confirmKeyboard(
  confirmCallback: string,
  cancelCallback: string = 'back_to_menu'
): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm', confirmCallback)
    .text('❌ Cancel', cancelCallback);
}

/**
 * Percentage selection keyboard (for position sizing, slippage, etc.)
 */
export function percentagesKeyboard(
  callbackPrefix: string,
  percentages: number[] = [25, 50, 75, 100]
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Add percentage buttons in rows of 2
  for (let i = 0; i < percentages.length; i += 2) {
    if (i > 0) kb.row();
    kb.text(`${percentages[i]}%`, `${callbackPrefix}_${percentages[i]}`);
    if (i + 1 < percentages.length) {
      kb.text(`${percentages[i + 1]}%`, `${callbackPrefix}_${percentages[i + 1]}`);
    }
  }

  kb.row().text('✏️ Custom', `${callbackPrefix}_custom`);

  return kb;
}

/**
 * Wallet menu keyboard (v2.3 multi-wallet)
 */
export function walletKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Create', 'wallet_create')
    .text('📥 Import', 'wallet_import')
    .row()
    .text('🔄 Refresh', 'wallet_refresh')
    .row()
    .text('« Back', 'back_to_menu');
}

/**
 * Wallet chain selection keyboard
 */
export function walletChainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(`${CHAIN_EMOJI.sol} Solana`, 'wallet_chain_sol')
    .text(`${CHAIN_EMOJI.bsc} BSC`, 'wallet_chain_bsc')
    .row()
    .text(`${CHAIN_EMOJI.base} Base`, 'wallet_chain_base')
    .text(`${CHAIN_EMOJI.eth} Ethereum`, 'wallet_chain_eth')
    .row()
    .text('« Back', 'back_to_wallets');
}

/**
 * Wallet list keyboard for a chain (shows wallet selection)
 */
export function walletListKeyboard(
  chain: Chain,
  wallets: Array<{ index: number; label: string; isActive: boolean }>
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const wallet of wallets) {
    const marker = wallet.isActive ? ' ✓' : '';
    kb.text(`#${wallet.index} ${wallet.label}${marker}`, `wallet_select_${chain}_${wallet.index}`);
    kb.row();
  }

  // Add create button if less than 5 wallets
  if (wallets.length < 5) {
    kb.text('➕ Create New', `wallet_create_${chain}`);
    kb.row();
  }

  kb.text('« Back', 'back_to_wallets');

  return kb;
}

/**
 * Wallet actions keyboard (for selected wallet)
 */
export function walletActionsKeyboard(chain: Chain, walletIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('📥 Deposit', `wallet_deposit_${chain}_${walletIndex}`)
    .text('📤 Withdraw', `wallet_withdraw_${chain}_${walletIndex}`)
    .row()
    .text('🔑 Export Key', `wallet_export_${chain}_${walletIndex}`)
    .text('✏️ Rename', `wallet_rename_${chain}_${walletIndex}`)
    .row()
    .text('⭐ Set Active', `wallet_activate_${chain}_${walletIndex}`)
    .text('🗑️ Delete', `wallet_delete_${chain}_${walletIndex}`)
    .row()
    .text('« Back', `wallet_chain_${chain}`);
}

/**
 * Delete wallet confirmation keyboard
 */
export function deleteWalletConfirmKeyboard(chain: Chain, walletIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('❌ Cancel', `wallet_chain_${chain}`)
    .row()
    .text('⚠️ Type DELETE to confirm', 'noop');
}

/**
 * Withdrawal amount selection keyboard
 */
export function withdrawAmountKeyboard(chain: Chain, walletIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('25%', `withdraw_pct_${chain}_${walletIndex}_25`)
    .text('50%', `withdraw_pct_${chain}_${walletIndex}_50`)
    .row()
    .text('75%', `withdraw_pct_${chain}_${walletIndex}_75`)
    .text('100%', `withdraw_pct_${chain}_${walletIndex}_100`)
    .row()
    .text('💬 Custom Amount', `withdraw_custom_${chain}_${walletIndex}`)
    .row()
    .text('« Cancel', `wallet_select_${chain}_${walletIndex}`);
}

/**
 * Settings menu keyboard (v2.3 wide layout)
 */
export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🛒 Buy', 'settings_buy')
    .text('💰 Sell', 'settings_sell')
    .row()
    .text('🛡️ Anti Rug', 'settings_antirug')
    .text('🔒 MEV Protect', 'settings_mev')
    .row()
    .text('💀 Degen Mode', 'settings_degen')
    .text('📊 Token View', 'settings_tokenview')
    .row()
    .text('💵 Include Fees', 'settings_fees')
    .row()
    .text('🎯 Strategy', 'settings_strategy')
    .text('🔔 Notifications', 'settings_notifications')
    .row()
    .text('« Back', 'back_to_menu');
}

/**
 * Chains selection keyboard (v2.3)
 */
export function chainsSelectionKeyboard(enabledChains: Chain[]): InlineKeyboard {
  const kb = new InlineKeyboard();

  const chains: Chain[] = ['sol', 'bsc', 'base', 'eth'];

  for (const chain of chains) {
    const isEnabled = enabledChains.includes(chain);
    const status = isEnabled ? '✓' : '✗';
    kb.text(`${CHAIN_EMOJI[chain]} ${CHAIN_NAME[chain]} ${status}`, `toggle_chain_${chain}`);
    kb.row();
  }

  kb.text('« Back', 'back_to_menu');

  return kb;
}

/**
 * Strategy selection keyboard
 */
export function strategiesKeyboard(currentStrategy?: TradingStrategy): InlineKeyboard {
  const strategies: { key: TradingStrategy; label: string }[] = [
    { key: 'MICRO_SCALP', label: '⚡ Micro Scalp' },
    { key: 'STANDARD', label: '📊 Standard' },
    { key: 'MOON_BAG', label: '🌙 Moon Bag' },
    { key: 'DCA_EXIT', label: '📈 DCA Exit' },
    { key: 'TRAILING', label: '🎯 Trailing' },
  ];

  const kb = new InlineKeyboard();

  for (let i = 0; i < strategies.length; i += 2) {
    if (i > 0) kb.row();
    const s1 = strategies[i];
    const isActive1 = currentStrategy === s1.key;
    kb.text(isActive1 ? `${s1.label} ✓` : s1.label, `strategy_${s1.key}`);

    if (i + 1 < strategies.length) {
      const s2 = strategies[i + 1];
      const isActive2 = currentStrategy === s2.key;
      kb.text(isActive2 ? `${s2.label} ✓` : s2.label, `strategy_${s2.key}`);
    }
  }

  kb.row().text('← Back', 'back_to_settings');

  return kb;
}

/**
 * Gas speed selection keyboard
 */
export function gasSpeedKeyboard(chain: Chain, currentSpeed?: string): InlineKeyboard {
  const speeds = [
    { key: 'slow', label: '🐢 Slow', desc: 'Cheaper' },
    { key: 'normal', label: '🚗 Normal', desc: 'Balanced' },
    { key: 'fast', label: '🚀 Fast', desc: 'Quick' },
    { key: 'turbo', label: '⚡ Turbo', desc: 'Priority' },
  ];

  const kb = new InlineKeyboard();

  for (let i = 0; i < speeds.length; i += 2) {
    if (i > 0) kb.row();
    const s1 = speeds[i];
    const isActive1 = currentSpeed === s1.key;
    kb.text(isActive1 ? `${s1.label} ✓` : s1.label, `gas_${chain}_${s1.key}`);

    const s2 = speeds[i + 1];
    const isActive2 = currentSpeed === s2.key;
    kb.text(isActive2 ? `${s2.label} ✓` : s2.label, `gas_${chain}_${s2.key}`);
  }

  kb.row().text('← Back', 'back_to_gas');

  return kb;
}

/**
 * Slippage selection keyboard
 */
export function slippageKeyboard(chain: Chain, currentBps?: number): InlineKeyboard {
  const options = [
    { bps: 500, label: '5%' },
    { bps: 1000, label: '10%' },
    { bps: 1500, label: '15%' },
    { bps: 2000, label: '20%' },
  ];

  const kb = new InlineKeyboard();

  for (let i = 0; i < options.length; i += 2) {
    if (i > 0) kb.row();
    const o1 = options[i];
    const isActive1 = currentBps === o1.bps;
    kb.text(isActive1 ? `${o1.label} ✓` : o1.label, `slip_${chain}_${o1.bps}`);

    const o2 = options[i + 1];
    const isActive2 = currentBps === o2.bps;
    kb.text(isActive2 ? `${o2.label} ✓` : o2.label, `slip_${chain}_${o2.bps}`);
  }

  kb.row()
    .text('✏️ Custom', `slip_${chain}_custom`)
    .row()
    .text('← Back', 'back_to_slippage');

  return kb;
}

/**
 * Position actions keyboard
 */
export function positionActionsKeyboard(positionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Sell 25%', `pos_${positionId}_sell_25`)
    .text('💰 Sell 50%', `pos_${positionId}_sell_50`)
    .row()
    .text('💰 Sell 75%', `pos_${positionId}_sell_75`)
    .text('💰 Sell 100%', `pos_${positionId}_sell_100`)
    .row()
    .text('✏️ Edit TP/SL', `pos_${positionId}_edit`)
    .row()
    .text('← Back', 'back_to_positions');
}

/**
 * Snipe confirmation keyboard
 */
export function snipeConfirmKeyboard(token: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm Buy', `snipe_confirm_${token}`)
    .text('✏️ Adjust', `snipe_adjust_${token}`)
    .row()
    .text('❌ Cancel', 'back_to_menu');
}

/**
 * Hunt settings keyboard for a chain
 */
export function huntKeyboard(chain: Chain, isEnabled: boolean): InlineKeyboard {
  const statusText = isEnabled ? '⏸️ Pause Hunt' : '▶️ Start Hunt';
  const statusCallback = isEnabled ? `hunt_pause_${chain}` : `hunt_start_${chain}`;

  return new InlineKeyboard()
    .text(statusText, statusCallback)
    .row()
    .text('🎚️ Min Score', `hunt_score_${chain}`)
    .text('💰 Position Size', `hunt_size_${chain}`)
    .row()
    .text('🚀 Launchpads', `hunt_launchpads_${chain}`)
    .row()
    .text('← Back', 'back_to_hunt');
}

/**
 * Help menu keyboard
 */
export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📖 Getting Started', 'help_start')
    .text('💰 Deposits', 'help_deposits')
    .row()
    .text('📈 Strategies', 'help_strategies')
    .text('🎯 Sniping', 'help_sniping')
    .row()
    .text('⚙️ Settings', 'help_settings')
    .text('💸 Fees', 'help_fees')
    .row()
    .text('← Back', 'back_to_menu');
}

/**
 * Notification settings keyboard
 */
export function notificationsKeyboard(settings: {
  onEntry: boolean;
  onExit: boolean;
  onGraduation: boolean;
  onHoneypot: boolean;
  dailySummary: boolean;
}): InlineKeyboard {
  const toggle = (enabled: boolean) => enabled ? '✅' : '❌';

  return new InlineKeyboard()
    .text(`${toggle(settings.onEntry)} Entry Alerts`, 'notif_toggle_entry')
    .text(`${toggle(settings.onExit)} Exit Alerts`, 'notif_toggle_exit')
    .row()
    .text(`${toggle(settings.onGraduation)} Graduations`, 'notif_toggle_graduation')
    .text(`${toggle(settings.onHoneypot)} Honeypot Warns`, 'notif_toggle_honeypot')
    .row()
    .text(`${toggle(settings.dailySummary)} Daily Summary`, 'notif_toggle_daily')
    .row()
    .text('← Back', 'back_to_settings');
}

/**
 * Mode selection keyboard (pool/solo/snipe)
 */
export function modeSelectionKeyboard(callbackPrefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text(`${MODE_EMOJI.pool} Pool Mode`, `${callbackPrefix}_pool`)
    .row()
    .text(`${MODE_EMOJI.solo} Solo Mode`, `${callbackPrefix}_solo`)
    .row()
    .text(`${MODE_EMOJI.snipe} Snipe Mode`, `${callbackPrefix}_snipe`);
}

/**
 * Yes/No keyboard
 */
export function yesNoKeyboard(yesCallback: string, noCallback: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes', yesCallback)
    .text('❌ No', noCallback);
}

/**
 * Pagination keyboard
 */
export function paginationKeyboard(
  currentPage: number,
  totalPages: number,
  callbackPrefix: string
): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (currentPage > 1) {
    kb.text('« First', `${callbackPrefix}_1`);
    kb.text('‹ Prev', `${callbackPrefix}_${currentPage - 1}`);
  }

  kb.text(`${currentPage}/${totalPages}`, 'noop');

  if (currentPage < totalPages) {
    kb.text('Next ›', `${callbackPrefix}_${currentPage + 1}`);
    kb.text('Last »', `${callbackPrefix}_${totalPages}`);
  }

  return kb;
}

/**
 * Position list keyboard (shows numbered positions with quick actions)
 */
export function positionsListKeyboard(
  positions: { id: number; symbol: string; pnlPercent: number }[]
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (let i = 0; i < positions.length && i < 5; i++) {
    const pos = positions[i];
    const pnlEmoji = pos.pnlPercent >= 0 ? '🟢' : '🔴';
    const pnlStr = pos.pnlPercent >= 0 ? `+${pos.pnlPercent.toFixed(1)}%` : `${pos.pnlPercent.toFixed(1)}%`;
    kb.text(`${i + 1}. ${pos.symbol} ${pnlEmoji} ${pnlStr}`, `pos_view_${pos.id}`);
    kb.row();
  }

  kb.text('« Back', 'back_to_menu');

  return kb;
}

// ============================================================================
// v2.3 Strategy Customization Keyboards
// ============================================================================

/**
 * Strategy preset selection keyboard
 */
export function strategyPresetsKeyboard(current: TradingStrategy): InlineKeyboard {
  const strategies: Array<{ key: TradingStrategy; emoji: string; name: string }> = [
    { key: 'MICRO_SCALP', emoji: '⚡', name: 'Micro Scalp' },
    { key: 'STANDARD', emoji: '📈', name: 'Standard' },
    { key: 'MOON_BAG', emoji: '🌙', name: 'Moon Bag' },
    { key: 'DCA_EXIT', emoji: '📊', name: 'DCA Exit' },
    { key: 'TRAILING', emoji: '🎯', name: 'Trailing' },
  ];

  const kb = new InlineKeyboard();

  for (const s of strategies) {
    const marker = s.key === current ? ' ✓' : '';
    kb.text(`${s.emoji} ${s.name}${marker}`, `strategy_view_${s.key}`);
    kb.row();
  }

  kb.text('🔧 Custom Strategy', 'strategy_custom');
  kb.row();
  kb.text('« Back', 'back_to_settings');

  return kb;
}

/**
 * Strategy detail keyboard (view + set)
 */
export function strategyDetailKeyboard(strategy: TradingStrategy): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Use This Strategy', `strategy_set_${strategy}`)
    .row()
    .text('« Back', 'back_to_strategy');
}

/**
 * Custom strategy page keyboard (multi-page navigation)
 */
export function customStrategyPageKeyboard(page: number, totalPages: number = 5): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Add page-specific buttons based on current page
  switch (page) {
    case 1: // Core settings
      kb.text('📈 Set TP', 'custom_tp').text('📉 Set SL', 'custom_sl').row();
      kb.text('⏱️ Set Max Hold', 'custom_maxhold').row();
      break;
    case 2: // Advanced exits
      kb.text('🎯 Trailing', 'custom_trailing').text('📊 Ladder', 'custom_ladder').row();
      kb.text('🌙 Moon Bag %', 'custom_moonbag').row();
      break;
    case 3: // Filters
      kb.text('💧 Liquidity', 'custom_liquidity').text('💰 Max MCap', 'custom_mcap').row();
      kb.text('📊 Min Score', 'custom_score').text('📈 Max Taxes', 'custom_taxes').row();
      break;
    case 4: // Protection
      kb.text('🛡️ Anti-Rug', 'custom_antirug').row();
      kb.text('🔒 Anti-MEV', 'custom_mev').row();
      kb.text('✅ Auto-Approve', 'custom_approve').row();
      kb.text('Ⓢ Slippage', 'custom_slip').text('⛽ Gas', 'custom_gas').row();
      break;
    case 5: // Review
      kb.text('💾 Save as My Strategy', 'custom_save').row();
      kb.text('🔄 Reset to Default', 'custom_reset').row();
      break;
  }

  // Navigation
  const navRow = [];
  if (page > 1) {
    navRow.push({ text: '← Prev', callback: `custom_page_${page - 1}` });
  }
  if (page < totalPages) {
    navRow.push({ text: 'Next →', callback: `custom_page_${page + 1}` });
  }

  if (navRow.length > 0) {
    for (const btn of navRow) {
      kb.text(btn.text, btn.callback);
    }
    kb.row();
  }

  kb.text('« Back', 'back_to_strategy');

  return kb;
}

/**
 * Percentage selection keyboard (for TP/SL/etc)
 */
export function percentageSelectKeyboard(
  callbackPrefix: string,
  options: number[] = [10, 25, 50, 75, 100, 150, 200, 300]
): InlineKeyboard {
  const kb = new InlineKeyboard();

  // 4 per row
  for (let i = 0; i < options.length; i += 4) {
    for (let j = i; j < Math.min(i + 4, options.length); j++) {
      kb.text(`${options[j]}%`, `${callbackPrefix}_${options[j]}`);
    }
    kb.row();
  }

  kb.text('✏️ Custom', `${callbackPrefix}_custom`);
  kb.row();
  kb.text('« Back', 'back_to_custom');

  return kb;
}

// ============================================================================
// v2.3 Transfer/Send Keyboards
// ============================================================================

/**
 * Send options keyboard (when user pastes an address)
 */
export function sendOptionsKeyboard(chain: Chain): InlineKeyboard {
  const nativeToken = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  return new InlineKeyboard()
    .text(`${CHAIN_EMOJI[chain]} Send ${nativeToken}`, `send_native_${chain}`)
    .row()
    .text('🪙 Send Token (paste CA)', `send_token_${chain}`)
    .row()
    .text('« Cancel', 'back_to_menu');
}

/**
 * Amount selection keyboard (for sends)
 */
export function amountSelectKeyboard(callbackPrefix: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('25%', `${callbackPrefix}_25`)
    .text('50%', `${callbackPrefix}_50`)
    .row()
    .text('75%', `${callbackPrefix}_75`)
    .text('100%', `${callbackPrefix}_100`)
    .row()
    .text('✏️ Custom Amount', `${callbackPrefix}_custom`)
    .row()
    .text('« Cancel', 'back_to_menu');
}

// ============================================================================
// v2.3 Token Card Keyboards
// ============================================================================

/**
 * Token buy card keyboard
 */
export function tokenBuyKeyboard(
  chain: Chain,
  tokenAddress: string,
  amounts: string[] = ['0.1', '0.5', '1', '5']
): InlineKeyboard {
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
  const kb = new InlineKeyboard();

  // Amount buttons
  for (let i = 0; i < amounts.length; i += 2) {
    kb.text(`🛒 ${amounts[i]} ${symbol}`, `buy_${chain}_${tokenAddress}_${amounts[i]}`);
    if (i + 1 < amounts.length) {
      kb.text(`🛒 ${amounts[i + 1]} ${symbol}`, `buy_${chain}_${tokenAddress}_${amounts[i + 1]}`);
    }
    kb.row();
  }

  kb.text('🛒 X', `buy_${chain}_${tokenAddress}_custom`);
  kb.row();
  kb.text('🔄 Refresh', `refresh_token_${chain}_${tokenAddress}`);
  kb.row();
  kb.text('« Back', 'back_to_menu');

  return kb;
}

/**
 * Token sell card keyboard (for position)
 */
export function tokenSellKeyboard(positionId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Sell 25%', `sell_${positionId}_25`)
    .text('💰 Sell 50%', `sell_${positionId}_50`)
    .row()
    .text('💰 Sell 75%', `sell_${positionId}_75`)
    .text('💰 Sell 100%', `sell_${positionId}_100`)
    .row()
    .text('💰 Sell X%', `sell_${positionId}_custom`)
    .row()
    .text('📋 Limit Order', `limit_${positionId}`)
    .text('🎚️ Edit TP/SL', `edit_tpsl_${positionId}`)
    .row()
    .text('🔄 Refresh', `refresh_position_${positionId}`)
    .row()
    .text('« Back', 'back_to_positions');
}

// ============================================================================
// v2.3 Hunt Settings Keyboards
// ============================================================================

/**
 * Auto Hunt main keyboard
 */
export function autoHuntKeyboard(isEnabled: boolean): InlineKeyboard {
  const status = isEnabled ? '⏸️ Pause Hunt' : '▶️ Start Hunt';
  const callback = isEnabled ? 'hunt_pause' : 'hunt_start';

  return new InlineKeyboard()
    .text(status, callback)
    .row()
    .text('🎚️ Min Score', 'hunt_score')
    .text('💰 Max Buy', 'hunt_maxbuy')
    .row()
    .text('🎰 Bet Size', 'hunt_betsize')
    .text('🔗 Chains', 'hunt_chains')
    .row()
    .text('🚀 Launchpads', 'hunt_launchpads')
    .row()
    .text('« Back', 'back_to_menu');
}

/**
 * Hunt score selection keyboard
 */
export function huntScoreKeyboard(currentScore: number): InlineKeyboard {
  const scores = [15, 18, 20, 23, 25, 28, 30];
  const kb = new InlineKeyboard();

  for (let i = 0; i < scores.length; i += 4) {
    for (let j = i; j < Math.min(i + 4, scores.length); j++) {
      const marker = scores[j] === currentScore ? ' ✓' : '';
      kb.text(`${scores[j]}${marker}`, `hunt_score_${scores[j]}`);
    }
    kb.row();
  }

  kb.text('« Back', 'back_to_hunt');

  return kb;
}
