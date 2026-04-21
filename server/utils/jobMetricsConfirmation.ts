/**
 * Task #717: confirmation guard for the destructive
 * `DELETE /api/admin/metrics/jobs[/:jobName]` endpoints.
 *
 * Without an explicit confirmation token, a misclick or a stale `curl`
 * sitting in someone's terminal history could permanently wipe persisted
 * job metric trend data with no recovery. We require either a query
 * string or a JSON body field that matches an expected token before
 * allowing the request through. The check is intentionally case- and
 * whitespace-sensitive so it cannot be satisfied accidentally.
 *
 *   DELETE /api/admin/metrics/jobs              ?confirm=all
 *   DELETE /api/admin/metrics/jobs/:jobName     ?confirm=<jobName>
 *
 * Either form may also be supplied as `{ "confirm": "..." }` in the
 * JSON request body so it remains scriptable from places where building
 * a query string is awkward.
 */

import type { Request, Response, NextFunction } from "express";

export const CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN = "all";

function readConfirmToken(req: Request): string | undefined {
  const fromQuery = req.query?.confirm;
  if (typeof fromQuery === "string" && fromQuery.length > 0) {
    return fromQuery;
  }
  const fromBody = (req.body as { confirm?: unknown } | undefined)?.confirm;
  if (typeof fromBody === "string" && fromBody.length > 0) {
    return fromBody;
  }
  return undefined;
}

export interface JobMetricsConfirmationFailure {
  error: string;
  expected: string;
  hint: string;
}

export function buildConfirmationFailure(expected: string): JobMetricsConfirmationFailure {
  const hint =
    expected === CLEAR_ALL_JOB_METRICS_CONFIRM_TOKEN
      ? "Pass ?confirm=all (or { \"confirm\": \"all\" }) to wipe every persisted job metric sample."
      : `Pass ?confirm=${expected} (or { "confirm": "${expected}" }) to wipe persisted samples for this job.`;
  return {
    error: "Confirmation required to clear job metric history.",
    expected,
    hint,
  };
}

export function requireJobMetricsClearConfirmation(
  expectedFromReq: string | ((req: Request) => string),
) {
  return function confirmationMiddleware(req: Request, res: Response, next: NextFunction): void {
    const expected = typeof expectedFromReq === "function" ? expectedFromReq(req) : expectedFromReq;
    const token = readConfirmToken(req);
    if (token !== expected) {
      res.status(400).json(buildConfirmationFailure(expected));
      return;
    }
    next();
  };
}
