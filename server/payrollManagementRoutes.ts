import { Router, type Response } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import {
  payRuns, payRunLineItems, timeEntries, users, projects,
  organizationPayrollSettings, insertPayRunSchema,
  projectEmployeeRates, projectLaborRates,
  payrollDeductionTypes, employeeDeductions, payStubDeductions,
  insertPayrollDeductionTypeSchema, insertEmployeeDeductionSchema,
  organizations, jobClassifications, employeeClassifications, prevailingWageRates
} from "@shared/schema";
import { eq, and, gte, lte, sql, desc, inArray, count, asc, isNull, or } from "drizzle-orm";
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
router.use("/api/payroll", requireAuth, requireFeaturePermission('canManagePayroll'));
router.use("/api/projects/:id/payroll-summary", requireAuth, requireFeaturePermission('canManagePayroll'));

const DEFAULT_REGULAR_RATE = 45;
const DEFAULT_OVERTIME_RATE = 67.5;

type RateInfo = { regularRate: number; overtimeRate: number };

async function buildRateMap(
  orgId: string,
  projectIds: string[],
  userIds: string[]
): Promise<Map<string, RateInfo>> {
  const rateMap = new Map<string, RateInfo>();

  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))];
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueProjectIds.length === 0 || uniqueUserIds.length === 0) {
    return rateMap;
  }

  const [empRates, projRates] = await Promise.all([
    db.select().from(projectEmployeeRates)
      .where(and(
        inArray(projectEmployeeRates.projectId, uniqueProjectIds),
        inArray(projectEmployeeRates.userId, uniqueUserIds)
      )),
    db.select().from(projectLaborRates)
      .where(inArray(projectLaborRates.projectId, uniqueProjectIds)),
  ]);

  const orgFallback: RateInfo = {
    regularRate: DEFAULT_REGULAR_RATE,
    overtimeRate: DEFAULT_OVERTIME_RATE,
  };

  const empRateMap = new Map<string, RateInfo>();
  for (const r of empRates) {
    empRateMap.set(`${r.userId}:${r.projectId}`, {
      regularRate: parseFloat(r.regularRate),
      overtimeRate: parseFloat(r.overtimeRate),
    });
  }

  const projRateMap = new Map<string, RateInfo>();
  for (const r of projRates) {
    projRateMap.set(r.projectId, {
      regularRate: parseFloat(r.defaultRegularRate),
      overtimeRate: parseFloat(r.defaultOvertimeRate),
    });
  }

  for (const userId of uniqueUserIds) {
    for (const projectId of uniqueProjectIds) {
      const key = `${userId}:${projectId}`;
      const empRate = empRateMap.get(key);
      if (empRate) {
        rateMap.set(key, empRate);
      } else {
        const projRate = projRateMap.get(projectId);
        if (projRate) {
          rateMap.set(key, projRate);
        } else {
          rateMap.set(key, orgFallback);
        }
      }
    }
  }

  return rateMap;
}

function lookupRate(rateMap: Map<string, RateInfo>, userId: string, projectId: string | null): RateInfo {
  if (projectId) {
    const rate = rateMap.get(`${userId}:${projectId}`);
    if (rate) return rate;
  }
  return { regularRate: DEFAULT_REGULAR_RATE, overtimeRate: DEFAULT_OVERTIME_RATE };
}

