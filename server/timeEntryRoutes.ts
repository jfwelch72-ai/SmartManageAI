import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { timeEntries, timeClockShifts, users, projects } from "@shared/schema";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { sanitizeText } from "./sanitization";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";
import { createApprovalRequest } from "./services/approvalService";
import { isFeatureEnabled } from "./services/featureFlagService";
import * as workflowEngine from "./services/workflowEngine";

const router = Router();

router.get("/api/time-entries/pending-approvals", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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

    if (shouldFilter && orgId) {
      const entryOrgId = entry.project?.gcOrganizationId || entry.entryUser?.organizationId;
      if (entryOrgId !== orgId) {
        return res.status(403).json({ error: "Access denied to this time entry" });
      }
    }

    if (entry.entry.approvalStatus === "APPROVED") {
      return res.status(400).json({ error: "Time entry is already approved" });
    }

    const entryOrgId = entry.project?.gcOrganizationId || entry.entryUser?.organizationId;
    if (entryOrgId) {
      const delegation = await workflowEngine.delegateEntityTransition(
        entryOrgId,
        "TIME_APPROVAL",
        req.params.id,
        req.user!.id,
        req.user!.role || "WORKER",
        "APPROVED",
        "Time entry approved"
      );
      if (delegation.delegated) {
        if (delegation.needsMoreApprovals) {
          return res.status(202).json({ message: delegation.error, approvalRecorded: true, needsMoreApprovals: true });
        }
        if (!delegation.success) {
          return res.status(400).json({ error: delegation.error || "Workflow transition blocked" });
        }
      }
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

    if (entry.entry.projectId) {
      const { evaluateBudgetAlerts } = await import("./costLedgerRoutes");
      evaluateBudgetAlerts(entry.entry.projectId).catch(e => logError("Budget alert eval after time approval:", {}, e instanceof Error ? e : new Error(String(e))));
    }

    res.json(updatedEntry);
  } catch (error) {
    next(error);
  }
});

router.post("/api/time-entries/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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

    if (shouldFilter && orgId) {
      const entryOrgId = entry.project?.gcOrganizationId || entry.entryUser?.organizationId;
      if (entryOrgId !== orgId) {
        return res.status(403).json({ error: "Access denied to this time entry" });
      }
    }

    if (entry.entry.approvalStatus === "REJECTED") {
      return res.status(400).json({ error: "Time entry has already been rejected" });
    }

    if (entry.entry.approvalStatus === "APPROVED") {
      return res.status(400).json({ error: "Cannot reject an already approved time entry" });
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
    next(error);
  }
});

const bulkApproveHandler = async (req: AuthRequest, res: any) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const schema = z.object({
      entryIds: z.array(z.string()).min(1, "At least one entry ID is required"),
    });

    const data = schema.parse(req.body);

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

    if (req.user?.organizationId) {
      try {
        const approvalsEnabled = await isFeatureEnabled(req.user.organizationId, "APPROVALS_FRAMEWORK");
        if (approvalsEnabled) {
          await createApprovalRequest(
            req.user.organizationId,
            "TIME_ENTRY",
            accessibleIds[0],
            req.user.id,
            `Bulk approved ${accessibleIds.length} time entries`
          );
        }
      } catch (e) { logError("[timeEntry] approval request failed:", {}, e instanceof Error ? e : new Error(String(e))); }
    }

    const projectIds = new Set(entries.filter(e => e.entry.projectId).map(e => e.entry.projectId!));
    if (projectIds.size > 0) {
      import("./costLedgerRoutes").then(m => {
        for (const pid of projectIds) {
          m.evaluateBudgetAlerts(pid).catch(e => logError("Budget alert eval after bulk time approval:", {}, e instanceof Error ? e : new Error(String(e))));
        }
      }).catch(e => logError("[timeEntry] costLedger import failed:", {}, e instanceof Error ? e : new Error(String(e))));
    }

    res.json({ 
      success: true, 
      approvedCount: accessibleIds.length,
      message: `Successfully approved ${accessibleIds.length} time entries`
    });
  } catch (error) {
    next(error);
  }
};
router.post("/api/time-entries/bulk-approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), bulkApproveHandler);
router.patch("/api/time-entries/batch-approve", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), bulkApproveHandler);

