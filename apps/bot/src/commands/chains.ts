// /chains command - Show supported chains and user balances

import { CommandContext, Context } from 'grammy';
import {
  getUserBalances,
  BSC_CONFIG,
  BASE_CONFIG,
  ETH_CONFIG,
  SOLANA_CONFIG,
  type Chain,
} from '@raptor/shared';

interface ChainInfo {
  name: string;
  symbol: string;
  key: Chain;
  emoji: string;
  explorerUrl: string;
  minPosition: string;
  dexName: string;
}

const CHAINS: ChainInfo[] = [
  {
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    key: 'bsc',
    emoji: '🟡',
    explorerUrl: BSC_CONFIG.explorerUrl,
    minPosition: '0.05 BNB',
    dexName: 'PancakeSwap',
  },
  {
    name: 'Base',
    symbol: 'ETH',
    key: 'base',
    emoji: '🔵',
    explorerUrl: BASE_CONFIG.explorerUrl,
    minPosition: '0.01 ETH',
    dexName: 'Uniswap/Aerodrome',
  },
  {
    name: 'Ethereum',
    symbol: 'ETH',
    key: 'eth',
    emoji: '⚪',
    explorerUrl: ETH_CONFIG.explorerUrl,
    minPosition: '0.05 ETH',
    dexName: 'Uniswap',
  },
  {
    name: 'Solana',
    symbol: 'SOL',
    key: 'sol',
    emoji: '🟣',
    explorerUrl: 'https://solscan.io',
    minPosition: '0.1 SOL',
    dexName: 'Jupiter/Raydium',
  },
];

export async function chainsCommand(ctx: CommandContext<Context>): Promise<void> {
  const tgId = ctx.from?.id;
  if (!tgId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  // Get user balances
  let balances: Map<Chain, { pool: number; solo: number; snipe: number }>;
  try {
    const userBalances = await getUserBalances(tgId);
    balances = new Map();

    for (const balance of userBalances) {
      const chain = balance.chain;
      const current = balances.get(chain) || { pool: 0, solo: 0, snipe: 0 };
      const amount = parseFloat(balance.current_value);

      if (balance.mode === 'pool') current.pool = amount;
      else if (balance.mode === 'solo') current.solo = amount;
      else if (balance.mode === 'snipe') current.snipe = amount;

      balances.set(chain, current);
    }
  } catch {
    balances = new Map();
  }

  let message = '🌐 *Supported Chains*\n\n';

  for (const chain of CHAINS) {
    const balance = balances.get(chain.key) || { pool: 0, solo: 0, snipe: 0 };
    const totalBalance = balance.pool + balance.solo + balance.snipe;

    message += `${chain.emoji} *${chain.name}* (${chain.symbol})\n`;
    message += `├ DEX: ${chain.dexName}\n`;
    message += `├ Min Position: ${chain.minPosition}\n`;

    if (totalBalance > 0) {
      message += `└ Your Balance:\n`;
      if (balance.pool > 0) {
        message += `   • Pool: ${balance.pool.toFixed(4)} ${chain.symbol}\n`;
      }
      if (balance.solo > 0) {
        message += `   • Solo: ${balance.solo.toFixed(4)} ${chain.symbol}\n`;
      }
      if (balance.snipe > 0) {
        message += `   • Snipe: ${balance.snipe.toFixed(4)} ${chain.symbol}\n`;
      }
    } else {
      message += `└ Balance: 0 ${chain.symbol}\n`;
    }

    message += '\n';
  }

  message += '📊 *Trading Modes*\n\n';
  message += '• *Pool* - Collective trading (shared P&L)\n';
  message += '• *Solo* - Personal vault (100% allocation)\n';
  message += '• *Snipe* - Manual token sniping\n\n';

  message += '💡 Use /deposit to add funds to any chain.';

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// Show gas prices for all chains
export async function gasPricesCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  let message = '⛽ *Current Gas Prices*\n\n';

  // In production, these would be fetched from RPC
  const gasPrices: Record<Chain, string> = {
    bsc: '~3 Gwei',
    base: '~0.01 Gwei',
    eth: '~15-50 Gwei',
    sol: '~5000 lamports',
  };

  for (const chain of CHAINS) {
    message += `${chain.emoji} ${chain.name}: ${gasPrices[chain.key]}\n`;
  }

  message += '\n💡 Gas prices vary based on network congestion.';

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// Show chain-specific explorer links
export async function explorerCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  const args = ctx.match?.toString().trim().split(/\s+/) || [];

  if (args.length < 2 || args[0] === '') {
    await ctx.reply(
      '*Block Explorer Links*\n\n' +
        'Usage: `/explorer <address|tx> <chain>`\n\n' +
        '*Examples:*\n' +
        '`/explorer 0x123...abc bsc`\n' +
        '`/explorer 4Nd1...xyz sol`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [addressOrTx, chainInput] = args;
  const chainKey = chainInput.toLowerCase() as Chain;
  const chain = CHAINS.find((c) => c.key === chainKey);

  if (!chain) {
    await ctx.reply('Invalid chain. Use: bsc, base, eth, or sol');
    return;
  }

  let url: string;
  if (chainKey === 'sol') {
    // Determine if it's a transaction or address
    if (addressOrTx.length > 50) {
      url = `https://solscan.io/tx/${addressOrTx}`;
    } else {
      url = `https://solscan.io/account/${addressOrTx}`;
    }
  } else {
    // EVM chains
    if (addressOrTx.length === 66) {
      // Transaction hash
      url = `${chain.explorerUrl}/tx/${addressOrTx}`;
    } else {
      // Address
      url = `${chain.explorerUrl}/address/${addressOrTx}`;
    }
  }

  await ctx.reply(
    `${chain.emoji} *${chain.name} Explorer*\n\n` +
      `[View on Explorer](${url})`,
    { parse_mode: 'Markdown' }
  );
}
