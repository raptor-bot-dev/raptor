// =============================================================================
// RAPTOR v3.1 Configuration Validation
// Per-entrypoint validation for required environment variables
// =============================================================================

/**
 * Validate required environment variables for Bot worker
 * Bot requires Telegram token and wallet encryption key
 */
export function validateBotConfig(): void {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'WALLET_ENCRYPTION_KEY',
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`BOT: Missing required env vars: ${missing.join(', ')}`);
  }

  // Validate Telegram token format (roughly)
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  if (!token.includes(':')) {
    throw new Error('BOT: TELEGRAM_BOT_TOKEN appears invalid (missing colon)');
  }

  // Validate encryption key length
  const encKey = process.env.WALLET_ENCRYPTION_KEY!;
  if (encKey.length < 32) {
    throw new Error('BOT: WALLET_ENCRYPTION_KEY must be at least 32 characters');
  }
}

/**
 * Validate required environment variables for Hunter worker
 * Hunter requires RPC URLs for blockchain connectivity
 */
export function validateHunterConfig(): void {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'SOLANA_RPC_URL',
    'SOLANA_WSS_URL',
    'WALLET_ENCRYPTION_KEY',
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`HUNTER: Missing required env vars: ${missing.join(', ')}`);
  }

  // Validate RPC URLs use HTTPS/WSS
  const rpcUrl = process.env.SOLANA_RPC_URL!;
  if (!rpcUrl.startsWith('https://')) {
    throw new Error('HUNTER: SOLANA_RPC_URL must use HTTPS');
  }

  const wsUrl = process.env.SOLANA_WSS_URL!;
  if (!wsUrl.startsWith('wss://')) {
    throw new Error('HUNTER: SOLANA_WSS_URL must use WSS');
  }

  // Warn if auto-execute is disabled
  if (process.env.AUTO_EXECUTE_ENABLED !== 'true') {
    console.warn('HUNTER: AUTO_EXECUTE_ENABLED is not true, running in monitor-only mode');
  }

  // Prevent devnet/testnet in production
  if (process.env.NODE_ENV === 'production') {
    if (rpcUrl.includes('devnet') || rpcUrl.includes('testnet')) {
      throw new Error('HUNTER: Devnet/testnet RPC detected in production!');
    }
  }
}

/**
 * Get worker ID for job claiming
 * Format: worker-{hostname}-{random}
 */
export function getWorkerId(): string {
  const hostname = process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown';
  const random = Math.random().toString(36).slice(2, 8);
  return `worker-${hostname}-${random}`;
}

/**
 * Check if auto-execution is enabled
 */
export function isAutoExecuteEnabled(): boolean {
  return process.env.AUTO_EXECUTE_ENABLED === 'true';
}

/**
 * Get the default chain for new strategies
 * v4.0: Solana-only build - always returns 'sol'
 */
export function getDefaultChain(): 'sol' {
  return 'sol';
}

/**
 * Get the notification polling interval in milliseconds
 */
export function getNotificationPollInterval(): number {
  const interval = parseInt(process.env.NOTIFICATION_POLL_INTERVAL_MS || '1500', 10);
  return Math.max(500, Math.min(interval, 10000)); // Clamp between 500ms and 10s
}

/**
 * Get the job claim limit per poll
 */
export function getJobClaimLimit(): number {
  const limit = parseInt(process.env.JOB_CLAIM_LIMIT || '5', 10);
  return Math.max(1, Math.min(limit, 20)); // Clamp between 1 and 20
}

/**
 * Get the job lease duration in seconds
 */
export function getJobLeaseDuration(): number {
  const duration = parseInt(process.env.JOB_LEASE_DURATION_SECONDS || '30', 10);
  return Math.max(10, Math.min(duration, 120)); // Clamp between 10s and 2m
}
