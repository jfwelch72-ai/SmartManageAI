import { Router, type Response } from "express";
import { db } from "./db";
import {
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  dotPayItemOverrides,
  organizationDotPreferences,
  projectDbeGoals,
  crmOrganisationCertifications,
  suretyBonds,
  haulTickets,
  dailyInspectorReports,
  swpppInspections,
  materialCertifications,
  insertDotAgencySchema,
  insertDotSpecBookSchema,
  insertDotPayItemSchema,
  insertDotPayItemOverrideSchema,
  insertOrganizationDotPreferenceSchema,
  insertProjectDbeGoalSchema,
  insertCrmOrganisationCertificationSchema,
  insertSuretyBondSchema,
  insertHaulTicketSchema,
  insertDailyInspectorReportSchema,
  insertSwpppInspectionSchema,
  insertMaterialCertificationSchema,
} from "@shared/schema";
import { and, desc, eq, ilike, or, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { validateBody } from "./utils/validation";
import { z } from "zod";

const router = Router();

// =========================
// DOT Agencies (read-only for users; write requires SUPER_ADMIN)
// =========================
router.get("/api/dot/agencies", requireAuth, async (_req: AuthRequest, res: Response) => {
  const rows = await db.select().from(dotAgencies).where(eq(dotAgencies.isActive, true)).orderBy(dotAgencies.name);
  res.json(rows);
});

router.post("/api/dot/agencies", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertDotAgencySchema, req.body, res);
  if (!data) return;
  const [row] = await db.insert(dotAgencies).values(data).returning();
  res.status(201).json(row);
});

// =========================
// DOT Spec Books
// =========================
router.get("/api/dot/agencies/:agencyId/spec-books", requireAuth, async (req: AuthRequest, res: Response) => {
  const rows = await db.select().from(dotSpecBooks).where(eq(dotSpecBooks.agencyId, req.params.agencyId)).orderBy(desc(dotSpecBooks.edition));
  res.json(rows);
});

router.post("/api/dot/spec-books", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertDotSpecBookSchema, req.body, res);
  if (!data) return;
  const [row] = await db.insert(dotSpecBooks).values(data).returning();
  res.status(201).json(row);
});

// =========================
// DOT Pay Items — search + browse + admin upload
// =========================
const payItemSearchQuerySchema = z.object({
  specBookId: z.string().optional(),
  agencyId: z.string().optional(),
  q: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/api/dot/pay-items", requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = payItemSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors });
  const { specBookId, agencyId, q, category, limit } = parsed.data;

  const conditions: any[] = [eq(dotPayItems.isActive, true)];
  if (specBookId) conditions.push(eq(dotPayItems.specBookId, specBookId));
  if (agencyId) conditions.push(eq(dotPayItems.agencyId, agencyId));
  if (category) conditions.push(eq(dotPayItems.category, category));
  if (q && q.trim()) {
    const term = `%${q.trim().toLowerCase()}%`;
    conditions.push(or(
      ilike(dotPayItems.itemNumber, term),
      ilike(dotPayItems.description, term),
      ilike(dotPayItems.searchTokens, term),
    ));
  }
  const rows = await db.select().from(dotPayItems).where(and(...conditions)).orderBy(dotPayItems.itemNumber).limit(limit);
  res.json(rows);
});

