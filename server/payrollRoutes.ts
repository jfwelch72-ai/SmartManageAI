/**
 * @openapi
 * /api/payroll/overview:
 *   get:
 *     tags: [Payroll]
 *     summary: Payroll overview dashboard
 *     description: Returns summary statistics for payroll including total spend, headcount, and recent pay runs.
 *     responses:
 *       200: { description: Payroll overview data }
 * /api/payroll/pay-runs:
 *   get:
 *     tags: [Payroll]
 *     summary: List pay runs
 *     responses:
 *       200: { description: List of pay runs }
 *   post:
 *     tags: [Payroll]
 *     summary: Create a pay run
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [payPeriodStart, payPeriodEnd]
 *             properties:
 *               payPeriodStart: { type: string, format: date }
 *               payPeriodEnd: { type: string, format: date }
 *     responses:
 *       201: { description: Pay run created }
 * /api/payroll/pay-runs/{id}:
 *   get:
 *     tags: [Payroll]
 *     summary: Get pay run details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pay run details }
 *   delete:
 *     tags: [Payroll]
 *     summary: Delete a pay run
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pay run deleted }
 * /api/payroll/pay-runs/{id}/status:
 *   put:
 *     tags: [Payroll]
 *     summary: Update pay run status (PUT)
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string }
 *     responses:
 *       200: { description: Status updated }
 *   patch:
 *     tags: [Payroll]
 *     summary: Update pay run status (PATCH)
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string }
 *     responses:
 *       200: { description: Status updated }
 * /api/payroll/pay-runs/{id}/pay-stubs:
 *   get:
 *     tags: [Payroll]
 *     summary: Get pay stubs for a pay run
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of pay stubs }
 * /api/payroll/pay-runs/{id}/pay-stubs/{userId}:
 *   get:
 *     tags: [Payroll]
 *     summary: Get individual pay stub
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - name: userId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Pay stub details }
 * /api/payroll/pay-runs/{id}/certified-report:
 *   get:
 *     tags: [Payroll]
 *     summary: Get certified payroll report
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Certified payroll report }
 * /api/payroll/workers:
 *   get:
 *     tags: [Payroll]
 *     summary: List payroll workers
 *     responses:
 *       200: { description: Workers with rates }
 * /api/payroll/time-entries:
 *   get:
 *     tags: [Payroll]
 *     summary: Get time entries for payroll
 *     responses:
 *       200: { description: Time entries }
 * /api/projects/{id}/payroll-summary:
 *   get:
 *     tags: [Payroll]
 *     summary: Get payroll summary for a project
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Project payroll summary }
 * /api/payroll/deduction-types:
 *   get:
 *     tags: [Payroll]
 *     summary: List deduction types
 *     responses:
 *       200: { description: Deduction types }
 *   post:
 *     tags: [Payroll]
 *     summary: Create a deduction type
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, category]
 *             properties:
 *               name: { type: string }
 *               category: { type: string }
 *               defaultAmount: { type: string }
 *               isPercentage: { type: boolean }
 *     responses:
 *       201: { description: Deduction type created }
 * /api/payroll/deduction-types/{id}:
 *   patch:
 *     tags: [Payroll]
 *     summary: Update deduction type
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deduction type updated }
 *   delete:
 *     tags: [Payroll]
 *     summary: Delete deduction type
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deduction type deleted }
 * /api/payroll/employee-deductions:
 *   get:
 *     tags: [Payroll]
 *     summary: List all employee deductions
 *     responses:
 *       200: { description: Employee deductions }
 *   post:
 *     tags: [Payroll]
 *     summary: Create employee deduction
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Employee deduction created }
 * /api/payroll/employee-deductions/{userId}:
 *   get:
 *     tags: [Payroll]
 *     summary: Get deductions for a specific employee
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Employee deductions }
 * /api/payroll/employee-deductions/{id}:
 *   patch:
 *     tags: [Payroll]
 *     summary: Update employee deduction
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deduction updated }
 *   delete:
 *     tags: [Payroll]
 *     summary: Delete employee deduction
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Deduction deleted }
 * /api/payroll-notifications:
 *   get:
 *     tags: [Payroll]
 *     summary: Get payroll notifications
 *     responses:
 *       200: { description: Payroll notifications }
 *   post:
 *     tags: [Payroll]
 *     summary: Create payroll notification
 *     responses:
 *       201: { description: Notification created }
 * /api/payroll-notifications/{id}/process:
 *   patch:
 *     tags: [Payroll]
 *     summary: Process payroll notification
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Notification processed }
 * /api/payroll/settings:
 *   get:
 *     tags: [Payroll]
 *     summary: Get payroll settings
 *     responses:
 *       200: { description: Organization payroll settings }
 *   put:
 *     tags: [Payroll]
 *     summary: Update payroll settings
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Settings updated }
 * /api/payroll/weekly-reports:
 *   get:
 *     tags: [Payroll]
 *     summary: List weekly payroll reports
 *     responses:
 *       200: { description: Weekly reports }
 * /api/payroll/weekly-reports/{id}:
 *   get:
 *     tags: [Payroll]
 *     summary: Get weekly payroll report
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Report details }
 * /api/payroll/generate-weekly-report:
 *   post:
 *     tags: [Payroll]
 *     summary: Generate weekly payroll report
 *     responses:
 *       201: { description: Report generated }
 * /api/payroll/current-week-summary:
 *   get:
 *     tags: [Payroll]
 *     summary: Get current week payroll summary
 *     responses:
 *       200: { description: Current week summary }
 */
import {logError, logInfo, logWarn } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import { exportLimiter } from "./rateLimiter";
import { lookupCachedWageRate, lookupCachedRateByLocale, isWageDeterminationCached, listCachedDecisionClassifications, queueWageDecisionSync, getWageDecisionSyncStatus } from "./integrations/providers/dol_davis_bacon/sync";
import { payRuns, payRunLineItems, timeEntries, users, projects, organizationPayrollSettings, insertPayRunSchema, projectEmployeeRates, projectLaborRates, payrollDeductionTypes, employeeDeductions, payStubDeductions, insertPayrollDeductionTypeSchema, insertEmployeeDeductionSchema, organizations, jobClassifications, employeeClassifications, prevailingWageRates, payrollNotifications, notifications, weeklyPayrollReports, timeClockShifts, overtimeRules, costLedgerPostings, certifiedPayrollReports, auditLog } from "@shared/schema";
import { eq, and, gte, lte, sql, desc, inArray, count, asc, isNull, or } from "drizzle-orm";
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";
import { deliverNotification, type NotificationRecord } from "./services/notificationDelivery";
import { insertNotification } from "./services/notificationService";
import { successResponse } from "./responseHelper";
import { validateBody } from "./utils/validation";

const router = Router();

// ========================================
// Routes from payrollManagementRoutes.ts
// ========================================

router.use("/api/payroll", requireAuth, requireFeaturePermission('canManagePayroll'));
router.use("/api/projects/:id/payroll-summary", requireAuth, requireFeaturePermission('canManagePayroll'));
router.use("/api/projects/:id/prevailing-wage-summary", requireAuth, requireFeaturePermission('canManagePayroll'));

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

interface OvertimeConfig {
  dailyThreshold: number;
  weeklyThreshold: number;
  doubleTimeThreshold: number | null;
  weeklyDtThreshold: number | null;
  otMultiplier: number;
  dtMultiplier: number;
  consecutiveDayRule: boolean;
  consecutiveDayThreshold: number;
}

const DEFAULT_OT_CONFIG: OvertimeConfig = {
  dailyThreshold: 8,
  weeklyThreshold: 40,
  doubleTimeThreshold: 12,
  weeklyDtThreshold: 60,
  otMultiplier: 1.5,
  dtMultiplier: 2.0,
  consecutiveDayRule: false,
  consecutiveDayThreshold: 7,
};

function resolveWorkerOtConfig(
  workerProjectIds: string[],
  projectOtConfigCache: Map<string, OvertimeConfig>
): OvertimeConfig {
  if (workerProjectIds.length === 1) {
    return projectOtConfigCache.get(workerProjectIds[0]) || DEFAULT_OT_CONFIG;
  }
  const configs = workerProjectIds.map(pid => projectOtConfigCache.get(pid) || DEFAULT_OT_CONFIG);
  return {
    dailyThreshold: Math.min(...configs.map(c => c.dailyThreshold)),
    weeklyThreshold: Math.min(...configs.map(c => c.weeklyThreshold)),
    doubleTimeThreshold: Math.min(...configs.map(c => c.doubleTimeThreshold ?? Infinity)) === Infinity
      ? null : Math.min(...configs.map(c => c.doubleTimeThreshold ?? Infinity)),
    weeklyDtThreshold: Math.min(...configs.map(c => c.weeklyDtThreshold ?? Infinity)) === Infinity
      ? null : Math.min(...configs.map(c => c.weeklyDtThreshold ?? Infinity)),
    otMultiplier: Math.max(...configs.map(c => c.otMultiplier)),
    dtMultiplier: Math.max(...configs.map(c => c.dtMultiplier)),
    consecutiveDayRule: configs.some(c => c.consecutiveDayRule),
    consecutiveDayThreshold: Math.min(...configs.filter(c => c.consecutiveDayRule).map(c => c.consecutiveDayThreshold).concat([7])),
  };
}

async function getOvertimeConfig(orgId: string, projectId: string | null): Promise<OvertimeConfig> {
  function ruleToConfig(rule: typeof overtimeRules.$inferSelect): OvertimeConfig {
    return {
      dailyThreshold: parseFloat(rule.dailyThreshold),
      weeklyThreshold: parseFloat(rule.weeklyThreshold),
      doubleTimeThreshold: rule.doubleTimeThreshold ? parseFloat(rule.doubleTimeThreshold) : null,
      weeklyDtThreshold: rule.weeklyDtThreshold ? parseFloat(rule.weeklyDtThreshold) : null,
      otMultiplier: rule.otMultiplier ? parseFloat(rule.otMultiplier) : 1.5,
      dtMultiplier: rule.dtMultiplier ? parseFloat(rule.dtMultiplier) : 2.0,
      consecutiveDayRule: rule.consecutiveDayRule,
      consecutiveDayThreshold: rule.consecutiveDayThreshold || 7,
    };
  }

  if (projectId) {
    const [projectRule] = await db.select().from(overtimeRules)
      .where(and(
        eq(overtimeRules.organizationId, orgId),
        eq(overtimeRules.projectId, projectId),
        eq(overtimeRules.isActive, true),
      ))
      .orderBy(desc(overtimeRules.updatedAt))
      .limit(1);
    if (projectRule) return ruleToConfig(projectRule);
  }

  const [orgRule] = await db.select().from(overtimeRules)
    .where(and(
      eq(overtimeRules.organizationId, orgId),
      isNull(overtimeRules.projectId),
      eq(overtimeRules.isActive, true),
    ))
    .orderBy(desc(overtimeRules.updatedAt))
    .limit(1);

  if (orgRule) return ruleToConfig(orgRule);

  return DEFAULT_OT_CONFIG;
}

interface ClassifiedHours {
  regular: number;
  overtime: number;
  doubleTime: number;
}

function classifyDailyHours(totalHours: number, config: OvertimeConfig): ClassifiedHours {
  const daily = config.dailyThreshold;
  const dtThreshold = config.doubleTimeThreshold;

  let regular = Math.min(totalHours, daily);
  let overtime = 0;
  let doubleTime = 0;

  if (totalHours > daily) {
    if (dtThreshold !== null && totalHours > dtThreshold) {
      overtime = dtThreshold - daily;
      doubleTime = totalHours - dtThreshold;
    } else {
      overtime = totalHours - daily;
    }
  }

  return { regular, overtime, doubleTime };
}

