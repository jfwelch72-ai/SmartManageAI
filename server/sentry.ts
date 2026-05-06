/**
 * Sentry initialization (server-side).
 *
 * No-op when SENTRY_DSN is unset, so dev/CI never reach out to Sentry.
 * When set, captures unhandled errors that flow through the central
 * Express error middleware as well as warn/error logger calls.
 *
 * See `docs/runbooks/observability.md` for usage and triage steps.
 */
import * as Sentry from "@sentry/node";
import type { Request } from "express";
import { registerLogTransport } from "./utils/logger";

let initialized = false;

const PII_KEYS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "secret",
  "apiKey",
  "api_key",
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

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.data) {
        event.request.data = scrub(event.request.data);
      }
      if (event.request?.headers) {
        event.request.headers = scrub(event.request.headers) as Record<
          string,
          string
        >;
      }
      if (event.extra) {
        event.extra = scrub(event.extra);
      }
      if (event.user) {
        // Drop email/ip — keep only the opaque user id.
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }
      return event;
    },
  });

  registerLogTransport((entry, error) => {
    if (error) {
      Sentry.captureException(error, {
        level: entry.level === "warn" ? "warning" : "error",
        tags: entry.context?.correlationId
          ? { correlationId: String(entry.context.correlationId) }
          : undefined,
        extra: entry.context as Record<string, unknown> | undefined,
      });
    } else {
      Sentry.captureMessage(entry.message, {
        level: entry.level === "warn" ? "warning" : "error",
        tags: entry.context?.correlationId
          ? { correlationId: String(entry.context.correlationId) }
          : undefined,
        extra: entry.context as Record<string, unknown> | undefined,
      });
    }
  });

  initialized = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export function captureRequestException(err: unknown, req: Request, requestId?: string) {
  if (!initialized) return;
  const authUser = (req as any).user;
  Sentry.withScope((scope) => {
    if (requestId) scope.setTag("correlationId", requestId);
    scope.setTag("method", req.method);
    scope.setTag("path", req.path);
    if (authUser?.id) scope.setUser({ id: authUser.id });
    if (authUser?.organizationId) scope.setTag("organizationId", authUser.organizationId);
    Sentry.captureException(err);
  });
}

export { Sentry };
