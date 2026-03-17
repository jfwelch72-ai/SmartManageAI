import { db } from "../db";
import { projectHealthSnapshots, projects, changeOrders } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";

export interface HealthScoreBreakdown {
  scheduleScore: number;
  budgetScore: number;
  rfiSubmittalScore: number;
  changeOrderScore: number;
  safetyScore: number;
  overallScore: number;
  factors: Record<string, any>;
}

const WEIGHTS = {
  schedule: 0.25,
  budget: 0.25,
  rfiSubmittal: 0.20,
  changeOrder: 0.15,
  safety: 0.15,
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function computeProjectHealth(orgId: string, projectId: string): Promise<HealthScoreBreakdown> {
  const scheduleScore = clampScore(75);
  const budgetScore = clampScore(80);
  const rfiSubmittalScore = clampScore(85);
  const changeOrderScore = clampScore(70);
  const safetyScore = clampScore(90);

  const overallScore = clampScore(
    scheduleScore * WEIGHTS.schedule +
    budgetScore * WEIGHTS.budget +
    rfiSubmittalScore * WEIGHTS.rfiSubmittal +
    changeOrderScore * WEIGHTS.changeOrder +
    safetyScore * WEIGHTS.safety
  );

  return {
    scheduleScore,
    budgetScore,
    rfiSubmittalScore,
    changeOrderScore,
    safetyScore,
    overallScore,
    factors: {
      scheduleVarianceDays: 0,
      budgetBurnPercent: 0,
      openRfiCount: 0,
      openSubmittalCount: 0,
      openCoCount: 0,
      safetyIncidentCount: 0,
    },
  };
}

export async function saveHealthSnapshot(orgId: string, projectId: string, breakdown: HealthScoreBreakdown) {
  const today = new Date().toISOString().split("T")[0];

  const [snapshot] = await db.insert(projectHealthSnapshots).values({
    organizationId: orgId,
    projectId,
    overallScore: breakdown.overallScore,
    scheduleScore: breakdown.scheduleScore,
    budgetScore: breakdown.budgetScore,
    rfiSubmittalScore: breakdown.rfiSubmittalScore,
    changeOrderScore: breakdown.changeOrderScore,
    safetyScore: breakdown.safetyScore,
    breakdown: breakdown.factors,
    snapshotDate: today,
  }).returning();

  logInfo("Health snapshot saved", { snapshotId: snapshot.id, orgId, projectId, score: breakdown.overallScore });
  return snapshot;
}

export async function getLatestSnapshot(orgId: string, projectId: string) {
  const [snapshot] = await db.select().from(projectHealthSnapshots)
    .where(and(
      eq(projectHealthSnapshots.organizationId, orgId),
      eq(projectHealthSnapshots.projectId, projectId)
    ))
    .orderBy(desc(projectHealthSnapshots.snapshotDate))
    .limit(1);
  return snapshot || null;
}

export async function getSnapshotHistory(orgId: string, projectId: string, limit: number = 30) {
  return db.select().from(projectHealthSnapshots)
    .where(and(
      eq(projectHealthSnapshots.organizationId, orgId),
      eq(projectHealthSnapshots.projectId, projectId)
    ))
    .orderBy(desc(projectHealthSnapshots.snapshotDate))
    .limit(limit);
}

export async function getOrgHealthOverview(orgId: string) {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (ph.project_id)
      ph.project_id,
      ph.overall_score,
      ph.schedule_score,
      ph.budget_score,
      ph.snapshot_date,
      p.name as project_name
    FROM project_health_snapshots ph
    JOIN projects p ON p.id = ph.project_id
    WHERE ph.organization_id = ${orgId}
      AND p.status = 'ACTIVE'
    ORDER BY ph.project_id, ph.snapshot_date DESC
  `);
  return result.rows || [];
}
