import { db } from "../db";
import { 
  projects, 
  scopeItems, 
  timeEntries, 
  procurementItems, 
  users,
  aiDataQuality 
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export interface ProjectDataQualityScore {
  projectId: string;
  overallScore: number;
  financialDataScore: number;
  laborDataScore: number;
  materialDataScore: number;
  timelineDataScore: number;
  scopeDataScore: number;
  missingFields: string[];
  recommendations: string[];
}

export async function calculateProjectDataQuality(projectCode: string): Promise<ProjectDataQualityScore> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.code, projectCode))
    .limit(1);

  if (!project) {
    throw new Error(`Project ${projectCode} not found`);
  }

  const missingFields: string[] = [];
  const recommendations: string[] = [];

  // Financial Data Score (0-100)
  let financialScore = 0;
  if (project.budget && Number(project.budget) > 0) financialScore += 50;
  else {
    missingFields.push("budget");
    recommendations.push("Add project budget for profitability tracking");
  }
  
  if (project.contractAmount && Number(project.contractAmount) > 0) financialScore += 50;
  else {
    missingFields.push("contractAmount");
    recommendations.push("Add contract amount for accurate billing");
  }

  // Labor Data Score (0-100)
  const timeEntriesCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(timeEntries)
    .where(eq(timeEntries.projectId, project.id));

  const laborEntriesCount = Number(timeEntriesCount[0]?.count || 0);
  let laborScore = 0;

  if (laborEntriesCount > 0) laborScore += 40;
  if (laborEntriesCount >= 5) laborScore += 30;
  if (laborEntriesCount >= 20) laborScore += 30;

  if (laborEntriesCount === 0) {
    missingFields.push("timeEntries");
    recommendations.push("Start tracking time entries for accurate labor cost analysis");
  }

  // Check if users have cost rates
  const usersWithoutRates = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(sql`${users.costRateRegular} IS NULL OR ${users.costRateOvertime} IS NULL`);

  if (Number(usersWithoutRates[0]?.count || 0) > 0) {
    recommendations.push(`${usersWithoutRates[0]?.count || 0} users missing cost rates - profitability calculations will be less accurate`);
  }

  // Material Data Score (0-100)
  const materialsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(procurementItems)
    .where(eq(procurementItems.projectId, project.id));

  const materialEntriesCount = Number(materialsCount[0]?.count || 0);
  let materialScore = materialEntriesCount > 0 ? 60 : 0;
  if (materialEntriesCount >= 5) materialScore += 20;
  if (materialEntriesCount >= 15) materialScore += 20;

  if (materialEntriesCount === 0) {
    recommendations.push("Add procurement items to track material costs");
  }

  // Timeline Data Score (0-100)
  let timelineScore = 0;
  if (project.startDate) timelineScore += 50;
  else {
    missingFields.push("startDate");
    recommendations.push("Add project start date for schedule tracking");
  }

  if (project.estimatedCompletionDate) timelineScore += 50;
  else {
    missingFields.push("estimatedCompletionDate");
    recommendations.push("Add estimated completion date for timeline analysis");
  }

  // Scope Data Score (0-100)
  const scopeItemsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(scopeItems)
    .where(eq(scopeItems.projectId, project.id));

  const scopeCount = Number(scopeItemsCount[0]?.count || 0);
  let scopeScore = scopeCount > 0 ? 60 : 0;
  if (scopeCount >= 5) scopeScore += 20;
  if (scopeCount >= 10) scopeScore += 20;

  if (scopeCount === 0) {
    missingFields.push("scopeItems");
    recommendations.push("Define scope items to track project progress");
  }

  // Overall Score (weighted average)
  const overallScore = Math.round(
    (financialScore * 0.3) +
    (laborScore * 0.25) +
    (materialScore * 0.15) +
    (timelineScore * 0.15) +
    (scopeScore * 0.15)
  );

  return {
    projectId: project.id,
    overallScore,
    financialDataScore: financialScore,
    laborDataScore: laborScore,
    materialDataScore: materialScore,
    timelineDataScore: timelineScore,
    scopeDataScore: scopeScore,
    missingFields,
    recommendations,
  };
}

export async function saveProjectDataQuality(score: ProjectDataQualityScore): Promise<void> {
  await db
    .insert(aiDataQuality)
    .values({
      projectId: score.projectId,
      overallScore: score.overallScore,
      financialDataScore: score.financialDataScore,
      laborDataScore: score.laborDataScore,
      materialDataScore: score.materialDataScore,
      timelineDataScore: score.timelineDataScore,
      scopeDataScore: score.scopeDataScore,
      missingFields: score.missingFields,
      recommendations: score.recommendations,
    });
}
