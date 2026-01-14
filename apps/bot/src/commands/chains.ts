// /chains command - Show supported chain (Solana-only build)

import { CommandContext, Context } from 'grammy';
import {
  getUserBalances,
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

  message += '💡 Use /deposit to add funds.';

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// Show gas prices (Solana priority fees)
export async function gasPricesCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  let message = '⛽ *Current Priority Fees*\n\n';

  message += '🟣 Solana: ~5000 lamports\n';
  message += '\n💡 Priority fees vary based on network congestion.';

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

// Show chain-specific explorer links
export async function explorerCommand(
  ctx: CommandContext<Context>
): Promise<void> {
  const args = ctx.match?.toString().trim().split(/\s+/) || [];

  if (args.length < 1 || args[0] === '') {
    await ctx.reply(
      '*Block Explorer Links*\n\n' +
        'Usage: `/explorer <address|tx>`\n\n' +
        '*Examples:*\n' +
        '`/explorer 4Nd1...xyz`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const addressOrTx = args[0];

  let url: string;
  // Determine if it's a transaction or address based on length
  if (addressOrTx.length > 50) {
    url = `https://solscan.io/tx/${addressOrTx}`;
  } else {
    url = `https://solscan.io/account/${addressOrTx}`;
  }

  await ctx.reply(
    `🟣 *Solana Explorer*\n\n` +
      `[View on Solscan](${url})`,
    { parse_mode: 'Markdown' }
  );
}
