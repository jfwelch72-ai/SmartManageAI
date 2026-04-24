/**
 * Task #1578 — platform-support incident reviews.
 *
 * Lightweight CRUD for the new `platform_incident_reviews` /
 * `platform_incident_review_attachments` tables (see
 * `shared/schema/operations.ts`). The "Attach to incident review" action
 * on the Recent alert failures card depends on the list/create endpoints
 * to pick (or spin up) a review before streaming the CSV in.
 *
 * Authorization: every endpoint is restricted to SUPER_ADMINs at the route
 * layer, mirroring the gating of the CSV download branch they back. Org-
 * scoped admins never see the action in the UI and would be 403'd here
 * regardless.
 *
 * Endpoints
 *   - GET  /api/platform-support/incident-reviews                      — list
 *   - POST /api/platform-support/incident-reviews                      — create
 *   - GET  /api/platform-support/incident-reviews/:id                  — detail
 *   - GET  /api/platform-support/incident-reviews/:id/attachments      — list attachments
 *   - GET  /api/platform-support/incident-reviews/:id/attachments/:aid/download
 *                                                                       — stream attachment bytes
 */
import { Router, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "./db";
import {
  platformIncidentReviews,
  platformIncidentReviewAttachments,
  users,
} from "@shared/schema";
import {
  requireAuth,
  requireRole,
  type AuthRequest,
} from "./auth";
import { isSuperAdmin } from "./orgFilter";
import { logAudit } from "./auditLogger";
import { logError } from "./utils/logger";
import { objectStorageClient, parseObjectPath } from "./objectStorage";

const router = Router();

const createReviewSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  summary: z.string().trim().max(5_000).optional(),
  status: z
    .enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"])
    .optional()
    .default("OPEN"),
});

function ensureSuperAdminOr403(req: AuthRequest, res: Response): boolean {
  if (!isSuperAdmin(req.user)) {
    res
      .status(403)
      .json({ error: "Incident reviews are restricted to super admins" });
    return false;
  }
  return true;
}

router.get(
  "/api/platform-support/incident-reviews",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      if (!ensureSuperAdminOr403(req, res)) return;
      // Default page size is intentionally small — the UI just needs a
      // recent-reviews picker, not a full audit table. Status filter is
      // optional (so support can hide already-closed reviews from the
      // dropdown).
      const status =
        typeof req.query.status === "string" && req.query.status.length > 0
          ? String(req.query.status)
          : null;
      const baseQuery = db
        .select({
          id: platformIncidentReviews.id,
          title: platformIncidentReviews.title,
          summary: platformIncidentReviews.summary,
          status: platformIncidentReviews.status,
          createdById: platformIncidentReviews.createdById,
          createdAt: platformIncidentReviews.createdAt,
          updatedAt: platformIncidentReviews.updatedAt,
          createdByEmail: users.email,
          attachmentCount: sql<number>`(SELECT COUNT(*)::int FROM ${platformIncidentReviewAttachments} WHERE ${platformIncidentReviewAttachments.reviewId} = ${platformIncidentReviews.id})`,
        })
        .from(platformIncidentReviews)
        .leftJoin(users, eq(users.id, platformIncidentReviews.createdById))
        .orderBy(desc(platformIncidentReviews.updatedAt))
        .limit(50);
      const rows = status
        ? await baseQuery.where(eq(platformIncidentReviews.status, status))
        : await baseQuery;
      res.json({ reviews: rows });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/api/platform-support/incident-reviews",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      if (!ensureSuperAdminOr403(req, res)) return;
      const parsed = createReviewSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const [row] = await db
        .insert(platformIncidentReviews)
        .values({
          title: parsed.data.title,
          summary: parsed.data.summary || null,
          status: parsed.data.status,
          createdById: req.user?.id ?? null,
        })
        .returning();

      res.status(201).json({ review: row });

      try {
        await logAudit(
          {
            userId: req.user!.id,
            action: "CREATE",
            entityType: "platform_incident_review",
            entityId: row.id,
            newValue: JSON.stringify({
              title: row.title,
              status: row.status,
            }),
          },
          req,
        );
      } catch {
        /* logAudit swallows DB errors */
      }
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/platform-support/incident-reviews/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      if (!ensureSuperAdminOr403(req, res)) return;
      const id = String(req.params.id || "").trim();
      const [row] = await db
        .select()
        .from(platformIncidentReviews)
        .where(eq(platformIncidentReviews.id, id))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ review: row });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/platform-support/incident-reviews/:id/attachments",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      if (!ensureSuperAdminOr403(req, res)) return;
      const id = String(req.params.id || "").trim();
      const [review] = await db
        .select({ id: platformIncidentReviews.id })
        .from(platformIncidentReviews)
        .where(eq(platformIncidentReviews.id, id))
        .limit(1);
      if (!review) return res.status(404).json({ error: "Not found" });

      const rows = await db
        .select({
          id: platformIncidentReviewAttachments.id,
          reviewId: platformIncidentReviewAttachments.reviewId,
          source: platformIncidentReviewAttachments.source,
          dataset: platformIncidentReviewAttachments.dataset,
          windowHours: platformIncidentReviewAttachments.windowHours,
          fileName: platformIncidentReviewAttachments.fileName,
          fileSize: platformIncidentReviewAttachments.fileSize,
          orgRowCount: platformIncidentReviewAttachments.orgRowCount,
          sampleRowCount: platformIncidentReviewAttachments.sampleRowCount,
          attachedById: platformIncidentReviewAttachments.attachedById,
          attachedAt: platformIncidentReviewAttachments.attachedAt,
          attachedByEmail: users.email,
        })
        .from(platformIncidentReviewAttachments)
        .leftJoin(
          users,
          eq(users.id, platformIncidentReviewAttachments.attachedById),
        )
        .where(eq(platformIncidentReviewAttachments.reviewId, id))
        .orderBy(desc(platformIncidentReviewAttachments.attachedAt));
      res.json({ attachments: rows });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  "/api/platform-support/incident-reviews/:id/attachments/:aid/download",
  requireAuth,
  requireRole("ADMIN"),
  async (req: AuthRequest, res, next) => {
    try {
      if (!ensureSuperAdminOr403(req, res)) return;
      const reviewId = String(req.params.id || "").trim();
      const attachmentId = String(req.params.aid || "").trim();
      const [att] = await db
        .select()
        .from(platformIncidentReviewAttachments)
        .where(eq(platformIncidentReviewAttachments.id, attachmentId))
        .limit(1);
      if (!att || att.reviewId !== reviewId) {
        return res.status(404).json({ error: "Not found" });
      }
      const objectKey = att.objectKey || "";
      let bucketName: string;
      let objectName: string;
      try {
        ({ bucketName, objectName } = parseObjectPath(objectKey));
      } catch {
        return res
          .status(500)
          .json({ error: "Attachment object key is malformed" });
      }
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (!exists) {
        return res
          .status(404)
          .json({ error: "Attachment file is missing from storage" });
      }
      res.setHeader("Content-Type", att.contentType || "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${att.fileName}"`,
      );
      const stream = file.createReadStream();
      stream.on("error", (err) => {
        logError(
          "incident review attachment download stream error",
          { reviewId, attachmentId },
          err instanceof Error ? err : new Error(String(err)),
        );
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream attachment" });
        }
      });
      stream.pipe(res);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