async function postCostLedger(payRunId: string, txDb?: typeof db) {
  const queryDb = txDb || db;
  const [existingPosting] = await queryDb.select({ id: costLedgerPostings.id })
    .from(costLedgerPostings)
    .where(eq(costLedgerPostings.payRunId, payRunId))
    .limit(1);
  if (existingPosting) {
    logInfo(`Cost ledger postings already exist for pay run ${payRunId}, skipping`);
    return;
  }

  const lineItems = await queryDb.select({
    projectId: payRunLineItems.projectId,
    costCode: payRunLineItems.costCode,
    regularHours: payRunLineItems.regularHours,
    overtimeHours: payRunLineItems.overtimeHours,
    doubleTimeHours: payRunLineItems.doubleTimeHours,
    regularRate: payRunLineItems.regularRate,
    overtimeRate: payRunLineItems.overtimeRate,
    doubleTimeRate: payRunLineItems.doubleTimeRate,
  }).from(payRunLineItems).where(eq(payRunLineItems.payRunId, payRunId));

  const uniqueProjectIds = [...new Set(lineItems.map(li => li.projectId))];
  const burdenLookup = new Map<string, number>();
  if (uniqueProjectIds.length > 0) {
    const plrRows = await queryDb.select({
      projectId: projectLaborRates.projectId,
      burdenMultiplier: projectLaborRates.burdenMultiplier,
    }).from(projectLaborRates).where(inArray(projectLaborRates.projectId, uniqueProjectIds));
    for (const row of plrRows) {
      burdenLookup.set(row.projectId, parseFloat(row.burdenMultiplier));
    }
  }

  const postingMap = new Map<string, {
    projectId: string;
    costCode: string | null;
    regularAmount: number;
    overtimeAmount: number;
    doubleTimeAmount: number;
    regularHours: number;
    overtimeHours: number;
    doubleTimeHours: number;
  }>();

  for (const item of lineItems) {
    const key = `${item.projectId}:${item.costCode || "NONE"}`;
    if (!postingMap.has(key)) {
      postingMap.set(key, {
        projectId: item.projectId,
        costCode: item.costCode,
        regularAmount: 0,
        overtimeAmount: 0,
        doubleTimeAmount: 0,
        regularHours: 0,
        overtimeHours: 0,
        doubleTimeHours: 0,
      });
    }
    const posting = postingMap.get(key)!;
    const regH = parseFloat(item.regularHours);
    const otH = parseFloat(item.overtimeHours);
    const dtH = parseFloat(item.doubleTimeHours || "0");
    const regR = parseFloat(item.regularRate);
    const otR = parseFloat(item.overtimeRate);
    const dtR = parseFloat(item.doubleTimeRate || "0");

    posting.regularHours += regH;
    posting.overtimeHours += otH;
    posting.doubleTimeHours += dtH;
    posting.regularAmount += regH * regR;
    posting.overtimeAmount += otH * otR;
    posting.doubleTimeAmount += dtH * dtR;
  }

  const postings = Array.from(postingMap.values()).map(p => {
    const totalAmount = Math.round((p.regularAmount + p.overtimeAmount + p.doubleTimeAmount) * 100) / 100;
    const burden = burdenLookup.get(p.projectId) || 1.0;
    const burdenedTotal = Math.round(totalAmount * burden * 100) / 100;
    return {
      payRunId,
      projectId: p.projectId,
      costCode: p.costCode,
      regularAmount: String(Math.round(p.regularAmount * 100) / 100),
      overtimeAmount: String(Math.round(p.overtimeAmount * 100) / 100),
      doubleTimeAmount: String(Math.round(p.doubleTimeAmount * 100) / 100),
      totalAmount: String(totalAmount),
      burdenMultiplier: String(burden),
      burdenedTotalAmount: String(burdenedTotal),
      regularHours: String(Math.round(p.regularHours * 100) / 100),
      overtimeHours: String(Math.round(p.overtimeHours * 100) / 100),
      doubleTimeHours: String(Math.round(p.doubleTimeHours * 100) / 100),
      postedAt: new Date(),
    };
  });

  if (postings.length > 0) {
    await queryDb.insert(costLedgerPostings).values(postings);
    try {
      const { eventBus } = await import("./events");
      const projectIds = [...new Set(postings.map(p => p.projectId))];
      const projRows = projectIds.length > 0
        ? await queryDb.select({ id: projects.id, orgId: projects.gcOrganizationId }).from(projects).where(inArray(projects.id, projectIds))
        : [];
      const projOrgMap = new Map(projRows.map(p => [p.id, p.orgId]));
      for (const projectId of projectIds) {
        const projectPostings = postings.filter(p => p.projectId === projectId);
        const totalForProject = projectPostings.reduce((sum, p) => sum + parseFloat(p.totalAmount), 0);
        const orgId = projOrgMap.get(projectId);
        if (orgId) {
          await eventBus.emit({
            type: "cost_ledger.posted",
            version: 1,
            orgId,
            actorId: "system",
            timestamp: new Date(),
            payload: {
              projectId,
              totalAmount: String(totalForProject),
            },
          });
        }
      }
    } catch { logWarn("Non-critical operation failed"); }
  }
}

router.get("/api/payroll/overview", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/payroll/pay-runs", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/payroll/pay-runs/:id", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.post("/api/payroll/pay-runs", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const createPayRunSchema = z.object({
      payPeriodStart: z.string().min(1),
      payPeriodEnd: z.string().min(1),
      notes: z.string().nullable().optional(),
    });
    const parsed = createPayRunSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
    }
    const { payPeriodStart, payPeriodEnd, notes } = parsed.data;

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

    const workerMap = new Map<string, { projectMap: Map<string, { regular: number; overtime: number; doubleTime: number; costCode: string | null; entryIds: string[] }> }>();

    interface DayDetail {
      hours: number;
      date: string;
      projectId: string;
      costCode: string | null;
      entryIds: string[];
    }

    const workerDailyDetails = new Map<string, DayDetail[]>();

    for (const { entry } of approvedEntries) {
      const dateKey = entry.date instanceof Date ? entry.date.toISOString().split("T")[0] : String(entry.date).split("T")[0];
      const totalEntryHours = parseFloat(entry.hoursRegular || "0") + parseFloat(entry.hoursOvertime || "0");

      if (!workerDailyDetails.has(entry.userId)) {
        workerDailyDetails.set(entry.userId, []);
      }
      workerDailyDetails.get(entry.userId)!.push({
        hours: totalEntryHours,
        date: dateKey,
        projectId: entry.projectId,
        costCode: entry.costCode,
        entryIds: [entry.id],
      });
    }

    const projectOtConfigCache = new Map<string, OvertimeConfig>();
    async function resolveOtConfig(projectId: string): Promise<OvertimeConfig> {
      if (!projectOtConfigCache.has(projectId)) {
        projectOtConfigCache.set(projectId, await getOvertimeConfig(orgId, projectId));
      }
      return projectOtConfigCache.get(projectId)!;
    }

    const settingsForWeek = await db.select().from(organizationPayrollSettings).where(eq(organizationPayrollSettings.organizationId, orgId)).limit(1);
    const weekStartDay = settingsForWeek[0]?.workWeekStartDay || "MONDAY";
    const dayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const weekStartIndex = dayNames.indexOf(weekStartDay);

    function getWeekKey(dateStr: string): string {
      const d = new Date(dateStr + "T00:00:00Z");
      const dayOfWeek = d.getUTCDay();
      const diff = (dayOfWeek - weekStartIndex + 7) % 7;
      const weekStart = new Date(d);
      weekStart.setUTCDate(weekStart.getUTCDate() - diff);
      return weekStart.toISOString().split("T")[0];
    }

    for (const [userId, details] of Array.from(workerDailyDetails)) {
      const workerProjectIds = [...new Set(details.map(d => d.projectId))];
      for (const pid of workerProjectIds) {
        await resolveOtConfig(pid);
      }

      const dayPccDetails = new Map<string, Map<string, { hours: number; entryIds: string[]; costCode: string | null }>>();
      const workerDailyTotalMap = new Map<string, number>();
      const dayProjectHoursMap = new Map<string, Map<string, number>>();

      for (const d of details) {
        workerDailyTotalMap.set(d.date, (workerDailyTotalMap.get(d.date) || 0) + d.hours);
        if (!dayPccDetails.has(d.date)) {
          dayPccDetails.set(d.date, new Map());
        }
        const pccKey = `${d.projectId}:${d.costCode || "NONE"}`;
        const pccMap = dayPccDetails.get(d.date)!;
        if (!pccMap.has(pccKey)) {
          pccMap.set(pccKey, { hours: 0, entryIds: [], costCode: d.costCode });
        }
        const existing = pccMap.get(pccKey)!;
        existing.hours += d.hours;
        existing.entryIds.push(...d.entryIds);

        if (!dayProjectHoursMap.has(d.date)) {
          dayProjectHoursMap.set(d.date, new Map());
        }
        const projMap = dayProjectHoursMap.get(d.date)!;
        projMap.set(d.projectId, (projMap.get(d.projectId) || 0) + d.hours);
      }

      const sortedDates = [...workerDailyTotalMap.keys()].sort();

      const consecutiveDayStreak = new Map<string, number>();
      let streak = 1;
      for (let i = 0; i < sortedDates.length; i++) {
        if (i > 0) {
          const prev = new Date(sortedDates[i - 1]);
          const curr = new Date(sortedDates[i]);
          streak = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24) === 1 ? streak + 1 : 1;
        }
        consecutiveDayStreak.set(sortedDates[i], streak);
      }

      if (!workerMap.has(userId)) {
        workerMap.set(userId, { projectMap: new Map() });
      }
      const worker = workerMap.get(userId)!;

      const workerOtConfig = resolveWorkerOtConfig(workerProjectIds, projectOtConfigCache);

      let workerWeeklyCumulative = 0;
      let currentWeekKey = "";

      for (const date of sortedDates) {
        const wk = getWeekKey(date);
        if (wk !== currentWeekKey) {
          workerWeeklyCumulative = 0;
          currentWeekKey = wk;
        }

        const pccMap = dayPccDetails.get(date)!;
        const workerDayTotal = workerDailyTotalMap.get(date) || 0;
        const prevWeeklyCum = workerWeeklyCumulative;
        workerWeeklyCumulative += workerDayTotal;

        let dayRegular: number;
        let dayOvertime: number;
        let dayDoubleTime: number;

        const isConsecutiveDay = workerOtConfig.consecutiveDayRule &&
          (consecutiveDayStreak.get(date) || 0) >= workerOtConfig.consecutiveDayThreshold;

        if (isConsecutiveDay) {
          dayRegular = 0;
          dayOvertime = 0;
          dayDoubleTime = workerDayTotal;
        } else {
          const dailyClassified = classifyDailyHours(workerDayTotal, workerOtConfig);

          const wdt = workerOtConfig.weeklyDtThreshold;
          if (wdt !== null && prevWeeklyCum >= wdt) {
            dayRegular = 0;
            dayOvertime = 0;
            dayDoubleTime = workerDayTotal;
          } else if (wdt !== null && workerWeeklyCumulative > wdt) {
            const hoursBeforeWDT = Math.max(0, wdt - prevWeeklyCum);
            const hoursAfterWDT = workerWeeklyCumulative - wdt;
            const otHours = prevWeeklyCum >= workerOtConfig.weeklyThreshold
              ? hoursBeforeWDT
              : Math.max(0, hoursBeforeWDT - Math.max(0, workerOtConfig.weeklyThreshold - prevWeeklyCum));
            dayRegular = hoursBeforeWDT - otHours;
            dayOvertime = otHours;
            dayDoubleTime = hoursAfterWDT;
          } else if (prevWeeklyCum >= workerOtConfig.weeklyThreshold) {
            dayRegular = 0;
            dayOvertime = dailyClassified.regular + dailyClassified.overtime;
            dayDoubleTime = dailyClassified.doubleTime;
          } else if (workerWeeklyCumulative > workerOtConfig.weeklyThreshold) {
            const regularBudget = Math.max(0, workerOtConfig.weeklyThreshold - prevWeeklyCum);
            dayRegular = Math.min(dailyClassified.regular, regularBudget);
            dayOvertime = Math.max(0, dailyClassified.regular - regularBudget) + dailyClassified.overtime;
            dayDoubleTime = dailyClassified.doubleTime;
          } else {
            dayRegular = dailyClassified.regular;
            dayOvertime = dailyClassified.overtime;
            dayDoubleTime = dailyClassified.doubleTime;
          }
        }

        for (const [pccKey, pccData] of Array.from(pccMap)) {
          const proportion = workerDayTotal > 0 ? pccData.hours / workerDayTotal : 0;

          const allocRegular = Math.round(dayRegular * proportion * 100) / 100;
          const allocOvertime = Math.round(dayOvertime * proportion * 100) / 100;
          const allocDoubleTime = Math.round(dayDoubleTime * proportion * 100) / 100;

          if (!worker.projectMap.has(pccKey)) {
            const costCodePart = pccKey.split(":").slice(1).join(":");
            worker.projectMap.set(pccKey, {
              regular: 0,
              overtime: 0,
              doubleTime: 0,
              costCode: costCodePart === "NONE" ? null : costCodePart,
              entryIds: [],
            });
          }
          const bucket = worker.projectMap.get(pccKey)!;
          bucket.regular += allocRegular;
          bucket.overtime += allocOvertime;
          bucket.doubleTime += allocDoubleTime;
          bucket.entryIds.push(...pccData.entryIds);
        }

      }
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
        if (!projectOtConfigCache.has(projectId)) {
          projectOtConfigCache.set(projectId, await getOvertimeConfig(orgId, projectId));
        }
        const projConfig = projectOtConfigCache.get(projectId)!;
        const otRate = rates.regularRate * projConfig.otMultiplier;
        const dtRate = rates.regularRate * projConfig.dtMultiplier;
        const grossAmount = data.regular * rates.regularRate + data.overtime * otRate + data.doubleTime * dtRate;
        totalRegular += data.regular;
        totalOvertime += data.overtime + data.doubleTime;
        totalCost += grossAmount;

        deferredDeductions.push({ lineItemIndex: lineItemsToInsert.length, userId, grossAmount });

        lineItemsToInsert.push({
          payRunId: newPayRun.id,
          userId,
          projectId,
          costCode: data.costCode,
          regularHours: String(data.regular),
          overtimeHours: String(data.overtime),
          doubleTimeHours: String(data.doubleTime),
          regularRate: String(rates.regularRate),
          overtimeRate: String(otRate),
          doubleTimeRate: String(dtRate),
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
    next(error);
  }
});

