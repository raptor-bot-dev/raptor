import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function validateTelegramAuth(initData: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    // Sort parameters and create data check string
    const sortedParams = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Create secret key
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    // Calculate hash
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(sortedParams)
      .digest('hex');

    if (calculatedHash !== hash) {
      return null;
    }

    // Check auth_date is not too old (24 hours)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (Date.now() / 1000 - authDate > 86400) {
      return null;
    }

    // Parse user data
    const userJson = params.get('user');
    if (!userJson) return null;

    const user = JSON.parse(userJson);
    return {
      ...user,
      auth_date: authDate,
      hash: hash!,
    };
  } catch {
    return null;
  }
}

export function authMiddleware(
  handler: (
    req: VercelRequest,
    res: VercelResponse,
    user: TelegramUser
  ) => Promise<void | VercelResponse>
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void | VercelResponse> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('tma ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const initData = authHeader.slice(4);
    const user = validateTelegramAuth(initData);

    if (!user) {
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    await handler(req, res, user);
  };
}
