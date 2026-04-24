/**
 * Task #1609 — plan_document_markups CRUD, carryover-from-revision, and
 * burned-in PDF export.
 *
 * Lives separately from `server/takeoffCategoryRoutes.ts` (which serves
 * the bid-side `takeoff_markups` surface) so the project-side PlansTab
 * can evolve without regression risk to the takeoff workspace. The two
 * tables intentionally have the same shape so the React renderer is
 * shared.
 */

import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  planDocumentMarkups,
  planDocuments,
  planPins,
  projects,
  users,
  insertPlanDocumentMarkupSchema,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";
import { logError } from "./utils/logger";
import { recordJobMetrics } from "./utils/jobMetrics";
import { z } from "zod";
import { renderPlanDocumentPdf, PlanPdfTooLargeError, MAX_PAGES } from "./planDocumentPdfExport";
import { ObjectPermission } from "./objectAcl";

const router = Router();

function safeParsePoints(s: string | null | undefined): Array<{ x: number; y: number }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function loadDocAndAssertOrg(
  docId: string,
  req: AuthRequest,
): Promise<
  | { ok: true; doc: typeof planDocuments.$inferSelect }
  | { ok: false; status: number; error: string }
> {
  const [doc] = await db.select().from(planDocuments).where(eq(planDocuments.id, docId)).limit(1);
  if (!doc) return { ok: false, status: 404, error: "Plan document not found" };
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) return { ok: false, status: 403, error: "Access denied" };
  if (shouldFilter && orgId && doc.organizationId && doc.organizationId !== orgId) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  return { ok: true, doc };
}

// ============================================================================
// LIST markups for a plan document (optionally filtered by page)
// ============================================================================
router.get(
  "/api/plan-documents/:docId/markups",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const conds = [eq(planDocumentMarkups.planDocumentId, req.params.docId)];
      const { page } = req.query;
      if (typeof page === "string" && page) {
        const n = parseInt(page, 10);
        if (!Number.isNaN(n)) conds.push(eq(planDocumentMarkups.pageNumber, n));
      }

      const rows = await db
        .select({
          id: planDocumentMarkups.id,
          organizationId: planDocumentMarkups.organizationId,
          projectId: planDocumentMarkups.projectId,
          planDocumentId: planDocumentMarkups.planDocumentId,
          pageNumber: planDocumentMarkups.pageNumber,
          tool: planDocumentMarkups.tool,
          points: planDocumentMarkups.points,
          color: planDocumentMarkups.color,
          thickness: planDocumentMarkups.thickness,
          text: planDocumentMarkups.text,
          createdBy: planDocumentMarkups.createdBy,
          createdAt: planDocumentMarkups.createdAt,
          sourceMarkupId: planDocumentMarkups.sourceMarkupId,
          authorFirstName: users.firstName,
          authorLastName: users.lastName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(planDocumentMarkups)
        .leftJoin(users, eq(planDocumentMarkups.createdBy, users.id))
        .where(and(...conds))
        .orderBy(planDocumentMarkups.createdAt);

      recordJobMetrics("plan_document_markups_list", {
        ok: 1,
        markups: rows.length,
        ms: Date.now() - startedAt,
      });

      res.json(
        rows.map((m) => ({
          ...m,
          points: safeParsePoints(m.points),
        })),
      );
    } catch (err) {
      recordJobMetrics("plan_document_markups_list", { error: 1, ms: Date.now() - startedAt });
      next(err);
    }
  },
);

// ============================================================================
// CREATE markup
// ============================================================================
const createMarkupBody = z.object({
  pageNumber: z.number().int().min(1),
  tool: z.enum(["ARROW", "TEXT", "RECTANGLE", "CLOUD", "HIGHLIGHT", "FREEHAND"]),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
  color: z.string().min(1).max(16).optional(),
  thickness: z.number().int().min(1).max(64).optional(),
  text: z.string().nullable().optional(),
});

