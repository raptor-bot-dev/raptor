/**
 * Speed Cache Layer for RAPTOR v2.2
 *
 * Provides O(1) lookups for critical trading decisions:
 * - Priority fees (updated every 3s)
 * - Blacklisted tokens and deployers (O(1) Set lookups)
 * - Token info cache (LRU with 5min TTL)
 * - Native token prices (updated every 30s)
 */

import type { Chain } from '../types.js';

// Priority fee data per chain
export interface PriorityFees {
  slow: bigint;
  normal: bigint;
  fast: bigint;
  turbo: bigint;
  lastUpdated: number;
}

// Cached token info
export interface CachedTokenInfo {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  decimals: number;
  deployer: string;
  liquidity: bigint;
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  score: number;
  cachedAt: number;
}

// Native token prices in USD
export interface NativePrices {
  sol: number;
  bnb: number;
  eth: number;
  lastUpdated: number;
}

// LRU Cache implementation
class LRUCache<K, V> {
  private cache: Map<K, { value: V; expiry: number }>;
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Remove oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs,
    });
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Singleton speed cache instance
class SpeedCache {
  // Priority fees per chain - updated every 3s
  public priorityFees: Record<Chain, PriorityFees> = {
    sol: { slow: 0n, normal: 0n, fast: 0n, turbo: 0n, lastUpdated: 0 },
    bsc: { slow: 0n, normal: 0n, fast: 0n, turbo: 0n, lastUpdated: 0 },
    base: { slow: 0n, normal: 0n, fast: 0n, turbo: 0n, lastUpdated: 0 },
    eth: { slow: 0n, normal: 0n, fast: 0n, turbo: 0n, lastUpdated: 0 },
  };

  // O(1) blacklist lookups
  public blacklistedTokens: Set<string> = new Set();
  public blacklistedDeployers: Set<string> = new Set();

  // Token info cache: 1000 entries, 5 min TTL
  public tokenCache: LRUCache<string, CachedTokenInfo> = new LRUCache(1000, 5 * 60 * 1000);

  // Native token prices in USD
  public prices: NativePrices = {
    sol: 0,
    bnb: 0,
    eth: 0,
    lastUpdated: 0,
  };

  // Update intervals
  private feeUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private priceUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private blacklistUpdateInterval: ReturnType<typeof setInterval> | null = null;

  // Callbacks for fetching data (to be set by the application)
  private fetchPriorityFees: ((chain: Chain) => Promise<PriorityFees>) | null = null;
  private fetchPrices: (() => Promise<NativePrices>) | null = null;
  private fetchBlacklists: (() => Promise<{ tokens: string[]; deployers: string[] }>) | null = null;

  /**
   * Initialize the speed cache with data fetchers
   */
  async initialize(config: {
    fetchPriorityFees: (chain: Chain) => Promise<PriorityFees>;
    fetchPrices: () => Promise<NativePrices>;
    fetchBlacklists: () => Promise<{ tokens: string[]; deployers: string[] }>;
  }): Promise<void> {
    this.fetchPriorityFees = config.fetchPriorityFees;
    this.fetchPrices = config.fetchPrices;
    this.fetchBlacklists = config.fetchBlacklists;

    // Initial fetch
    await Promise.all([
      this.updatePriorityFees(),
      this.updatePrices(),
      this.updateBlacklists(),
    ]);

    // Start background updates
    this.startBackgroundUpdates();
  }

  /**
   * Start background update loops
   */
  private startBackgroundUpdates(): void {
    // Update priority fees every 3 seconds
    this.feeUpdateInterval = setInterval(() => {
      this.updatePriorityFees().catch(console.error);
    }, 3000);

    // Update prices every 30 seconds
    this.priceUpdateInterval = setInterval(() => {
      this.updatePrices().catch(console.error);
    }, 30000);

    // Update blacklists every 60 seconds
    this.blacklistUpdateInterval = setInterval(() => {
      this.updateBlacklists().catch(console.error);
    }, 60000);
  }

  /**
   * Stop background updates
   */
  stop(): void {
    if (this.feeUpdateInterval) {
      clearInterval(this.feeUpdateInterval);
      this.feeUpdateInterval = null;
    }
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    if (this.blacklistUpdateInterval) {
      clearInterval(this.blacklistUpdateInterval);
      this.blacklistUpdateInterval = null;
    }
  }

