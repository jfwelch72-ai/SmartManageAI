/**
 * Centralized Logging Utility
 *
 * Provides structured logging with context support for:
 *  - Request correlation (auto-injected via AsyncLocalStorage)
 *  - User/Organization context
 *  - Error tracking integration (Sentry, errorLogService)
 *
 *  This is the ONLY file under `server/` that may use `console.*` directly.
 *  All other server code must use `logDebug/logInfo/logWarn/logError`.
 *  See `scripts/check-no-console.mjs` (regression guard) and
 *  `docs/runbooks/observability.md` for the full story.
 */
import { getCorrelationStore } from "../middleware/correlationId";

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
    const contextStr = entry.context
      ? ` | ${Object.entries(entry.context)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join(' ')}`
      : '';
    const errorStr = entry.error
      ? `\n  Error: ${entry.error.message}${entry.error.stack ? '\n  ' + entry.error.stack : ''}`
      : '';
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}${errorStr}`;
  } else {
    return JSON.stringify(entry);
  }
}

function isPlainContext(v: unknown): v is LogContext {
  if (typeof v !== 'object' || v === null) return false;
  if (Array.isArray(v)) return false;
  if (v instanceof Error) return false;
  // Reject Date, Map, Set, Buffer, etc. by checking the prototype.
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

interface NormalizedArgs {
  message: string;
  context?: LogContext;
  error?: Error;
}

/**
 * Accept both the typed call style — `logX(message, context?, error?)` —
 * and the variadic console-style — `logX("foo", err, { extra: 1 })`.
 *
 * Detection is conservative: if the args match the typed shape exactly we
 * preserve them; otherwise we collapse the arg list to a single message
 * string and pull out the first Error (if any) to feed the error channel.
 */
function normalize(args: unknown[]): NormalizedArgs {
  if (args.length === 0) return { message: '' };

  const [first, second, third] = args;

  // Typed: (string, LogContext?, Error?)
  if (typeof first === 'string') {
    const secondOk = second === undefined || isPlainContext(second);
    const thirdOk = third === undefined || third instanceof Error;
    if (secondOk && thirdOk && args.length <= 3) {
      return {
        message: first,
        context: second as LogContext | undefined,
        error: third as Error | undefined,
      };
    }
  }

  // Console-style fallback.
  const error = args.find((a): a is Error => a instanceof Error);
  const messageParts = args
    .filter((a) => a !== error)
    .map(safeStringify);
  return {
    message: messageParts.join(' ') || (error ? error.message : ''),
    error,
  };
}

let sentryHook: ((entry: LogEntry, error?: Error) => void) | null = null;

/**
 * Wire Sentry (or any other transport) into the logger. Called once from
 * `server/sentry.ts` after Sentry.init runs and only when SENTRY_DSN is set.
 */
export function registerLogTransport(
  hook: (entry: LogEntry, error?: Error) => void,
): void {
  sentryHook = hook;
}

function emit(level: LogLevel, args: unknown[]): void {
  const { message, context: callerContext, error } = normalize(args);

  // Auto-merge AsyncLocalStorage correlation context so handlers don't need
  // to thread requestId / userId through every call.
  const ambient = getCorrelationStore();
  const context: LogContext | undefined =
    ambient || callerContext
      ? {
          ...(ambient
            ? {
                correlationId: ambient.correlationId,
                requestId: ambient.correlationId,
                ...(ambient.userId ? { userId: ambient.userId } : {}),
                ...(ambient.organizationId
                  ? { organizationId: ambient.organizationId }
                  : {}),
              }
            : {}),
          ...(callerContext || {}),
        }
      : undefined;

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
      // eslint-disable-next-line no-console -- logger is the only sanctioned console.* site
      if (isDev) console.debug(formatted);
      break;
    case 'info':
      // eslint-disable-next-line no-console
      console.info(formatted);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(formatted);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(formatted);
      break;
  }

  if (sentryHook && (level === 'error' || level === 'warn')) {
    try {
      sentryHook(entry, error);
    } catch {
      // Never let a transport failure crash the request.
    }
  }
}

export function logDebug(message: string, context?: LogContext): void;
export function logDebug(...args: unknown[]): void;
export function logDebug(...args: unknown[]): void {
  emit('debug', args);
}

export function logInfo(message: string, context?: LogContext): void;
export function logInfo(...args: unknown[]): void;
export function logInfo(...args: unknown[]): void {
  emit('info', args);
}

export function logWarn(message: string, context?: LogContext): void;
export function logWarn(...args: unknown[]): void;
export function logWarn(...args: unknown[]): void {
  emit('warn', args);
}

export function logError(message: string, context?: LogContext, error?: Error): void;
export function logError(...args: unknown[]): void;
export function logError(...args: unknown[]): void {
  emit('error', args);
}

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

export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Run `fn` with `console.log`/`console.error` temporarily intercepted.
 * The interceptor receives every call as a flat string, can decide whether
 * to forward it to the real console, and can stash it for later inspection.
 *
 * This exists so callers (notably `runStartupMigrations`) don't need to
 * touch `console.*` themselves — keeping `server/utils/logger.ts` the only
 * sanctioned `console.*` site under `server/`.
 */
export async function captureConsoleDuring<T>(
  handlers: {
    onLog?: (msg: string, forward: (msg: string) => void) => void;
    onError?: (msg: string, args: unknown[], forward: (...args: unknown[]) => void) => void;
  },
  fn: (originals: { log: (msg: string) => void; error: (...args: unknown[]) => void }) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line no-console
  const originalLog = console.log;
  // eslint-disable-next-line no-console
  const originalError = console.error;
  const forwardLog = (msg: string) => originalLog(msg);
  const forwardError = (...args: unknown[]) => originalError(...args);

  // eslint-disable-next-line no-console
  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (handlers.onLog) handlers.onLog(msg, forwardLog);
    else originalLog(...args);
  };
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (handlers.onError) handlers.onError(msg, args, forwardError);
    else originalError(...args);
  };

  try {
    return await fn({ log: forwardLog, error: forwardError });
  } finally {
    // eslint-disable-next-line no-console
    console.log = originalLog;
    // eslint-disable-next-line no-console
    console.error = originalError;
  }
}

export type { LogContext, LogEntry };
