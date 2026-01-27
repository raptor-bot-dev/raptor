// =============================================================================
// RAPTOR v3.1 Error Classification
// Determines retry behavior for trade execution failures
// =============================================================================

/**
 * Error codes for trade execution
 * Used to classify errors as retryable or non-retryable
 */
export enum ErrorCode {
  // ========================================
  // RETRYABLE ERRORS
  // ========================================
  // These errors are transient and the trade should be retried

  /** RPC request timed out */
  RPC_TIMEOUT = 'RPC_TIMEOUT',

  /** RPC returned rate limit error */
  RPC_RATE_LIMITED = 'RPC_RATE_LIMITED',

  /** Transaction blockhash expired before confirmation */
  BLOCKHASH_EXPIRED = 'BLOCKHASH_EXPIRED',

  /** Transaction slot was dropped */
  SLOT_DROPPED = 'SLOT_DROPPED',

  /** Network temporarily unavailable */
  NETWORK_ERROR = 'NETWORK_ERROR',

  // ========================================
  // NON-RETRYABLE ERRORS
  // ========================================
  // These errors are permanent and the trade should not be retried

  /** Wallet has insufficient funds for trade */
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',

  /** Slippage exceeded configured limit */
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',

  /** Invalid account or token address */
  INVALID_ACCOUNT = 'INVALID_ACCOUNT',

  /** Token detected as honeypot */
  HONEYPOT_DETECTED = 'HONEYPOT_DETECTED',

  /** Token is frozen and cannot be traded */
  TOKEN_FROZEN = 'TOKEN_FROZEN',

  /** Unrecoverable program error */
  PROGRAM_ERROR = 'PROGRAM_ERROR',

  /** Transaction simulation failed */
  SIMULATION_FAILED = 'SIMULATION_FAILED',

  /** Token blacklisted or banned */
  TOKEN_BLACKLISTED = 'TOKEN_BLACKLISTED',

  /** Deployer blacklisted */
  DEPLOYER_BLACKLISTED = 'DEPLOYER_BLACKLISTED',

  /** Budget or limit exceeded */
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',

  /** Cooldown active for this token */
  COOLDOWN_ACTIVE = 'COOLDOWN_ACTIVE',

  /** Trading is paused globally */
  TRADING_PAUSED = 'TRADING_PAUSED',

  /** Circuit breaker is open */
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
}

/**
 * Set of error codes that should be retried
 */
const RETRYABLE = new Set<ErrorCode>([
  ErrorCode.RPC_TIMEOUT,
  ErrorCode.RPC_RATE_LIMITED,
  ErrorCode.BLOCKHASH_EXPIRED,
  ErrorCode.SLOT_DROPPED,
  ErrorCode.NETWORK_ERROR,
]);

/**
 * Check if an error code indicates a retryable error
 * @param code - The error code to check
 * @returns true if the error should be retried
 */
export function isRetryableError(code?: string | null): boolean {
  return code ? RETRYABLE.has(code as ErrorCode) : false;
}

/**
 * Custom error class with error code support
 */
export class TradeError extends Error {
  code: ErrorCode;
  retryable: boolean;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'TradeError';
    this.code = code;
    this.retryable = isRetryableError(code);
  }
}

/**
 * Parse RPC/blockchain errors into ErrorCode
 */
export function parseError(error: unknown): { code: ErrorCode; message: string } {
  // Handle various error types
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === 'object') {
    // Handle Supabase errors and other object errors with .message property
    const objError = error as { message?: string; error?: string; details?: string };
    message = objError.message || objError.error || objError.details || JSON.stringify(error);
  } else {
    message = String(error);
  }
  const lowerMessage = message.toLowerCase();

  // RPC errors
  if (lowerMessage.includes('timeout')) {
    return { code: ErrorCode.RPC_TIMEOUT, message };
  }
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return { code: ErrorCode.RPC_RATE_LIMITED, message };
  }
  if (lowerMessage.includes('blockhash')) {
    return { code: ErrorCode.BLOCKHASH_EXPIRED, message };
  }
  if (lowerMessage.includes('slot') && lowerMessage.includes('drop')) {
    return { code: ErrorCode.SLOT_DROPPED, message };
  }

  // Funds errors
  if (lowerMessage.includes('insufficient') || lowerMessage.includes('not enough')) {
    return { code: ErrorCode.INSUFFICIENT_FUNDS, message };
  }

  // Slippage
  if (lowerMessage.includes('slippage') || lowerMessage.includes('price impact')) {
    return { code: ErrorCode.SLIPPAGE_EXCEEDED, message };
  }

  // Token issues
  if (lowerMessage.includes('honeypot')) {
    return { code: ErrorCode.HONEYPOT_DETECTED, message };
  }
  if (lowerMessage.includes('frozen')) {
    return { code: ErrorCode.TOKEN_FROZEN, message };
  }
  if (lowerMessage.includes('invalid') && lowerMessage.includes('account')) {
    return { code: ErrorCode.INVALID_ACCOUNT, message };
  }

  // Simulation
  if (lowerMessage.includes('simulation failed')) {
    return { code: ErrorCode.SIMULATION_FAILED, message };
  }

  // Network
  if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
    return { code: ErrorCode.NETWORK_ERROR, message };
  }

  // Default to program error (non-retryable)
  return { code: ErrorCode.PROGRAM_ERROR, message };
}

// =============================================================================
// General Error Classification (Phase 5)
// For non-trade errors (discovery, config, DB)
// =============================================================================

/**
 * General error classification for retry decisions
 */
export type ErrorClass = 'RETRYABLE' | 'PERMANENT' | 'UNKNOWN';

/**
 * Classify any error for retry decisions
 * Used by discovery sources, monitors, and other non-trade code
 */
export function classifyError(error: unknown): ErrorClass {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // Retryable: network issues, timeouts, temporary service issues
  if (
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('timeout') ||
    lower.includes('temporarily unavailable')
  ) {
    return 'RETRYABLE';
  }

  // Permanent: invalid data, constraint violations, logic errors
  if (
    lower.includes('invalid') ||
    lower.includes('constraint') ||
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('zero liquidity') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return 'PERMANENT';
  }

  return 'UNKNOWN';
}

/**
 * Check if an error should be retried
 * Convenience wrapper around classifyError
 */
export function shouldRetry(error: unknown): boolean {
  return classifyError(error) === 'RETRYABLE';
}
