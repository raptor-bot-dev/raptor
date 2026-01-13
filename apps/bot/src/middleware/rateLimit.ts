/**
 * Rate Limiting Middleware for RAPTOR Bot
 *
 * SECURITY: Prevents DoS attacks and abuse by limiting requests per user.
 * Uses a sliding window approach with separate limits for different operations.
 *
 * H-2 LIMITATION: Rate limit state is stored in-memory and will be lost on
 * bot restart/redeploy. This is acceptable for short windows (1-5 min) but
 * creates a brief abuse window on deployment. Mitigations:
 * - Short windows (1 min) naturally limit abuse impact
 * - Security events are logged for post-incident analysis
 * - Withdrawal rate limits in withdrawalValidation.ts provide additional protection
 * - Consider Supabase persistence for production-critical deployments
 *
 * STARTUP TRACKING: We log the startup time to correlate any abuse patterns
 * with deployment events in post-incident analysis.
 */

import type { Context, NextFunction } from 'grammy';

// H-2: Track startup time for security analysis
const STARTUP_TIME = Date.now();
console.log(`[RateLimit] Module initialized at ${new Date(STARTUP_TIME).toISOString()}`);

interface RateLimitState {
  count: number;
  windowStart: number;
  warned: boolean;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message: string;
}

// Per-user rate limit state
// H-2 NOTE: In-memory storage - resets on restart
const userRateLimits = new Map<number, RateLimitState>();

// Stricter limits for expensive operations (API calls)
// H-2 NOTE: In-memory storage - resets on restart
const expensiveOpLimits = new Map<number, RateLimitState>();

// Default configuration
const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60000, // 1 minute window
  maxRequests: 30, // 30 requests per minute
  message: 'Too many requests. Please wait a minute.',
};

// Stricter config for expensive operations (score, snipe, etc.)
const EXPENSIVE_CONFIG: RateLimitConfig = {
  windowMs: 60000,
  maxRequests: 10, // 10 expensive operations per minute
  message: 'Too many analysis requests. Please wait a minute.',
};

// Commands that trigger expensive API calls
const EXPENSIVE_COMMANDS = [
  '/score',
  '/snipe',
  'hunt_new',
  'hunt_trending',
  'analyze_',
];

/**
 * Check if a command/callback is expensive (triggers external API calls)
 */
function isExpensiveOperation(text: string): boolean {
  return EXPENSIVE_COMMANDS.some(cmd =>
    text.startsWith(cmd) || text.includes(cmd)
  );
}

/**
 * Main rate limiting middleware
 * Apply this to the bot before command handlers
 */
export function rateLimitMiddleware() {
  return async (ctx: Context, next: NextFunction) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();

    // Check general rate limit
    if (!checkRateLimit(userId, userRateLimits, DEFAULT_CONFIG, now)) {
      // Only send one warning per window
      const state = userRateLimits.get(userId);
      if (state && !state.warned) {
        state.warned = true;
        await ctx.reply(DEFAULT_CONFIG.message);
      }
      console.warn(`[RateLimit] User ${userId} exceeded general rate limit`);
      return; // Don't process request
    }

    // Check expensive operation rate limit
    const text = ctx.message?.text || ctx.callbackQuery?.data || '';
    if (isExpensiveOperation(text)) {
      if (!checkRateLimit(userId, expensiveOpLimits, EXPENSIVE_CONFIG, now)) {
        const state = expensiveOpLimits.get(userId);
        if (state && !state.warned) {
          state.warned = true;
          await ctx.reply(EXPENSIVE_CONFIG.message);
        }
        console.warn(`[RateLimit] User ${userId} exceeded expensive operation rate limit`);
        return; // Don't process request
      }
    }

    return next();
  };
}

/**
 * Check rate limit for a user
 * Returns true if request should proceed, false if rate limited
 */
