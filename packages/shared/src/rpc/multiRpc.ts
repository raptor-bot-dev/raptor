/**
 * Multi-RPC Broadcasting for RAPTOR v4.0
 * Solana-only build
 *
 * Broadcasts transactions to multiple RPC endpoints simultaneously
 * to maximize chances of fast inclusion.
 *
 * Features:
 * - 2-3 RPC endpoints for Solana
 * - Parallel broadcast to all endpoints
 * - Returns first successful response
 * - Automatic failover
 * - Health tracking per endpoint
 */

import type { Chain } from '../types.js';

// JSON-RPC response type
interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: string;
  error?: {
    code: number;
    message: string;
  };
}

// RPC endpoint configuration
interface RpcEndpoint {
  url: string;
  name: string;
  priority: number; // Lower = higher priority
  healthy: boolean;
  lastError?: string;
  lastLatency?: number;
}

/**
 * SECURITY: L-004 - RPC Configuration
 *
 * Public RPC fallbacks are rate-limited and may be unreliable.
 * For production, configure private RPCs via environment variables:
 * - SOLANA_RPC_1, SOLANA_RPC_2, SOLANA_RPC_3
 */

// Public RPC fallbacks - only used if env vars not configured
const PUBLIC_FALLBACKS: Record<Chain, string[]> = {
  sol: ['https://api.mainnet-beta.solana.com'],
};

// Build endpoint list from environment
function buildEndpoints(): Record<Chain, RpcEndpoint[]> {
  const result: Record<Chain, RpcEndpoint[]> = { sol: [] };
  const endpoints: RpcEndpoint[] = [];

  // Check SOLANA_RPC_URL first (primary RPC, e.g. Helius)
  const primaryRpc = process.env.SOLANA_RPC_URL;
  if (primaryRpc) {
    endpoints.push({
      url: primaryRpc,
      name: 'SOL-RPC-Primary',
      priority: 1,
      healthy: true,
    });
  }

  // Check for additional numbered RPCs (SOLANA_RPC_1, _2, _3)
  for (let i = 1; i <= 3; i++) {
    const envVar = `SOLANA_RPC_${i}`;
    const url = process.env[envVar];
    if (url && url !== primaryRpc) {
      endpoints.push({
        url,
        name: `SOL-RPC-${i}`,
        priority: i === 1 && !primaryRpc ? 1 : 2,
        healthy: true,
      });
    }
  }

  // If no private RPCs configured, use public fallbacks
  if (endpoints.length === 0) {
    const fallbacks = PUBLIC_FALLBACKS.sol;
    for (let i = 0; i < fallbacks.length; i++) {
      endpoints.push({
        url: fallbacks[i],
        name: `SOL-Public-${i + 1}`,
        priority: 2, // Lower priority for public RPCs
        healthy: true,
      });
    }
    // Log warning in non-test environments
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[MultiRPC] Using public RPC fallbacks for Solana. Configure SOLANA_RPC_* for better performance.');
    }
  }

  result.sol = endpoints;
  return result;
}

const RPC_ENDPOINTS: Record<Chain, RpcEndpoint[]> = buildEndpoints();

/**
 * Check if private RPCs are configured
 */
export function hasPrivateRpc(_chain: Chain): boolean {
  return !!(process.env['SOLANA_RPC_URL'] || process.env['SOLANA_RPC_1']);
}

/**
 * Check if using public fallbacks
 */
export function getPublicFallbackChains(): Chain[] {
  return hasPrivateRpc('sol') ? [] : ['sol'];
}

// Broadcast result
interface BroadcastResult {
  success: boolean;
  txHash?: string;
  endpoint?: string;
  latency?: number;
  error?: string;
  allResults?: {
    endpoint: string;
    success: boolean;
    txHash?: string;
    error?: string;
    latency: number;
  }[];
}

/**
 * Broadcast a signed transaction to all RPC endpoints
 * Returns the first successful result
 */
