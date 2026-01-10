import type { Express } from "express";
import { db } from "./db";
import { 
  organizationPayrollSettings, weeklyPayrollReports, users, timeClockShifts, 
  notifications
} from "@shared/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";

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

export function registerPayrollSettingsRoutes(app: Express) {
  app.get("/api/payroll/settings", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN"), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const orgId = await getOrgIdForFilter(authReq);
      if (!orgId) {
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
      console.error("Get payroll settings error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.put("/api/payroll/settings", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN"), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const orgId = await getOrgIdForFilter(authReq);
      if (!orgId) {
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
      console.error("Update payroll settings error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/payroll/weekly-reports", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN", "MANAGER"), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const orgId = await getOrgIdForFilter(authReq);
      if (!orgId) {
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
      console.error("Get weekly reports error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/payroll/weekly-reports/:id", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN", "MANAGER"), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const orgId = await getOrgIdForFilter(authReq);
      if (!orgId) {
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
      console.error("Get weekly report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/payroll/generate-weekly-report", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN", "SUPERINTENDENT", "MANAGER"), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const orgId = await getOrgIdForFilter(authReq);
      if (!orgId) {
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
          await db.insert(notifications).values({
            userId: admin.id,
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
      console.error("Generate weekly report error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/payroll/current-week-summary", requireAuth, requireRole("ADMIN", "OFFICE_MANAGER", "SUPER_ADMIN", "SUPERINTENDENT", "MANAGER"), async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const orgId = await getOrgIdForFilter(authReq);
      if (!orgId) {
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
      console.error("Get current week summary error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
