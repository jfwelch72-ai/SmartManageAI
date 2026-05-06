import { logError } from "./utils/logger";
import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import { requireAuth, type AuthRequest } from "./auth";
import {
  safetyObservations,
  insertSafetyObservationSchema,
  punchListItems,
  projects,
} from "@shared/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { parseOrRespond } from "./utils/validation";

const router = Router();

function canManageSafety(role?: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT"].includes(role || "");
}

function canViewSafety(role?: string): boolean {
  return canManageSafety(role) || ["ESTIMATOR", "FIELD_WORKER"].includes(role || "");
}

router.get("/api/safety/observations", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    const { projectId, observationType, status, severity, startDate, endDate } = req.query;
    const conds = [eq(safetyObservations.organizationId, orgId)];
    if (projectId && typeof projectId === "string") conds.push(eq(safetyObservations.projectId, projectId));
    if (observationType && typeof observationType === "string") conds.push(eq(safetyObservations.observationType, observationType));
    if (status && typeof status === "string") conds.push(eq(safetyObservations.status, status));
    if (severity && typeof severity === "string") conds.push(eq(safetyObservations.severity, severity));
    if (startDate && typeof startDate === "string") conds.push(gte(safetyObservations.observedAt, new Date(startDate)));
    if (endDate && typeof endDate === "string") conds.push(lte(safetyObservations.observedAt, new Date(endDate)));
    const rows = await db.select().from(safetyObservations).where(and(...conds)).orderBy(desc(safetyObservations.observedAt));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/api/safety/observations/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    const [row] = await db.select().from(safetyObservations)
      .where(and(eq(safetyObservations.id, req.params.id), eq(safetyObservations.organizationId, orgId)));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post("/api/safety/observations", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;

    if (req.body.projectId) {
      const [proj] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, req.body.projectId), eq(projects.gcOrganizationId, orgId)));
      if (!proj) return res.status(400).json({ error: "Project not found in organization" });
    }

    const userName = `${req.user!.firstName || ""} ${req.user!.lastName || ""}`.trim();
    const parsed = parseOrRespond(insertSafetyObservationSchema, {
      ...req.body,
      organizationId: orgId,
      observedBy: req.user!.id,
      observedByName: req.body.observedByName || userName || "Unknown",
      observedAt: req.body.observedAt ? new Date(req.body.observedAt) : new Date(),
    }, res);
    if (!parsed) return;

    const [created] = await db.insert(safetyObservations).values(parsed).returning();

    // Auto-create corrective action (punch list item) for at-risk observations on a project
    if (created.observationType === "AT_RISK" && created.projectId && (created.severity === "HIGH" || created.severity === "CRITICAL")) {
      try {
        const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(punchListItems).where(eq(punchListItems.projectId, created.projectId));
        const seq = String((countResult?.count ?? 0) + 1).padStart(3, "0");
        const itemNumber = `SAF-${created.projectId.slice(0, 6).toUpperCase()}-${seq}`;
        const priority = created.severity === "CRITICAL" ? "CRITICAL" : "HIGH";
        const [punch] = await db.insert(punchListItems).values({
          projectId: created.projectId,
          itemNumber,
          title: `Safety: ${created.category} – ${created.description.slice(0, 60)}`,
          description: `Auto-created from safety observation.\n\nCategory: ${created.category}\nSeverity: ${created.severity}\nLocation: ${created.location || "n/a"}\n\n${created.description}`,
          location: created.location ?? null,
          trade: "GENERAL",
          priority,
          status: "OPEN",
          createdById: req.user!.id,
        }).returning();
        await db.update(safetyObservations).set({ correctiveActionId: punch.id, updatedAt: new Date() })
          .where(eq(safetyObservations.id, created.id));
        created.correctiveActionId = punch.id;
      } catch (e) {
        logError("Failed to auto-create corrective action", e);
      }
    }

    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: msg });
  }
});

router.patch("/api/safety/observations/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    const allowed = ["observationType", "category", "severity", "location", "description", "immediateAction", "photos", "involvedPartyName", "involvedTrade", "status"] as const;
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.status === "CLOSED") {
      updates.closedAt = new Date();
      updates.closedBy = req.user!.id;
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(safetyObservations).set(updates)
      .where(and(eq(safetyObservations.id, req.params.id), eq(safetyObservations.organizationId, orgId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: msg });
  }
});

router.delete("/api/safety/observations/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canManageSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    await db.delete(safetyObservations)
      .where(and(eq(safetyObservations.id, req.params.id), eq(safetyObservations.organizationId, orgId)));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/api/safety/observations-stats/summary", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!canViewSafety(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const orgId = req.user!.organizationId!;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await db.select().from(safetyObservations)
      .where(and(eq(safetyObservations.organizationId, orgId), gte(safetyObservations.observedAt, ninetyDaysAgo)));
    const total = rows.length;
    const positive = rows.filter(r => r.observationType === "POSITIVE").length;
    const atRisk = rows.filter(r => r.observationType === "AT_RISK").length;
    const open = rows.filter(r => r.status === "OPEN").length;
    const closed = rows.filter(r => r.status === "CLOSED").length;
    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    const positiveRatio = total ? positive / total : 0;
    res.json({ total, positive, atRisk, open, closed, byCategory, positiveRatio, windowDays: 90 });
  } catch (err) {
    next(err);
  }
});

export default router;