const PAYROLL_APPROVE_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

const payRunStatusHandler = async (req: any, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const statusSchema = z.object({
      status: z.string().min(1),
    });
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
    }
    const { status } = parsed.data;
    const validTransitions: Record<string, string[]> = {
      DRAFT: ["PENDING_APPROVAL", "VOIDED", "ARCHIVED"],
      PENDING_APPROVAL: ["APPROVED", "DRAFT", "VOIDED", "ARCHIVED"],
      APPROVED: ["PROCESSING", "VOIDED", "ARCHIVED"],
      PROCESSING: ["PAID", "VOIDED", "ARCHIVED"],
      PAID: ["ARCHIVED"],
      VOIDED: ["ARCHIVED"],
      ARCHIVED: [],
    };

    const privilegedTransitions = ["APPROVED", "PROCESSING", "PAID", "VOIDED"];
    if (privilegedTransitions.includes(status)) {
      const userRole = authReq.user?.role;
      if (!userRole || !(PAYROLL_APPROVE_ROLES as readonly string[]).includes(userRole)) {
        return res.status(403).json({ error: "Only Admin, Office Manager, or Super Admin can approve, process, pay, or void pay runs" });
      }
    }

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

    let updated: typeof payRuns.$inferSelect;

    if (status === "APPROVED") {
      updated = await db.transaction(async (tx) => {
        const [result] = await tx.update(payRuns).set(updateData)
          .where(eq(payRuns.id, req.params.id)).returning();
        await postCostLedger(result.id, tx);
        return result;
      });

      try {
        const lineItemCount = await db
          .select({ userId: payRunLineItems.userId })
          .from(payRunLineItems)
          .where(eq(payRunLineItems.payRunId, updated.id));
        const uniqueEmployeeCount = new Set(lineItemCount.map((r) => r.userId)).size;

        await eventBus.emit({
          type: "payroll.run.completed",
          version: 1,
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
      } catch (emitErr) {
        logError("Failed to emit payroll.run.completed on APPROVED:", {}, emitErr instanceof Error ? emitErr : new Error(String(emitErr)));
      }
    } else {
      const [result] = await db.update(payRuns).set(updateData)
        .where(eq(payRuns.id, req.params.id)).returning();
      updated = result;
    }

    await logAudit({
      userId: authReq.user!.id,
      action: "UPDATE",
      entityType: "pay_runs",
      entityId: req.params.id,
      oldValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status }),
    });

    if (status === "PAID") {
      try {
        await postCostLedger(updated.id);
      } catch (err) {
        logError(`Cost ledger posting failed on PAID transition for pay run ${updated.id} (non-blocking):`, {}, err instanceof Error ? err : new Error(String(err)));
      }

      const lineItemCount = await db
        .select({ userId: payRunLineItems.userId })
        .from(payRunLineItems)
        .where(eq(payRunLineItems.payRunId, updated.id));
      const uniqueEmployeeCount = new Set(lineItemCount.map((r) => r.userId)).size;

      await eventBus.emit({
        type: "payroll.run.completed",
        version: 1,
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
    next(error);
  }
};
router.put("/api/payroll/pay-runs/:id/status", requireAuth, requireFeaturePermission("canManagePayroll"), payRunStatusHandler);
router.patch("/api/payroll/pay-runs/:id/status", requireAuth, requireFeaturePermission("canManagePayroll"), payRunStatusHandler);

router.get("/api/payroll/workers", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/payroll/time-entries", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/projects/:id/payroll-summary", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/projects/:id/prevailing-wage-summary", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const projectId = req.params.id;

    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)));
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectWageDecision = (project.wageDecision || "").trim() || null;

    const overrideRows = await db.select({
      id: prevailingWageRates.id,
      classificationId: prevailingWageRates.classificationId,
      classificationName: jobClassifications.name,
      wageRate: prevailingWageRates.wageRate,
      fringeRate: prevailingWageRates.fringeRate,
      totalRate: prevailingWageRates.totalRate,
      overtimeMultiplier: prevailingWageRates.overtimeMultiplier,
      effectiveDate: prevailingWageRates.effectiveDate,
      expirationDate: prevailingWageRates.expirationDate,
      wageDecision: prevailingWageRates.wageDecision,
    })
      .from(prevailingWageRates)
      .innerJoin(jobClassifications, eq(prevailingWageRates.classificationId, jobClassifications.id))
      .where(and(
        eq(prevailingWageRates.organizationId, orgId),
        eq(prevailingWageRates.projectId, projectId),
      ));

    const classifications: Array<{
      classificationId: string;
      classificationName: string;
      wageRate: number;
      fringeRate: number | null;
      totalRate: number | null;
      overtimeMultiplier: string | null;
      effectiveDate: string | null;
      expirationDate: string | null;
      wageDecision: string | null;
      source: "PROJECT_OVERRIDE" | "DOL_FEED";
    }> = [];

    const seenClassIds = new Set<string>();
    for (const r of overrideRows) {
      seenClassIds.add(r.classificationId);
      classifications.push({
        classificationId: r.classificationId,
        classificationName: r.classificationName,
        wageRate: parseFloat(r.wageRate),
        fringeRate: r.fringeRate != null ? parseFloat(r.fringeRate) : null,
        totalRate: r.totalRate != null ? parseFloat(r.totalRate) : null,
        overtimeMultiplier: r.overtimeMultiplier,
        effectiveDate: r.effectiveDate,
        expirationDate: r.expirationDate,
        wageDecision: r.wageDecision,
        source: "PROJECT_OVERRIDE",
      });
    }

    // For classifications referenced by employees who logged time on this
    // project but missing an override, attempt to surface the DOL feed rate
    // so users can see which classifications still rely on the cached
    // wage determination instead of an explicit project override.
    if (projectWageDecision) {
      const projectUserIds = await db.selectDistinct({ userId: timeEntries.userId })
        .from(timeEntries)
        .where(eq(timeEntries.projectId, projectId));
      const userIds = projectUserIds.map(r => r.userId).filter(Boolean) as string[];

      if (userIds.length > 0) {
        const empClasses = await db.select({
          classificationId: employeeClassifications.classificationId,
          classificationName: jobClassifications.name,
        })
          .from(employeeClassifications)
          .innerJoin(jobClassifications, eq(employeeClassifications.classificationId, jobClassifications.id))
          .where(inArray(employeeClassifications.userId, userIds));

        const uniqueByClassId = new Map<string, string>();
        for (const ec of empClasses) {
          if (!uniqueByClassId.has(ec.classificationId)) {
            uniqueByClassId.set(ec.classificationId, ec.classificationName);
          }
        }

        for (const [classificationId, classificationName] of Array.from(uniqueByClassId.entries())) {
          if (seenClassIds.has(classificationId)) continue;
          try {
            const cached = await lookupCachedWageRate(orgId, projectWageDecision, classificationName);
            if (cached && cached.baseRate > 0) {
              seenClassIds.add(classificationId);
              classifications.push({
                classificationId,
                classificationName,
                wageRate: cached.baseRate,
                fringeRate: cached.fringeRate ?? null,
                totalRate: cached.totalRate ?? null,
                overtimeMultiplier: null,
                effectiveDate: null,
                expirationDate: null,
                wageDecision: projectWageDecision,
                source: "DOL_FEED",
              });
            }
          } catch (err) {
            logWarn("Davis-Bacon decision lookup failed (project PW summary)", {
              decision: projectWageDecision,
              classificationName,
              error: String(err),
            });
          }
        }
      } else {
        // Brand-new project: wage decision is set but nobody has logged
        // time yet, so the per-employee resolution path above has nothing
        // to anchor on. Surface every classification carried by the
        // cached wage determination so PMs can see the imported
        // Davis-Bacon table before payroll runs. We match each cached
        // classification to an existing job_classifications row by name
        // (case-insensitive) when possible so the "promote to override"
        // action keeps working; otherwise we emit a synthetic display id
        // so the row still renders.
        try {
          const cachedRates = await listCachedDecisionClassifications(orgId, projectWageDecision);
          if (cachedRates && cachedRates.length > 0) {
            const orgClassifications = await db.select({
              id: jobClassifications.id,
              name: jobClassifications.name,
            })
              .from(jobClassifications)
              .where(eq(jobClassifications.organizationId, orgId));
            const classByName = new Map<string, { id: string; name: string }>();
            for (const c of orgClassifications) {
              classByName.set(c.name.trim().toLowerCase(), c);
            }

            for (const rate of cachedRates) {
              if (!rate || !rate.classification) continue;
              if (rate.baseRate <= 0) continue;
              const norm = rate.classification.trim().toLowerCase();
              const match = classByName.get(norm);
              const classificationId = match ? match.id : `dol-feed:${norm}`;
              const classificationName = match ? match.name : rate.classification;
              if (seenClassIds.has(classificationId)) continue;
              seenClassIds.add(classificationId);
              classifications.push({
                classificationId,
                classificationName,
                wageRate: rate.baseRate,
                fringeRate: rate.fringeRate ?? null,
                totalRate: rate.totalRate ?? null,
                overtimeMultiplier: null,
                effectiveDate: null,
                expirationDate: null,
                wageDecision: projectWageDecision,
                source: "DOL_FEED",
              });
            }
          }
        } catch (err) {
          logWarn("Davis-Bacon cached-decision listing failed (project PW summary)", {
            decision: projectWageDecision,
            error: String(err),
          });
        }
      }
    }

    let wageDecisionCached: boolean | null = null;
    let wageDecisionLastSyncAt: string | null = null;
    let wageDecisionLastAttemptAt: string | null = null;
    let wageDecisionLastError: string | null = null;
    if (projectWageDecision) {
      try {
        wageDecisionCached = await isWageDeterminationCached(orgId, projectWageDecision);
      } catch (err) {
        logWarn("Davis-Bacon cache check failed (project PW summary)", {
          decision: projectWageDecision,
          error: String(err),
        });
        wageDecisionCached = null;
      }
      // Task #1332: surface the last-attempt timestamp + any persisted
      // failure so the project payroll banner can flag a failed background
      // auto-sync instead of users only seeing the generic "not imported"
      // warning.
      try {
        const status = await getWageDecisionSyncStatus(orgId, projectWageDecision);
        if (status) {
          wageDecisionLastSyncAt = status.lastSyncAt ? status.lastSyncAt.toISOString() : null;
          wageDecisionLastAttemptAt = status.lastAttemptAt ? status.lastAttemptAt.toISOString() : null;
          wageDecisionLastError = status.lastError ?? null;
        }
      } catch (err) {
        logWarn("Davis-Bacon sync status lookup failed (project PW summary)", {
          decision: projectWageDecision,
          error: String(err),
        });
      }
    }

    classifications.sort((a, b) => a.classificationName.localeCompare(b.classificationName));

    res.json({
      projectId,
      wageDecision: projectWageDecision,
      wageDecisionCached,
      wageDecisionLastSyncAt,
      wageDecisionLastAttemptAt,
      wageDecisionLastError,
      classifications,
    });
  } catch (error) {
    next(error);
  }
});