const bulkUploadSchema = z.object({
  specBookId: z.string(),
  items: z.array(z.object({
    itemNumber: z.string().min(1),
    description: z.string().min(1),
    unit: z.string().min(1),
    specSection: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
  })).min(1),
});
router.post("/api/dot/pay-items/bulk-upload", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response) => {
  const data = validateBody(bulkUploadSchema, req.body, res);
  if (!data) return;
  const sb = await db.select().from(dotSpecBooks).where(eq(dotSpecBooks.id, data.specBookId)).limit(1);
  if (sb.length === 0) return res.status(404).json({ error: "Spec book not found" });

  let inserted = 0;
  let skipped = 0;
  for (const item of data.items) {
    const existing = await db.select().from(dotPayItems)
      .where(and(eq(dotPayItems.specBookId, data.specBookId), eq(dotPayItems.itemNumber, item.itemNumber)))
      .limit(1);
    if (existing.length > 0) { skipped++; continue; }
    await db.insert(dotPayItems).values({
      specBookId: data.specBookId,
      agencyId: sb[0].agencyId,
      itemNumber: item.itemNumber,
      description: item.description,
      unit: item.unit,
      specSection: item.specSection ?? null,
      category: item.category ?? null,
      searchTokens: `${item.itemNumber} ${item.description}`.toLowerCase(),
    });
    inserted++;
  }
  await db.update(dotSpecBooks).set({
    itemCount: sql`(SELECT COUNT(*) FROM dot_pay_items WHERE spec_book_id = ${data.specBookId})`,
  }).where(eq(dotSpecBooks.id, data.specBookId));
  res.json({ inserted, skipped, total: data.items.length });
});

// =========================
// Org-scoped DOT preferences
// =========================
router.get("/api/dot/preferences", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const rows = await db.select().from(organizationDotPreferences).where(eq(organizationDotPreferences.organizationId, orgId));
  res.json(rows);
});
router.post("/api/dot/preferences", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertOrganizationDotPreferenceSchema, { ...req.body, organizationId: req.user!.organizationId }, res);
  if (!data) return;
  try {
    const [row] = await db.insert(organizationDotPreferences).values(data).returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "Already a preferred agency" });
  }
});
router.delete("/api/dot/preferences/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(organizationDotPreferences).where(and(eq(organizationDotPreferences.id, req.params.id), eq(organizationDotPreferences.organizationId, orgId)));
  res.status(204).end();
});

// =========================
// Pay item overrides (per-org)
// =========================
router.get("/api/dot/pay-item-overrides", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const rows = await db.select().from(dotPayItemOverrides).where(eq(dotPayItemOverrides.organizationId, orgId));
  res.json(rows);
});
router.post("/api/dot/pay-item-overrides", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertDotPayItemOverrideSchema, { ...req.body, organizationId: req.user!.organizationId }, res);
  if (!data) return;
  const [row] = await db.insert(dotPayItemOverrides).values(data).returning();
  res.status(201).json(row);
});

// =========================
// DBE Goals (per project)
// =========================
router.get("/api/projects/:projectId/dbe-goals", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const rows = await db.select().from(projectDbeGoals)
    .where(and(eq(projectDbeGoals.projectId, req.params.projectId), eq(projectDbeGoals.organizationId, orgId)));
  res.json(rows);
});
router.post("/api/projects/:projectId/dbe-goals", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertProjectDbeGoalSchema, {
    ...req.body,
    projectId: req.params.projectId,
    organizationId: req.user!.organizationId,
    createdById: req.user!.id,
  }, res);
  if (!data) return;
  const [row] = await db.insert(projectDbeGoals).values(data).returning();
  res.status(201).json(row);
});
router.patch("/api/projects/:projectId/dbe-goals/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id: _id, projectId: _pid, organizationId: _oid, createdById: _cb, createdAt: _ca, ...candidate } = req.body ?? {};
  const data = validateBody(insertProjectDbeGoalSchema.partial(), candidate, res);
  if (!data) return;
  const [row] = await db.update(projectDbeGoals).set(data)
    .where(and(
      eq(projectDbeGoals.id, req.params.id),
      eq(projectDbeGoals.projectId, req.params.projectId),
      eq(projectDbeGoals.organizationId, orgId),
    ))
    .returning();
  if (!row) return res.status(404).json({ error: "DBE goal not found" });
  res.json(row);
});
router.delete("/api/projects/:projectId/dbe-goals/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(projectDbeGoals).where(and(eq(projectDbeGoals.id, req.params.id), eq(projectDbeGoals.organizationId, orgId)));
  res.status(204).end();
});

