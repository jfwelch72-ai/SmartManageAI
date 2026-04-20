/**
 * My Day — personal work inbox aggregator
 *
 * GET /api/my-day
 *
 * Returns the current user's open work across every source, grouped per source
 * so callers can either render them per-section or merge them into a single
 * inbox. Every source returns a `MyDayItem` with the same shape.
 *
 * Response shape:
 * {
 *   userId: string,
 *   generatedAt: string (ISO),
 *   tasks: MyDayItem[],
 *   rfis: MyDayItem[],
 *   submittals: MyDayItem[],
 *   punchItems: MyDayItem[],
 *   approvals: MyDayItem[],
 *   crmTasks: MyDayItem[],
 *   counts: {
 *     total, overdue, today, thisWeek, later,
 *     byType: { TASK, RFI, SUBMITTAL, PUNCH, APPROVAL, CRM_TASK }
 *   }
 * }
 *
 * MyDayItem includes ownerId/ownerName/ownerEmail so the UI can render a
 * colored-initials avatar without a second round-trip.
 */
import { Router, type Response, type NextFunction } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "./db";
import {
  tasks,
  rfis,
  submittals,
  punchListItems,
  approvalRequests,
  crmTasks,
  projects,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

type MyDayType = "TASK" | "RFI" | "SUBMITTAL" | "PUNCH" | "APPROVAL" | "CRM_TASK";

type MyDayItem = {
  id: string;
  type: MyDayType;
  title: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  dueDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  status: string;
  priority: string | null;
  sourceUrl: string;
  canQuickComplete: boolean;
};

type ApprovalRow = {
  id: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  approverUserId: string | null;
  createdAt: Date | null;
};

function entityTypeToLabel(t: string | null): string {
  if (!t) return "Approval";
  return t
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

router.get("/api/my-day", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!;
    const userId = me.id;
    const userRole = me.role;
    const ownerName = [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.email || "Me";
    const ownerEmail = me.email ?? null;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    const emptyResponse = {
      userId,
      generatedAt: new Date().toISOString(),
      tasks: [] as MyDayItem[],
      rfis: [] as MyDayItem[],
      submittals: [] as MyDayItem[],
      punchItems: [] as MyDayItem[],
      approvals: [] as MyDayItem[],
      crmTasks: [] as MyDayItem[],
      counts: {
        total: 0,
        overdue: 0,
        today: 0,
        thisWeek: 0,
        later: 0,
        byType: { TASK: 0, RFI: 0, SUBMITTAL: 0, PUNCH: 0, APPROVAL: 0, CRM_TASK: 0 },
      },
    };

    if (mustDenyAccess) {
      res.setHeader("Cache-Control", "private, max-age=30");
      return res.json(emptyResponse);
    }

    const orgFilter = shouldFilter && orgId ? orgId : null;
    const emptyApprovals: Promise<ApprovalRow[]> = Promise.resolve([]);

    const [
      tasksRows,
      rfisRows,
      submittalsRows,
      punchRows,
      approvalsRows,
      crmTasksRows,
    ] = await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          dueDate: tasks.dueDate,
          assignedToId: tasks.assignedToId,
          projectId: tasks.projectId,
          projectCode: projects.code,
          projectName: projects.name,
        })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(tasks.assignedToId, userId),
            inArray(tasks.status, ["PENDING", "IN_PROGRESS"]),
            ...(orgFilter ? [eq(tasks.organizationId, orgFilter)] : []),
          ),
        ),

      db
        .select({
          id: rfis.id,
          subject: rfis.subject,
          status: rfis.status,
          priority: rfis.priority,
          dueDate: rfis.dateRequired,
          assignedToId: rfis.assignedToId,
          forwardedToId: rfis.forwardedToId,
          projectId: rfis.projectId,
          projectCode: projects.code,
          projectName: projects.name,
        })
        .from(rfis)
        .leftJoin(projects, eq(rfis.projectId, projects.id))
        .where(
          and(
            inArray(rfis.status, ["SUBMITTED", "UNDER_REVIEW", "FORWARDED"]),
            or(eq(rfis.assignedToId, userId), eq(rfis.forwardedToId, userId))!,
            ...(orgFilter ? [eq(rfis.organizationId, orgFilter)] : []),
          ),
        ),

      db
        .select({
          id: submittals.id,
          subject: submittals.subject,
          status: submittals.status,
          dueDate: submittals.dateRequired,
          reviewerId: submittals.reviewerId,
          projectId: submittals.projectId,
          projectCode: projects.code,
          projectName: projects.name,
        })
        .from(submittals)
        .leftJoin(projects, eq(submittals.projectId, projects.id))
        .where(
          and(
            eq(submittals.reviewerId, userId),
            inArray(submittals.status, ["SUBMITTED", "UNDER_REVIEW"]),
            ...(orgFilter ? [eq(submittals.organizationId, orgFilter)] : []),
          ),
        ),

      // Punch list items have no organizationId column; org guard via project join
      // using the GC organization (projects.gcOrganizationId).
      db
        .select({
          id: punchListItems.id,
          title: punchListItems.title,
          status: punchListItems.status,
          priority: punchListItems.priority,
          dueDate: punchListItems.dueDate,
          assignedToUserId: punchListItems.assignedToUserId,
          projectId: punchListItems.projectId,
          projectCode: projects.code,
          projectName: projects.name,
          projectOrgId: projects.gcOrganizationId,
        })
        .from(punchListItems)
        .leftJoin(projects, eq(punchListItems.projectId, projects.id))
        .where(
          and(
            eq(punchListItems.assignedToUserId, userId),
            inArray(punchListItems.status, ["OPEN", "IN_PROGRESS"]),
            ...(orgFilter ? [eq(projects.gcOrganizationId, orgFilter)] : []),
          ),
        ),

      ["ADMIN", "MANAGER", "SUPER_ADMIN", "SUPERINTENDENT"].includes(userRole)
        ? (db
            .select({
              id: approvalRequests.id,
              entityType: approvalRequests.entityType,
              entityId: approvalRequests.entityId,
              status: approvalRequests.status,
              approverUserId: approvalRequests.approverUserId,
              createdAt: approvalRequests.createdAt,
            })
            .from(approvalRequests)
            .where(
              and(
                eq(approvalRequests.status, "pending"),
                or(
                  eq(approvalRequests.approverUserId, userId),
                  isNull(approvalRequests.approverUserId),
                )!,
                ...(orgFilter ? [eq(approvalRequests.organizationId, orgFilter)] : []),
              ),
            ) as Promise<ApprovalRow[]>)
        : emptyApprovals,

      db
        .select({
          id: crmTasks.id,
          title: crmTasks.title,
          status: crmTasks.status,
          priority: crmTasks.priority,
          dueDate: crmTasks.dueDate,
          assignedToId: crmTasks.assignedToId,
          opportunityId: crmTasks.opportunityId,
        })
        .from(crmTasks)
        .where(
          and(
            eq(crmTasks.assignedToId, userId),
            inArray(crmTasks.status, ["PENDING", "IN_PROGRESS"]),
            ...(orgFilter ? [eq(crmTasks.organizationId, orgFilter)] : []),
          ),
        ),
    ]);

    const tasksOut: MyDayItem[] = tasksRows.map((t) => ({
      id: t.id,
      type: "TASK",
      title: t.title,
      projectId: t.projectId ?? null,
      projectCode: t.projectCode ?? null,
      projectName: t.projectName ?? null,
      dueDate: toIso(t.dueDate),
      ownerId: t.assignedToId ?? userId,
      ownerName,
      ownerEmail,
      status: t.status,
      priority: t.priority ?? null,
      sourceUrl: `/tasks?taskId=${encodeURIComponent(t.id)}`,
      canQuickComplete: true,
    }));

    const rfisOut: MyDayItem[] = rfisRows.map((r) => {
      const code = r.projectCode ?? "";
      return {
        id: r.id,
        type: "RFI",
        title: r.subject,
        projectId: r.projectId,
        projectCode: code || null,
        projectName: r.projectName ?? null,
        dueDate: toIso(r.dueDate),
        ownerId: r.assignedToId ?? r.forwardedToId ?? userId,
        ownerName,
        ownerEmail,
        status: r.status,
        priority: r.priority ?? null,
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=rfis&rfiId=${encodeURIComponent(r.id)}`
          : `/projects`,
        canQuickComplete: false,
      };
    });

    const submittalsOut: MyDayItem[] = submittalsRows.map((s) => {
      const code = s.projectCode ?? "";
      return {
        id: s.id,
        type: "SUBMITTAL",
        title: s.subject,
        projectId: s.projectId,
        projectCode: code || null,
        projectName: s.projectName ?? null,
        dueDate: toIso(s.dueDate),
        ownerId: s.reviewerId ?? userId,
        ownerName,
        ownerEmail,
        status: s.status,
        priority: null,
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=submittals&submittalId=${encodeURIComponent(s.id)}`
          : `/projects`,
        canQuickComplete: false,
      };
    });

    const punchOut: MyDayItem[] = punchRows.map((p) => {
      const code = p.projectCode ?? "";
      return {
        id: p.id,
        type: "PUNCH",
        title: p.title,
        projectId: p.projectId,
        projectCode: code || null,
        projectName: p.projectName ?? null,
        dueDate: toIso(p.dueDate),
        ownerId: p.assignedToUserId ?? userId,
        ownerName,
        ownerEmail,
        status: p.status,
        priority: p.priority ?? null,
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=punch-list&itemId=${encodeURIComponent(p.id)}`
          : `/projects`,
        canQuickComplete: true,
      };
    });

    const approvalsOut: MyDayItem[] = approvalsRows.map((a) => ({
      id: a.id,
      type: "APPROVAL",
      title: `${entityTypeToLabel(a.entityType)} approval`,
      projectId: null,
      projectCode: null,
      projectName: null,
      dueDate: null,
      ownerId: a.approverUserId ?? userId,
      ownerName,
      ownerEmail,
      status: a.status,
      priority: null,
      sourceUrl: `/approvals`,
      canQuickComplete: false,
    }));

    const crmOut: MyDayItem[] = crmTasksRows.map((c) => ({
      id: c.id,
      type: "CRM_TASK",
      title: c.title,
      projectId: null,
      projectCode: null,
      projectName: c.opportunityId ? "CRM Deal" : "CRM",
      dueDate: toIso(c.dueDate),
      ownerId: c.assignedToId ?? userId,
      ownerName,
      ownerEmail,
      status: c.status,
      priority: c.priority ?? null,
      sourceUrl: c.opportunityId
        ? `/crm/deals/${encodeURIComponent(c.opportunityId)}`
        : `/crm`,
      canQuickComplete: false,
    }));

    const allItems: MyDayItem[] = [
      ...tasksOut,
      ...rfisOut,
      ...submittalsOut,
      ...punchOut,
      ...approvalsOut,
      ...crmOut,
    ];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

    let overdue = 0;
    let today = 0;
    let thisWeek = 0;
    let later = 0;
    const byType: Record<MyDayType, number> = {
      TASK: tasksOut.length,
      RFI: rfisOut.length,
      SUBMITTAL: submittalsOut.length,
      PUNCH: punchOut.length,
      APPROVAL: approvalsOut.length,
      CRM_TASK: crmOut.length,
    };

    for (const it of allItems) {
      if (!it.dueDate) {
        later += 1;
        continue;
      }
      const d = new Date(it.dueDate);
      if (d < startOfToday) overdue += 1;
      else if (d < endOfToday) today += 1;
      else if (d < endOfWeek) thisWeek += 1;
      else later += 1;
    }

    res.setHeader("Cache-Control", "private, max-age=30");

    res.json({
      userId,
      generatedAt: new Date().toISOString(),
      tasks: tasksOut,
      rfis: rfisOut,
      submittals: submittalsOut,
      punchItems: punchOut,
      approvals: approvalsOut,
      crmTasks: crmOut,
      counts: {
        total: allItems.length,
        overdue,
        today,
        thisWeek,
        later,
        byType,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
