/**
 * Correlation ID Middleware
 *
 * Assigns a stable correlation ID to every request so logs, error rows,
 * and Sentry events can be cross-referenced.
 *
 *  - Reads `x-request-id` from the inbound request when present, otherwise
 *    generates a fresh UUID v4.
 *  - Echoes the value back on the response as `x-request-id` so clients
 *    can quote it in support tickets.
 *  - Stores the ID in an AsyncLocalStorage so any code path executed during
 *    the request (including deeply-nested service calls) can read it via
 *    `getCorrelationId()` without threading it through every function.
 *
 *  Registered before `authMiddleware` in `server/index.ts`.
 */
import type { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface CorrelationStore {
  correlationId: string;
  userId?: string;
  organizationId?: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationStore(): CorrelationStore | undefined {
  return correlationStorage.getStore();
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const incoming = req.header("x-request-id");
  const id =
    incoming && /^[A-Za-z0-9._\-:]{6,128}$/.test(incoming)
      ? incoming
      : randomUUID();

  (req as any).id = id;
  (req as any).requestId = id;
  res.setHeader("x-request-id", id);

  correlationStorage.run({ correlationId: id }, () => {
    next();
  });
}
