import { Bot } from 'grammy';
import type { Alert, AlertType } from '@raptor/shared';

let bot: Bot | null = null;

function getBot(): Bot {
  if (!bot) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }
    bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
  }
  return bot;
}

export async function sendAlert(alert: Alert): Promise<void> {
  const message = formatAlert(alert);

  try {
    await getBot().api.sendMessage(alert.tg_id, message, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error(`Failed to send alert to ${alert.tg_id}:`, error);
  }
}

export async function sendAlertToUser(
  tgId: number,
  type: AlertType,
  data: Record<string, unknown>
): Promise<void> {
  await sendAlert({
    type,
    tg_id: tgId,
    data,
    created_at: new Date().toISOString(),
  });
}

function formatAlert(alert: Alert): string {
  const { type, data } = alert;

  switch (type) {
    case 'POSITION_OPENED':
      return (
        `🦖 *Target Acquired*\n\n` +
        `Token: ${data.symbol}\n` +
        `Chain: ${String(data.chain).toUpperCase()}\n` +
        `Amount: ${data.amount} ${data.chain === 'bsc' ? 'BNB' : 'ETH'}\n` +
        `Source: ${data.source}\n` +
        `Score: ${data.score}/100`
      );

    case 'TAKE_PROFIT':
      return (
        `💰 *Target Eliminated*\n\n` +
        `Token: ${data.symbol}\n` +
        `Profit: +${Number(data.pnl_percent).toFixed(1)}%\n` +
        `Gained: +${data.pnl} ${data.chain === 'bsc' ? 'BNB' : 'ETH'}`
      );

    case 'STOP_LOSS':
      return (
        `🛑 *Retreat Executed*\n\n` +
        `Token: ${data.symbol}\n` +
        `Loss: ${Number(data.pnl_percent).toFixed(1)}%\n` +
        `Lost: ${data.pnl} ${data.chain === 'bsc' ? 'BNB' : 'ETH'}`
      );

    case 'DEPOSIT_PENDING': {
      const pendingSymbol = data.symbol || (data.chain === 'bsc' ? 'BNB' : data.chain === 'sol' ? 'SOL' : 'ETH');
      return (
        `⏳ *Deposit Detected*\n\n` +
        `Amount: ${data.amount} ${pendingSymbol}\n` +
        `Chain: ${String(data.chain).toUpperCase()}\n` +
        `Address: \`${String(data.address).slice(0, 8)}...${String(data.address).slice(-6)}\`\n\n` +
        `Waiting for ${data.requiredConfirmations} confirmations...`
      );
    }

    case 'DEPOSIT_CONFIRMED': {
      const depositSymbol = data.symbol || (data.chain === 'bsc' ? 'BNB' : data.chain === 'sol' ? 'SOL' : 'ETH');
      return (
        `✅ *Deposit Confirmed*\n\n` +
        `Amount: ${data.amount} ${depositSymbol}\n` +
        `Chain: ${String(data.chain).toUpperCase()}\n\n` +
        `Funds are now active and hunting.`
      );
    }

    case 'WITHDRAWAL_SENT':
      return (
        `💸 *Withdrawal Sent*\n\n` +
        `Amount: ${data.amount} ${data.chain === 'bsc' ? 'BNB' : 'ETH'}\n` +
        `TX: ${data.tx_hash}`
      );

    case 'DAILY_SUMMARY': {
      const pnlSign = Number(data.pnl) >= 0 ? '+' : '';
      return (
        `📊 *Daily Hunt Report*\n\n` +
        `P&L: ${pnlSign}${Number(data.pnl_percent).toFixed(2)}%\n` +
        `Hunts: ${data.trades}\n` +
        `Win Rate: ${Number(data.win_rate).toFixed(1)}%\n` +
        `Best Kill: ${data.best_trade}`
      );
    }

    default:
      return 'Unknown alert type';
  }
}

// Send daily summaries to all users
export async function sendDailySummaries(): Promise<void> {
  // TODO: Implement daily summary logic
  // 1. Query all users with activity in the last 24h
  // 2. Calculate daily stats for each user
  // 3. Send DAILY_SUMMARY alert to each user
  console.log('Daily summaries would be sent here');
}
