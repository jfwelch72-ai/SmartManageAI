/**
 * My Work — personal task aggregator
 *
 * GET /api/me/work
 *
 * Returns the current user's work items aggregated across every source
 * (project tasks, CRM tasks, punch items, RFIs, inspection follow-ups).
 *
 * Query params:
 *   - source: comma-separated list of source-type filters
 *             (TASK, CRM_TASK, PUNCH, RFI, INSPECTION). Default: all
 *   - status: ALL | OPEN | COMPLETED  (default OPEN — non-completed)
 *   - offset: number, default 0 — page offset
 *   - limit:  page size, default 200, max 500
 *   - team:   "direct-reports" — managers only, returns reports' work
 *             read-only (server-side: canEdit*=false on every item).
 *
 * Response shape:
 *   {
 *     userId,
 *     generatedAt,
 *     items: MyWorkItem[],
 *     nextCursor: string | null,
 *     counts: { total, overdue, today, thisWeek, later, completedThisWeek, byType }
 *   }
 */
import { Router, type Response, type NextFunction } from "express";
import { and, eq, inArray, or, desc, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "./db";
import {
  tasks,
  rfis,
  punchListItems,
  crmTasks,
  projectInspections,
  projects,
  users,
  myWorkSavedViews,
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

type MyWorkType = "TASK" | "CRM_TASK" | "PUNCH" | "RFI" | "INSPECTION";
type Bucket = "overdue" | "today" | "thisWeek" | "later" | "none";

type MyWorkItem = {
  id: string;
  type: MyWorkType;
  title: string;
  description: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  dueDate: string | null;
  status: string;
  priority: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  bucket: Bucket;
  sourceUrl: string;
  canEditStatus: boolean;
  canEditPriority: boolean;
  canEditDueDate: boolean;
  canReassign: boolean;
  isCompleted: boolean;
  updatedAt: string | null;
};

const TASK_COMPLETED = ["COMPLETED", "DISMISSED"];
const PUNCH_COMPLETED = ["RESOLVED", "VERIFIED", "CLOSED"];
const CRM_COMPLETED = ["COMPLETED", "CANCELLED"];
const RFI_COMPLETED = ["ANSWERED", "CLOSED", "VOIDED"];
const INSPECTION_COMPLETED = ["PASSED", "FAILED", "CANCELLED", "COMPLETED"];

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function bucketFor(dueIso: string | null, now: Date): Bucket {
  if (!dueIso) return "none";
  const d = new Date(dueIso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (d < startOfToday) return "overdue";
  if (d < endOfToday) return "today";
  if (d < endOfWeek) return "thisWeek";
  return "later";
}

function bucketRank(b: Bucket): number {
  return b === "overdue" ? 0 : b === "today" ? 1 : b === "thisWeek" ? 2 : b === "later" ? 3 : 4;
}

function fullName(first: string | null | undefined, last: string | null | undefined, email?: string | null): string | null {
  const n = [first, last].filter(Boolean).join(" ").trim();
  if (n) return n;
  return email ?? null;
}

const MANAGER_ROLES: ReadonlySet<string> = new Set([
  "ADMIN",
  "MANAGER",
  "SUPER_ADMIN",
  "SUPERINTENDENT",
]);

/**
 * Permission gate for the manager team view (?team=direct-reports).
 * Centralized here so a future per-user permission flag (`canViewTeamWork`)
 * can be plugged in without touching the route body.
 */
function canViewTeamWork(role: string | null | undefined): boolean {
  return !!role && MANAGER_ROLES.has(role);
}

router.get("/api/me/work", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!;
    const userId = me.id;
    const userRole = me.role;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    const sourceParam = (req.query.source as string | undefined) ?? "";
    const requestedSources = new Set(
      sourceParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean) as MyWorkType[],
    );
    const wantSource = (t: MyWorkType) => requestedSources.size === 0 || requestedSources.has(t);

    const statusParam = (req.query.status as string | undefined)?.toUpperCase() ?? "OPEN";
    const includeCompleted = statusParam === "COMPLETED" || statusParam === "ALL";
    const includeOpen = statusParam === "OPEN" || statusParam === "ALL";

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "200"), 10) || 200, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

    const teamModeRequested = (req.query.team as string | undefined) === "direct-reports";
    const teamMode = teamModeRequested && canViewTeamWork(userRole);

    const emptyResponse = {
      userId,
      generatedAt: new Date().toISOString(),
      items: [] as MyWorkItem[],
      nextCursor: null as string | null,
      counts: {
        total: 0,
        overdue: 0,
        today: 0,
        thisWeek: 0,
        later: 0,
        completedThisWeek: 0,
        byType: { TASK: 0, CRM_TASK: 0, PUNCH: 0, RFI: 0, INSPECTION: 0 },
      },
    };

    // Manager requested team view but isn't permitted → 403 (no silent fallback).
    if (teamModeRequested && !teamMode) {
      return res.status(403).json({ error: "team-view permission required" });
    }

    if (mustDenyAccess) {
      res.setHeader("Cache-Control", "private, max-age=15");
      return res.json(emptyResponse);
    }

    const orgFilter = shouldFilter && orgId ? orgId : null;

    // Build the assignee scope.
    //   - Default: just me.
    //   - Team mode: my direct reports (users WHERE manager_id = me.id) plus me.
    //     This is the *true* direct-reports set, not the whole org.
    let assigneeIds: string[] = [userId];
    let assigneeMap = new Map<string, { name: string | null }>([
      [userId, { name: fullName(me.firstName, me.lastName, me.email) }],
    ]);

    if (teamMode) {
      const reports = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(
          and(
            eq(users.managerId, userId),
            ...(orgFilter ? [eq(users.organizationId, orgFilter)] : []),
          ),
        );

      // Always include the manager themselves so their own work shows up alongside reports.
      assigneeIds = [userId, ...reports.map((u) => u.id).filter((id) => id !== userId)];
      assigneeMap = new Map<string, { name: string | null }>([
        [userId, { name: fullName(me.firstName, me.lastName, me.email) }],
      ]);
      for (const u of reports) {
        assigneeMap.set(u.id, { name: fullName(u.firstName, u.lastName, u.email) });
      }
    }

    const inAssignees = (col: PgColumn): SQL => inArray(col, assigneeIds);

    // Compute completed-this-week window once.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);

    const PER_SOURCE_CAP = 800;

    const tasksRowsP = wantSource("TASK")
      ? db
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            priority: tasks.priority,
            dueDate: tasks.dueDate,
            assignedToId: tasks.assignedToId,
            projectId: tasks.projectId,
            projectCode: projects.code,
            projectName: projects.name,
            completedAt: tasks.completedAt,
            updatedAt: tasks.updatedAt,
          })
          .from(tasks)
          .leftJoin(projects, eq(tasks.projectId, projects.id))
          .where(
            and(
              inAssignees(tasks.assignedToId),
              ...(orgFilter ? [eq(tasks.organizationId, orgFilter)] : []),
            ),
          )
          .orderBy(desc(tasks.updatedAt))
          .limit(PER_SOURCE_CAP)
      : Promise.resolve([] as Array<Record<string, unknown>>);

    const crmRowsP = wantSource("CRM_TASK")
      ? db
          .select({
            id: crmTasks.id,
            title: crmTasks.title,
            description: crmTasks.description,
            status: crmTasks.status,
            priority: crmTasks.priority,
            dueDate: crmTasks.dueDate,
            assignedToId: crmTasks.assignedToId,
            opportunityId: crmTasks.opportunityId,
            completedAt: crmTasks.completedAt,
            updatedAt: crmTasks.updatedAt,
          })
          .from(crmTasks)
          .where(
            and(
              inAssignees(crmTasks.assignedToId),
              ...(orgFilter ? [eq(crmTasks.organizationId, orgFilter)] : []),
            ),
          )
          .orderBy(desc(crmTasks.updatedAt))
          .limit(PER_SOURCE_CAP)
      : Promise.resolve([] as Array<Record<string, unknown>>);

    const punchRowsP = wantSource("PUNCH")
      ? db
          .select({
            id: punchListItems.id,
            title: punchListItems.title,
            description: punchListItems.description,
            status: punchListItems.status,
            priority: punchListItems.priority,
            dueDate: punchListItems.dueDate,
            assignedToUserId: punchListItems.assignedToUserId,
            projectId: punchListItems.projectId,
            projectCode: projects.code,
            projectName: projects.name,
            updatedAt: punchListItems.updatedAt,
          })
          .from(punchListItems)
          .leftJoin(projects, eq(punchListItems.projectId, projects.id))
          .where(
            and(
              inAssignees(punchListItems.assignedToUserId),
              ...(orgFilter ? [eq(projects.gcOrganizationId, orgFilter)] : []),
            ),
          )
          .orderBy(desc(punchListItems.updatedAt))
          .limit(PER_SOURCE_CAP)
      : Promise.resolve([] as Array<Record<string, unknown>>);

    const rfiRowsP = wantSource("RFI")
      ? db
          .select({
            id: rfis.id,
            subject: rfis.subject,
            question: rfis.question,
            status: rfis.status,
            priority: rfis.priority,
            dueDate: rfis.dateRequired,
            assignedToId: rfis.assignedToId,
            forwardedToId: rfis.forwardedToId,
            projectId: rfis.projectId,
            projectCode: projects.code,
            projectName: projects.name,
            updatedAt: rfis.updatedAt,
          })
          .from(rfis)
          .leftJoin(projects, eq(rfis.projectId, projects.id))
          .where(
            and(
              or(inAssignees(rfis.assignedToId), inAssignees(rfis.forwardedToId))!,
              ...(orgFilter ? [eq(rfis.organizationId, orgFilter)] : []),
            ),
          )
          .orderBy(desc(rfis.updatedAt))
          .limit(PER_SOURCE_CAP)
      : Promise.resolve([] as Array<Record<string, unknown>>);

    // Inspections have no assignedToId; treat the requester (createdById) as the owner.
    const inspRowsP = wantSource("INSPECTION")
      ? db
          .select({
            id: projectInspections.id,
            title: projectInspections.title,
            description: projectInspections.description,
            status: projectInspections.status,
            dueDate: projectInspections.scheduledDate,
            requestedDate: projectInspections.requestedDate,
            createdById: projectInspections.createdById,
            projectId: projectInspections.projectId,
            projectCode: projects.code,
            projectName: projects.name,
            updatedAt: projectInspections.updatedAt,
          })
          .from(projectInspections)
          .leftJoin(projects, eq(projectInspections.projectId, projects.id))
          .where(
            and(
              inAssignees(projectInspections.createdById),
              ...(orgFilter ? [eq(projects.gcOrganizationId, orgFilter)] : []),
            ),
          )
          .orderBy(desc(projectInspections.updatedAt))
          .limit(PER_SOURCE_CAP)
      : Promise.resolve([] as Array<Record<string, unknown>>);

    const [tasksRows, crmRows, punchRows, rfiRows, inspRows] = await Promise.all([
      tasksRowsP,
      crmRowsP,
      punchRowsP,
      rfiRowsP,
      inspRowsP,
    ]);

    const all: MyWorkItem[] = [];

    // In team mode, items are read-only end-to-end (UI + server). The manager
    // can still open the source record to edit through that record's own
    // permissioned routes — this list view is intentionally view-only.
    const editableInPersonalView = !teamMode;

    for (const t of tasksRows as Array<Record<string, unknown>>) {
      const status = String(t.status);
      const isCompleted = TASK_COMPLETED.includes(status);
      const due = toIso(t.dueDate as Date | null);
      const assignedToId = (t.assignedToId as string | null) ?? null;
      all.push({
        id: String(t.id),
        type: "TASK",
        title: String(t.title),
        description: (t.description as string | null) ?? null,
        projectId: (t.projectId as string | null) ?? null,
        projectCode: (t.projectCode as string | null) ?? null,
        projectName: (t.projectName as string | null) ?? null,
        dueDate: due,
        status,
        priority: (t.priority as string | null) ?? null,
        assignedToId,
        assignedToName: assigneeMap.get(assignedToId ?? "")?.name ?? null,
        bucket: bucketFor(due, now),
        sourceUrl: `/tasks?taskId=${encodeURIComponent(String(t.id))}`,
        canEditStatus: editableInPersonalView,
        canEditPriority: editableInPersonalView,
        canEditDueDate: editableInPersonalView,
        canReassign: editableInPersonalView,
        isCompleted,
        updatedAt: toIso((t.updatedAt as Date | null) ?? (t.completedAt as Date | null)),
      });
    }

    for (const c of crmRows as Array<Record<string, unknown>>) {
      const status = String(c.status);
      const isCompleted = CRM_COMPLETED.includes(status);
      const due = toIso(c.dueDate as Date | null);
      const assignedToId = (c.assignedToId as string | null) ?? null;
      const opportunityId = (c.opportunityId as string | null) ?? null;
      all.push({
        id: String(c.id),
        type: "CRM_TASK",
        title: String(c.title),
        description: (c.description as string | null) ?? null,
        projectId: null,
        projectCode: null,
        projectName: opportunityId ? "CRM Deal" : "CRM",
        dueDate: due,
        status,
        priority: (c.priority as string | null) ?? null,
        assignedToId,
        assignedToName: assigneeMap.get(assignedToId ?? "")?.name ?? null,
        bucket: bucketFor(due, now),
        sourceUrl: opportunityId
          ? `/crm/deals/${encodeURIComponent(opportunityId)}`
          : `/crm`,
        canEditStatus: editableInPersonalView,
        canEditPriority: editableInPersonalView,
        canEditDueDate: editableInPersonalView,
        canReassign: editableInPersonalView,
        isCompleted,
        updatedAt: toIso((c.updatedAt as Date | null) ?? (c.completedAt as Date | null)),
      });
    }

    for (const p of punchRows as Array<Record<string, unknown>>) {
      const status = String(p.status);
      const isCompleted = PUNCH_COMPLETED.includes(status);
      const due = toIso(p.dueDate as Date | null);
      const code = (p.projectCode as string | null) ?? "";
      const assignedToUserId = (p.assignedToUserId as string | null) ?? null;
      all.push({
        id: String(p.id),
        type: "PUNCH",
        title: String(p.title),
        description: (p.description as string | null) ?? null,
        projectId: (p.projectId as string | null) ?? null,
        projectCode: code || null,
        projectName: (p.projectName as string | null) ?? null,
        dueDate: due,
        status,
        priority: (p.priority as string | null) ?? null,
        assignedToId: assignedToUserId,
        assignedToName: assigneeMap.get(assignedToUserId ?? "")?.name ?? null,
        bucket: bucketFor(due, now),
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=punch-list&itemId=${encodeURIComponent(String(p.id))}`
          : `/projects`,
        canEditStatus: editableInPersonalView,
        canEditPriority: editableInPersonalView,
        canEditDueDate: editableInPersonalView,
        canReassign: false,
        isCompleted,
        updatedAt: toIso(p.updatedAt as Date | null),
      });
    }

    for (const r of rfiRows as Array<Record<string, unknown>>) {
      const status = String(r.status);
      const isCompleted = RFI_COMPLETED.includes(status);
      const due = toIso(r.dueDate as Date | null);
      const code = (r.projectCode as string | null) ?? "";
      const owner = (r.assignedToId as string | null) ?? (r.forwardedToId as string | null) ?? null;
      all.push({
        id: String(r.id),
        type: "RFI",
        title: String(r.subject),
        description: (r.question as string | null) ?? null,
        projectId: (r.projectId as string | null) ?? null,
        projectCode: code || null,
        projectName: (r.projectName as string | null) ?? null,
        dueDate: due,
        status,
        priority: (r.priority as string | null) ?? null,
        assignedToId: owner,
        assignedToName: assigneeMap.get(owner ?? "")?.name ?? null,
        bucket: bucketFor(due, now),
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=rfis&rfiId=${encodeURIComponent(String(r.id))}`
          : `/projects`,
        canEditStatus: false,
        canEditPriority: false,
        canEditDueDate: false,
        canReassign: false,
        isCompleted,
        updatedAt: toIso(r.updatedAt as Date | null),
      });
    }

    for (const i of inspRows as Array<Record<string, unknown>>) {
      const status = String(i.status);
      const isCompleted = INSPECTION_COMPLETED.includes(status);
      const due = toIso((i.dueDate as Date | null) ?? (i.requestedDate as Date | null));
      const code = (i.projectCode as string | null) ?? "";
      const createdById = (i.createdById as string | null) ?? null;
      all.push({
        id: String(i.id),
        type: "INSPECTION",
        title: String(i.title),
        description: (i.description as string | null) ?? null,
        projectId: (i.projectId as string | null) ?? null,
        projectCode: code || null,
        projectName: (i.projectName as string | null) ?? null,
        dueDate: due,
        status,
        priority: null,
        assignedToId: createdById,
        assignedToName: assigneeMap.get(createdById ?? "")?.name ?? null,
        bucket: bucketFor(due, now),
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=inspections&inspectionId=${encodeURIComponent(String(i.id))}`
          : `/projects`,
        canEditStatus: false,
        canEditPriority: false,
        canEditDueDate: false,
        canReassign: false,
        isCompleted,
        updatedAt: toIso(i.updatedAt as Date | null),
      });
    }

    // Status filter
    const filtered = all.filter((it) => {
      if (it.isCompleted && !includeCompleted) return false;
      if (!it.isCompleted && !includeOpen) return false;
      return true;
    });

    // Stable sort: bucket → dueDate asc → updatedAt desc → id (tiebreaker for
    // pagination determinism so offset paging never duplicates or skips rows).
    filtered.sort((a, b) => {
      const ar = bucketRank(a.bucket);
      const br = bucketRank(b.bucket);
      if (ar !== br) return ar - br;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (au !== bu) return bu - au;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    // Offset pagination — stable because the sort above is total-ordered.
    const page = filtered.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextCursor = nextOffset < filtered.length ? String(nextOffset) : null;

    // Counts (over all matching items, not just the current page).
    const counts = {
      total: filtered.length,
      overdue: 0,
      today: 0,
      thisWeek: 0,
      later: 0,
      completedThisWeek: 0,
      byType: { TASK: 0, CRM_TASK: 0, PUNCH: 0, RFI: 0, INSPECTION: 0 } as Record<MyWorkType, number>,
    };
    for (const it of filtered) {
      counts.byType[it.type] += 1;
      if (it.bucket === "overdue") counts.overdue += 1;
      else if (it.bucket === "today") counts.today += 1;
      else if (it.bucket === "thisWeek") counts.thisWeek += 1;
      else if (it.bucket === "later") counts.later += 1;
    }
    for (const it of all) {
      if (!it.isCompleted) continue;
      const ts = it.updatedAt ? new Date(it.updatedAt).getTime() : 0;
      if (ts >= startOfWeek.getTime()) counts.completedThisWeek += 1;
    }

    res.setHeader("Cache-Control", "private, max-age=15");
    res.json({
      userId,
      generatedAt: new Date().toISOString(),
      items: page,
      nextCursor,
      counts,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------
 * Task #898 — My Work saved views (per-user filter+view combinations)
 *
 *   GET    /api/me/work/views        — list mine + team-shared
 *   POST   /api/me/work/views        — create
 *   PATCH  /api/me/work/views/:id    — rename / re-share / overwrite filters
 *   DELETE /api/me/work/views/:id    — delete
 *
 * Stored in the dedicated `my_work_saved_views` table so future My-Work-only
 * options (default grouping, "show team work", etc.) can be added without
 * polluting the org-wide `user_saved_views` schema.
 * ------------------------------------------------------------------ */

const MY_WORK_VIEW_VALUES = ["table", "kanban", "calendar"] as const;

function isAdminRole(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

router.get("/api/me/work/views", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }

    const rows = await db
      .select({
        view: myWorkSavedViews,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
      })
      .from(myWorkSavedViews)
      .leftJoin(users, eq(users.id, myWorkSavedViews.userId))
      .where(and(
        eq(myWorkSavedViews.organizationId, orgId),
        or(
          eq(myWorkSavedViews.userId, userId),
          eq(myWorkSavedViews.isShared, true),
        ),
      ));

    const result = rows.map((r) => {
      const first = (r.creatorFirstName || "").trim();
      const last = (r.creatorLastName || "").trim();
      const fullName = [first, last].filter(Boolean).join(" ");
      const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || null;
      return {
        ...r.view,
        creatorName: fullName || null,
        creatorInitials: initials,
      };
    });
    result.sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

router.post("/api/me/work/views", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const schema = z.object({
      name: z.string().min(1).max(120),
      view: z.enum(MY_WORK_VIEW_VALUES),
      filters: z.record(z.any()).optional(),
      isShared: z.boolean().optional(),
    });
    const parsed = schema.parse(req.body);
    const [created] = await db
      .insert(myWorkSavedViews)
      .values({
        userId,
        organizationId: orgId,
        name: parsed.name,
        view: parsed.view,
        filtersJson: JSON.stringify(parsed.filters || {}),
        isShared: parsed.isShared === true,
      })
      .returning();
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid saved view", details: err.errors });
    }
    return next(err);
  }
});

router.patch("/api/me/work/views/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const { id } = req.params;
    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      isShared: z.boolean().optional(),
      filters: z.record(z.any()).optional(),
      view: z.enum(MY_WORK_VIEW_VALUES).optional(),
    });
    const parsed = schema.parse(req.body);

    const [existing] = await db
      .select()
      .from(myWorkSavedViews)
      .where(and(
        eq(myWorkSavedViews.id, id),
        eq(myWorkSavedViews.organizationId, orgId),
      ))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Saved view not found" });
    }
    if (existing.userId !== userId && !isAdminRole(role)) {
      return res.status(403).json({ error: "Only the creator or an admin can edit this view" });
    }

    const updates: Partial<typeof existing> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.isShared !== undefined) updates.isShared = parsed.isShared;
    if (parsed.view !== undefined) updates.view = parsed.view;
    if (parsed.filters !== undefined) updates.filtersJson = JSON.stringify(parsed.filters);

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    const [updated] = await db
      .update(myWorkSavedViews)
      .set(updates)
      .where(and(
        eq(myWorkSavedViews.id, id),
        eq(myWorkSavedViews.organizationId, orgId),
      ))
      .returning();
    return res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid update", details: err.errors });
    }
    return next(err);
  }
});

router.delete("/api/me/work/views/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const { id } = req.params;
    const [existing] = await db
      .select()
      .from(myWorkSavedViews)
      .where(and(
        eq(myWorkSavedViews.id, id),
        eq(myWorkSavedViews.organizationId, orgId),
      ))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Saved view not found" });
    }
    if (existing.userId !== userId && !isAdminRole(role)) {
      return res.status(403).json({ error: "Only the creator or an admin can delete this view" });
    }
    await db.delete(myWorkSavedViews).where(and(
      eq(myWorkSavedViews.id, id),
      eq(myWorkSavedViews.organizationId, orgId),
    ));
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
