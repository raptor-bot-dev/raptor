/**
 * Text Message Handler for RAPTOR v2.3
 *
 * Handles:
 * - Wallet address detection (shows send options)
 * - Contract address detection (shows token info + buy)
 * - Withdrawal amount input
 * - Wallet deletion confirmation
 * - Custom strategy value inputs
 */

import { InlineKeyboard } from 'grammy';
import type { MyContext } from '../types.js';
import type { Chain } from '@raptor/shared';
import { getUserBalances, userHasWallet } from '@raptor/shared';
import { sendOptionsKeyboard, CHAIN_EMOJI, CHAIN_NAME } from '../utils/keyboards.js';
import { formatSendToAddress, escapeMarkdownV2, LINE, formatWalletName } from '../utils/formatters.js';
import { confirmDeleteWallet, cancelDeleteWallet } from '../commands/wallet.js';
import { handleSettingsInput } from './settingsHandler.js';
import { SESSION_STEPS } from '../ui/callbackIds.js';

// Regex patterns for address detection
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Common token mint addresses to distinguish from wallet addresses
const KNOWN_TOKEN_MINTS = new Set([
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

/**
 * Main text message handler
 */
export async function handleTextMessage(ctx: MyContext) {
  const user = ctx.from;
  const text = ctx.message?.text?.trim();

  if (!user || !text) return;

  // Handle session-based flows first (step OR awaitingImport)
  if (ctx.session.step || ctx.session.awaitingImport) {
    const handled = await handleSessionFlow(ctx, text);
    if (handled) return;
  }

  // Detect and handle addresses/CAs
  const addressInfo = detectAddress(text);
  if (addressInfo) {
    await handleAddressInput(ctx, addressInfo);
    return;
  }

  // If no handler matched, ignore (or could show help)
}

/**
 * Handle session-based input flows
 */
async function handleSessionFlow(ctx: MyContext, text: string): Promise<boolean> {
  // Check for wallet import flow
  if (ctx.session.awaitingImport) {
    await handleWalletImport(ctx, text);
    return true;
  }

  switch (ctx.session.step) {
    case 'awaiting_withdrawal_amount':
      await handleWithdrawalAmountInput(ctx, text);
      return true;

    case 'awaiting_withdrawal_address':
      await handleWithdrawalAddressInput(ctx, text);
      return true;

    case 'awaiting_withdrawal_confirm':
      // Confirmation handled via callback
      return false;

    case 'awaiting_delete_confirmation':
      await handleDeleteConfirmation(ctx, text);
      return true;

    case 'awaiting_custom_tp':
    case 'awaiting_custom_sl':
    case 'awaiting_custom_maxhold':
    case 'awaiting_custom_value':
      await handleCustomStrategyInput(ctx, text);
      return true;

    case 'awaiting_send_amount':
      await handleSendAmountInput(ctx, text);
      return true;

    // v3.2: Handle sell CA input
    case 'awaiting_sell_ca': {
      const { handleSellCaInput } = await import('../commands/sell.js');
      return await handleSellCaInput(ctx, text);
    }

    // v3.2: Handle custom sell inputs
    case 'awaiting_sell_tokens':
    case 'awaiting_sell_percent':
      await handleCustomSellInput(ctx, text);
      return true;

    // v3.3 FIX (Issue 2): Handle custom manual settings inputs
    case 'awaiting_manual_slippage': {
      const value = parseFloat(text);
      if (isNaN(value) || value < 0.1 || value > 50) {
        await ctx.reply('Invalid slippage. Enter a number between 0.1 and 50:');
        return true;
      }

      const { updateManualSettings } = await import('@raptor/shared');
      await updateManualSettings({ userId: ctx.from!.id, slippageBps: Math.round(value * 100) });

      ctx.session.step = null;
      await ctx.reply(`Slippage set to ${value}%\n\nUse /menu to continue.`);
      return true;
    }

    case 'awaiting_manual_priority': {
      const value = parseFloat(text);
      if (isNaN(value) || value < 0.00001 || value > 0.1) {
        await ctx.reply('Invalid priority. Enter a number between 0.00001 and 0.1:');
        return true;
      }

      const { updateManualSettings } = await import('@raptor/shared');
      await updateManualSettings({ userId: ctx.from!.id, prioritySol: value });

      ctx.session.step = null;
      await ctx.reply(`Priority set to ${value} SOL\n\nUse /menu to continue.`);
      return true;
    }

    case 'awaiting_manual_buyamts': {
      const parts = text.split(',').map(s => parseFloat(s.trim()));

      if (parts.length !== 5 || parts.some(isNaN) || parts.some(v => v <= 0 || v > 100)) {
        await ctx.reply('Invalid input. Enter exactly 5 positive numbers separated by commas:');
        return true;
      }

      const { updateManualSettings } = await import('@raptor/shared');
      await updateManualSettings({ userId: ctx.from!.id, quickBuyAmounts: parts });

      ctx.session.step = null;
      await ctx.reply(`Quick buy amounts set to: ${parts.join(', ')} SOL\n\nUse /menu to continue.`);
      return true;
    }

    // v3.5: Handle chain-specific settings custom inputs
    case 'awaiting_chain_buy_slip': {
      const chain = ctx.session.chainSettingsTarget;
      if (!chain) {
        ctx.session.step = null;
        await ctx.reply('Session expired. Please try again from the settings menu.');
        return true;
      }

      const value = parseFloat(text);
      if (isNaN(value) || value < 0.1 || value > 50) {
        await ctx.reply('Invalid slippage. Enter a number between 0.1 and 50:');
        return true;
      }

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: ctx.from!.id, chain, buySlippageBps: Math.round(value * 100) });

      ctx.session.step = null;
      ctx.session.chainSettingsTarget = undefined;
      await ctx.reply(`${chain.toUpperCase()} buy slippage set to ${value}%\n\nUse /menu to continue.`);
      return true;
    }

    case 'awaiting_chain_sell_slip': {
      const chain = ctx.session.chainSettingsTarget;
      if (!chain) {
        ctx.session.step = null;
        await ctx.reply('Session expired. Please try again from the settings menu.');
        return true;
      }

      const value = parseFloat(text);
      if (isNaN(value) || value < 0.1 || value > 50) {
        await ctx.reply('Invalid slippage. Enter a number between 0.1 and 50:');
        return true;
      }

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: ctx.from!.id, chain, sellSlippageBps: Math.round(value * 100) });

      ctx.session.step = null;
      ctx.session.chainSettingsTarget = undefined;
      await ctx.reply(`${chain.toUpperCase()} sell slippage set to ${value}%\n\nUse /menu to continue.`);
      return true;
    }

    case 'awaiting_chain_gas': {
      const chain = ctx.session.chainSettingsTarget;
      if (!chain) {
        ctx.session.step = null;
        await ctx.reply('Session expired. Please try again from the settings menu.');
        return true;
      }

      const value = parseFloat(text);
      if (isNaN(value) || value <= 0 || value > 500) {
        await ctx.reply('Invalid gas price. Enter a positive number (gwei):');
        return true;
      }

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: ctx.from!.id, chain, gasGwei: value });

      ctx.session.step = null;
      ctx.session.chainSettingsTarget = undefined;
      await ctx.reply(`${chain.toUpperCase()} gas price set to ${value} gwei\n\nUse /menu to continue.`);
      return true;
    }

    case 'awaiting_chain_priority': {
      const chain = ctx.session.chainSettingsTarget;
      if (!chain) {
        ctx.session.step = null;
        await ctx.reply('Session expired. Please try again from the settings menu.');
        return true;
      }

      const value = parseFloat(text);
      if (isNaN(value) || value < 0.00001 || value > 0.1) {
        await ctx.reply('Invalid priority fee. Enter a number between 0.00001 and 0.1 SOL:');
        return true;
      }

      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({ userId: ctx.from!.id, chain, prioritySol: value });

      ctx.session.step = null;
      ctx.session.chainSettingsTarget = undefined;
      await ctx.reply(`Solana priority fee set to ${value} SOL\n\nUse /menu to continue.`);
      return true;
    }

    // v4.3: Handle manual custom buy slippage
    case 'awaiting_manual_buy_slip': {
      const value = parseFloat(text);
      if (isNaN(value) || value < 1 || value > 100) {
        await ctx.reply('Invalid slippage. Enter a number between 1 and 100:');
        return true;
      }
      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({
        userId: ctx.from!.id,
        chain: 'sol',
        buySlippageBps: Math.round(value * 100)
      });
      ctx.session.step = null;
      await ctx.reply(`Buy slippage set to ${value}%\n\nUse /menu to continue.`);
      return true;
    }

    // v4.3: Handle manual custom sell slippage
    case 'awaiting_manual_sell_slip': {
      const value = parseFloat(text);
      if (isNaN(value) || value < 1 || value > 100) {
        await ctx.reply('Invalid slippage. Enter a number between 1 and 100:');
        return true;
      }
      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({
        userId: ctx.from!.id,
        chain: 'sol',
        sellSlippageBps: Math.round(value * 100)
      });
      ctx.session.step = null;
      await ctx.reply(`Sell slippage set to ${value}%\n\nUse /menu to continue.`);
      return true;
    }

    // v4.3: Handle manual custom buy tip
    case 'awaiting_manual_buy_tip': {
      const value = parseFloat(text);
      if (isNaN(value) || value < 0.00001 || value > 0.1) {
        await ctx.reply('Invalid tip. Enter a number between 0.00001 and 0.1 SOL:');
        return true;
      }
      const { updateChainSettings } = await import('@raptor/shared');
      await updateChainSettings({
        userId: ctx.from!.id,
        chain: 'sol',
        prioritySol: value
      });
      ctx.session.step = null;
      await ctx.reply(`Buy tip set to ${value} SOL\n\nUse /menu to continue.`);
      return true;
    }

    // v4.3: Handle manual custom sell tip
    case 'awaiting_manual_sell_tip': {
      const value = parseFloat(text);
      if (isNaN(value) || value < 0.00001 || value > 0.1) {
        await ctx.reply('Invalid tip. Enter a number between 0.00001 and 0.1 SOL:');
        return true;
      }
      const { updateChainSettings } = await import('@raptor/shared');
      // Note: Currently uses same priority_sol field for both buy/sell
      // TODO: Use sell_priority_sol when database field is added
      await updateChainSettings({
        userId: ctx.from!.id,
        chain: 'sol',
        prioritySol: value
      });
      ctx.session.step = null;
      await ctx.reply(`Sell tip set to ${value} SOL\n\nUse /menu to continue.`);
      return true;
    }

    // v5: Handle v3 autohunt settings panel inputs
    case SESSION_STEPS.AWAITING_TRADE_SIZE:
    case SESSION_STEPS.AWAITING_MAX_POSITIONS:
    case SESSION_STEPS.AWAITING_TP_PERCENT:
    case SESSION_STEPS.AWAITING_SL_PERCENT:
    case SESSION_STEPS.AWAITING_SLIPPAGE_BPS:
    case SESSION_STEPS.AWAITING_PRIORITY_SOL:
      return await handleSettingsInput(ctx, ctx.session.step!, text);

    // v3.4: Handle custom buy amount input
    case 'awaiting_custom_buy_amount': {
      const pendingBuy = ctx.session.pendingBuy;
      if (!pendingBuy) {
        ctx.session.step = null;
        await ctx.reply('Session expired. Please try again from the token menu.');
        return true;
      }

      const amount = parseFloat(text);
      const { chain, mint } = pendingBuy;
      const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';
      const minAmount = chain === 'sol' ? 0.01 : 0.001;
      const maxAmount = chain === 'sol' ? 100 : 10;

      if (isNaN(amount) || amount < minAmount || amount > maxAmount) {
        await ctx.reply(`Invalid amount. Enter a number between ${minAmount} and ${maxAmount} ${symbol}:`);
        return true;
      }

      // Clear session state
      ctx.session.step = null;
      ctx.session.pendingBuy = undefined;

      // Only Solana supported currently
      if (chain !== 'sol') {
        await ctx.reply('Only Solana is supported currently. Please use /menu to continue.');
        return true;
      }

      // Execute the buy
      await ctx.reply(`Processing buy of ${amount} ${symbol}...`);

      try {
        const { executeManualBuy } = await import('./buy.js');
        const { getOrCreateManualSettings } = await import('@raptor/shared');

        const settings = await getOrCreateManualSettings(ctx.from!.id);
        const slippageBps = settings.default_slippage_bps || 50;

        const result = await executeManualBuy({
          userId: ctx.from!.id,
          chain,
          tokenMint: mint,
          amountSol: amount,
          tgEventId: `custom_${Date.now()}`,
          slippageBps,
        });

        if (result.success && result.txHash) {
          const explorerUrl = `https://solscan.io/tx/${result.txHash}`;
          await ctx.reply(
            `✅ *BUY SUCCESSFUL*\n\n` +
            `*Route:* ${result.route || 'Unknown'}\n` +
            `*Amount:* ${result.amountIn} ${symbol}\n` +
            `*Tokens Received:* ${result.tokensReceived?.toLocaleString() || '0'}\n` +
            `*Price:* ${result.pricePerToken?.toFixed(9) || '0'} ${symbol}/token\n\n` +
            `[View Transaction](${explorerUrl})`,
            { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } }
          );
        } else {
          await ctx.reply(`❌ Buy failed: ${result.error || 'Unknown error'}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await ctx.reply(`❌ Buy failed: ${errorMsg}`);
      }

      return true;
    }

    default:
      return false;
  }
}

/**
 * Detect if text is a wallet address or contract address
 * Solana-only build - only detect Solana addresses
 */
function detectAddress(text: string): {
  type: 'solana_wallet' | 'solana_token';
  address: string;
  chain: Chain;
} | null {
  // Check Solana address only (Solana-only build)
  if (SOLANA_ADDRESS_REGEX.test(text)) {
    // For trading bot, assume all pasted addresses are token CAs
    // Users can send via wallet menu if they need to
    return {
      type: 'solana_token',
      address: text,
      chain: 'sol',
    };
  }

  return null;
}

/**
 * Handle detected address input
 * Solana-only build - only handle Solana addresses
 */
async function handleAddressInput(
  ctx: MyContext,
  addressInfo: {
    type: 'solana_wallet' | 'solana_token';
    address: string;
    chain: Chain;
  }
) {
  const user = ctx.from;
  if (!user) return;

  // Check if user has a wallet
  const hasWallet = await userHasWallet(user.id);
  if (!hasWallet) {
    await ctx.reply(
      `${LINE}\n⚠️ *No Wallet Found*\n${LINE}\n\nYou need to create a wallet first.\n\n${LINE}`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('🦖 Get Started', 'start_generate_wallet'),
      }
    );
    return;
  }

  if (addressInfo.type === 'solana_token') {
    // Show token info + buy options
    await showTokenCard(ctx, addressInfo.address, 'sol');
  } else if (addressInfo.type === 'solana_wallet') {
    // Show send options for Solana (rarely used now)
    await showSendOptions(ctx, addressInfo.address, 'sol');
  }
}

/**
 * Show send options when wallet address is detected
 */
async function showSendOptions(ctx: MyContext, toAddress: string, chain: Chain) {
  const message = formatSendToAddress(toAddress, chain);

  // Store in session for the send flow
  ctx.session.pendingSend = {
    toAddress,
    chain,
  };

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: sendOptionsKeyboard(chain),
  });
}

/**
 * Show token card with buy options (Solana-only).
 * Uses fast DexScreener first, then a bonding-curve/source detector as fallback.
 */
async function showTokenCard(ctx: MyContext, tokenAddress: string, _chain: Chain) {
  // Solana-only build
  const symbol = 'SOL';

  let message: string;

  // Solana-only path {
	    // Fast path: Try DexScreener first (2s timeout), then source detector
	    const { dexscreener, launchpadDetector, tokenData, goplus } = await import('@raptor/shared');

    // Quick DexScreener check with short timeout
    const quickDexResult = await Promise.race([
      dexscreener.getTokenByAddress(tokenAddress),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]).catch(() => null);

    // If found on DexScreener, use that data with parallel security fetch
    if (quickDexResult?.data) {
      const [security] = await Promise.allSettled([
        goplus.getTokenSecurity(tokenAddress, 'sol'),
      ]);
      const securityData = security.status === 'fulfilled' ? security.value : null;

      const dex = quickDexResult.data;
      const priceStr = tokenData.formatPrice(dex.priceUsd);
      const mcapStr = tokenData.formatLargeNumber(dex.marketCap);
      const liqStr = tokenData.formatLargeNumber(dex.liquidity);
      const volStr = tokenData.formatLargeNumber(dex.volume24h);

      let securitySection = '';
      if (securityData) {
        const secBadge = goplus.getRiskBadge(securityData);
        securitySection = `\n*Security:* ${secBadge.emoji} ${secBadge.label}`;
        if (securityData.risks.length > 0) {
          securitySection += `\n${securityData.risks.slice(0, 2).join('\n')}`;
        }
      }

      // v3.3.1 FIX: Line below heading, not surrounding
      message = `☀️ *${dex.symbol}* — Solana
${LINE}

*${dex.name}*

💰 *Price:* ${priceStr}
📊 *MCap:* ${mcapStr}
💧 *Liq:* ${liqStr}
📈 *Vol:* ${volStr}
${securitySection}

${LINE}
🔗 [DexScreener](https://dexscreener.com/solana/${tokenAddress}) • [Birdeye](https://birdeye.so/token/${tokenAddress}) • [Solscan](https://solscan.io/token/${tokenAddress})

\`${tokenAddress}\``;
    } else {
	      // Not on DexScreener - try source detector (may be bonding curve token)
	      const tokenInfo = await launchpadDetector.detectAndFetch(tokenAddress).catch(() => null);

    if (tokenInfo) {
      const lpEmoji = launchpadDetector.getLaunchpadEmoji(tokenInfo.launchpad.launchpad);
      const lpName = launchpadDetector.getLaunchpadName(tokenInfo.launchpad.launchpad);

      // Is it a bonding curve token?
      const isBonding = tokenInfo.launchpad.status === 'bonding' || tokenInfo.launchpad.status === 'migrating';

	      if (isBonding) {
	        // Bonding curve display
	        const progressBar = launchpadDetector.formatBondingBar(tokenInfo.launchpad.bondingProgress);
        const statusEmoji = tokenInfo.launchpad.bondingProgress >= 90 ? '🔥' :
          tokenInfo.launchpad.bondingProgress >= 50 ? '📈' : '🌱';

        const priceStr = tokenInfo.priceInSol > 0
          ? `${tokenInfo.priceInSol.toFixed(9)} SOL`
          : 'N/A';

        // Security section
        let securitySection = '';
        if (tokenInfo.security) {
          const secEmoji = tokenInfo.security.riskScore >= 80 ? '✅' :
            tokenInfo.security.riskScore >= 60 ? '🟢' :
            tokenInfo.security.riskScore >= 40 ? '🟡' :
            tokenInfo.security.riskScore >= 20 ? '🟠' : '🔴';
          securitySection = `\n*Security:* ${secEmoji} ${tokenInfo.security.riskLevel} (${tokenInfo.security.riskScore}/100)`;
          securitySection += `\n${tokenInfo.security.lpStatus}`;
          if (tokenInfo.security.isMintable) securitySection += '\n⚠️ Mintable';
          if (tokenInfo.security.isFreezable) securitySection += '\n⚠️ Freezable';
        }

        // v3.3.1 FIX: Line below heading, not surrounding
        message = `${lpEmoji} *${tokenInfo.symbol}* — ${lpName}
${LINE}

*${tokenInfo.name}*
${statusEmoji} ${tokenInfo.launchpad.bondingProgress >= 90 ? 'Almost There!' : tokenInfo.launchpad.bondingProgress >= 50 ? 'Growing' : 'New Launch'}

💰 *Price:* ${priceStr}
📊 *MCap:* ${tokenInfo.marketCapSol.toFixed(2)} SOL
${tokenInfo.holders > 0 ? `👥 *Holders:* ${tokenInfo.holders}` : ''}

*Bonding Curve:*
${progressBar} ${tokenInfo.launchpad.bondingProgress.toFixed(1)}%
💎 ${tokenInfo.launchpad.solRaised.toFixed(2)} / ~${tokenInfo.launchpad.targetSol} SOL to graduate
${securitySection}

${LINE}
🔗 [${lpName}](${tokenInfo.links.launchpad}) • [DexScreener](${tokenInfo.links.dexscreener}) • [Solscan](${tokenInfo.links.solscan})

\`${tokenAddress}\``;
      } else {
        // Graduated/trading token
        const priceStr = tokenInfo.priceInUsd
          ? `$${tokenInfo.priceInUsd.toFixed(6)}`
          : tokenInfo.priceInSol > 0 ? `${tokenInfo.priceInSol.toFixed(9)} SOL` : 'N/A';
        const mcapStr = tokenInfo.marketCapUsd
          ? tokenData.formatLargeNumber(tokenInfo.marketCapUsd)
          : `${tokenInfo.marketCapSol.toFixed(2)} SOL`;
        const liqStr = tokenData.formatLargeNumber(tokenInfo.liquidity);
        const volStr = tokenData.formatLargeNumber(tokenInfo.volume24h);

        // Security section
        let securitySection = '';
        if (tokenInfo.security) {
          const secEmoji = tokenInfo.security.riskScore >= 80 ? '✅' :
            tokenInfo.security.riskScore >= 60 ? '🟢' :
            tokenInfo.security.riskScore >= 40 ? '🟡' :
            tokenInfo.security.riskScore >= 20 ? '🟠' : '🔴';
          securitySection = `\n*Security:* ${secEmoji} ${tokenInfo.security.riskLevel} (${tokenInfo.security.riskScore}/100)`;
          securitySection += `\n${tokenInfo.security.lpStatus}`;
          if (tokenInfo.security.risks.length > 0) {
            securitySection += `\n${tokenInfo.security.risks.slice(0, 2).join('\n')}`;
          }
        }

        const graduatedFrom = tokenInfo.launchpad.launchpad !== 'raydium' && tokenInfo.launchpad.launchpad !== 'unknown'
          ? `\n🎓 Graduated from ${lpName}`
          : '';

        // v3.3.1 FIX: Line below heading, not surrounding
        message = `☀️ *${tokenInfo.symbol}* — Solana
${LINE}

*${tokenInfo.name}*${graduatedFrom}

💰 *Price:* ${priceStr}
📊 *MCap:* ${mcapStr}
💧 *Liq:* ${liqStr}
📈 *Vol:* ${volStr}
${tokenInfo.holders > 0 ? `👥 *Holders:* ${tokenInfo.holders}` : ''}
${securitySection}

${LINE}
🔗 [DexScreener](${tokenInfo.links.dexscreener}) • [Birdeye](${tokenInfo.links.birdeye}) • [Solscan](${tokenInfo.links.solscan})

\`${tokenAddress}\``;
      }
	    } else {
	      // Token not found in known sources
	      // v3.3.1 FIX: Line below heading, not surrounding
	      message = `☀️ *TOKEN* — Solana
${LINE}

⚠️ *New/Unlisted Token*

Not found on DexScreener or configured sources.
Proceed with extreme caution.

\`${tokenAddress}\``;
	    }
	  }

  // Build keyboard with buy options - Solana-only
  // v3.2: Added → Sell button
  const keyboard = new InlineKeyboard()
    .text('🛒 0.1 SOL', `buy_sol_${tokenAddress}_0.1`)
    .text('🛒 0.25 SOL', `buy_sol_${tokenAddress}_0.25`)
    .text('🛒 0.5 SOL', `buy_sol_${tokenAddress}_0.5`)
    .row()
    .text('🛒 1 SOL', `buy_sol_${tokenAddress}_1`)
    .text('🛒 2 SOL', `buy_sol_${tokenAddress}_2`)
    .text('✏️ X SOL', `buy_sol_${tokenAddress}_custom`)
    .row()
    .text('💰 → Sell', `open_sell_direct:${tokenAddress}`)
    .text('🔍 Full Scan', `analyze_sol_${tokenAddress}`)
    .row()
    .text('⚙️ Slippage', `buy_slippage:sol_${tokenAddress}`)
    .text('⚡ Priority', `buy_priority:sol_${tokenAddress}`)
    .row()
    .text('🔄 Refresh', `refresh_sol_${tokenAddress}`)
    .text('« Back', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Handle withdrawal amount input (custom amount)
 */
async function handleWithdrawalAmountInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain } = ctx.session.pendingWithdrawal;
  const amount = parseFloat(text);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a valid number greater than 0.');
    return;
  }

  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  // Update session with amount and move to address input
  ctx.session.pendingWithdrawal.amount = amount.toFixed(6);
  ctx.session.step = 'awaiting_withdrawal_address';

  const amountText = `${amount.toFixed(6)} ${symbol}`;
  await ctx.reply(
    `${LINE}
📤 *CUSTOM WITHDRAWAL*
${LINE}

*Amount:* ${escapeMarkdownV2(amountText)}

Please enter the destination address:

${LINE}`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: new InlineKeyboard().text('« Cancel', 'wallets'),
    }
  );
}

