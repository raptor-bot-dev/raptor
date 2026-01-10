/**
 * Security Audit Logging for RAPTOR v2.3.1
 *
 * SECURITY: M-002 - Comprehensive logging for security-relevant events
 * - Authentication events
 * - Authorization failures
 * - Sensitive operations (withdrawals, key exports)
 * - Rate limit triggers
 * - Suspicious activity detection
 */

import { supabase } from '../supabase.js';

/**
 * Security event types
 */
export type SecurityEventType =
  | 'AUTH_SUCCESS'
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT_HIT'
  | 'SUSPICIOUS_INPUT'
  | 'WALLET_CREATED'
  | 'KEY_EXPORTED'
  | 'WITHDRAWAL_INITIATED'
  | 'WITHDRAWAL_COMPLETED'
  | 'WITHDRAWAL_FAILED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'TRADE_EXECUTED'
  | 'TRADE_FAILED'
  | 'SIMULATION_FAILED'
  | 'REENTRANCY_BLOCKED'
  | 'OWNERSHIP_VERIFIED'
  | 'OWNERSHIP_DENIED'
  | 'CONFIG_CHANGED'
  | 'EMERGENCY_EXIT'
  | 'HONEYPOT_DETECTED'
  | 'HIGH_SLIPPAGE_WARNING';

/**
 * Security event severity
 */
export type SecuritySeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * Security event log entry
 */
export interface SecurityEvent {
  timestamp: string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  tgId?: number;
  chain?: string;
  details: Record<string, unknown>;
  ipHash?: string; // Hashed IP for privacy
  userAgent?: string;
}

/**
 * In-memory buffer for batch inserts
 */
const eventBuffer: SecurityEvent[] = [];
const BUFFER_FLUSH_INTERVAL = 5000; // 5 seconds
const BUFFER_MAX_SIZE = 100;

/**
 * Severity mapping for event types
 */
const EVENT_SEVERITY: Record<SecurityEventType, SecuritySeverity> = {
  AUTH_SUCCESS: 'INFO',
  AUTH_FAILURE: 'WARNING',
  RATE_LIMIT_HIT: 'WARNING',
  SUSPICIOUS_INPUT: 'WARNING',
  WALLET_CREATED: 'INFO',
  KEY_EXPORTED: 'WARNING',
  WITHDRAWAL_INITIATED: 'INFO',
  WITHDRAWAL_COMPLETED: 'INFO',
  WITHDRAWAL_FAILED: 'ERROR',
  POSITION_OPENED: 'INFO',
  POSITION_CLOSED: 'INFO',
  TRADE_EXECUTED: 'INFO',
  TRADE_FAILED: 'ERROR',
  SIMULATION_FAILED: 'WARNING',
  REENTRANCY_BLOCKED: 'WARNING',
  OWNERSHIP_VERIFIED: 'INFO',
  OWNERSHIP_DENIED: 'ERROR',
  CONFIG_CHANGED: 'WARNING',
  EMERGENCY_EXIT: 'WARNING',
  HONEYPOT_DETECTED: 'CRITICAL',
  HIGH_SLIPPAGE_WARNING: 'WARNING',
};

/**
 * Log a security event
 */
export function logSecurityEvent(
  type: SecurityEventType,
  details: Record<string, unknown>,
  options?: {
    tgId?: number;
    chain?: string;
    severity?: SecuritySeverity;
  }
): void {
  const event: SecurityEvent = {
    timestamp: new Date().toISOString(),
    type,
    severity: options?.severity || EVENT_SEVERITY[type],
    tgId: options?.tgId,
    chain: options?.chain,
    details: sanitizeDetails(details),
  };

  // Console log for immediate visibility
  const logFn = event.severity === 'CRITICAL' || event.severity === 'ERROR'
    ? console.error
    : event.severity === 'WARNING'
      ? console.warn
      : console.log;

  logFn(`[Security:${event.severity}] ${type}`, {
    tgId: event.tgId,
    chain: event.chain,
    ...event.details,
  });

  // Add to buffer for batch insert
  eventBuffer.push(event);

  // Flush if buffer is full
  if (eventBuffer.length >= BUFFER_MAX_SIZE) {
    flushEventBuffer();
  }
}

