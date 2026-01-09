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

// RPC endpoints per chain (would be from env in production)
const RPC_ENDPOINTS: Record<Chain, RpcEndpoint[]> = {
  sol: [
    { url: process.env.SOLANA_RPC_1 || 'https://api.mainnet-beta.solana.com', name: 'Solana Public', priority: 2, healthy: true },
    { url: process.env.SOLANA_RPC_2 || '', name: 'Helius', priority: 1, healthy: true },
    { url: process.env.SOLANA_RPC_3 || '', name: 'QuickNode', priority: 1, healthy: true },
  ].filter(e => e.url),
  bsc: [
    { url: process.env.BSC_RPC_1 || 'https://bsc-dataseed.binance.org', name: 'Binance', priority: 1, healthy: true },
    { url: process.env.BSC_RPC_2 || 'https://bsc-dataseed1.defibit.io', name: 'Defibit', priority: 2, healthy: true },
    { url: process.env.BSC_RPC_3 || 'https://bsc-dataseed1.ninicoin.io', name: 'Ninicoin', priority: 2, healthy: true },
  ],
  base: [
    { url: process.env.BASE_RPC_1 || 'https://mainnet.base.org', name: 'Base Public', priority: 2, healthy: true },
    { url: process.env.BASE_RPC_2 || '', name: 'Alchemy', priority: 1, healthy: true },
    { url: process.env.BASE_RPC_3 || '', name: 'QuickNode', priority: 1, healthy: true },
  ].filter(e => e.url),
  eth: [
    { url: process.env.ETH_RPC_1 || 'https://eth.llamarpc.com', name: 'LlamaRPC', priority: 2, healthy: true },
    { url: process.env.ETH_RPC_2 || '', name: 'Alchemy', priority: 1, healthy: true },
    { url: process.env.ETH_RPC_3 || '', name: 'Infura', priority: 1, healthy: true },
  ].filter(e => e.url),
};

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
  const timeout = options?.timeout || 30000;

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
  const timeout = options?.timeout || 10000;

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
