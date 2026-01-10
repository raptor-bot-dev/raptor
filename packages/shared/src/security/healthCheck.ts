/**
 * Health Check Service for RAPTOR v2.3.1
 *
 * SECURITY: M-004 - Monitor external service health
 * - RPC endpoint health
 * - API service availability
 * - Database connectivity
 * - Graceful degradation triggers
 */

import { supabase } from '../supabase.js';

/**
 * Service health status
 */
export type ServiceHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Service health result
 */
export interface ServiceHealth {
  name: string;
  status: ServiceHealthStatus;
  latencyMs?: number;
  lastCheck: number;
  lastError?: string;
  consecutiveFailures: number;
}

/**
 * Health check configuration
 */
interface HealthCheckConfig {
  name: string;
  check: () => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  intervalMs: number;
  timeoutMs: number;
  failureThreshold: number; // Consecutive failures before unhealthy
  degradedThreshold: number; // Latency threshold for degraded status
}

/**
 * Service health state
 */
const serviceHealth = new Map<string, ServiceHealth>();
const healthChecks = new Map<string, NodeJS.Timeout>();

/**
 * Register a health check for a service
 */
export function registerHealthCheck(config: HealthCheckConfig): void {
  // Initialize health state
  serviceHealth.set(config.name, {
    name: config.name,
    status: 'unknown',
    lastCheck: 0,
    consecutiveFailures: 0,
  });

  // Run check immediately
  runHealthCheck(config);

  // Schedule periodic checks
  const intervalId = setInterval(() => {
    runHealthCheck(config);
  }, config.intervalMs);

  healthChecks.set(config.name, intervalId);
}

/**
 * Run a single health check
 */
async function runHealthCheck(config: HealthCheckConfig): Promise<void> {
  const { name, check, timeoutMs, failureThreshold, degradedThreshold } = config;

  const health = serviceHealth.get(name)!;
  const startTime = Date.now();

  try {
    // Execute check with timeout
    const result = await Promise.race([
      check(),
      new Promise<{ ok: false; latencyMs: number; error: string }>((resolve) =>
        setTimeout(() => resolve({
          ok: false,
          latencyMs: timeoutMs,
          error: 'Health check timeout',
        }), timeoutMs)
      ),
    ]);

    health.lastCheck = Date.now();
    health.latencyMs = result.latencyMs;

    if (result.ok) {
      health.consecutiveFailures = 0;
      health.lastError = undefined;

      // Check for degraded (high latency)
      if (result.latencyMs > degradedThreshold) {
        health.status = 'degraded';
      } else {
        health.status = 'healthy';
      }
    } else {
      health.consecutiveFailures++;
      health.lastError = result.error;

      if (health.consecutiveFailures >= failureThreshold) {
        health.status = 'unhealthy';
      } else {
        health.status = 'degraded';
      }
    }
  } catch (error) {
    health.lastCheck = Date.now();
    health.latencyMs = Date.now() - startTime;
    health.consecutiveFailures++;
    health.lastError = error instanceof Error ? error.message : 'Unknown error';

    if (health.consecutiveFailures >= failureThreshold) {
      health.status = 'unhealthy';
    } else {
      health.status = 'degraded';
    }
  }

  // Log status changes
  if (health.status === 'unhealthy') {
    console.error(`[HealthCheck] ${name} is UNHEALTHY: ${health.lastError}`);
  } else if (health.status === 'degraded') {
    console.warn(`[HealthCheck] ${name} is DEGRADED: ${health.latencyMs}ms`);
  }
}

/**
 * Get health status for a service
 */
export function getServiceHealth(name: string): ServiceHealth | undefined {
  return serviceHealth.get(name);
}

/**
 * Get all service health statuses
 */
export function getAllServiceHealth(): ServiceHealth[] {
  return Array.from(serviceHealth.values());
}

/**
 * Check if a service is available (healthy or degraded)
 */
export function isServiceAvailable(name: string): boolean {
  const health = serviceHealth.get(name);
  return health?.status === 'healthy' || health?.status === 'degraded';
}

/**
 * Check if system is in degraded mode
 */
export function isSystemDegraded(): boolean {
  for (const health of serviceHealth.values()) {
    if (health.status === 'unhealthy') {
      return true;
    }
  }
  return false;
}

/**
 * Unregister a health check
 */
export function unregisterHealthCheck(name: string): void {
  const intervalId = healthChecks.get(name);
  if (intervalId) {
    clearInterval(intervalId);
    healthChecks.delete(name);
  }
  serviceHealth.delete(name);
}

/**
 * Pre-built health check: Database
 */
export function createDatabaseHealthCheck(): HealthCheckConfig {
  return {
    name: 'database',
    intervalMs: 30000, // 30 seconds
    timeoutMs: 5000,   // 5 second timeout
    failureThreshold: 3,
    degradedThreshold: 1000, // 1 second latency = degraded
    check: async () => {
      const start = Date.now();
      try {
        const { error } = await supabase
          .from('user_settings')
          .select('count')
          .limit(1);

        return {
          ok: !error,
          latencyMs: Date.now() - start,
          error: error?.message,
        };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  };
}

/**
 * Pre-built health check: RPC endpoint
 */
export function createRpcHealthCheck(
  name: string,
  rpcUrl: string,
  chain: 'evm' | 'solana'
): HealthCheckConfig {
  return {
    name,
    intervalMs: 15000, // 15 seconds
    timeoutMs: 5000,
    failureThreshold: 3,
    degradedThreshold: 500, // 500ms latency = degraded
    check: async () => {
      const start = Date.now();
      try {
        const method = chain === 'solana' ? 'getHealth' : 'eth_blockNumber';
        const params = chain === 'solana' ? [] : [];

        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
          }),
        });

        const data = await response.json() as { error?: { message?: string }; result?: unknown };
        const latencyMs = Date.now() - start;

        return {
          ok: !data.error && response.ok,
          latencyMs,
          error: data.error?.message,
        };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  };
}

/**
 * Pre-built health check: External API
 */
export function createApiHealthCheck(
  name: string,
  url: string,
  expectedStatus: number = 200
): HealthCheckConfig {
  return {
    name,
    intervalMs: 60000, // 1 minute
    timeoutMs: 10000,
    failureThreshold: 2,
    degradedThreshold: 2000, // 2 second latency = degraded
    check: async () => {
      const start = Date.now();
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'RAPTOR-HealthCheck/1.0' },
        });

        return {
          ok: response.status === expectedStatus,
          latencyMs: Date.now() - start,
          error: response.status !== expectedStatus
            ? `Unexpected status: ${response.status}`
            : undefined,
        };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  };
}

/**
 * Get overall system health summary
 */
export function getSystemHealthSummary(): {
  overall: ServiceHealthStatus;
  services: ServiceHealth[];
  unhealthyCount: number;
  degradedCount: number;
} {
  const services = getAllServiceHealth();
  let unhealthyCount = 0;
  let degradedCount = 0;

  for (const service of services) {
    if (service.status === 'unhealthy') {
      unhealthyCount++;
    } else if (service.status === 'degraded') {
      degradedCount++;
    }
  }

  let overall: ServiceHealthStatus;
  if (unhealthyCount > 0) {
    overall = 'unhealthy';
  } else if (degradedCount > 0) {
    overall = 'degraded';
  } else if (services.length === 0) {
    overall = 'unknown';
  } else {
    overall = 'healthy';
  }

  return {
    overall,
    services,
    unhealthyCount,
    degradedCount,
  };
}
