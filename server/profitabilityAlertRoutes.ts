import { logError } from "./utils/logger";
import { Router } from "express";
import { requireAuth } from "./auth";
import type { AuthRequest } from "./auth";
import { db } from "./db";
import { projects, organizations, users, projectProfitabilitySnapshots, notifications } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { calculateProjectProfitability } from "./ai/profitabilityEngine";
const router = Router();

function canAccessProfitability(role?: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "HUSTLER" ||
    role === "MANAGER" || role === "SUPERINTENDENT" || role === "ESTIMATOR";
}

router.get("/api/projects/:code/profitability/live", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;
    const orgId = req.user!.organizationId;

    if (!canAccessProfitability(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const [project] = await db.select().from(projects)
      .where(and(eq(projects.code, code), eq(projects.gcOrganizationId, orgId)))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const data = await calculateProjectProfitability(code);

    const [latestSnapshot] = await db.select()
      .from(projectProfitabilitySnapshots)
      .where(eq(projectProfitabilitySnapshots.projectId, project.id))
      .orderBy(desc(projectProfitabilitySnapshots.createdAt))
      .limit(1);

    return res.json({
      ...data,
      lastCalculated: new Date().toISOString(),
      previousSnapshot: latestSnapshot ? {
        totalActualCost: Number(latestSnapshot.totalActualCost),
        variancePercent: Number(latestSnapshot.variancePercent),
        status: latestSnapshot.status,
        createdAt: latestSnapshot.createdAt,
      } : null,
    });
  } catch (error) {
    logError("Live profitability error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to calculate profitability" });
  }
});

router.get("/api/projects/:code/profitability/history", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { code } = req.params;
    const orgId = req.user!.organizationId;

    if (!canAccessProfitability(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const [project] = await db.select().from(projects)
      .where(and(eq(projects.code, code), eq(projects.gcOrganizationId, orgId)))
      .limit(1);

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const snapshots = await db.select()
      .from(projectProfitabilitySnapshots)
      .where(eq(projectProfitabilitySnapshots.projectId, project.id))
      .orderBy(desc(projectProfitabilitySnapshots.createdAt))
      .limit(48);

    return res.json(snapshots);
  } catch (error) {
    logError("Profitability history error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch profitability history" });
  }
});

export default router;
