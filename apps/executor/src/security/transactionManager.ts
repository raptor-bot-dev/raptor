/**
 * Transaction Manager for RAPTOR v2.3.1
 *
 * SECURITY: M-003, M-007, M-008 - Transaction lifecycle management
 * - Transaction timeout handling
 * - Position size limits
 * - Trade cooldown enforcement
 */

import { ethers } from 'ethers';

/**
 * Transaction timeout configuration per chain (milliseconds)
 */
const TX_TIMEOUT_MS: Record<string, number> = {
  sol: 30000,   // 30 seconds for Solana
  bsc: 60000,   // 60 seconds for BSC
  base: 45000,  // 45 seconds for Base
  eth: 120000,  // 120 seconds for Ethereum (slow)
};

/**
 * Position size limits per chain (in native token)
 */
const POSITION_LIMITS: Record<string, { min: number; max: number; maxPercent: number }> = {
  sol: { min: 0.01, max: 50, maxPercent: 25 },     // 0.01 - 50 SOL, max 25% of balance
  bsc: { min: 0.01, max: 10, maxPercent: 25 },     // 0.01 - 10 BNB
  base: { min: 0.001, max: 2, maxPercent: 25 },    // 0.001 - 2 ETH
  eth: { min: 0.001, max: 2, maxPercent: 25 },     // 0.001 - 2 ETH
};

/**
 * Trade cooldown configuration
 */
const COOLDOWN_CONFIG = {
  samePairMs: 30000,      // 30 seconds between trades on same pair
  sameUserMs: 5000,       // 5 seconds between any trades for same user
  maxTradesPerMinute: 10, // Max 10 trades per minute per user
};

/**
 * Track pending transactions
 */
interface PendingTransaction {
  txHash: string;
  chain: string;
  tgId: number;
  startTime: number;
  operation: 'buy' | 'sell';
  token: string;
  timeoutId: NodeJS.Timeout;
}

const pendingTransactions = new Map<string, PendingTransaction>();

/**
 * Track trade cooldowns
 */
interface CooldownEntry {
  lastTrade: number;
  tradesInWindow: number;
  windowStart: number;
}

const userCooldowns = new Map<number, CooldownEntry>();
const pairCooldowns = new Map<string, number>(); // key: `${tgId}:${token}`

/**
 * Get transaction timeout for chain
 */
export function getTransactionTimeout(chain: string): number {
  return TX_TIMEOUT_MS[chain] || TX_TIMEOUT_MS.eth;
}

/**
 * Register a pending transaction with timeout handling
 */
export function registerPendingTransaction(
  txHash: string,
  chain: string,
  tgId: number,
  operation: 'buy' | 'sell',
  token: string,
  onTimeout: () => void
): void {
  const timeout = getTransactionTimeout(chain);

  const timeoutId = setTimeout(() => {
    const pending = pendingTransactions.get(txHash);
    if (pending) {
      console.warn(`[TxManager] Transaction timeout: ${txHash} on ${chain}`);
      pendingTransactions.delete(txHash);
      onTimeout();
    }
  }, timeout);

  pendingTransactions.set(txHash, {
    txHash,
    chain,
    tgId,
    startTime: Date.now(),
    operation,
    token,
    timeoutId,
  });

  console.log(`[TxManager] Registered pending tx: ${txHash} (timeout: ${timeout}ms)`);
}

/**
 * Mark transaction as completed (clears timeout)
 */
export function completeTransaction(txHash: string): void {
  const pending = pendingTransactions.get(txHash);
  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingTransactions.delete(txHash);
    console.log(`[TxManager] Transaction completed: ${txHash}`);
  }
}

/**
 * Check if transaction is still pending
 */
export function isTransactionPending(txHash: string): boolean {
  return pendingTransactions.has(txHash);
}

/**
 * Get all pending transactions for a user
 */
export function getUserPendingTransactions(tgId: number): PendingTransaction[] {
  const userTxs: PendingTransaction[] = [];
  for (const tx of pendingTransactions.values()) {
    if (tx.tgId === tgId) {
      userTxs.push(tx);
    }
  }
  return userTxs;
}

/**
 * Validate position size against limits
 */
