import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from '../middleware/auth.js';
import { supabase } from '@raptor/shared';

async function handler(
  req: VercelRequest,
  res: VercelResponse,
  tgUser: { id: number }
) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { period = '7d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get trades in period
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('tg_id', tgUser.id)
      .eq('status', 'CONFIRMED')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Calculate stats
    const buyTrades = trades?.filter((t) => t.type === 'BUY') || [];
    const sellTrades = trades?.filter((t) => t.type === 'SELL') || [];

    const totalBuys = buyTrades.length;
    const totalSells = sellTrades.length;
    const winningTrades = sellTrades.filter(
      (t) => parseFloat(t.pnl || '0') > 0
    ).length;

    const totalPnl = sellTrades.reduce(
      (sum, t) => sum + parseFloat(t.pnl || '0'),
      0
    );

    // Group by day for chart data
    const dailyPnl = new Map<string, number>();
    for (const trade of sellTrades) {
      const date = trade.created_at.split('T')[0];
      const existing = dailyPnl.get(date) || 0;
      dailyPnl.set(date, existing + parseFloat(trade.pnl || '0'));
    }

    return res.status(200).json({
      period,
      summary: {
        totalBuys,
        totalSells,
        winningTrades,
        winRate: totalSells > 0 ? (winningTrades / totalSells) * 100 : 0,
        totalPnl,
      },
      chart: Array.from(dailyPnl.entries()).map(([date, pnl]) => ({
        date,
        pnl,
      })),
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default authMiddleware(handler);
