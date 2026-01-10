/**
 * Trade Security Guards for RAPTOR v2.3.1
 *
 * SECURITY: High severity protections for trading operations
 * - H-001: Configurable slippage protection
 * - H-002: Transaction simulation before execution
 * - H-004: Re-entrancy guards for concurrent operations
 * - H-006: MEV protection enforcement
 */

import { ethers } from 'ethers';

/**
 * Slippage configuration per chain and operation type
 * Values are in percentage (e.g., 15 = 15%)
 */
export interface SlippageConfig {
  buy: number;
  sell: number;
  emergencyExit: number;
}

const DEFAULT_SLIPPAGE: Record<string, SlippageConfig> = {
  bsc: { buy: 15, sell: 10, emergencyExit: 50 },
  base: { buy: 10, sell: 8, emergencyExit: 50 },
  eth: { buy: 5, sell: 3, emergencyExit: 30 },
  sol: { buy: 10, sell: 8, emergencyExit: 50 },
};

// User-configured slippage overrides
const userSlippage = new Map<number, Partial<SlippageConfig>>();

/**
 * Get slippage for a specific operation
 */
export function getSlippage(
  chain: string,
  operation: 'buy' | 'sell' | 'emergencyExit',
  tgId?: number
): number {
  // Check user override first
  if (tgId) {
    const override = userSlippage.get(tgId);
    if (override?.[operation] !== undefined) {
      return override[operation]!;
    }
  }

  // Fall back to chain defaults
  const chainConfig = DEFAULT_SLIPPAGE[chain] || DEFAULT_SLIPPAGE.bsc;
  return chainConfig[operation];
}

/**
 * Set user-specific slippage
 */
export function setUserSlippage(
  tgId: number,
  config: Partial<SlippageConfig>
): void {
  const existing = userSlippage.get(tgId) || {};
  userSlippage.set(tgId, { ...existing, ...config });
}

/**
 * Calculate minimum output with slippage protection
 * SECURITY: Never returns 0 for sells (MEV protection)
 */
export function calculateMinOutput(
  expectedOutput: bigint,
  slippagePercent: number,
  operation: 'buy' | 'sell' | 'emergencyExit'
): bigint {
  // Clamp slippage to reasonable bounds
  const clampedSlippage = Math.min(Math.max(slippagePercent, 0.1), 50);

  const minOutput = (expectedOutput * BigInt(Math.floor((100 - clampedSlippage) * 100))) / 10000n;

  // SECURITY: For sells, never return 0 to prevent sandwich attacks
  // Minimum 1% of expected output even in worst case
  if (operation === 'sell' && minOutput === 0n && expectedOutput > 0n) {
    return expectedOutput / 100n; // 1% minimum
  }

  return minOutput;
}

/**
 * Re-entrancy guard for trading operations
 * Prevents concurrent transactions for the same user/token pair
 * SECURITY: P1-4 - Now uses database persistence for cross-instance coordination
 */
class ReentrancyGuard {
  // In-memory cache for fast checks (primary)
  private locks = new Map<string, { timestamp: number; operation: string }>();
  private readonly LOCK_TIMEOUT_MS = 60000; // 1 minute max lock

  // Database persistence flag
  private useDatabase = !!process.env.SUPABASE_URL;
  private instanceId = `executor-${process.pid}-${Date.now()}`;

  /**
   * Acquire lock for a trading operation
   * SECURITY: P1-4 - Uses both in-memory and database locks
   * @returns true if lock acquired, false if already locked
   */
  async acquireAsync(tgId: number, tokenAddress: string, operation: string): Promise<boolean> {
    const key = this.getKey(tgId, tokenAddress);
    const now = Date.now();

    // First check in-memory (fast path)
    const existing = this.locks.get(key);
    if (existing && now - existing.timestamp < this.LOCK_TIMEOUT_MS) {
      console.warn(
        `[ReentrancyGuard] Blocked concurrent ${operation} for user ${tgId} on ${tokenAddress.slice(0, 10)}... ` +
        `(existing: ${existing.operation})`
      );
      return false;
    }

    // Try to acquire database lock for cross-instance coordination
    if (this.useDatabase) {
      const dbLockAcquired = await this.acquireDbLock(key, operation, now);
      if (!dbLockAcquired) {
        return false;
      }
    }

    // Acquire in-memory lock
    this.locks.set(key, { timestamp: now, operation });
    return true;
  }

