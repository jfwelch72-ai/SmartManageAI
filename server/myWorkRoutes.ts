/**
 * My Work — personal task aggregator
 *
 * GET /api/me/work
 *
 * Returns the current user's work items aggregated across every source
 * (project tasks, CRM tasks, punch items, RFIs, inspection follow-ups).
 *
 * All filters (search, priority, projects, due-date range, status, source)
 * are pushed down into the underlying SQL queries so this endpoint stays
 * fast even when a user has thousands of items. Pagination uses a true
 * per-source keyset cursor — no in-memory offset slicing — so deep pages
 * are O(page) rather than O(offset).
 *
 * Query params:
 *   - source: comma-separated list of source-type filters
 *             (TASK, CRM_TASK, PUNCH, RFI, INSPECTION). Default: all
 *   - status: ALL | OPEN | COMPLETED  (default OPEN)
 *   - search: case-insensitive substring on title/description
 *   - priority: ALL | CRITICAL | HIGH | MEDIUM | NORMAL | LOW
 *   - projects: comma-separated project ids (CRM_TASK is excluded if set)
 *   - dueFrom / dueTo: ISO date strings (YYYY-MM-DD) — bounds on dueDate
 *   - cursor: opaque base64 cursor returned by a previous call
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
import {
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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

const ALL_SOURCES: ReadonlyArray<MyWorkType> = ["TASK", "CRM_TASK", "PUNCH", "RFI", "INSPECTION"];
// Each list must only contain values present in the underlying Postgres enum,
// otherwise inArray/notInArray comparisons fail with
//   "invalid input value for enum …".
// Source enums:
//   ai_task_status         = PENDING, IN_PROGRESS, COMPLETED, DISMISSED
//   punch_list_status      = OPEN, IN_PROGRESS, RESOLVED, VERIFIED, REJECTED
//   crm_tasks.status       = free text (PENDING / IN_PROGRESS / COMPLETED / CANCELLED)
//   rfi_status             = DRAFT, SUBMITTED, UNDER_REVIEW, FORWARDED, ANSWERED, CLOSED
//   inspection_status      = REQUESTED, SCHEDULED, PASSED, FAILED, CANCELLED
const TASK_COMPLETED = ["COMPLETED", "DISMISSED"];
const PUNCH_COMPLETED = ["RESOLVED", "VERIFIED"];
const CRM_COMPLETED = ["COMPLETED", "CANCELLED"];
const RFI_COMPLETED = ["ANSWERED", "CLOSED"];
const INSPECTION_COMPLETED = ["PASSED", "FAILED", "CANCELLED"];

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

function canViewTeamWork(role: string | null | undefined): boolean {
  return !!role && MANAGER_ROLES.has(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers
//
// Sort key (per source and merged): dueDate ASC NULLS LAST, updatedAt DESC, id ASC.
// Cursor is a base64-encoded JSON object { TASK?: Key, CRM_TASK?: Key, ... }
// where Key = { dd: ISO|null, ua: ISO, id: string }. A source omitted from
// the cursor object is exhausted (no more rows). An entry with all-null
// values means "before the first row" (start). When the request has no
// cursor at all, every requested source begins at the start.
// ─────────────────────────────────────────────────────────────────────────────

type CursorKey = { dd: string | null; ua: string; id: string };
// Per-source cursor entry semantics:
//   • CursorKey  → resume strictly after this row
//   • null       → source still active, restart from the beginning
//   • missing    → source is exhausted (do not query again)
type CursorMap = Partial<Record<MyWorkType, CursorKey | null>>;

function decodeCursor(raw: unknown): { exists: boolean; map: CursorMap } {
  if (typeof raw !== "string" || raw.length === 0) return { exists: false, map: {} };
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (!obj || typeof obj !== "object") return { exists: false, map: {} };
    const out: CursorMap = {};
    for (const k of ALL_SOURCES) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = obj[k];
      if (v === null) {
        out[k] = null;
      } else if (
        v && typeof v === "object" &&
        typeof (v as CursorKey).ua === "string" &&
        typeof (v as CursorKey).id === "string"
      ) {
        const ck = v as CursorKey;
        out[k] = { dd: ck.dd ?? null, ua: ck.ua, id: ck.id };
      }
    }
    return { exists: true, map: out };
  } catch {
    return { exists: false, map: {} };
  }
}

function encodeCursor(map: CursorMap): string {
  return Buffer.from(JSON.stringify(map), "utf8").toString("base64");
}

/**
 * Build a keyset WHERE clause matching the global sort
 *   (dueDate ASC NULLS LAST, updatedAt DESC, id ASC)
 * for "rows strictly after the cursor".
 *
 * dueExpr can be a plain column or an arbitrary SQL expression (e.g. COALESCE)
 * — needed for inspections whose due date is COALESCE(scheduledDate, requestedDate).
 */
