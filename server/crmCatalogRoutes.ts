import { Router } from "express";
import { db } from "./db";
import { crmCatalogItems, crmQuoteTemplates, crmQuoteTemplateItems, insertCrmCatalogItemSchema, insertCrmQuoteTemplateSchema, insertCrmQuoteTemplateItemSchema } from "@shared/schema";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;

// --- Catalog Items ---
router.get("/api/crm/catalog-items", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const items = await db.select().from(crmCatalogItems).where(eq(crmCatalogItems.organizationId, orgId)).orderBy(asc(crmCatalogItems.name));
    res.json(items);
  } catch (e) { next(e); }
});

const catalogBody = insertCrmCatalogItemSchema.omit({ organizationId: true }).extend({
  // Frontend may send unitPrice as a JS number; coerce to string since
  // Drizzle decimal columns generate z.string() in the insert schema.
  unitPrice: z.coerce.string(),
});

router.post("/api/crm/catalog-items", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = catalogBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmCatalogItems).values({ ...parsed.data, organizationId: orgId }).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/catalog-items/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = catalogBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmCatalogItems).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(crmCatalogItems.id, req.params.id), eq(crmCatalogItems.organizationId, orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/catalog-items/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const r = await db.delete(crmCatalogItems).where(and(eq(crmCatalogItems.id, req.params.id), eq(crmCatalogItems.organizationId, orgId))).returning();
    if (!r.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Quote Templates ---
const templateBody = insertCrmQuoteTemplateSchema.omit({ organizationId: true }).extend({
  items: z.array(insertCrmQuoteTemplateItemSchema.omit({ templateId: true })).default([]),
});

router.get("/api/crm/quote-templates", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const tmpls = await db.select().from(crmQuoteTemplates).where(eq(crmQuoteTemplates.organizationId, orgId)).orderBy(asc(crmQuoteTemplates.name));
    res.json(tmpls);
  } catch (e) { next(e); }
});

router.get("/api/crm/quote-templates/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [tmpl] = await db.select().from(crmQuoteTemplates).where(and(eq(crmQuoteTemplates.id, req.params.id), eq(crmQuoteTemplates.organizationId, orgId))).limit(1);
    if (!tmpl) return res.status(404).json({ error: "Not found" });
    const items = await db.select().from(crmQuoteTemplateItems).where(eq(crmQuoteTemplateItems.templateId, tmpl.id)).orderBy(asc(crmQuoteTemplateItems.sortOrder));
    res.json({ ...tmpl, items });
  } catch (e) { next(e); }
});

router.post("/api/crm/quote-templates", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = templateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const { items, ...tmplFields } = parsed.data;
    const [tmpl] = await db.insert(crmQuoteTemplates).values({ ...tmplFields, organizationId: orgId }).returning();
    if (items.length) {
      await db.insert(crmQuoteTemplateItems).values(items.map((it, idx) => ({
        templateId: tmpl.id,
        sortOrder: it.sortOrder ?? idx,
        description: it.description,
        quantity: String(it.quantity ?? 1),
        unit: it.unit ?? null,
        unitPrice: String(it.unitPrice ?? 0),
        catalogItemId: it.catalogItemId ?? null,
      })));
    }
    res.status(201).json(tmpl);
  } catch (e) { next(e); }
});

router.patch("/api/crm/quote-templates/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = templateBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [existing] = await db.select().from(crmQuoteTemplates).where(and(eq(crmQuoteTemplates.id, req.params.id), eq(crmQuoteTemplates.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const { items, ...rest } = parsed.data;
    const [updated] = await db.update(crmQuoteTemplates).set({ ...rest, updatedAt: new Date() })
      .where(eq(crmQuoteTemplates.id, existing.id)).returning();
    if (items) {
      await db.delete(crmQuoteTemplateItems).where(eq(crmQuoteTemplateItems.templateId, existing.id));
      if (items.length) {
        await db.insert(crmQuoteTemplateItems).values(items.map((it, idx) => ({
          templateId: existing.id,
          sortOrder: it.sortOrder ?? idx,
          description: it.description,
          quantity: String(it.quantity ?? 1),
          unit: it.unit ?? null,
          unitPrice: String(it.unitPrice ?? 0),
          catalogItemId: it.catalogItemId ?? null,
        })));
      }
    }
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/quote-templates/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const r = await db.delete(crmQuoteTemplates).where(and(eq(crmQuoteTemplates.id, req.params.id), eq(crmQuoteTemplates.organizationId, orgId))).returning();
    if (!r.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
