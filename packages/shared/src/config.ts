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

// =============================================================================
// TP/SL Engine Configuration (Phase B)
// =============================================================================

/**
 * Check if the new TP/SL engine is enabled
 * Set TPSL_ENGINE_ENABLED=true to enable the new event-driven TP/SL system
 */
export function isTpSlEngineEnabled(): boolean {
  return process.env.TPSL_ENGINE_ENABLED === 'true';
}

/**
 * Check if the legacy position monitor should run
 * Set LEGACY_POSITION_MONITOR=false to disable legacy polling
 * Default: true (run alongside new system during migration)
 */
export function isLegacyPositionMonitorEnabled(): boolean {
  return process.env.LEGACY_POSITION_MONITOR !== 'false';
}

// =============================================================================
// Bags.fm Discovery Source Configuration (Phase 1)
// =============================================================================

/**
 * Check if Bags.fm discovery source is enabled
 * Set BAGS_SOURCE_ENABLED=true to enable Telegram channel monitoring
 */
export function isBagsSourceEnabled(): boolean {
  return process.env.BAGS_SOURCE_ENABLED === 'true';
}

/**
 * Get the Bags.fm Telegram channel ID
 * Can be @channel_username or numeric channel ID (e.g., -1001234567890)
 */
export function getBagsChannelId(): string {
  return process.env.BAGS_CHANNEL_ID || '';
}

/**
 * Get the Bags.fm bot token for channel monitoring
 * This bot must be added to the target channel
 */
export function getBagsBotToken(): string {
  return process.env.BAGS_BOT_TOKEN || '';
}

/**
 * Get the deduplication TTL for Bags signals in milliseconds
 */
export function getBagsDedupeTtlMs(): number {
  return parseInt(process.env.BAGS_DEDUPE_TTL_MS || '60000', 10);
}

// =============================================================================
// Graduation Monitor Configuration (Phase 3)
// =============================================================================

/**
 * Check if the graduation monitor is enabled
 * Set GRADUATION_ENABLED=true to enable lifecycle state monitoring
 */
export function isGraduationMonitorEnabled(): boolean {
  return process.env.GRADUATION_ENABLED === 'true';
}

/**
 * Get the graduation monitor poll interval in milliseconds
 * Default: 10000 (10 seconds)
 */
export function getGraduationPollIntervalMs(): number {
  const interval = parseInt(process.env.GRADUATION_POLL_INTERVAL_MS || '10000', 10);
  return Math.max(5000, Math.min(interval, 60000)); // Clamp between 5s and 60s
}

// =============================================================================
// Candidate Consumer Configuration (Auto-Trading)
// =============================================================================

/**
 * Check if candidate auto-trading is enabled
 * Set CANDIDATE_CONSUMER_ENABLED=true to enable automatic trading from launch_candidates
 */
export function isCandidateConsumerEnabled(): boolean {
  return process.env.CANDIDATE_CONSUMER_ENABLED === 'true';
}

/**
 * Get the poll interval for the candidate consumer in milliseconds
 * Default: 2000 (2 seconds) - matches trade execution latency needs
 */
export function getCandidateConsumerPollIntervalMs(): number {
  const interval = parseInt(process.env.CANDIDATE_CONSUMER_POLL_INTERVAL_MS || '2000', 10);
  return Math.max(1000, Math.min(interval, 10000)); // Clamp between 1s and 10s
}

/**
 * Get the batch size for candidate processing
 * Default: 10
 */
export function getCandidateConsumerBatchSize(): number {
  const size = parseInt(process.env.CANDIDATE_CONSUMER_BATCH_SIZE || '10', 10);
  return Math.max(1, Math.min(size, 50)); // Clamp between 1 and 50
}

/**
 * Get the max age for candidates in seconds
 * Candidates older than this are expired instead of queued
 * Default: 120 (2 minutes) - token launch window
 */
export function getCandidateMaxAgeSeconds(): number {
  const age = parseInt(process.env.CANDIDATE_MAX_AGE_SECONDS || '120', 10);
  return Math.max(30, Math.min(age, 600)); // Clamp between 30s and 10min
}

// =============================================================================
// Meteora On-Chain Detection Configuration (Phase 4)
// =============================================================================

/**
 * Check if Meteora on-chain detection is enabled
 * Set METEORA_ONCHAIN_ENABLED=true to enable WebSocket monitoring of Meteora DBC program
 */
