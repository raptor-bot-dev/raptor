/**
 * Chain Auto-Detection Service for RAPTOR
 *
 * Detects which blockchain a token/address belongs to:
 * - Uses DexScreener API for quick detection
 * - Falls back to parallel RPC calls if needed
 * - Caches results for performance
 */

import type { Chain } from '../types.js';
import * as dexscreener from './dexscreener.js';

// Cache for chain detection results
const cache = new Map<string, { chains: Chain[]; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Address format patterns
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// RPC endpoints for fallback detection
const RPC_ENDPOINTS: Record<Chain, string> = {
  sol: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
  base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  eth: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
};

export interface ChainDetectionResult {
  chains: Chain[];
  primaryChain: Chain | null;
  confidence: 'high' | 'medium' | 'low';
  addressType: 'token' | 'wallet' | 'unknown';
}

/**
 * Detect which chains an address exists on
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

  // Determine address type from format
  const isSolana = SOLANA_ADDRESS_REGEX.test(address);
  const isEvm = EVM_ADDRESS_REGEX.test(address);

  if (!isSolana && !isEvm) {
    return {
      chains: [],
      primaryChain: null,
      confidence: 'high',
      addressType: 'unknown',
    };
  }

  // For Solana addresses, it's definitely on Solana
  if (isSolana) {
    const chains: Chain[] = ['sol'];
    cache.set(cacheKey, { chains, expiry: Date.now() + CACHE_TTL });
    return {
      chains,
      primaryChain: 'sol',
      confidence: 'high',
      addressType: 'token',
    };
  }

  // For EVM addresses, check DexScreener first
  const dexChains = await dexscreener.detectTokenChains(address);

  if (dexChains.length > 0) {
    cache.set(cacheKey, { chains: dexChains, expiry: Date.now() + CACHE_TTL });
    return {
      chains: dexChains,
      primaryChain: dexChains[0],
      confidence: 'high',
      addressType: 'token',
    };
  }

  // Fallback: parallel RPC calls to check if contract exists
  const evmChains: Chain[] = ['eth', 'bsc', 'base'];
  const detectedChains = await detectViaRpc(address, evmChains);

  if (detectedChains.length > 0) {
    cache.set(cacheKey, { chains: detectedChains, expiry: Date.now() + CACHE_TTL });
    return {
      chains: detectedChains,
      primaryChain: detectedChains[0],
      confidence: 'medium',
      addressType: detectedChains.length > 0 ? 'token' : 'wallet',
    };
  }

  // No contract found - might be a wallet address
  return {
    chains: evmChains, // Wallet addresses work on all EVM chains
    primaryChain: 'eth', // Default to ETH
    confidence: 'low',
    addressType: 'wallet',
  };
}

/**
 * Detect chains via RPC calls (checks if contract code exists)
 */
async function detectViaRpc(address: string, chains: Chain[]): Promise<Chain[]> {
  const results = await Promise.all(
    chains.map(async (chain) => {
      const hasContract = await checkContractExists(address, chain);
      return hasContract ? chain : null;
    })
  );

  return results.filter((c): c is Chain => c !== null);
}

/**
 * Check if a contract exists on a specific chain
 */
async function checkContractExists(address: string, chain: Chain): Promise<boolean> {
  if (chain === 'sol') {
    return checkSolanaAccount(address);
  }
  return checkEvmContract(address, chain);
}

/**
 * Check if EVM address has contract code
 */
async function checkEvmContract(address: string, chain: Chain): Promise<boolean> {
  try {
    const response = await fetch(RPC_ENDPOINTS[chain], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [address, 'latest'],
      }),
      signal: AbortSignal.timeout(3000),
    });

    const json = await response.json() as { result?: string };
    // Contract has code if result is not empty (0x or 0x0)
    return !!json.result && json.result !== '0x' && json.result !== '0x0';
  } catch {
    return false;
  }
}

/**
 * Check if Solana account exists and is a token mint
 */
async function checkSolanaAccount(address: string): Promise<boolean> {
  try {
    const response = await fetch(RPC_ENDPOINTS.sol, {
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
 */
export function getAddressFormat(address: string): 'solana' | 'evm' | 'unknown' {
  if (SOLANA_ADDRESS_REGEX.test(address)) return 'solana';
  if (EVM_ADDRESS_REGEX.test(address)) return 'evm';
  return 'unknown';
}

/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
  return SOLANA_ADDRESS_REGEX.test(address) || EVM_ADDRESS_REGEX.test(address);
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