router.post(
  "/api/plan-documents/:docId/markups",
  requireAuth,
  // Task #1609 RBAC: only roles that can be expected to author markup may
  // create them. Other authenticated roles (HUSTLER, VENDOR viewers, etc.)
  // get a 403 before we touch the DB. SUPERINTENDENT is the codebase's
  // analogue of "project engineer" and FIELD_WORKER is the analogue of
  // "foreman" for review-feedback purposes.
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const user = req.user!;
      if (!user.organizationId) {
        res.status(403).json({ error: "No organization assigned" });
        return;
      }

      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const body = createMarkupBody.parse(req.body);

      const validated = insertPlanDocumentMarkupSchema.parse({
        organizationId: user.organizationId,
        projectId: access.doc.projectId,
        planDocumentId: access.doc.id,
        pageNumber: body.pageNumber,
        tool: body.tool,
        points: JSON.stringify(body.points),
        color: body.color ?? "#ff0000",
        thickness: body.thickness ?? 2,
        text: body.text ?? null,
        createdBy: user.id,
      });

      const [created] = await db.insert(planDocumentMarkups).values(validated).returning();

      await logAudit(
        {
          userId: user.id,
          action: "CREATE",
          entityType: "planDocumentMarkup",
          entityId: created.id,
          newValue: JSON.stringify({ tool: created.tool, page: created.pageNumber, doc: created.planDocumentId }),
        },
        req,
      );

      recordJobMetrics("plan_document_markups_create", {
        ok: 1,
        ms: Date.now() - startedAt,
      });

      res.status(201).json({
        ...created,
        points: safeParsePoints(created.points),
      });
    } catch (err: any) {
      recordJobMetrics("plan_document_markups_create", { error: 1, ms: Date.now() - startedAt });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid markup data", details: err.errors });
        return;
      }
      logError("Error creating plan document markup", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

// ============================================================================
// DELETE markup
// ============================================================================
router.delete(
  "/api/plan-document-markups/:id",
  requireAuth,
  // Task #1609 RBAC: gate at the same set of roles as create. The
  // "owner-or-manager" rule is then applied per-row inside the handler
  // (so a FIELD_WORKER can delete their own markup but not someone else's).
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const [m] = await db
        .select()
        .from(planDocumentMarkups)
        .where(eq(planDocumentMarkups.id, req.params.id))
        .limit(1);
      if (!m) {
        res.status(404).json({ error: "Markup not found" });
        return;
      }

      const user = req.user!;
      const isSuperAdmin = user.role === "SUPER_ADMIN";
      const isAdminOrManager = isSuperAdmin || user.role === "ADMIN" || user.role === "MANAGER";
      const isOwner = m.createdBy === user.id;

      if (!isSuperAdmin && m.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (!isOwner && !isAdminOrManager) {
        res.status(403).json({ error: "You can only delete your own markups" });
        return;
      }

      await db.delete(planDocumentMarkups).where(eq(planDocumentMarkups.id, m.id));

      await logAudit(
        {
          userId: user.id,
          action: "DELETE",
          entityType: "planDocumentMarkup",
          entityId: m.id,
        },
        req,
      );

      recordJobMetrics("plan_document_markups_delete", {
        ok: 1,
        ms: Date.now() - startedAt,
      });

      res.json({ ok: true });
    } catch (err) {
      recordJobMetrics("plan_document_markups_delete", { error: 1, ms: Date.now() - startedAt });
      next(err);
    }
  },
);

// ============================================================================
// CARRYOVER pins + markups from a source plan_document to the current one.
// Idempotent — repeated calls with the same source do not duplicate rows
// because of the (plan_document_id, source_*_id) UNIQUE indexes; the
// implementation uses `ON CONFLICT DO NOTHING` to make the no-op explicit.
// ============================================================================
const carryoverBody = z.object({
  fromDocumentId: z.string().min(1),
  includePins: z.boolean().optional().default(true),
  includeMarkups: z.boolean().optional().default(true),
});

