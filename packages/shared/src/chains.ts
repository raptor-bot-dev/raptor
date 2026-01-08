import { BSC_CONFIG, BASE_CONFIG, ETH_CONFIG } from './constants.js';
import type { ChainConfig, EVMChain } from './types.js';

export function getChainConfig(chain: EVMChain): ChainConfig {
  switch (chain) {
    case 'bsc':
      return BSC_CONFIG;
    case 'base':
      return BASE_CONFIG;
    case 'eth':
      return ETH_CONFIG;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

export function getChainByChainId(chainId: number): ChainConfig | null {
  if (chainId === BSC_CONFIG.chainId) return BSC_CONFIG;
  if (chainId === BASE_CONFIG.chainId) return BASE_CONFIG;
  if (chainId === ETH_CONFIG.chainId) return ETH_CONFIG;
  return null;
}

export function formatExplorerUrl(
  chain: EVMChain,
  type: 'tx' | 'address' | 'token',
  hash: string
): string {
  const config = getChainConfig(chain);
  return `${config.explorerUrl}/${type}/${hash}`;
}

export function getNativeToken(chain: EVMChain): string {
  return getChainConfig(chain).nativeToken;
}

export function getWrappedNative(chain: EVMChain): string {
  return getChainConfig(chain).wrappedNative;
}

export function parseChain(input: string): EVMChain | null {
  const normalized = input.toLowerCase().trim();
  if (normalized === 'bsc' || normalized === 'bnb') return 'bsc';
  if (normalized === 'base') return 'base';
  if (normalized === 'eth' || normalized === 'ethereum') return 'eth';
  return null;
}
