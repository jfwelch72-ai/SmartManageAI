// Task #2481 — Super Admin REST surface for the background job queue:
// queue depth, dead-letter inspection, retry, and a per-job status
// lookup that the frontend uses to drive progress.

import { Router, type Response, type NextFunction } from "express";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import {
  getJobStatus,
  getQueueDepths,
  listDeadLetterJobs,
  retryDeadLetterJob,
} from "./jobQueue";
import { logError } from "./utils/logger";

const router = Router();

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
