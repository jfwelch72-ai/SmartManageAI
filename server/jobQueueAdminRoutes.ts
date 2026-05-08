// Task #2481 — Super Admin REST surface for the background job queue:
// queue depth, dead-letter inspection, retry, and a per-job status
// lookup that the frontend uses to drive progress.

import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import {
  enqueueJob,
  getBoss,
  getJobStatus,
  getQueueDepths,
  listDeadLetterJobs,
  retryDeadLetterJob,
  type JobName,
} from "./jobQueue";
import { logError, logWarn } from "./utils/logger";

const router = Router();

// Task #2583 — List recent background jobs for the current user so the
// nav-bar "Background activity" tray can show everything in flight, not
// just the per-bid plan-set ingest. Filters strictly by userId in the
// pg-boss job payload, then enforces tenant scoping on top.
router.get(
  "/jobs/mine",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const orgId = req.user?.organizationId ?? null;
      const isSuper = req.user?.role === "SUPER_ADMIN";
      const limit = Math.min(Number(req.query.limit) || 25, 100);
      const dbi = await getBoss().getDb();
      const schema = process.env.PGBOSS_SCHEMA || "pgboss";
      // Active or recently terminal (last 24h) jobs owned by this user.
      // Cross-tenant safety: SUPER_ADMIN sees their own; other users
      // additionally constrained to their org.
      const params: unknown[] = [userId];
      let orgClause = "";
      if (!isSuper && orgId) {
        params.push(orgId);
        orgClause = ` AND COALESCE(data->>'organizationId', '') = $${params.length}`;
      }
      params.push(limit);
      // pg-boss 10 stores its queue in snake_case columns
      // (retry_count / created_on / started_on / completed_on);
      // older versions used the camelCase variants. This route was
      // written against the legacy names which silently 500'd on
      // pg-boss 10.x because Postgres threw "column does not exist".
      const result = await dbi.executeSql(
        `SELECT id, name, state, data, output, retry_count, created_on, started_on, completed_on
           FROM ${schema}.job
          WHERE data->>'userId' = $1${orgClause}
            AND (
              state IN ('created','active','retry')
              OR completed_on > NOW() - INTERVAL '24 hours'
            )
          ORDER BY created_on DESC
          LIMIT $${params.length}`,
        params,
      );
      const rows = (result?.rows ?? []) as Array<Record<string, unknown>>;
      const items = rows.map((r) => {
        const data = (r.data ?? {}) as { payload?: unknown; idempotencyKey?: string };
        return {
          id: String(r.id),
          name: String(r.name ?? ""),
          state: String(r.state ?? ""),
          retryCount: Number(r.retry_count ?? 0),
          createdOn: r.created_on ?? null,
          startedOn: r.started_on ?? null,
          completedOn: r.completed_on ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
        };
      });
      res.json({ items });
    } catch (err) {
      logWarn("List my jobs failed", { error: String(err) });
      next(err);
    }
  },
);

// Task #2583 — User-scoped retry: re-enqueues a failed/expired/cancelled
// job that belongs to the caller. Differs from the SUPER_ADMIN DLQ retry
// in that it tenant-checks the underlying job before re-enqueueing.
router.post(
  "/jobs/:id/retry",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const status = await getJobStatus(req.params.id);
      if (!status) return res.status(404).json({ error: "Job not found" });
      const data = (status.data ?? {}) as {
        organizationId?: string | null;
        userId?: string | null;
        payload?: unknown;
        idempotencyKey?: string;
      };
      const isSuper = req.user?.role === "SUPER_ADMIN";
      if (!isSuper) {
        // Strict ownership: the job's payload MUST identify this user
        // and this org. Missing metadata is a deny — we don't grant
        // retry on jobs whose ownership we can't positively prove.
        if (!data.userId || data.userId !== userId) {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (
          !data.organizationId ||
          !req.user?.organizationId ||
          data.organizationId !== req.user.organizationId
        ) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }
      if (!["failed", "expired", "cancelled"].includes(status.state)) {
        return res
          .status(409)
          .json({ error: `Job is ${status.state}, only failed/expired/cancelled jobs can be retried` });
      }
      const result = await enqueueJob(status.name as JobName, data.payload, {
        organizationId: data.organizationId ?? null,
        userId: data.userId ?? userId,
        idempotencyKey: `${data.idempotencyKey ?? status.id}:retry:${Date.now()}`,
      });
      res.json(result);
    } catch (err) {
      logError(
        "User retry job failed",
        { id: req.params.id },
        err instanceof Error ? err : new Error(String(err)),
      );
      next(err);
    }
  },
);

// Authenticated job status — used by the frontend to poll a job they
// kicked off. Tenant scoping: only allow if the job's payload matches
// the caller's org (or caller is SUPER_ADMIN).
router.get(
  "/jobs/:id",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const status = await getJobStatus(req.params.id);
      if (!status) return res.status(404).json({ error: "Job not found" });
      const data = (status.data ?? {}) as { organizationId?: string | null; userId?: string | null };
      const isSuper = req.user?.role === "SUPER_ADMIN";
      if (!isSuper) {
        if (data.organizationId && data.organizationId !== req.user?.organizationId) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }
      res.json({
        id: status.id,
        name: status.name,
        state: status.state,
        retryCount: status.retryCount,
        createdOn: status.createdOn,
        startedOn: status.startedOn,
        completedOn: status.completedOn,
        output: status.output,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Super Admin only — queue depth, DLQ list, retry.
router.get(
  "/admin/job-queue/depths",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const depths = await getQueueDepths();
      res.json({ depths });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/admin/job-queue/dead-letter",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const items = await listDeadLetterJobs(limit);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/admin/job-queue/dead-letter/:id/retry",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await retryDeadLetterJob(req.params.id);
      if (!result) return res.status(404).json({ error: "Job not found" });
      res.json(result);
    } catch (err) {
      logError("Retry DLQ job failed", { id: req.params.id }, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

export default router;