function buildKeysetWhere(
  dueExpr: SQL | PgColumn,
  updCol: PgColumn,
  idCol: PgColumn,
  key: CursorKey | null | undefined,
): SQL | undefined {
  if (!key) return undefined;
  const ua = new Date(key.ua);
  if (key.dd === null) {
    // Last-seen row had a NULL due date — still in the NULLS LAST partition.
    return and(
      sql`${dueExpr} IS NULL`,
      or(
        lt(updCol, ua),
        and(eq(updCol, ua), gt(idCol, key.id))!,
      )!,
    );
  }
  const dd = new Date(key.dd);
  return or(
    sql`${dueExpr} IS NULL`, // NULL dueDates sort after everything non-null
    sql`${dueExpr} > ${dd}`,
    and(sql`${dueExpr} = ${dd}`, lt(updCol, ua))!,
    and(sql`${dueExpr} = ${dd}`, eq(updCol, ua), gt(idCol, key.id))!,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter parsing
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedFilters {
  search: string | null;     // already lowercased pattern body, no % yet
  priority: string | null;   // uppercased, ALL → null
  projects: string[];        // empty → no project filter
  dueFrom: Date | null;
  dueTo: Date | null;        // inclusive end-of-day
}

function parseFilters(req: AuthRequest): ParsedFilters {
  const search = ((req.query.search as string | undefined) ?? "").trim();
  const priorityRaw = ((req.query.priority as string | undefined) ?? "ALL").toUpperCase();
  const projects = ((req.query.projects as string | undefined) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const dueFromStr = (req.query.dueFrom as string | undefined) ?? "";
  const dueToStr = (req.query.dueTo as string | undefined) ?? "";
  const dueFrom = dueFromStr ? new Date(dueFromStr) : null;
  let dueTo: Date | null = null;
  if (dueToStr) {
    const d = new Date(dueToStr);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      dueTo = d;
    }
  }

  return {
    search: search.length > 0 ? search : null,
    priority: priorityRaw && priorityRaw !== "ALL" ? priorityRaw : null,
    projects,
    dueFrom: dueFrom && !isNaN(dueFrom.getTime()) ? dueFrom : null,
    dueTo,
  };
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

    const teamModeRequested = (req.query.team as string | undefined) === "direct-reports";
    const teamMode = teamModeRequested && canViewTeamWork(userRole);

    const filters = parseFilters(req);
    const cursorIn = decodeCursor(req.query.cursor);

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

    if (teamModeRequested && !teamMode) {
      return res.status(403).json({ error: "team-view permission required" });
    }

    if (mustDenyAccess) {
      res.setHeader("Cache-Control", "private, max-age=15");
      return res.json(emptyResponse);
    }

    const orgFilter = shouldFilter && orgId ? orgId : null;

    // Resolve the assignee scope (self vs. self + direct reports).
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

      assigneeIds = [userId, ...reports.map((u) => u.id).filter((id) => id !== userId)];
      assigneeMap = new Map<string, { name: string | null }>([
        [userId, { name: fullName(me.firstName, me.lastName, me.email) }],
      ]);
      for (const u of reports) {
        assigneeMap.set(u.id, { name: fullName(u.firstName, u.lastName, u.email) });
      }
    }

    const inAssignees = (col: PgColumn): SQL => inArray(col, assigneeIds);

    // Time anchors used for buckets and the completed-this-week count.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);

    // ─── per-source filter builders ────────────────────────────────────────
    // Each returns the WHERE clauses common to "page" and "count" queries
    // (everything except the keyset cursor, which is page-only, and the
    // status filter, which is applied via FILTER on counts).

    const searchPattern = filters.search ? `%${filters.search}%` : null;

    const tasksBaseWhere = (): SQL[] => {
      const w: SQL[] = [inAssignees(tasks.assignedToId)];
      if (orgFilter) w.push(eq(tasks.organizationId, orgFilter));
      if (filters.priority) w.push(eq(tasks.priority, filters.priority as never));
      if (filters.projects.length > 0) w.push(inArray(tasks.projectId, filters.projects));
      if (filters.dueFrom) w.push(gte(tasks.dueDate, filters.dueFrom));
      if (filters.dueTo) w.push(lte(tasks.dueDate, filters.dueTo));
      if (searchPattern) {
        w.push(or(ilike(tasks.title, searchPattern), ilike(tasks.description, searchPattern))!);
      }
      return w;
    };

    const crmBaseWhere = (): SQL[] | null => {
      // CRM tasks have no project — exclude entirely if a project filter is set.
      if (filters.projects.length > 0) return null;
      const w: SQL[] = [inAssignees(crmTasks.assignedToId)];
      if (orgFilter) w.push(eq(crmTasks.organizationId, orgFilter));
      if (filters.priority) w.push(eq(crmTasks.priority, filters.priority));
      if (filters.dueFrom) w.push(gte(crmTasks.dueDate, filters.dueFrom));
      if (filters.dueTo) w.push(lte(crmTasks.dueDate, filters.dueTo));
      if (searchPattern) {
        w.push(or(ilike(crmTasks.title, searchPattern), ilike(crmTasks.description, searchPattern))!);
      }
      return w;
    };

    const punchBaseWhere = (): SQL[] => {
      const w: SQL[] = [inAssignees(punchListItems.assignedToUserId)];
      if (orgFilter) w.push(eq(projects.gcOrganizationId, orgFilter));
      if (filters.priority) w.push(eq(punchListItems.priority, filters.priority as never));
      if (filters.projects.length > 0) w.push(inArray(punchListItems.projectId, filters.projects));
      if (filters.dueFrom) w.push(gte(punchListItems.dueDate, filters.dueFrom));
      if (filters.dueTo) w.push(lte(punchListItems.dueDate, filters.dueTo));
      if (searchPattern) {
        w.push(or(ilike(punchListItems.title, searchPattern), ilike(punchListItems.description, searchPattern))!);
      }
      return w;
    };

    const rfiBaseWhere = (): SQL[] => {
      const w: SQL[] = [or(inAssignees(rfis.assignedToId), inAssignees(rfis.forwardedToId))!];
      if (orgFilter) w.push(eq(rfis.organizationId, orgFilter));
      if (filters.priority) w.push(eq(rfis.priority, filters.priority as never));
      if (filters.projects.length > 0) w.push(inArray(rfis.projectId, filters.projects));
      if (filters.dueFrom) w.push(gte(rfis.dateRequired, filters.dueFrom));
      if (filters.dueTo) w.push(lte(rfis.dateRequired, filters.dueTo));
      if (searchPattern) {
        w.push(or(ilike(rfis.subject, searchPattern), ilike(rfis.question, searchPattern))!);
      }
      return w;
    };

    // Inspections have no priority column.
    const inspBaseWhere = (): SQL[] | null => {
      if (filters.priority) return null;
      const w: SQL[] = [inAssignees(projectInspections.createdById)];
      if (orgFilter) w.push(eq(projects.gcOrganizationId, orgFilter));
      if (filters.projects.length > 0) w.push(inArray(projectInspections.projectId, filters.projects));
      if (filters.dueFrom) {
        w.push(sql`COALESCE(${projectInspections.scheduledDate}, ${projectInspections.requestedDate}) >= ${filters.dueFrom}`);
      }
      if (filters.dueTo) {
        w.push(sql`COALESCE(${projectInspections.scheduledDate}, ${projectInspections.requestedDate}) <= ${filters.dueTo}`);
      }
      if (searchPattern) {
        w.push(or(ilike(projectInspections.title, searchPattern), ilike(projectInspections.description, searchPattern))!);
      }
      return w;
    };

    // ─── per-source paged page queries ─────────────────────────────────────
    // We fetch (limit + 1) per source so we can detect whether more rows
    // exist beyond the candidate window without scanning the whole table.
    const PER_SOURCE_FETCH = limit + 1;
    const FIRST_PAGE = !cursorIn.exists;

    const sourceInCursor = (t: MyWorkType): boolean =>
      Object.prototype.hasOwnProperty.call(cursorIn.map, t);
    const skipSource = (t: MyWorkType): boolean => {
      if (!wantSource(t)) return true;
      // Subsequent pages: a source is exhausted when its cursor is omitted.
      if (cursorIn.exists && !sourceInCursor(t)) return true;
      return false;
    };

    // TASK
    const tasksRowsP = (() => {
      if (skipSource("TASK")) return Promise.resolve([] as Array<Record<string, unknown>>);
      const ks = buildKeysetWhere(tasks.dueDate, tasks.updatedAt, tasks.id, cursorIn.map.TASK);
      const statusW = !includeCompleted
        ? notInArray(tasks.status, TASK_COMPLETED as unknown as string[])
        : !includeOpen
          ? inArray(tasks.status, TASK_COMPLETED as unknown as string[])
          : undefined;
      return db
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
        .where(and(...tasksBaseWhere(), ...(ks ? [ks] : []), ...(statusW ? [statusW] : [])))
        .orderBy(sql`${tasks.dueDate} ASC NULLS LAST`, sql`${tasks.updatedAt} DESC`, sql`${tasks.id} ASC`)
        .limit(PER_SOURCE_FETCH);
    })();

    // CRM_TASK
    const crmRowsP = (() => {
      if (skipSource("CRM_TASK")) return Promise.resolve([] as Array<Record<string, unknown>>);
      const base = crmBaseWhere();
      if (!base) return Promise.resolve([] as Array<Record<string, unknown>>);
      const ks = buildKeysetWhere(crmTasks.dueDate, crmTasks.updatedAt, crmTasks.id, cursorIn.map.CRM_TASK);
      const statusW = !includeCompleted
        ? notInArray(crmTasks.status, CRM_COMPLETED)
        : !includeOpen
          ? inArray(crmTasks.status, CRM_COMPLETED)
          : undefined;
      return db
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
        .where(and(...base, ...(ks ? [ks] : []), ...(statusW ? [statusW] : [])))
        .orderBy(sql`${crmTasks.dueDate} ASC NULLS LAST`, sql`${crmTasks.updatedAt} DESC`, sql`${crmTasks.id} ASC`)
        .limit(PER_SOURCE_FETCH);
    })();

    // PUNCH
    const punchRowsP = (() => {
      if (skipSource("PUNCH")) return Promise.resolve([] as Array<Record<string, unknown>>);
      const ks = buildKeysetWhere(punchListItems.dueDate, punchListItems.updatedAt, punchListItems.id, cursorIn.map.PUNCH);
      const statusW = !includeCompleted
        ? notInArray(punchListItems.status, PUNCH_COMPLETED as unknown as string[])
        : !includeOpen
          ? inArray(punchListItems.status, PUNCH_COMPLETED as unknown as string[])
          : undefined;
      return db
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
        .where(and(...punchBaseWhere(), ...(ks ? [ks] : []), ...(statusW ? [statusW] : [])))
        .orderBy(sql`${punchListItems.dueDate} ASC NULLS LAST`, sql`${punchListItems.updatedAt} DESC`, sql`${punchListItems.id} ASC`)
        .limit(PER_SOURCE_FETCH);
    })();

    // RFI
    const rfiRowsP = (() => {
      if (skipSource("RFI")) return Promise.resolve([] as Array<Record<string, unknown>>);
      const ks = buildKeysetWhere(rfis.dateRequired, rfis.updatedAt, rfis.id, cursorIn.map.RFI);
      const statusW = !includeCompleted
        ? notInArray(rfis.status, RFI_COMPLETED as unknown as string[])
        : !includeOpen
          ? inArray(rfis.status, RFI_COMPLETED as unknown as string[])
          : undefined;
      return db
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
        .where(and(...rfiBaseWhere(), ...(ks ? [ks] : []), ...(statusW ? [statusW] : [])))
        .orderBy(sql`${rfis.dateRequired} ASC NULLS LAST`, sql`${rfis.updatedAt} DESC`, sql`${rfis.id} ASC`)
        .limit(PER_SOURCE_FETCH);
    })();

    // INSPECTION (due date is COALESCE(scheduledDate, requestedDate))
    const inspDueExpr = sql<Date>`COALESCE(${projectInspections.scheduledDate}, ${projectInspections.requestedDate})`;
    const inspRowsP = (() => {
      if (skipSource("INSPECTION")) return Promise.resolve([] as Array<Record<string, unknown>>);
      const base = inspBaseWhere();
      if (!base) return Promise.resolve([] as Array<Record<string, unknown>>);
      const ks = buildKeysetWhere(inspDueExpr, projectInspections.updatedAt, projectInspections.id, cursorIn.map.INSPECTION);
      const statusW = !includeCompleted
        ? notInArray(projectInspections.status, INSPECTION_COMPLETED as unknown as string[])
        : !includeOpen
          ? inArray(projectInspections.status, INSPECTION_COMPLETED as unknown as string[])
          : undefined;
      return db
        .select({
          id: projectInspections.id,
          title: projectInspections.title,
          description: projectInspections.description,
          status: projectInspections.status,
          dueDate: inspDueExpr,
          createdById: projectInspections.createdById,
          projectId: projectInspections.projectId,
          projectCode: projects.code,
          projectName: projects.name,
          updatedAt: projectInspections.updatedAt,
        })
        .from(projectInspections)
        .leftJoin(projects, eq(projectInspections.projectId, projects.id))
        .where(and(...base, ...(ks ? [ks] : []), ...(statusW ? [statusW] : [])))
        .orderBy(sql`${inspDueExpr} ASC NULLS LAST`, sql`${projectInspections.updatedAt} DESC`, sql`${projectInspections.id} ASC`)
        .limit(PER_SOURCE_FETCH);
    })();

    // ─── per-source count queries (only on the first page) ─────────────────
    // Page-2+ requests reuse the counts the client already has, so we skip
    // the (relatively expensive) aggregation work entirely on those calls.

    type CountRow = {
      total: number;
      overdue: number;
      today: number;
      thisWeek: number;
      later: number;
      completedThisWeek: number;
    };
    const ZERO_COUNT: CountRow = { total: 0, overdue: 0, today: 0, thisWeek: 0, later: 0, completedThisWeek: 0 };

    function statusMatchExpr(statusCol: PgColumn, completedList: string[]): SQL {
      if (statusParam === "OPEN") return sql`${statusCol} NOT IN (${sql.join(completedList.map((s) => sql`${s}`), sql`, `)})`;
      if (statusParam === "COMPLETED") return sql`${statusCol} IN (${sql.join(completedList.map((s) => sql`${s}`), sql`, `)})`;
      return sql`TRUE`;
    }

    function isCompletedExpr(statusCol: PgColumn, completedList: string[]): SQL {
      return sql`${statusCol} IN (${sql.join(completedList.map((s) => sql`${s}`), sql`, `)})`;
    }

    async function countTasks(): Promise<CountRow> {
      if (!wantSource("TASK")) return ZERO_COUNT;
      const matches = statusMatchExpr(tasks.status, TASK_COMPLETED);
      const completed = isCompletedExpr(tasks.status, TASK_COMPLETED);
      const dd = tasks.dueDate;
      const r = await db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${matches})::int`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} < ${startOfToday})::int`,
          today: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${startOfToday} AND ${dd} < ${endOfToday})::int`,
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfToday} AND ${dd} < ${endOfWeek})::int`,
          later: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfWeek})::int`,
          completedThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${completed} AND ${tasks.updatedAt} >= ${startOfWeek})::int`,
        })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(...tasksBaseWhere()));
      return r[0] ?? ZERO_COUNT;
    }

    async function countCrm(): Promise<CountRow> {
      if (!wantSource("CRM_TASK")) return ZERO_COUNT;
      const base = crmBaseWhere();
      if (!base) return ZERO_COUNT;
      const matches = statusMatchExpr(crmTasks.status, CRM_COMPLETED);
      const completed = isCompletedExpr(crmTasks.status, CRM_COMPLETED);
      const dd = crmTasks.dueDate;
      const r = await db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${matches})::int`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} < ${startOfToday})::int`,
          today: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${startOfToday} AND ${dd} < ${endOfToday})::int`,
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfToday} AND ${dd} < ${endOfWeek})::int`,
          later: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfWeek})::int`,
          completedThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${completed} AND ${crmTasks.updatedAt} >= ${startOfWeek})::int`,
        })
        .from(crmTasks)
        .where(and(...base));
      return r[0] ?? ZERO_COUNT;
    }

    async function countPunch(): Promise<CountRow> {
      if (!wantSource("PUNCH")) return ZERO_COUNT;
      const matches = statusMatchExpr(punchListItems.status, PUNCH_COMPLETED);
      const completed = isCompletedExpr(punchListItems.status, PUNCH_COMPLETED);
      const dd = punchListItems.dueDate;
      const r = await db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${matches})::int`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} < ${startOfToday})::int`,
          today: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${startOfToday} AND ${dd} < ${endOfToday})::int`,
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfToday} AND ${dd} < ${endOfWeek})::int`,
          later: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfWeek})::int`,
          completedThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${completed} AND ${punchListItems.updatedAt} >= ${startOfWeek})::int`,
        })
        .from(punchListItems)
        .leftJoin(projects, eq(punchListItems.projectId, projects.id))
        .where(and(...punchBaseWhere()));
      return r[0] ?? ZERO_COUNT;
    }

    async function countRfi(): Promise<CountRow> {
      if (!wantSource("RFI")) return ZERO_COUNT;
      const matches = statusMatchExpr(rfis.status, RFI_COMPLETED);
      const completed = isCompletedExpr(rfis.status, RFI_COMPLETED);
      const dd = rfis.dateRequired;
      const r = await db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${matches})::int`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} < ${startOfToday})::int`,
          today: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${startOfToday} AND ${dd} < ${endOfToday})::int`,
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfToday} AND ${dd} < ${endOfWeek})::int`,
          later: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfWeek})::int`,
          completedThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${completed} AND ${rfis.updatedAt} >= ${startOfWeek})::int`,
        })
        .from(rfis)
        .leftJoin(projects, eq(rfis.projectId, projects.id))
        .where(and(...rfiBaseWhere()));
      return r[0] ?? ZERO_COUNT;
    }

    async function countInsp(): Promise<CountRow> {
      if (!wantSource("INSPECTION")) return ZERO_COUNT;
      const base = inspBaseWhere();
      if (!base) return ZERO_COUNT;
      const matches = statusMatchExpr(projectInspections.status, INSPECTION_COMPLETED);
      const completed = isCompletedExpr(projectInspections.status, INSPECTION_COMPLETED);
      const dd = inspDueExpr;
      const r = await db
        .select({
          total: sql<number>`COUNT(*) FILTER (WHERE ${matches})::int`,
          overdue: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} < ${startOfToday})::int`,
          today: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${startOfToday} AND ${dd} < ${endOfToday})::int`,
          thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfToday} AND ${dd} < ${endOfWeek})::int`,
          later: sql<number>`COUNT(*) FILTER (WHERE ${matches} AND ${dd} >= ${endOfWeek})::int`,
          completedThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${completed} AND ${projectInspections.updatedAt} >= ${startOfWeek})::int`,
        })
        .from(projectInspections)
        .leftJoin(projects, eq(projectInspections.projectId, projects.id))
        .where(and(...base));
      return r[0] ?? ZERO_COUNT;
    }

    const countsP: Promise<[CountRow, CountRow, CountRow, CountRow, CountRow]> = FIRST_PAGE
      ? Promise.all([countTasks(), countCrm(), countPunch(), countRfi(), countInsp()])
      : Promise.resolve([ZERO_COUNT, ZERO_COUNT, ZERO_COUNT, ZERO_COUNT, ZERO_COUNT]);

    const [tasksRows, crmRows, punchRows, rfiRows, inspRows, countRows] = await Promise.all([
      tasksRowsP,
      crmRowsP,
      punchRowsP,
      rfiRowsP,
      inspRowsP,
      countsP,
    ]);

    // ─── map rows → MyWorkItem (carrying the sort key) ─────────────────────
    type Candidate = MyWorkItem & { _key: CursorKey };
    const editableInPersonalView = !teamMode;

    const candidates: Candidate[] = [];

    const asDate = (v: unknown): Date | null => {
      if (v == null) return null;
      if (v instanceof Date) return v;
      const d = new Date(v as string);
      return isNaN(d.getTime()) ? null : d;
    };
    function pushCandidate(it: MyWorkItem, dueRaw: Date | string | null, updRaw: Date | string | null) {
      const upd = asDate(updRaw) ?? new Date(0);
      const due = asDate(dueRaw);
      candidates.push({
        ...it,
        _key: { dd: due ? due.toISOString() : null, ua: upd.toISOString(), id: it.id },
      });
    }

    for (const t of tasksRows as Array<Record<string, unknown>>) {
      const status = String(t.status);
      const isCompleted = TASK_COMPLETED.includes(status);
      const due = (t.dueDate as Date | null) ?? null;
      const upd = (t.updatedAt as Date | null) ?? (t.completedAt as Date | null) ?? null;
      const dueIso = toIso(due);
      const assignedToId = (t.assignedToId as string | null) ?? null;
      pushCandidate({
        id: String(t.id),
        type: "TASK",
        title: String(t.title),
        description: (t.description as string | null) ?? null,
        projectId: (t.projectId as string | null) ?? null,
        projectCode: (t.projectCode as string | null) ?? null,
        projectName: (t.projectName as string | null) ?? null,
        dueDate: dueIso,
        status,
        priority: (t.priority as string | null) ?? null,
        assignedToId,
        assignedToName: assigneeMap.get(assignedToId ?? "")?.name ?? null,
        bucket: bucketFor(dueIso, now),
        sourceUrl: `/tasks?taskId=${encodeURIComponent(String(t.id))}`,
        canEditStatus: editableInPersonalView,
        canEditPriority: editableInPersonalView,
        canEditDueDate: editableInPersonalView,
        canReassign: editableInPersonalView,
        isCompleted,
        updatedAt: toIso(upd),
      }, due, t.updatedAt as Date | null);
    }

    for (const c of crmRows as Array<Record<string, unknown>>) {
      const status = String(c.status);
      const isCompleted = CRM_COMPLETED.includes(status);
      const due = (c.dueDate as Date | null) ?? null;
      const dueIso = toIso(due);
      const assignedToId = (c.assignedToId as string | null) ?? null;
      const opportunityId = (c.opportunityId as string | null) ?? null;
      pushCandidate({
        id: String(c.id),
        type: "CRM_TASK",
        title: String(c.title),
        description: (c.description as string | null) ?? null,
        projectId: null,
        projectCode: null,
        projectName: opportunityId ? "CRM Deal" : "CRM",
        dueDate: dueIso,
        status,
        priority: (c.priority as string | null) ?? null,
        assignedToId,
        assignedToName: assigneeMap.get(assignedToId ?? "")?.name ?? null,
        bucket: bucketFor(dueIso, now),
        sourceUrl: opportunityId ? `/crm/deals/${encodeURIComponent(opportunityId)}` : `/crm`,
        canEditStatus: editableInPersonalView,
        canEditPriority: editableInPersonalView,
        canEditDueDate: editableInPersonalView,
        canReassign: editableInPersonalView,
        isCompleted,
        updatedAt: toIso((c.updatedAt as Date | null) ?? (c.completedAt as Date | null)),
      }, due, c.updatedAt as Date | null);
    }

    for (const p of punchRows as Array<Record<string, unknown>>) {
      const status = String(p.status);
      const isCompleted = PUNCH_COMPLETED.includes(status);
      const due = (p.dueDate as Date | null) ?? null;
      const dueIso = toIso(due);
      const code = (p.projectCode as string | null) ?? "";
      const assignedToUserId = (p.assignedToUserId as string | null) ?? null;
      pushCandidate({
        id: String(p.id),
        type: "PUNCH",
        title: String(p.title),
        description: (p.description as string | null) ?? null,
        projectId: (p.projectId as string | null) ?? null,
        projectCode: code || null,
        projectName: (p.projectName as string | null) ?? null,
        dueDate: dueIso,
        status,
        priority: (p.priority as string | null) ?? null,
        assignedToId: assignedToUserId,
        assignedToName: assigneeMap.get(assignedToUserId ?? "")?.name ?? null,
        bucket: bucketFor(dueIso, now),
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=punch-list&itemId=${encodeURIComponent(String(p.id))}`
          : `/projects`,
        canEditStatus: editableInPersonalView,
        canEditPriority: editableInPersonalView,
        canEditDueDate: editableInPersonalView,
        canReassign: false,
        isCompleted,
        updatedAt: toIso(p.updatedAt as Date | null),
      }, due, p.updatedAt as Date | null);
    }

    for (const r of rfiRows as Array<Record<string, unknown>>) {
      const status = String(r.status);
      const isCompleted = RFI_COMPLETED.includes(status);
      const due = (r.dueDate as Date | null) ?? null;
      const dueIso = toIso(due);
      const code = (r.projectCode as string | null) ?? "";
      const owner = (r.assignedToId as string | null) ?? (r.forwardedToId as string | null) ?? null;
      pushCandidate({
        id: String(r.id),
        type: "RFI",
        title: String(r.subject),
        description: (r.question as string | null) ?? null,
        projectId: (r.projectId as string | null) ?? null,
        projectCode: code || null,
        projectName: (r.projectName as string | null) ?? null,
        dueDate: dueIso,
        status,
        priority: (r.priority as string | null) ?? null,
        assignedToId: owner,
        assignedToName: assigneeMap.get(owner ?? "")?.name ?? null,
        bucket: bucketFor(dueIso, now),
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=rfis&rfiId=${encodeURIComponent(String(r.id))}`
          : `/projects`,
        canEditStatus: false,
        canEditPriority: false,
        canEditDueDate: false,
        canReassign: false,
        isCompleted,
        updatedAt: toIso(r.updatedAt as Date | null),
      }, due, r.updatedAt as Date | null);
    }

    for (const i of inspRows as Array<Record<string, unknown>>) {
      const status = String(i.status);
      const isCompleted = INSPECTION_COMPLETED.includes(status);
      const due = (i.dueDate as Date | null) ?? null;
      const dueIso = toIso(due);
      const code = (i.projectCode as string | null) ?? "";
      const createdById = (i.createdById as string | null) ?? null;
      pushCandidate({
        id: String(i.id),
        type: "INSPECTION",
        title: String(i.title),
        description: (i.description as string | null) ?? null,
        projectId: (i.projectId as string | null) ?? null,
        projectCode: code || null,
        projectName: (i.projectName as string | null) ?? null,
        dueDate: dueIso,
        status,
        priority: null,
        assignedToId: createdById,
        assignedToName: assigneeMap.get(createdById ?? "")?.name ?? null,
        bucket: bucketFor(dueIso, now),
        sourceUrl: code
          ? `/projects/${encodeURIComponent(code)}?tab=inspections&inspectionId=${encodeURIComponent(String(i.id))}`
          : `/projects`,
        canEditStatus: false,
        canEditPriority: false,
        canEditDueDate: false,
        canReassign: false,
        isCompleted,
        updatedAt: toIso(i.updatedAt as Date | null),
      }, due, i.updatedAt as Date | null);
    }

    // Track per-source fetch sizes for cursor advancement.
    const fetchedBySource: Record<MyWorkType, number> = {
      TASK: tasksRows.length,
      CRM_TASK: crmRows.length,
      PUNCH: punchRows.length,
      RFI: rfiRows.length,
      INSPECTION: inspRows.length,
    };

    // Drop the +1 sentinel candidate per source — we only consider the
    // first `limit` rows from each source as eligible for the page.
    // (Without this, the cursor would advance past unseen rows.)
    const eligible: Candidate[] = [];
    const counter: Record<MyWorkType, number> = { TASK: 0, CRM_TASK: 0, PUNCH: 0, RFI: 0, INSPECTION: 0 };
    for (const c of candidates) {
      if (counter[c.type] < limit) {
        eligible.push(c);
        counter[c.type] += 1;
      }
    }

    // Stable merge sort: dueDate ASC NULLS LAST, updatedAt DESC, id ASC.
    eligible.sort((a, b) => {
      const ad = a._key.dd;
      const bd = b._key.dd;
      if (ad === null && bd !== null) return 1;
      if (ad !== null && bd === null) return -1;
      if (ad !== null && bd !== null) {
        const at = new Date(ad).getTime();
        const bt = new Date(bd).getTime();
        if (at !== bt) return at - bt;
      }
      const au = new Date(a._key.ua).getTime();
      const bu = new Date(b._key.ua).getTime();
      if (au !== bu) return bu - au;
      return a._key.id < b._key.id ? -1 : a._key.id > b._key.id ? 1 : 0;
    });

    const page = eligible.slice(0, limit);

    // Build next cursor: per source, advance to the last row that landed in
    // the page (so the next call resumes right after it). A source that we
    // queried but whose entire result set fits before the page boundary is
    // exhausted and gets dropped from the cursor.
    const nextCursorMap: CursorMap = {};
    let anyHasMore = false;

    const lastTakenByType: Partial<Record<MyWorkType, CursorKey>> = {};
    const takenByType: Record<MyWorkType, number> = { TASK: 0, CRM_TASK: 0, PUNCH: 0, RFI: 0, INSPECTION: 0 };
    for (const c of page) {
      lastTakenByType[c.type] = c._key;
      takenByType[c.type] += 1;
    }

    for (const t of ALL_SOURCES) {
      if (!wantSource(t)) continue;
      // Source was already exhausted on a prior page — stays exhausted.
      if (cursorIn.exists && !sourceInCursor(t)) continue;

      const fetched = fetchedBySource[t];
      const taken = takenByType[t];

      // Source returned nothing this round → exhausted.
      if (fetched === 0) continue;

      // We fetched fewer than the +1 sentinel and consumed every row → done.
      if (fetched < PER_SOURCE_FETCH && taken === fetched) continue;

      const last = lastTakenByType[t];
      if (last) {
        // Advance past the last row that made it into the page.
        nextCursorMap[t] = last;
      } else {
        // Source had rows fetched but none landed in this page (a busier
        // source monopolized the slots). Keep the source active and resume
        // from the same starting position next time. `null` here means
        // "still active, restart from the source's previous cursor".
        // Falling back to the incoming cursor preserves correctness when
        // we already advanced past some rows on a prior page.
        const prev = cursorIn.map[t];
        nextCursorMap[t] = prev ?? null;
      }
      anyHasMore = true;
    }

    const nextCursor = anyHasMore ? encodeCursor(nextCursorMap) : null;

    // ─── aggregate counts ──────────────────────────────────────────────────
    const counts = {
      total: 0,
      overdue: 0,
      today: 0,
      thisWeek: 0,
      later: 0,
      completedThisWeek: 0,
      byType: { TASK: 0, CRM_TASK: 0, PUNCH: 0, RFI: 0, INSPECTION: 0 } as Record<MyWorkType, number>,
    };
    if (FIRST_PAGE) {
      const [tc, cc, pc, rc, ic] = countRows;
      const all: Array<[MyWorkType, CountRow]> = [
        ["TASK", tc],
        ["CRM_TASK", cc],
        ["PUNCH", pc],
        ["RFI", rc],
        ["INSPECTION", ic],
      ];
      for (const [t, row] of all) {
        counts.byType[t] = row.total;
        counts.total += row.total;
        counts.overdue += row.overdue;
        counts.today += row.today;
        counts.thisWeek += row.thisWeek;
        counts.later += row.later;
        counts.completedThisWeek += row.completedThisWeek;
      }
    }

    // Strip internal _key before sending.
    const items: MyWorkItem[] = page.map(({ _key: _k, ...rest }) => rest);

    res.setHeader("Cache-Control", "private, max-age=15");
    res.json({
      userId,
      generatedAt: new Date().toISOString(),
      items,
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
const MY_WORK_GROUPING_VALUES = ["none", "project", "status", "due-week"] as const;
// `null` is allowed so a saved view can explicitly carry "no preference" and
// fall back to the user's local default. The empty string is normalized to
// null to keep the column tidy.
const groupingSchema = z
  .enum(MY_WORK_GROUPING_VALUES)
  .nullable()
  .or(z.literal(""));
function normalizeGrouping(g: unknown): string | null | undefined {
  if (g === undefined) return undefined;
  if (g === null || g === "") return null;
  return g as string;
}

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
      grouping: groupingSchema.optional(),
    });
    const parsed = schema.parse(req.body);
    const grouping = normalizeGrouping(parsed.grouping);
    const [created] = await db
      .insert(myWorkSavedViews)
      .values({
        userId,
        organizationId: orgId,
        name: parsed.name,
        view: parsed.view,
        filtersJson: JSON.stringify(parsed.filters || {}),
        isShared: parsed.isShared === true,
        grouping: grouping ?? null,
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
      grouping: groupingSchema.optional(),
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
    if (parsed.grouping !== undefined) updates.grouping = normalizeGrouping(parsed.grouping) ?? null;

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
