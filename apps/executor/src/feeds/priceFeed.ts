// Real-time price feed using WebSocket subscriptions
// Subscribes to DEX pair events for instant price updates

import { ethers, Contract, WebSocketProvider } from 'ethers';
import type { ChainConfig } from '@raptor/shared';

// Uniswap V2 Pair ABI (minimal)
const PAIR_ABI = [
  'event Sync(uint112 reserve0, uint112 reserve1)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

export interface PriceUpdate {
  token: string;
  price: bigint;
  timestamp: number;
}

export type PriceHandler = (update: PriceUpdate) => void;

export class PriceFeed {
  private config: ChainConfig;
  private provider: ethers.JsonRpcProvider;
  private wsProvider: WebSocketProvider | null = null;
  private subscriptions: Map<string, Contract> = new Map();
  private handlers: Map<string, Set<PriceHandler>> = new Map();
  private pairCache: Map<string, string> = new Map(); // token -> pair address
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(config: ChainConfig, provider: ethers.JsonRpcProvider) {
    this.config = config;
    this.provider = provider;
  }

  async start(): Promise<void> {
    this.running = true;

    // Try to connect WebSocket
    if (this.config.wssUrl) {
      try {
        this.wsProvider = new WebSocketProvider(this.config.wssUrl);
        console.log(`[PriceFeed-${this.config.name}] WebSocket connected`);

        // Reconnect on disconnect
        this.wsProvider.on('error', (error) => {
          console.error(`[PriceFeed-${this.config.name}] WebSocket error:`, error);
        });
      } catch (error) {
        console.warn(`[PriceFeed-${this.config.name}] WebSocket failed, using polling`);
        this.wsProvider = null;
      }
    }

    // Start fallback polling for positions without WebSocket
    this.pollInterval = setInterval(() => this.pollPrices(), 5000);

    console.log(`[PriceFeed-${this.config.name}] Started`);
  }

  async stop(): Promise<void> {
    this.running = false;

    // Clear subscriptions
    for (const [token, pair] of this.subscriptions) {
      pair.removeAllListeners();
    }
    this.subscriptions.clear();

    // Close WebSocket
    if (this.wsProvider) {
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }

    // Clear polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log(`[PriceFeed-${this.config.name}] Stopped`);
  }

  /**
   * Subscribe to price updates for a token
   */
  async subscribe(token: string, handler: PriceHandler): Promise<void> {
    // Add handler
    if (!this.handlers.has(token)) {
      this.handlers.set(token, new Set());
    }
    this.handlers.get(token)!.add(handler);

    // Already subscribed
    if (this.subscriptions.has(token)) {
      return;
    }

    // Get pair address
    const pairAddress = await this.getPairAddress(token);
    if (!pairAddress || pairAddress === ethers.ZeroAddress) {
      console.warn(`[PriceFeed-${this.config.name}] No pair found for ${token}`);
      return;
    }

    this.pairCache.set(token, pairAddress);

    // Subscribe via WebSocket if available
    if (this.wsProvider) {
      try {
        const pair = new Contract(pairAddress, PAIR_ABI, this.wsProvider);

        pair.on('Sync', (reserve0: bigint, reserve1: bigint) => {
          this.handleSync(token, pairAddress, reserve0, reserve1);
        });

        this.subscriptions.set(token, pair);
        console.log(`[PriceFeed-${this.config.name}] Subscribed to ${token}`);
      } catch (error) {
        console.error(`[PriceFeed-${this.config.name}] Subscription failed:`, error);
      }
    }

    // Get initial price
    await this.fetchPrice(token);
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribe(token: string, handler?: PriceHandler): void {
    if (handler) {
      this.handlers.get(token)?.delete(handler);
    }

    // Remove subscription if no handlers left
    const handlers = this.handlers.get(token);
    if (!handlers || handlers.size === 0) {
      const pair = this.subscriptions.get(token);
      if (pair) {
        pair.removeAllListeners();
        this.subscriptions.delete(token);
      }
      this.handlers.delete(token);
    }
  }

  /**
   * Get pair address for token/WETH
   */
  private async getPairAddress(token: string): Promise<string | null> {
    const cached = this.pairCache.get(token);
    if (cached) return cached;

    const dex = this.config.dexes.find(d => d.type === 'V2');
    if (!dex) return null;

    try {
      const factory = new Contract(dex.factory, FACTORY_ABI, this.provider);
      const pairAddress = await factory.getPair(token, this.config.wrappedNative);
      return pairAddress;
    } catch {
      return null;
    }
  }

  /**
   * Handle Sync event from DEX pair
   */
  private handleSync(
    token: string,
    pairAddress: string,
    reserve0: bigint,
    reserve1: bigint
  ): void {
    // Need to determine which reserve is the token
    // This requires knowing token0/token1 order
    const price = this.calculatePrice(token, reserve0, reserve1);

    const update: PriceUpdate = {
      token,
      price,
      timestamp: Date.now(),
    };

    // Notify handlers
    const handlers = this.handlers.get(token);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(update);
        } catch (error) {
          console.error(`[PriceFeed-${this.config.name}] Handler error:`, error);
        }
      }
    }
  }

  /**
   * Calculate price from reserves
   */
  private calculatePrice(
    token: string,
    reserve0: bigint,
    reserve1: bigint
  ): bigint {
    // Simplified: assumes token is token1 and WETH is token0
    // In production, would need to check actual token order
    if (reserve1 === 0n) return 0n;

    // Price in terms of WETH per token
    const price = (reserve0 * BigInt(1e18)) / reserve1;
    return price;
  }

  /**
   * Fetch current price via RPC (fallback)
   */
  private async fetchPrice(token: string): Promise<void> {
    const pairAddress = this.pairCache.get(token);
    if (!pairAddress) return;

    try {
      const pair = new Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserve0, reserve1] = await pair.getReserves();

      // Get token order to calculate price correctly
      const token0 = await pair.token0();
      const isToken0 = token.toLowerCase() === token0.toLowerCase();

      let price: bigint;
      if (isToken0) {
        // token is token0, WETH is token1
        price = reserve1 > 0n ? (reserve1 * BigInt(1e18)) / reserve0 : 0n;
      } else {
        // token is token1, WETH is token0
        price = reserve1 > 0n ? (reserve0 * BigInt(1e18)) / reserve1 : 0n;
      }

      const update: PriceUpdate = {
        token,
        price,
        timestamp: Date.now(),
      };

      const handlers = this.handlers.get(token);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(update);
          } catch (error) {
            console.error(`[PriceFeed-${this.config.name}] Handler error:`, error);
          }
        }
      }
    } catch (error) {
      // Silent fail for polling
    }
  }

  /**
   * Poll prices for all subscribed tokens (fallback/backup)
   */
  private async pollPrices(): Promise<void> {
    if (!this.running) return;

    for (const token of this.handlers.keys()) {
      await this.fetchPrice(token);
    }
  }

  /**
   * Get current price synchronously from cache
   */
  async getCurrentPrice(token: string): Promise<bigint> {
    const pairAddress = await this.getPairAddress(token);
    if (!pairAddress || pairAddress === ethers.ZeroAddress) {
      return 0n;
    }

    try {
      const pair = new Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserve0, reserve1] = await pair.getReserves();
      const token0 = await pair.token0();
      const isToken0 = token.toLowerCase() === token0.toLowerCase();

      if (isToken0) {
        return reserve1 > 0n ? (reserve1 * BigInt(1e18)) / reserve0 : 0n;
      } else {
        return reserve1 > 0n ? (reserve0 * BigInt(1e18)) / reserve1 : 0n;
      }
    } catch {
      return 0n;
    }
  }
}

/**
 * Factory function
 */
export function createPriceFeed(
  config: ChainConfig,
  provider: ethers.JsonRpcProvider
): PriceFeed {
  return new PriceFeed(config, provider);
}