router.get("/api/payroll/overview", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const settingsResult = await db.select().from(organizationPayrollSettings).where(eq(organizationPayrollSettings.organizationId, orgId)).limit(1);
    const settings = settingsResult[0];
    const workWeekStart = settings?.workWeekStartDay || "MONDAY";

    const now = new Date();
    const dayIndex = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"].indexOf(workWeekStart);
    const currentDay = now.getDay();
    const diff = (currentDay - dayIndex + 7) % 7;
    const periodStart = new Date(now);
    periodStart.setDate(now.getDate() - diff);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodStart.getDate() + 6);
    periodEnd.setHours(23, 59, 59, 999);

    const periodStartStr = periodStart.toISOString().split("T")[0];
    const periodEndStr = periodEnd.toISOString().split("T")[0];

    const entriesForCost = await db.select({
      userId: timeEntries.userId,
      projectId: timeEntries.projectId,
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
    }).from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(
        eq(users.organizationId, orgId),
        gte(timeEntries.date, periodStart),
        lte(timeEntries.date, periodEnd),
      ));

    let totalRegularHours = 0;
    let totalOvertimeHours = 0;
    let totalLaborCost = 0;

    const entryProjectIds = entriesForCost.map(e => e.projectId).filter(Boolean) as string[];
    const entryUserIds = entriesForCost.map(e => e.userId);
    const rateMap = await buildRateMap(orgId, entryProjectIds, entryUserIds);

    for (const entry of entriesForCost) {
      const regular = parseFloat(entry.hoursRegular || "0");
      const overtime = parseFloat(entry.hoursOvertime || "0");
      totalRegularHours += regular;
      totalOvertimeHours += overtime;

      const rates = lookupRate(rateMap, entry.userId, entry.projectId);
      totalLaborCost += regular * rates.regularRate + overtime * rates.overtimeRate;
    }

    const unapprovedResult = await db.select({
      count: sql<number>`COUNT(*)`,
    }).from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(
        eq(users.organizationId, orgId),
        eq(timeEntries.approvalStatus, "PENDING"),
      ));

    const recentPayRuns = await db.select().from(payRuns)
      .where(eq(payRuns.organizationId, orgId))
      .orderBy(desc(payRuns.createdAt))
      .limit(10);

    res.json({
      currentPeriod: {
        start: periodStartStr,
        end: periodEndStr,
        workWeekStart,
      },
      metrics: {
        totalRegularHours,
        totalOvertimeHours,
        totalLaborCost,
        unapprovedEntries: Number(unapprovedResult[0]?.count || 0),
      },
      recentPayRuns,
    });
  } catch (error) {
    console.error("Payroll overview error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/pay-runs", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const results = await db.select().from(payRuns)
      .where(eq(payRuns.organizationId, orgId))
      .orderBy(desc(payRuns.createdAt));

    res.json(results);
  } catch (error) {
    console.error("Get pay runs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/pay-runs/:id", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [payRun] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));

    if (!payRun) {
      return res.status(404).json({ error: "Pay run not found" });
    }

    const lineItems = await db.select({
      lineItem: payRunLineItems,
      userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      projectName: projects.name,
    })
      .from(payRunLineItems)
      .innerJoin(users, eq(payRunLineItems.userId, users.id))
      .innerJoin(projects, eq(payRunLineItems.projectId, projects.id))
      .where(eq(payRunLineItems.payRunId, req.params.id));

    res.json({ ...payRun, lineItems });
  } catch (error) {
    console.error("Get pay run detail error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/payroll/pay-runs", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { payPeriodStart, payPeriodEnd, notes } = req.body;
    if (!payPeriodStart || !payPeriodEnd) {
      return res.status(400).json({ error: "Pay period start and end dates are required" });
    }

    const startDate = new Date(payPeriodStart);
    const endDate = new Date(payPeriodEnd);
    endDate.setHours(23, 59, 59, 999);

    const approvedEntries = await db.select({
      entry: timeEntries,
      user: users,
    }).from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(
        eq(users.organizationId, orgId),
        eq(timeEntries.approvalStatus, "APPROVED"),
        gte(timeEntries.date, startDate),
        lte(timeEntries.date, endDate),
      ));

    if (approvedEntries.length === 0) {
      return res.status(400).json({ error: "No approved time entries found for this period" });
    }

    const workerMap = new Map<string, { projectMap: Map<string, { regular: number; overtime: number; costCode: string | null; entryIds: string[] }> }>();

    for (const { entry, user } of approvedEntries) {
      if (!workerMap.has(entry.userId)) {
        workerMap.set(entry.userId, { projectMap: new Map() });
      }
      const worker = workerMap.get(entry.userId)!;
      const key = `${entry.projectId}:${entry.costCode || "NONE"}`;
      if (!worker.projectMap.has(key)) {
        worker.projectMap.set(key, { regular: 0, overtime: 0, costCode: entry.costCode, entryIds: [] });
      }
      const proj = worker.projectMap.get(key)!;
      proj.regular += parseFloat(entry.hoursRegular || "0");
      proj.overtime += parseFloat(entry.hoursOvertime || "0");
      proj.entryIds.push(entry.id);
    }

    let totalRegular = 0;
    let totalOvertime = 0;
    let totalCost = 0;
    let totalGrossAmount = 0;
    let totalDeductionsAmount = 0;
    let totalNetAmount = 0;

    const existingRuns = await db.select({ count: sql<number>`COUNT(*)` }).from(payRuns).where(eq(payRuns.organizationId, orgId));
    const runNum = Number(existingRuns[0]?.count || 0) + 1;

    const [newPayRun] = await db.insert(payRuns).values({
      organizationId: orgId,
      payPeriodStart: payPeriodStart,
      payPeriodEnd: payPeriodEnd,
      runNumber: `PR-${String(runNum).padStart(4, "0")}`,
      status: "DRAFT",
      totalRegularHours: "0",
      totalOvertimeHours: "0",
      totalLaborCost: "0",
      totalGrossAmount: "0",
      totalDeductions: "0",
      totalNetAmount: "0",
      totalWorkers: workerMap.size,
      notes: notes || null,
      createdById: authReq.user!.id,
    }).returning();

    const allProjectIds: string[] = [];
    const allUserIds: string[] = [];
    for (const [userId, worker] of Array.from(workerMap)) {
      allUserIds.push(userId);
      for (const key of Array.from(worker.projectMap.keys())) {
        allProjectIds.push(key.split(":")[0]);
      }
    }
    const payRunRateMap = await buildRateMap(orgId, allProjectIds, allUserIds);

    const lineItemsToInsert: any[] = [];
    const deferredDeductions: Array<{ lineItemIndex: number; userId: string; grossAmount: number }> = [];

    for (const [userId, worker] of Array.from(workerMap)) {
      for (const [key, data] of Array.from(worker.projectMap)) {
        const projectId = key.split(":")[0];
        const rates = lookupRate(payRunRateMap, userId, projectId);
        const grossAmount = data.regular * rates.regularRate + data.overtime * rates.overtimeRate;
        totalRegular += data.regular;
        totalOvertime += data.overtime;
        totalCost += grossAmount;

        deferredDeductions.push({ lineItemIndex: lineItemsToInsert.length, userId, grossAmount });

        lineItemsToInsert.push({
          payRunId: newPayRun.id,
          userId,
          projectId,
          costCode: data.costCode,
          regularHours: String(data.regular),
          overtimeHours: String(data.overtime),
          regularRate: String(rates.regularRate),
          overtimeRate: String(rates.overtimeRate),
          totalAmount: String(grossAmount),
          grossAmount: String(grossAmount),
          totalDeductions: "0",
          netAmount: String(grossAmount),
          timeEntryIds: data.entryIds,
          wageType: "STANDARD",
        });
      }
    }

    let insertedLineItems: any[] = [];
    if (lineItemsToInsert.length > 0) {
      insertedLineItems = await db.insert(payRunLineItems).values(lineItemsToInsert).returning();
    }

    for (const deferred of deferredDeductions) {
      const insertedItem = insertedLineItems[deferred.lineItemIndex];
      if (!insertedItem) continue;

      const { deductions, totalDeductions: lineDed } = await calculateDeductionsForEmployee(
        deferred.userId, orgId, deferred.grossAmount, payPeriodEnd
      );

      if (deductions.length > 0) {
        await db.insert(payStubDeductions).values(
          deductions.map(d => ({
            payRunLineItemId: insertedItem.id,
            deductionTypeId: d.deductionTypeId,
            amount: String(d.amount),
            ytdAmount: String(d.ytdAmount),
          }))
        );

        const netAmount = Math.round((deferred.grossAmount - lineDed) * 100) / 100;
        await db.update(payRunLineItems).set({
          totalDeductions: String(lineDed),
          netAmount: String(netAmount),
        }).where(eq(payRunLineItems.id, insertedItem.id));

        totalDeductionsAmount += lineDed;
      }

      totalGrossAmount += deferred.grossAmount;
    }

    totalNetAmount = Math.round((totalGrossAmount - totalDeductionsAmount) * 100) / 100;

    await db.update(payRuns).set({
      totalRegularHours: String(totalRegular),
      totalOvertimeHours: String(totalOvertime),
      totalLaborCost: String(totalCost),
      totalGrossAmount: String(Math.round(totalGrossAmount * 100) / 100),
      totalDeductions: String(Math.round(totalDeductionsAmount * 100) / 100),
      totalNetAmount: String(totalNetAmount),
      updatedAt: new Date(),
    }).where(eq(payRuns.id, newPayRun.id));

    const [updatedPayRun] = await db.select().from(payRuns).where(eq(payRuns.id, newPayRun.id));

    await logAudit({
      userId: authReq.user!.id,
      action: "CREATE",
      entityType: "pay_runs",
      entityId: newPayRun.id,
      newValue: JSON.stringify({ runNumber: newPayRun.runNumber, period: `${payPeriodStart} to ${payPeriodEnd}` }),
    });

    res.status(201).json(updatedPayRun);
  } catch (error) {
    console.error("Create pay run error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const payRunStatusHandler = async (req: any, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { status } = req.body;
    const validTransitions: Record<string, string[]> = {
      DRAFT: ["PENDING_APPROVAL", "VOIDED", "ARCHIVED"],
      PENDING_APPROVAL: ["APPROVED", "DRAFT", "VOIDED", "ARCHIVED"],
      APPROVED: ["PROCESSING", "VOIDED", "ARCHIVED"],
      PROCESSING: ["PAID", "VOIDED", "ARCHIVED"],
      PAID: ["ARCHIVED"],
      VOIDED: ["ARCHIVED"],
      ARCHIVED: [],
    };

    const [existing] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));

    if (!existing) {
      return res.status(404).json({ error: "Pay run not found" });
    }

    if (!validTransitions[existing.status]?.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${existing.status} to ${status}` });
    }

    const updateData: any = { status, updatedAt: new Date() };
    if (status === "APPROVED") {
      updateData.approvedById = authReq.user!.id;
      updateData.approvedAt = new Date();
    }
    if (status === "PAID") {
      updateData.paidAt = new Date();
    }

    const [updated] = await db.update(payRuns).set(updateData)
      .where(eq(payRuns.id, req.params.id)).returning();

    await logAudit({
      userId: authReq.user!.id,
      action: "UPDATE",
      entityType: "pay_runs",
      entityId: req.params.id,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status }),
    });

    if (status === "PAID") {
      const lineItemCount = await db
        .select({ userId: payRunLineItems.userId })
        .from(payRunLineItems)
        .where(eq(payRunLineItems.payRunId, updated.id));
      const uniqueEmployeeCount = new Set(lineItemCount.map((r) => r.userId)).size;

      eventBus.emit({
        type: "payroll.run.completed",
        orgId: orgId,
        actorId: authReq.user!.id,
        timestamp: new Date(),
        payload: {
          payRunId: updated.id,
          periodStart: updated.payPeriodStart instanceof Date
            ? updated.payPeriodStart.toISOString().split("T")[0]
            : String(updated.payPeriodStart),
          periodEnd: updated.payPeriodEnd instanceof Date
            ? updated.payPeriodEnd.toISOString().split("T")[0]
            : String(updated.payPeriodEnd),
          totalGross: Number(updated.totalGrossAmount || 0),
          employeeCount: uniqueEmployeeCount,
        },
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Update pay run status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
router.put("/api/payroll/pay-runs/:id/status", requireAuth, payRunStatusHandler);
router.patch("/api/payroll/pay-runs/:id/status", requireAuth, payRunStatusHandler);

router.get("/api/payroll/workers", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const workers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      totalRegularHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursRegular} AS DECIMAL)), 0)`,
      totalOvertimeHours: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursOvertime} AS DECIMAL)), 0)`,
      totalEntries: sql<number>`COUNT(${timeEntries.id})`,
    })
      .from(users)
      .leftJoin(timeEntries, eq(users.id, timeEntries.userId))
      .where(and(
        eq(users.organizationId, orgId),
        eq(users.isActive, true),
      ))
      .groupBy(users.id, users.firstName, users.lastName, users.email, users.role);

    res.json(workers);
  } catch (error) {
    console.error("Get payroll workers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/time-entries", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { status, startDate, endDate } = req.query;

    const conditions = [eq(users.organizationId, orgId)];
    if (status && typeof status === "string") {
      conditions.push(eq(timeEntries.approvalStatus, status as any));
    }
    if (startDate && typeof startDate === "string") {
      conditions.push(gte(timeEntries.date, new Date(startDate)));
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(lte(timeEntries.date, new Date(endDate)));
    }

    const entries = await db.select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      date: timeEntries.date,
      hoursRegular: timeEntries.hoursRegular,
      hoursOvertime: timeEntries.hoursOvertime,
      costCode: timeEntries.costCode,
      approvalStatus: timeEntries.approvalStatus,
      notes: timeEntries.notes,
    })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(timeEntries.date))
      .limit(200);

    res.json(entries);
  } catch (error) {
    console.error("Get payroll time entries error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:id/payroll-summary", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const projectId = req.params.id;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const workerStats = await db.select({
      userId: timeEntries.userId,
      userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      role: users.role,
      totalRegular: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursRegular} AS DECIMAL)), 0)`,
      totalOvertime: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursOvertime} AS DECIMAL)), 0)`,
    })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(eq(timeEntries.projectId, projectId))
      .groupBy(timeEntries.userId, users.firstName, users.lastName, users.role);

    let totalRegular = 0;
    let totalOvertime = 0;
    let laborCost = 0;

    const summaryUserIds = workerStats.map(w => w.userId);
    const summaryRateMap = await buildRateMap(orgId, [projectId], summaryUserIds);

    const workerResults = [];
    for (const w of workerStats) {
      const reg = parseFloat(w.totalRegular);
      const ot = parseFloat(w.totalOvertime);
      totalRegular += reg;
      totalOvertime += ot;

      const rates = lookupRate(summaryRateMap, w.userId, projectId);
      laborCost += reg * rates.regularRate + ot * rates.overtimeRate;

      workerResults.push({
        userId: w.userId,
        name: w.userName,
        role: w.role,
        regularHours: reg,
        overtimeHours: ot,
      });
    }

    const totalHours = totalRegular + totalOvertime;
    const overtimePercent = totalHours > 0 ? (totalOvertime / totalHours) * 100 : 0;
    const budget = parseFloat(String(project.budget || "0"));

    res.json({
      laborCostToDate: laborCost,
      budget,
      laborVsBudget: budget > 0 ? (laborCost / budget) * 100 : 0,
      totalRegularHours: totalRegular,
      totalOvertimeHours: totalOvertime,
      overtimePercent: Math.round(overtimePercent * 10) / 10,
      totalEntries: workerStats.length,
      workers: workerResults,
    });
  } catch (error) {
    console.error("Project payroll summary error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function calculateDeductionsForEmployee(
  userId: string,
  orgId: string,
  grossAmount: number,
  payPeriodEnd: string
): Promise<{ deductions: Array<{ deductionTypeId: string; amount: number; ytdAmount: number }>; totalDeductions: number }> {
  const activeDeductions = await db.select({
    deduction: employeeDeductions,
    deductionType: payrollDeductionTypes,
  })
    .from(employeeDeductions)
    .innerJoin(payrollDeductionTypes, eq(employeeDeductions.deductionTypeId, payrollDeductionTypes.id))
    .where(and(
      eq(employeeDeductions.userId, userId),
      eq(employeeDeductions.organizationId, orgId),
      eq(employeeDeductions.isActive, true),
      eq(payrollDeductionTypes.isActive, true),
      lte(employeeDeductions.effectiveDate, payPeriodEnd),
      or(isNull(employeeDeductions.endDate), gte(employeeDeductions.endDate, payPeriodEnd))
    ))
    .orderBy(asc(payrollDeductionTypes.sortOrder));

  const results: Array<{ deductionTypeId: string; amount: number; ytdAmount: number }> = [];
  let totalDed = 0;

  for (const { deduction, deductionType } of activeDeductions) {
    let amount = 0;
    const overrideAmt = deduction.overrideAmount ? parseFloat(deduction.overrideAmount) : null;

    if (overrideAmt !== null) {
      amount = overrideAmt;
    } else if (deductionType.calculationMethod === "PERCENTAGE") {
      const rate = parseFloat(deductionType.rate || "0");
      amount = grossAmount * (rate / 100);
    } else if (deductionType.calculationMethod === "FIXED_AMOUNT") {
      amount = parseFloat(deductionType.amount || "0");
    } else if (deductionType.calculationMethod === "TIERED") {
      amount = parseFloat(deductionType.amount || "0");
    }

    const ytdResult = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${payStubDeductions.amount} AS DECIMAL)), 0)`,
    })
      .from(payStubDeductions)
      .innerJoin(payRunLineItems, eq(payStubDeductions.payRunLineItemId, payRunLineItems.id))
      .innerJoin(payRuns, eq(payRunLineItems.payRunId, payRuns.id))
      .where(and(
        eq(payStubDeductions.deductionTypeId, deductionType.id),
        eq(payRunLineItems.userId, userId),
        eq(payRuns.organizationId, orgId),
      ));

    const ytdSoFar = parseFloat(ytdResult[0]?.total || "0");

    if (deductionType.maxAnnualAmount) {
      const maxAnnual = parseFloat(deductionType.maxAnnualAmount);
      if (ytdSoFar >= maxAnnual) {
        continue;
      }
      if (ytdSoFar + amount > maxAnnual) {
        amount = maxAnnual - ytdSoFar;
      }
    }

    amount = Math.round(amount * 100) / 100;
    if (amount > 0) {
      results.push({
        deductionTypeId: deductionType.id,
        amount,
        ytdAmount: Math.round((ytdSoFar + amount) * 100) / 100,
      });
      totalDed += amount;
    }
  }

  return { deductions: results, totalDeductions: Math.round(totalDed * 100) / 100 };
}

