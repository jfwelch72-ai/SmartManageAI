import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { crmAssignmentRules, insertCrmAssignmentRuleSchema } from "@shared/schema";
import { and, eq, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

router.get("/api/crm/assignment-rules", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(crmAssignmentRules).where(eq(crmAssignmentRules.organizationId, orgId)).orderBy(asc(crmAssignmentRules.priority));
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

const ruleBody = insertCrmAssignmentRuleSchema.omit({ organizationId: true });

router.post("/api/crm/assignment-rules", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = ruleBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [created] = await db.insert(crmAssignmentRules).values({
      ...parsed.data,
      organizationId: orgId,
    }).returning();
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/crm/assignment-rules/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = ruleBody.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const [existing] = await db.select().from(crmAssignmentRules).where(and(eq(crmAssignmentRules.id, req.params.id), eq(crmAssignmentRules.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Rule not found" });
    const [updated] = await db.update(crmAssignmentRules).set({ ...parsed.data, updatedAt: new Date() }).where(eq(crmAssignmentRules.id, req.params.id)).returning();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/crm/assignment-rules/:id", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const result = await db.delete(crmAssignmentRules).where(and(eq(crmAssignmentRules.id, req.params.id), eq(crmAssignmentRules.organizationId, orgId))).returning();
    if (!result.length) return res.status(404).json({ error: "Rule not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
