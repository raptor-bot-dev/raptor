import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from '../middleware/auth.js';
import { getRecentTrades, getActivePositions } from '@raptor/shared';

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
    const { type = 'all', limit = '50' } = req.query;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);

    if (type === 'positions') {
      // Return active positions
      const positions = await getActivePositions(tgUser.id);

      return res.status(200).json({
        positions: positions.map((p) => ({
          id: p.id,
          chain: p.chain,
          tokenAddress: p.token_address,
          tokenSymbol: p.token_symbol,
          amountIn: p.amount_in,
          tokensHeld: p.tokens_held,
          entryPrice: p.entry_price,
          currentPrice: p.current_price,
          unrealizedPnl: p.unrealized_pnl,
          unrealizedPnlPercent: p.unrealized_pnl_percent,
          takeProfitPercent: p.take_profit_percent,
          stopLossPercent: p.stop_loss_percent,
          source: p.source,
          score: p.score,
          status: p.status,
          createdAt: p.created_at,
        })),
      });
    }

    // Return trade history
    const trades = await getRecentTrades(tgUser.id, limitNum);

    return res.status(200).json({
      trades: trades.map((t) => ({
        id: t.id,
        positionId: t.position_id,
        chain: t.chain,
        tokenAddress: t.token_address,
        tokenSymbol: t.token_symbol,
        type: t.type,
        amountIn: t.amount_in,
        amountOut: t.amount_out,
        price: t.price,
        pnl: t.pnl,
        pnlPercent: t.pnl_percent,
        source: t.source,
        txHash: t.tx_hash,
        status: t.status,
        createdAt: t.created_at,
      })),
    });
  } catch (error) {
    console.error('Trades fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export default authMiddleware(handler);
