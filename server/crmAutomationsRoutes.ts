import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { crmAutomations, insertCrmAutomationSchema, crmAutomationRuns } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

const actionSchema = z.object({
  type: z.enum(["ASSIGN", "NOTIFY", "CREATE_TASK", "ENROLL_SEQUENCE", "UPDATE_FIELD", "WEBHOOK", "SEND_SMS"]),
  config: z.record(z.any()).default({}),
});

const automationBody = insertCrmAutomationSchema.omit({ organizationId: true, createdById: true }).extend({
  actions: z.array(actionSchema).min(1),
  triggerConfig: z.record(z.any()).default({}),
});

router.get("/api/crm/automations", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmAutomations).where(eq(crmAutomations.organizationId, orgId)).orderBy(desc(crmAutomations.createdAt));
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/automations", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = automationBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmAutomations).values({
      ...(parsed.data as any),
      organizationId: orgId,
      createdById: req.user!.id,
    }).returning();
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch("/api/crm/automations/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = automationBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [updated] = await db.update(crmAutomations).set({ ...(parsed.data as any), updatedAt: new Date() })
      .where(and(eq(crmAutomations.id, req.params.id), eq(crmAutomations.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/api/crm/automations/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    await db.delete(crmAutomations).where(and(eq(crmAutomations.id, req.params.id), eq(crmAutomations.organizationId, orgId)));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get("/api/crm/automations/:id/runs", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmAutomationRuns)
      .where(and(eq(crmAutomationRuns.organizationId, orgId), eq(crmAutomationRuns.automationId, req.params.id)))
      .orderBy(desc(crmAutomationRuns.createdAt))
      .limit(100);
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