/**
 * Handle withdrawal destination address input
 */
async function handleWithdrawalAddressInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain, amount } = ctx.session.pendingWithdrawal;
  if (!amount) {
    await ctx.reply('❌ Error: Amount not set.');
    ctx.session.step = null;
    ctx.session.pendingWithdrawal = null;
    return;
  }

  const address = text.trim();
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  // Basic address validation
  let isValidAddress = false;
  if (chain === 'sol') {
    // Solana address validation (base58, 32-44 chars)
    isValidAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  } else {
    // EVM address validation (0x + 40 hex chars)
    isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  if (!isValidAddress) {
    await ctx.reply(
      `❌ *Invalid Address*\n\n` +
        `Please enter a valid ${CHAIN_NAME[chain]} address.\n\n` +
        (chain === 'sol'
          ? 'Format: Base58 (e.g., 7xK...abc)'
          : 'Format: 0x... (e.g., 0x742d...)'),
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Update session and show confirmation
  ctx.session.pendingWithdrawal.address = address;
  ctx.session.step = 'awaiting_withdrawal_confirm';

  const amountText = `${amount} ${symbol}`;
  await ctx.reply(
    `${LINE}
⚠️ *CONFIRM WITHDRAWAL*
${LINE}

*Amount:* ${escapeMarkdownV2(amountText)}
*Chain:* ${CHAIN_NAME[chain]}
*Destination:*
\`${address}\`

⚠️ *WARNING:*
• Double\\-check the address
• This transaction cannot be reversed
• Ensure the address is on the correct network

Confirm to proceed:

${LINE}`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: new InlineKeyboard()
        .text('✅ Confirm Withdrawal', 'confirm_withdrawal')
        .row()
        .text('❌ Cancel', 'wallets'),
    }
  );
}

/**
 * Handle DELETE confirmation for wallet deletion
 */
async function handleDeleteConfirmation(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user) return;

  if (text.toUpperCase() === 'DELETE') {
    await confirmDeleteWallet(ctx);
  } else {
    // Cancel deletion
    cancelDeleteWallet(user.id);
    ctx.session.step = null;

    await ctx.reply('Wallet deletion cancelled.', {
      reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
    });
  }
}

