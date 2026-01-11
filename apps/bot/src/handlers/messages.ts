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
import { formatSendToAddress, LINE } from '../utils/formatters.js';
import { confirmDeleteWallet, cancelDeleteWallet } from '../commands/wallet.js';

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

  // Handle session-based flows first
  if (ctx.session.step) {
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

    default:
      return false;
  }
}

/**
 * Detect if text is a wallet address or contract address
 * For a trading bot, we assume addresses are token contracts by default
 */
function detectAddress(text: string): {
  type: 'solana_wallet' | 'solana_token' | 'evm_wallet' | 'evm_token';
  address: string;
  chain: Chain;
} | null {
  // Check Solana address
  if (SOLANA_ADDRESS_REGEX.test(text)) {
    // For trading bot, assume all pasted addresses are token CAs
    // Users can send via wallet menu if they need to
    return {
      type: 'solana_token',
      address: text,
      chain: 'sol',
    };
  }

  // Check EVM address
  if (EVM_ADDRESS_REGEX.test(text)) {
    // For EVM, assume it's a token CA for trading
    return {
      type: 'evm_token',
      address: text,
      chain: 'eth', // Default to ETH, will be selectable
    };
  }

  return null;
}

/**
 * Handle detected address input
 */
async function handleAddressInput(
  ctx: MyContext,
  addressInfo: {
    type: 'solana_wallet' | 'solana_token' | 'evm_wallet' | 'evm_token';
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
  } else if (addressInfo.type === 'evm_token') {
    // For EVM tokens, try to auto-detect chain first
    await handleEvmTokenWithAutoDetect(ctx, addressInfo.address);
  } else if (addressInfo.type === 'solana_wallet') {
    // Show send options for Solana (rarely used now)
    await showSendOptions(ctx, addressInfo.address, 'sol');
  } else if (addressInfo.type === 'evm_wallet') {
    // For EVM wallets, show chain selection for sending
    await showEvmChainSelection(ctx, addressInfo.address);
  }
}

/**
 * Auto-detect chain for EVM token - uses DexScreener + RPC fallback
 * Never asks user to select chain if we can detect it
 */
async function handleEvmTokenWithAutoDetect(ctx: MyContext, address: string) {
  try {
    const { dexscreener, chainDetector } = await import('@raptor/shared');

    // Step 1: Try DexScreener first (fast, has price data)
    const { data, chains } = await dexscreener.getTokenByAddress(address);

    if (data && chains.length === 1) {
      // Single chain found on DexScreener - show token card immediately
      await showTokenCard(ctx, address, chains[0]);
      return;
    }

    if (data && chains.length > 1) {
      // Multiple chains on DexScreener - show selection
      await showEvmChainSelectionForTradeWithDetected(ctx, address, chains);
      return;
    }

    // Step 2: Not on DexScreener - check on-chain via RPC
    const detection = await chainDetector.detectChain(address);

    if (detection.chains.length === 1 && detection.confidence !== 'low') {
      // Found on exactly one chain - show token card
      await showTokenCard(ctx, address, detection.chains[0]);
      return;
    }

    if (detection.chains.length > 1 && detection.addressType === 'token') {
      // Contract exists on multiple chains - ask user
      await showEvmChainSelectionForTradeWithDetected(ctx, address, detection.chains);
      return;
    }

    if (detection.addressType === 'wallet' || detection.confidence === 'low') {
      // Wallet address or can't detect - default to ETH for new tokens
      // Most new token launches are on ETH/Base, try ETH first
      await showTokenCard(ctx, address, 'eth');
      return;
    }

    // Fallback: show chain selection only if really needed
    await showEvmChainSelectionForTrade(ctx, address);
  } catch (error) {
    console.error('[Messages] Token lookup error:', error);
    // On error, default to ETH (most common for new tokens)
    await showTokenCard(ctx, address, 'eth');
  }
}

/**
 * Show EVM chain selection with detected chains highlighted
 */
