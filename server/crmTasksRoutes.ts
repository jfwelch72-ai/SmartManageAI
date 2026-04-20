import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import { crmTasks, insertCrmTaskSchema, users, crmOpportunities } from "@shared/schema";
import { and, eq, desc, asc, lte, gte, ne, type SQL, isNull, or } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logError } from "./utils/logger";
import { validateOrgRefs } from "./utils/orgRefValidator";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;

router.get("/api/crm/tasks", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const { status, assignedToId, opportunityId, mine, overdue } = req.query as Record<string, string>;
    const conditions: SQL[] = [eq(crmTasks.organizationId, orgId)];

    if (status) conditions.push(eq(crmTasks.status, status));
    if (assignedToId) conditions.push(eq(crmTasks.assignedToId, assignedToId));
    if (opportunityId) conditions.push(eq(crmTasks.opportunityId, opportunityId));
    if (mine === "1") conditions.push(eq(crmTasks.assignedToId, req.user!.id));
    if (overdue === "1") {
      conditions.push(lte(crmTasks.dueDate, new Date()));
      conditions.push(ne(crmTasks.status, "COMPLETED"));
      conditions.push(ne(crmTasks.status, "CANCELLED"));
    }

    const rows = await db
      .select({
        task: crmTasks,
        assigneeFirst: users.firstName,
        assigneeLast: users.lastName,
        opportunityName: crmOpportunities.name,
      })
      .from(crmTasks)
      .leftJoin(users, eq(crmTasks.assignedToId, users.id))
      .leftJoin(crmOpportunities, eq(crmTasks.opportunityId, crmOpportunities.id))
      .where(and(...conditions))
      .orderBy(asc(crmTasks.dueDate));

    res.json(rows.map((r) => ({
      ...r.task,
      assigneeName: r.assigneeFirst ? `${r.assigneeFirst} ${r.assigneeLast ?? ""}`.trim() : null,
      opportunityName: r.opportunityName,
    })));
  } catch (error) {
    next(error);
  }
});

const taskBodySchema = insertCrmTaskSchema.omit({ organizationId: true, createdById: true }).extend({
  dueDate: z.coerce.date(),
});

router.post("/api/crm/tasks", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = taskBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    const refCheck = await validateOrgRefs(orgId, { opportunityId: parsed.data.opportunityId, assignedToId: parsed.data.assignedToId });
    if (!refCheck.ok) return res.status(400).json({ error: `Invalid ${refCheck.field} for this organization` });
    const [created] = await db.insert(crmTasks).values({
      ...parsed.data,
      organizationId: orgId,
      createdById: req.user!.id,
    }).returning();
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

const taskPatchSchema = taskBodySchema.partial();

router.patch("/api/crm/tasks/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = taskPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const [existing] = await db.select().from(crmTasks).where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Task not found" });
    const refCheck = await validateOrgRefs(orgId, { opportunityId: parsed.data.opportunityId, assignedToId: parsed.data.assignedToId });
    if (!refCheck.ok) return res.status(400).json({ error: `Invalid ${refCheck.field} for this organization` });

    const body = parsed.data;
    const patch: Record<string, unknown> = { ...body, updatedAt: new Date() };

    if (body.status === "COMPLETED" && existing.status !== "COMPLETED") {
      patch.completedAt = new Date();
    } else if (body.status && body.status !== "COMPLETED" && existing.completedAt) {
      patch.completedAt = null;
    }

    const [updated] = await db.update(crmTasks).set(patch).where(eq(crmTasks.id, req.params.id)).returning();
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/crm/tasks/:id", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const result = await db.delete(crmTasks).where(and(eq(crmTasks.id, req.params.id), eq(crmTasks.organizationId, orgId))).returning();
    if (!result.length) return res.status(404).json({ error: "Task not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/api/crm/tasks/summary/mine", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const allMine = await db.select().from(crmTasks).where(and(
      eq(crmTasks.organizationId, orgId),
      eq(crmTasks.assignedToId, req.user!.id),
      ne(crmTasks.status, "COMPLETED"),
      ne(crmTasks.status, "CANCELLED"),
    ));

    const overdue = allMine.filter((t) => t.dueDate < now).length;
    const dueSoon = allMine.filter((t) => t.dueDate >= now && t.dueDate <= in24h).length;
    res.json({ overdue, dueSoon, openTotal: allMine.length });
  } catch (error) {
    next(error);
  }
});

export default router;