/**
 * Handle custom strategy value input
 */
async function handleCustomStrategyInput(ctx: MyContext, text: string) {
  const step = ctx.session.step;
  const value = parseFloat(text);

  if (isNaN(value)) {
    await ctx.reply('❌ Please enter a valid number.');
    return;
  }

  // Validate ranges based on step
  let isValid = true;
  let errorMsg = '';

  switch (step) {
    case 'awaiting_custom_tp':
      if (value < 10 || value > 500) {
        isValid = false;
        errorMsg = 'Take profit must be between 10% and 500%';
      }
      break;
    case 'awaiting_custom_sl':
      if (value < 5 || value > 50) {
        isValid = false;
        errorMsg = 'Stop loss must be between 5% and 50%';
      }
      break;
    case 'awaiting_custom_maxhold':
      if (value < 5 || value > 1440) {
        isValid = false;
        errorMsg = 'Max hold must be between 5 and 1440 minutes (24h)';
      }
      break;
  }

  if (!isValid) {
    await ctx.reply(`❌ ${errorMsg}`);
    return;
  }

  // Store value and continue
  // TODO: Update user's custom strategy in database
  ctx.session.step = null;

  await ctx.reply(`✅ Value set to ${value}`, {
    reply_markup: new InlineKeyboard().text('« Back to Strategy', 'strategy_custom'),
  });
}

