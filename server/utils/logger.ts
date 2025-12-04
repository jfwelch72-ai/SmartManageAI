/**
 * Centralized Logging Utility
 * 
 * Provides structured logging with context support for:
 * - Request correlation
 * - User/Organization context
 * - Error tracking integration
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  organizationId?: string;
  correlationId?: string;
  requestId?: string;
  method?: string;
  path?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const isDev = process.env.NODE_ENV === 'development';

function formatLog(entry: LogEntry): string {
  if (isDev) {
    // Human-readable format for development
    const contextStr = entry.context 
      ? ` | ${Object.entries(entry.context)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`
      : '';
    const errorStr = entry.error 
      ? `\n  Error: ${entry.error.message}${entry.error.stack ? '\n  ' + entry.error.stack : ''}`
      : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}${errorStr}`;
  } else {
    // JSON format for production (easier to parse by log aggregators)
    return JSON.stringify(entry);
  }
}

function log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  const formatted = formatLog(entry);

  switch (level) {
    case 'debug':
      if (isDev) console.debug(formatted);
      break;
    case 'info':
      console.info(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
  }
}

/**
 * Log debug message (only in development)
 */
export function logDebug(message: string, context?: LogContext): void {
  log('debug', message, context);
}

/**
 * Log info message
 */
export function logInfo(message: string, context?: LogContext): void {
  log('info', message, context);
}

/**
 * Log warning message
 */
export function logWarn(message: string, context?: LogContext): void {
  log('warn', message, context);
}

/**
 * Log error message with optional Error object
 */
export function logError(message: string, context?: LogContext, error?: Error): void {
  log('error', message, context, error);
}

/**
 * Create a logger instance with pre-filled context
 */
export function createLogger(baseContext: LogContext) {
  return {
    debug: (message: string, context?: LogContext) => 
      logDebug(message, { ...baseContext, ...context }),
    info: (message: string, context?: LogContext) => 
      logInfo(message, { ...baseContext, ...context }),
    warn: (message: string, context?: LogContext) => 
      logWarn(message, { ...baseContext, ...context }),
    error: (message: string, context?: LogContext, error?: Error) => 
      logError(message, { ...baseContext, ...context }, error),
  };
}

/**
 * Generate a unique correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export type { LogContext, LogEntry };