router.post(
  "/api/plan-documents/:docId/carryover-annotations",
  requireAuth,
  // Bulk-mutation surface — same role-set as markup create/delete.
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const body = carryoverBody.parse(req.body || {});

      const targetAccess = await loadDocAndAssertOrg(req.params.docId, req);
      if (!targetAccess.ok) {
        res.status(targetAccess.status).json({ error: targetAccess.error });
        return;
      }
      const sourceAccess = await loadDocAndAssertOrg(body.fromDocumentId, req);
      if (!sourceAccess.ok) {
        res.status(sourceAccess.status).json({ error: sourceAccess.error });
        return;
      }

      // Both documents must belong to the same project — copying across
      // projects is never desirable here and would silently create
      // cross-project annotation drift.
      if (
        targetAccess.doc.projectId &&
        sourceAccess.doc.projectId &&
        targetAccess.doc.projectId !== sourceAccess.doc.projectId
      ) {
        res
          .status(400)
          .json({ error: "fromDocumentId must belong to the same project as :docId" });
        return;
      }

      // Resolve project code (needed for plan_pins.projectCode) once.
      let projectCode: string | null = null;
      if (targetAccess.doc.projectId) {
        const [proj] = await db
          .select({ code: projects.code })
          .from(projects)
          .where(eq(projects.id, targetAccess.doc.projectId))
          .limit(1);
        projectCode = proj?.code ?? null;
      }

      // Task #1609 — execute the entire carryover in a single transaction
      // so that a partial copy never appears as `ok: true`. ON CONFLICT DO
      // NOTHING is still used to make repeats idempotent (no duplicate
      // (plan_document_id, source_*_id) pairs), but any *other* failure
      // rolls back both pins and markups together.
      const { pinsCopied, markupsCopied } = await db.transaction(async (tx) => {
        let pinsCopiedTx = 0;
        let markupsCopiedTx = 0;

        if (body.includePins && projectCode) {
          const sourcePins = await tx
            .select()
            .from(planPins)
            .where(eq(planPins.planDocumentId, body.fromDocumentId));

          // Only carry over pins that originated as primary entries on the
          // source document — recursively-copied pins (sourcePinId !== null)
          // are skipped to avoid recursive lineage explosion.
          const primaryPins = sourcePins.filter((p) => !p.sourcePinId);
          if (primaryPins.length > 0) {
            const inserted = await tx
              .insert(planPins)
              .values(
                primaryPins.map((p) => ({
                  organizationId: p.organizationId,
                  projectCode: projectCode,
                  planDocumentId: targetAccess.doc.id,
                  pageNumber: p.pageNumber,
                  x: p.x,
                  y: p.y,
                  pinType: p.pinType,
                  refTable: p.refTable,
                  refId: p.refId,
                  createdById: req.user!.id,
                  sourcePinId: p.id,
                })),
              )
              .onConflictDoNothing({
                target: [planPins.planDocumentId, planPins.sourcePinId],
                where: sql`${planPins.sourcePinId} IS NOT NULL`,
              })
              .returning({ id: planPins.id });
            pinsCopiedTx = inserted.length;
          }
        }

        if (body.includeMarkups) {
          const sourceMarkups = await tx
            .select()
            .from(planDocumentMarkups)
            .where(eq(planDocumentMarkups.planDocumentId, body.fromDocumentId));

          const primaryMarkups = sourceMarkups.filter((m) => !m.sourceMarkupId);
          if (primaryMarkups.length > 0) {
            const inserted = await tx
              .insert(planDocumentMarkups)
              .values(
                primaryMarkups.map((m) => ({
                  organizationId: m.organizationId,
                  projectId: targetAccess.doc.projectId,
                  planDocumentId: targetAccess.doc.id,
                  pageNumber: m.pageNumber,
                  tool: m.tool,
                  points: m.points,
                  color: m.color,
                  thickness: m.thickness,
                  text: m.text,
                  createdBy: req.user!.id,
                  sourceMarkupId: m.id,
                })),
              )
              .onConflictDoNothing({
                target: [planDocumentMarkups.planDocumentId, planDocumentMarkups.sourceMarkupId],
                where: sql`${planDocumentMarkups.sourceMarkupId} IS NOT NULL`,
              })
              .returning({ id: planDocumentMarkups.id });
            markupsCopiedTx = inserted.length;
          }
        }

        return { pinsCopied: pinsCopiedTx, markupsCopied: markupsCopiedTx };
      });

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "planDocument",
          entityId: targetAccess.doc.id,
          newValue: JSON.stringify({
            from: body.fromDocumentId,
            pinsCopied,
            markupsCopied,
          }),
        },
        req,
      );

      recordJobMetrics("plan_document_carryover", {
        ok: 1,
        pinsCopied,
        markupsCopied,
        ms: Date.now() - startedAt,
      });

      res.json({
        ok: true,
        pinsCopied,
        markupsCopied,
        skipped: {
          // Idempotency-skipped counts. Useful for the "already carried over"
          // affordance in the upload prompt UI.
          reason: "duplicate-source",
        },
      });
    } catch (err: any) {
      recordJobMetrics("plan_document_carryover", { error: 1, ms: Date.now() - startedAt });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid carryover request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// LIST pins for a single plan_document. Convenience endpoint used by the
// print page so it can fetch overlays without first resolving the
// project code.
// ============================================================================
router.get(
  "/api/plan-pin-rollup-by-doc/:docId",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const rows = await db
        .select({
          id: planPins.id,
          pageNumber: planPins.pageNumber,
          x: planPins.x,
          y: planPins.y,
          pinType: planPins.pinType,
          refTable: planPins.refTable,
          refId: planPins.refId,
        })
        .from(planPins)
        .where(eq(planPins.planDocumentId, req.params.docId));
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// PRINT-STREAM — stream the underlying PDF bytes for the print page. Mirrors
// `/api/projects/:code/documents/:docId/stream` but is keyed only on the
// document id so the print page (which doesn't know the project code at
// load time) can resolve the file with one fetch.
// ============================================================================
router.get(
  "/api/plan-documents/:docId/print-stream",
  requireAuth,
  // Same role-set as export.pdf — prevents bypassing the export gate
  // by loading /print/plan-documents/:id and using browser print-to-PDF.
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const doc = access.doc;
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const permitted = await filterFilesByPermissions(
        [doc],
        req.user!.id,
        req.user!.role,
        "DOCUMENT",
      );
      if (permitted.length === 0) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const storageKey = doc.objectKey || doc.fileUrl;
      if (!storageKey) {
        res.status(404).json({ error: "No file associated with this document" });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
      const allowed = await objectStorageService.canAccessObjectEntity({
        userId: req.user!.id,
        userOrganizationId: req.user!.organizationId || undefined,
        objectFile,
        requestedPermission: ObjectPermission.READ,
        userRole: req.user!.role,
      });
      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      await objectStorageService.downloadObject(objectFile, res, 3600);
    } catch (err) {
      logError(
        "[plan-pdf-export] print-stream failed",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      if (!res.headersSent) next(err);
    }
  },
);

// ============================================================================
// EXPORT — burn markups (and optionally pins) into a downloaded PDF
// ============================================================================
router.get(
  "/api/plan-documents/:docId/export.pdf",
  requireAuth,
  // Task #1609 RBAC: PDF export spins up a headless browser and is the
  // most expensive surface in this router. Limit it to roles that need to
  // distribute construction documents (SUPERINTENDENT is the codebase's
  // analogue of "project engineer" for this purpose).
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      // Accept ?flag=true|false|1|0|yes|no|on|off (case-insensitive).
      const parseBoolFlag = (v: unknown, defaultValue: boolean): boolean => {
        if (v === undefined || v === null || v === "") return defaultValue;
        if (typeof v === "boolean") return v;
        const s = String(v).trim().toLowerCase();
        if (s === "0" || s === "false" || s === "no" || s === "off") return false;
        if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
        return defaultValue;
      };
      const includeMarkups = parseBoolFlag(req.query.includeMarkups, true);
      const includePins = parseBoolFlag(req.query.includePins, true);

      // Resolve origin so the print page can hit our own APIs.
      const protoHeader = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
      const proto = String(protoHeader).split(",")[0].trim() || "http";
      const host = (req.headers["x-forwarded-host"] as string | undefined) || req.get("host") || "localhost";
      const origin = `${proto}://${host}`;

      // Forward the requesting user's auth cookie to the headless browser.
      // This codebase uses the `auth_token` JWT cookie (server/auth.ts);
      // SESSION_COOKIE_NAME and connect.sid are fallbacks.
      const cookieCandidates = [
        process.env.SESSION_COOKIE_NAME,
        "auth_token",
        "connect.sid",
      ].filter((n): n is string => !!n);
      let cookieName: string | undefined;
      let cookieValue: string | undefined;
      for (const candidate of cookieCandidates) {
        const v = req.cookies?.[candidate] as string | undefined;
        if (v) {
          cookieName = candidate;
          cookieValue = v;
          break;
        }
      }
      if (!cookieName || !cookieValue) {
        // The export requires a real session/JWT cookie to render the
        // print page; bearer-token-only auth would not propagate to the
        // headless browser.
        res.status(400).json({ error: "Export requires an interactive session." });
        return;
      }

      const pdfBuffer = await renderPlanDocumentPdf({
        documentId: access.doc.id,
        origin,
        authCookie: { name: cookieName, value: cookieValue },
        includeMarkups,
        includePins,
      });

      recordJobMetrics("plan_document_pdf_export", {
        ok: 1,
        bytes: pdfBuffer.length,
        ms: Date.now() - startedAt,
      });

      const fileName = (access.doc.fileName || "plan-document").replace(/\.[^.]+$/, "");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}-with-markups.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      recordJobMetrics("plan_document_pdf_export", { error: 1, ms: Date.now() - startedAt });
      if (err instanceof PlanPdfTooLargeError) {
        res.status(413).json({
          error: `Plan document has ${err.pageCount} pages; export is capped at ${MAX_PAGES}.`,
        });
        return;
      }
      logError("[plan-pdf-export] route failed", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

export default router;