/**
 * Sanitize details to remove sensitive information
 */
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    // Skip sensitive fields
    if (key.toLowerCase().includes('private') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('key')) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    // Truncate long strings
    if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.slice(0, 500) + '...[truncated]';
      continue;
    }

    // Mask addresses partially
    if (key.toLowerCase().includes('address') && typeof value === 'string') {
      if (value.length > 20) {
        sanitized[key] = `${value.slice(0, 8)}...${value.slice(-6)}`;
      } else {
        sanitized[key] = value;
      }
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

/**
 * Flush event buffer to database
 */
async function flushEventBuffer(): Promise<void> {
  if (eventBuffer.length === 0) return;

  const events = eventBuffer.splice(0, eventBuffer.length);

  try {
    // Insert to database (create table if using this)
    const { error } = await supabase
      .from('security_audit_log')
      .insert(events.map(e => ({
        timestamp: e.timestamp,
        event_type: e.type,
        severity: e.severity,
        tg_id: e.tgId,
        chain: e.chain,
        details: e.details,
      })));

    if (error) {
      // Log to console if DB insert fails (don't lose events)
      console.error('[AuditLog] Failed to persist events:', error.message);
      console.error('[AuditLog] Lost events:', events.length);
    }
  } catch (error) {
    console.error('[AuditLog] Error flushing buffer:', error);
  }
}

// Flush buffer periodically
setInterval(flushEventBuffer, BUFFER_FLUSH_INTERVAL);

// Flush on process exit
process.on('beforeExit', () => {
  flushEventBuffer();
});

/**
 * Query security events (for admin/monitoring)
 */
export async function querySecurityEvents(options: {
  tgId?: number;
  type?: SecurityEventType;
  severity?: SecuritySeverity;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<SecurityEvent[]> {
  let query = supabase
    .from('security_audit_log')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(options.limit || 100);

  if (options.tgId) {
    query = query.eq('tg_id', options.tgId);
  }

  if (options.type) {
    query = query.eq('event_type', options.type);
  }

  if (options.severity) {
    query = query.eq('severity', options.severity);
  }

  if (options.startDate) {
    query = query.gte('timestamp', options.startDate.toISOString());
  }

  if (options.endDate) {
    query = query.lte('timestamp', options.endDate.toISOString());
  }

  const { data, error } = await query;

  if (error) {
    console.error('[AuditLog] Query error:', error);
    return [];
  }

  return (data || []).map(row => ({
    timestamp: row.timestamp,
    type: row.event_type as SecurityEventType,
    severity: row.severity as SecuritySeverity,
    tgId: row.tg_id,
    chain: row.chain,
    details: row.details,
  }));
}

/**
 * Get security summary for monitoring dashboard
 */
export async function getSecuritySummary(hours: number = 24): Promise<{
  totalEvents: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  criticalEvents: SecurityEvent[];
}> {
  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('security_audit_log')
    .select('*')
    .gte('timestamp', startDate.toISOString());

  if (error || !data) {
    return {
      totalEvents: 0,
      byType: {},
      bySeverity: {},
      criticalEvents: [],
    };
  }

  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const criticalEvents: SecurityEvent[] = [];

  for (const row of data) {
    byType[row.event_type] = (byType[row.event_type] || 0) + 1;
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;

    if (row.severity === 'CRITICAL') {
      criticalEvents.push({
        timestamp: row.timestamp,
        type: row.event_type,
        severity: row.severity,
        tgId: row.tg_id,
        chain: row.chain,
        details: row.details,
      });
    }
  }

  return {
    totalEvents: data.length,
    byType,
    bySeverity,
    criticalEvents,
  };
}

/**
 * Convenience functions for common events
 */
export const securityLog = {
  authSuccess: (tgId: number) =>
    logSecurityEvent('AUTH_SUCCESS', {}, { tgId }),

  authFailure: (tgId: number, reason: string) =>
    logSecurityEvent('AUTH_FAILURE', { reason }, { tgId }),

  rateLimitHit: (tgId: number, endpoint: string) =>
    logSecurityEvent('RATE_LIMIT_HIT', { endpoint }, { tgId }),

  suspiciousInput: (tgId: number, input: string) =>
    logSecurityEvent('SUSPICIOUS_INPUT', { inputPreview: input.slice(0, 100) }, { tgId }),

  walletCreated: (tgId: number, chain: string) =>
    logSecurityEvent('WALLET_CREATED', {}, { tgId, chain }),

  keyExported: (tgId: number, chain: string) =>
    logSecurityEvent('KEY_EXPORTED', {}, { tgId, chain }),

  withdrawalInitiated: (tgId: number, chain: string, amount: string, toAddress: string) =>
    logSecurityEvent('WITHDRAWAL_INITIATED', { amount, toAddress }, { tgId, chain }),

  withdrawalCompleted: (tgId: number, chain: string, txHash: string) =>
    logSecurityEvent('WITHDRAWAL_COMPLETED', { txHash }, { tgId, chain }),

  withdrawalFailed: (tgId: number, chain: string, error: string) =>
    logSecurityEvent('WITHDRAWAL_FAILED', { error }, { tgId, chain }),

  tradeExecuted: (tgId: number, chain: string, type: string, token: string, amount: string) =>
    logSecurityEvent('TRADE_EXECUTED', { type, token, amount }, { tgId, chain }),

  tradeFailed: (tgId: number, chain: string, error: string) =>
    logSecurityEvent('TRADE_FAILED', { error }, { tgId, chain }),

  simulationFailed: (tgId: number, chain: string, reason: string) =>
    logSecurityEvent('SIMULATION_FAILED', { reason }, { tgId, chain }),

  reentrancyBlocked: (tgId: number, token: string, operation: string) =>
    logSecurityEvent('REENTRANCY_BLOCKED', { token, operation }, { tgId }),

  honeypotDetected: (chain: string, token: string, reason: string) =>
    logSecurityEvent('HONEYPOT_DETECTED', { token, reason }, { chain }),

  emergencyExit: (tgId: number, chain: string, token: string, reason: string) =>
    logSecurityEvent('EMERGENCY_EXIT', { token, reason }, { tgId, chain }),
};
