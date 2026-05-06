/**
 * Sentry initialization (browser).
 *
 * No-op when VITE_SENTRY_DSN is unset, so dev/preview builds never reach
 * out to Sentry. See `docs/runbooks/observability.md` for triage steps.
 */
import * as Sentry from "@sentry/browser";

let initialized = false;

const PII_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "authorization",
  "cookie",
]);

function scrub<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PII_KEYS.has(k) || PII_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out as T;
}

export function initBrowserSentry(): boolean {
  if (initialized) return true;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined) || undefined,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.data) event.request.data = scrub(event.request.data);
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      if (event.extra) event.extra = scrub(event.extra);
      return event;
    },
  });

  initialized = true;
  return true;
}

export { Sentry };