function checkRateLimit(
  userId: number,
  limits: Map<number, RateLimitState>,
  config: RateLimitConfig,
  now: number
): boolean {
  let state = limits.get(userId);

  // Reset window if expired
  if (!state || now - state.windowStart > config.windowMs) {
    state = { count: 0, windowStart: now, warned: false };
  }

  state.count++;
  limits.set(userId, state);

  return state.count <= config.maxRequests;
}

/**
 * Get current rate limit status for a user (for debugging/monitoring)
 */
export function getRateLimitStatus(userId: number): {
  general: { count: number; remaining: number; resetIn: number };
  expensive: { count: number; remaining: number; resetIn: number };
} {
  const now = Date.now();
  const generalState = userRateLimits.get(userId);
  const expensiveState = expensiveOpLimits.get(userId);

  return {
    general: {
      count: generalState?.count || 0,
      remaining: Math.max(0, DEFAULT_CONFIG.maxRequests - (generalState?.count || 0)),
      resetIn: generalState
        ? Math.max(0, DEFAULT_CONFIG.windowMs - (now - generalState.windowStart))
        : 0,
    },
    expensive: {
      count: expensiveState?.count || 0,
      remaining: Math.max(0, EXPENSIVE_CONFIG.maxRequests - (expensiveState?.count || 0)),
      resetIn: expensiveState
        ? Math.max(0, EXPENSIVE_CONFIG.windowMs - (now - expensiveState.windowStart))
        : 0,
    },
  };
}

/**
 * Manually reset rate limit for a user (admin function)
 */
export function resetRateLimit(userId: number): void {
  userRateLimits.delete(userId);
  expensiveOpLimits.delete(userId);
}

/**
 * Cleanup old entries periodically to prevent memory leaks
 * Should be called on an interval (e.g., every 5 minutes)
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  const maxAge = Math.max(DEFAULT_CONFIG.windowMs, EXPENSIVE_CONFIG.windowMs) * 2;

  for (const [userId, state] of userRateLimits) {
    if (now - state.windowStart > maxAge) {
      userRateLimits.delete(userId);
    }
  }

  for (const [userId, state] of expensiveOpLimits) {
    if (now - state.windowStart > maxAge) {
      expensiveOpLimits.delete(userId);
    }
  }
}

// Schedule cleanup every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);

/**
 * Stricter rate limit for specific operations (withdrawals, key exports)
 * Returns true if allowed, false if rate limited
 *
 * H-2 NOTE: In-memory storage - resets on restart. For sensitive operations,
 * this creates a brief window after deploy where limits reset. The withdrawal
 * validation module provides additional hourly limits as a second layer.
 */
const sensitiveOpLimits = new Map<string, { count: number; windowStart: number }>();
const SENSITIVE_CONFIG = {
  windowMs: 300000, // 5 minute window
  maxRequests: 3, // 3 sensitive operations per 5 minutes
};

export function checkSensitiveRateLimit(userId: number, operation: string): boolean {
  const key = `${userId}:${operation}`;
  const now = Date.now();

  let state = sensitiveOpLimits.get(key);

  if (!state || now - state.windowStart > SENSITIVE_CONFIG.windowMs) {
    state = { count: 0, windowStart: now };
  }

  state.count++;
  sensitiveOpLimits.set(key, state);

  if (state.count > SENSITIVE_CONFIG.maxRequests) {
    // H-2: Enhanced security logging for sensitive operation rate limits
    const timeSinceStartup = now - STARTUP_TIME;
    const isShortlyAfterStartup = timeSinceStartup < 60000; // Within 1 min of startup
    console.warn(
      `[SECURITY:RateLimit] User ${userId} exceeded ${operation} rate limit. ` +
      `Count: ${state.count}/${SENSITIVE_CONFIG.maxRequests}. ` +
      `Time since startup: ${Math.round(timeSinceStartup / 1000)}s` +
      (isShortlyAfterStartup ? ' [SHORTLY_AFTER_DEPLOY]' : '')
    );
    return false;
  }

  return true;
}

/**
 * Get time since bot startup (for security analysis)
 */
export function getStartupTime(): number {
  return STARTUP_TIME;
}
