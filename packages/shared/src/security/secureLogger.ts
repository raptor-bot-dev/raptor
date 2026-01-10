/**
 * Secure Logger for RAPTOR v2.3.1
 *
 * SECURITY: L-002 - Mask sensitive data in logs
 * - Masks wallet addresses (shows first 6 and last 4 chars)
 * - Masks private keys entirely
 * - Masks user IDs in production
 * - Structured logging support
 */

/**
 * Mask a wallet address for logging
 * Shows first 6 and last 4 characters: 0x1234...abcd
 */
export function maskAddress(address: string | undefined | null): string {
  if (!address) return '[no address]';

  const addr = String(address).trim();

  // Handle short addresses
  if (addr.length <= 10) {
    return addr.slice(0, 4) + '...' + addr.slice(-2);
  }

  // Standard masking: first 6, last 4
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/**
 * Mask multiple addresses in a string
 * Detects common address patterns and masks them
 */
export function maskAddressesInString(str: string): string {
  if (!str) return str;

  // EVM address pattern (0x followed by 40 hex chars)
  const evmPattern = /0x[a-fA-F0-9]{40}/g;

  // Solana address pattern (32-44 base58 chars)
  const solanaPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

  let result = str;

  // Mask EVM addresses
  result = result.replace(evmPattern, (match) => maskAddress(match));

  // Mask Solana addresses (be careful not to mask other base58 strings)
  // Only mask if it looks like a full address (32+ chars)
  result = result.replace(solanaPattern, (match) => {
    // Skip if it's clearly not an address (too short or contains common words)
    if (match.length < 32) return match;
    return maskAddress(match);
  });

  return result;
}

/**
 * Mask a private key entirely
 */
export function maskPrivateKey(_key: string | undefined): string {
  return '[REDACTED]';
}

/**
 * Mask a user ID in production
 */
export function maskUserId(userId: string | number | undefined): string {
  if (!userId) return '[no user]';

  const id = String(userId);

  // In development, show full ID
  if (process.env.NODE_ENV === 'development') {
    return id;
  }

  // In production, show last 4 digits
  if (id.length <= 4) {
    return '***' + id;
  }

  return '***' + id.slice(-4);
}

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log context with sensitive data handling
 */
export interface LogContext {
  userId?: string | number;
  address?: string;
  chain?: string;
  txHash?: string;
  operation?: string;
  [key: string]: unknown;
}

/**
 * Secure logger class
 */
class SecureLogger {
  private name: string;
  private enabled: boolean;

  constructor(name: string) {
    this.name = name;
    this.enabled = process.env.LOG_LEVEL !== 'silent';
  }

  /**
   * Format context with masked sensitive data
   */
  private formatContext(context?: LogContext): string {
    if (!context || Object.keys(context).length === 0) {
      return '';
    }

    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      if (key === 'userId') {
        masked[key] = maskUserId(value as string | number);
      } else if (key === 'address' || key.toLowerCase().includes('address')) {
        masked[key] = maskAddress(value as string);
      } else if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')) {
        masked[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 30) {
        // Mask potential addresses in long strings
        masked[key] = maskAddressesInString(value);
      } else {
        masked[key] = value;
      }
    }

    return ' ' + JSON.stringify(masked);
  }

  /**
   * Log at debug level
   */
  debug(message: string, context?: LogContext): void {
    if (!this.enabled || process.env.LOG_LEVEL === 'info') return;
    console.debug(`[${this.name}] ${maskAddressesInString(message)}${this.formatContext(context)}`);
  }

  /**
   * Log at info level
   */
  info(message: string, context?: LogContext): void {
    if (!this.enabled) return;
    console.log(`[${this.name}] ${maskAddressesInString(message)}${this.formatContext(context)}`);
  }

  /**
   * Log at warn level
   */
  warn(message: string, context?: LogContext): void {
    if (!this.enabled) return;
    console.warn(`[${this.name}] ${maskAddressesInString(message)}${this.formatContext(context)}`);
  }

  /**
   * Log at error level
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (!this.enabled) return;

    let errorInfo = '';
    if (error instanceof Error) {
      // Mask addresses in error message
      errorInfo = ` | ${maskAddressesInString(error.message)}`;
    } else if (error) {
      errorInfo = ` | ${maskAddressesInString(String(error))}`;
    }

    console.error(`[${this.name}] ${maskAddressesInString(message)}${errorInfo}${this.formatContext(context)}`);
  }

  /**
   * Log a transaction event (structured)
   */
  tx(event: string, context: LogContext & { txHash?: string; status?: string }): void {
    this.info(`TX:${event}`, context);
  }

  /**
   * Log a security event (always logged)
   */
  security(event: string, context: LogContext): void {
    // Security events always log, even if logging is disabled
    console.warn(`[${this.name}:SECURITY] ${event}${this.formatContext(context)}`);
  }
}

/**
 * Create a logger instance for a module
 */
export function createLogger(name: string): SecureLogger {
  return new SecureLogger(name);
}

/**
 * Global logger instance
 */
export const logger = createLogger('RAPTOR');

/**
 * Helper to sanitize objects for logging
 */
export function sanitizeForLog(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('key') || lowerKey.includes('secret') || lowerKey.includes('password')) {
      sanitized[key] = '[REDACTED]';
    } else if (lowerKey.includes('address') || lowerKey === 'wallet' || lowerKey === 'recipient') {
      sanitized[key] = maskAddress(value as string);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLog(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
