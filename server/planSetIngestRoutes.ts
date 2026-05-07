// Task #2576 — HTTP wrapper that enqueues a plan-set ingest job.
//
// The legacy synchronous endpoints in `takeoffSheetRoutes.ts` are
// preserved for small plan sets; this route lets the client opt into
// the background path explicitly so a 32 GB / 5,000-page plan no
// longer holds the request open. Returns a `jobId` immediately.

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { bids } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { enqueueJob } from "./jobQueue";
import { logAudit } from "./auditLogger";

const router = Router();

const enqueueSchema = z.object({
  bidId: z.string().min(1),
  bidDocumentId: z.string().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  objectKey: z.string().optional(),
  baseSheetName: z.string().optional(),
});

router.post(
  "/api/takeoff/plan-set-ingest/enqueue",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = enqueueSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const [bid] = await db
        .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
        .from(bids)
        .where(eq(bids.id, parsed.data.bidId))
        .limit(1);
      if (!bid || bid.gcOrganizationId !== orgId) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!parsed.data.bidDocumentId && !(parsed.data.fileUrl && parsed.data.fileName)) {
        return res.status(400).json({ error: "Provide bidDocumentId or fileUrl+fileName" });
      }

      const enqueueResult = await enqueueJob(
        "plan_set_ingest",
        {
          organizationId: orgId,
          userId: req.user!.id,
          bidId: parsed.data.bidId,
          bidDocumentId: parsed.data.bidDocumentId,
          fileUrl: parsed.data.fileUrl,
          fileName: parsed.data.fileName,
          objectKey: parsed.data.objectKey,
          baseSheetName: parsed.data.baseSheetName,
        },
        { organizationId: orgId, userId: req.user!.id },
      );
      const jobId = enqueueResult.jobId;

      try {
        await logAudit(
          {
            userId: req.user!.id,
            entityType: "plan_set_ingest_job",
            entityId: jobId,
            action: "CREATE",
            oldValue: null,
            newValue: JSON.stringify({ bidId: parsed.data.bidId, bidDocumentId: parsed.data.bidDocumentId ?? null }),
          },
          req,
        );
      } catch {
        /* best-effort */
      }

      res.status(202).json({ jobId, deduplicated: enqueueResult.deduplicated, status: "queued" });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