// =========================
// CRM org certifications
// =========================
router.get("/api/crm/organisations/:crmOrgId/certifications", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const rows = await db.select().from(crmOrganisationCertifications)
    .where(and(eq(crmOrganisationCertifications.crmOrganisationId, req.params.crmOrgId), eq(crmOrganisationCertifications.organizationId, orgId)));
  res.json(rows);
});
router.post("/api/crm/organisations/:crmOrgId/certifications", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertCrmOrganisationCertificationSchema, {
    ...req.body,
    crmOrganisationId: req.params.crmOrgId,
    organizationId: req.user!.organizationId,
  }, res);
  if (!data) return;
  const [row] = await db.insert(crmOrganisationCertifications).values(data).returning();
  res.status(201).json(row);
});
router.delete("/api/crm/organisations/:crmOrgId/certifications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(crmOrganisationCertifications).where(and(eq(crmOrganisationCertifications.id, req.params.id), eq(crmOrganisationCertifications.organizationId, orgId)));
  res.status(204).end();
});

// =========================
// Surety Bonds
// =========================
router.get("/api/surety-bonds", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const projectId = (req.query.projectId as string) || null;
  const conditions: any[] = [eq(suretyBonds.organizationId, orgId)];
  if (projectId) conditions.push(eq(suretyBonds.projectId, projectId));
  const rows = await db.select().from(suretyBonds).where(and(...conditions)).orderBy(desc(suretyBonds.createdAt));
  res.json(rows);
});
router.post("/api/surety-bonds", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertSuretyBondSchema, {
    ...req.body,
    organizationId: req.user!.organizationId,
    createdById: req.user!.id,
  }, res);
  if (!data) return;
  const [row] = await db.insert(suretyBonds).values(data).returning();
  res.status(201).json(row);
});
router.patch("/api/surety-bonds/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id: _id, organizationId: _o, createdAt: _c, createdById: _cb, ...patch } = req.body || {};
  const [row] = await db.update(suretyBonds).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(suretyBonds.id, req.params.id), eq(suretyBonds.organizationId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
router.delete("/api/surety-bonds/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(suretyBonds).where(and(eq(suretyBonds.id, req.params.id), eq(suretyBonds.organizationId, orgId)));
  res.status(204).end();
});

// =========================
// Haul Tickets
// =========================
router.get("/api/haul-tickets", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const projectId = (req.query.projectId as string) || null;
  const conditions: any[] = [eq(haulTickets.organizationId, orgId)];
  if (projectId) conditions.push(eq(haulTickets.projectId, projectId));
  const rows = await db.select().from(haulTickets).where(and(...conditions)).orderBy(desc(haulTickets.ticketDate)).limit(500);
  res.json(rows);
});
router.post("/api/haul-tickets", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertHaulTicketSchema, {
    ...req.body,
    organizationId: req.user!.organizationId,
    recordedById: req.user!.id,
  }, res);
  if (!data) return;
  const [row] = await db.insert(haulTickets).values(data).returning();
  res.status(201).json(row);
});
router.patch("/api/haul-tickets/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id: _id, organizationId: _o, createdAt: _c, recordedById: _r, ...patch } = req.body || {};
  const [row] = await db.update(haulTickets).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(haulTickets.id, req.params.id), eq(haulTickets.organizationId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
router.delete("/api/haul-tickets/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(haulTickets).where(and(eq(haulTickets.id, req.params.id), eq(haulTickets.organizationId, orgId)));
  res.status(204).end();
});

// Aggregate haul reconciliation: planned vs actual by material class
router.get("/api/projects/:projectId/haul-reconciliation", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const rows = await db.execute(sql`
    SELECT material_class, SUM(quantity) AS total_quantity, SUM(total_cost) AS total_cost, unit
    FROM haul_tickets
    WHERE project_id = ${req.params.projectId} AND organization_id = ${orgId}
    GROUP BY material_class, unit
    ORDER BY material_class
  `);
  res.json(rows.rows);
});

