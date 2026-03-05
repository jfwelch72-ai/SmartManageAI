import { Router, type Response } from "express";
import { db } from "./db";
import {
  payRuns, payRunLineItems, timeEntries, users, projects,
  organizationPayrollSettings, insertPayRunSchema,
  projectEmployeeRates, projectLaborRates
} from "@shared/schema";
import { eq, and, gte, lte, sql, desc, inArray, count } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const DEFAULT_REGULAR_RATE = 45;
const DEFAULT_OVERTIME_RATE = 67.5;

async function getEffectiveRate(
  userId: string,
  projectId: string | null,
  orgId: string
): Promise<{ regularRate: number; overtimeRate: number }> {
  if (projectId) {
    const [employeeRate] = await db
      .select()
      .from(projectEmployeeRates)
      .where(
        and(
          eq(projectEmployeeRates.projectId, projectId),
          eq(projectEmployeeRates.userId, userId)
        )
      )
      .limit(1);

    if (employeeRate) {
      return {
        regularRate: parseFloat(employeeRate.regularRate),
        overtimeRate: parseFloat(employeeRate.overtimeRate),
      };
    }

    const [projectRate] = await db
      .select()
      .from(projectLaborRates)
      .where(eq(projectLaborRates.projectId, projectId))
      .limit(1);

    if (projectRate) {
      return {
        regularRate: parseFloat(projectRate.defaultRegularRate),
        overtimeRate: parseFloat(projectRate.defaultOvertimeRate),
      };
    }
  }

  const [settings] = await db
    .select()
    .from(organizationPayrollSettings)
    .where(eq(organizationPayrollSettings.organizationId, orgId))
    .limit(1);

  if (settings) {
    return {
      regularRate: DEFAULT_REGULAR_RATE,
      overtimeRate: DEFAULT_OVERTIME_RATE,
    };
  }

  return {
    regularRate: DEFAULT_REGULAR_RATE,
    overtimeRate: DEFAULT_OVERTIME_RATE,
  };
}

router.get("/api/payroll/overview", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

    for (const entry of entriesForCost) {
      const regular = parseFloat(entry.hoursRegular || "0");
      const overtime = parseFloat(entry.hoursOvertime || "0");
      totalRegularHours += regular;
      totalOvertimeHours += overtime;

      const rates = await getEffectiveRate(entry.userId, entry.projectId, orgId);
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

router.get("/api/payroll/pay-runs", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

router.get("/api/payroll/pay-runs/:id", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

router.post("/api/payroll/pay-runs", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN"), async (req, res) => {
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
      totalWorkers: workerMap.size,
      notes: notes || null,
      createdById: authReq.user!.id,
    }).returning();

    const lineItemsToInsert: any[] = [];
    for (const [userId, worker] of Array.from(workerMap)) {
      for (const [key, data] of Array.from(worker.projectMap)) {
        const projectId = key.split(":")[0];
        const rates = await getEffectiveRate(userId, projectId, orgId);
        const amount = data.regular * rates.regularRate + data.overtime * rates.overtimeRate;
        totalRegular += data.regular;
        totalOvertime += data.overtime;
        totalCost += amount;

        lineItemsToInsert.push({
          payRunId: newPayRun.id,
          userId,
          projectId,
          costCode: data.costCode,
          regularHours: String(data.regular),
          overtimeHours: String(data.overtime),
          regularRate: String(rates.regularRate),
          overtimeRate: String(rates.overtimeRate),
          totalAmount: String(amount),
          timeEntryIds: data.entryIds,
          wageType: "STANDARD",
        });
      }
    }

    if (lineItemsToInsert.length > 0) {
      await db.insert(payRunLineItems).values(lineItemsToInsert);
    }

    await db.update(payRuns).set({
      totalRegularHours: String(totalRegular),
      totalOvertimeHours: String(totalOvertime),
      totalLaborCost: String(totalCost),
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

router.put("/api/payroll/pay-runs/:id/status", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

    res.json(updated);
  } catch (error) {
    console.error("Update pay run status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/payroll/workers", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

router.get("/api/payroll/time-entries", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

    const workerResults = [];
    for (const w of workerStats) {
      const reg = parseFloat(w.totalRegular);
      const ot = parseFloat(w.totalOvertime);
      totalRegular += reg;
      totalOvertime += ot;

      const rates = await getEffectiveRate(w.userId, projectId, orgId);
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

router.delete("/api/payroll/pay-runs/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
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
