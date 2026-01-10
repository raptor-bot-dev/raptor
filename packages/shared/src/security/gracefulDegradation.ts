/**
 * Graceful Degradation for RAPTOR v2.3.1
 *
 * SECURITY: M-005, M-006 - Configuration and graceful failure handling
 * - Externalized configuration
 * - Fallback mechanisms
 * - Circuit breaker pattern
 * - Feature flags for degraded mode
 */

import { getServiceHealth, isServiceAvailable } from './healthCheck.js';

/**
 * Configuration with defaults and environment overrides
 */
export interface RaptorConfig {
  // Trading limits
  trading: {
    maxPositionSizeSol: number;
    maxPositionSizeBnb: number;
    maxPositionSizeEth: number;
    maxPositionsPerUser: number;
    maxTradesPerMinute: number;
    defaultSlippageBuy: number;
    defaultSlippageSell: number;
    emergencySlippage: number;
  };

  // Timeouts (milliseconds)
  timeouts: {
    rpcCall: number;
    transactionSol: number;
    transactionEvm: number;
    apiCall: number;
    healthCheck: number;
  };

  // Rate limits
  rateLimits: {
    requestsPerMinute: number;
    expensiveOpsPerMinute: number;
    withdrawalsPerHour: number;
  };

  // Feature flags
  features: {
    autoHuntEnabled: boolean;
    privateRpcEnabled: boolean;
    simulationRequired: boolean;
    mevProtectionEnabled: boolean;
    auditLoggingEnabled: boolean;
  };