export function isMeteoraOnChainEnabled(): boolean {
  return process.env.METEORA_ONCHAIN_ENABLED === 'true';
}

/**
 * Get the Meteora DBC program ID
 * Default: dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
 */
export function getMeteoraProgramId(): string {
  return process.env.METEORA_PROGRAM_ID || 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
}

// =============================================================================
// Phase 5: Comprehensive Config Validation
// =============================================================================

/**
 * Result of config validation
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate all configuration at startup
 * Call this before starting any service to fail fast on misconfiguration
 */
export function validateAllConfig(context: 'hunter' | 'bot' | 'executor' = 'hunter'): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required for all deployments
  if (!process.env.SUPABASE_URL) {
    errors.push('Missing SUPABASE_URL');
  }
  if (!process.env.SUPABASE_SERVICE_KEY) {
    errors.push('Missing SUPABASE_SERVICE_KEY');
  }

  // Context-specific validation
  if (context === 'hunter' || context === 'executor') {
    // Execution requires RPC
    if (!process.env.SOLANA_RPC_URL) {
      errors.push('Missing SOLANA_RPC_URL');
    }
    if (!process.env.WALLET_ENCRYPTION_KEY) {
      errors.push('Missing WALLET_ENCRYPTION_KEY');
    }
  }

  if (context === 'bot') {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      errors.push('Missing TELEGRAM_BOT_TOKEN');
    }
    if (!process.env.WALLET_ENCRYPTION_KEY) {
      errors.push('Missing WALLET_ENCRYPTION_KEY');
    }
  }

  // Discovery source validation
  if (isBagsSourceEnabled()) {
    if (!getBagsBotToken()) {
      errors.push('BAGS_SOURCE_ENABLED=true but missing BAGS_BOT_TOKEN');
    }
    if (!getBagsChannelId()) {
      errors.push('BAGS_SOURCE_ENABLED=true but missing BAGS_CHANNEL_ID');
    }
  }

  // Meteora on-chain validation
  if (isMeteoraOnChainEnabled()) {
    if (!process.env.SOLANA_WSS_URL) {
      errors.push('METEORA_ONCHAIN_ENABLED=true but missing SOLANA_WSS_URL');
    }
  }

  // Warnings for optional features
  if (!isAutoExecuteEnabled()) {
    warnings.push('AUTO_EXECUTE_ENABLED is not true - running in monitor-only mode');
  }

  if (!isGraduationMonitorEnabled()) {
    warnings.push('GRADUATION_ENABLED is not true - lifecycle tracking disabled');
  }

  if (!isTpSlEngineEnabled() && !isLegacyPositionMonitorEnabled()) {
    warnings.push('No position monitor enabled - TP/SL triggers will not fire');
  }

  // Production safety checks
  if (process.env.NODE_ENV === 'production') {
    const rpcUrl = process.env.SOLANA_RPC_URL || '';
    if (rpcUrl.includes('devnet') || rpcUrl.includes('testnet')) {
      errors.push('Devnet/testnet RPC detected in production environment');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate config and log results
 * Returns true if valid, throws or exits if not
 */
export function validateAndLogConfig(context: 'hunter' | 'bot' | 'executor' = 'hunter'): void {
  const result = validateAllConfig(context);

  // Log warnings
  for (const warning of result.warnings) {
    console.warn(`[Config] ⚠️  ${warning}`);
  }

  // Log enabled features
  console.log('[Config] Enabled features:');
  console.log(`  - Bags Source: ${isBagsSourceEnabled() ? 'YES' : 'NO'}`);
  console.log(`  - Meteora On-Chain: ${isMeteoraOnChainEnabled() ? 'YES' : 'NO'}`);
  console.log(`  - Graduation Monitor: ${isGraduationMonitorEnabled() ? 'YES' : 'NO'}`);
  console.log(`  - TP/SL Engine: ${isTpSlEngineEnabled() ? 'YES' : 'NO'}`);
  console.log(`  - Auto Execute: ${isAutoExecuteEnabled() ? 'YES' : 'NO'}`);

  // Fail on errors
  if (!result.valid) {
    console.error('[Config] ❌ Configuration errors:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    throw new Error(`Configuration invalid: ${result.errors.join(', ')}`);
  }

  console.log('[Config] ✅ Configuration valid');
}
