import { db } from "../db";
import {
  projectHealthSnapshots,
  projects,
  changeOrders,
  projectInspections,
  punchListItems,
  safetyIncidents,
  jobsiteAnalysisBatches,
  timeEntries,
  procurementItems,
  subcontractorContracts,
  subcontractorPayments,
  purchaseOrders,
  purchaseOrderItems,
  costLedgerPostings,
} from "@shared/schema";
import { eq, and, sql, desc, count } from "drizzle-orm";
import {logInfo, logError, logWarn } from "../utils/logger";
import { openai, AI_MODEL_GPT4O } from "../ai/openaiClient";

export interface HealthScoreBreakdown {
  scheduleScore: number;
  budgetScore: number;
  costScore: number;
  rfiSubmittalScore: number;
  changeOrderScore: number;
  safetyScore: number;
  overallScore: number;
  trendDirection: "improving" | "declining" | "stable";
  aiExplanation: string | null;
  factors: Record<string, any>;
}

const WEIGHTS = {
  cost: 0.40,
  schedule: 0.35,
  safety: 0.25,
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function calculateCostScore(projectId: string, project: any): Promise<{ score: number; factors: Record<string, any> }> {
  const baseBudget = Number(project.contractAmount || project.budget || 0);
  if (baseBudget <= 0) {
    return { score: 75, factors: { noBudgetData: true, baseBudget: 0 } };
  }

  const laborResult = await db
    .select({ total: sql<number>`COALESCE(SUM(COALESCE(${timeEntries.hoursRegular}, 0) + COALESCE(${timeEntries.hoursOvertime}, 0)), 0)` })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, projectId));
  const totalLaborHours = Number(laborResult[0]?.total || 0);
  const estimatedLaborCost = totalLaborHours * 50;

  const materialResult = await db
    .select({ total: sql<number>`COALESCE(SUM(COALESCE(${procurementItems.unitCost}, 0) * COALESCE(${procurementItems.quantity}, 0)), 0)` })
    .from(procurementItems)
    .where(eq(procurementItems.projectId, projectId));
  const totalMaterialCost = Number(materialResult[0]?.total || 0);

  const subCostResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${subcontractorPayments.amount}), 0)` })
    .from(subcontractorPayments)
    .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
    .where(eq(subcontractorContracts.projectId, projectId));
  const totalSubCost = Number(subCostResult[0]?.total || 0);

  const approvedCOs = await db
    .select({ total: sql<number>`COALESCE(SUM(${changeOrders.amount}), 0)` })
    .from(changeOrders)
    .where(and(eq(changeOrders.projectId, projectId), eq(changeOrders.status, "APPROVED")));
  const approvedCOValue = Number(approvedCOs[0]?.total || 0);

  const committedSubResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${subcontractorContracts.contractAmount}), 0)` })
    .from(subcontractorContracts)
    .where(and(eq(subcontractorContracts.projectId, projectId), sql`${subcontractorContracts.status} IN ('ACTIVE', 'PENDING', 'APPROVED')`));
  const committedSubTotal = Number(committedSubResult[0]?.total || 0);

  const committedPOResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${purchaseOrderItems.quantity} * ${purchaseOrderItems.unitCost}), 0)` })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.poId, purchaseOrders.id))
    .where(and(eq(purchaseOrders.projectId, projectId), sql`${purchaseOrders.status} IN ('APPROVED', 'SENT', 'PARTIAL', 'FULFILLED')`));
  const committedPOTotal = Number(committedPOResult[0]?.total || 0);

  const costLedgerResult = await db
    .select({ total: sql<number>`COALESCE(SUM(CAST(${costLedgerPostings.burdenedTotalAmount} AS numeric)), 0)` })
    .from(costLedgerPostings)
    .where(eq(costLedgerPostings.projectId, projectId));
  const totalCostLedger = Number(costLedgerResult[0]?.total || 0);

  const totalActualCost = Math.max(estimatedLaborCost + totalMaterialCost + totalSubCost, totalCostLedger);
  const adjustedBudget = baseBudget + approvedCOValue;
  const totalCommitted = committedSubTotal + committedPOTotal;
  const variancePercent = adjustedBudget > 0 ? ((adjustedBudget - totalActualCost) / adjustedBudget) * 100 : 0;
  const burnRate = adjustedBudget > 0 ? (totalActualCost / adjustedBudget) * 100 : 0;
  const committedRatio = adjustedBudget > 0 ? (totalCommitted / adjustedBudget) * 100 : 0;

  let score = 100;
  if (variancePercent < -20) score -= 50;
  else if (variancePercent < -10) score -= 35;
  else if (variancePercent < 0) score -= 20;
  else if (variancePercent < 5) score -= 10;

  if (burnRate > 100) score -= 15;
  else if (burnRate > 90) score -= 5;

  if (committedRatio > 110) score -= 10;
  else if (committedRatio > 100) score -= 5;

  return {
    score: clampScore(score),
    factors: {
      baseBudget,
      adjustedBudget,
      totalActualCost: Math.round(totalActualCost * 100) / 100,
      totalCostLedger: Math.round(totalCostLedger * 100) / 100,
      variancePercent: Math.round(variancePercent * 100) / 100,
      burnRate: Math.round(burnRate * 100) / 100,
      totalCommitted: Math.round(totalCommitted * 100) / 100,
      committedRatio: Math.round(committedRatio * 100) / 100,
    },
  };
}

async function calculateScheduleScore(projectId: string, project: any): Promise<{ score: number; factors: Record<string, any> }> {
  const startDate = project.startDate ? new Date(project.startDate) : null;
  const endDate = project.estimatedCompletionDate ? new Date(project.estimatedCompletionDate) : null;
  const now = new Date();

  if (!startDate || !endDate || endDate <= startDate) {
    return { score: 75, factors: { noScheduleData: true } };
  }

  const totalDuration = endDate.getTime() - startDate.getTime();
  const elapsed = now.getTime() - startDate.getTime();
  const percentTimeElapsed = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

  const failedInspections = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(projectInspections)
    .where(and(
      eq(projectInspections.projectId, projectId),
      eq(projectInspections.status, "FAILED")
    ));
  const failedInspCount = Number(failedInspections[0]?.cnt || 0);

  const reinspections = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(projectInspections)
    .where(and(
      eq(projectInspections.projectId, projectId),
      eq(projectInspections.reinspectionRequired, true)
    ));
  const reinspectionCount = Number(reinspections[0]?.cnt || 0);

  const openPunchItems = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(punchListItems)
    .where(and(
      eq(punchListItems.projectId, projectId),
      sql`${punchListItems.status} IN ('OPEN', 'IN_PROGRESS')`
    ));
  const openPunchCount = Number(openPunchItems[0]?.cnt || 0);

  const estimatedPercentComplete = Math.max(0, percentTimeElapsed - (failedInspCount * 3) - (openPunchCount * 1));
  const scheduleVariance = estimatedPercentComplete - percentTimeElapsed;

  let score = 100;
  if (scheduleVariance < -30) score -= 50;
  else if (scheduleVariance < -20) score -= 35;
  else if (scheduleVariance < -10) score -= 20;
  else if (scheduleVariance < -5) score -= 10;

  if (failedInspCount > 5) score -= 15;
  else if (failedInspCount > 2) score -= 8;
  else if (failedInspCount > 0) score -= 3;

  if (reinspectionCount > 3) score -= 10;
  else if (reinspectionCount > 0) score -= 5;

  if (openPunchCount > 20) score -= 10;
  else if (openPunchCount > 10) score -= 5;

  const isOverdue = now > endDate;
  if (isOverdue) {
    const daysOverdue = Math.ceil((now.getTime() - endDate.getTime()) / 86400000);
    if (daysOverdue > 30) score -= 25;
    else if (daysOverdue > 14) score -= 15;
    else score -= 8;
  }

  return {
    score: clampScore(score),
    factors: {
      percentTimeElapsed: Math.round(percentTimeElapsed * 100) / 100,
      estimatedPercentComplete: Math.round(estimatedPercentComplete * 100) / 100,
      scheduleVariance: Math.round(scheduleVariance * 100) / 100,
      failedInspections: failedInspCount,
      reinspections: reinspectionCount,
      openPunchItems: openPunchCount,
      isOverdue,
      daysOverdue: isOverdue ? Math.ceil((now.getTime() - endDate.getTime()) / 86400000) : 0,
    },
  };
}

async function calculateSafetyScore(orgId: string, projectId: string): Promise<{ score: number; factors: Record<string, any> }> {
  const incidentsResult = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(safetyIncidents)
    .where(eq(safetyIncidents.organizationId, orgId));
  const orgTotalIncidents = Number(incidentsResult[0]?.cnt || 0);

  const activeProjectCount = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(projects)
    .where(and(eq(projects.gcOrganizationId, orgId), eq(projects.status, "ACTIVE")));
  const numActiveProjects = Math.max(1, Number(activeProjectCount[0]?.cnt || 1));
  const totalIncidents = Math.ceil(orgTotalIncidents / numActiveProjects);

  const failedInspections = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(projectInspections)
    .where(and(
      eq(projectInspections.projectId, projectId),
      eq(projectInspections.status, "FAILED")
    ));
  const failedInspCount = Number(failedInspections[0]?.cnt || 0);

  const jobsiteIssues = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(jobsiteAnalysisBatches)
    .where(and(
      eq(jobsiteAnalysisBatches.projectId, projectId),
      sql`${jobsiteAnalysisBatches.safetyFindingsJson} IS NOT NULL AND ${jobsiteAnalysisBatches.safetyFindingsJson} != '[]' AND ${jobsiteAnalysisBatches.safetyFindingsJson} != 'null'`
    ));
  const jobsiteIssueCount = Number(jobsiteIssues[0]?.cnt || 0);

  const openPunchSafety = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(punchListItems)
    .where(and(
      eq(punchListItems.projectId, projectId),
      sql`${punchListItems.status} IN ('OPEN', 'IN_PROGRESS')`,
      eq(punchListItems.priority, "HIGH")
    ));
  const highPriorityPunch = Number(openPunchSafety[0]?.cnt || 0);

  let score = 100;
  if (totalIncidents > 5) score -= 30;
  else if (totalIncidents > 2) score -= 15;
  else if (totalIncidents > 0) score -= 5;

  if (failedInspCount > 5) score -= 20;
  else if (failedInspCount > 2) score -= 10;
  else if (failedInspCount > 0) score -= 5;

  if (jobsiteIssueCount > 3) score -= 15;
  else if (jobsiteIssueCount > 0) score -= 5;

  if (highPriorityPunch > 5) score -= 10;
  else if (highPriorityPunch > 0) score -= 5;

  return {
    score: clampScore(score),
    factors: {
      safetyIncidents: totalIncidents,
      orgTotalIncidents: orgTotalIncidents,
      activeProjects: numActiveProjects,
      failedInspections: failedInspCount,
      jobsiteIssuesWithSafetyFindings: jobsiteIssueCount,
      highPriorityPunchItems: highPriorityPunch,
    },
  };
}

async function calculateTrend(orgId: string, projectId: string, currentScore: number): Promise<"improving" | "declining" | "stable"> {
  const history = await db
    .select({ overallScore: projectHealthSnapshots.overallScore })
    .from(projectHealthSnapshots)
    .where(and(
      eq(projectHealthSnapshots.organizationId, orgId),
      eq(projectHealthSnapshots.projectId, projectId)
    ))
    .orderBy(desc(projectHealthSnapshots.createdAt))
    .limit(3);

  if (history.length < 1) return "stable";

  const previousScore = history[0].overallScore;
  const diff = currentScore - previousScore;

  if (diff >= 5) return "improving";
  if (diff <= -5) return "declining";
  return "stable";
}

async function generateAIExplanation(
  projectName: string,
  currentScore: number,
  previousScore: number | null,
  costFactors: Record<string, any>,
  scheduleFactors: Record<string, any>,
  safetyFactors: Record<string, any>,
  costScore: number,
  scheduleScore: number,
  safetyScore: number,
): Promise<string | null> {
  try {
    const prompt = `You are a construction project health analyst. Generate a brief, 1-2 sentence natural-language explanation of the project health score.