  /**
   * Synchronous acquire for backward compatibility
   * SECURITY: Uses in-memory only; use acquireAsync for full protection
   */
  acquire(tgId: number, tokenAddress: string, operation: string): boolean {
    const key = this.getKey(tgId, tokenAddress);
    const now = Date.now();

    // Check existing lock
    const existing = this.locks.get(key);
    if (existing) {
      if (now - existing.timestamp < this.LOCK_TIMEOUT_MS) {
        console.warn(
          `[ReentrancyGuard] Blocked concurrent ${operation} for user ${tgId} on ${tokenAddress.slice(0, 10)}... ` +
          `(existing: ${existing.operation})`
        );
        return false;
      }
      console.warn(`[ReentrancyGuard] Overriding expired lock for user ${tgId}`);
    }

    this.locks.set(key, { timestamp: now, operation });

    // Fire-and-forget database lock (for cross-instance visibility)
    if (this.useDatabase) {
      this.acquireDbLock(key, operation, now).catch(() => {});
    }

    return true;
  }

  /**
   * Release lock after operation completes
   */
  async releaseAsync(tgId: number, tokenAddress: string): Promise<void> {
    const key = this.getKey(tgId, tokenAddress);
    this.locks.delete(key);

    if (this.useDatabase) {
      await this.releaseDbLock(key);
    }
  }

  /**
   * Synchronous release for backward compatibility
   */
  release(tgId: number, tokenAddress: string): void {
    const key = this.getKey(tgId, tokenAddress);
    this.locks.delete(key);

    // Fire-and-forget database release
    if (this.useDatabase) {
      this.releaseDbLock(key).catch(() => {});
    }
  }

  /**
   * Check if an operation is locked
   */
  isLocked(tgId: number, tokenAddress: string): boolean {
    const key = this.getKey(tgId, tokenAddress);
    const existing = this.locks.get(key);
    if (!existing) return false;

    if (Date.now() - existing.timestamp >= this.LOCK_TIMEOUT_MS) {
      this.locks.delete(key);
      return false;
    }

    return true;
  }

  private getKey(tgId: number, tokenAddress: string): string {
    return `${tgId}:${tokenAddress.toLowerCase()}`;
  }

  /**
   * Acquire database lock for cross-instance coordination
   * SECURITY: P1-4 - Persistent locks survive restarts
   */
  private async acquireDbLock(key: string, operation: string, timestamp: number): Promise<boolean> {
    try {
      const { supabase } = await import('@raptor/shared');

      // Check for existing lock
      const { data: existing } = await supabase
        .from('trade_locks')
        .select('*')
        .eq('lock_key', key)
        .single();

      if (existing) {
        // Check if lock is expired
        const lockTime = new Date(existing.created_at).getTime();
        if (Date.now() - lockTime < this.LOCK_TIMEOUT_MS) {
          console.warn(`[ReentrancyGuard] Database lock exists for ${key} (instance: ${existing.instance_id})`);
          return false;
        }
        // Delete expired lock
        await supabase.from('trade_locks').delete().eq('lock_key', key);
      }

      // Insert new lock
      const { error } = await supabase.from('trade_locks').insert({
        lock_key: key,
        operation,
        instance_id: this.instanceId,
        created_at: new Date(timestamp).toISOString(),
      });

      if (error) {
        // Unique constraint violation = another instance got the lock
        if (error.code === '23505') {
          console.warn(`[ReentrancyGuard] Lost lock race for ${key}`);
          return false;
        }
        console.error('[ReentrancyGuard] Database lock error:', error);
        return true; // Allow operation on DB error (fallback to in-memory)
      }

      return true;
    } catch (error) {
      console.error('[ReentrancyGuard] Database connection error:', error);
      return true; // Allow operation if database unavailable
    }
  }

  /**
   * Release database lock
   */
  private async releaseDbLock(key: string): Promise<void> {
    try {
      const { supabase } = await import('@raptor/shared');

      await supabase.from('trade_locks').delete().eq('lock_key', key);
    } catch (error) {
      console.error('[ReentrancyGuard] Failed to release database lock:', error);
    }
  }

  /**
   * Clean up expired locks (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks) {
      if (now - lock.timestamp >= this.LOCK_TIMEOUT_MS) {
        this.locks.delete(key);
      }
    }
  }

  /**
   * Clean up expired database locks (call periodically)
   */
  async cleanupDbLocks(): Promise<void> {
    if (!this.useDatabase) return;

    try {
      const { supabase } = await import('@raptor/shared');

      const expiredTime = new Date(Date.now() - this.LOCK_TIMEOUT_MS).toISOString();
      const { data } = await supabase
        .from('trade_locks')
        .delete()
        .lt('created_at', expiredTime)
        .select();

      if (data && data.length > 0) {
        console.log(`[ReentrancyGuard] Cleaned up ${data.length} expired database locks`);
      }
    } catch (error) {
      console.error('[ReentrancyGuard] Database cleanup error:', error);
    }
  }
}

