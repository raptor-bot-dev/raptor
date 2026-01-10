/**
 * Input Sanitization for RAPTOR v2.3.1
 *
 * SECURITY: M-001 - Sanitize all user inputs to prevent injection attacks
 * - Command injection prevention
 * - XSS prevention for displayed content
 * - SQL/NoSQL injection prevention
 * - Path traversal prevention
 */

/**
 * Maximum allowed input lengths
 */
const MAX_LENGTHS = {
  message: 4096,
  address: 64,
  amount: 32,
  symbol: 20,
  command: 100,
  callbackData: 256,
};

/**
 * Sanitize a generic text input
 * Removes control characters and limits length
 */
export function sanitizeText(input: string, maxLength: number = MAX_LENGTHS.message): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove null bytes and control characters (except newlines and tabs)
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized.trim();
}

/**
 * Sanitize user message input
 * More restrictive - used for command parsing
 */
export function sanitizeMessage(input: string): string {
  const sanitized = sanitizeText(input, MAX_LENGTHS.message);

  // Remove potential command injection characters for shell
  // Keep alphanumeric, spaces, common punctuation, and crypto addresses
  return sanitized.replace(/[`$\\|;&<>]/g, '');
}

/**
 * Sanitize blockchain address input
 * Validates format and removes dangerous characters
 */
export function sanitizeAddress(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove whitespace
  let sanitized = input.trim();

  // Limit length
  if (sanitized.length > MAX_LENGTHS.address) {
    return '';
  }

  // Allow only valid address characters (alphanumeric for base58/hex)
  // Solana: base58 (alphanumeric except 0, O, I, l)
  // EVM: hex with 0x prefix
  if (!/^(0x)?[a-zA-Z0-9]+$/.test(sanitized)) {
    return '';
  }

  return sanitized;
}

/**
 * Sanitize amount input
 * Ensures it's a valid positive number
 */
export function sanitizeAmount(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const sanitized = input.trim();

  // Must be a valid decimal number
  if (!/^\d+(\.\d+)?$/.test(sanitized)) {
    return '';
  }

  // Check length
  if (sanitized.length > MAX_LENGTHS.amount) {
    return '';
  }

  // Parse and validate range
  const num = parseFloat(sanitized);
  if (isNaN(num) || num <= 0 || num > 1e18) {
    return '';
  }

  return sanitized;
}

/**
 * Sanitize token symbol
 */
export function sanitizeSymbol(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Uppercase, alphanumeric only, limited length
  const sanitized = input.trim().toUpperCase();

  if (sanitized.length > MAX_LENGTHS.symbol) {
    return sanitized.slice(0, MAX_LENGTHS.symbol);
  }

  // Only allow alphanumeric and common symbol characters
  if (!/^[A-Z0-9_-]+$/.test(sanitized)) {
    return sanitized.replace(/[^A-Z0-9_-]/g, '');
  }

  return sanitized;
}

/**
 * Sanitize callback data from inline keyboards
 * Prevents callback injection attacks
 */
export function sanitizeCallbackData(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const sanitized = input.trim();

  // Limit length
  if (sanitized.length > MAX_LENGTHS.callbackData) {
    return '';
  }

  // Only allow expected callback format (alphanumeric, underscore, hyphen, colon)
  if (!/^[a-zA-Z0-9_:-]+$/.test(sanitized)) {
    return '';
  }

  return sanitized;
}

/**
 * Sanitize command input
 */
export function sanitizeCommand(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const sanitized = input.trim().toLowerCase();

  // Must start with / and contain only valid command characters
  if (!sanitized.startsWith('/')) {
    return '';
  }

  if (sanitized.length > MAX_LENGTHS.command) {
    return '';
  }

  // Only allow alphanumeric and underscore after /
  if (!/^\/[a-z0-9_]+$/.test(sanitized.split(' ')[0])) {
    return '';
  }

  return sanitized;
}

/**
 * Escape HTML entities for safe display
 * Use when displaying user input back to them
 */
export function escapeHtml(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape Markdown special characters for Telegram
 */
export function escapeMarkdown(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Escape Markdown V1 special characters
  return input.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Validate and sanitize a complete user input object
 */
export interface SanitizedInput {
  valid: boolean;
  message?: string;
  address?: string;
  amount?: string;
  symbol?: string;
  command?: string;
  error?: string;
}

export function sanitizeUserInput(raw: {
  message?: string;
  address?: string;
  amount?: string;
  symbol?: string;
  command?: string;
}): SanitizedInput {
  const result: SanitizedInput = { valid: true };

  if (raw.message !== undefined) {
    result.message = sanitizeMessage(raw.message);
    if (raw.message && !result.message) {
      result.valid = false;
      result.error = 'Invalid message format';
    }
  }

  if (raw.address !== undefined) {
    result.address = sanitizeAddress(raw.address);
    if (raw.address && !result.address) {
      result.valid = false;
      result.error = 'Invalid address format';
    }
  }

  if (raw.amount !== undefined) {
    result.amount = sanitizeAmount(raw.amount);
    if (raw.amount && !result.amount) {
      result.valid = false;
      result.error = 'Invalid amount format';
    }
  }

  if (raw.symbol !== undefined) {
    result.symbol = sanitizeSymbol(raw.symbol);
  }

  if (raw.command !== undefined) {
    result.command = sanitizeCommand(raw.command);
    if (raw.command && !result.command) {
      result.valid = false;
      result.error = 'Invalid command format';
    }
  }

  return result;
}

/**
 * Check for suspicious patterns in input
 * Returns true if input looks suspicious
 */
export function detectSuspiciousInput(input: string): boolean {
  if (!input) return false;

  const suspiciousPatterns = [
    /\$\{.*\}/,           // Template injection
    /\$\(.*\)/,           // Command substitution
    /<script/i,           // XSS attempt
    /javascript:/i,       // JavaScript URI
    /data:/i,             // Data URI
    /on\w+\s*=/i,         // Event handlers
    /union\s+select/i,    // SQL injection
    /;\s*drop\s+/i,       // SQL injection
    /\.\.\//,             // Path traversal
    /%00/,                // Null byte
    /\\x00/,              // Null byte hex
  ];

  return suspiciousPatterns.some(pattern => pattern.test(input));
}