Project: ${projectName}
Current Overall Score: ${currentScore}/100
${previousScore !== null ? `Previous Score: ${previousScore}/100` : "First score calculation"}

Sub-scores:
- Cost Risk Score: ${costScore}/100 (factors: budget variance ${costFactors.variancePercent ?? 'N/A'}%, burn rate ${costFactors.burnRate ?? 'N/A'}%)
- Schedule Risk Score: ${scheduleScore}/100 (factors: ${scheduleFactors.isOverdue ? `${scheduleFactors.daysOverdue} days overdue` : 'on track'}, ${scheduleFactors.failedInspections || 0} failed inspections, ${scheduleFactors.openPunchItems || 0} open punch items)
- Safety Risk Score: ${safetyScore}/100 (factors: ${safetyFactors.safetyIncidents || 0} incidents, ${safetyFactors.failedInspections || 0} failed inspections, ${safetyFactors.jobsiteIssuesWithSafetyFindings || 0} AI-detected issues)

${previousScore !== null && previousScore !== currentScore ? `Score changed from ${previousScore} to ${currentScore}.` : ""}

Provide a concise explanation focusing on what's driving the score ${previousScore !== null && currentScore < previousScore ? 'down' : previousScore !== null && currentScore > previousScore ? 'up' : ''}.`;

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: "system", content: "You are a construction project health analyst. Be concise and specific." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 200,
    });

    return completion.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    logError("Failed to generate AI health explanation", { error: String(err) });
    return null;
  }
}

