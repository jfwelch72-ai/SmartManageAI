// Task #2478 — Tenant isolation hardening with Postgres RLS.
//
// Express middleware that wraps EVERY authenticated request in a
// `withOrgContext()` so all `db` calls during the request execute
// against a pg client whose `app.current_org_id` session variable
// drives the row-level-security policies.
//
// Registration order in `server/index.ts`:
//   correlationIdMiddleware -> authMiddleware -> requireActiveOrganization
//   -> orgContextMiddleware -> route handlers
//
// Authenticated requests are NEVER auto-elevated to super-admin from this
// middleware — even SUPER_ADMIN sessions land in a non-elevated context
// scoped to their own org (or a fail-closed null-org context if they
// don't have one). Cross-tenant reads/writes for platform admin work
// MUST go through `runAsSuperadmin(reason, …)` so each elevation gets
// an entry in `superadmin_access_log`.
//
// Unauthenticated requests (login page, public webhooks, the few open
// portal endpoints) skip RLS context entirely. They run on a fresh pool
// connection whose default is governed by `STRICT_TENANT_RLS`.

import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { withOrgContext } from "../dbContext";
import { logError } from "../utils/logger";

// Long-lived streaming endpoints (Server-Sent Events) MUST NOT pin a pg
// pool client for the lifetime of the response — under moderate load
// they would exhaust the pool (max 60). These handlers either issue no
// DB queries during the stream (in-memory bus fan-out) or wrap their
// own per-query `withOrgContext`. Listed paths are matched as exact
// prefixes against `req.path`.
const SSE_BYPASS_PATHS: ReadonlyArray<string> = [
  "/api/messaging/events",
  "/api/admin/dev/email-outbox/stream",
  "/client-portal/chat/events",
  "/portal/chat/events",
];

function isSseBypass(path: string): boolean {
  for (const p of SSE_BYPASS_PATHS) {
    if (path === p) return true;
  }
  return false;
}

export function orgContextMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const user = req.user;
  if (!user) {
    next();
    return;
  }

  // SSE / long-poll endpoints bypass per-request context wrapping to
  // avoid permanently pinning a pg pool client. Their handlers must
  // wrap any DB query in `withOrgContext(...)` themselves.
  if (isSseBypass(req.path)) {
    next();
    return;
  }

  // ALWAYS wrap authenticated traffic. No-org users (mid-onboarding,
  // platform-only super-admins) get a context with `organizationId: null`
  // and `isSuperadmin: false`, which means RLS filters every org-scoped
  // table to zero rows — fail-closed by construction.
  const organizationId = user.organizationId ?? null;

  withOrgContext(
    {
      organizationId,
      isSuperadmin: false,
      source: `req:${req.method} ${req.path}`,
    },
    () =>
      new Promise<void>((resolve) => {
        // We resolve the Promise (and therefore release the pg client)
        // when the response finishes, not when next() returns — Express
        // middleware is synchronous-by-convention but the actual route
        // handler runs asynchronously after next() unwinds.
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        res.on("finish", settle);
        res.on("close", settle);
        next();
      }),
  ).catch((err) => {
    logError("[orgContextMiddleware] withOrgContext rejected", {}, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
