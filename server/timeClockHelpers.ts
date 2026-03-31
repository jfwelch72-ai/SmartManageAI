import { logError } from "./utils/logger";
import { db } from "./db";
import { insertNotification } from "./services/notificationService";
import { 
  timeClockShifts, users, notifications,
  dailyScopeProgress, scopeItems, projectEmployeeRates, 
  estimateLineItems, projectMaterialUsage,
  organizationPayrollSettings, weeklyPayrollReports
} from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { calculatePerUnitMetrics } from "./productionRateService";

export const MAX_SHIFT_HOURS = 16;

export async function captureProductionRateFromShift(
  projectId: string,
  userId: string,
  workDate: Date,
  laborHours: number,
  burdenMultiplier: number = 1.0
): Promise<void> {
  try {
    const [employeeRate] = await db
      .select()
      .from(projectEmployeeRates)
      .where(and(
        eq(projectEmployeeRates.projectId, projectId),
        eq(projectEmployeeRates.userId, userId)
      ))
      .limit(1);

    const regularRate = employeeRate ? parseFloat(employeeRate.regularRate) : 35;
    const baseLaborCost = laborHours * regularRate;
    const burdenedLaborCost = baseLaborCost * burdenMultiplier;

    const workDateStr = workDate.toISOString().split('T')[0];

    const progressEntries = await db
      .select({
        id: dailyScopeProgress.id,
        scopeItemId: dailyScopeProgress.scopeItemId,
        projectId: dailyScopeProgress.projectId,
        workDate: dailyScopeProgress.workDate,
        quantityCompleted: dailyScopeProgress.quantityCompleted,
        materialCost: dailyScopeProgress.materialCost,
        notes: dailyScopeProgress.notes,
        scopeItemQuantity: scopeItems.totalQuantity,
        estimateLineItemId: scopeItems.estimateLineItemId,
        budgetedMaterialCost: estimateLineItems.materialCost,
        budgetedQuantity: estimateLineItems.quantity,
      })
      .from(dailyScopeProgress)
      .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
      .leftJoin(estimateLineItems, eq(scopeItems.estimateLineItemId, estimateLineItems.id))
      .where(and(
        eq(dailyScopeProgress.projectId, projectId),
        eq(dailyScopeProgress.workDate, workDateStr)
      ));

    if (progressEntries.length === 0) {
      return;
    }

    const approvedShifts = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.projectId, projectId),
        eq(timeClockShifts.approvalStatus, "APPROVED"),
        sql`DATE(${timeClockShifts.clockIn}) = ${workDateStr}`
      ));

    const crewSize = approvedShifts.length;
    
    let totalProjectLaborHours = 0;
    let totalProjectLaborCost = 0;
    
    for (const shift of approvedShifts) {
      const shiftHours = parseFloat(shift.totalHours || "0");
      totalProjectLaborHours += shiftHours;
      
      const [userRate] = await db
        .select()
        .from(projectEmployeeRates)
        .where(and(
          eq(projectEmployeeRates.projectId, projectId),
          eq(projectEmployeeRates.userId, shift.userId)
        ))
        .limit(1);
      
      const rate = userRate ? parseFloat(userRate.regularRate) : 35;
      totalProjectLaborCost += shiftHours * rate * burdenMultiplier;
    }

    const totalQuantity = progressEntries.reduce((sum, entry) => 
      sum + parseFloat(entry.quantityCompleted), 0
    );

    if (totalQuantity <= 0) return;

    const actualMaterialUsage = await db
      .select({
        scopeItemId: projectMaterialUsage.scopeItemId,
        totalCost: sql<string>`SUM(CAST(${projectMaterialUsage.totalCost} AS DECIMAL(15,2)))`,
        totalQuantity: sql<string>`SUM(CAST(${projectMaterialUsage.quantityUsed} AS DECIMAL(15,2)))`,
      })
      .from(projectMaterialUsage)
      .where(and(
        eq(projectMaterialUsage.projectId, projectId),
        eq(projectMaterialUsage.usageDate, workDateStr)
      ))
      .groupBy(projectMaterialUsage.scopeItemId);

    const actualMaterialByScope = new Map<string, { totalCost: number; totalQuantity: number }>();
    for (const usage of actualMaterialUsage) {
      if (usage.scopeItemId) {
        actualMaterialByScope.set(usage.scopeItemId, {
          totalCost: parseFloat(usage.totalCost || "0"),
          totalQuantity: parseFloat(usage.totalQuantity || "0"),
        });
      }
    }

    for (const entry of progressEntries) {
      const qty = parseFloat(entry.quantityCompleted);
      const proportion = qty / totalQuantity;
      
      const entryLaborHours = totalProjectLaborHours * proportion;
      const entryLaborCost = totalProjectLaborCost * proportion;
      
      let entryMaterialCost = 0;
      let materialSource = "none";
      
      const actualUsage = actualMaterialByScope.get(entry.scopeItemId);
      if (actualUsage && actualUsage.totalCost > 0) {
        entryMaterialCost = actualUsage.totalCost;
        materialSource = "actual";
      } else if (entry.materialCost && parseFloat(entry.materialCost) > 0) {
        entryMaterialCost = parseFloat(entry.materialCost);
        materialSource = "manual";
      } else if (entry.budgetedMaterialCost && entry.budgetedQuantity) {
        const budgetedQty = parseFloat(entry.budgetedQuantity);
        const budgetedMaterial = parseFloat(entry.budgetedMaterialCost);
        if (budgetedQty > 0) {
          const materialCostPerUnit = budgetedMaterial / budgetedQty;
          entryMaterialCost = qty * materialCostPerUnit;
          materialSource = "budgeted";
        }
      }
      
      const perUnitMetrics = calculatePerUnitMetrics(
        qty,
        entryLaborHours,
        entryLaborCost,
        entryMaterialCost
      );

      await db
        .update(dailyScopeProgress)
        .set({
          laborHours: entryLaborHours.toFixed(2),
          laborCost: entryLaborCost.toFixed(2),
          materialCost: entryMaterialCost.toFixed(2),
          crewSize,
          ...perUnitMetrics,
          updatedAt: new Date(),
        })
        .where(eq(dailyScopeProgress.id, entry.id));
    }
    
    console.log(`Production rate data captured for project ${projectId} on ${workDateStr}: ${totalProjectLaborHours}hrs, $${totalProjectLaborCost.toFixed(2)} across ${progressEntries.length} scope items`);
  } catch (error) {
    logError("Error capturing production rate data:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

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

export async function checkAndNotifyWeeklyReport(
  organizationId: string,
  approvedByUserId: string,
  shiftClockIn: Date
): Promise<void> {
  try {
    const [settings] = await db
      .select()
      .from(organizationPayrollSettings)
      .where(eq(organizationPayrollSettings.organizationId, organizationId))
      .limit(1);

    if (!settings?.workWeekEndNotificationEnabled || !settings?.autoGenerateWeeklyReports) {
      return;
    }

    const workWeekStartDay = settings.workWeekStartDay || "MONDAY";
    const { start: weekStart, end: weekEnd } = getWeekBounds(shiftClockIn, workWeekStartDay);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const [existingReport] = await db
      .select()
      .from(weeklyPayrollReports)
      .where(and(
        eq(weeklyPayrollReports.organizationId, organizationId),
        eq(weeklyPayrollReports.weekStartDate, weekStartStr)
      ))
      .limit(1);

    if (existingReport) {
      return;
    }

    const now = new Date();
    if (now < weekEnd) {
      return;
    }

    const pendingShifts = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(and(
        eq(users.organizationId, organizationId),
        eq(timeClockShifts.approvalStatus, "PENDING"),
        gte(timeClockShifts.clockIn, weekStart),
        lte(timeClockShifts.clockIn, weekEnd)
      ));

    const pendingCount = pendingShifts[0]?.count || 0;

    if (pendingCount > 0) {
      return;
    }

    const approvedShifts = await db
      .select({
        userId: timeClockShifts.userId,
        totalHours: timeClockShifts.totalHours,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
      })
      .from(timeClockShifts)
      .innerJoin(users, eq(timeClockShifts.userId, users.id))
      .where(and(
        eq(users.organizationId, organizationId),
        eq(timeClockShifts.approvalStatus, "APPROVED"),
        gte(timeClockShifts.clockIn, weekStart),
        lte(timeClockShifts.clockIn, weekEnd)
      ));

    if (approvedShifts.length === 0) {
      return;
    }

    const overtimeThreshold = settings.overtimeThresholdHours 
      ? parseFloat(settings.overtimeThresholdHours) 
      : 40;

    const employeeHours: Record<string, {
      name: string;
      email: string;
      totalHours: number;
    }> = {};

    for (const shift of approvedShifts) {
      const hours = parseFloat(shift.totalHours || "0");
      if (!employeeHours[shift.userId]) {
        employeeHours[shift.userId] = {
          name: `${shift.userFirstName} ${shift.userLastName}`,
          email: shift.userEmail,
          totalHours: 0,
        };
      }
      employeeHours[shift.userId].totalHours += hours;
    }

    let totalRegularHours = 0;
    let totalOvertimeHours = 0;

    for (const emp of Object.values(employeeHours)) {
      totalRegularHours += Math.min(emp.totalHours, overtimeThreshold);
      totalOvertimeHours += Math.max(0, emp.totalHours - overtimeThreshold);
    }

    const totalEmployees = Object.keys(employeeHours).length;

    const reportData = {
      employees: Object.entries(employeeHours).map(([userId, data]) => ({
        userId,
        ...data,
        regularHours: Math.min(data.totalHours, overtimeThreshold),
        overtimeHours: Math.max(0, data.totalHours - overtimeThreshold),
      })),
      overtimeThreshold,
      autoGenerated: true,
    };

    const [report] = await db.insert(weeklyPayrollReports).values({
      organizationId,
      weekStartDate: weekStartStr,
      weekEndDate: weekEndStr,
      totalRegularHours: totalRegularHours.toFixed(2),
      totalOvertimeHours: totalOvertimeHours.toFixed(2),
      totalEmployees,
      reportData: JSON.stringify(reportData),
      generatedByApprovalOf: approvedByUserId,
    }).returning();

    if (settings.notificationRecipientEmails) {
      const recipientEmails = settings.notificationRecipientEmails.split(',').map(e => e.trim()).filter(Boolean);
      
      const adminUsers = await db
        .select()
        .from(users)
        .where(and(
          eq(users.organizationId, organizationId),
          sql`${users.email} = ANY(ARRAY[${sql.join(recipientEmails.map(e => sql`${e}`), sql`, `)}])`
        ));

      for (const admin of adminUsers) {
        await insertNotification({
          userId: admin.id,
          organizationId,
          type: "GENERAL",
          title: "Weekly Payroll Report Ready",
          message: `Weekly payroll report ready: ${weekStartStr} to ${weekEndStr}. Total: ${(totalRegularHours + totalOvertimeHours).toFixed(2)} hours (${totalOvertimeHours.toFixed(2)} OT) across ${totalEmployees} employees. All shifts approved.`,
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

    console.log(`Auto-generated weekly payroll report for org ${organizationId}: ${weekStartStr} to ${weekEndStr}`);
  } catch (error) {
    logError("Error checking weekly report:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