// Trigger an inline Davis-Bacon sync for the project's wage decision so PMs
// can resolve the missing-decision warning without leaving the project page.
router.post("/api/projects/:id/prevailing-wage-summary/sync", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(authReq.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions to sync wage decisions" });
    }

    const projectId = req.params.id;
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)));
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const decisionNumber = (project.wageDecision || "").trim();
    if (!decisionNumber) {
      return res.status(400).json({ error: "Project has no wage decision set" });
    }

    const outcome = await queueWageDecisionSync(orgId, decisionNumber, { awaitResult: true });

    if (outcome.status === "no_connection") {
      return res.status(409).json({
        status: outcome.status,
        error: "No active Davis-Bacon (DOL/SAM.gov) integration is connected. Connect it from the Integrations area first.",
      });
    }
    if (outcome.status === "no_credentials") {
      return res.status(409).json({
        status: outcome.status,
        error: "Davis-Bacon connection is missing a SAM.gov API key.",
      });
    }
    if (outcome.status === "failed") {
      return res.status(502).json({ status: outcome.status, error: outcome.error });
    }
    if (outcome.status === "completed" && !outcome.result.success) {
      return res.status(502).json({
        status: "failed",
        error: outcome.result.errors.map((e) => e.message).join("; ") || "Sync failed",
      });
    }

    await logAudit({
      userId: authReq.user!.id,
      entityType: "wage_determination",
      entityId: decisionNumber,
      action: "UPDATE",
      newValue: JSON.stringify({ projectId, decisionNumber, status: outcome.status }),
    }, req);

    const ratesImported =
      outcome.status === "completed" ? outcome.result.created : 0;
    res.json({ success: true, status: outcome.status, decisionNumber, ratesImported });
  } catch (error) {
    next(error);
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

router.get("/api/payroll/deduction-types", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const results = await db.select().from(payrollDeductionTypes)
      .where(eq(payrollDeductionTypes.organizationId, orgId))
      .orderBy(asc(payrollDeductionTypes.sortOrder), asc(payrollDeductionTypes.name));

    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.post("/api/payroll/deduction-types", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const createDeductionTypeSchema = z.object({
      name: z.string().min(1),
      category: z.string().min(1),
      calculationMethod: z.string().optional(),
      rate: z.string().optional(),
      amount: z.string().optional(),
      maxAnnualAmount: z.string().optional(),
      isPreTax: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });
    const parsed = createDeductionTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
    }
    const { name, category, calculationMethod, rate, amount, maxAnnualAmount, isPreTax, isActive, sortOrder } = parsed.data;

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
    next(error);
  }
});

router.patch("/api/payroll/deduction-types/:id", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(payrollDeductionTypes)
      .where(and(eq(payrollDeductionTypes.id, req.params.id), eq(payrollDeductionTypes.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Deduction type not found" });

    const updateDeductionTypeSchema = z.object({
      name: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      calculationMethod: z.string().optional(),
      rate: z.string().optional(),
      amount: z.string().optional(),
      maxAnnualAmount: z.string().optional(),
      isPreTax: z.boolean().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().optional(),
    });
    const parsed = updateDeductionTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });
    }
    const { name, category, calculationMethod, rate, amount, maxAnnualAmount, isPreTax, isActive, sortOrder } = parsed.data;
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
    next(error);
  }
});

