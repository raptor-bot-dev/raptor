/**
 * Rate Limiter for RAPTOR API Calls
 *
 * Token bucket implementation for rate limiting API requests:
 * - Configurable requests per minute
 * - Automatic token replenishment
 * - Request queuing when limit reached
 */

export interface RateLimiterConfig {
  name: string;
  requestsPerMinute: number;
  burstSize?: number; // Max tokens to accumulate, defaults to requestsPerMinute
}

export class RateLimiter {
  private name: string;
  private tokensPerMs: number;
  private maxTokens: number;
  private tokens: number;
  private lastRefill: number;
  private queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(config: RateLimiterConfig) {
    this.name = config.name;
    this.tokensPerMs = config.requestsPerMinute / 60000;
    this.maxTokens = config.burstSize ?? config.requestsPerMinute;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.tokensPerMs;

    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  /**
   * Try to acquire a token, returns true if successful
   */
  private tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Process the queue - try to release waiting requests
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.tryAcquire()) {
      const request = this.queue.shift();
      if (request) {
        clearTimeout(request.timeout);
        request.resolve();
      }
    }
  }

  /**
   * Acquire a token, waiting if necessary
   * @param timeoutMs Maximum time to wait (default 30s)
   */
  async acquire(timeoutMs = 30000): Promise<void> {
    // Try immediate acquisition
    if (this.tryAcquire()) {
      return;
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove from queue
        const index = this.queue.findIndex((r) => r.resolve === resolve);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        reject(new Error(`[${this.name}] Rate limit timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.queue.push({ resolve, reject, timeout });

      // Schedule queue processing
      const waitTime = (1 - this.tokens) / this.tokensPerMs;
      setTimeout(() => this.processQueue(), Math.ceil(waitTime));
    });
  }

  /**
   * Execute a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>, timeoutMs = 30000): Promise<T> {
    await this.acquire(timeoutMs);
    return fn();
  }

  /**
   * Get current state for debugging
   */
  getState(): {
    name: string;
    availableTokens: number;
    maxTokens: number;
    queueLength: number;
  } {
    this.refill();
    return {
      name: this.name,
      availableTokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      queueLength: this.queue.length,
    };
  }

  /**
   * Reset the rate limiter to full capacity
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    // Clear queue
    for (const request of this.queue) {
      clearTimeout(request.timeout);
      request.reject(new Error('Rate limiter reset'));
    }
    this.queue = [];
  }
}

// Pre-configured rate limiters for common APIs
export const rateLimiters = {
  dexscreener: new RateLimiter({
    name: 'DexScreener',
    requestsPerMinute: 300, // DexScreener free tier
    burstSize: 30,
  }),

  birdeye: new RateLimiter({
    name: 'Birdeye',
    requestsPerMinute: 100, // Birdeye standard tier
    burstSize: 10,
  }),

  solanaRpc: new RateLimiter({
    name: 'SolanaRPC',
    requestsPerMinute: 600, // Most public RPCs
    burstSize: 50,
  }),

  evmRpc: new RateLimiter({
    name: 'EVMRPC',
    requestsPerMinute: 300,
    burstSize: 30,
  }),
};

/**
 * Create a rate-limited fetch wrapper
 */
export function createRateLimitedFetch(
  limiter: RateLimiter
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  return async (input: string | URL, init?: RequestInit) => {
    await limiter.acquire();
    return fetch(input, init);
  };
}
