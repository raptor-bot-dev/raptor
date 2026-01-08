import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from '../middleware/auth.js';
import { getUser, getUserBalances, getUserStats } from '@raptor/shared';

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
    const [user, balances, stats] = await Promise.all([
      getUser(tgUser.id),
      getUserBalances(tgUser.id),
      getUserStats(tgUser.id),
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({
      user: {
        tgId: user.tg_id,
        username: user.username,
        firstName: user.first_name,
        photoUrl: user.photo_url,
        createdAt: user.created_at,
        lastLogin: user.last_login,
      },
      balances: balances.map((b) => ({
        chain: b.chain,
        deposited: b.deposited,
        currentValue: b.current_value,
        depositAddress: b.deposit_address,
      })),
      stats: {
        deposited: stats.deposited,
        currentValue: stats.currentValue,
        totalPnl: stats.totalPnl,
        pnlPercent: stats.pnlPercent,
        totalTrades: stats.totalTrades,
        winningTrades: stats.winningTrades,
        winRate: stats.winRate,
      },
    });
  } catch (error) {
    console.error('User fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default authMiddleware(handler);