router.get("/api/time-entries/project-crew", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    if (shouldFilter && orgId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId as string), eq(projects.gcOrganizationId, orgId)));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
    }

    const rows = await db
      .selectDistinct({ userId: timeEntries.userId })
      .from(timeEntries)
      .where(eq(timeEntries.projectId, projectId as string));
    res.json(rows.map(r => r.userId));
  } catch (err: any) {
    next(error);
  }
});

router.get("/api/time-entries/export", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { startDate, endDate, projectId, userId: filterUserId, status } = req.query;

    const conditions: any[] = [];

    if (startDate) {
      conditions.push(gte(timeEntries.date, new Date(startDate as string)));
    }
    if (endDate) {
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(timeEntries.date, end));
    }
    if (projectId) {
      conditions.push(eq(timeEntries.projectId, projectId as string));
    }
    if (filterUserId) {
      conditions.push(eq(timeEntries.userId, filterUserId as string));
    }
    if (status === "approved") {
      conditions.push(sql`${timeEntries.approvedById} IS NOT NULL`);
    } else if (status === "pending") {
      conditions.push(sql`${timeEntries.approvedById} IS NULL AND ${timeEntries.rejectedById} IS NULL`);
    } else if (status === "rejected") {
      conditions.push(sql`${timeEntries.rejectedById} IS NOT NULL`);
    }

    const entries = await db
      .select({
        entry: timeEntries,
        userName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, 'Unknown')`,
        userEmail: users.email,
        projectName: projects.name,
        projectCode: projects.code,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(conditions.length > 0 ? and(...conditions) : sql`true`)
      .orderBy(desc(timeEntries.date));

    const csvHeader = "Date,Employee,Email,Project,Project Code,Regular Hours,Overtime Hours,Total Hours,Cost Code,Status,Notes\n";
    const csvRows = entries.map(row => {
      const e = row.entry;
      const regular = parseFloat(e.hoursRegular || "0");
      const overtime = parseFloat(e.hoursOvertime || "0");
      const total = regular + overtime;
      const entryStatus = e.approvedById ? "Approved" : e.rejectedById ? "Rejected" : "Pending";
      const date = e.date ? new Date(e.date).toLocaleDateString("en-US") : "";
      const escapeCsv = (val: string | null | undefined) => {
        if (!val) return "";
        const str = val.replace(/"/g, '""');
        return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
      };
      return `${date},${escapeCsv(row.userName)},${escapeCsv(row.userEmail)},${escapeCsv(row.projectName)},${escapeCsv(row.projectCode)},${regular.toFixed(2)},${overtime.toFixed(2)},${total.toFixed(2)},${escapeCsv(e.costCode)},${entryStatus},${escapeCsv(e.notes)}`;
    }).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=time-entries-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csvHeader + csvRows);
  } catch (error) {
    next(error);
  }
});

router.get("/api/time-clock/approval-summary", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json({ shifts: [], entries: [], totals: {} });
    }

    const { startDate, endDate, projectId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }

    const shiftConditions: any[] = [
      gte(timeClockShifts.clockIn, new Date(startDate as string)),
      lte(timeClockShifts.clockIn, new Date(endDate as string)),
    ];
    if (projectId) shiftConditions.push(eq(timeClockShifts.projectId, projectId as string));
    if (shouldFilter && orgId) shiftConditions.push(eq(projects.gcOrganizationId, orgId));

    const filteredShifts = await db
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

    const entryConditions: any[] = [
      gte(timeEntries.date, new Date(startDate as string)),
      lte(timeEntries.date, new Date(endDate as string)),
    ];
    if (projectId) entryConditions.push(eq(timeEntries.projectId, projectId as string));
    if (shouldFilter && orgId) entryConditions.push(eq(projects.gcOrganizationId, orgId));

    const filteredEntries = await db
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
    next(error);
  }
});

export default router;