/**
 * Handle send amount input
 */
async function handleSendAmountInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingSend) return;

  const amount = parseFloat(text);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a valid number.');
    return;
  }

  const { toAddress, chain } = ctx.session.pendingSend;
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  ctx.session.pendingSend.amount = amount.toString();
  ctx.session.step = 'awaiting_send_confirm';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Send', 'confirm_send')
    .text('❌ Cancel', 'cancel_send');

  await ctx.reply(
    `${LINE}\n⚠️ *Confirm Send*\n${LINE}\n\n` +
      `*Amount:* ${amount} ${symbol}\n` +
      `*To:* \`${toAddress.slice(0, 10)}...${toAddress.slice(-8)}\`\n` +
      `*Chain:* ${CHAIN_NAME[chain]}\n\n` +
      `${LINE}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

/**
 * Handle wallet import private key input
 */
async function handleWalletImport(ctx: MyContext, privateKey: string) {
  const user = ctx.from;
  const chain = ctx.session.awaitingImport;

  if (!user || !chain) return;

  // Delete user's message immediately (contains private key!)
  try {
    await ctx.deleteMessage();
  } catch {
    // Message may already be deleted or unable to delete
  }

  try {
    const { importSolanaKeypair, createWallet } = await import(
      '@raptor/shared'
    );

    // Solana-only build
    const keypair = importSolanaKeypair(privateKey.trim(), user.id);

    // Create wallet in database
    const wallet = await createWallet({
      tg_id: user.id,
      chain,
      address: keypair.publicKey,
      private_key_encrypted: keypair.privateKeyEncrypted,
    });

    // Clear session
    delete ctx.session.awaitingImport;

    // Show success message
    // v3.4 (F1): Use cleaner wallet naming with chain icon
    const walletDisplayName = formatWalletName(wallet.wallet_index, null, chain, true);
    await ctx.reply(
      `${LINE}
✅ *WALLET IMPORTED SUCCESSFULLY*
${LINE}

${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}* - ${walletDisplayName}

*Address:*
\`${keypair.publicKey}\`

Your wallet has been encrypted and stored securely.

${LINE}`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );
  } catch (error) {
    console.error('[Messages] Error importing wallet:', error);

    // Clear session
    delete ctx.session.awaitingImport;

    await ctx.reply(
      `❌ *Import Failed*\n\n` +
        `Invalid private key format for ${CHAIN_NAME[chain]}.\n\n` +
        `Please make sure you're using Base58 format for Solana.`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );
  }
}

