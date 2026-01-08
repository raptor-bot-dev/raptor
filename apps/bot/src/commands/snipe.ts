// /snipe command - Manual sniping of tokens
// Usage: /snipe <contract> <amount> <chain>

import { CommandContext, Context } from 'grammy';
import {
  createSnipeRequest,
  getUserBalancesByMode,
  type Chain,
} from '@raptor/shared';

const CHAIN_NAMES: Record<string, Chain> = {
  bsc: 'bsc',
  bnb: 'bsc',
  base: 'base',
  eth: 'eth',
  ethereum: 'eth',
  sol: 'sol',
  solana: 'sol',
};

const CHAIN_SYMBOLS: Record<Chain, string> = {
  bsc: 'BNB',
  base: 'ETH',
  eth: 'ETH',
  sol: 'SOL',
};

const MIN_AMOUNTS: Record<Chain, number> = {
  bsc: 0.05,
  base: 0.01,
  eth: 0.05,
  sol: 0.1,
};

export async function snipeCommand(ctx: CommandContext<Context>): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  // Parse arguments: /snipe <contract> <amount> <chain>
  const args = ctx.match?.toString().trim().split(/\s+/) || [];

  if (args.length < 3) {
    await ctx.reply(
      `*Manual Snipe*\n\n` +
        `Usage: \`/snipe <contract> <amount> <chain>\`\n\n` +
        `*Example:*\n` +
        `\`/snipe 0x1234...abcd 0.5 bsc\`\n` +
        `\`/snipe 6EF8...xyz 1.0 sol\`\n\n` +
        `*Supported chains:*\n` +
        `• bsc (BNB Smart Chain)\n` +
        `• base (Base)\n` +
        `• eth (Ethereum)\n` +
        `• sol (Solana)\n\n` +
        `*Note:* 1% fee is applied to all trades.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [tokenAddress, amountStr, chainInput] = args;

  // Validate chain
  const chain = CHAIN_NAMES[chainInput.toLowerCase()];
  if (!chain) {
    await ctx.reply(
      `Invalid chain. Supported: bsc, base, eth, sol`
    );
    return;
  }

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Invalid amount. Please enter a positive number.');
    return;
  }

  // Check minimum amount
  const minAmount = MIN_AMOUNTS[chain];
  const symbol = CHAIN_SYMBOLS[chain];
  if (amount < minAmount) {
    await ctx.reply(
      `Minimum snipe amount is ${minAmount} ${symbol}`
    );
    return;
  }

  // Validate token address format
  if (chain === 'sol') {
    // Solana base58 address
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenAddress)) {
      await ctx.reply(
        'Invalid Solana token address. Must be a valid base58 address.'
      );
      return;
    }
  } else {
    // EVM address
    if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
      await ctx.reply(
        'Invalid token address. Must be a valid EVM address (0x...).'
      );
      return;
    }
  }

  // Check user balance in snipe mode
  try {
    const balances = await getUserBalancesByMode(tgId, 'snipe');
    const chainBalance = balances.find((b) => b.chain === chain);
    const currentBalance = chainBalance
      ? parseFloat(chainBalance.current_value)
      : 0;

    if (currentBalance < amount) {
      await ctx.reply(
        `Insufficient balance.\n\n` +
          `Your snipe balance: ${currentBalance.toFixed(4)} ${symbol}\n` +
          `Required: ${amount} ${symbol}\n\n` +
          `Use /deposit to add funds to your snipe wallet.`
      );
      return;
    }

    // Create snipe request
    await ctx.reply(`Creating snipe request...`);

    const request = await createSnipeRequest({
      tg_id: tgId,
      chain,
      token_address: tokenAddress,
      amount: amount.toString(),
      take_profit_percent: 50, // Default 50%
      stop_loss_percent: 30, // Default 30%
      skip_safety_check: false,
    });

    await ctx.reply(
      `*Snipe Request Created*\n\n` +
        `Request ID: \`${request.id}\`\n` +
        `Token: \`${tokenAddress}\`\n` +
        `Amount: ${amount} ${symbol}\n` +
        `Chain: ${chain.toUpperCase()}\n` +
        `Status: PENDING\n\n` +
        `Your snipe will be executed shortly.\n` +
        `Use /positions to track your positions.`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Snipe error:', error);
    await ctx.reply(
      'Failed to create snipe request. Please try again later.'
    );
  }
}

// Advanced snipe with custom TP/SL
export async function snipeAdvancedCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  // Parse: /snipe_advanced <contract> <amount> <chain> <tp%> <sl%> [--skip-safety]
  const args = ctx.match?.toString().trim().split(/\s+/) || [];

  if (args.length < 5) {
    await ctx.reply(
      `*Advanced Snipe*\n\n` +
        `Usage: \`/snipe_advanced <contract> <amount> <chain> <tp%> <sl%> [--skip-safety]\`\n\n` +
        `*Example:*\n` +
        `\`/snipe_advanced 0x123...abc 0.5 bsc 100 20\`\n` +
        `(Take profit at +100%, stop loss at -20%)\n\n` +
        `Add \`--skip-safety\` to bypass safety checks (risky!).`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [tokenAddress, amountStr, chainInput, tpStr, slStr, ...flags] = args;
  const skipSafety = flags.includes('--skip-safety');

  // Validate chain
  const chain = CHAIN_NAMES[chainInput.toLowerCase()];
  if (!chain) {
    await ctx.reply('Invalid chain. Supported: bsc, base, eth, sol');
    return;
  }

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Invalid amount.');
    return;
  }

  // Validate TP/SL
  const takeProfitPercent = parseInt(tpStr, 10);
  const stopLossPercent = parseInt(slStr, 10);

  if (isNaN(takeProfitPercent) || takeProfitPercent < 10) {
    await ctx.reply('Take profit must be at least 10%.');
    return;
  }

  if (isNaN(stopLossPercent) || stopLossPercent < 5 || stopLossPercent > 90) {
    await ctx.reply('Stop loss must be between 5% and 90%.');
    return;
  }

  try {
    const request = await createSnipeRequest({
      tg_id: tgId,
      chain,
      token_address: tokenAddress,
      amount: amount.toString(),
      take_profit_percent: takeProfitPercent,
      stop_loss_percent: stopLossPercent,
      skip_safety_check: skipSafety,
    });

    const symbol = CHAIN_SYMBOLS[chain];

    await ctx.reply(
      `*Advanced Snipe Request Created*\n\n` +
        `Request ID: \`${request.id}\`\n` +
        `Token: \`${tokenAddress}\`\n` +
        `Amount: ${amount} ${symbol}\n` +
        `Take Profit: +${takeProfitPercent}%\n` +
        `Stop Loss: -${stopLossPercent}%\n` +
        `Safety Check: ${skipSafety ? 'SKIPPED ⚠️' : 'Enabled'}\n` +
        `Status: PENDING`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Advanced snipe error:', error);
    await ctx.reply('Failed to create snipe request.');
  }
}
