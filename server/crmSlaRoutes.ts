import { Router } from "express";
import { db } from "./db";
import { crmStageSlas, insertCrmStageSlaSchema, crmOpportunities } from "@shared/schema";
import { and, eq, isNotNull, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { checkAndFlagSlaBreaches } from "./services/crmSlaService";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

router.get("/api/crm/stage-slas", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmStageSlas).where(eq(crmStageSlas.organizationId, orgId));
    res.json(rows);
  } catch (e) { next(e); }
});

const slaBody = insertCrmStageSlaSchema.omit({ organizationId: true });

router.post("/api/crm/stage-slas", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = slaBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    // Upsert by (orgId, stage)
    const [existing] = await db.select().from(crmStageSlas).where(and(eq(crmStageSlas.organizationId, orgId), eq(crmStageSlas.stage, parsed.data.stage))).limit(1);
    if (existing) {
      const [updated] = await db.update(crmStageSlas).set({ ...(parsed.data as any), updatedAt: new Date() }).where(eq(crmStageSlas.id, existing.id)).returning();
      return res.json(updated);
    }
    const [created] = await db.insert(crmStageSlas).values({ ...parsed.data, organizationId: orgId } as any).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.delete("/api/crm/stage-slas/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    await db.delete(crmStageSlas).where(and(eq(crmStageSlas.id, req.params.id), eq(crmStageSlas.organizationId, orgId)));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get("/api/crm/opportunities/needs-attention", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, orgId), isNotNull(crmOpportunities.slaBreachedAt)))
      .orderBy(desc(crmOpportunities.slaBreachedAt))
      .limit(200);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/sla/run-check", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const result = await checkAndFlagSlaBreaches(new Date(), orgId);
    res.json(result);
  } catch (e) { next(e); }
});

router.post("/api/admin/crm/sla/run-check-all", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res, next) => {
  try {
    const result = await checkAndFlagSlaBreaches();
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