router.get("/api/payroll/deduction-types", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const results = await db.select().from(payrollDeductionTypes)
      .where(eq(payrollDeductionTypes.organizationId, orgId))
      .orderBy(asc(payrollDeductionTypes.sortOrder), asc(payrollDeductionTypes.name));

    res.json(results);
  } catch (error) {
    console.error("Get deduction types error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/payroll/deduction-types", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const { name, category, calculationMethod, rate, amount, maxAnnualAmount, isPreTax, isActive, sortOrder } = req.body;
    if (!name || !category) return res.status(400).json({ error: "Name and category are required" });

    const body: any = { organizationId: orgId, name, category, isActive: isActive !== false };
    if (calculationMethod) body.calculationMethod = calculationMethod;
    if (rate) body.rate = rate;
    if (amount) body.amount = amount;
    if (maxAnnualAmount) body.maxAnnualAmount = maxAnnualAmount;
    if (isPreTax !== undefined) body.isPreTax = isPreTax;
    if (sortOrder !== undefined) body.sortOrder = sortOrder;

    const [created] = await db.insert(payrollDeductionTypes).values(body).returning();
    res.status(201).json(created);
  } catch (error) {
    console.error("Create deduction type error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/payroll/deduction-types/:id", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(payrollDeductionTypes)
      .where(and(eq(payrollDeductionTypes.id, req.params.id), eq(payrollDeductionTypes.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Deduction type not found" });

    const { name, category, calculationMethod, rate, amount, maxAnnualAmount, isPreTax, isActive, sortOrder } = req.body;
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (calculationMethod !== undefined) updateData.calculationMethod = calculationMethod;
    if (rate !== undefined) updateData.rate = rate;
    if (amount !== undefined) updateData.amount = amount;
    if (maxAnnualAmount !== undefined) updateData.maxAnnualAmount = maxAnnualAmount;
    if (isPreTax !== undefined) updateData.isPreTax = isPreTax;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const [updated] = await db.update(payrollDeductionTypes)
      .set(updateData)
      .where(eq(payrollDeductionTypes.id, req.params.id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("Update deduction type error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/payroll/deduction-types/:id", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(payrollDeductionTypes)
      .where(and(eq(payrollDeductionTypes.id, req.params.id), eq(payrollDeductionTypes.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Deduction type not found" });

    await db.delete(payrollDeductionTypes).where(eq(payrollDeductionTypes.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete deduction type error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/employee-deductions", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const results = await db.select({
      deduction: employeeDeductions,
      userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      deductionTypeName: payrollDeductionTypes.name,
      deductionTypeCategory: payrollDeductionTypes.category,
      calculationMethod: payrollDeductionTypes.calculationMethod,
      typeRate: payrollDeductionTypes.rate,
      typeAmount: payrollDeductionTypes.amount,
    })
      .from(employeeDeductions)
      .innerJoin(users, eq(employeeDeductions.userId, users.id))
      .innerJoin(payrollDeductionTypes, eq(employeeDeductions.deductionTypeId, payrollDeductionTypes.id))
      .where(eq(employeeDeductions.organizationId, orgId))
      .orderBy(asc(users.lastName), asc(users.firstName));

    res.json(results);
  } catch (error) {
    console.error("Get employee deductions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/employee-deductions/:userId", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const results = await db.select({
      deduction: employeeDeductions,
      deductionTypeName: payrollDeductionTypes.name,
      deductionTypeCategory: payrollDeductionTypes.category,
      calculationMethod: payrollDeductionTypes.calculationMethod,
      typeRate: payrollDeductionTypes.rate,
      typeAmount: payrollDeductionTypes.amount,
      isPreTax: payrollDeductionTypes.isPreTax,
    })
      .from(employeeDeductions)
      .innerJoin(payrollDeductionTypes, eq(employeeDeductions.deductionTypeId, payrollDeductionTypes.id))
      .where(and(
        eq(employeeDeductions.userId, req.params.userId),
        eq(employeeDeductions.organizationId, orgId),
      ))
      .orderBy(asc(payrollDeductionTypes.sortOrder));

    res.json(results);
  } catch (error) {
    console.error("Get employee deductions by user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/payroll/employee-deductions", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const { userId, deductionTypeId, overrideAmount, effectiveDate, endDate, isActive } = req.body;
    if (!userId || !deductionTypeId || !effectiveDate) {
      return res.status(400).json({ error: "userId, deductionTypeId, and effectiveDate are required" });
    }

    const [user] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));
    if (!user) return res.status(400).json({ error: "User not found in your organization" });

    const [dedType] = await db.select({ id: payrollDeductionTypes.id }).from(payrollDeductionTypes)
      .where(and(eq(payrollDeductionTypes.id, deductionTypeId), eq(payrollDeductionTypes.organizationId, orgId)));
    if (!dedType) return res.status(400).json({ error: "Deduction type not found in your organization" });

    const body: any = { organizationId: orgId, userId, deductionTypeId, effectiveDate, isActive: isActive !== false };
    if (overrideAmount) body.overrideAmount = overrideAmount;
    if (endDate) body.endDate = endDate;

    const [created] = await db.insert(employeeDeductions).values(body).returning();
    res.status(201).json(created);
  } catch (error) {
    console.error("Create employee deduction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/payroll/employee-deductions/:id", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(employeeDeductions)
      .where(and(eq(employeeDeductions.id, req.params.id), eq(employeeDeductions.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Employee deduction not found" });

    const { overrideAmount, effectiveDate, endDate, isActive } = req.body;
    const updateData: any = { updatedAt: new Date() };
    if (overrideAmount !== undefined) updateData.overrideAmount = overrideAmount || null;
    if (effectiveDate !== undefined) updateData.effectiveDate = effectiveDate;
    if (endDate !== undefined) updateData.endDate = endDate || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updated] = await db.update(employeeDeductions)
      .set(updateData)
      .where(eq(employeeDeductions.id, req.params.id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("Update employee deduction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/payroll/employee-deductions/:id", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(employeeDeductions)
      .where(and(eq(employeeDeductions.id, req.params.id), eq(employeeDeductions.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Employee deduction not found" });

    await db.delete(employeeDeductions).where(eq(employeeDeductions.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete employee deduction error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/pay-runs/:id/pay-stubs", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [payRun] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));
    if (!payRun) return res.status(404).json({ error: "Pay run not found" });

    const lineItems = await db.select({
      lineItem: payRunLineItems,
      userName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      userEmail: users.email,
      projectName: projects.name,
    })
      .from(payRunLineItems)
      .innerJoin(users, eq(payRunLineItems.userId, users.id))
      .innerJoin(projects, eq(payRunLineItems.projectId, projects.id))
      .where(eq(payRunLineItems.payRunId, req.params.id));

    const workerMap = new Map<string, any>();
    for (const item of lineItems) {
      const userId = item.lineItem.userId;
      if (!workerMap.has(userId)) {
        workerMap.set(userId, {
          userId,
          employeeName: item.userName,
          employeeEmail: item.userEmail,
          payPeriodStart: payRun.payPeriodStart,
          payPeriodEnd: payRun.payPeriodEnd,
          payRunNumber: payRun.runNumber,
          earnings: [],
          deductions: [],
          totalGross: 0,
          totalDeductions: 0,
          netPay: 0,
        });
      }
      const worker = workerMap.get(userId)!;
      const regPay = parseFloat(item.lineItem.regularHours) * parseFloat(item.lineItem.regularRate);
      const otPay = parseFloat(item.lineItem.overtimeHours) * parseFloat(item.lineItem.overtimeRate);
      const gross = parseFloat(item.lineItem.grossAmount || item.lineItem.totalAmount);

      worker.earnings.push({
        projectName: item.projectName,
        regularHours: parseFloat(item.lineItem.regularHours),
        regularRate: parseFloat(item.lineItem.regularRate),
        regularPay: Math.round(regPay * 100) / 100,
        overtimeHours: parseFloat(item.lineItem.overtimeHours),
        overtimeRate: parseFloat(item.lineItem.overtimeRate),
        overtimePay: Math.round(otPay * 100) / 100,
        grossAmount: gross,
      });
      worker.totalGross += gross;

      const stubDeds = await db.select({
        deduction: payStubDeductions,
        typeName: payrollDeductionTypes.name,
        category: payrollDeductionTypes.category,
        isPreTax: payrollDeductionTypes.isPreTax,
      })
        .from(payStubDeductions)
        .innerJoin(payrollDeductionTypes, eq(payStubDeductions.deductionTypeId, payrollDeductionTypes.id))
        .where(eq(payStubDeductions.payRunLineItemId, item.lineItem.id));

      for (const d of stubDeds) {
        const existingDed = worker.deductions.find((x: any) => x.deductionTypeId === d.deduction.deductionTypeId);
        if (existingDed) {
          existingDed.amount += parseFloat(d.deduction.amount);
          existingDed.ytdAmount = parseFloat(d.deduction.ytdAmount);
        } else {
          worker.deductions.push({
            deductionTypeId: d.deduction.deductionTypeId,
            name: d.typeName,
            category: d.category,
            isPreTax: d.isPreTax,
            amount: parseFloat(d.deduction.amount),
            ytdAmount: parseFloat(d.deduction.ytdAmount),
          });
        }
        worker.totalDeductions += parseFloat(d.deduction.amount);
      }
    }

    for (const worker of workerMap.values()) {
      worker.totalGross = Math.round(worker.totalGross * 100) / 100;
      worker.totalDeductions = Math.round(worker.totalDeductions * 100) / 100;
      worker.netPay = Math.round((worker.totalGross - worker.totalDeductions) * 100) / 100;
    }

    res.json(Array.from(workerMap.values()));
  } catch (error) {
    console.error("Get pay stubs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/pay-runs/:id/pay-stubs/:userId", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [payRun] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));
    if (!payRun) return res.status(404).json({ error: "Pay run not found" });

    const lineItems = await db.select({
      lineItem: payRunLineItems,
      projectName: projects.name,
    })
      .from(payRunLineItems)
      .innerJoin(projects, eq(payRunLineItems.projectId, projects.id))
      .where(and(eq(payRunLineItems.payRunId, req.params.id), eq(payRunLineItems.userId, req.params.userId)));

    const [user] = await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users).where(eq(users.id, req.params.userId));

    if (!user || lineItems.length === 0) return res.status(404).json({ error: "Pay stub not found" });

    const stub: any = {
      userId: req.params.userId,
      employeeName: `${user.firstName} ${user.lastName}`,
      employeeEmail: user.email,
      payPeriodStart: payRun.payPeriodStart,
      payPeriodEnd: payRun.payPeriodEnd,
      payRunNumber: payRun.runNumber,
      earnings: [],
      deductions: [],
      totalGross: 0,
      totalDeductions: 0,
      netPay: 0,
    };

    for (const item of lineItems) {
      const regPay = parseFloat(item.lineItem.regularHours) * parseFloat(item.lineItem.regularRate);
      const otPay = parseFloat(item.lineItem.overtimeHours) * parseFloat(item.lineItem.overtimeRate);
      const gross = parseFloat(item.lineItem.grossAmount || item.lineItem.totalAmount);
      stub.earnings.push({
        projectName: item.projectName,
        regularHours: parseFloat(item.lineItem.regularHours),
        regularRate: parseFloat(item.lineItem.regularRate),
        regularPay: Math.round(regPay * 100) / 100,
        overtimeHours: parseFloat(item.lineItem.overtimeHours),
        overtimeRate: parseFloat(item.lineItem.overtimeRate),
        overtimePay: Math.round(otPay * 100) / 100,
        grossAmount: gross,
      });
      stub.totalGross += gross;

      const stubDeds = await db.select({
        deduction: payStubDeductions,
        typeName: payrollDeductionTypes.name,
        category: payrollDeductionTypes.category,
        isPreTax: payrollDeductionTypes.isPreTax,
      })
        .from(payStubDeductions)
        .innerJoin(payrollDeductionTypes, eq(payStubDeductions.deductionTypeId, payrollDeductionTypes.id))
        .where(eq(payStubDeductions.payRunLineItemId, item.lineItem.id));

      for (const d of stubDeds) {
        const existingDed = stub.deductions.find((x: any) => x.deductionTypeId === d.deduction.deductionTypeId);
        if (existingDed) {
          existingDed.amount += parseFloat(d.deduction.amount);
          existingDed.ytdAmount = parseFloat(d.deduction.ytdAmount);
        } else {
          stub.deductions.push({
            deductionTypeId: d.deduction.deductionTypeId,
            name: d.typeName,
            category: d.category,
            isPreTax: d.isPreTax,
            amount: parseFloat(d.deduction.amount),
            ytdAmount: parseFloat(d.deduction.ytdAmount),
          });
        }
        stub.totalDeductions += parseFloat(d.deduction.amount);
      }
    }

    stub.totalGross = Math.round(stub.totalGross * 100) / 100;
    stub.totalDeductions = Math.round(stub.totalDeductions * 100) / 100;
    stub.netPay = Math.round((stub.totalGross - stub.totalDeductions) * 100) / 100;

    res.json(stub);
  } catch (error) {
    console.error("Get single pay stub error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/pay-runs/:id/certified-report", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [payRun] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));
    if (!payRun) return res.status(404).json({ error: "Pay run not found" });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));

    const lineItems = await db.select({
      lineItem: payRunLineItems,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      projectName: projects.name,
      projectId: projects.id,
    })
      .from(payRunLineItems)
      .innerJoin(users, eq(payRunLineItems.userId, users.id))
      .innerJoin(projects, eq(payRunLineItems.projectId, projects.id))
      .where(eq(payRunLineItems.payRunId, req.params.id))
      .orderBy(asc(users.lastName), asc(users.firstName));

    const lineItemUserIds = [...new Set(lineItems.map(i => i.lineItem.userId))];
    const lineItemIds = lineItems.map(i => i.lineItem.id);
    const lineItemProjectIds = [...new Set(lineItems.map(i => i.projectId))];

    const classNameMap = new Map<string, string>();
    const classIdMap = new Map<string, string>();
    const pwMap = new Map<string, number>();
    const dedMap = new Map<string, Array<{ amount: string; category: string }>>();

    if (lineItemUserIds.length > 0) {
      const allEmpClasses = await db.select({
        userId: employeeClassifications.userId,
        classificationId: employeeClassifications.classificationId,
        classificationName: jobClassifications.name,
      })
        .from(employeeClassifications)
        .innerJoin(jobClassifications, eq(employeeClassifications.classificationId, jobClassifications.id))
        .where(inArray(employeeClassifications.userId, lineItemUserIds));

      for (const ec of allEmpClasses) {
        if (!classNameMap.has(ec.userId)) {
          classNameMap.set(ec.userId, ec.classificationName);
          classIdMap.set(ec.userId, ec.classificationId);
        }
      }
    }

    const classIds = [...new Set(Array.from(classIdMap.values()))];
    if (classIds.length > 0 && lineItemProjectIds.length > 0) {
      const allPw = await db.select().from(prevailingWageRates)
        .where(and(
          eq(prevailingWageRates.organizationId, orgId),
          inArray(prevailingWageRates.projectId, lineItemProjectIds),
          inArray(prevailingWageRates.classificationId, classIds),
        ));
      for (const pw of allPw) {
        pwMap.set(`${pw.projectId}:${pw.classificationId}`, parseFloat(pw.wageRate));
      }
    }

    if (lineItemIds.length > 0) {
      const allDeds = await db.select({
        lineItemId: payStubDeductions.payRunLineItemId,
        amount: payStubDeductions.amount,
        category: payrollDeductionTypes.category,
      })
        .from(payStubDeductions)
        .innerJoin(payrollDeductionTypes, eq(payStubDeductions.deductionTypeId, payrollDeductionTypes.id))
        .where(inArray(payStubDeductions.payRunLineItemId, lineItemIds));

      for (const d of allDeds) {
        if (!dedMap.has(d.lineItemId)) dedMap.set(d.lineItemId, []);
        dedMap.get(d.lineItemId)!.push({ amount: d.amount, category: d.category });
      }
    }

    const employeeRows: any[] = [];
    for (const item of lineItems) {
      const userId = item.lineItem.userId;
      const classification = classNameMap.get(userId) || "Laborer";

      let prevailingRate = null;
      let belowPrevailingWage = false;
      const userClassId = classIdMap.get(userId);
      if (userClassId) {
        const pw = pwMap.get(`${item.projectId}:${userClassId}`);
        if (pw !== undefined) {
          prevailingRate = pw;
          if (parseFloat(item.lineItem.regularRate) < pw) {
            belowPrevailingWage = true;
          }
        }
      }

      const stubDeds = dedMap.get(item.lineItem.id) || [];
      let ficaAmount = 0;
      let withholdingTax = 0;
      let otherDeductions = 0;
      for (const d of stubDeds) {
        const amt = parseFloat(d.amount);
        if (d.category === "FICA" || d.category === "MEDICARE") {
          ficaAmount += amt;
        } else if (d.category === "FEDERAL_TAX" || d.category === "STATE_TAX" || d.category === "LOCAL_TAX") {
          withholdingTax += amt;
        } else {
          otherDeductions += amt;
        }
      }

      const totalDeductions = ficaAmount + withholdingTax + otherDeductions;
      const gross = parseFloat(item.lineItem.grossAmount || item.lineItem.totalAmount);

      employeeRows.push({
        name: `${item.firstName} ${item.lastName}`,
        workClassification: classification,
        regularHours: parseFloat(item.lineItem.regularHours),
        overtimeHours: parseFloat(item.lineItem.overtimeHours),
        totalHours: parseFloat(item.lineItem.regularHours) + parseFloat(item.lineItem.overtimeHours),
        rateOfPay: parseFloat(item.lineItem.regularRate),
        overtimeRate: parseFloat(item.lineItem.overtimeRate),
        grossEarned: gross,
        fica: Math.round(ficaAmount * 100) / 100,
        withholdingTax: Math.round(withholdingTax * 100) / 100,
        otherDeductions: Math.round(otherDeductions * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        netWages: Math.round((gross - totalDeductions) * 100) / 100,
        projectName: item.projectName,
        prevailingRate,
        belowPrevailingWage,
      });
    }

    const projectNames = [...new Set(employeeRows.map(r => r.projectName))];

    const projectIdToName = new Map<string, string>();
    for (const item of lineItems) {
      projectIdToName.set(item.projectId, item.projectName);
    }

    const projectGroupsById = new Map<string, typeof employeeRows>();
    for (let i = 0; i < employeeRows.length; i++) {
      const projId = lineItems[i].projectId;
      if (!projectGroupsById.has(projId)) projectGroupsById.set(projId, []);
      projectGroupsById.get(projId)!.push(employeeRows[i]);
    }

    const projectReports = Array.from(projectGroupsById.entries()).map(([projId, employees]) => ({
      header: {
        contractorName: org?.name || "",
        payrollNumber: payRun.runNumber,
        weekEndingDate: payRun.payPeriodEnd,
        projectName: projectIdToName.get(projId) || "",
      },
      employees,
      totals: {
        totalGross: Math.round(employees.reduce((s, e) => s + e.grossEarned, 0) * 100) / 100,
        totalDeductions: Math.round(employees.reduce((s, e) => s + e.totalDeductions, 0) * 100) / 100,
        totalNet: Math.round(employees.reduce((s, e) => s + e.netWages, 0) * 100) / 100,
      },
    }));

    res.json({
      header: {
        contractorName: org?.name || "",
        payrollNumber: payRun.runNumber,
        weekEndingDate: payRun.payPeriodEnd,
        projectName: projectNames.join(", "),
      },
      employees: employeeRows,
      totals: {
        totalGross: parseFloat(payRun.totalGrossAmount || payRun.totalLaborCost),
        totalDeductions: parseFloat(payRun.totalDeductions),
        totalNet: parseFloat(payRun.totalNetAmount || payRun.totalLaborCost),
      },
      statementOfCompliance: {
        fringeBenefitsPaidToPlan: true,
        fringeBenefitsPaidInCash: false,
        noFringeBenefitsRequired: false,
      },
      projectReports,
    });
  } catch (error) {
    console.error("Get certified payroll report error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/payroll/pay-runs/:id", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [existing] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));

    if (!existing) {
      return res.status(404).json({ error: "Pay run not found" });
    }

    if (existing.status === "PAID") {
      return res.status(400).json({ error: "Cannot delete a paid pay run" });
    }

    await db.delete(payRunLineItems).where(eq(payRunLineItems.payRunId, req.params.id));
    await db.delete(payRuns).where(eq(payRuns.id, req.params.id));

    await logAudit({
      userId: authReq.user!.id,
      action: "DELETE",
      entityType: "pay_runs",
      entityId: req.params.id,
      oldValue: JSON.stringify({ runNumber: existing.runNumber }),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete pay run error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
