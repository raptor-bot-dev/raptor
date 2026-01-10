// Health check endpoint for RAPTOR API

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  HealthChecker,
  createDatabaseCheck,
  createMemoryCheck,
  createRpcCheck,
  supabase,
  SOLANA_CONFIG,
  BSC_CONFIG,
  BASE_CONFIG,
} from '@raptor/shared';
import { Connection } from '@solana/web3.js';
import { ethers } from 'ethers';

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

// Add Redis check (if REDIS_URL is configured)
if (process.env.REDIS_URL) {
  healthChecker.addCheck('redis', async () => {
    try {
      // Simple Redis connectivity check
      const redis = await import('redis').then(m => m.createClient({ url: process.env.REDIS_URL }));
      await redis.connect();
      await redis.ping();
      await redis.quit();
      return {
        name: 'redis',
        status: 'pass' as const,
        message: 'Connected',
      };
    } catch (error) {
      return {
        name: 'redis',
        status: 'warn' as const,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  });
}

// Add Solana RPC check
healthChecker.addCheck(
  'solana-rpc',
  createRpcCheck('solana', async () => {
    try {
      const connection = new Connection(SOLANA_CONFIG.rpcUrl, 'confirmed');
      const slot = await Promise.race([
        connection.getSlot(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        ),
      ]);
      return slot as number;
    } catch {
      return null;
    }
  })
);

// Add BSC RPC check
healthChecker.addCheck(
  'bsc-rpc',
  createRpcCheck('bsc', async () => {
    try {
      const provider = new ethers.JsonRpcProvider(BSC_CONFIG.rpcUrl);
      const blockNumber = await Promise.race([
        provider.getBlockNumber(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        ),
      ]);
      return blockNumber as number;
    } catch {
      return null;
    }
  })
);

// Add Base RPC check
healthChecker.addCheck(
  'base-rpc',
  createRpcCheck('base', async () => {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_CONFIG.rpcUrl);
      const blockNumber = await Promise.race([
        provider.getBlockNumber(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 5000)
        ),
      ]);
      return blockNumber as number;
    } catch {
      return null;
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