  /**
   * Update priority fees for all chains
   */
  private async updatePriorityFees(): Promise<void> {
    if (!this.fetchPriorityFees) return;

    const chains: Chain[] = ['sol', 'bsc', 'base', 'eth'];
    await Promise.all(
      chains.map(async (chain) => {
        try {
          const fees = await this.fetchPriorityFees!(chain);
          this.priorityFees[chain] = fees;
        } catch (error) {
          console.error(`[SpeedCache] Failed to update fees for ${chain}:`, error);
        }
      })
    );
  }

  /**
   * Update native token prices
   */
  private async updatePrices(): Promise<void> {
    if (!this.fetchPrices) return;

    try {
      this.prices = await this.fetchPrices();
    } catch (error) {
      console.error('[SpeedCache] Failed to update prices:', error);
    }
  }

  /**
   * Update blacklists from database
   */
  private async updateBlacklists(): Promise<void> {
    if (!this.fetchBlacklists) return;

    try {
      const { tokens, deployers } = await this.fetchBlacklists();
      this.blacklistedTokens = new Set(tokens.map(t => t.toLowerCase()));
      this.blacklistedDeployers = new Set(deployers.map(d => d.toLowerCase()));
    } catch (error) {
      console.error('[SpeedCache] Failed to update blacklists:', error);
    }
  }

  // === O(1) Lookup Methods ===

  /**
   * Check if a token is blacklisted (O(1))
   */
  isTokenBlacklisted(address: string): boolean {
    return this.blacklistedTokens.has(address.toLowerCase());
  }

  /**
   * Check if a deployer is blacklisted (O(1))
   */
  isDeployerBlacklisted(address: string): boolean {
    return this.blacklistedDeployers.has(address.toLowerCase());
  }

  /**
   * Get cached token info
   */
  getTokenInfo(address: string): CachedTokenInfo | undefined {
    return this.tokenCache.get(address.toLowerCase());
  }

  /**
   * Cache token info
   */
  cacheTokenInfo(info: CachedTokenInfo): void {
    this.tokenCache.set(info.address.toLowerCase(), {
      ...info,
      cachedAt: Date.now(),
    });
  }

  /**
   * Get priority fee for a chain and speed
   */
  getPriorityFee(chain: Chain, speed: 'slow' | 'normal' | 'fast' | 'turbo'): bigint {
    return this.priorityFees[chain][speed];
  }

  /**
   * Get native token price in USD
   */
  getNativePrice(chain: Chain): number {
    switch (chain) {
      case 'sol':
        return this.prices.sol;
      case 'bsc':
        return this.prices.bnb;
      case 'base':
      case 'eth':
        return this.prices.eth;
    }
  }

  /**
   * Add token to local blacklist (instant, persisted on next DB sync)
   */
  addToBlacklist(type: 'token' | 'deployer', address: string): void {
    const lowerAddress = address.toLowerCase();
    if (type === 'token') {
      this.blacklistedTokens.add(lowerAddress);
    } else {
      this.blacklistedDeployers.add(lowerAddress);
    }
  }

  /**
   * Check if cache data is stale
   */
  isStale(): { fees: boolean; prices: boolean } {
    const now = Date.now();
    const feeStaleThreshold = 10000; // 10s
    const priceStaleThreshold = 60000; // 60s

    const oldestFeeUpdate = Math.min(
      ...Object.values(this.priorityFees).map(f => f.lastUpdated)
    );

    return {
      fees: now - oldestFeeUpdate > feeStaleThreshold,
      prices: now - this.prices.lastUpdated > priceStaleThreshold,
    };
  }

  /**
   * Get congestion level based on fee ratios
   */
  getCongestionLevel(chain: Chain): 'low' | 'normal' | 'high' | 'extreme' {
    const fees = this.priorityFees[chain];
    if (fees.normal === 0n) return 'normal';

    const ratio = Number(fees.turbo) / Number(fees.normal);

    if (ratio < 1.5) return 'low';
    if (ratio < 3) return 'normal';
    if (ratio < 5) return 'high';
    return 'extreme';
  }
}

// Export singleton instance
export const speedCache = new SpeedCache();

// Export types
export type { SpeedCache };
