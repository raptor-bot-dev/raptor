import type { ChainConfig, SolanaConfig } from './types.js';

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
      // four.meme TokenManager contract on BSC
      factory: process.env.FOUR_MEME_FACTORY || '0x5c952063c7fc8610FFDB798152D69F0B9550762b',
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
      name: 'VirtualsProtocol',
      // Virtuals Protocol agent factory on Base (pump.fun-like bonding curves)
      factory: process.env.BASE_LAUNCHPAD_FACTORY || '0x44e3F80Eb8c9E4D2B5D6b8A88e7AD1E8B4F19b2c',
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

export const ETH_CONFIG: ChainConfig = {
  chainId: 1,
  name: 'Ethereum',
  rpcUrl: process.env.ETH_RPC_URL || 'https://eth.drpc.org',
  wssUrl: process.env.ETH_WSS_URL || 'wss://eth.drpc.org',
  nativeToken: 'ETH',
  wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  explorerUrl: 'https://etherscan.io',
  maxGasPrice: BigInt(50e9), // 50 gwei (ETH mainnet is more expensive)
  minPositionSize: BigInt(5e16), // 0.05 ETH (higher minimum due to gas)
  maxPositionSize: BigInt(10e18), // 10 ETH
  maxPoolPercent: 30,
  launchpads: [
    {
      name: 'Uniswap',
      factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2 Factory
      type: 'DIRECT_LP',
      eventSignature: 'PairCreated(address,address,address,uint256)',
    },
  ],
  dexes: [
    {
      name: 'Uniswap V2',
      router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      type: 'V2',
    },
    {
      name: 'Uniswap V3',
      router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      type: 'V3',
    },
    {
      name: 'SushiSwap',
      router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
      type: 'V2',
    },
  ],
};

export const SOLANA_CONFIG: SolanaConfig = {
  cluster: 'mainnet-beta',
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  wssUrl: process.env.SOLANA_WSS_URL || 'wss://api.mainnet-beta.solana.com',
  nativeToken: 'SOL',
  minPositionSize: 0.1, // 0.1 SOL
  maxPositionSize: 100, // 100 SOL
  maxPoolPercent: 30,
  launchpads: [
    {
      name: 'pump.fun',
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      type: 'BONDING_CURVE',
    },
    {
      name: 'moonshot',
      programId: 'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG',
      type: 'BONDING_CURVE',
    },
    {
      name: 'bonk.fun',
      programId: 'BonKyiRTJNYFweQirNMBGGqPnUqUwUwDsvgZBtpUgMwa',
      type: 'BONDING_CURVE',
    },
    {
      name: 'believe.app',
      programId: 'BLVEvYpJBkEKLVzD2Q1HFKJ7jdxTqzDruBVAK6ZsLQNi',
      type: 'BONDING_CURVE',
    },
  ],
  dexes: [
    {
      name: 'Raydium AMM',
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      type: 'AMM',
    },
    {
      name: 'Raydium CLMM',
      programId: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
      type: 'CLMM',
    },
    {
      name: 'Jupiter',
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      type: 'AGGREGATOR',
    },
    {
      name: 'Orca',
      programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
      type: 'CLMM',
    },
  ],
};

// EVM chains array
export const EVM_CHAINS = [BSC_CONFIG, BASE_CONFIG, ETH_CONFIG] as const;

// All supported chains (including Solana config separately since different type)
export const SUPPORTED_CHAINS = [BSC_CONFIG, BASE_CONFIG, ETH_CONFIG] as const;

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
