// Structured logging for RAPTOR services
// Uses Winston with JSON formatting for production

import winston from 'winston';

const { combine, timestamp, json, printf, colorize, errors } = winston.format;

// Log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Determine log level based on environment
const level = (): string => {
  const env = process.env.NODE_ENV || 'development';
  const logLevel = process.env.LOG_LEVEL;
  if (logLevel) return logLevel;
  return env === 'development' ? 'debug' : 'info';
};

// Custom format for development (colored, readable)
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const serviceStr = service ? `[${service}] ` : '';
    return `${timestamp} ${level}: ${serviceStr}${message}${metaStr}`;
  })
);

// JSON format for production (structured, machine-readable)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// Create base logger configuration
const createLogger = (service: string): winston.Logger => {
  const isProduction = process.env.NODE_ENV === 'production';

  return winston.createLogger({
    level: level(),
    levels,
    defaultMeta: { service },
    format: isProduction ? prodFormat : devFormat,
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error'],
      }),
    ],
    // Don't exit on uncaught errors
    exitOnError: false,
  });
};

// Pre-configured loggers for each service
export const botLogger = createLogger('bot');
export const apiLogger = createLogger('api');
export const executorLogger = createLogger('executor');

// Generic logger factory for custom services
export const getLogger = (service: string): winston.Logger => {
  return createLogger(service);
};

// Child logger for sub-components
export const createChildLogger = (
  parent: winston.Logger,
  component: string
): winston.Logger => {
  return parent.child({ component });
};

// Typed log context for common operations
export interface TradeLogContext {
  chain: string;
  token: string;
  symbol?: string;
  amount?: string;
  txHash?: string;
  userId?: number;
  positionId?: number;
}

export interface ErrorLogContext {
  error: Error | string;
  chain?: string;
  operation?: string;
  userId?: number;
}

// Convenience logging methods with typed context
export const logTrade = (
  logger: winston.Logger,
  message: string,
  context: TradeLogContext
): void => {
  logger.info(message, context);
};

export const logError = (
  logger: winston.Logger,
  message: string,
  context: ErrorLogContext
): void => {
  const errorMessage =
    context.error instanceof Error ? context.error.message : context.error;
  const stack = context.error instanceof Error ? context.error.stack : undefined;

  logger.error(message, {
    ...context,
    error: errorMessage,
    stack,
  });
};

// Performance logging
export const logPerformance = (
  logger: winston.Logger,
  operation: string,
  durationMs: number,
  meta?: Record<string, unknown>
): void => {
  logger.info(`${operation} completed`, {
    duration_ms: durationMs,
    ...meta,
  });
};

// Timer utility for performance logging
export const startTimer = (): (() => number) => {
  const start = Date.now();
  return () => Date.now() - start;
};

// Default export for convenience
export default {
  bot: botLogger,
  api: apiLogger,
  executor: executorLogger,
  getLogger,
  createChildLogger,
  logTrade,
  logError,
  logPerformance,
  startTimer,
};
