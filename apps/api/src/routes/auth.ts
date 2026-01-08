import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateTelegramAuth } from '../middleware/auth.js';
import { upsertUser } from '@raptor/shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body;

    if (!initData) {
      return res.status(400).json({ error: 'Missing initData' });
    }

    const user = validateTelegramAuth(initData);

    if (!user) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    // Upsert user in database
    await upsertUser({
      tg_id: user.id,
      username: user.username || null,
      first_name: user.first_name,
      photo_url: user.photo_url || null,
    });

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        photoUrl: user.photo_url,
      },
    });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
