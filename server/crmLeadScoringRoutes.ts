import { Router } from "express";
import { db } from "./db";
import { crmLeadScoringRules, insertCrmLeadScoringRuleSchema } from "@shared/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { rescoreOrgOpportunities, SCORABLE_FIELDS } from "./utils/crmLeadScorer";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

router.get("/api/crm/lead-scoring/fields", requireAuth, requireRole(...ROLES), async (_req: AuthRequest, res) => {
  res.json({ fields: SCORABLE_FIELDS });
});

router.get("/api/crm/lead-scoring/rules", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rules = await db.select().from(crmLeadScoringRules).where(eq(crmLeadScoringRules.organizationId, orgId)).orderBy(asc(crmLeadScoringRules.name));
    res.json(rules);
  } catch (e) { next(e); }
});

const ruleBody = insertCrmLeadScoringRuleSchema.omit({ organizationId: true });

router.post("/api/crm/lead-scoring/rules", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = ruleBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmLeadScoringRules).values({ ...parsed.data, organizationId: orgId }).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/lead-scoring/rules/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = ruleBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmLeadScoringRules).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(crmLeadScoringRules.id, req.params.id), eq(crmLeadScoringRules.organizationId, orgId))).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/lead-scoring/rules/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const r = await db.delete(crmLeadScoringRules).where(and(eq(crmLeadScoringRules.id, req.params.id), eq(crmLeadScoringRules.organizationId, orgId))).returning();
    if (!r.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/api/crm/lead-scoring/recalculate", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const updated = await rescoreOrgOpportunities(orgId);
    res.json({ ok: true, updated });
  } catch (e) { next(e); }
});

export default router;
