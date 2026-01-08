import { ethers, Contract } from 'ethers';
import type { ChainConfig } from '@raptor/shared';

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
];

export interface LiquidityInfo {
  pairAddress: string;
  tokenReserve: bigint;
  nativeReserve: bigint;
  totalSupply: bigint;
  priceInNative: number;
}

export class LiquidityChecker {
  private provider: ethers.JsonRpcProvider;
  private config: ChainConfig;

  constructor(provider: ethers.JsonRpcProvider, config: ChainConfig) {
    this.provider = provider;
    this.config = config;
  }

  async check(tokenAddress: string): Promise<LiquidityInfo | null> {
    try {
      // Find the pair on primary DEX
      const factory = new Contract(
        this.config.dexes[0].factory,
        FACTORY_ABI,
        this.provider
      );

      const pairAddress = await factory.getPair(
        tokenAddress,
        this.config.wrappedNative
      );

      if (pairAddress === ethers.ZeroAddress) {
        return null;
      }

      const pair = new Contract(pairAddress, PAIR_ABI, this.provider);

      const [reserves, token0, totalSupply] = await Promise.all([
        pair.getReserves(),
        pair.token0(),
        pair.totalSupply(),
      ]);

      // Determine which reserve is which
      const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
      const tokenReserve = isToken0 ? reserves[0] : reserves[1];
      const nativeReserve = isToken0 ? reserves[1] : reserves[0];

      // Calculate price
      const priceInNative =
        Number(nativeReserve) / Number(tokenReserve) || 0;

      return {
        pairAddress,
        tokenReserve,
        nativeReserve,
        totalSupply,
        priceInNative,
      };
    } catch (error) {
      console.error('Liquidity check failed:', error);
      return null;
    }
  }

  async getLiquidityValue(tokenAddress: string): Promise<bigint> {
    const info = await this.check(tokenAddress);
    if (!info) return 0n;

    // Return native reserve (liquidity in BNB/ETH)
    return info.nativeReserve;
  }

  async isLiquidityLocked(pairAddress: string): Promise<boolean> {
    // TODO: Check common liquidity lockers
    // - Team.finance
    // - Unicrypt
    // - PinkSale
    // For now, return false (not locked)
    return false;
  }
}