router.delete("/api/payroll/deduction-types/:id", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(payrollDeductionTypes)
      .where(and(eq(payrollDeductionTypes.id, req.params.id), eq(payrollDeductionTypes.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Deduction type not found" });

    await db.delete(payrollDeductionTypes).where(eq(payrollDeductionTypes.id, req.params.id));
    successResponse(res);
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/employee-deductions", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/payroll/employee-deductions/:userId", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.post("/api/payroll/employee-deductions", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const createEmployeeDeductionSchema = z.object({
      userId: z.string().min(1),
      deductionTypeId: z.string().min(1),
      effectiveDate: z.string().min(1),
      overrideAmount: z.string().optional(),
      endDate: z.string().optional(),
      isActive: z.boolean().optional(),
    });
    const validated = validateBody(createEmployeeDeductionSchema, req.body, res);
    if (!validated) return;
    const { userId, deductionTypeId, overrideAmount, effectiveDate, endDate, isActive } = validated;

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
    next(error);
  }
});

router.patch("/api/payroll/employee-deductions/:id", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(employeeDeductions)
      .where(and(eq(employeeDeductions.id, req.params.id), eq(employeeDeductions.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Employee deduction not found" });

    const updateEmployeeDeductionSchema = z.object({
      overrideAmount: z.string().nullable().optional(),
      effectiveDate: z.string().optional(),
      endDate: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
    });
    const validated = validateBody(updateEmployeeDeductionSchema, req.body, res);
    if (!validated) return;
    const { overrideAmount, effectiveDate, endDate, isActive } = validated;
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
    next(error);
  }
});

router.delete("/api/payroll/employee-deductions/:id", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [existing] = await db.select().from(employeeDeductions)
      .where(and(eq(employeeDeductions.id, req.params.id), eq(employeeDeductions.organizationId, orgId)));
    if (!existing) return res.status(404).json({ error: "Employee deduction not found" });

    await db.delete(employeeDeductions).where(eq(employeeDeductions.id, req.params.id));
    successResponse(res);
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/pay-runs/:id/pay-stubs", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

router.get("/api/payroll/pay-runs/:id/pay-stubs/:userId", requireAuth, async (req, res, next) => {
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
    next(error);
  }
});

// Task #1312: inline "Import now" action for the certified-payroll missing
// wage-decision banner. Triggers the Davis-Bacon sync for a single decision
// number against the org's active connection and waits for the import so the
// caller can refetch the report and immediately render DOL-feed rates.
router.post("/api/payroll/wage-decisions/sync", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const schema = z.object({
      decisionNumber: z.string().trim().min(1, "decisionNumber required").max(64),
    });
    const parsed = validateBody(schema, req.body, res);
    if (!parsed) return;

    const outcome = await queueWageDecisionSync(orgId, parsed.decisionNumber, { awaitResult: true });

    if (outcome.status === "no_connection") {
      return res.status(409).json({
        status: outcome.status,
        error: "No active Davis-Bacon (DOL/SAM.gov) integration is connected for this organization.",
      });
    }
    if (outcome.status === "no_credentials") {
      return res.status(409).json({
        status: outcome.status,
        error: "Davis-Bacon connection is missing a SAM.gov API key.",
      });
    }
    if (outcome.status === "failed") {
      return res.status(502).json({ status: outcome.status, error: outcome.error });
    }
    if (outcome.status === "completed" && !outcome.result.success) {
      return res.status(502).json({
        status: "failed",
        error: outcome.result.errors.map((e) => e.message).join("; ") || "Sync failed",
      });
    }

    return res.json({ status: outcome.status, decisionNumber: parsed.decisionNumber });
  } catch (error) {
    next(error);
  }
});

// Task #1330: org-wide aggregate of projects whose wage decision has not yet
// been imported into the Davis-Bacon cache. Powers the proactive banner on
// the payroll page so admins can run the DOL/SAM.gov import before
// generating certified payroll. Mirrors the per-pay-run "missingWageDecisions"
// payload returned by the certified-report endpoint, but scoped across every
// project in the org with a wageDecision set.
router.get("/api/payroll/missing-wage-decisions", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const projectRows = await db
      .select({ id: projects.id, name: projects.name, wageDecision: projects.wageDecision })
      .from(projects)
      .where(eq(projects.organizationId, orgId));

    // Dedupe cache lookups by decision number — many projects in an org
    // typically reference the same handful of wage decisions, and
    // isWageDeterminationCached hits the DB per call.
    const decisionCacheStatus = new Map<string, boolean>();
    const uniqueDecisions = Array.from(
      new Set(
        projectRows
          .map((p) => (p.wageDecision || "").trim())
          .filter((d) => d.length > 0),
      ),
    );
    await Promise.all(
      uniqueDecisions.map(async (decision) => {
        try {
          decisionCacheStatus.set(decision, await isWageDeterminationCached(orgId, decision));
        } catch (err) {
          logWarn("Davis-Bacon cache check failed", { decision, error: String(err) });
          decisionCacheStatus.set(decision, true); // treat as cached on error to avoid noisy false warnings
        }
      }),
    );

    const seen = new Set<string>();
    const missing: Array<{ projectId: string; projectName: string; wageDecision: string }> = [];
    for (const p of projectRows) {
      const decision = (p.wageDecision || "").trim();
      if (!decision) continue;
      const key = `${p.id}:${decision}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (decisionCacheStatus.get(decision) === false) {
        missing.push({
          projectId: p.id,
          projectName: p.name || "",
          wageDecision: decision,
        });
      }
    }

    res.json({ items: missing });
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/pay-runs/:id/certified-report", requireAuth, async (req, res, next) => {
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
      projectPayrollFormVariant: projects.payrollFormVariant,
      projectState: projects.state,
      projectCity: projects.city,
      projectWageDecision: projects.wageDecision,
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
    // Task #494: track where each (project, classification) prevailing rate
    // came from so the PDF/UI can show "Project override" vs "DOL feed"
    // captions and so we can report wage decisions that resolved to no
    // cached row.
    const pwSourceMap = new Map<string, "PROJECT_OVERRIDE" | "DOL_FEED">();
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
    // Task #494: union of project-level wage decisions referenced by this
    // pay run plus any decisions borrowed from prevailingWageRates rows.
    // Used to (a) drive Davis-Bacon fallback lookups and (b) compute the
    // "missing wage decisions" warning shown to the contractor.
    const projectDecisionMap = new Map<string, string>();
    const projectNameMap = new Map<string, string>();
    for (const item of lineItems) {
      projectNameMap.set(item.projectId, item.projectName);
      if (item.projectWageDecision && !projectDecisionMap.has(item.projectId)) {
        projectDecisionMap.set(item.projectId, item.projectWageDecision);
      }
    }
    if (classIds.length > 0 && lineItemProjectIds.length > 0) {
      const allPw = await db.select().from(prevailingWageRates)
        .where(and(
          eq(prevailingWageRates.organizationId, orgId),
          inArray(prevailingWageRates.projectId, lineItemProjectIds),
          inArray(prevailingWageRates.classificationId, classIds),
        ));
      for (const pw of allPw) {
        const k = `${pw.projectId}:${pw.classificationId}`;
        pwMap.set(k, parseFloat(pw.wageRate));
        pwSourceMap.set(k, "PROJECT_OVERRIDE");
      }

      // Davis-Bacon fallback: for any (project, classification) pair that has
      // no entry in prevailingWageRates, attempt to resolve via the cached
      // wage determination synced from DOL/SAM.gov. Prefer the project-level
      // wage decision (`projects.wageDecision`); otherwise borrow one from
      // an existing PW row for the same project (keeps the "one wage
      // decision per project" assumption used in WH-347).
      for (const pw of allPw) {
        if (pw.wageDecision && !projectDecisionMap.has(pw.projectId)) {
          projectDecisionMap.set(pw.projectId, pw.wageDecision);
        }
      }
      for (const item of lineItems) {
        const userClassId = classIdMap.get(item.lineItem.userId);
        if (!userClassId) continue;
        const key = `${item.projectId}:${userClassId}`;
        if (pwMap.has(key)) continue;
        const className = classNameMap.get(item.lineItem.userId);
        if (!className) continue;

        // Tier 1: known wage decision for this project → exact lookup
        const decision = projectDecisionMap.get(item.projectId);
        if (decision) {
          try {
            const cached = await lookupCachedWageRate(orgId, decision, className);
            if (cached && cached.baseRate > 0) {
              pwMap.set(key, cached.baseRate);
              pwSourceMap.set(key, "DOL_FEED");
              continue;
            }
          } catch (err) {
            logWarn("Davis-Bacon decision lookup failed", { decision, className, error: String(err) });
          }
        }

        // Tier 2: locale-based lookup (project state, no county column on
        // `projects` yet — pass null for county). Uses any cached
        // determination synced for the org that matches the locale.
        try {
          const localeRate = await lookupCachedRateByLocale(orgId, item.projectState, null, className);
          if (localeRate && localeRate.baseRate > 0) {
            pwMap.set(key, localeRate.baseRate);
            pwSourceMap.set(key, "DOL_FEED");
          }
        } catch (err) {
          logWarn("Davis-Bacon locale fallback failed", { state: item.projectState, className, error: String(err) });
        }
      }
    }

    // Task #494: any wage decision referenced by a project on this pay run
    // that has not been imported into the cache. Surfaced as a warning so
    // the contractor can run the DOL Davis-Bacon import before submitting.
    const missingWageDecisions: Array<{ projectId: string; projectName: string; wageDecision: string }> = [];
    {
      const seen = new Set<string>();
      for (const [projectId, decision] of Array.from(projectDecisionMap.entries())) {
        const key = `${projectId}:${decision}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const cached = await isWageDeterminationCached(orgId, decision);
          if (!cached) {
            missingWageDecisions.push({
              projectId,
              projectName: projectNameMap.get(projectId) || "",
              wageDecision: decision,
            });
          }
        } catch (err) {
          logWarn("Davis-Bacon cache check failed", { decision, error: String(err) });
        }
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
      let prevailingRateSource: "PROJECT_OVERRIDE" | "DOL_FEED" | "NONE" = "NONE";
      const userClassId = classIdMap.get(userId);
      if (userClassId) {
        const k = `${item.projectId}:${userClassId}`;
        const pw = pwMap.get(k);
        if (pw !== undefined) {
          prevailingRate = pw;
          prevailingRateSource = pwSourceMap.get(k) ?? "PROJECT_OVERRIDE";
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
        prevailingRateSource,
      });
    }

    const projectNames = [...new Set(employeeRows.map(r => r.projectName))];

    const projectIdToName = new Map<string, string>();
    const projectIdToVariant = new Map<string, string>();
    for (const item of lineItems) {
      projectIdToName.set(item.projectId, item.projectName);
      projectIdToVariant.set(item.projectId, item.projectPayrollFormVariant || "WH_347");
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
      payrollFormVariant: projectIdToVariant.get(projId) || "WH_347",
      employees,
      totals: {
        totalGross: Math.round(employees.reduce((s, e) => s + e.grossEarned, 0) * 100) / 100,
        totalDeductions: Math.round(employees.reduce((s, e) => s + e.totalDeductions, 0) * 100) / 100,
        totalNet: Math.round(employees.reduce((s, e) => s + e.netWages, 0) * 100) / 100,
      },
    }));

    const distinctVariants = new Set(projectReports.map(p => p.payrollFormVariant));
    const defaultPayrollFormVariant = distinctVariants.size === 1
      ? projectReports[0]?.payrollFormVariant ?? null
      : null;

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
      defaultPayrollFormVariant,
      missingWageDecisions,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/pay-runs/:id/certified-payroll-pdf", requireAuth, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const { getFeatureFlags } = await import("./services/featureFlagService");
    const flags = await getFeatureFlags(orgId);
    if (!flags.WH_347_PAYROLL) {
      return res.status(403).json({ error: "Certified payroll (WH-347) is not enabled for this organization" });
    }

    const [payRun] = await db.select().from(payRuns)
      .where(and(eq(payRuns.id, req.params.id), eq(payRuns.organizationId, orgId)));
    if (!payRun) return res.status(404).json({ error: "Pay run not found" });

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));

    const requestedProjectId = typeof req.query.projectId === "string" && req.query.projectId.length > 0
      ? req.query.projectId
      : null;

    const lineItems = await db.select({
      lineItem: payRunLineItems,
      firstName: users.firstName,
      lastName: users.lastName,
      projectName: projects.name,
      projectId: projects.id,
      projectLocation: projects.locationAddress,
      projectCode: projects.code,
      projectVariant: projects.payrollFormVariant,
      projectState: projects.state,
      projectWageDecision: projects.wageDecision,
    })
      .from(payRunLineItems)
      .innerJoin(users, eq(payRunLineItems.userId, users.id))
      .innerJoin(projects, eq(payRunLineItems.projectId, projects.id))
      .where(
        requestedProjectId
          ? and(eq(payRunLineItems.payRunId, req.params.id), eq(payRunLineItems.projectId, requestedProjectId))
          : eq(payRunLineItems.payRunId, req.params.id)
      )
      .orderBy(asc(users.lastName), asc(users.firstName));

    if (lineItems.length === 0) {
      return res.status(404).json({ error: "No payroll line items found for this pay run" });
    }

    const lineItemUserIds = [...new Set(lineItems.map(i => i.lineItem.userId))];
    const lineItemIds = lineItems.map(i => i.lineItem.id);
    const lineItemProjectIds = [...new Set(lineItems.map(i => i.projectId))];

    const classNameMap = new Map<string, string>();
    const classIdMap = new Map<string, string>();
    const pwMap = new Map<string, number>();
    // Task #494: rate-source tracker mirroring the JSON certified-report
    // endpoint so the WH-347 PDF can render "Project override" / "DOL feed"
    // captions under the rate-of-pay column.
    const pwSourceMap = new Map<string, "PROJECT_OVERRIDE" | "DOL_FEED">();
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

    const fringeBreakdownMap = new Map<string, { name: string; health: number; pension: number; vacation: number; training: number; total: number }>();
    const classIds = [...new Set(Array.from(classIdMap.values()))];
    if (classIds.length > 0 && lineItemProjectIds.length > 0) {
      const allPw = await db.select({
        rate: prevailingWageRates,
        className: jobClassifications.name,
      })
        .from(prevailingWageRates)
        .innerJoin(jobClassifications, eq(prevailingWageRates.classificationId, jobClassifications.id))
        .where(and(
          eq(prevailingWageRates.organizationId, orgId),
          inArray(prevailingWageRates.projectId, lineItemProjectIds),
          inArray(prevailingWageRates.classificationId, classIds),
        ));
      for (const row of allPw) {
        const pw = row.rate;
        const k = `${pw.projectId}:${pw.classificationId}`;
        pwMap.set(k, parseFloat(pw.wageRate));
        pwSourceMap.set(k, "PROJECT_OVERRIDE");
        const health = parseFloat(pw.fringeHealthRate || "0");
        const pension = parseFloat(pw.fringePensionRate || "0");
        const vacation = parseFloat(pw.fringeVacationRate || "0");
        const training = parseFloat(pw.fringeTrainingRate || "0");
        const breakdownTotal = health + pension + vacation + training;
        const total = breakdownTotal > 0 ? breakdownTotal : parseFloat(pw.fringeRate || "0");
        const key = `${pw.classificationId}`;
        const existing = fringeBreakdownMap.get(key);
        if (!existing || total > existing.total) {
          fringeBreakdownMap.set(key, {
            name: row.className,
            health,
            pension,
            vacation,
            training,
            total,
          });
        }
      }
    }

    // Task #494: Davis-Bacon fallback for the PDF endpoint. Mirrors the
    // logic in the JSON certified-report endpoint so the printed WH-347
    // automatically picks up cached DOL rates for any (project,
    // classification) pair without an explicit prevailingWageRates row.
    const projectDecisionMap = new Map<string, string>();
    const projectNameMap = new Map<string, string>();
    for (const item of lineItems) {
      projectNameMap.set(item.projectId, item.projectName);
      if (item.projectWageDecision && !projectDecisionMap.has(item.projectId)) {
        projectDecisionMap.set(item.projectId, item.projectWageDecision);
      }
    }
    if (classIds.length > 0 && lineItemProjectIds.length > 0) {
      const pwForDecisions = await db.select({
        projectId: prevailingWageRates.projectId,
        wageDecision: prevailingWageRates.wageDecision,
      })
        .from(prevailingWageRates)
        .where(and(
          eq(prevailingWageRates.organizationId, orgId),
          inArray(prevailingWageRates.projectId, lineItemProjectIds),
        ));
      for (const r of pwForDecisions) {
        if (r.wageDecision && !projectDecisionMap.has(r.projectId)) {
          projectDecisionMap.set(r.projectId, r.wageDecision);
        }
      }
      for (const item of lineItems) {
        const userClassId = classIdMap.get(item.lineItem.userId);
        if (!userClassId) continue;
        const key = `${item.projectId}:${userClassId}`;
        if (pwMap.has(key)) continue;
        const className = classNameMap.get(item.lineItem.userId);
        if (!className) continue;

        const decision = projectDecisionMap.get(item.projectId);
        if (decision) {
          try {
            const cached = await lookupCachedWageRate(orgId, decision, className);
            if (cached && cached.baseRate > 0) {
              pwMap.set(key, cached.baseRate);
              pwSourceMap.set(key, "DOL_FEED");
              continue;
            }
          } catch (err) {
            logWarn("Davis-Bacon decision lookup failed (pdf)", { decision, className, error: String(err) });
          }
        }
        try {
          const localeRate = await lookupCachedRateByLocale(orgId, item.projectState, null, className);
          if (localeRate && localeRate.baseRate > 0) {
            pwMap.set(key, localeRate.baseRate);
            pwSourceMap.set(key, "DOL_FEED");
          }
        } catch (err) {
          logWarn("Davis-Bacon locale fallback failed (pdf)", { state: item.projectState, className, error: String(err) });
        }
      }
    }

    // Wage decisions referenced by this report but not yet imported into
    // the cache. Listed on the PDF so the contractor can spot incomplete
    // data before submission.
    const missingWageDecisions: Array<{ projectName: string; wageDecision: string }> = [];
    {
      const seen = new Set<string>();
      for (const [projectId, decision] of Array.from(projectDecisionMap.entries())) {
        const k = `${projectId}:${decision}`;
        if (seen.has(k)) continue;
        seen.add(k);
        try {
          const cached = await isWageDeterminationCached(orgId, decision);
          if (!cached) {
            missingWageDecisions.push({
              projectName: projectNameMap.get(projectId) || "",
              wageDecision: decision,
            });
          }
        } catch (err) {
          logWarn("Davis-Bacon cache check failed (pdf)", { decision, error: String(err) });
        }
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

    const employees = lineItems.map(item => {
      const userId = item.lineItem.userId;
      const classification = classNameMap.get(userId) || "Laborer";
      let prevailingRate: number | null = null;
      let belowPrevailingWage = false;
      let prevailingRateSource: "PROJECT_OVERRIDE" | "DOL_FEED" | "NONE" = "NONE";
      const userClassId = classIdMap.get(userId);
      if (userClassId) {
        const k = `${item.projectId}:${userClassId}`;
        const pw = pwMap.get(k);
        if (pw !== undefined) {
          prevailingRate = pw;
          prevailingRateSource = pwSourceMap.get(k) ?? "PROJECT_OVERRIDE";
          if (parseFloat(item.lineItem.regularRate) < pw) belowPrevailingWage = true;
        }
      }
      const stubDeds = dedMap.get(item.lineItem.id) || [];
      let ficaAmount = 0, withholdingTax = 0, otherDeductions = 0;
      for (const d of stubDeds) {
        const amt = parseFloat(d.amount);
        if (d.category === "FICA" || d.category === "MEDICARE") ficaAmount += amt;
        else if (d.category === "FEDERAL_TAX" || d.category === "STATE_TAX" || d.category === "LOCAL_TAX") withholdingTax += amt;
        else otherDeductions += amt;
      }
      const totalDeductions = ficaAmount + withholdingTax + otherDeductions;
      const gross = parseFloat(item.lineItem.grossAmount || item.lineItem.totalAmount);
      const regH = parseFloat(item.lineItem.regularHours);
      const otH = parseFloat(item.lineItem.overtimeHours);
      return {
        name: `${item.firstName} ${item.lastName}`,
        workClassification: classification,
        regularHours: regH,
        overtimeHours: otH,
        totalHours: regH + otH,
        rateOfPay: parseFloat(item.lineItem.regularRate),
        overtimeRate: parseFloat(item.lineItem.overtimeRate),
        grossEarned: Math.round(gross * 100) / 100,
        fica: Math.round(ficaAmount * 100) / 100,
        withholdingTax: Math.round(withholdingTax * 100) / 100,
        otherDeductions: Math.round(otherDeductions * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        netWages: Math.round((gross - totalDeductions) * 100) / 100,
        projectName: item.projectName,
        prevailingRate,
        belowPrevailingWage,
        prevailingRateSource,
      };
    });

    const totalGross = employees.reduce((s, e) => s + e.grossEarned, 0);
    const totalDed = employees.reduce((s, e) => s + e.totalDeductions, 0);
    const projectName = [...new Set(lineItems.map(l => l.projectName))].join(", ");
    const projectLocation = [...new Set(lineItems.map(l => l.projectLocation).filter(Boolean) as string[])].join("; ");
    const projectCode = [...new Set(lineItems.map(l => l.projectCode))].join(", ");

    const [payrollSettings] = await db.select().from(organizationPayrollSettings)
      .where(eq(organizationPayrollSettings.organizationId, orgId)).limit(1);
    const fringeOption = (payrollSettings?.defaultFringeOption || "PLAN").toUpperCase();
    const fringeRatesArray = Array.from(fringeBreakdownMap.values())
      .filter(r => r.total > 0 || r.health > 0 || r.pension > 0 || r.vacation > 0 || r.training > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => ({
        classification: r.name,
        health: Math.round(r.health * 100) / 100,
        pension: Math.round(r.pension * 100) / 100,
        vacation: Math.round(r.vacation * 100) / 100,
        training: Math.round(r.training * 100) / 100,
        total: Math.round(r.total * 100) / 100,
      }));

    const { generateWH347Pdf } = await import("./services/wh347Generator");
    const { payrollFormVariantValues } = await import("@shared/schema/enums");
    type PayrollFormVariant = (typeof payrollFormVariantValues)[number];
    const isAllowedVariant = (v: string | null | undefined): v is PayrollFormVariant =>
      typeof v === "string" && (payrollFormVariantValues as readonly string[]).includes(v);
    const requestedVariant = typeof req.query.variant === "string" ? req.query.variant.toUpperCase() : null;
    // Use the project's configured variant when (a) the export is scoped to a
    // single project via ?projectId= or (b) every line item in the pay run
    // resolves to the same project variant. This keeps mixed-project pay runs
    // from silently picking a state-DOT form for unrelated work.
    const distinctProjectVariants = Array.from(
      new Set(lineItems.map(l => l.projectVariant).filter((v): v is string => !!v))
    );
    const projectVariant = requestedProjectId
      ? (lineItems[0].projectVariant ?? null)
      : (distinctProjectVariants.length === 1 ? distinctProjectVariants[0] : null);
    const variant: PayrollFormVariant = isAllowedVariant(requestedVariant)
      ? requestedVariant
      : isAllowedVariant(projectVariant)
        ? projectVariant
        : "WH_347";

    const pdfBuffer = await generateWH347Pdf({
      contractorName: org?.name || "",
      payrollNumber: payRun.runNumber,
      weekEndingDate: payRun.payPeriodEnd,
      projectName,
      projectLocation,
      projectNumber: projectCode,
      employees,
      totals: {
        totalGross: Math.round(totalGross * 100) / 100,
        totalDeductions: Math.round(totalDed * 100) / 100,
        totalNet: Math.round((totalGross - totalDed) * 100) / 100,
      },
      fringeBenefitsPaidToPlan: fringeOption === "PLAN",
      fringeBenefitsPaidInCash: fringeOption === "CASH",
      noFringeBenefitsRequired: fringeOption === "NONE",
      signerName: payrollSettings?.signerName || undefined,
      signerTitle: payrollSettings?.signerTitle || undefined,
      contractorAddress: payrollSettings?.contractorAddress || undefined,
      fringeRates: fringeRatesArray,
      missingWageDecisions,
    }, variant);

    // Persist to object storage at a unique key per generation and record an audit row.
    // The key embeds a fresh report id so each generation is an immutable artifact —
    // historical rows in `certified_payroll_reports` always resolve to the exact PDF
    // that was produced at that timestamp (state DOTs need this for audits).
    try {
      const { objectStorageClient } = await import("./objectStorage");
      const { setObjectAclPolicy } = await import("./objectAcl");
      const { randomUUID } = await import("crypto");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      if (privateDir) {
        const recordedProjectId = requestedProjectId
          || (lineItemProjectIds.length === 1 ? lineItemProjectIds[0] : null);
        const projectKeyPart = recordedProjectId || "all";
        const reportId = randomUUID();
        const key = `${privateDir}/${orgId}/payroll/certified/${payRun.id}/${projectKeyPart}/${reportId}_${variant}.pdf`;
        const parts = key.startsWith("/") ? key.slice(1).split("/") : key.split("/");
        const bucketName = parts[0];
        const objectName = parts.slice(1).join("/");
        const bucket = objectStorageClient.bucket(bucketName);
        const file = bucket.file(objectName);
        await file.save(pdfBuffer, { contentType: "application/pdf", metadata: { contentType: "application/pdf" } });
        await setObjectAclPolicy(file, {
          owner: authReq.user!.id,
          organizationId: orgId,
          visibility: "private",
        });

        await db.insert(certifiedPayrollReports).values({
          id: reportId,
          organizationId: orgId,
          payRunId: payRun.id,
          projectId: recordedProjectId,
          variant,
          objectKey: key,
          fileSize: pdfBuffer.length,
          generatedById: authReq.user!.id,
        });
      }
    } catch (storageErr) {
      logWarn("Failed to persist certified payroll PDF to object storage (non-critical)");
    }

    const fileName = `${variant}_${payRun.runNumber || payRun.id.slice(0, 8)}_${payRun.payPeriodEnd}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// List historical certified payroll reports for a project (most recent first).
router.get("/api/projects/:id/certified-payroll-reports", requireAuth, requireFeaturePermission('canManagePayroll'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const projectId = req.params.id;
    // Org-scope the project existence check so we don't leak whether a project from
    // another tenant exists (404 vs empty list semantics).
    const [project] = await db.select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId)));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const rows = await db.select({
      id: certifiedPayrollReports.id,
      payRunId: certifiedPayrollReports.payRunId,
      projectId: certifiedPayrollReports.projectId,
      variant: certifiedPayrollReports.variant,
      objectKey: certifiedPayrollReports.objectKey,
      fileSize: certifiedPayrollReports.fileSize,
      generatedAt: certifiedPayrollReports.generatedAt,
      generatedById: certifiedPayrollReports.generatedById,
      generatedByFirstName: users.firstName,
      generatedByLastName: users.lastName,
      generatedByEmail: users.email,
      payRunNumber: payRuns.runNumber,
      payPeriodStart: payRuns.payPeriodStart,
      payPeriodEnd: payRuns.payPeriodEnd,
    })
      .from(certifiedPayrollReports)
      .innerJoin(payRuns, eq(certifiedPayrollReports.payRunId, payRuns.id))
      .leftJoin(users, eq(certifiedPayrollReports.generatedById, users.id))
      .where(and(
        eq(certifiedPayrollReports.organizationId, orgId),
        eq(certifiedPayrollReports.projectId, projectId),
      ))
      .orderBy(desc(certifiedPayrollReports.generatedAt));

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// Org-wide certified payroll history with optional filters by project, variant, and date range.
// Mirrors the per-project endpoint above but returns rows for every project in the org so
// payroll administrators can audit the entire compliance archive in one place.
router.get("/api/payroll/certified-reports", requireAuth, requireFeaturePermission('canManagePayroll'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const filterSchema = z.object({
      projectId: z.string().uuid().optional(),
      variant: z.string().min(1).max(64).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      format: z.enum(["json", "csv"]).optional(),
      // Task #1117: archived rows are hidden by default; admins can opt in to see them.
      includeArchived: z.enum(["true", "false"]).optional(),
      onlyArchived: z.enum(["true", "false"]).optional(),
    });
    const parsed = filterSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid filters", details: parsed.error.flatten() });
    const { projectId, variant, startDate, endDate, format: outputFormat, includeArchived, onlyArchived } = parsed.data;

    const conditions = [eq(certifiedPayrollReports.organizationId, orgId)];
    if (projectId) conditions.push(eq(certifiedPayrollReports.projectId, projectId));
    if (variant) conditions.push(eq(certifiedPayrollReports.variant, variant));
    if (startDate) conditions.push(gte(certifiedPayrollReports.generatedAt, new Date(`${startDate}T00:00:00.000Z`)));
    if (endDate) conditions.push(lte(certifiedPayrollReports.generatedAt, new Date(`${endDate}T23:59:59.999Z`)));
    // Only ADMIN / SUPER_ADMIN may surface archived rows; everyone else gets
    // the default active-only view regardless of query string.
    const role = authReq.user?.role;
    const canSeeArchived = role === "ADMIN" || role === "SUPER_ADMIN";
    if (canSeeArchived && onlyArchived === "true") {
      conditions.push(sql`${certifiedPayrollReports.archivedAt} IS NOT NULL`);
    } else if (!canSeeArchived || includeArchived !== "true") {
      conditions.push(isNull(certifiedPayrollReports.archivedAt));
    }

    const rows = await db.select({
      id: certifiedPayrollReports.id,
      payRunId: certifiedPayrollReports.payRunId,
      projectId: certifiedPayrollReports.projectId,
      projectName: projects.name,
      variant: certifiedPayrollReports.variant,
      objectKey: certifiedPayrollReports.objectKey,
      fileSize: certifiedPayrollReports.fileSize,
      generatedAt: certifiedPayrollReports.generatedAt,
      generatedById: certifiedPayrollReports.generatedById,
      generatedByFirstName: users.firstName,
      generatedByLastName: users.lastName,
      generatedByEmail: users.email,
      payRunNumber: payRuns.runNumber,
      payPeriodStart: payRuns.payPeriodStart,
      payPeriodEnd: payRuns.payPeriodEnd,
      archivedAt: certifiedPayrollReports.archivedAt,
      archivedById: certifiedPayrollReports.archivedById,
      archiveReason: certifiedPayrollReports.archiveReason,
    })
      .from(certifiedPayrollReports)
      .leftJoin(payRuns, eq(certifiedPayrollReports.payRunId, payRuns.id))
      .leftJoin(users, eq(certifiedPayrollReports.generatedById, users.id))
      .leftJoin(projects, eq(certifiedPayrollReports.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(certifiedPayrollReports.generatedAt));

    if (outputFormat === "csv") {
      const escape = (val: unknown) => {
        if (val === null || val === undefined) return "";
        const s = String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        "Generated At",
        "Project",
        "Pay Run",
        "Pay Period Start",
        "Pay Period End",
        "Form Variant",
        "Generated By",
        "File Size (bytes)",
        "Report ID",
      ];
      const lines = [header.join(",")];
      for (const r of rows) {
        const generatedBy = [r.generatedByFirstName, r.generatedByLastName].filter(Boolean).join(" ")
          || r.generatedByEmail
          || "";
        lines.push([
          r.generatedAt instanceof Date ? r.generatedAt.toISOString() : String(r.generatedAt),
          r.projectName || "(All projects)",
          r.payRunNumber || r.payRunId.slice(0, 8),
          r.payPeriodStart,
          r.payPeriodEnd,
          r.variant,
          generatedBy,
          r.fileSize ?? 0,
          r.id,
        ].map(escape).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="certified-payroll-history-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(lines.join("\n"));
    }

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// Issue a short-lived signed URL to download a previously generated certified payroll PDF.
router.get("/api/payroll/certified-reports/:id/download-url", requireAuth, requireFeaturePermission('canManagePayroll'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const [report] = await db.select().from(certifiedPayrollReports)
      .where(and(eq(certifiedPayrollReports.id, req.params.id), eq(certifiedPayrollReports.organizationId, orgId)));
    if (!report) return res.status(404).json({ error: "Report not found" });

    const { objectStorageClient, ObjectStorageService } = await import("./objectStorage");
    const parts = report.objectKey.startsWith("/") ? report.objectKey.slice(1).split("/") : report.objectKey.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) return res.status(410).json({ error: "Stored PDF is no longer available" });
    const url = await new ObjectStorageService().getSignedDownloadUrl(file, 300);
    res.json({ url, expiresInSec: 300 });
  } catch (error) {
    next(error);
  }
});

// Task #1117: archive (soft-hide) a certified payroll report so it falls out of
// the default org-wide history view. Reason is captured in the audit log so
// compliance reviewers can see why a row was removed from the active list.
router.post(
  "/api/payroll/certified-reports/:id/archive",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req, res, next) => {
    try {
      const authReq = req as AuthRequest;
      const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
      if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

      const bodySchema = z.object({ reason: z.string().min(3).max(500) });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Reason is required (3-500 chars)" });

      const [report] = await db.select().from(certifiedPayrollReports)
        .where(and(
          eq(certifiedPayrollReports.id, req.params.id),
          eq(certifiedPayrollReports.organizationId, orgId),
        ));
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (report.archivedAt) return res.status(400).json({ error: "Report is already archived" });

      const archivedAt = new Date();
      await db.update(certifiedPayrollReports)
        .set({
          archivedAt,
          archivedById: authReq.user!.id,
          archiveReason: parsed.data.reason,
        })
        .where(eq(certifiedPayrollReports.id, req.params.id));

      await logAudit({
        userId: authReq.user!.id,
        action: "ARCHIVE",
        entityType: "certified_payroll_reports",
        entityId: report.id,
        oldValue: JSON.stringify({
          payRunId: report.payRunId,
          projectId: report.projectId,
          variant: report.variant,
          objectKey: report.objectKey,
        }),
        newValue: JSON.stringify({ archivedAt: archivedAt.toISOString(), reason: parsed.data.reason }),
      }, req);

      res.json({ success: true, archivedAt: archivedAt.toISOString() });
    } catch (error) {
      next(error);
    }
  },
);

// Task #1117: restore a previously archived report back into the default list.
router.post(
  "/api/payroll/certified-reports/:id/unarchive",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req, res, next) => {
    try {
      const authReq = req as AuthRequest;
      const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
      if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

      const [report] = await db.select().from(certifiedPayrollReports)
        .where(and(
          eq(certifiedPayrollReports.id, req.params.id),
          eq(certifiedPayrollReports.organizationId, orgId),
        ));
      if (!report) return res.status(404).json({ error: "Report not found" });
      if (!report.archivedAt) return res.status(400).json({ error: "Report is not archived" });

      await db.update(certifiedPayrollReports)
        .set({ archivedAt: null, archivedById: null, archiveReason: null })
        .where(eq(certifiedPayrollReports.id, req.params.id));

      await logAudit({
        userId: authReq.user!.id,
        action: "UNARCHIVE",
        entityType: "certified_payroll_reports",
        entityId: report.id,
        oldValue: JSON.stringify({
          archivedAt: report.archivedAt,
          archivedById: report.archivedById,
          archiveReason: report.archiveReason,
        }),
      }, req);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

// Task #1117: hard-delete a certified payroll report and its underlying
// object-storage PDF. Admin-only and audit-logged with the reason supplied
// by the operator (e.g. "draft pay run", "wrong variant", "test data").
router.delete(
  "/api/payroll/certified-reports/:id",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req, res, next) => {
    try {
      const authReq = req as AuthRequest;
      const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
      if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

      const bodySchema = z.object({ reason: z.string().min(3).max(500) });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Reason is required (3-500 chars)" });

      const [report] = await db.select().from(certifiedPayrollReports)
        .where(and(
          eq(certifiedPayrollReports.id, req.params.id),
          eq(certifiedPayrollReports.organizationId, orgId),
        ));
      if (!report) return res.status(404).json({ error: "Report not found" });

      // Delete the underlying PDF first; if object storage rejects the delete
      // we abort so we never leave the DB row pointing at an orphaned file.
      // (Task done-criterion: "Deletes also remove the underlying object-storage file".)
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        await new ObjectStorageService().deleteObjectByKey(report.objectKey);
      } catch (err) {
        logWarn("Failed to delete certified payroll PDF from object storage — aborting DB delete");
        return res.status(502).json({
          error: "Could not delete the underlying PDF from object storage. The report row was kept so it stays consistent — please retry.",
        });
      }

      await db.delete(certifiedPayrollReports).where(eq(certifiedPayrollReports.id, req.params.id));

      await logAudit({
        userId: authReq.user!.id,
        action: "DELETE",
        entityType: "certified_payroll_reports",
        entityId: report.id,
        oldValue: JSON.stringify({
          payRunId: report.payRunId,
          projectId: report.projectId,
          variant: report.variant,
          objectKey: report.objectKey,
          fileSize: report.fileSize,
          generatedAt: report.generatedAt,
          generatedById: report.generatedById,
        }),
        newValue: JSON.stringify({ reason: parsed.data.reason, storageDeleted: true }),
      }, req);

      res.json({ success: true, storageDeleted: true });
    } catch (error) {
      next(error);
    }
  },
);

// Task #1179: return the full archive/restore/delete audit timeline for a single
// certified payroll report so compliance reviewers can see who did what (and
// why) inline on the history page instead of digging through the global audit
// log viewer. Cross-tenant safe: we first verify the report belongs to the
// caller's org, *or* (for already-deleted rows) we restrict to audit rows whose
// actor is in the caller's org.
router.get(
  "/api/payroll/certified-reports/:id/audit-history",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  async (req, res, next) => {
    try {
      const authReq = req as AuthRequest;
      const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
      if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

      const reportId = req.params.id;

      // If the report still exists, enforce same-org ownership. If it has been
      // hard-deleted we still want the timeline to be viewable — but only to
      // admins of the org whose users actually performed the actions.
      const [report] = await db.select({ id: certifiedPayrollReports.id })
        .from(certifiedPayrollReports)
        .where(and(
          eq(certifiedPayrollReports.id, reportId),
          eq(certifiedPayrollReports.organizationId, orgId),
        ));

      const rows = await db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          createdAt: auditLog.createdAt,
          oldValue: auditLog.oldValue,
          newValue: auditLog.newValue,
          actorId: users.id,
          actorFirstName: users.firstName,
          actorLastName: users.lastName,
          actorEmail: users.email,
          actorOrganizationId: users.organizationId,
        })
        .from(auditLog)
        .innerJoin(users, eq(auditLog.userId, users.id))
        .where(and(
          eq(auditLog.entityType, "certified_payroll_reports"),
          eq(auditLog.entityId, reportId),
          // If the row still exists we already know it's in our org, but we
          // still scope by actor org so a stray cross-org audit row can never
          // leak in. If the row was hard-deleted we rely solely on actor org.
          eq(users.organizationId, orgId),
        ))
        .orderBy(desc(auditLog.createdAt));

      // Pull out the supplied reason for the operator's convenience. The
      // archive/unarchive/delete handlers store it in newValue (or oldValue
      // for unarchive) as JSON `{ reason: ... }` / `{ archiveReason: ... }`.
      const extractReason = (raw: string | null): string | null => {
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            if (typeof parsed.reason === "string") return parsed.reason;
            if (typeof parsed.archiveReason === "string") return parsed.archiveReason;
          }
        } catch {
          // not JSON — fall through
        }
        return null;
      };

      res.json({
        reportExists: !!report,
        entries: rows.map((r) => ({
          id: r.id,
          action: r.action,
          createdAt: r.createdAt,
          actorId: r.actorId,
          actorName: [r.actorFirstName, r.actorLastName].filter(Boolean).join(" ") || r.actorEmail || "Unknown",
          actorEmail: r.actorEmail,
          // For ARCHIVE/DELETE the reason is in newValue; for UNARCHIVE the
          // archive reason being undone lives in oldValue.
          reason: extractReason(r.newValue) ?? extractReason(r.oldValue),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.delete("/api/payroll/pay-runs/:id", requireAuth, requireFeaturePermission("canManagePayroll"), async (req, res, next) => {
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

    successResponse(res);
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from payrollNotificationRoutes.ts
// ========================================

router.get("/api/payroll-notifications", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }

    const conditions: any[] = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(payrollNotifications.organizationId, orgId));
    }

    const { status, limit = "20" } = req.query;
    if (status) {
      conditions.push(eq(payrollNotifications.status, status as string));
    }

    const notificationList = await db
      .select({
        notification: payrollNotifications,
        manager: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
      })
      .from(payrollNotifications)
      .leftJoin(users, eq(payrollNotifications.approvingManagerId, users.id))
      .leftJoin(projects, eq(payrollNotifications.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(payrollNotifications.createdAt))
      .limit(parseInt(limit as string));

    const formatted = notificationList.map(({ notification, manager, project }) => ({
      ...notification,
      managerName: manager ? `${manager.firstName} ${manager.lastName}` : "Unknown",
      projectName: project?.name,
      projectCode: project?.code,
    }));

    res.json(formatted);
  } catch (error) {
    next(error);
  }
});

router.post("/api/payroll-notifications", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = z.object({
      periodStart: z.string(),
      periodEnd: z.string(),
      projectId: z.string().optional().nullable(),
      totalShiftsApproved: z.number().optional().default(0),
      totalTimeEntriesApproved: z.number().optional().default(0),
      totalHours: z.string().optional().nullable(),
    });

    const data = schema.parse(req.body);

    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }

    const officeManagers = await db
      .select()
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        eq(users.role)
      ))
      .limit(1);

    const officeManagerId = officeManagers.length > 0 ? officeManagers[0].id : null;

    const [notification] = await db.insert(payrollNotifications).values({
      organizationId: orgId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      projectId: data.projectId || null,
      approvingManagerId: req.user!.id,
      officeManagerId,
      status: "PENDING",
      totalShiftsApproved: data.totalShiftsApproved,
      totalTimeEntriesApproved: data.totalTimeEntriesApproved,
      totalHours: data.totalHours || null,
    }).returning();

    if (officeManagerId) {
      const [insertedNotif] = await db.insert(notifications).values({
        userId: officeManagerId,
        organizationId: orgId,
        type: "GENERAL",
        title: "Payroll Ready for Processing",
        message: `Time entries for period ${data.periodStart} to ${data.periodEnd} have been approved and are ready for payroll processing.`,
        relatedEntityId: notification.id,
        relatedEntityType: "payrollNotification",
      }).returning();
      if (insertedNotif) {
        const notifRecord: NotificationRecord = {
          id: insertedNotif.id,
          userId: insertedNotif.userId,
          type: insertedNotif.type as NotificationRecord["type"],
          title: insertedNotif.title,
          message: insertedNotif.message,
          relatedEntityId: insertedNotif.relatedEntityId,
          relatedEntityType: insertedNotif.relatedEntityType,
        };
        setImmediate(() => {
          deliverNotification(notifRecord).catch(() => undefined);
        });
      }
    }

    res.status(201).json(notification);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/payroll-notifications/:id/process", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [notification] = await db
      .select()
      .from(payrollNotifications)
      .where(eq(payrollNotifications.id, req.params.id))
      .limit(1);

    if (!notification) {
      return res.status(404).json({ error: "Payroll notification not found" });
    }

    if (shouldFilter && orgId && notification.organizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [updated] = await db
      .update(payrollNotifications)
      .set({
        status: "PROCESSED",
        processedAt: new Date(),
        processedById: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(payrollNotifications.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from payrollSettingsRoutes.ts
// ========================================

const WORK_WEEK_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

function getDayNumber(day: typeof WORK_WEEK_DAYS[number]): number {
  return WORK_WEEK_DAYS.indexOf(day);
}

function getWeekBounds(date: Date, startDay: typeof WORK_WEEK_DAYS[number]): { start: Date; end: Date } {
  const targetDayNum = getDayNumber(startDay);
  const currentDayNum = date.getDay();
  
  const daysToSubtract = (currentDayNum - targetDayNum + 7) % 7;
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - daysToSubtract);
  weekStart.setHours(0, 0, 0, 0);
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  
  return { start: weekStart, end: weekEnd };
}

router.get("/api/payroll/settings", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      res.status(400).json({ error: "Organization context required" });
      return;
    }

    const [settings] = await db
      .select()
      .from(organizationPayrollSettings)
      .where(eq(organizationPayrollSettings.organizationId, orgId))
      .limit(1);

    if (!settings) {
      const [newSettings] = await db.insert(organizationPayrollSettings).values({
        organizationId: orgId,
      }).returning();
      res.json(newSettings);
      return;
    }

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

router.put("/api/payroll/settings", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      res.status(400).json({ error: "Organization context required" });
      return;
    }

    const updateSchema = z.object({
      workWeekStartDay: z.enum(WORK_WEEK_DAYS).optional(),
      workWeekEndNotificationEnabled: z.boolean().optional(),
      notificationRecipientEmails: z.string().nullable().optional(),
      overtimeThresholdHours: z.string().optional(),
      autoGenerateWeeklyReports: z.boolean().optional(),
      requireSuperintendentApproval: z.boolean().optional(),
      signerName: z.string().nullable().optional(),
      signerTitle: z.string().nullable().optional(),
      contractorAddress: z.string().nullable().optional(),
      defaultFringeOption: z.enum(["PLAN", "CASH", "NONE"]).optional(),
      // Task #1178: 0 disables the auto-purge job for this org; cap at
      // 36500 days (~100 years) to keep the column inside int range.
      archivedReportRetentionDays: z.number().int().min(0).max(36500).optional(),
      // Task #1181: per-org certified payroll digest schedule.
      certifiedPayrollDigestCadence: z.enum(["OFF", "DAILY", "WEEKLY", "BIWEEKLY"]).optional(),
      certifiedPayrollDigestWeekday: z.number().int().min(0).max(6).optional(),
      certifiedPayrollDigestHour: z.number().int().min(0).max(23).optional(),
      certifiedPayrollDigestTimezone: z.string().refine(
        (v) => { try { new Intl.DateTimeFormat("en-US", { timeZone: v }); return true; } catch { return false; } },
        { message: "Invalid IANA timezone" },
      ).optional(),
    });

    const data = updateSchema.parse(req.body);

    const [existingSettings] = await db
      .select()
      .from(organizationPayrollSettings)
      .where(eq(organizationPayrollSettings.organizationId, orgId))
      .limit(1);

    let settings;
    if (!existingSettings) {
      [settings] = await db.insert(organizationPayrollSettings).values({
        organizationId: orgId,
        ...data,
      }).returning();
    } else {
      [settings] = await db
        .update(organizationPayrollSettings)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(organizationPayrollSettings.organizationId, orgId))
        .returning();
    }

    await logAudit({
      userId: authReq.user!.id,
      entityType: "PAYROLL_SETTINGS",
      entityId: settings.id,
      action: existingSettings ? "UPDATE" : "CREATE",
      oldValue: existingSettings ? JSON.stringify(existingSettings) : null,
      newValue: JSON.stringify(settings),
    }, authReq);

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/weekly-reports", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      res.status(400).json({ error: "Organization context required" });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 10;

    const reports = await db
      .select()
      .from(weeklyPayrollReports)
      .where(eq(weeklyPayrollReports.organizationId, orgId))
      .orderBy(desc(weeklyPayrollReports.weekStartDate))
      .limit(limit);

    res.json(reports);
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/weekly-reports/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      res.status(400).json({ error: "Organization context required" });
      return;
    }

    const [report] = await db
      .select()
      .from(weeklyPayrollReports)
      .where(and(
        eq(weeklyPayrollReports.id, req.params.id),
        eq(weeklyPayrollReports.organizationId, orgId)
      ))
      .limit(1);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    res.json(report);
  } catch (error) {
    next(error);
  }
});

router.post("/api/payroll/generate-weekly-report", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "SUPERINTENDENT", "MANAGER"), exportLimiter, async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      res.status(400).json({ error: "Organization context required" });
      return;
    }

    const generateSchema = z.object({
      weekStartDate: z.string().optional(),
      sendNotification: z.boolean().optional().default(true),
    });

    const data = generateSchema.parse(req.body);

    const [settings] = await db
      .select()
      .from(organizationPayrollSettings)
      .where(eq(organizationPayrollSettings.organizationId, orgId))
      .limit(1);

    const workWeekStartDay = settings?.workWeekStartDay || "MONDAY";
    
    const targetDate = data.weekStartDate ? new Date(data.weekStartDate) : new Date();
    const { start: weekStart, end: weekEnd } = getWeekBounds(targetDate, workWeekStartDay);
    
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const [existingReport] = await db
      .select()
      .from(weeklyPayrollReports)
      .where(and(
        eq(weeklyPayrollReports.organizationId, orgId),
        eq(weeklyPayrollReports.weekStartDate, weekStartStr)
      ))
      .limit(1);

    if (existingReport) {
      res.status(400).json({ error: "A report for this week already exists", existingReportId: existingReport.id });
      return;
    }

    const approvedShifts = await db
      .select({
        id: timeClockShifts.id,
        odIuser: timeClockShifts.userId,
        projectId: timeClockShifts.projectId,
        clockIn: timeClockShifts.clockIn,
        clockOut: timeClockShifts.clockOut,
        totalHours: timeClockShifts.totalHours,
        approvalStatus: timeClockShifts.approvalStatus,
        approvedById: timeClockShifts.approvedById,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
        userId: timeClockShifts.userId,
      })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(and(
        eq(users.organizationId, orgId),
        eq(timeClockShifts.approvalStatus, "APPROVED"),
        gte(timeClockShifts.clockIn, weekStart),
        lte(timeClockShifts.clockIn, weekEnd)
      ));

    const employeeHours: Record<string, {
      odIuser: string;
      name: string;
      email: string;
      regularHours: number;
      overtimeHours: number;
      shifts: Array<{
        date: string;
        hours: number;
        projectId: string | null;
      }>;
    }> = {};

    const overtimeThreshold = settings?.overtimeThresholdHours 
      ? parseFloat(settings.overtimeThresholdHours) 
      : 40;

    for (const shift of approvedShifts) {
      const hours = parseFloat(shift.totalHours || "0");
      
      if (!employeeHours[shift.userId]) {
        employeeHours[shift.userId] = {
          odIuser: shift.userId,
          name: `${shift.userFirstName} ${shift.userLastName}`,
          email: shift.userEmail,
          regularHours: 0,
          overtimeHours: 0,
          shifts: [],
        };
      }

      employeeHours[shift.userId].shifts.push({
        date: shift.clockIn.toISOString().split('T')[0],
        hours,
        projectId: shift.projectId,
      });
    }

    for (const odIuser in employeeHours) {
      const emp = employeeHours[odIuser];
      const totalHours = emp.shifts.reduce((sum, s) => sum + s.hours, 0);
      emp.regularHours = Math.min(totalHours, overtimeThreshold);
      emp.overtimeHours = Math.max(0, totalHours - overtimeThreshold);
    }

    const totalRegularHours = Object.values(employeeHours).reduce((sum, e) => sum + e.regularHours, 0);
    const totalOvertimeHours = Object.values(employeeHours).reduce((sum, e) => sum + e.overtimeHours, 0);
    const totalEmployees = Object.keys(employeeHours).length;

    const reportData = {
      employees: Object.values(employeeHours),
      overtimeThreshold,
      generatedBy: authReq.user!.id,
    };

    const [report] = await db.insert(weeklyPayrollReports).values({
      organizationId: orgId,
      weekStartDate: weekStartStr,
      weekEndDate: weekEndStr,
      totalRegularHours: totalRegularHours.toFixed(2),
      totalOvertimeHours: totalOvertimeHours.toFixed(2),
      totalEmployees,
      reportData: JSON.stringify(reportData),
      generatedByApprovalOf: authReq.user!.id,
    }).returning();

    if (data.sendNotification && settings?.workWeekEndNotificationEnabled && settings?.notificationRecipientEmails) {
      const recipientEmails = settings.notificationRecipientEmails.split(',').map(e => e.trim()).filter(Boolean);
      
      const adminUsers = await db
        .select()
        .from(users)
        .where(and(
          eq(users.organizationId, orgId),
          sql`${users.email} IN (${sql.join(recipientEmails.map(e => sql`${e}`), sql`, `)})`
        ));

      for (const admin of adminUsers) {
        await insertNotification({
          userId: admin.id,
          organizationId: orgId,
          type: "GENERAL",
          title: "Weekly Payroll Report Generated",
          message: `Weekly payroll report generated for ${weekStartStr} to ${weekEndStr}. Total: ${(totalRegularHours + totalOvertimeHours).toFixed(2)} hours (${totalOvertimeHours.toFixed(2)} OT) across ${totalEmployees} employees.`,
          relatedEntityId: report.id,
          relatedEntityType: "weeklyPayrollReport",
        });
      }

      await db
        .update(weeklyPayrollReports)
        .set({
          notificationSentAt: new Date(),
          notificationRecipients: settings.notificationRecipientEmails,
        })
        .where(eq(weeklyPayrollReports.id, report.id));
    }

    await logAudit({
      userId: authReq.user!.id,
      entityType: "WEEKLY_PAYROLL_REPORT",
      entityId: report.id,
      action: "CREATE",
      oldValue: null,
      newValue: JSON.stringify({ weekStart: weekStartStr, weekEnd: weekEndStr, totalHours: totalRegularHours + totalOvertimeHours }),
    }, authReq);

    res.json({
      report,
      summary: {
        totalRegularHours,
        totalOvertimeHours,
        totalEmployees,
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/payroll/current-week-summary", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "SUPERINTENDENT", "MANAGER"), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const { orgId, mustDenyAccess } = getOrgIdForFilter(authReq);
    if (mustDenyAccess || !orgId) {
      res.status(400).json({ error: "Organization context required" });
      return;
    }

    const [settings] = await db
      .select()
      .from(organizationPayrollSettings)
      .where(eq(organizationPayrollSettings.organizationId, orgId))
      .limit(1);

    const workWeekStartDay = settings?.workWeekStartDay || "MONDAY";
    const { start: weekStart, end: weekEnd } = getWeekBounds(new Date(), workWeekStartDay);
    
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const shifts = await db
      .select({
        id: timeClockShifts.id,
        odIuser: timeClockShifts.userId,
        totalHours: timeClockShifts.totalHours,
        approvalStatus: timeClockShifts.approvalStatus,
        userFirstName: users.firstName,
        userLastName: users.lastName,
      })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(and(
        eq(users.organizationId, orgId),
        gte(timeClockShifts.clockIn, weekStart),
        lte(timeClockShifts.clockIn, weekEnd)
      ));

    const pending = shifts.filter(s => s.approvalStatus === "PENDING");
    const approved = shifts.filter(s => s.approvalStatus === "APPROVED");
    const rejected = shifts.filter(s => s.approvalStatus === "REJECTED");

    const pendingHours = pending.reduce((sum, s) => sum + parseFloat(s.totalHours || "0"), 0);
    const approvedHours = approved.reduce((sum, s) => sum + parseFloat(s.totalHours || "0"), 0);

    const uniqueEmployees = new Set(shifts.map(s => s.odIuser)).size;

    const [existingReport] = await db
      .select()
      .from(weeklyPayrollReports)
      .where(and(
        eq(weeklyPayrollReports.organizationId, orgId),
        eq(weeklyPayrollReports.weekStartDate, weekStartStr)
      ))
      .limit(1);

    res.json({
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      workWeekStartDay,
      pendingShifts: pending.length,
      approvedShifts: approved.length,
      rejectedShifts: rejected.length,
      pendingHours,
      approvedHours,
      totalEmployees: uniqueEmployees,
      reportGenerated: !!existingReport,
      reportId: existingReport?.id,
    });
  } catch (error) {
    next(error);
  }
});

// Task #1178: nightly auto-purge of archived certified payroll PDFs.
// Implementation lives in `server/jobs/certifiedPayrollPurge.ts` so it can
// be unit-tested without booting the Express route surface — re-exported
// here for discoverability per the task brief.
export { processArchivedCertifiedPayrollPurge } from "./jobs/certifiedPayrollPurge";

export default router;
