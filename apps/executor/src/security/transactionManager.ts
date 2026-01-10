/**
 * Transaction Manager for RAPTOR v2.3.1
 *
 * SECURITY: M-003, M-007, M-008, P0-3 - Transaction lifecycle management
 * - Transaction timeout handling
 * - Position size limits
 * - Trade cooldown enforcement
 * - Transaction idempotency (P0-3)
 */

import { ethers } from 'ethers';
import crypto from 'crypto';

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

// =============================================================================
// SECURITY: P0-3 - Transaction Idempotency System
// Prevents duplicate transactions by tracking unique request keys
// =============================================================================

/**
 * Idempotency entry tracking completed/pending transactions
 */
interface IdempotencyEntry {
  key: string;
  status: 'pending' | 'completed' | 'failed';
  txHash?: string;
  result?: unknown;
  error?: string;
  timestamp: number;
  expiresAt: number;
}

// Store idempotency keys with their results
const idempotencyStore = new Map<string, IdempotencyEntry>();

// Default TTL for idempotency keys (10 minutes)
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

/**
 * Generate a unique idempotency key from transaction parameters
 * SECURITY: P0-3 - Creates deterministic key from trade parameters
 */
export function generateIdempotencyKey(params: {
  tgId: number;
  chain: string;
  operation: 'buy' | 'sell';
  token: string;
  amount: string | bigint;
  nonce?: number;
}): string {
  const data = `${params.tgId}:${params.chain}:${params.operation}:${params.token.toLowerCase()}:${params.amount}:${params.nonce || 0}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Check if a transaction with this idempotency key is already pending or completed
 * Returns the cached result if available
 */
export function checkIdempotency(key: string): {
  exists: boolean;
  status?: 'pending' | 'completed' | 'failed';
  txHash?: string;
  result?: unknown;
  error?: string;
} {
  const entry = idempotencyStore.get(key);

  if (!entry) {
    return { exists: false };
  }

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    idempotencyStore.delete(key);
    return { exists: false };
  }

  return {
    exists: true,
    status: entry.status,
    txHash: entry.txHash,
    result: entry.result,
    error: entry.error,
  };
}

/**
 * Reserve an idempotency key (mark as pending)
 * Returns false if key is already in use
 */
export function reserveIdempotencyKey(key: string): boolean {
  const existing = checkIdempotency(key);

  if (existing.exists) {
    console.warn(`[Idempotency] Key already exists with status: ${existing.status}`);
    return false;
  }

  idempotencyStore.set(key, {
    key,
    status: 'pending',
    timestamp: Date.now(),
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });

  console.log(`[Idempotency] Reserved key: ${key.slice(0, 8)}...`);
  return true;
}

/**
 * Complete an idempotency key with success result
 */
export function completeIdempotencyKey(
  key: string,
  txHash: string,
  result?: unknown
): void {
  const entry = idempotencyStore.get(key);

  if (entry) {
    entry.status = 'completed';
    entry.txHash = txHash;
    entry.result = result;
    console.log(`[Idempotency] Completed key: ${key.slice(0, 8)}... -> ${txHash}`);
  }
}

/**
 * Fail an idempotency key with error
 */
export function failIdempotencyKey(key: string, error: string): void {
  const entry = idempotencyStore.get(key);

  if (entry) {
    entry.status = 'failed';
    entry.error = error;
    // Reduce TTL on failure so retry is possible sooner
    entry.expiresAt = Date.now() + 60000; // 1 minute
    console.log(`[Idempotency] Failed key: ${key.slice(0, 8)}... -> ${error}`);
  }
}

/**
 * Release an idempotency key (remove from store)
 * Use when transaction definitively failed and should be retried
 */
export function releaseIdempotencyKey(key: string): void {
  idempotencyStore.delete(key);
  console.log(`[Idempotency] Released key: ${key.slice(0, 8)}...`);
}

/**
 * Execute a transaction with idempotency protection
 * SECURITY: P0-3 - Prevents duplicate transactions
 */
export async function executeWithIdempotency<T>(
  params: {
    tgId: number;
    chain: string;
    operation: 'buy' | 'sell';
    token: string;
    amount: string | bigint;
  },
  executor: () => Promise<{ txHash: string; result: T }>
): Promise<{ success: boolean; txHash?: string; result?: T; error?: string; wasDuplicate?: boolean }> {
  const key = generateIdempotencyKey(params);

  // Check for existing transaction
  const existing = checkIdempotency(key);

  if (existing.exists) {
    if (existing.status === 'pending') {
      return {
        success: false,
        error: 'Transaction already in progress',
        wasDuplicate: true,
      };
    }

    if (existing.status === 'completed') {
      return {
        success: true,
        txHash: existing.txHash,
        result: existing.result as T,
        wasDuplicate: true,
      };
    }

    if (existing.status === 'failed') {
      // Allow retry after failure
      console.log(`[Idempotency] Retrying previously failed transaction`);
    }
  }

  // Reserve the key
  if (!reserveIdempotencyKey(key)) {
    return {
      success: false,
      error: 'Failed to acquire idempotency lock',
      wasDuplicate: true,
    };
  }

  try {
    // Execute the transaction
    const { txHash, result } = await executor();

    // Mark as completed
    completeIdempotencyKey(key, txHash, result);

    return {
      success: true,
      txHash,
      result,
      wasDuplicate: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Mark as failed
    failIdempotencyKey(key, errorMessage);

    return {
      success: false,
      error: errorMessage,
      wasDuplicate: false,
    };
  }
}

/**
 * Cleanup expired idempotency entries
 */
function cleanupIdempotencyStore(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of idempotencyStore) {
    if (now > entry.expiresAt) {
      idempotencyStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[Idempotency] Cleaned up ${cleaned} expired entries`);
  }
}

// Cleanup idempotency store every 5 minutes
setInterval(cleanupIdempotencyStore, 5 * 60 * 1000);

/**
 * Get idempotency store stats for monitoring
 */
export function getIdempotencyStats(): {
  total: number;
  pending: number;
  completed: number;
  failed: number;
} {
  let pending = 0;
  let completed = 0;
  let failed = 0;

  for (const entry of idempotencyStore.values()) {
    switch (entry.status) {
      case 'pending':
        pending++;
        break;
      case 'completed':
        completed++;
        break;
      case 'failed':
        failed++;
        break;
    }
  }

  return {
    total: idempotencyStore.size,
    pending,
    completed,
    failed,
  };
}