/**
 * Handle custom sell input (tokens or percent)
 * v3.2: For when user enters a custom amount after clicking "X Tokens" or "X%"
 */
async function handleCustomSellInput(ctx: MyContext, text: string): Promise<void> {
  const user = ctx.from;
  if (!user) return;

  const step = ctx.session.step;
  const mint = ctx.session.pendingSellMint;

  if (!mint) {
    await ctx.reply('❌ Session expired. Please try again.');
    ctx.session.step = null;
    return;
  }

  const value = parseFloat(text);

  if (isNaN(value) || value <= 0) {
    await ctx.reply(
      step === 'awaiting_sell_tokens'
        ? '❌ Invalid amount. Please enter a positive number of tokens:'
        : '❌ Invalid percentage. Please enter a number between 1 and 100:'
    );
    return;
  }

  // Validate percent range
  if (step === 'awaiting_sell_percent' && (value < 1 || value > 100)) {
    await ctx.reply('❌ Percentage must be between 1 and 100:');
    return;
  }

  // Clear session state
  ctx.session.step = null;
  ctx.session.pendingSellMint = undefined;

  try {
    // Import required modules
    const { solanaExecutor } = await import('@raptor/executor/solana');
    const { getUserWallets, idKeyManualSell, reserveTradeBudget, updateExecution } = await import('@raptor/shared');
    const { executeSolanaSell } = await import('../services/solanaTrade.js');
    const { closeMonitorAfterSell } = await import('../services/tradeMonitor.js');

    // Get user's active Solana wallet
    const wallets = await getUserWallets(user.id);
    const activeWallet = wallets.find(w => w.chain === 'sol' && w.is_active);

    if (!activeWallet) {
      await ctx.reply('⚠️ *No Active Wallet*\n\nPlease create a Solana wallet first.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    // Get token balance
    const walletAddress = activeWallet.public_key || activeWallet.solana_address;
    const tokensHeld = await solanaExecutor.getTokenBalance(mint, walletAddress);

    if (!tokensHeld || tokensHeld <= 0) {
      await ctx.reply('⚠️ *No Balance Detected*\n\nYour wallet has no tokens for this mint.', {
        parse_mode: 'Markdown',
      });
      return;
    }

    // Calculate sell amount
    let sellAmount: number;
    let percent: number;

    if (step === 'awaiting_sell_tokens') {
      if (value > tokensHeld) {
        await ctx.reply(
          `⚠️ You only have ${tokensHeld.toLocaleString()} tokens.\n\n` +
          `Max sell amount: ${tokensHeld.toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
      sellAmount = value;
      percent = (sellAmount / tokensHeld) * 100;
    } else {
      percent = value;
      sellAmount = (tokensHeld * percent) / 100;
    }

    // Show processing message
    await ctx.reply(
      `⏳ *PROCESSING SELL*\n\n` +
        `Selling ${percent.toFixed(1)}% (${sellAmount.toLocaleString()} tokens)...\n\n` +
        `_Finding best route..._`,
      { parse_mode: 'Markdown' }
    );

    // Execute sell
    const result = await executeSolanaSell(user.id, mint, sellAmount);

    if (result.success && result.txHash) {
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
      await ctx.reply(
        `❌ *SELL FAILED*\n\n` +
          `${result.error || 'Unknown error'}\n\n` +
          `Please try again.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('[Messages] Custom sell error:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(
      `❌ *SELL FAILED*\n\n` +
        `${errorMsg}\n\n` +
        `Please try again.`,
      { parse_mode: 'Markdown' }
    );
  }
}