export async function computeProjectHealth(orgId: string, projectId: string): Promise<HealthScoreBreakdown> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const [costResult, scheduleResult, safetyResult] = await Promise.all([
    calculateCostScore(projectId, project),
    calculateScheduleScore(projectId, project),
    calculateSafetyScore(orgId, projectId),
  ]);

  const overallScore = clampScore(
    costResult.score * WEIGHTS.cost +
    scheduleResult.score * WEIGHTS.schedule +
    safetyResult.score * WEIGHTS.safety
  );

  const trendDirection = await calculateTrend(orgId, projectId, overallScore);

  const previousSnapshots = await db
    .select({ overallScore: projectHealthSnapshots.overallScore })
    .from(projectHealthSnapshots)
    .where(and(
      eq(projectHealthSnapshots.organizationId, orgId),
      eq(projectHealthSnapshots.projectId, projectId)
    ))
    .orderBy(desc(projectHealthSnapshots.createdAt))
    .limit(1);
  const previousScore = previousSnapshots.length > 0 ? previousSnapshots[0].overallScore : null;

  let aiExplanation: string | null = null;
  try {
    aiExplanation = await generateAIExplanation(
      project.name,
      overallScore,
      previousScore,
      costResult.factors,
      scheduleResult.factors,
      safetyResult.factors,
      costResult.score,
      scheduleResult.score,
      safetyResult.score,
    );
  } catch {
    logWarn("Non-critical operation failed");
    aiExplanation = null;
  }

  return {
    scheduleScore: scheduleResult.score,
    budgetScore: costResult.score,
    costScore: costResult.score,
    rfiSubmittalScore: clampScore(85),
    changeOrderScore: clampScore(
      100 - Math.min(30, (costResult.factors.variancePercent < 0 ? Math.abs(costResult.factors.variancePercent) : 0))
    ),
    safetyScore: safetyResult.score,
    overallScore,
    trendDirection,
    aiExplanation,
    factors: {
      cost: costResult.factors,
      schedule: scheduleResult.factors,
      safety: safetyResult.factors,
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
    costScore: breakdown.costScore,
    rfiSubmittalScore: breakdown.rfiSubmittalScore,
    changeOrderScore: breakdown.changeOrderScore,
    safetyScore: breakdown.safetyScore,
    trendDirection: breakdown.trendDirection,
    aiExplanation: breakdown.aiExplanation,
    breakdown: breakdown.factors,
    snapshotDate: today,
  }).returning();

  logInfo("Health snapshot saved", { snapshotId: snapshot.id, orgId, projectId, score: breakdown.overallScore, trend: breakdown.trendDirection });
  return snapshot;
}