export async function broadcastTransaction(
  chain: Chain,
  signedTx: string,
  options?: {
    timeout?: number;
    waitForConfirmation?: boolean;
  }
): Promise<BroadcastResult> {
  const endpoints = RPC_ENDPOINTS[chain].filter(e => e.healthy);
  const timeout = options?.timeout || 10000;

  if (endpoints.length === 0) {
    return {
      success: false,
      error: 'No healthy RPC endpoints for Solana',
    };
  }

  // Sort by priority (lower = higher priority)
  const sortedEndpoints = [...endpoints].sort((a, b) => a.priority - b.priority);

  // Broadcast to all endpoints in parallel
  const broadcastPromises = sortedEndpoints.map(endpoint =>
    broadcastToEndpoint(endpoint, signedTx, timeout)
  );

  // Race for first success, but collect all results
  const results = await Promise.allSettled(broadcastPromises);

  const allResults = results.map((result, index) => {
    const endpoint = sortedEndpoints[index];
    if (result.status === 'fulfilled') {
      return {
        endpoint: endpoint.name,
        ...result.value,
      };
    }
    return {
      endpoint: endpoint.name,
      success: false as const,
      txHash: undefined as string | undefined,
      error: result.reason?.message || 'Unknown error',
      latency: timeout,
    };
  });

  // Find first successful result
  const successResult = allResults.find(r => r.success && r.txHash);

  if (successResult && successResult.txHash) {
    return {
      success: true,
      txHash: successResult.txHash,
      endpoint: successResult.endpoint,
      latency: successResult.latency,
      allResults,
    };
  }

  // All failed
  return {
    success: false,
    error: allResults.map(r => `${r.endpoint}: ${r.error}`).join('; '),
    allResults,
  };
}

/**
 * Broadcast to a single endpoint
 */
async function broadcastToEndpoint(
  endpoint: RpcEndpoint,
  signedTx: string,
  timeout: number
): Promise<{ success: boolean; txHash?: string; error?: string; latency: number }> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const txHash = await broadcastSolana(endpoint.url, signedTx, controller.signal);

    clearTimeout(timeoutId);
    const latency = Date.now() - startTime;

    // Update endpoint health
    endpoint.healthy = true;
    endpoint.lastLatency = latency;
    endpoint.lastError = undefined;

    return {
      success: true,
      txHash,
      latency,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update endpoint health on repeated failures
    endpoint.lastError = errorMessage;
    if (errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      endpoint.healthy = false;
    }

    return {
      success: false,
      error: errorMessage,
      latency,
    };
  }
}

/**
 * Broadcast transaction to Solana RPC
 */
async function broadcastSolana(
  rpcUrl: string,
  signedTx: string,
  signal: AbortSignal
): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        signedTx,
        {
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        },
      ],
    }),
    signal,
  });

  const data = await response.json() as JsonRpcResponse;

  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return data.result!;
}

/**
 * Get healthy endpoints for Solana
 */
export function getHealthyEndpoints(chain: Chain): RpcEndpoint[] {
  return RPC_ENDPOINTS[chain].filter(e => e.healthy);
}

/**
 * Get endpoint status for monitoring
 */
export function getEndpointStatus(): Record<Chain, {
  total: number;
  healthy: number;
  endpoints: { name: string; healthy: boolean; latency?: number; error?: string }[];
}> {
  const endpoints = RPC_ENDPOINTS.sol;
  return {
    sol: {
      total: endpoints.length,
      healthy: endpoints.filter(e => e.healthy).length,
      endpoints: endpoints.map(e => ({
        name: e.name,
        healthy: e.healthy,
        latency: e.lastLatency,
        error: e.lastError,
      })),
    },
  };
}

/**
 * Reset endpoint health (for recovery)
 */
export function resetEndpointHealth(_chain?: Chain): void {
  for (const endpoint of RPC_ENDPOINTS.sol) {
    endpoint.healthy = true;
    endpoint.lastError = undefined;
  }
}

/**
 * Make a generic RPC call (with failover)
 */
export async function rpcCall<T>(
  chain: Chain,
  method: string,
  params: unknown[],
  options?: { timeout?: number }
): Promise<T> {
  const endpoints = RPC_ENDPOINTS[chain].filter(e => e.healthy);
  const timeout = options?.timeout || 5000;

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json() as { result?: T; error?: { message: string } };

      if (data.error) {
        throw new Error(data.error.message);
      }

      return data.result as T;
    } catch (error) {
      // Try next endpoint
      continue;
    }
  }

  throw new Error('All RPC endpoints failed for Solana');
}
