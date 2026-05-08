import { logError } from "./utils/logger";
import { db } from "./db";
import {
  projects,
  changeOrders,
  payApplications,
  revenueRecognition,
  type RevenueRecognition,
} from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { calculateCostLedger } from "./costLedgerService";

export interface WipProjectData {
  projectId: string;
  projectCode: string;
  projectName: string;
  clientName: string | null;
  contractValue: number;
  changeOrderAdjustments: number;
  adjustedContractValue: number;
  costsToDate: number;
  estimatedTotalCost: number;
  percentComplete: number;
  earnedRevenue: number;
  billingsToDate: number;
  overUnderBilling: number;
  grossProfit: number;
  grossProfitPercent: number;
}

export async function calculateProjectWip(projectId: string): Promise<WipProjectData> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const contractValue = Number(project.contractAmount || project.budget || 0);

  const approvedCOs = await db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${changeOrders.amount} AS NUMERIC)), 0)`.as("total"),
    })
    .from(changeOrders)
    .where(and(eq(changeOrders.projectId, projectId), eq(changeOrders.status, "APPROVED")));

  const changeOrderAdjustments = Number(approvedCOs[0]?.total || 0);
  const adjustedContractValue = contractValue + changeOrderAdjustments;

  const projectBudget = Number(project.contractAmount || project.budget || 0);
  const ledger = await calculateCostLedger(
    projectId,
    projectBudget,
    project.startDate,
    project.estimatedCompletionDate,
    Number(project.budgetAlertThreshold || 80),
    Number(project.budgetCriticalThreshold || 95),
  );

  const costsToDate = ledger.totals.actualTotal;

  const estimatedTotalCost = ledger.totals.ffc > 0 ? ledger.totals.ffc : (ledger.budgetLineTotal > 0 ? ledger.budgetLineTotal : costsToDate);

  let percentComplete = 0;
  if (estimatedTotalCost > 0) {
    percentComplete = Math.min(100, (costsToDate / estimatedTotalCost) * 100);
  }

  const earnedRevenue = (percentComplete / 100) * adjustedContractValue;

  const billingResult = await db
    .select({
      totalCompletedAndStored: payApplications.totalCompletedAndStored,
    })
    .from(payApplications)
    .where(and(
      eq(payApplications.projectId, projectId),
      sql`${payApplications.status} IN ('APPROVED', 'PAID')`,
    ))
    .orderBy(desc(payApplications.applicationNumber))
    .limit(1);

  const billingsToDate = Number(billingResult[0]?.totalCompletedAndStored || 0);

  const overUnderBilling = earnedRevenue - billingsToDate;

  const grossProfit = earnedRevenue - costsToDate;
  const grossProfitPercent = earnedRevenue > 0 ? (grossProfit / earnedRevenue) * 100 : 0;

  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    clientName: project.clientName || null,
    contractValue: round2(contractValue),
    changeOrderAdjustments: round2(changeOrderAdjustments),
    adjustedContractValue: round2(adjustedContractValue),
    costsToDate: round2(costsToDate),
    estimatedTotalCost: round2(estimatedTotalCost),
    percentComplete: round4(percentComplete),
    earnedRevenue: round2(earnedRevenue),
    billingsToDate: round2(billingsToDate),
    overUnderBilling: round2(overUnderBilling),
    grossProfit: round2(grossProfit),
    grossProfitPercent: round4(grossProfitPercent),
  };
}

export async function calculateAllProjectsWip(orgId?: string): Promise<WipProjectData[]> {
  const baseWhere = orgId
    ? and(
        sql`${projects.status} IN ('ACTIVE', 'PLANNING')`,
        eq(projects.gcOrganizationId, orgId),
      )
    : sql`${projects.status} IN ('ACTIVE', 'PLANNING')`;
  const activeProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(baseWhere)
    .limit(200);

  const results: WipProjectData[] = [];
  for (const p of activeProjects) {
    try {
      const wip = await calculateProjectWip(p.id);
      results.push(wip);
    } catch (error) {
      logError(`Error calculating WIP for project ${p.id}:`, {}, error instanceof Error ? error : new Error(String(error)));
    }
  }

  return results;
}

export async function generateMonthlySnapshot(orgId: string): Promise<number> {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const snapshotDate = now.toISOString().split("T")[0];

  const wipData = await calculateAllProjectsWip(orgId);

  let count = 0;
  for (const wip of wipData) {
    const existing = await db
      .select({ id: revenueRecognition.id })
      .from(revenueRecognition)
      .where(and(
        eq(revenueRecognition.projectId, wip.projectId),
        eq(revenueRecognition.period, period),
      ))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(revenueRecognition)
        .set({
          contractValue: String(wip.contractValue),
          changeOrderAdjustments: String(wip.changeOrderAdjustments),
          adjustedContractValue: String(wip.adjustedContractValue),
          costsToDate: String(wip.costsToDate),
          estimatedTotalCost: String(wip.estimatedTotalCost),
          percentComplete: String(wip.percentComplete),
          earnedRevenue: String(wip.earnedRevenue),
          billingsToDate: String(wip.billingsToDate),
          overUnderBilling: String(wip.overUnderBilling),
          grossProfit: String(wip.grossProfit),
          grossProfitPercent: String(wip.grossProfitPercent),
          snapshotDate,
          updatedAt: new Date(),
        })
        .where(eq(revenueRecognition.id, existing[0].id));
    } else {
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, wip.projectId))
        .limit(1);

      await db.insert(revenueRecognition).values({
        organizationId: project?.gcOrganizationId || orgId,
        projectId: wip.projectId,
        period,
        snapshotDate,
        contractValue: String(wip.contractValue),
        changeOrderAdjustments: String(wip.changeOrderAdjustments),
        adjustedContractValue: String(wip.adjustedContractValue),
        costsToDate: String(wip.costsToDate),
        estimatedTotalCost: String(wip.estimatedTotalCost),
        percentComplete: String(wip.percentComplete),
        earnedRevenue: String(wip.earnedRevenue),
        billingsToDate: String(wip.billingsToDate),
        overUnderBilling: String(wip.overUnderBilling),
        grossProfit: String(wip.grossProfit),
        grossProfitPercent: String(wip.grossProfitPercent),
      });
    }
    count++;
  }

  return count;
}

export async function getHistoricalSnapshots(
  orgId: string,
  projectId?: string,
  months: number = 12,
  startDate?: string,
  endDate?: string,
): Promise<RevenueRecognition[]> {
  const conditions = [eq(revenueRecognition.organizationId, orgId)];
  if (projectId) {
    conditions.push(eq(revenueRecognition.projectId, projectId));
  }

  if (startDate) {
    conditions.push(sql`${revenueRecognition.period} >= ${startDate.substring(0, 7)}`);
  } else {
    const lowerBound = new Date();
    lowerBound.setMonth(lowerBound.getMonth() - months);
    const lowerPeriod = `${lowerBound.getFullYear()}-${String(lowerBound.getMonth() + 1).padStart(2, "0")}`;
    conditions.push(sql`${revenueRecognition.period} >= ${lowerPeriod}`);
  }

  if (endDate) {
    conditions.push(sql`${revenueRecognition.period} <= ${endDate.substring(0, 7)}`);
  }

  const snapshots = await db
    .select()
    .from(revenueRecognition)
    .where(and(...conditions))
    .orderBy(desc(revenueRecognition.period));

  return snapshots;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