// =========================
// Daily Inspector Reports
// =========================
router.get("/api/daily-inspector-reports", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const projectId = (req.query.projectId as string) || null;
  const conditions: any[] = [eq(dailyInspectorReports.organizationId, orgId)];
  if (projectId) conditions.push(eq(dailyInspectorReports.projectId, projectId));
  const rows = await db.select().from(dailyInspectorReports).where(and(...conditions)).orderBy(desc(dailyInspectorReports.reportDate)).limit(200);
  res.json(rows);
});
router.post("/api/daily-inspector-reports", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertDailyInspectorReportSchema, {
    ...req.body,
    organizationId: req.user!.organizationId,
    inspectorId: req.body?.inspectorId ?? req.user!.id,
  }, res);
  if (!data) return;
  const [row] = await db.insert(dailyInspectorReports).values(data).returning();
  res.status(201).json(row);
});
router.patch("/api/daily-inspector-reports/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id: _id, organizationId: _o, createdAt: _c, ...patch } = req.body || {};
  const [row] = await db.update(dailyInspectorReports).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(dailyInspectorReports.id, req.params.id), eq(dailyInspectorReports.organizationId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
router.delete("/api/daily-inspector-reports/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(dailyInspectorReports).where(and(eq(dailyInspectorReports.id, req.params.id), eq(dailyInspectorReports.organizationId, orgId)));
  res.status(204).end();
});

// =========================
// SWPPP Inspections
// =========================
router.get("/api/swppp-inspections", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const projectId = (req.query.projectId as string) || null;
  const conditions: any[] = [eq(swpppInspections.organizationId, orgId)];
  if (projectId) conditions.push(eq(swpppInspections.projectId, projectId));
  const rows = await db.select().from(swpppInspections).where(and(...conditions)).orderBy(desc(swpppInspections.inspectionDate)).limit(200);
  res.json(rows);
});
router.post("/api/swppp-inspections", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertSwpppInspectionSchema, {
    ...req.body,
    organizationId: req.user!.organizationId,
    createdById: req.user!.id,
  }, res);
  if (!data) return;
  const [row] = await db.insert(swpppInspections).values(data).returning();
  res.status(201).json(row);
});
router.patch("/api/swppp-inspections/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id: _id, organizationId: _o, createdAt: _c, createdById: _cb, ...patch } = req.body || {};
  const [row] = await db.update(swpppInspections).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(swpppInspections.id, req.params.id), eq(swpppInspections.organizationId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
router.delete("/api/swppp-inspections/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(swpppInspections).where(and(eq(swpppInspections.id, req.params.id), eq(swpppInspections.organizationId, orgId)));
  res.status(204).end();
});

// =========================
// Material Certifications (Buy America)
// =========================
router.get("/api/material-certifications", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const projectId = (req.query.projectId as string) || null;
  const conditions: any[] = [eq(materialCertifications.organizationId, orgId)];
  if (projectId) conditions.push(eq(materialCertifications.projectId, projectId));
  const rows = await db.select().from(materialCertifications).where(and(...conditions)).orderBy(desc(materialCertifications.createdAt)).limit(500);
  res.json(rows);
});
router.post("/api/material-certifications", requireAuth, async (req: AuthRequest, res: Response) => {
  const data = validateBody(insertMaterialCertificationSchema, {
    ...req.body,
    organizationId: req.user!.organizationId,
  }, res);
  if (!data) return;
  const [row] = await db.insert(materialCertifications).values(data).returning();
  res.status(201).json(row);
});
router.patch("/api/material-certifications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  const { id: _id, organizationId: _o, createdAt: _c, ...patch } = req.body || {};
  const [row] = await db.update(materialCertifications).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(materialCertifications.id, req.params.id), eq(materialCertifications.organizationId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
router.delete("/api/material-certifications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const orgId = req.user!.organizationId;
  await db.delete(materialCertifications).where(and(eq(materialCertifications.id, req.params.id), eq(materialCertifications.organizationId, orgId)));
  res.status(204).end();
});

export default router;
