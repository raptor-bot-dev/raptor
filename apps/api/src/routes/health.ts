// Health check endpoint for RAPTOR API

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  HealthChecker,
  createDatabaseCheck,
  createMemoryCheck,
  supabase,
} from '@raptor/shared';

// Create health checker for API
const healthChecker = new HealthChecker('1.0.0');

// Add database check
healthChecker.addCheck(
  'database',
  createDatabaseCheck('supabase', async () => {
    try {
      const { error } = await supabase.from('users').select('tg_id').limit(1);
      return !error;
    } catch {
      return false;
    }
  })
);

// Add memory check
healthChecker.addCheck('memory', createMemoryCheck(256, 512));

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const health = await healthChecker.check();

    // Set appropriate status code based on health
    const statusCode =
      health.status === 'healthy'
        ? 200
        : health.status === 'degraded'
        ? 200
        : 503;

    // Set cache headers
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    return res.status(statusCode).json(health);
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
}
