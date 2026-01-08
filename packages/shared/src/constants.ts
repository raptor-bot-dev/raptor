import type { ChainConfig } from './types.js';

export const BSC_CONFIG: ChainConfig = {
  chainId: 56,
  name: 'BSC',
  rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
  wssUrl: process.env.BSC_WSS_URL || 'wss://bsc-ws-node.nariox.org',
  nativeToken: 'BNB',
  wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  explorerUrl: 'https://bscscan.com',
  maxGasPrice: BigInt(5e9), // 5 gwei
  minPositionSize: BigInt(5e16), // 0.05 BNB
  maxPositionSize: BigInt(10e18), // 10 BNB
  maxPoolPercent: 30,
  launchpads: [
    {
      name: 'four.meme',
      factory: '0x0000000000000000000000000000000000000000', // TODO: Add actual address
      type: 'BONDING_CURVE',
      eventSignature: 'TokenCreated(address,address,string,string)',
    },
  ],
  dexes: [
    {
      name: 'PancakeSwap',
      router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
      type: 'V2',
    },
  ],
};

export const BASE_CONFIG: ChainConfig = {
  chainId: 8453,
  name: 'Base',
  rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  wssUrl: process.env.BASE_WSS_URL || '',
  nativeToken: 'ETH',
  wrappedNative: '0x4200000000000000000000000000000000000006',
  explorerUrl: 'https://basescan.org',
  maxGasPrice: BigInt(1e8), // 0.1 gwei
  minPositionSize: BigInt(1e16), // 0.01 ETH
  maxPositionSize: BigInt(5e18), // 5 ETH
  maxPoolPercent: 30,
  launchpads: [
    {
      name: 'BasePump',
      factory: '0x0000000000000000000000000000000000000000', // TODO: Add actual address
      type: 'BONDING_CURVE',
      eventSignature: 'TokenCreated(address,address,string,string)',
    },
  ],
  dexes: [
    {
      name: 'Uniswap V3',
      router: '0x2626664c2603336E57B271c5C0b26F421741e481',
      factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
      type: 'V3',
    },
    {
      name: 'Aerodrome',
      router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
      factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
      type: 'V2',
    },
  ],
};

export const SUPPORTED_CHAINS = [BSC_CONFIG, BASE_CONFIG] as const;

// Scoring thresholds
export const MIN_OPPORTUNITY_SCORE = 50;
export const MIN_LIQUIDITY_BNB = BigInt(3e18); // 3 BNB
export const MIN_LIQUIDITY_ETH = BigInt(1e18); // 1 ETH
export const MAX_BUY_TAX = 500; // 5% in bps
export const MAX_SELL_TAX = 500; // 5% in bps

// Position defaults
export const DEFAULT_TAKE_PROFIT = 50; // 50%
export const DEFAULT_STOP_LOSS = 30; // 30%
export const MAX_HOLD_TIME = 4 * 60 * 60 * 1000; // 4 hours in ms
