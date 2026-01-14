/**
 * Chain Detection Service for RAPTOR
 * v4.0: Solana-only build
 *
 * Validates Solana addresses and provides chain detection interface
 */

import type { Chain } from '../types.js';

// Cache for chain detection results
const cache = new Map<string, { chains: Chain[]; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Solana address format pattern
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// RPC endpoint for Solana
const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export interface ChainDetectionResult {
  chains: Chain[];
  primaryChain: Chain | null;
  confidence: 'high' | 'medium' | 'low';
  addressType: 'token' | 'wallet' | 'unknown';
}

/**
 * Detect which chain an address exists on
 * v4.0: Solana-only, returns 'sol' for valid addresses
 */
export async function detectChain(address: string): Promise<ChainDetectionResult> {
  // Check cache first
  const cacheKey = address.toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiry) {
    return {
      chains: cached.chains,
      primaryChain: cached.chains[0] || null,
      confidence: 'high',
      addressType: 'token',
    };
  }

  // Check if valid Solana address
  if (!SOLANA_ADDRESS_REGEX.test(address)) {
    return {
      chains: [],
      primaryChain: null,
      confidence: 'high',
      addressType: 'unknown',
    };
  }

  // Valid Solana address
  const chains: Chain[] = ['sol'];
  cache.set(cacheKey, { chains, expiry: Date.now() + CACHE_TTL });

  return {
    chains,
    primaryChain: 'sol',
    confidence: 'high',
    addressType: 'token',
  };
}

/**
 * Check if Solana account exists
 */
export async function checkSolanaAccount(address: string): Promise<boolean> {
  try {
    const response = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [address, { encoding: 'base64' }],
      }),
      signal: AbortSignal.timeout(3000),
    });

    const json = await response.json() as { result?: { value: unknown } };
    return json.result?.value !== null;
  } catch {
    return false;
  }
}

/**
 * Get the address format type
 * v4.0: Only 'solana' or 'unknown'
 */
export function getAddressFormat(address: string): 'solana' | 'unknown' {
  if (SOLANA_ADDRESS_REGEX.test(address)) return 'solana';
  return 'unknown';
}

/**
 * Validate address format
 * v4.0: Only validates Solana addresses
 */
export function isValidAddress(address: string): boolean {
  return SOLANA_ADDRESS_REGEX.test(address);
}

/**
 * Clear the chain detection cache
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Pre-warm cache for an address
 */
export async function prewarmCache(address: string): Promise<void> {
  await detectChain(address);
}
