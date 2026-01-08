import { BSC_CONFIG, BASE_CONFIG } from './constants.js';
import type { ChainConfig } from './types.js';

export function getChainConfig(chain: 'bsc' | 'base'): ChainConfig {
  switch (chain) {
    case 'bsc':
      return BSC_CONFIG;
    case 'base':
      return BASE_CONFIG;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

export function getChainByChainId(chainId: number): ChainConfig | null {
  if (chainId === BSC_CONFIG.chainId) return BSC_CONFIG;
  if (chainId === BASE_CONFIG.chainId) return BASE_CONFIG;
  return null;
}

export function formatExplorerUrl(
  chain: 'bsc' | 'base',
  type: 'tx' | 'address' | 'token',
  hash: string
): string {
  const config = getChainConfig(chain);
  return `${config.explorerUrl}/${type}/${hash}`;
}

export function getNativeToken(chain: 'bsc' | 'base'): string {
  return getChainConfig(chain).nativeToken;
}

export function getWrappedNative(chain: 'bsc' | 'base'): string {
  return getChainConfig(chain).wrappedNative;
}

export function parseChain(input: string): 'bsc' | 'base' | null {
  const normalized = input.toLowerCase().trim();
  if (normalized === 'bsc' || normalized === 'bnb') return 'bsc';
  if (normalized === 'base' || normalized === 'eth') return 'base';
  return null;
}
