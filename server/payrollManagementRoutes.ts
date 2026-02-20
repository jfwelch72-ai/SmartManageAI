import type { Express } from "express";
import { db } from "./db";
import {
  payRuns, payRunLineItems, timeEntries, users, projects,
  organizationPayrollSettings, insertPayRunSchema
} from "@shared/schema";
import { eq, and, gte, lte, sql, desc, inArray, count } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";

export function registerPayrollManagementRoutes(app: Express) {

  app.get("/api/payroll/overview", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

      const laborResult = await db.select({
        totalRegular: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursRegular} AS DECIMAL)), 0)`,
        totalOvertime: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursOvertime} AS DECIMAL)), 0)`,
        totalEntries: sql<number>`COUNT(*)`,
      }).from(timeEntries)
        .innerJoin(users, eq(timeEntries.userId, users.id))
        .where(and(
          eq(users.organizationId, orgId),
          gte(timeEntries.date, periodStart),
          lte(timeEntries.date, periodEnd),
        ));

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
          totalRegularHours: parseFloat(laborResult[0]?.totalRegular || "0"),
          totalOvertimeHours: parseFloat(laborResult[0]?.totalOvertime || "0"),
          totalLaborCost: parseFloat(laborResult[0]?.totalRegular || "0") * 45 + parseFloat(laborResult[0]?.totalOvertime || "0") * 67.5,
          unapprovedEntries: Number(unapprovedResult[0]?.count || 0),
        },
        recentPayRuns,
      });
    } catch (error) {
      console.error("Payroll overview error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/payroll/pay-runs", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

  app.get("/api/payroll/pay-runs/:id", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

  app.post("/api/payroll/pay-runs", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN"), async (req, res) => {
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
          const regularRate = 45;
          const overtimeRate = 67.5;
          const amount = data.regular * regularRate + data.overtime * overtimeRate;
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
            regularRate: String(regularRate),
            overtimeRate: String(overtimeRate),
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

  app.put("/api/payroll/pay-runs/:id/status", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

  app.get("/api/payroll/workers", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

  app.get("/api/payroll/time-entries", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "MANAGER", "SUPER_ADMIN"), async (req, res) => {
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

  app.get("/api/projects/:id/payroll-summary", requireAuth, async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const projectId = req.params.id;

      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const laborStats = await db.select({
        totalRegular: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursRegular} AS DECIMAL)), 0)`,
        totalOvertime: sql<string>`COALESCE(SUM(CAST(${timeEntries.hoursOvertime} AS DECIMAL)), 0)`,
        totalEntries: sql<number>`COUNT(*)`,
      }).from(timeEntries)
        .where(eq(timeEntries.projectId, projectId));

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

      const totalRegular = parseFloat(laborStats[0]?.totalRegular || "0");
      const totalOvertime = parseFloat(laborStats[0]?.totalOvertime || "0");
      const totalHours = totalRegular + totalOvertime;
      const laborCost = totalRegular * 45 + totalOvertime * 67.5;
      const overtimePercent = totalHours > 0 ? (totalOvertime / totalHours) * 100 : 0;
      const budget = parseFloat(String(project.budget || "0"));

      res.json({
        laborCostToDate: laborCost,
        budget,
        laborVsBudget: budget > 0 ? (laborCost / budget) * 100 : 0,
        totalRegularHours: totalRegular,
        totalOvertimeHours: totalOvertime,
        overtimePercent: Math.round(overtimePercent * 10) / 10,
        totalEntries: Number(laborStats[0]?.totalEntries || 0),
        workers: workerStats.map(w => ({
          userId: w.userId,
          name: w.userName,
          role: w.role,
          regularHours: parseFloat(w.totalRegular),
          overtimeHours: parseFloat(w.totalOvertime),
        })),
      });
    } catch (error) {
      console.error("Project payroll summary error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/payroll/pay-runs/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res) => {
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
}