async function showEvmChainSelectionForTradeWithDetected(
  ctx: MyContext,
  address: string,
  detectedChains: Chain[]
) {
  const bscDetected = detectedChains.includes('bsc');
  const baseDetected = detectedChains.includes('base');
  const ethDetected = detectedChains.includes('eth');

  const message = `${LINE}
📊 *TOKEN FOUND ON ${detectedChains.length} CHAINS*
${LINE}

Contract address:
\`${address.slice(0, 10)}...${address.slice(-8)}\`

✅ Found on: ${detectedChains.map(c => c.toUpperCase()).join(', ')}

Select chain to view token info:

${LINE}`;

  const keyboard = new InlineKeyboard();

  // Show detected chains first with checkmark
  if (bscDetected) {
    keyboard.text(`✅ ${CHAIN_EMOJI.bsc} BSC`, `trade_chain_bsc_${address}`);
  } else {
    keyboard.text(`${CHAIN_EMOJI.bsc} BSC`, `trade_chain_bsc_${address}`);
  }

  if (baseDetected) {
    keyboard.text(`✅ ${CHAIN_EMOJI.base} Base`, `trade_chain_base_${address}`);
  } else {
    keyboard.text(`${CHAIN_EMOJI.base} Base`, `trade_chain_base_${address}`);
  }

  keyboard.row();

  if (ethDetected) {
    keyboard.text(`✅ ${CHAIN_EMOJI.eth} Ethereum`, `trade_chain_eth_${address}`);
  } else {
    keyboard.text(`${CHAIN_EMOJI.eth} Ethereum`, `trade_chain_eth_${address}`);
  }

  keyboard.row().text('❌ Cancel', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
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
 * Show EVM chain selection when EVM address detected
 */
async function showEvmChainSelection(ctx: MyContext, address: string) {
  const message = `${LINE}
🔗 *SELECT CHAIN*
${LINE}

Address detected:
\`${address.slice(0, 10)}...${address.slice(-8)}\`

Which chain is this for?

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text(`${CHAIN_EMOJI.bsc} BSC`, `address_chain_bsc_${address}`)
    .text(`${CHAIN_EMOJI.base} Base`, `address_chain_base_${address}`)
    .row()
    .text(`${CHAIN_EMOJI.eth} Ethereum`, `address_chain_eth_${address}`)
    .row()
    .text('❌ Cancel', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show EVM chain selection for trading (token CA detected)
 */
async function showEvmChainSelectionForTrade(ctx: MyContext, address: string) {
  const message = `${LINE}
📊 *TOKEN DETECTED*
${LINE}

Contract address:
\`${address.slice(0, 10)}...${address.slice(-8)}\`

Select the chain to view token info:

${LINE}`;

  const keyboard = new InlineKeyboard()
    .text(`${CHAIN_EMOJI.bsc} BSC`, `trade_chain_bsc_${address}`)
    .text(`${CHAIN_EMOJI.base} Base`, `trade_chain_base_${address}`)
    .row()
    .text(`${CHAIN_EMOJI.eth} Ethereum`, `trade_chain_eth_${address}`)
    .row()
    .text('❌ Cancel', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Show token card with buy options - comprehensive data from all sources
 * Uses fast DexScreener first, then launchpad APIs as fallback
 */
async function showTokenCard(ctx: MyContext, tokenAddress: string, chain: Chain) {
  const symbol = chain === 'sol' ? 'SOL' : chain === 'bsc' ? 'BNB' : 'ETH';

  let message: string;

  if (chain === 'sol') {
    // Fast path: Try DexScreener first (2s timeout), then launchpad detector
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

      message = `${LINE}
☀️ *${dex.symbol}* — Solana
${LINE}

*${dex.name}*

💰 *Price:* ${priceStr}
📊 *MCap:* ${mcapStr}
💧 *Liq:* ${liqStr}
📈 *Vol:* ${volStr}
${securitySection}

${LINE}
🔗 [DexScreener](https://dexscreener.com/solana/${tokenAddress}) • [Birdeye](https://birdeye.so/token/${tokenAddress}) • [Solscan](https://solscan.io/token/${tokenAddress})
${LINE}
\`${tokenAddress}\``;
    } else {
      // Not on DexScreener - try launchpad detector (may be bonding curve token)
      const tokenInfo = await launchpadDetector.detectAndFetch(tokenAddress).catch(() => null);

    if (tokenInfo) {
      const lpEmoji = launchpadDetector.getLaunchpadEmoji(tokenInfo.launchpad.launchpad);
      const lpName = launchpadDetector.getLaunchpadName(tokenInfo.launchpad.launchpad);

      // Is it a bonding curve token?
      const isBonding = tokenInfo.launchpad.status === 'bonding' || tokenInfo.launchpad.status === 'migrating';

      if (isBonding) {
        // Bonding curve display (PumpFun, Moonshot, Bonk.fun)
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

        message = `${LINE}
${lpEmoji} *${tokenInfo.symbol}* — ${lpName}
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
${LINE}
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

        message = `${LINE}
☀️ *${tokenInfo.symbol}* — Solana
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
${LINE}
\`${tokenAddress}\``;
      }
    } else {
      // Token not found on any launchpad
      message = `${LINE}
☀️ *TOKEN* — Solana
${LINE}

⚠️ *New/Unlisted Token*

Not found on any known launchpad.
Proceed with extreme caution.

${LINE}
\`${tokenAddress}\``;
    }
  }
  } else {
    // EVM chains - use existing logic with GoPlus
    const { tokenData, goplus } = await import('@raptor/shared');

    const [tokenInfo, security] = await Promise.all([
      tokenData.getTokenInfo(tokenAddress, chain).catch(() => null),
      goplus.getTokenSecurity(tokenAddress, chain).catch(() => null),
    ]);

    if (tokenInfo) {
      const priceStr = tokenData.formatPrice(tokenInfo.priceUsd);
      const mcapStr = tokenData.formatLargeNumber(tokenInfo.marketCap);
      const liqStr = tokenData.formatLargeNumber(tokenInfo.liquidity);
      const volStr = tokenData.formatLargeNumber(tokenInfo.volume24h);
      const changeStr = tokenData.formatPercentage(tokenInfo.priceChange24h);
      const changeEmoji = (tokenInfo.priceChange24h ?? 0) >= 0 ? '🟢' : '🔴';

      const securityBadge = security
        ? goplus.getRiskBadge(security)
        : tokenData.getSecurityBadge(tokenInfo.riskScore);

      let securitySection = '';
      if (security) {
        securitySection = `\n*Security:* ${securityBadge.emoji} ${securityBadge.label}`;
        if (security.buyTax > 0 || security.sellTax > 0) {
          securitySection += `\n💸 Tax: ${security.buyTax.toFixed(1)}% buy / ${security.sellTax.toFixed(1)}% sell`;
        }
        if (security.isHoneypot) {
          securitySection += '\n🚨 HONEYPOT DETECTED';
        }
        if (security.risks.length > 0) {
          securitySection += `\n${security.risks.slice(0, 2).join('\n')}`;
        }
      }

      const dexLink = `https://dexscreener.com/${chain}/${tokenAddress}`;
      const dextoolsLink = `https://www.dextools.io/app/en/${chain === 'bsc' ? 'bnb' : chain}/pair-explorer/${tokenAddress}`;

      message = `${LINE}
${CHAIN_EMOJI[chain]} *${tokenInfo.symbol}* — ${CHAIN_NAME[chain]}
${LINE}

*${tokenInfo.name}*

💰 *Price:* ${priceStr}
${changeEmoji} *24h:* ${changeStr}

📊 *MCap:* ${mcapStr}
💧 *Liq:* ${liqStr}
📈 *Vol:* ${volStr}
${tokenInfo.holders ? `👥 *Holders:* ${tokenInfo.holders.toLocaleString()}` : ''}
${securitySection}

${LINE}
🔗 [DexScreener](${dexLink}) • [DexTools](${dextoolsLink})
${LINE}
\`${tokenAddress}\``;
    } else {
      message = `${LINE}
${CHAIN_EMOJI[chain]} *TOKEN* — ${CHAIN_NAME[chain]}
${LINE}

⚠️ *New/Unlisted Token*

Data not yet available on DexScreener.
Proceed with extreme caution.

${LINE}
\`${tokenAddress}\``;
    }
  }

  // Build keyboard with buy options - smaller amounts for all chains
  const keyboard = new InlineKeyboard();

  if (chain === 'sol') {
    keyboard
      .text('🛒 0.1 SOL', `buy_sol_${tokenAddress}_0.1`)
      .text('🛒 0.25 SOL', `buy_sol_${tokenAddress}_0.25`)
      .text('🛒 0.5 SOL', `buy_sol_${tokenAddress}_0.5`)
      .row()
      .text('🛒 1 SOL', `buy_sol_${tokenAddress}_1`)
      .text('🛒 2 SOL', `buy_sol_${tokenAddress}_2`)
      .text('✏️ X SOL', `buy_sol_${tokenAddress}_custom`);
  } else if (chain === 'bsc') {
    keyboard
      .text('🛒 0.01 BNB', `buy_bsc_${tokenAddress}_0.01`)
      .text('🛒 0.05 BNB', `buy_bsc_${tokenAddress}_0.05`)
      .text('🛒 0.1 BNB', `buy_bsc_${tokenAddress}_0.1`)
      .row()
      .text('🛒 0.25 BNB', `buy_bsc_${tokenAddress}_0.25`)
      .text('🛒 0.5 BNB', `buy_bsc_${tokenAddress}_0.5`)
      .text('✏️ X BNB', `buy_bsc_${tokenAddress}_custom`);
  } else {
    // ETH and Base
    keyboard
      .text(`🛒 0.005 ${symbol}`, `buy_${chain}_${tokenAddress}_0.005`)
      .text(`🛒 0.01 ${symbol}`, `buy_${chain}_${tokenAddress}_0.01`)
      .text(`🛒 0.025 ${symbol}`, `buy_${chain}_${tokenAddress}_0.025`)
      .row()
      .text(`🛒 0.05 ${symbol}`, `buy_${chain}_${tokenAddress}_0.05`)
      .text(`🛒 0.1 ${symbol}`, `buy_${chain}_${tokenAddress}_0.1`)
      .text(`✏️ X ${symbol}`, `buy_${chain}_${tokenAddress}_custom`);
  }

  keyboard
    .row()
    .text('🔍 Full Scan', `analyze_${chain}_${tokenAddress}`)
    .text('🔄 Refresh', `refresh_${chain}_${tokenAddress}`)
    .row()
    .text('« Back', 'back_to_menu');

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Handle withdrawal amount input
 */
async function handleWithdrawalAmountInput(ctx: MyContext, text: string) {
  const user = ctx.from;
  if (!user || !ctx.session.pendingWithdrawal) return;

  const { chain } = ctx.session.pendingWithdrawal;
  const balances = await getUserBalances(user.id);
  const balance = balances.find((b) => b.chain === chain);

  if (!balance) {
    await ctx.reply('❌ Error: Balance not found.');
    ctx.session.step = null;
    ctx.session.pendingWithdrawal = null;
    return;
  }

  const available = parseFloat(balance.current_value);
  let amount: number;

  if (text.toLowerCase() === 'max') {
    amount = available;
  } else {
    amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('❌ Invalid amount. Please enter a valid number.');
      return;
    }
    if (amount > available) {
      await ctx.reply(`❌ Insufficient balance. Maximum: ${available.toFixed(4)}`);
      return;
    }
  }

  ctx.session.pendingWithdrawal.amount = amount.toString();
  ctx.session.step = 'awaiting_withdrawal_confirm';

  const token = chain === 'bsc' ? 'BNB' : chain === 'sol' ? 'SOL' : 'ETH';

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm', 'confirm_withdraw')
    .text('❌ Cancel', 'cancel');

  await ctx.reply(
    `⚠️ *Confirm Withdrawal*\n\n` +
      `Amount: ${amount.toFixed(4)} ${token}\n` +
      `Chain: ${CHAIN_NAME[chain as Chain]}\n\n` +
      `Funds will be sent to your deposit address.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
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
    const { importSolanaKeypair, importEvmKeypair, createWallet, CHAIN_NAME } = await import(
      '@raptor/shared'
    );

    // Import keypair based on chain type
    const isSolana = chain === 'sol';
    const keypair = isSolana
      ? importSolanaKeypair(privateKey.trim(), user.id)
      : importEvmKeypair(privateKey.trim(), user.id);

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
    await ctx.reply(
      `${LINE}
✅ *WALLET IMPORTED SUCCESSFULLY*
${LINE}

${CHAIN_EMOJI[chain]} *${CHAIN_NAME[chain]}* - Wallet #${wallet.wallet_index}

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
        `Please make sure you're using the correct format:\n` +
        (chain === 'sol' ? '• Base58 format for Solana' : '• Hex format for EVM chains'),
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('« Back to Wallets', 'wallets'),
      }
    );
  }
}

// Extend session type to include pendingSend and awaitingImport
declare module '../types.js' {
  interface SessionData {
    pendingSend?: {
      toAddress: string;
      chain: Chain;
      amount?: string;
      tokenAddress?: string;
    };
    awaitingImport?: Chain;
  }
}
