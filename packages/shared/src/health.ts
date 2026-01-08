// Health check utilities for RAPTOR services

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration_ms?: number;
}

export type CheckFunction = () => Promise<HealthCheck>;

// Service health checker
export class HealthChecker {
  private checks: Map<string, CheckFunction> = new Map();
  private startTime: number;
  private version: string;

  constructor(version: string = '1.0.0') {
    this.startTime = Date.now();
    this.version = version;
  }

  /**
   * Register a health check
   */
  addCheck(name: string, check: CheckFunction): void {
    this.checks.set(name, check);
  }

  /**
   * Remove a health check
   */
  removeCheck(name: string): void {
    this.checks.delete(name);
  }

  /**
   * Run all health checks
   */
  async check(): Promise<HealthStatus> {
    const results: HealthCheck[] = [];
    let overallStatus: HealthStatus['status'] = 'healthy';

    for (const [name, checkFn] of this.checks) {
      try {
        const start = Date.now();
        const result = await checkFn();
        result.duration_ms = Date.now() - start;
        results.push(result);

        // Update overall status
        if (result.status === 'fail') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'warn' && overallStatus !== 'unhealthy') {
          overallStatus = 'degraded';
        }
      } catch (error) {
        results.push({
          name,
          status: 'fail',
          message: error instanceof Error ? error.message : 'Check failed',
        });
        overallStatus = 'unhealthy';
      }
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: this.version,
      checks: results,
    };
  }

  /**
   * Quick liveness check (just returns true if process is running)
   */
  isAlive(): boolean {
    return true;
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }
}

// Common health check factories

/**
 * Create a database health check
 */
export function createDatabaseCheck(
  name: string,
  checkFn: () => Promise<boolean>
): CheckFunction {
  return async (): Promise<HealthCheck> => {
    try {
      const healthy = await checkFn();
      return {
        name,
        status: healthy ? 'pass' : 'fail',
        message: healthy ? 'Connected' : 'Connection failed',
      };
    } catch (error) {
      return {
        name,
        status: 'fail',
        message: error instanceof Error ? error.message : 'Check failed',
      };
    }
  };
}

/**
 * Create an RPC health check
 */
export function createRpcCheck(
  name: string,
  checkFn: () => Promise<number | null> // Returns block number or null
): CheckFunction {
  return async (): Promise<HealthCheck> => {
    try {
      const blockNumber = await checkFn();
      if (blockNumber === null) {
        return {
          name,
          status: 'fail',
          message: 'RPC not responding',
        };
      }
      return {
        name,
        status: 'pass',
        message: `Block: ${blockNumber}`,
      };
    } catch (error) {
      return {
        name,
        status: 'fail',
        message: error instanceof Error ? error.message : 'RPC check failed',
      };
    }
  };
}

/**
 * Create a WebSocket health check
 */
export function createWebSocketCheck(
  name: string,
  isConnected: () => boolean
): CheckFunction {
  return async (): Promise<HealthCheck> => {
    const connected = isConnected();
    return {
      name,
      status: connected ? 'pass' : 'warn',
      message: connected ? 'Connected' : 'Disconnected',
    };
  };
}

/**
 * Create a memory usage check
 */
export function createMemoryCheck(
  warnThresholdMb: number = 500,
  failThresholdMb: number = 1000
): CheckFunction {
  return async (): Promise<HealthCheck> => {
    const used = process.memoryUsage();
    const heapUsedMb = Math.round(used.heapUsed / 1024 / 1024);

    let status: HealthCheck['status'] = 'pass';
    if (heapUsedMb > failThresholdMb) {
      status = 'fail';
    } else if (heapUsedMb > warnThresholdMb) {
      status = 'warn';
    }

    return {
      name: 'memory',
      status,
      message: `Heap: ${heapUsedMb}MB`,
    };
  };
}

// Singleton instance for convenience
export const healthChecker = new HealthChecker();
