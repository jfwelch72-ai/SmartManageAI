import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  crmCustomReports, insertCrmCustomReportSchema,
  crmOpportunities, crmContacts,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

const ALLOWED_OPPORTUNITY_DIMENSIONS = ["stage", "source", "assignedToId", "lostCategory"] as const;
const ALLOWED_OPPORTUNITY_MEASURES = ["count", "sumDealValue", "avgLeadScore"] as const;

const reportConfig = z.object({
  entity: z.enum(["opportunity", "contact"]),
  dimensions: z.array(z.string()).default([]),
  measures: z.array(z.string()).default(["count"]),
  filters: z.array(z.object({
    field: z.string(),
    op: z.enum(["eq", "neq", "gte", "lte"]),
    value: z.any(),
  })).default([]),
  chart: z.enum(["bar", "line", "table", "pie"]).default("bar"),
});

const reportBody = insertCrmCustomReportSchema.omit({ organizationId: true, createdById: true }).extend({
  config: reportConfig,
});

router.get("/api/crm/reports", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmCustomReports).where(eq(crmCustomReports.organizationId, orgId));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/reports", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = reportBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmCustomReports).values({
      ...(parsed.data as any),
      organizationId: orgId,
      createdById: req.user!.id,
    }).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/reports/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = reportBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmCustomReports).set({ ...(parsed.data as any), updatedAt: new Date() })
      .where(and(eq(crmCustomReports.id, req.params.id), eq(crmCustomReports.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/reports/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    await db.delete(crmCustomReports).where(and(eq(crmCustomReports.id, req.params.id), eq(crmCustomReports.organizationId, orgId)));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post("/api/crm/reports/run", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = reportConfig.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const cfg = parsed.data;
    if (cfg.entity === "opportunity") {
      const invalidDims = cfg.dimensions.filter((d) => !(ALLOWED_OPPORTUNITY_DIMENSIONS as readonly string[]).includes(d));
      const invalidMeasures = cfg.measures.filter((m) => !(ALLOWED_OPPORTUNITY_MEASURES as readonly string[]).includes(m));
      if (invalidDims.length || invalidMeasures.length) {
        return res.status(400).json({ error: "Invalid dimensions or measures", invalidDims, invalidMeasures });
      }
      const dims = cfg.dimensions;
      const measures = cfg.measures;
      if (dims.length === 0) {
        // simple counts
        const rows = await db.select({
          count: sql<number>`count(*)`,
          sumDealValue: sql<number>`coalesce(sum(${crmOpportunities.dealValue}::numeric),0)`,
          avgLeadScore: sql<number>`coalesce(avg(${crmOpportunities.leadScore}),0)`,
        }).from(crmOpportunities).where(eq(crmOpportunities.organizationId, orgId));
        return res.json({ rows });
      }
      // Group by first dimension only for v1
      const dim = dims[0];
      const dimCol = (crmOpportunities as any)[dim];
      const rows = await db.select({
        dimension: dimCol,
        count: sql<number>`count(*)`,
        sumDealValue: sql<number>`coalesce(sum(${crmOpportunities.dealValue}::numeric),0)`,
        avgLeadScore: sql<number>`coalesce(avg(${crmOpportunities.leadScore}),0)`,
      }).from(crmOpportunities).where(eq(crmOpportunities.organizationId, orgId)).groupBy(dimCol);
      return res.json({ dimension: dim, measures, rows });
    }
    if (cfg.entity === "contact") {
      const rows = await db.select({ count: sql<number>`count(*)` }).from(crmContacts).where(eq(crmContacts.organizationId, orgId));
      return res.json({ rows });
    }
    res.status(400).json({ error: "Unsupported entity" });
  } catch (e) { next(e); }
});

export default router;
