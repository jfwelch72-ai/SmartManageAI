import type { Express } from "express";
import { db } from "./db";
import { 
  timeClockShifts, timeClockEvents, users, projects, timeEntries,
  payrollNotifications, organizations, notifications, dailyScopeProgress,
  scopeItems, projectEmployeeRates, estimateLineItems, projectMaterialUsage,
  organizationPayrollSettings, weeklyPayrollReports
} from "@shared/schema";
import { eq, and, desc, gte, lte, isNull, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";
import { calculatePerUnitMetrics } from "./productionRateService";

// Geolocation radius check (in meters)
const GEOFENCE_RADIUS = 200; // 200 meters

// Maximum shift hours before auto-clock-out
const MAX_SHIFT_HOURS = 16;

// Capture production rate data from approved shift
// Links labor hours and costs to dailyScopeProgress entries
async function captureProductionRateFromShift(
  projectId: string,
  userId: string,
  workDate: Date,
  laborHours: number,
  burdenMultiplier: number = 1.0
): Promise<void> {
  try {
    // Get user's cost rate for this project
    const [employeeRate] = await db
      .select()
      .from(projectEmployeeRates)
      .where(and(
        eq(projectEmployeeRates.projectId, projectId),
        eq(projectEmployeeRates.userId, userId)
      ))
      .limit(1);

    // Default rate if no specific rate configured
    const regularRate = employeeRate ? parseFloat(employeeRate.regularRate) : 35; // Default $35/hr
    const baseLaborCost = laborHours * regularRate;
    const burdenedLaborCost = baseLaborCost * burdenMultiplier;

    // Format work date as YYYY-MM-DD
    const workDateStr = workDate.toISOString().split('T')[0];

    // Get all scope progress entries for this project/date with linked scope items and estimate line items
    const progressEntries = await db
      .select({
        id: dailyScopeProgress.id,
        scopeItemId: dailyScopeProgress.scopeItemId,
        projectId: dailyScopeProgress.projectId,
        workDate: dailyScopeProgress.workDate,
        quantityCompleted: dailyScopeProgress.quantityCompleted,
        materialCost: dailyScopeProgress.materialCost,
        notes: dailyScopeProgress.notes,
        // From scope items
        scopeItemQuantity: scopeItems.totalQuantity,
        estimateLineItemId: scopeItems.estimateLineItemId,
        // From estimate line items - budgeted material cost
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
      // No scope progress logged for this date - nothing to update
      return;
    }

    // Get all approved shifts for this project/date to calculate crew size and total hours
    const approvedShifts = await db
      .select()
      .from(timeClockShifts)
      .where(and(
        eq(timeClockShifts.projectId, projectId),
        eq(timeClockShifts.approvalStatus, "APPROVED"),
        sql`DATE(${timeClockShifts.clockIn}) = ${workDateStr}`
      ));

    const crewSize = approvedShifts.length;
    
    // Calculate total labor hours and cost for all shifts on this date
    let totalProjectLaborHours = 0;
    let totalProjectLaborCost = 0;
    
    for (const shift of approvedShifts) {
      const shiftHours = parseFloat(shift.totalHours || "0");
      totalProjectLaborHours += shiftHours;
      
      // Get rate for this user
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

    // Calculate total quantity completed across all scope items for the day
    const totalQuantity = progressEntries.reduce((sum, entry) => 
      sum + parseFloat(entry.quantityCompleted), 0
    );

    if (totalQuantity <= 0) return;

    // Fetch actual material usage for this project and date
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

    // Create a lookup map for actual material costs by scope item
    const actualMaterialByScope = new Map<string, { totalCost: number; totalQuantity: number }>();
    for (const usage of actualMaterialUsage) {
      if (usage.scopeItemId) {
        actualMaterialByScope.set(usage.scopeItemId, {
          totalCost: parseFloat(usage.totalCost || "0"),
          totalQuantity: parseFloat(usage.totalQuantity || "0"),
        });
      }
    }

    // Distribute labor hours and costs proportionally across scope items
    for (const entry of progressEntries) {
      const qty = parseFloat(entry.quantityCompleted);
      const proportion = qty / totalQuantity;
      
      const entryLaborHours = totalProjectLaborHours * proportion;
      const entryLaborCost = totalProjectLaborCost * proportion;
      
      // Priority for material cost:
      // 1. Use actual material usage from projectMaterialUsage (if available)
      // 2. Fall back to manually entered materialCost on dailyScopeProgress
      // 3. Fall back to budgeted material cost from estimate line item
      let entryMaterialCost = 0;
      let materialSource = "none";
      
      // Check for actual material usage first (most accurate)
      const actualUsage = actualMaterialByScope.get(entry.scopeItemId);
      if (actualUsage && actualUsage.totalCost > 0) {
        entryMaterialCost = actualUsage.totalCost;
        materialSource = "actual";
      } else if (entry.materialCost && parseFloat(entry.materialCost) > 0) {
        // Fall back to manually entered cost on progress entry
        entryMaterialCost = parseFloat(entry.materialCost);
        materialSource = "manual";
      } else if (entry.budgetedMaterialCost && entry.budgetedQuantity) {
        // Fall back to budgeted cost from estimate
        const budgetedQty = parseFloat(entry.budgetedQuantity);
        const budgetedMaterial = parseFloat(entry.budgetedMaterialCost);
        if (budgetedQty > 0) {
          const materialCostPerUnit = budgetedMaterial / budgetedQty;
          entryMaterialCost = qty * materialCostPerUnit;
          materialSource = "budgeted";
        }
      }
      
      // Calculate per-unit metrics
      const perUnitMetrics = calculatePerUnitMetrics(
        qty,
        entryLaborHours,
        entryLaborCost,
        entryMaterialCost
      );

      // Update the scope progress entry with production rate data
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
    console.error("Error capturing production rate data:", error);
    // Don't throw - this is a non-critical enhancement
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

async function checkAndNotifyWeeklyReport(
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
        await db.insert(notifications).values({
          userId: admin.id,
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
    console.error("Error checking weekly report:", error);
  }
}

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
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

export function registerTimeClockRoutes(app: Express): void {
  // Clock In
  app.post("/api/time-clock/clock-in", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const schema = z.object({
        projectId: z.string().optional().nullable(),
        latitude: z.number().optional().nullable(),
        longitude: z.number().optional().nullable(),
        notes: z.string().optional().nullable(),
      });

      const data = schema.parse(sanitizedBody);

      // Check if user already has an active shift
      const [activeShift] = await db
        .select()
        .from(timeClockShifts)
        .where(and(
          eq(timeClockShifts.userId, req.user!.id),
          isNull(timeClockShifts.clockOut)
        ))
        .limit(1);

      if (activeShift) {
        res.status(400).json({ error: "You already have an active shift. Please clock out first." });
        return;
      }

      const now = new Date();

      // Create new shift
      const [newShift] = await db.insert(timeClockShifts).values({
        userId: req.user!.id,
        projectId: data.projectId || null,
        clockIn: now,
        clockInLatitude: data.latitude || null,
        clockInLongitude: data.longitude || null,
        notes: data.notes || null,
        autoClockOut: false,
        approvalStatus: "PENDING",
      }).returning();

      // Log clock-in event
      await db.insert(timeClockEvents).values({
        shiftId: newShift.id,
        eventType: "CLOCK_IN",
        timestamp: now,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        notes: data.notes || null,
        performedById: req.user!.id,
      });

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: newShift.id,
        action: "CLOCK_IN",
        oldValue: null,
        newValue: JSON.stringify({ projectId: data.projectId, location: data.latitude && data.longitude ? [data.latitude, data.longitude] : null }),
      }, req);

      res.status(201).json(newShift);
    } catch (error) {
      console.error("Clock-in error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Clock Out
  app.post("/api/time-clock/clock-out", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const schema = z.object({
        latitude: z.number().optional().nullable(),
        longitude: z.number().optional().nullable(),
        notes: z.string().optional().nullable(),
      });

      const data = schema.parse(sanitizedBody);

      // Find active shift
      const [activeShift] = await db
        .select()
        .from(timeClockShifts)
        .where(and(
          eq(timeClockShifts.userId, req.user!.id),
          isNull(timeClockShifts.clockOut)
        ))
        .limit(1);

      if (!activeShift) {
        res.status(400).json({ error: "No active shift found. Please clock in first." });
        return;
      }

      const now = new Date();
      const clockInTime = new Date(activeShift.clockIn);
      const totalHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

      // Update shift with clock-out
      const [updatedShift] = await db
        .update(timeClockShifts)
        .set({
          clockOut: now,
          clockOutLatitude: data.latitude || null,
          clockOutLongitude: data.longitude || null,
          totalHours: totalHours.toString(),
          notes: data.notes || activeShift.notes,
          updatedAt: now,
        })
        .where(eq(timeClockShifts.id, activeShift.id))
        .returning();

      // Log clock-out event
      await db.insert(timeClockEvents).values({
        shiftId: activeShift.id,
        eventType: "CLOCK_OUT",
        timestamp: now,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        notes: data.notes || null,
        performedById: req.user!.id,
      });

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: activeShift.id,
        action: "CLOCK_OUT",
        oldValue: JSON.stringify({ clockIn: activeShift.clockIn }),
        newValue: JSON.stringify({ clockOut: now, totalHours }),
      }, req);

      res.json(updatedShift);
    } catch (error) {
      console.error("Clock-out error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get current active shift
  app.get("/api/time-clock/my-current-shift", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [activeShift] = await db
        .select()
        .from(timeClockShifts)
        .where(and(
          eq(timeClockShifts.userId, req.user!.id),
          isNull(timeClockShifts.clockOut)
        ))
        .limit(1);

      if (!activeShift) {
        res.json({ shift: null, project: null });
        return;
      }

      // Fetch project if shift has projectId
      let project = null;
      if (activeShift.projectId) {
        const [projectData] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, activeShift.projectId))
          .limit(1);
        project = projectData || null;
      }

      res.json({ shift: activeShift, project });
    } catch (error) {
      console.error("Get current shift error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get my shifts
  app.get("/api/time-clock/my-shifts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const offset = (pageNum - 1) * pageSizeNum;

      // Build conditions array to avoid query chaining issues
      const conditions = [eq(timeClockShifts.userId, req.user!.id)];
      
      if (startDate) {
        conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
      }
      if (endDate) {
        conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
      }

      const shifts = await db
        .select()
        .from(timeClockShifts)
        .where(and(...conditions))
        .orderBy(desc(timeClockShifts.clockIn))
        .limit(pageSizeNum)
        .offset(offset);

      res.json(shifts);
    } catch (error) {
      console.error("Get my shifts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update shift notes (employee only)
  app.patch("/api/time-clock/my-shifts/:id/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const schema = z.object({
        notes: z.string(),
      });

      const data = schema.parse(sanitizedBody);

      // Verify ownership
      const [shift] = await db
        .select()
        .from(timeClockShifts)
        .where(and(
          eq(timeClockShifts.id, req.params.id),
          eq(timeClockShifts.userId, req.user!.id)
        ))
        .limit(1);

      if (!shift) {
        res.status(404).json({ error: "Shift not found" });
        return;
      }

      const [updatedShift] = await db
        .update(timeClockShifts)
        .set({ notes: data.notes, updatedAt: new Date() })
        .where(eq(timeClockShifts.id, req.params.id))
        .returning();

      res.json(updatedShift);
    } catch (error) {
      console.error("Update notes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get pending shift approvals (managers, superintendents, and office managers for viewing)
  app.get("/api/time-clock/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Get all shifts that are clocked out and pending approval
      const pendingShifts = await db
        .select({
          shift: timeClockShifts,
          user: users,
          project: projects,
        })
        .from(timeClockShifts)
        .leftJoin(users, eq(timeClockShifts.userId, users.id))
        .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
        .where(and(
          eq(timeClockShifts.approvalStatus, "PENDING"),
          sql`${timeClockShifts.clockOut} IS NOT NULL`
        ))
        .orderBy(desc(timeClockShifts.clockOut));

      // Return nested format to match the expected frontend format
      const formattedShifts = pendingShifts.map(({ shift, user, project }) => ({
        ...shift,
        user: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        } : null,
        project: project ? {
          id: project.id,
          name: project.name,
          code: project.code,
        } : null,
        // Keep flat fields for backwards compatibility
        userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
        userEmail: user?.email,
        projectName: project?.name,
        projectCode: project?.code,
      }));

      res.json(formattedShifts);
    } catch (error) {
      console.error("Get pending approvals error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get active shifts (managers, superintendents, office managers)
  app.get("/api/time-clock/active-shifts", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Get all shifts that are currently clocked in (no clock out time)
      const activeShifts = await db
        .select({
          shift: timeClockShifts,
          user: users,
          project: projects,
        })
        .from(timeClockShifts)
        .leftJoin(users, eq(timeClockShifts.userId, users.id))
        .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
        .where(sql`${timeClockShifts.clockOut} IS NULL`)
        .orderBy(desc(timeClockShifts.clockIn));

      // Return nested format to match the expected frontend format
      const formattedShifts = activeShifts.map(({ shift, user, project }) => ({
        ...shift,
        user: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
        } : null,
        project: project ? {
          id: project.id,
          name: project.name,
          code: project.code,
        } : null,
        // Keep flat fields for backwards compatibility
        userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
        userEmail: user?.email,
        projectName: project?.name,
        projectCode: project?.code,
      }));

      res.json(formattedShifts);
    } catch (error) {
      console.error("Get active shifts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get employee shifts (managers only)
  app.get("/api/time-clock/employee/:userId/shifts", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, page = "1", pageSize = "50" } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const offset = (pageNum - 1) * pageSizeNum;

      // Build conditions array to avoid query chaining issues
      const conditions = [eq(timeClockShifts.userId, req.params.userId)];
      
      if (startDate) {
        conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
      }
      if (endDate) {
        conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
      }

      const shifts = await db
        .select()
        .from(timeClockShifts)
        .where(and(...conditions))
        .orderBy(desc(timeClockShifts.clockIn))
        .limit(pageSizeNum)
        .offset(offset);

      res.json(shifts);
    } catch (error) {
      console.error("Get employee shifts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Adjust shift (managers and superintendents)
  app.post("/api/time-clock/shifts/:id/adjust", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
        reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
      };

      const schema = z.object({
        clockIn: z.string().optional(),
        clockOut: z.string().optional(),
        projectId: z.string().optional().nullable(),
        notes: z.string().optional(),
        reason: z.string().min(1, "Reason for adjustment is required"),
        adminOverride: z.boolean().optional(),
      });

      const data = schema.parse(sanitizedBody);

      const [shift] = await db
        .select()
        .from(timeClockShifts)
        .where(eq(timeClockShifts.id, req.params.id))
        .limit(1);

      if (!shift) {
        res.status(404).json({ error: "Shift not found" });
        return;
      }

      // Check if shift is approved - only ADMIN can adjust approved shifts with override
      if (shift.approvalStatus === "APPROVED") {
        if (req.user!.role !== "ADMIN" || !data.adminOverride) {
          res.status(403).json({ 
            error: "This shift has been approved and is locked. Only administrators can adjust approved shifts with explicit override." 
          });
          return;
        }
      }

      const updates: any = { updatedAt: new Date() };
      
      // Reset approval if manager is adjusting (unless admin override)
      if (shift.approvalStatus === "APPROVED" && req.user!.role === "ADMIN" && data.adminOverride) {
        // Admin override - keep approval but log it
        updates.notes = shift.notes ? `${shift.notes}\nAdmin override adjustment: ${data.reason}` : `Admin override adjustment: ${data.reason}`;
      } else if (shift.approvalStatus === "APPROVED") {
        // This shouldn't happen due to the check above, but as a safety measure
        updates.approvalStatus = "PENDING";
        updates.approvedById = null;
        updates.approvedAt = null;
      }

      if (data.clockIn) {
        updates.clockIn = new Date(data.clockIn);
      }

      if (data.clockOut) {
        updates.clockOut = new Date(data.clockOut);
      }

      if (data.projectId !== undefined) {
        updates.projectId = data.projectId;
      }

      if (data.notes) {
        updates.notes = data.notes;
      }

      // Recalculate total hours if either time changed
      if (data.clockIn || data.clockOut) {
        const clockIn = data.clockIn ? new Date(data.clockIn) : new Date(shift.clockIn);
        const clockOut = data.clockOut ? new Date(data.clockOut) : (shift.clockOut ? new Date(shift.clockOut) : null);

        if (clockOut) {
          const totalHours = (clockOut.getTime() - clockIn.getTime()) / (1000 * 60 * 60);
          updates.totalHours = totalHours.toString();
        }
      }

      const [updatedShift] = await db
        .update(timeClockShifts)
        .set(updates)
        .where(eq(timeClockShifts.id, req.params.id))
        .returning();

      // Log adjustment event
      await db.insert(timeClockEvents).values({
        shiftId: req.params.id,
        eventType: "ADJUSTMENT",
        timestamp: new Date(),
        notes: `Manager adjustment: ${data.reason}`,
        performedById: req.user!.id,
      });

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: req.params.id,
        action: "ADJUST",
        oldValue: JSON.stringify(shift),
        newValue: JSON.stringify({ ...updates, reason: data.reason }),
      }, req);

      res.json(updatedShift);
    } catch (error) {
      console.error("Adjust shift error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin clock-out (managers only)
  app.post("/api/time-clock/shift/:id/admin-clock-out", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
      };

      const schema = z.object({
        reason: z.string().min(1, "Reason is required"),
      });

      const data = schema.parse(sanitizedBody);

      const [shift] = await db
        .select()
        .from(timeClockShifts)
        .where(and(
          eq(timeClockShifts.id, req.params.id),
          isNull(timeClockShifts.clockOut)
        ))
        .limit(1);

      if (!shift) {
        res.status(404).json({ error: "Active shift not found" });
        return;
      }

      const now = new Date();
      const clockInTime = new Date(shift.clockIn);
      const totalHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

      const [updatedShift] = await db
        .update(timeClockShifts)
        .set({
          clockOut: now,
          totalHours: totalHours.toString(),
          autoClockOut: true,
          updatedAt: now,
          notes: shift.notes ? `${shift.notes}\nAdmin clock-out: ${data.reason}` : `Admin clock-out: ${data.reason}`,
        })
        .where(eq(timeClockShifts.id, req.params.id))
        .returning();

      // Log admin override event
      await db.insert(timeClockEvents).values({
        shiftId: req.params.id,
        eventType: "ADMIN_OVERRIDE",
        timestamp: now,
        notes: `Admin forced clock-out: ${data.reason}`,
        performedById: req.user!.id,
      });

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: req.params.id,
        action: "CLOCK_OUT",
        oldValue: JSON.stringify({ adminOverride: false }),
        newValue: JSON.stringify({ adminOverride: true, reason: data.reason }),
      }, req);

      res.json(updatedShift);
    } catch (error) {
      console.error("Admin clock-out error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve shift (managers, superintendents)
  app.post("/api/time-clock/shifts/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        createTimeEntry: z.boolean().optional(),
      });

      const data = schema.parse(req.body);

      const [shift] = await db
        .select()
        .from(timeClockShifts)
        .where(eq(timeClockShifts.id, req.params.id))
        .limit(1);

      if (!shift) {
        res.status(404).json({ error: "Shift not found" });
        return;
      }

      if (!shift.clockOut) {
        res.status(400).json({ error: "Cannot approve shift that hasn't been clocked out" });
        return;
      }

      const [updatedShift] = await db
        .update(timeClockShifts)
        .set({
          approvalStatus: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeClockShifts.id, req.params.id))
        .returning();

      // Optionally create time entry
      let timeEntryId: string | null = null;
      if (data.createTimeEntry && shift.projectId) {
        try {
          const totalHours = parseFloat(shift.totalHours || "0");
          const regularHours = Math.min(totalHours, 8);
          const overtimeHours = Math.max(0, totalHours - 8);

          const [newTimeEntry] = await db.insert(timeEntries).values({
            userId: shift.userId,
            projectId: shift.projectId,
            date: shift.clockIn,
            hoursRegular: regularHours.toString(),
            hoursOvertime: overtimeHours.toString(),
            notes: shift.notes || `Auto-created from time clock shift`,
            approvedById: req.user!.id,
            approvedAt: new Date(),
          }).returning();
          
          timeEntryId = newTimeEntry.id;
        } catch (error) {
          console.error("Failed to create time entry during approval:", error);
          // Rollback the approval if time entry creation fails
          await db
            .update(timeClockShifts)
            .set({
              approvalStatus: "PENDING",
              approvedById: null,
              approvedAt: null,
            })
            .where(eq(timeClockShifts.id, req.params.id));
          
          throw error;
        }
      }

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: req.params.id,
        action: "APPROVE",
        oldValue: JSON.stringify({ status: "PENDING" }),
        newValue: JSON.stringify({ status: "APPROVED", createTimeEntry: data.createTimeEntry, timeEntryId }),
      }, req);

      // Capture production rate data - links labor hours/costs to scope progress
      if (shift.projectId && shift.clockIn) {
        const totalHours = parseFloat(shift.totalHours || "0");
        // Fire and forget - don't block the response
        captureProductionRateFromShift(
          shift.projectId,
          shift.userId,
          shift.clockIn,
          totalHours
        ).catch(err => console.error("Production rate capture failed:", err));
      }

      // Check if this approval completes the week's approvals and trigger weekly report
      const [shiftUser] = await db.select().from(users).where(eq(users.id, shift.userId)).limit(1);
      if (shiftUser?.organizationId && shift.clockIn) {
        // Fire and forget - check and generate weekly report if all shifts are approved
        checkAndNotifyWeeklyReport(
          shiftUser.organizationId,
          req.user!.id,
          shift.clockIn
        ).catch(err => console.error("Weekly report check failed:", err));
      }

      res.json({ ...updatedShift, timeEntryCreated: !!timeEntryId, timeEntryId });
    } catch (error) {
      console.error("Approve shift error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reject shift (managers and superintendents)
  app.post("/api/time-clock/shifts/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
      };

      const schema = z.object({
        reason: z.string().min(1, "Rejection reason is required"),
      });

      const data = schema.parse(sanitizedBody);

      const [shift] = await db
        .select()
        .from(timeClockShifts)
        .where(eq(timeClockShifts.id, req.params.id))
        .limit(1);

      if (!shift) {
        res.status(404).json({ error: "Shift not found" });
        return;
      }

      const [updatedShift] = await db
        .update(timeClockShifts)
        .set({
          approvalStatus: "REJECTED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          notes: shift.notes ? `${shift.notes}\nREJECTED: ${data.reason}` : `REJECTED: ${data.reason}`,
          updatedAt: new Date(),
        })
        .where(eq(timeClockShifts.id, req.params.id))
        .returning();

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_CLOCK_SHIFT",
        entityId: req.params.id,
        action: "REJECT",
        oldValue: JSON.stringify({ status: "PENDING" }),
        newValue: JSON.stringify({ status: "REJECTED", reason: data.reason }),
      }, req);

      res.json(updatedShift);
    } catch (error) {
      console.error("Reject shift error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get live clock-in status (managers only)
  app.get("/api/time-clock/live", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const activeShifts = await db
        .select({
          shift: timeClockShifts,
          user: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          },
          project: {
            id: projects.id,
            name: projects.name,
            code: projects.code,
          },
        })
        .from(timeClockShifts)
        .leftJoin(users, eq(timeClockShifts.userId, users.id))
        .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
        .where(isNull(timeClockShifts.clockOut))
        .orderBy(desc(timeClockShifts.clockIn));

      res.json(activeShifts);
    } catch (error) {
      console.error("Get live shifts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Auto clock-out worker function (called by scheduled task)
  app.post("/api/time-clock/auto-clock-out-worker", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const cutoffTime = new Date(Date.now() - MAX_SHIFT_HOURS * 60 * 60 * 1000);

      const longShifts = await db
        .select()
        .from(timeClockShifts)
        .where(and(
          isNull(timeClockShifts.clockOut),
          lte(timeClockShifts.clockIn, cutoffTime)
        ));

      const results = [];

      for (const shift of longShifts) {
        const now = new Date();
        const clockInTime = new Date(shift.clockIn);
        const totalHours = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);

        const [updatedShift] = await db
          .update(timeClockShifts)
          .set({
            clockOut: now,
            totalHours: totalHours.toString(),
            autoClockOut: true,
            updatedAt: now,
            notes: shift.notes ? `${shift.notes}\nAuto-clocked out after ${MAX_SHIFT_HOURS} hours` : `Auto-clocked out after ${MAX_SHIFT_HOURS} hours`,
          })
          .where(eq(timeClockShifts.id, shift.id))
          .returning();

        await db.insert(timeClockEvents).values({
          shiftId: shift.id,
          eventType: "AUTO_CLOCK_OUT",
          timestamp: now,
          notes: `Auto-clocked out after ${MAX_SHIFT_HOURS} hours`,
          performedById: req.user!.id,
        });

        results.push(updatedShift);
      }

      res.json({ count: results.length, shifts: results });
    } catch (error) {
      console.error("Auto clock-out worker error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get project labor hours (managers, superintendents, and admins only)
  app.get("/api/projects/:projectId/labor-hours", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { startDate, endDate, approvalStatus, userId, sortBy } = req.query;

      // Build conditions array
      const conditions = [eq(timeClockShifts.projectId, projectId)];
      
      if (startDate) {
        conditions.push(gte(timeClockShifts.clockIn, new Date(startDate as string)));
      }
      if (endDate) {
        conditions.push(lte(timeClockShifts.clockIn, new Date(endDate as string)));
      }
      if (approvalStatus && approvalStatus !== 'ALL') {
        conditions.push(eq(timeClockShifts.approvalStatus, approvalStatus as any));
      }
      if (userId) {
        conditions.push(eq(timeClockShifts.userId, userId as string));
      }

      // Determine order by clause based on sortBy parameter
      let orderByClause;
      switch (sortBy) {
        case "date-asc":
          orderByClause = timeClockShifts.clockIn;
          break;
        case "hours-desc":
          orderByClause = desc(sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0)`);
          break;
        case "hours-asc":
          orderByClause = sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0)`;
          break;
        case "cost-desc":
          orderByClause = desc(sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0) * COALESCE(CAST(${users.costRateRegular} AS NUMERIC), 0)`);
          break;
        case "cost-asc":
          orderByClause = sql`COALESCE(CAST(${timeClockShifts.totalHours} AS NUMERIC), 0) * COALESCE(CAST(${users.costRateRegular} AS NUMERIC), 0)`;
          break;
        case "employee-asc":
          orderByClause = users.firstName;
          break;
        case "employee-desc":
          orderByClause = desc(users.firstName);
          break;
        case "date-desc":
        default:
          orderByClause = desc(timeClockShifts.clockIn);
          break;
      }

      // Get shifts with employee details
      const shiftsData = await db
        .select({
          shift: timeClockShifts,
          user: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
            costRateRegular: users.costRateRegular,
            costRateOvertime: users.costRateOvertime,
          },
        })
        .from(timeClockShifts)
        .leftJoin(users, eq(timeClockShifts.userId, users.id))
        .where(and(...conditions))
        .orderBy(orderByClause);

      // Calculate labor costs for each shift
      const shiftsWithCosts = shiftsData.map(({ shift, user }) => {
        const totalHours = shift.totalHours ? parseFloat(shift.totalHours) : 0;
        const hourlyRate = user?.costRateRegular ? parseFloat(user.costRateRegular) : 0;
        const laborCost = totalHours * hourlyRate;

        return {
          ...shift,
          userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
          userEmail: user?.email,
          userRole: user?.role,
          hourlyRate: hourlyRate,
          laborCost: laborCost,
        };
      });

      // Calculate aggregate metrics
      const totalHours = shiftsWithCosts.reduce((sum, shift) => sum + (shift.totalHours ? parseFloat(shift.totalHours) : 0), 0);
      const totalLaborCost = shiftsWithCosts.reduce((sum, shift) => sum + shift.laborCost, 0);
      const averageHourlyRate = totalHours > 0 ? totalLaborCost / totalHours : 0;

      res.json({
        shifts: shiftsWithCosts,
        summary: {
          totalShifts: shiftsWithCosts.length,
          totalHours: totalHours,
          totalLaborCost: totalLaborCost,
          averageHourlyRate: averageHourlyRate,
        },
      });
    } catch (error) {
      console.error("Get project labor hours error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // TIME ENTRY APPROVAL WORKFLOW ROUTES
  // ============================================

  // Get pending time entry approvals (managers, superintendents, office managers for viewing) - with mustDenyAccess pattern
  app.get("/api/time-entries/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }

      const { projectId, startDate, endDate } = req.query;

      const conditions: any[] = [eq(timeEntries.approvalStatus, "PENDING")];
      
      if (startDate) {
        conditions.push(gte(timeEntries.date, new Date(startDate as string)));
      }
      if (endDate) {
        conditions.push(lte(timeEntries.date, new Date(endDate as string)));
      }
      if (projectId) {
        conditions.push(eq(timeEntries.projectId, projectId as string));
      }

      // Get pending time entries with user and project info
      const pendingEntries = await db
        .select({
          entry: timeEntries,
          user: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
            organizationId: users.organizationId,
          },
          project: {
            id: projects.id,
            name: projects.name,
            code: projects.code,
            gcOrganizationId: projects.gcOrganizationId,
          },
        })
        .from(timeEntries)
        .leftJoin(users, eq(timeEntries.userId, users.id))
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .where(and(...conditions))
        .orderBy(desc(timeEntries.date));

      // Filter by organization for non-SUPER_ADMIN users - check project OR user's organization
      const filteredEntries = shouldFilter && orgId
        ? pendingEntries.filter(e => {
            const entryOrgId = e.project?.gcOrganizationId || e.user?.organizationId;
            return entryOrgId === orgId;
          })
        : pendingEntries;

      const formattedEntries = filteredEntries.map(({ entry, user, project }) => ({
        ...entry,
        userName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
        userEmail: user?.email,
        userRole: user?.role,
        projectName: project?.name,
        projectCode: project?.code,
      }));

      res.json(formattedEntries);
    } catch (error) {
      console.error("Get pending time entry approvals error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve time entry (managers only)
  app.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      const [entry] = await db
        .select({
          entry: timeEntries,
          project: projects,
          entryUser: {
            id: users.id,
            organizationId: users.organizationId,
          },
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .leftJoin(users, eq(timeEntries.userId, users.id))
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!entry.entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      // Verify organization access - check project OR user's organization
      if (shouldFilter && orgId) {
        const entryOrgId = entry.project?.gcOrganizationId || entry.entryUser?.organizationId;
        if (entryOrgId !== orgId) {
          return res.status(403).json({ error: "Access denied to this time entry" });
        }
      }

      if (entry.entry.approvalStatus === "APPROVED") {
        return res.status(400).json({ error: "Time entry is already approved" });
      }

      const [updatedEntry] = await db
        .update(timeEntries)
        .set({
          approvalStatus: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_ENTRY",
        entityId: req.params.id,
        action: "APPROVE",
        oldValue: JSON.stringify({ approvalStatus: entry.entry.approvalStatus }),
        newValue: JSON.stringify({ approvalStatus: "APPROVED" }),
      }, req);

      res.json(updatedEntry);
    } catch (error) {
      console.error("Approve time entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reject time entry (managers only)
  app.post("/api/time-entries/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      const schema = z.object({
        reason: z.string().min(1, "Rejection reason is required"),
      });

      const sanitizedBody = {
        ...req.body,
        reason: req.body.reason ? sanitizeText(req.body.reason) : undefined,
      };

      const data = schema.parse(sanitizedBody);

      const [entry] = await db
        .select({
          entry: timeEntries,
          project: projects,
          entryUser: {
            id: users.id,
            organizationId: users.organizationId,
          },
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .leftJoin(users, eq(timeEntries.userId, users.id))
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!entry.entry) {
        return res.status(404).json({ error: "Time entry not found" });
      }

      // Verify organization access - check project OR user's organization
      if (shouldFilter && orgId) {
        const entryOrgId = entry.project?.gcOrganizationId || entry.entryUser?.organizationId;
        if (entryOrgId !== orgId) {
          return res.status(403).json({ error: "Access denied to this time entry" });
        }
      }

      const [updatedEntry] = await db
        .update(timeEntries)
        .set({
          approvalStatus: "REJECTED",
          rejectedById: req.user!.id,
          rejectedAt: new Date(),
          rejectionReason: data.reason,
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      await logAudit({
        userId: req.user!.id,
        entityType: "TIME_ENTRY",
        entityId: req.params.id,
        action: "REJECT",
        oldValue: JSON.stringify({ approvalStatus: entry.entry.approvalStatus }),
        newValue: JSON.stringify({ approvalStatus: "REJECTED", reason: data.reason }),
      }, req);

      res.json(updatedEntry);
    } catch (error) {
      console.error("Reject time entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Bulk approve time entries (managers only)
  app.post("/api/time-entries/bulk-approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      const schema = z.object({
        entryIds: z.array(z.string()).min(1, "At least one entry ID is required"),
      });

      const data = schema.parse(req.body);

      // Get all entries to verify access (include user's organizationId for fallback check)
      const entries = await db
        .select({
          entry: timeEntries,
          project: projects,
          entryUser: {
            id: users.id,
            organizationId: users.organizationId,
          },
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .leftJoin(users, eq(timeEntries.userId, users.id))
        .where(inArray(timeEntries.id, data.entryIds));

      // Filter to only entries the user has access to - check project OR user's organization
      const accessibleIds = entries
        .filter(e => {
          if (!shouldFilter || !orgId) return true;
          const entryOrgId = e.project?.gcOrganizationId || e.entryUser?.organizationId;
          return entryOrgId === orgId;
        })
        .map(e => e.entry.id);

      if (accessibleIds.length === 0) {
        return res.status(403).json({ error: "No accessible time entries to approve" });
      }

      // Bulk approve
      const now = new Date();
      await db
        .update(timeEntries)
        .set({
          approvalStatus: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: now,
          updatedAt: now,
        })
        .where(and(
          inArray(timeEntries.id, accessibleIds),
          eq(timeEntries.approvalStatus, "PENDING")
        ));

      res.json({ 
        success: true, 
        approvedCount: accessibleIds.length,
        message: `Successfully approved ${accessibleIds.length} time entries`
      });
    } catch (error) {
      console.error("Bulk approve time entries error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // PAYROLL NOTIFICATION ROUTES
  // ============================================

  // Get payroll notifications for office manager
  app.get("/api/payroll-notifications", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
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
      console.error("Get payroll notifications error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create payroll notification (after manager approves time for a period)
  app.post("/api/payroll-notifications", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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

      // Find office managers to notify
      const officeManagers = await db
        .select()
        .from(users)
        .where(and(
          eq(users.organizationId, orgId),
          eq(users.role, "OFFICE_MANAGER")
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

      // Create in-app notification for office manager
      if (officeManagerId) {
        await db.insert(notifications).values({
          userId: officeManagerId,
          type: "GENERAL",
          title: "Payroll Ready for Processing",
          message: `Time entries for period ${data.periodStart} to ${data.periodEnd} have been approved and are ready for payroll processing.`,
          relatedEntityId: notification.id,
          relatedEntityType: "payrollNotification",
        });
      }

      res.status(201).json(notification);
    } catch (error) {
      console.error("Create payroll notification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark payroll notification as processed
  app.patch("/api/payroll-notifications/:id/process", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
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

      // Verify organization access
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
      console.error("Process payroll notification error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get approval summary by project for a date range (managers, superintendents, office managers)
  app.get("/api/time-clock/approval-summary", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json({ shifts: [], entries: [], totals: {} });
      }

      const { startDate, endDate, projectId } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required" });
      }

      // Get shift approval counts
      const shiftConditions: any[] = [
        gte(timeClockShifts.clockIn, new Date(startDate as string)),
        lte(timeClockShifts.clockIn, new Date(endDate as string)),
      ];
      if (projectId) {
        shiftConditions.push(eq(timeClockShifts.projectId, projectId as string));
      }

      const shifts = await db
        .select({
          projectId: timeClockShifts.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
          approvalStatus: timeClockShifts.approvalStatus,
          totalHours: timeClockShifts.totalHours,
        })
        .from(timeClockShifts)
        .leftJoin(projects, eq(timeClockShifts.projectId, projects.id))
        .where(and(...shiftConditions));

      // Filter by organization
      const filteredShifts = shouldFilter && orgId
        ? shifts.filter(s => s.gcOrganizationId === orgId)
        : shifts;

      // Get time entry approval counts
      const entryConditions: any[] = [
        gte(timeEntries.date, new Date(startDate as string)),
        lte(timeEntries.date, new Date(endDate as string)),
      ];
      if (projectId) {
        entryConditions.push(eq(timeEntries.projectId, projectId as string));
      }

      const entries = await db
        .select({
          projectId: timeEntries.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          gcOrganizationId: projects.gcOrganizationId,
          approvalStatus: timeEntries.approvalStatus,
          hoursRegular: timeEntries.hoursRegular,
          hoursOvertime: timeEntries.hoursOvertime,
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .where(and(...entryConditions));

      // Filter by organization
      const filteredEntries = shouldFilter && orgId
        ? entries.filter(e => e.gcOrganizationId === orgId)
        : entries;

      // Aggregate by status
      const shiftSummary = {
        pending: filteredShifts.filter(s => s.approvalStatus === "PENDING").length,
        approved: filteredShifts.filter(s => s.approvalStatus === "APPROVED").length,
        rejected: filteredShifts.filter(s => s.approvalStatus === "REJECTED").length,
        totalHours: filteredShifts.reduce((sum, s) => sum + parseFloat(s.totalHours || "0"), 0),
      };

      const entrySummary = {
        pending: filteredEntries.filter(e => e.approvalStatus === "PENDING").length,
        approved: filteredEntries.filter(e => e.approvalStatus === "APPROVED").length,
        rejected: filteredEntries.filter(e => e.approvalStatus === "REJECTED").length,
        totalHours: filteredEntries.reduce((sum, e) => 
          sum + parseFloat(e.hoursRegular || "0") + parseFloat(e.hoursOvertime || "0"), 0),
      };

      res.json({
        period: { start: startDate, end: endDate },
        shifts: shiftSummary,
        entries: entrySummary,
        totals: {
          pendingItems: shiftSummary.pending + entrySummary.pending,
          approvedItems: shiftSummary.approved + entrySummary.approved,
          rejectedItems: shiftSummary.rejected + entrySummary.rejected,
          totalHours: shiftSummary.totalHours + entrySummary.totalHours,
        },
      });
    } catch (error) {
      console.error("Get approval summary error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