export async function getLatestSnapshot(orgId: string, projectId: string) {
  const [snapshot] = await db.select().from(projectHealthSnapshots)
    .where(and(
      eq(projectHealthSnapshots.organizationId, orgId),
      eq(projectHealthSnapshots.projectId, projectId)
    ))
    .orderBy(desc(projectHealthSnapshots.createdAt))
    .limit(1);
  return snapshot || null;
}

export async function getSnapshotHistory(orgId: string, projectId: string, limit: number = 30) {
  return db.select().from(projectHealthSnapshots)
    .where(and(
      eq(projectHealthSnapshots.organizationId, orgId),
      eq(projectHealthSnapshots.projectId, projectId)
    ))
    .orderBy(desc(projectHealthSnapshots.createdAt))
    .limit(limit);
}

export async function getOrgHealthOverview(orgId: string) {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (ph.project_id)
      ph.project_id,
      ph.overall_score,
      ph.schedule_score,
      ph.budget_score,
      ph.cost_score,
      ph.safety_score,
      ph.trend_direction,
      ph.ai_explanation,
      ph.snapshot_date,
      p.name as project_name
    FROM project_health_snapshots ph
    JOIN projects p ON p.id = ph.project_id
    WHERE ph.organization_id = ${orgId}
      AND p.status NOT IN ('COMPLETE', 'CLOSED')
    ORDER BY ph.project_id, ph.created_at DESC
  `);
  return result.rows || [];
}

export async function getPortfolioHealthSummary(orgId: string) {
  const overview = await getOrgHealthOverview(orgId) as any[];

  if (overview.length === 0) {
    return {
      totalProjects: 0,
      averageScore: 0,
      healthyCount: 0,
      atRiskCount: 0,
      criticalCount: 0,
      worstProjects: [],
      decliningProjects: [],
    };
  }

  const scores = overview.map((p: any) => Number(p.overall_score || 0));
  const averageScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);

  const healthyCount = overview.filter((p: any) => Number(p.overall_score) >= 80).length;
  const atRiskCount = overview.filter((p: any) => Number(p.overall_score) >= 60 && Number(p.overall_score) < 80).length;
  const criticalCount = overview.filter((p: any) => Number(p.overall_score) < 60).length;

  const worstProjects = [...overview]
    .sort((a: any, b: any) => Number(a.overall_score) - Number(b.overall_score))
    .slice(0, 5)
    .map((p: any) => ({
      projectId: p.project_id,
      projectName: p.project_name,
      overallScore: Number(p.overall_score),
      costScore: Number(p.cost_score || p.budget_score || 0),
      scheduleScore: Number(p.schedule_score || 0),
      safetyScore: Number(p.safety_score || 0),
      trendDirection: p.trend_direction || "stable",
      aiExplanation: p.ai_explanation,
    }));

  const decliningProjects = overview
    .filter((p: any) => p.trend_direction === "declining")
    .map((p: any) => ({
      projectId: p.project_id,
      projectName: p.project_name,
      overallScore: Number(p.overall_score),
      trendDirection: p.trend_direction,
    }));

  return {
    totalProjects: overview.length,
    averageScore,
    healthyCount,
    atRiskCount,
    criticalCount,
    worstProjects,
    decliningProjects,
  };
}

export async function recalculateProjectHealthByProjectId(orgId: string, projectId: string): Promise<void> {
  try {
    const breakdown = await computeProjectHealth(orgId, projectId);
    await saveHealthSnapshot(orgId, projectId, breakdown);
    logInfo("Health score recalculated via event", { orgId, projectId, score: breakdown.overallScore });
  } catch (err) {
    logError("Failed to recalculate health score", { error: String(err), orgId, projectId });
  }
}