// Singleton instance
export const reentrancyGuard = new ReentrancyGuard();

// Cleanup expired in-memory locks every 5 minutes
setInterval(() => reentrancyGuard.cleanup(), 5 * 60 * 1000);

// Cleanup expired database locks every 10 minutes
setInterval(() => reentrancyGuard.cleanupDbLocks(), 10 * 60 * 1000);

/**
 * Transaction simulation result
 */
export interface SimulationResult {
  success: boolean;
  gasUsed?: bigint;
  expectedOutput?: bigint;
  error?: string;
  revertReason?: string;
}

/**
 * Simulate a transaction before execution
 * SECURITY: Prevents failed transactions and identifies potential issues
 */
export async function simulateTransaction(
  provider: ethers.JsonRpcProvider,
  tx: {
    to: string;
    data: string;
    value?: bigint;
    from: string;
  }
): Promise<SimulationResult> {
  try {
    // Use eth_call to simulate
    const result = await provider.call({
      to: tx.to,
      data: tx.data,
      value: tx.value || 0n,
      from: tx.from,
    });

    // Estimate gas to verify transaction will succeed
    const gasEstimate = await provider.estimateGas({
      to: tx.to,
      data: tx.data,
      value: tx.value || 0n,
      from: tx.from,
    });

    return {
      success: true,
      gasUsed: gasEstimate,
      expectedOutput: result ? BigInt(result) : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Try to extract revert reason
    let revertReason: string | undefined;
    if (errorMessage.includes('execution reverted')) {
      const match = errorMessage.match(/reason="([^"]+)"/);
      revertReason = match ? match[1] : 'Unknown revert reason';
    }

    return {
      success: false,
      error: errorMessage,
      revertReason,
    };
  }
}

/**
 * Validate swap parameters before execution
 * SECURITY: Comprehensive pre-trade validation
 */
export function validateSwapParams(params: {
  tokenAddress: string;
  amount: bigint;
  minOutput: bigint;
  slippage: number;
  operation: 'buy' | 'sell';
}): { valid: boolean; error?: string } {
  const { tokenAddress, amount, minOutput, slippage, operation } = params;

  // Validate token address
  if (!ethers.isAddress(tokenAddress)) {
    return { valid: false, error: 'Invalid token address' };
  }

  // Validate amount
  if (amount <= 0n) {
    return { valid: false, error: 'Amount must be positive' };
  }

  // Validate slippage bounds
  if (slippage < 0.1 || slippage > 50) {
    return { valid: false, error: `Slippage ${slippage}% out of bounds (0.1-50%)` };
  }

  // SECURITY: For sells, minOutput must not be 0 (MEV protection)
  if (operation === 'sell' && minOutput === 0n) {
    return { valid: false, error: 'Sell minOutput cannot be 0 (MEV protection)' };
  }

  return { valid: true };
}

/**
 * Check if token appears to be a honeypot based on simulation
 */
export async function checkHoneypot(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  routerAddress: string,
  wrappedNative: string
): Promise<{ isHoneypot: boolean; reason?: string }> {
  const ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  ];

  try {
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);

    // Try to get quote for buy
    const buyPath = [wrappedNative, tokenAddress];
    const testAmount = ethers.parseEther('0.001');

    const buyAmounts = await router.getAmountsOut(testAmount, buyPath);
    if (!buyAmounts || buyAmounts[1] === 0n) {
      return { isHoneypot: true, reason: 'Cannot get buy quote' };
    }

    // Try to get quote for sell (reverse path)
    const sellPath = [tokenAddress, wrappedNative];
    const tokensToSell = buyAmounts[1];

    try {
      const sellAmounts = await router.getAmountsOut(tokensToSell, sellPath);
      if (!sellAmounts || sellAmounts[1] === 0n) {
        return { isHoneypot: true, reason: 'Cannot sell - possible honeypot' };
      }

      // Check for extreme tax (>90% loss on round trip)
      const returnAmount = sellAmounts[1];
      const lossPercent = Number((testAmount - returnAmount) * 100n / testAmount);

      if (lossPercent > 90) {
        return { isHoneypot: true, reason: `Extreme tax detected: ${lossPercent}% loss on round trip` };
      }
    } catch {
      return { isHoneypot: true, reason: 'Sell simulation failed - possible honeypot' };
    }

    return { isHoneypot: false };
  } catch (error) {
    return {
      isHoneypot: true,
      reason: `Quote check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
