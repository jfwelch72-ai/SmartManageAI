import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  planPins,
  planDocuments,
  projects,
  insertPlanPinSchema,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";

const router = Router();

const VALID_REF_TABLES = new Set(["rfis", "punch_list_items", "submittals"]);

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

// LIST pins for a project (optional filter by documentId & page)
router.get(
  "/projects/:code/plan-pins",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json([]);

      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.json([]);
      }

      const conds = [eq(planPins.projectCode, req.params.code)];
      const { documentId, page } = req.query;
      if (typeof documentId === "string" && documentId) {
        conds.push(eq(planPins.planDocumentId, documentId));
      }
      if (typeof page === "string" && page) {
        const n = parseInt(page, 10);
        if (!isNaN(n)) conds.push(eq(planPins.pageNumber, n));
      }

      const rows = await db
        .select()
        .from(planPins)
        .where(and(...conds))
        .orderBy(desc(planPins.createdAt));

      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// CREATE pin (the linked source object must already exist)
router.post(
  "/projects/:code/plan-pins",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

      const user = req.user!;
      if (!user.organizationId) {
        return res.status(403).json({ error: "No organization assigned" });
      }

      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const body = req.body || {};
      if (!VALID_REF_TABLES.has(body.refTable)) {
        return res.status(400).json({ error: "Invalid refTable" });
      }

      const [doc] = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.id, body.planDocumentId))
        .limit(1);
      if (!doc || doc.projectId !== project.id) {
        return res.status(404).json({ error: "Plan document not found" });
      }

      const x = Number(body.x);
      const y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return res.status(400).json({ error: "x and y must be between 0 and 1" });
      }

      const parsed = insertPlanPinSchema.safeParse({
        organizationId: user.organizationId,
        projectCode: req.params.code,
        planDocumentId: body.planDocumentId,
        pageNumber: Number.isFinite(Number(body.pageNumber)) ? Number(body.pageNumber) : 1,
        x,
        y,
        pinType: body.pinType,
        refTable: body.refTable,
        refId: body.refId,
        createdById: user.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });
      }

      const [pin] = await db.insert(planPins).values(parsed.data).returning();

      await logAudit(
        {
          userId: user.id,
          action: "CREATE",
          entityType: "planPin",
          entityId: pin.id,
          newValue: JSON.stringify({
            pinType: pin.pinType,
            refTable: pin.refTable,
            refId: pin.refId,
            documentId: pin.planDocumentId,
          }),
        },
        req,
      );

      res.status(201).json(pin);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE pin
router.delete(
  "/plan-pins/:id",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.status(403).json({ error: "Access denied" });

      const [pin] = await db.select().from(planPins).where(eq(planPins.id, req.params.id)).limit(1);
      if (!pin) return res.status(404).json({ error: "Pin not found" });

      if (shouldFilter && orgId && pin.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await db.delete(planPins).where(eq(planPins.id, req.params.id));

      await logAudit(
        {
          userId: req.user!.id,
          action: "DELETE",
          entityType: "planPin",
          entityId: pin.id,
        },
        req,
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