export function validatePositionSize(
  chain: string,
  amount: bigint,
  userBalance: bigint
): { valid: boolean; error?: string; adjustedAmount?: bigint } {
  const limits = POSITION_LIMITS[chain] || POSITION_LIMITS.eth;

  // Convert to decimal for comparison
  const amountDecimal = Number(ethers.formatEther(amount));
  const balanceDecimal = Number(ethers.formatEther(userBalance));

  // Check minimum
  if (amountDecimal < limits.min) {
    return {
      valid: false,
      error: `Position size ${amountDecimal} below minimum ${limits.min}`,
    };
  }

  // Check maximum absolute
  if (amountDecimal > limits.max) {
    return {
      valid: false,
      error: `Position size ${amountDecimal} exceeds maximum ${limits.max}`,
      adjustedAmount: ethers.parseEther(limits.max.toString()),
    };
  }

  // Check maximum percentage of balance
  const maxByPercent = balanceDecimal * (limits.maxPercent / 100);
  if (amountDecimal > maxByPercent) {
    return {
      valid: false,
      error: `Position size ${amountDecimal} exceeds ${limits.maxPercent}% of balance`,
      adjustedAmount: ethers.parseEther(maxByPercent.toFixed(18)),
    };
  }

  return { valid: true };
}

/**
 * Check trade cooldown
 * Returns true if trade is allowed, false if in cooldown
 */
export function checkTradeCooldown(
  tgId: number,
  token: string
): { allowed: boolean; waitMs?: number; reason?: string } {
  const now = Date.now();

  // Check pair-specific cooldown
  const pairKey = `${tgId}:${token.toLowerCase()}`;
  const lastPairTrade = pairCooldowns.get(pairKey);
  if (lastPairTrade) {
    const elapsed = now - lastPairTrade;
    if (elapsed < COOLDOWN_CONFIG.samePairMs) {
      return {
        allowed: false,
        waitMs: COOLDOWN_CONFIG.samePairMs - elapsed,
        reason: 'Same pair cooldown',
      };
    }
  }

  // Check user-level cooldown and rate limit
  const userEntry = userCooldowns.get(tgId);
  if (userEntry) {
    // Check general cooldown
    const elapsed = now - userEntry.lastTrade;
    if (elapsed < COOLDOWN_CONFIG.sameUserMs) {
      return {
        allowed: false,
        waitMs: COOLDOWN_CONFIG.sameUserMs - elapsed,
        reason: 'User cooldown',
      };
    }

    // Check rate limit (trades per minute)
    const windowElapsed = now - userEntry.windowStart;
    if (windowElapsed < 60000) {
      if (userEntry.tradesInWindow >= COOLDOWN_CONFIG.maxTradesPerMinute) {
        return {
          allowed: false,
          waitMs: 60000 - windowElapsed,
          reason: `Rate limit: max ${COOLDOWN_CONFIG.maxTradesPerMinute} trades per minute`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Record a trade for cooldown tracking
 */
export function recordTrade(tgId: number, token: string): void {
  const now = Date.now();

  // Update pair cooldown
  const pairKey = `${tgId}:${token.toLowerCase()}`;
  pairCooldowns.set(pairKey, now);

  // Update user cooldown
  const userEntry = userCooldowns.get(tgId);
  if (userEntry) {
    // Check if we're still in the same minute window
    if (now - userEntry.windowStart < 60000) {
      userEntry.tradesInWindow++;
      userEntry.lastTrade = now;
    } else {
      // New window
      userEntry.windowStart = now;
      userEntry.tradesInWindow = 1;
      userEntry.lastTrade = now;
    }
  } else {
    userCooldowns.set(tgId, {
      lastTrade: now,
      tradesInWindow: 1,
      windowStart: now,
    });
  }
}

/**
 * Get cooldown status for monitoring
 */
export function getCooldownStatus(tgId: number): {
  lastTrade: number;
  tradesInWindow: number;
  canTrade: boolean;
  waitMs?: number;
} {
  const now = Date.now();
  const entry = userCooldowns.get(tgId);

  if (!entry) {
    return {
      lastTrade: 0,
      tradesInWindow: 0,
      canTrade: true,
    };
  }

  const check = checkTradeCooldown(tgId, 'any'); // Generic check

  return {
    lastTrade: entry.lastTrade,
    tradesInWindow: entry.tradesInWindow,
    canTrade: check.allowed,
    waitMs: check.waitMs,
  };
}

/**
 * Clean up old cooldown entries (call periodically)
 */
export function cleanupCooldowns(): void {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes

  // Clean pair cooldowns
  for (const [key, timestamp] of pairCooldowns) {
    if (now - timestamp > maxAge) {
      pairCooldowns.delete(key);
    }
  }

  // Clean user cooldowns
  for (const [userId, entry] of userCooldowns) {
    if (now - entry.lastTrade > maxAge) {
      userCooldowns.delete(userId);
    }
  }
}

// Cleanup every 2 minutes
setInterval(cleanupCooldowns, 2 * 60 * 1000);

/**
 * Execute with timeout wrapper
 */
export async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}
