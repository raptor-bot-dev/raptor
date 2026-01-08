// Monitoring and error tracking for RAPTOR services
// Uses Sentry for error tracking and custom metrics

import * as Sentry from '@sentry/node';

// Service names
export type ServiceName = 'bot' | 'api' | 'executor';

// Metrics types
export interface MetricTags {
  chain?: string;
  token?: string;
  operation?: string;
  status?: 'success' | 'failure';
  [key: string]: string | undefined;
}

// Initialize Sentry for a service
export function initMonitoring(service: ServiceName): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.log(`[Monitoring] Sentry DSN not configured for ${service}`);
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || '1.0.0',
    serverName: service,

    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Capture unhandled rejections
    integrations: [
      new Sentry.Integrations.OnUncaughtException(),
      new Sentry.Integrations.OnUnhandledRejection(),
    ],

    // Filter sensitive data
    beforeSend(event) {
      // Remove sensitive data from errors
      if (event.extra) {
        delete event.extra['privateKey'];
        delete event.extra['PRIVATE_KEY'];
        delete event.extra['secret'];
      }
      return event;
    },
  });

  // Set service tag
  Sentry.setTag('service', service);

  console.log(`[Monitoring] Sentry initialized for ${service}`);
}

// Capture an error with context
export function captureError(
  error: Error | string,
  context?: {
    service?: ServiceName;
    operation?: string;
    chain?: string;
    userId?: number;
    extra?: Record<string, unknown>;
  }
): void {
  const errorObj = error instanceof Error ? error : new Error(error);

  Sentry.withScope((scope) => {
    if (context?.service) {
      scope.setTag('service', context.service);
    }
    if (context?.operation) {
      scope.setTag('operation', context.operation);
    }
    if (context?.chain) {
      scope.setTag('chain', context.chain);
    }
    if (context?.userId) {
      scope.setUser({ id: context.userId.toString() });
    }
    if (context?.extra) {
      scope.setExtras(context.extra);
    }

    Sentry.captureException(errorObj);
  });
}

// Capture a message
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>
): void {
  Sentry.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    Sentry.captureMessage(message, level);
  });
}

// Start a transaction for performance monitoring
export function startTransaction(
  name: string,
  operation: string
): Sentry.Transaction {
  return Sentry.startTransaction({
    name,
    op: operation,
  });
}

// Simple metrics tracking (in-memory, can be extended to external service)
class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  // Increment a counter
  increment(name: string, value: number = 1, tags?: MetricTags): void {
    const key = this.buildKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  // Set a gauge value
  gauge(name: string, value: number, tags?: MetricTags): void {
    const key = this.buildKey(name, tags);
    this.gauges.set(key, value);
  }

  // Record a histogram value
  histogram(name: string, value: number, tags?: MetricTags): void {
    const key = this.buildKey(name, tags);
    const values = this.histograms.get(key) || [];
    values.push(value);
    // Keep last 1000 values
    if (values.length > 1000) {
      values.shift();
    }
    this.histograms.set(key, values);
  }

  // Get all metrics for reporting
  getMetrics(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; avg: number; p95: number }>;
  } {
    const histogramStats: Record<string, { count: number; avg: number; p95: number }> = {};

    for (const [key, values] of this.histograms) {
      if (values.length === 0) continue;

      const sorted = [...values].sort((a, b) => a - b);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const p95Index = Math.floor(sorted.length * 0.95);

      histogramStats[key] = {
        count: values.length,
        avg: Math.round(avg * 100) / 100,
        p95: sorted[p95Index] || sorted[sorted.length - 1],
      };
    }

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats,
    };
  }

  // Reset all metrics
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private buildKey(name: string, tags?: MetricTags): string {
    if (!tags) return name;
    const tagStr = Object.entries(tags)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
    return tagStr ? `${name}{${tagStr}}` : name;
  }
}

// Singleton metrics collector
export const metrics = new MetricsCollector();

// Convenience functions for common metrics
export function trackTrade(
  chain: string,
  type: 'buy' | 'sell',
  success: boolean,
  durationMs: number
): void {
  metrics.increment('trades_total', 1, { chain, type, status: success ? 'success' : 'failure' });
  metrics.histogram('trade_duration_ms', durationMs, { chain, type });
}

export function trackPosition(
  chain: string,
  action: 'open' | 'close',
  pnlPercent?: number
): void {
  metrics.increment('positions_total', 1, { chain, action });
  if (pnlPercent !== undefined) {
    metrics.histogram('position_pnl_percent', pnlPercent, { chain });
  }
}

export function trackRpcCall(
  chain: string,
  method: string,
  durationMs: number,
  success: boolean
): void {
  metrics.increment('rpc_calls_total', 1, { chain, method, status: success ? 'success' : 'failure' });
  metrics.histogram('rpc_duration_ms', durationMs, { chain, method });
}

// Flush Sentry and wait for it to complete
export async function flushMonitoring(timeout: number = 2000): Promise<void> {
  await Sentry.flush(timeout);
}
