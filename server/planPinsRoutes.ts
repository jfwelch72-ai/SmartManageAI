import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  planPins,
  planDocuments,
  projects,
  insertPlanPinSchema,
  rfis,
  punchListItems,
  submittals,
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

// SUMMARY: open pin counts per plan document for a project, with breakdown by pin type
router.get(
  "/projects/:code/plan-pins/summary",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json({});

      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.json({});
      }

      const pins = await db
        .select({
          id: planPins.id,
          planDocumentId: planPins.planDocumentId,
          pinType: planPins.pinType,
          refTable: planPins.refTable,
          refId: planPins.refId,
        })
        .from(planPins)
        .where(eq(planPins.projectCode, req.params.code));

      if (pins.length === 0) return res.json({});

      const rfiIds = Array.from(new Set(pins.filter(p => p.refTable === "rfis").map(p => p.refId)));
      const punchIds = Array.from(new Set(pins.filter(p => p.refTable === "punch_list_items").map(p => p.refId)));
      const submittalIds = Array.from(new Set(pins.filter(p => p.refTable === "submittals").map(p => p.refId)));

      const RFI_CLOSED = new Set(["ANSWERED", "CLOSED"]);
      const PUNCH_CLOSED = new Set(["RESOLVED", "VERIFIED"]);
      const SUBMITTAL_CLOSED = new Set(["APPROVED", "APPROVED_AS_NOTED", "REJECTED"]);

      const openRefs = new Set<string>();
      const markOpen = (table: string, id: string) => openRefs.add(`${table}:${id}`);

      if (rfiIds.length > 0) {
        const rows = await db
          .select({ id: rfis.id, status: rfis.status })
          .from(rfis)
          .where(inArray(rfis.id, rfiIds));
        for (const r of rows) {
          if (!RFI_CLOSED.has(r.status as string)) markOpen("rfis", r.id);
        }
      }
      if (punchIds.length > 0) {
        const rows = await db
          .select({ id: punchListItems.id, status: punchListItems.status })
          .from(punchListItems)
          .where(inArray(punchListItems.id, punchIds));
        for (const r of rows) {
          if (!PUNCH_CLOSED.has(r.status as string)) markOpen("punch_list_items", r.id);
        }
      }
      if (submittalIds.length > 0) {
        const rows = await db
          .select({ id: submittals.id, status: submittals.status })
          .from(submittals)
          .where(inArray(submittals.id, submittalIds));
        for (const r of rows) {
          if (!SUBMITTAL_CLOSED.has(r.status as string)) markOpen("submittals", r.id);
        }
      }

      const summary: Record<string, { total: number; rfi: number; punch: number; submittal: number }> = {};
      for (const p of pins) {
        if (!openRefs.has(`${p.refTable}:${p.refId}`)) continue;
        const entry = summary[p.planDocumentId] ||= { total: 0, rfi: 0, punch: 0, submittal: 0 };
        entry.total++;
        if (p.pinType === "RFI") entry.rfi++;
        else if (p.pinType === "PUNCH") entry.punch++;
        else if (p.pinType === "SUBMITTAL") entry.submittal++;
      }

      res.json(summary);
    } catch (err) {
      next(err);
    }
  },
);

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

// PATCH pin position (x, y on same page)
router.patch(
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

      const body = req.body || {};
      const updates: {
        x?: number;
        y?: number;
        pageNumber?: number;
        planDocumentId?: string;
      } = {};

      if (body.x !== undefined) {
        const x = Number(body.x);
        if (!Number.isFinite(x) || x < 0 || x > 1) {
          return res.status(400).json({ error: "x must be between 0 and 1" });
        }
        updates.x = x;
      }
      if (body.y !== undefined) {
        const y = Number(body.y);
        if (!Number.isFinite(y) || y < 0 || y > 1) {
          return res.status(400).json({ error: "y must be between 0 and 1" });
        }
        updates.y = y;
      }
      if (body.pageNumber !== undefined) {
        const pageNumber = Number(body.pageNumber);
        if (!Number.isInteger(pageNumber) || pageNumber < 1) {
          return res.status(400).json({ error: "pageNumber must be a positive integer" });
        }
        updates.pageNumber = pageNumber;
      }
      if (body.planDocumentId !== undefined && body.planDocumentId !== pin.planDocumentId) {
        if (typeof body.planDocumentId !== "string" || !body.planDocumentId) {
          return res.status(400).json({ error: "planDocumentId must be a string" });
        }

        const project = await getProjectByCode(pin.projectCode);
        if (!project) return res.status(404).json({ error: "Project not found" });

        const [targetDoc] = await db
          .select()
          .from(planDocuments)
          .where(eq(planDocuments.id, body.planDocumentId))
          .limit(1);
        if (!targetDoc || targetDoc.projectId !== project.id) {
          return res.status(404).json({ error: "Target plan document not found in this project" });
        }
        updates.planDocumentId = body.planDocumentId;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const [updated] = await db
        .update(planPins)
        .set(updates)
        .where(eq(planPins.id, req.params.id))
        .returning();

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "planPin",
          entityId: pin.id,
          oldValue: JSON.stringify({
            x: pin.x,
            y: pin.y,
            pageNumber: pin.pageNumber,
            planDocumentId: pin.planDocumentId,
          }),
          newValue: JSON.stringify({
            x: updated.x,
            y: updated.y,
            pageNumber: updated.pageNumber,
            planDocumentId: updated.planDocumentId,
          }),
        },
        req,
      );

      res.json(updated);
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
