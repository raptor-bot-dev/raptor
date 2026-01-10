/**
 * Multi-RPC Broadcasting for RAPTOR v2.2
 *
 * Broadcasts transactions to multiple RPC endpoints simultaneously
 * to maximize chances of fast inclusion.
 *
 * Features:
 * - 2-3 RPC endpoints per chain
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
 * - BSC_RPC_1, BSC_RPC_2, BSC_RPC_3
 * - BASE_RPC_1, BASE_RPC_2, BASE_RPC_3
 * - ETH_RPC_1, ETH_RPC_2, ETH_RPC_3
 */

// Public RPC fallbacks - only used if env vars not configured
const PUBLIC_FALLBACKS: Record<Chain, string[]> = {
  sol: ['https://api.mainnet-beta.solana.com'],
  bsc: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed1.ninicoin.io'],
  base: ['https://mainnet.base.org'],
  eth: ['https://eth.llamarpc.com'],
};

// Build endpoint list from environment, logging warnings for missing configs
function buildEndpoints(): Record<Chain, RpcEndpoint[]> {
  const chains: Chain[] = ['sol', 'bsc', 'base', 'eth'];
  const result: Record<Chain, RpcEndpoint[]> = {} as Record<Chain, RpcEndpoint[]>;

  for (const chain of chains) {
    const envPrefix = chain === 'sol' ? 'SOLANA' : chain.toUpperCase();
    const endpoints: RpcEndpoint[] = [];

    // Check for environment-configured RPCs
    for (let i = 1; i <= 3; i++) {
      const envVar = `${envPrefix}_RPC_${i}`;
      const url = process.env[envVar];
      if (url) {
        endpoints.push({
          url,
          name: `${chain.toUpperCase()}-RPC-${i}`,
          priority: i === 1 ? 1 : 2,
          healthy: true,
        });
      }
    }

    // If no private RPCs configured, use public fallbacks
    if (endpoints.length === 0) {
      const fallbacks = PUBLIC_FALLBACKS[chain];
      for (let i = 0; i < fallbacks.length; i++) {
        endpoints.push({
          url: fallbacks[i],
          name: `${chain.toUpperCase()}-Public-${i + 1}`,
          priority: 2, // Lower priority for public RPCs
          healthy: true,
        });
      }
      // Log warning in non-test environments
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[MultiRPC] Using public RPC fallbacks for ${chain}. Configure ${envPrefix}_RPC_* for better performance.`);
      }
    }

    result[chain] = endpoints;
  }

  return result;
}

const RPC_ENDPOINTS: Record<Chain, RpcEndpoint[]> = buildEndpoints();

/**
 * Check if private RPCs are configured for a chain
 */
export function hasPrivateRpc(chain: Chain): boolean {
  const envPrefix = chain === 'sol' ? 'SOLANA' : chain.toUpperCase();
  return !!process.env[`${envPrefix}_RPC_1`];
}

/**
 * Check if any chain is using public fallbacks
 */
export function getPublicFallbackChains(): Chain[] {
  const chains: Chain[] = ['sol', 'bsc', 'base', 'eth'];
  return chains.filter(chain => !hasPrivateRpc(chain));
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
 * Broadcast a signed transaction to all RPC endpoints for a chain
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
  const timeout = options?.timeout || 10000; // Reduced from 30s for faster response

  if (endpoints.length === 0) {
    return {
      success: false,
      error: `No healthy RPC endpoints for ${chain}`,
    };
  }

  // Sort by priority (lower = higher priority)
  const sortedEndpoints = [...endpoints].sort((a, b) => a.priority - b.priority);

  // Broadcast to all endpoints in parallel
  const broadcastPromises = sortedEndpoints.map(endpoint =>
    broadcastToEndpoint(chain, endpoint, signedTx, timeout)
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
  chain: Chain,
  endpoint: RpcEndpoint,
  signedTx: string,
  timeout: number
): Promise<{ success: boolean; txHash?: string; error?: string; latency: number }> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let txHash: string;

    if (chain === 'sol') {
      txHash = await broadcastSolana(endpoint.url, signedTx, controller.signal);
    } else {
      txHash = await broadcastEvm(endpoint.url, signedTx, controller.signal);
    }

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
 * Broadcast transaction to EVM RPC
 */
async function broadcastEvm(
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
      method: 'eth_sendRawTransaction',
      params: [signedTx],
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
 * Get healthy endpoints for a chain
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
  const status: Record<string, any> = {};

  for (const [chain, endpoints] of Object.entries(RPC_ENDPOINTS)) {
    status[chain] = {
      total: endpoints.length,
      healthy: endpoints.filter(e => e.healthy).length,
      endpoints: endpoints.map(e => ({
        name: e.name,
        healthy: e.healthy,
        latency: e.lastLatency,
        error: e.lastError,
      })),
    };
  }

  return status as Record<Chain, any>;
}

/**
 * Reset endpoint health (for recovery)
 */
export function resetEndpointHealth(chain?: Chain): void {
  const chains = chain ? [chain] : Object.keys(RPC_ENDPOINTS) as Chain[];

  for (const c of chains) {
    for (const endpoint of RPC_ENDPOINTS[c]) {
      endpoint.healthy = true;
      endpoint.lastError = undefined;
    }
  }
}

/**
 * Make a generic RPC call to a chain (with failover)
 */
export async function rpcCall<T>(
  chain: Chain,
  method: string,
  params: unknown[],
  options?: { timeout?: number }
): Promise<T> {
  const endpoints = RPC_ENDPOINTS[chain].filter(e => e.healthy);
  const timeout = options?.timeout || 5000; // Reduced from 10s for faster response

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

  throw new Error(`All RPC endpoints failed for ${chain}`);
}