  // Degraded mode settings
  degradedMode: {
    disableAutoHunt: boolean;
    disableNewPositions: boolean;
    requireManualConfirmation: boolean;
    increaseSlippage: number; // Additional slippage in degraded mode
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RaptorConfig = {
  trading: {
    maxPositionSizeSol: 50,
    maxPositionSizeBnb: 10,
    maxPositionSizeEth: 2,
    maxPositionsPerUser: 10,
    maxTradesPerMinute: 10,
    defaultSlippageBuy: 15,
    defaultSlippageSell: 10,
    emergencySlippage: 50,
  },
  timeouts: {
    rpcCall: 5000,
    transactionSol: 30000,
    transactionEvm: 60000,
    apiCall: 10000,
    healthCheck: 5000,
  },
  rateLimits: {
    requestsPerMinute: 30,
    expensiveOpsPerMinute: 10,
    withdrawalsPerHour: 5,
  },
  features: {
    autoHuntEnabled: true,
    privateRpcEnabled: true,
    simulationRequired: true,
    mevProtectionEnabled: true,
    auditLoggingEnabled: true,
  },
  degradedMode: {
    disableAutoHunt: true,
    disableNewPositions: false,
    requireManualConfirmation: true,
    increaseSlippage: 10,
  },
};

/**
 * Current active configuration
 */
let activeConfig: RaptorConfig = { ...DEFAULT_CONFIG };

/**
 * Load configuration from environment
 */
export function loadConfigFromEnv(): void {
  const env = process.env;

  // Trading limits
  if (env.MAX_POSITION_SIZE_SOL) {
    activeConfig.trading.maxPositionSizeSol = parseFloat(env.MAX_POSITION_SIZE_SOL);
  }
  if (env.MAX_POSITION_SIZE_BNB) {
    activeConfig.trading.maxPositionSizeBnb = parseFloat(env.MAX_POSITION_SIZE_BNB);
  }
  if (env.MAX_POSITION_SIZE_ETH) {
    activeConfig.trading.maxPositionSizeEth = parseFloat(env.MAX_POSITION_SIZE_ETH);
  }
  if (env.MAX_POSITIONS_PER_USER) {
    activeConfig.trading.maxPositionsPerUser = parseInt(env.MAX_POSITIONS_PER_USER, 10);
  }
  if (env.DEFAULT_SLIPPAGE_BUY) {
    activeConfig.trading.defaultSlippageBuy = parseFloat(env.DEFAULT_SLIPPAGE_BUY);
  }
  if (env.DEFAULT_SLIPPAGE_SELL) {
    activeConfig.trading.defaultSlippageSell = parseFloat(env.DEFAULT_SLIPPAGE_SELL);
  }

  // Timeouts
  if (env.RPC_TIMEOUT_MS) {
    activeConfig.timeouts.rpcCall = parseInt(env.RPC_TIMEOUT_MS, 10);
  }
  if (env.TX_TIMEOUT_SOL_MS) {
    activeConfig.timeouts.transactionSol = parseInt(env.TX_TIMEOUT_SOL_MS, 10);
  }
  if (env.TX_TIMEOUT_EVM_MS) {
    activeConfig.timeouts.transactionEvm = parseInt(env.TX_TIMEOUT_EVM_MS, 10);
  }

  // Rate limits
  if (env.RATE_LIMIT_REQUESTS_PER_MIN) {
    activeConfig.rateLimits.requestsPerMinute = parseInt(env.RATE_LIMIT_REQUESTS_PER_MIN, 10);
  }

  // Feature flags
  if (env.FEATURE_AUTO_HUNT !== undefined) {
    activeConfig.features.autoHuntEnabled = env.FEATURE_AUTO_HUNT === 'true';
  }
  if (env.FEATURE_PRIVATE_RPC !== undefined) {
    activeConfig.features.privateRpcEnabled = env.FEATURE_PRIVATE_RPC === 'true';
  }
  if (env.FEATURE_SIMULATION !== undefined) {
    activeConfig.features.simulationRequired = env.FEATURE_SIMULATION === 'true';
  }
  if (env.FEATURE_MEV_PROTECTION !== undefined) {
    activeConfig.features.mevProtectionEnabled = env.FEATURE_MEV_PROTECTION === 'true';
  }

  console.log('[Config] Configuration loaded from environment');
}

/**
 * Get current configuration
 */
export function getConfig(): RaptorConfig {
  return activeConfig;
}

/**
 * Get effective configuration (considering degraded mode)
 */
export function getEffectiveConfig(): RaptorConfig {
  const health = getServiceHealth('database');
  const isDBHealthy = health?.status === 'healthy';

  // If system is degraded, apply degraded mode settings
  if (!isDBHealthy || !isServiceAvailable('database')) {
    return {
      ...activeConfig,
      features: {
        ...activeConfig.features,
        autoHuntEnabled: activeConfig.features.autoHuntEnabled && !activeConfig.degradedMode.disableAutoHunt,
      },
      trading: {
        ...activeConfig.trading,
        defaultSlippageBuy: activeConfig.trading.defaultSlippageBuy + activeConfig.degradedMode.increaseSlippage,
        defaultSlippageSell: activeConfig.trading.defaultSlippageSell + activeConfig.degradedMode.increaseSlippage,
      },
    };
  }

  return activeConfig;
}

/**
 * Circuit breaker state
 */
interface CircuitBreaker {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  lastSuccess: number;
}

const circuitBreakers = new Map<string, CircuitBreaker>();

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,       // Failures before opening circuit
  resetTimeoutMs: 30000,     // Time before trying again (half-open)
  halfOpenSuccessThreshold: 2, // Successes needed to close circuit
};

/**
 * Execute with circuit breaker protection
 */
export async function executeWithCircuitBreaker<T>(
  name: string,
  operation: () => Promise<T>,
  fallback?: () => T
): Promise<T> {
  let breaker = circuitBreakers.get(name);

  if (!breaker) {
    breaker = {
      state: 'closed',
      failures: 0,
      lastFailure: 0,
      lastSuccess: Date.now(),
    };
    circuitBreakers.set(name, breaker);
  }

  const now = Date.now();

  // Check circuit state
  if (breaker.state === 'open') {
    // Check if we should try half-open
    if (now - breaker.lastFailure > CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
      breaker.state = 'half-open';
      console.log(`[CircuitBreaker] ${name}: open -> half-open`);
    } else {
      // Circuit is open, use fallback
      if (fallback) {
        return fallback();
      }
      throw new Error(`Circuit breaker ${name} is open`);
    }
  }

  try {
    const result = await operation();

    // Success
    if (breaker.state === 'half-open') {
      breaker.failures = 0;
      breaker.state = 'closed';
      console.log(`[CircuitBreaker] ${name}: half-open -> closed`);
    }
    breaker.lastSuccess = now;
    breaker.failures = 0;

    return result;
  } catch (error) {
    breaker.failures++;
    breaker.lastFailure = now;

    if (breaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      breaker.state = 'open';
      console.warn(`[CircuitBreaker] ${name}: closed -> open (${breaker.failures} failures)`);
    }

    if (fallback) {
      console.warn(`[CircuitBreaker] ${name}: using fallback`);
      return fallback();
    }

    throw error;
  }
}

/**
 * Get circuit breaker status
 */
export function getCircuitBreakerStatus(name: string): CircuitBreaker | undefined {
  return circuitBreakers.get(name);
}

/**
 * Reset a circuit breaker manually
 */
export function resetCircuitBreaker(name: string): void {
  const breaker = circuitBreakers.get(name);
  if (breaker) {
    breaker.state = 'closed';
    breaker.failures = 0;
    console.log(`[CircuitBreaker] ${name}: manually reset to closed`);
  }
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        console.warn(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Check if a feature is enabled (considering degraded mode)
 */
export function isFeatureEnabled(feature: keyof RaptorConfig['features']): boolean {
  const config = getEffectiveConfig();
  return config.features[feature];
}

/**
 * Get trading limit for chain
 */
export function getTradingLimit(chain: string): number {
  const config = getEffectiveConfig();

  switch (chain) {
    case 'sol':
      return config.trading.maxPositionSizeSol;
    case 'bsc':
      return config.trading.maxPositionSizeBnb;
    default:
      return config.trading.maxPositionSizeEth;
  }
}

// Load config on module initialization
loadConfigFromEnv();
