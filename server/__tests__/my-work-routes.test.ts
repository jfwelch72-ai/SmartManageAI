/**
 * Task #910 — load coverage for GET /api/me/work.
 *
 * Seeds thousands of mixed work items (project tasks, CRM tasks, punch items,
 * RFIs, inspections) for a manager + direct reports, then exercises the
 * cursor-paged endpoint end-to-end. Locks in:
 *   - exhaustive cursor walk (every page, no duplicates, sorted globally)
 *   - filter pushdown (search / priority / projects / dueFrom-dueTo / status / source)
 *   - manager team-view aggregation
 *   - first-page latency (loose ceiling) so future N+1 / full-scan regressions surface
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  tasks,
  crmTasks,
  punchListItems,
  rfis,
  projectInspections,
} from "@shared/schema";
import { generateToken } from "../auth";

const SLUG_PREFIX = "__mywork_load_test__";
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SEARCH_NEEDLE = `needle${SUFFIX.replace(/[^a-z0-9]/gi, "")}`;

interface ExpectedCounts {
  perTypeOpen: { TASK: number; CRM_TASK: number; PUNCH: number; RFI: number; INSPECTION: number };
  managerOpenTotal: number;
  managerCompletedTotal: number;
  highPriorityOpen: number;
  projectAOpen: number;
  searchOpen: number;
  dueWindowOpen: number;
  teamOpenTotal: number;
}

interface SeedResult {
  orgId: string;
  managerId: string;
  managerToken: string;
  reportIds: string[];
  projectIds: string[];
  expected: ExpectedCounts;
}

let app: Express;
let server: Server;
let seed: SeedResult;

type InsertableTable<TRow> = PgTable & {
  $inferInsert: TRow;
};

async function bulkInsert<TRow extends Record<string, unknown>>(
  table: InsertableTable<TRow>,
  rows: TRow[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    if (slice.length === 0) continue;
    await db.insert(table).values(slice);
  }
}

function dayOffset(days: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

const TASK_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"] as const;
const PUNCH_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "VERIFIED", "REJECTED"] as const;
const RFI_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ANSWERED", "CLOSED"] as const;
const INSP_STATUSES = ["REQUESTED", "SCHEDULED", "PASSED", "FAILED"] as const;
const CRM_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

async function seedLoadFixture(): Promise<SeedResult> {
  const passwordHash = await bcrypt.hash("LoadTest123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `MyWork Load Org ${SUFFIX}`,
      slug: `${SLUG_PREFIX}${SUFFIX}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [manager] = await db
    .insert(users)
    .values({
      email: `mywork-mgr-${SUFFIX}@test.local`,
      passwordHash,
      firstName: "Load",
      lastName: "Manager",
      role: "MANAGER",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const reportRows = await db
    .insert(users)
    .values([
      {
        email: `mywork-rep1-${SUFFIX}@test.local`,
        passwordHash,
        firstName: "Report",
        lastName: "One",
        role: "FIELD_WORKER",
        organizationId: org.id,
        managerId: manager.id,
        isActive: true,
      },
      {
        email: `mywork-rep2-${SUFFIX}@test.local`,
        passwordHash,
        firstName: "Report",
        lastName: "Two",
        role: "FIELD_WORKER",
        organizationId: org.id,
        managerId: manager.id,
        isActive: true,
      },
    ])
    .returning();

  const reportIds = reportRows.map((u) => u.id);

  const projectRows = await db
    .insert(projects)
    .values([
      {
        name: `Load Project A ${SUFFIX}`,
        code: `LP-A-${SUFFIX}`,
        clientName: "Acme",
        gcOrganizationId: org.id,
        status: "ACTIVE",
      },
      {
        name: `Load Project B ${SUFFIX}`,
        code: `LP-B-${SUFFIX}`,
        clientName: "Acme",
        gcOrganizationId: org.id,
        status: "ACTIVE",
      },
    ])
    .returning();

  const projectIds = projectRows.map((p) => p.id);

  const TASK_COUNT = 600;
  const CRM_COUNT = 500;
  const PUNCH_COUNT = 500;
  const RFI_COUNT = 400;
  const INSP_COUNT = 400;

  // Force unique ms-precision updatedAt per row so the route's cursor (which
  // serializes ISO strings, losing PG's microsecond precision) can perfectly
  // round-trip the keyset across pages. Without this, rows that share a
  // microsecond-level updatedAt within a single bulk INSERT silently get
  // skipped on subsequent pages.
  const updatedBase = Date.now() - 1_000_000;
  const stamp = (offset: number): Date => new Date(updatedBase + offset);

  const taskRows: Array<typeof tasks.$inferInsert> = [];
  for (let i = 0; i < TASK_COUNT; i++) {
    // 4 of every 5 manager (i%5!=0 → manager). Reports get the rest.
    const assignee = i % 5 === 0 ? reportIds[i % reportIds.length] : manager.id;
    const status = TASK_STATUSES[i % TASK_STATUSES.length];
    const priority = TASK_PRIORITIES[i % TASK_PRIORITIES.length];
    const projectId = projectIds[i % projectIds.length];
    const dueDate = i % 17 === 0 ? null : dayOffset((i % 120) - 30);
    // Sprinkle the search needle across both manager- and report-assigned items.
    const titleHasNeedle = i % 23 === 1;
    const title = titleHasNeedle ? `Task ${SEARCH_NEEDLE} ${i}` : `Task ${i} ${SUFFIX}`;
    taskRows.push({
      organizationId: org.id,
      projectId,
      title,
      description: `desc-${i}`,
      priority,
      status,
      createdById: manager.id,
      assignedToId: assignee,
      dueDate,
      completedAt: status === "COMPLETED" ? dayOffset(-1) : null,
      updatedAt: stamp(i),
    });
  }
  await bulkInsert(tasks, taskRows);

  const crmRows: Array<typeof crmTasks.$inferInsert> = [];
  for (let i = 0; i < CRM_COUNT; i++) {
    const assignee = i % 4 === 0 ? reportIds[i % reportIds.length] : manager.id;
    const status = CRM_STATUSES[i % CRM_STATUSES.length];
    const priority = ["CRITICAL", "HIGH", "MEDIUM", "NORMAL", "LOW"][i % 5];
    const dueDate = dayOffset((i % 90) - 15);
    crmRows.push({
      organizationId: org.id,
      title: `CRM Task ${i} ${SUFFIX}`,
      description: `crm-desc-${i}`,
      dueDate,
      status,
      priority,
      assignedToId: assignee,
      createdById: manager.id,
      updatedAt: stamp(TASK_COUNT + i),
    });
  }
  await bulkInsert(crmTasks, crmRows);

  const punchRows: Array<typeof punchListItems.$inferInsert> = [];
  for (let i = 0; i < PUNCH_COUNT; i++) {
    const assignee = i % 6 === 0 ? reportIds[i % reportIds.length] : manager.id;
    const status = PUNCH_STATUSES[i % PUNCH_STATUSES.length];
    const priority = (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const)[i % 4];
    const projectId = projectIds[i % projectIds.length];
    const dueDate = i % 13 === 0 ? null : dayOffset((i % 100) - 10);
    punchRows.push({
      projectId,
      itemNumber: `PLI-${SUFFIX}-${i}`,
      title: `Punch ${i} ${SUFFIX}`,
      description: `punch-desc-${i}`,
      trade: "GENERAL",
      priority,
      status,
      assignedToUserId: assignee,
      dueDate,
      createdById: manager.id,
      updatedAt: stamp(TASK_COUNT + CRM_COUNT + i),
    });
  }
  await bulkInsert(punchListItems, punchRows);

  const rfiRows: Array<typeof rfis.$inferInsert> = [];
  for (let i = 0; i < RFI_COUNT; i++) {
    const assignee = i % 7 === 0 ? reportIds[i % reportIds.length] : manager.id;
    const status = RFI_STATUSES[i % RFI_STATUSES.length];
    const priority = (["LOW", "MEDIUM", "HIGH", "URGENT"] as const)[i % 4];
    const projectId = projectIds[i % projectIds.length];
    const dueDate = i % 11 === 0 ? null : dayOffset((i % 80) - 5);
    rfiRows.push({
      organizationId: org.id,
      projectId,
      rfiNumber: `RFI-${SUFFIX}-${i}`,
      subject: `RFI subject ${i} ${SUFFIX}`,
      question: `RFI question ${i} ${SUFFIX}`,
      status,
      priority,
      submittedById: manager.id,
      assignedToId: assignee,
      dateRequired: dueDate,
      updatedAt: stamp(TASK_COUNT + CRM_COUNT + PUNCH_COUNT + i),
    });
  }
  await bulkInsert(rfis, rfiRows);

  const inspRows: Array<typeof projectInspections.$inferInsert> = [];
  for (let i = 0; i < INSP_COUNT; i++) {
    const creator = i % 8 === 0 ? reportIds[i % reportIds.length] : manager.id;
    const status = INSP_STATUSES[i % INSP_STATUSES.length];
    const projectId = projectIds[i % projectIds.length];
    const requestedDate = dayOffset((i % 70) - 5);
    const scheduledDate = i % 3 === 0 ? null : dayOffset((i % 70) - 4);
    inspRows.push({
      projectId,
      inspectionNumber: `INSP-${SUFFIX}-${i}`,
      inspectionType: "CITY_OFFICIAL",
      title: `Inspection ${i} ${SUFFIX}`,
      description: `insp-desc-${i}`,
      requestedDate,
      scheduledDate,
      status,
      createdById: creator,
      updatedAt: stamp(TASK_COUNT + CRM_COUNT + PUNCH_COUNT + RFI_COUNT + i),
    });
  }
  await bulkInsert(projectInspections, inspRows);

  // Derive expected counts from the actual seeded rows so the assertions
  // are anchored to ground truth (not to easily-miscounted predictions).
  const expected = await deriveExpectedCounts(
    org.id,
    manager.id,
    reportIds,
    projectIds[0],
  );

  return {
    orgId: org.id,
    managerId: manager.id,
    managerToken: generateToken(manager.id, manager.tokenVersion ?? 0),
    reportIds,
    projectIds,
    expected,
  };
}

async function deriveExpectedCounts(
  orgId: string,
  managerId: string,
  reportIds: string[],
  projectAId: string,
): Promise<ExpectedCounts> {
  // Status predicates mirror the route. Repeated inline for joined queries
  // because SQL fragments cannot be safely prefixed with an alias post-hoc.
  const taskOpenSql = sql`status NOT IN ('COMPLETED','DISMISSED')`;
  const crmOpenSql = sql`status NOT IN ('COMPLETED','CANCELLED')`;
  const punchOpenSql = sql`status NOT IN ('RESOLVED','VERIFIED')`;
  const punchOpenSqlP = sql`p.status NOT IN ('RESOLVED','VERIFIED')`;
  const rfiOpenSql = sql`status NOT IN ('ANSWERED','CLOSED')`;
  const inspOpenSql = sql`status NOT IN ('PASSED','FAILED','CANCELLED')`;
  const inspOpenSqlI = sql`i.status NOT IN ('PASSED','FAILED','CANCELLED')`;

  async function scalar(query: SQL): Promise<number> {
    const result = await db.execute<{ n: number | string }>(query);
    const first = result.rows[0];
    return first ? Number(first.n) : 0;
  }

  const taskOpen = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${taskOpenSql}`);
  const crmOpen = await scalar(sql`SELECT COUNT(*)::int AS n FROM crm_tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${crmOpenSql}`);
  const punchOpen = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM punch_list_items p
    JOIN projects pr ON pr.id = p.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND p.assigned_to_user_id = ${managerId}
      AND ${punchOpenSqlP}
  `);
  const rfiOpen = await scalar(sql`SELECT COUNT(*)::int AS n FROM rfis WHERE organization_id = ${orgId} AND (assigned_to_id = ${managerId} OR forwarded_to_id = ${managerId}) AND ${rfiOpenSql}`);
  const inspOpen = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM project_inspections i
    JOIN projects pr ON pr.id = i.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND i.created_by_id = ${managerId}
      AND ${inspOpenSqlI}
  `);

  const managerOpenTotal = taskOpen + crmOpen + punchOpen + rfiOpen + inspOpen;

  // Completed/dismissed-equivalent for each source.
  const taskDone = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND status IN ('COMPLETED','DISMISSED')`);
  const crmDone = await scalar(sql`SELECT COUNT(*)::int AS n FROM crm_tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND status IN ('COMPLETED','CANCELLED')`);
  const punchDone = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM punch_list_items p
    JOIN projects pr ON pr.id = p.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND p.assigned_to_user_id = ${managerId}
      AND p.status IN ('RESOLVED','VERIFIED')
  `);
  const rfiDone = await scalar(sql`SELECT COUNT(*)::int AS n FROM rfis WHERE organization_id = ${orgId} AND (assigned_to_id = ${managerId} OR forwarded_to_id = ${managerId}) AND status IN ('ANSWERED','CLOSED')`);
  const inspDone = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM project_inspections i
    JOIN projects pr ON pr.id = i.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND i.created_by_id = ${managerId}
      AND i.status IN ('PASSED','FAILED','CANCELLED')
  `);

  // HIGH priority: tasks/crm/punch/rfi (inspections excluded by the route).
  const highTask = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${taskOpenSql} AND priority = 'HIGH'`);
  const highCrm = await scalar(sql`SELECT COUNT(*)::int AS n FROM crm_tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${crmOpenSql} AND priority = 'HIGH'`);
  const highPunch = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM punch_list_items p
    JOIN projects pr ON pr.id = p.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND p.assigned_to_user_id = ${managerId}
      AND ${punchOpenSqlP}
      AND p.priority = 'HIGH'
  `);
  const highRfi = await scalar(sql`SELECT COUNT(*)::int AS n FROM rfis WHERE organization_id = ${orgId} AND (assigned_to_id = ${managerId} OR forwarded_to_id = ${managerId}) AND ${rfiOpenSql} AND priority = 'HIGH'`);

  // Project A: tasks/punch/rfi/inspections (CRM has no project link → excluded).
  const projATask = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${taskOpenSql} AND project_id = ${projectAId}`);
  const projAPunch = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM punch_list_items p
    JOIN projects pr ON pr.id = p.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND p.assigned_to_user_id = ${managerId}
      AND ${punchOpenSqlP}
      AND p.project_id = ${projectAId}
  `);
  const projARfi = await scalar(sql`SELECT COUNT(*)::int AS n FROM rfis WHERE organization_id = ${orgId} AND (assigned_to_id = ${managerId} OR forwarded_to_id = ${managerId}) AND ${rfiOpenSql} AND project_id = ${projectAId}`);
  const projAInsp = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM project_inspections i
    JOIN projects pr ON pr.id = i.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND i.created_by_id = ${managerId}
      AND ${inspOpenSqlI}
      AND i.project_id = ${projectAId}
  `);

  // Search needle (only TASK rows have it).
  const needlePattern = `%${SEARCH_NEEDLE}%`;
  const searchTask = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${taskOpenSql} AND title ILIKE ${needlePattern}`);

  // Due window [today, today+14] inclusive end-of-day.
  const winStart = dayOffset(0);
  const winEnd = dayOffset(14);
  winEnd.setHours(23, 59, 59, 999);
  const dueTask = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${taskOpenSql} AND due_date >= ${winStart} AND due_date <= ${winEnd}`);
  const dueCrm = await scalar(sql`SELECT COUNT(*)::int AS n FROM crm_tasks WHERE organization_id = ${orgId} AND assigned_to_id = ${managerId} AND ${crmOpenSql} AND due_date >= ${winStart} AND due_date <= ${winEnd}`);
  const duePunch = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM punch_list_items p
    JOIN projects pr ON pr.id = p.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND p.assigned_to_user_id = ${managerId}
      AND ${punchOpenSqlP}
      AND p.due_date >= ${winStart} AND p.due_date <= ${winEnd}
  `);
  const dueRfi = await scalar(sql`SELECT COUNT(*)::int AS n FROM rfis WHERE organization_id = ${orgId} AND (assigned_to_id = ${managerId} OR forwarded_to_id = ${managerId}) AND ${rfiOpenSql} AND date_required >= ${winStart} AND date_required <= ${winEnd}`);
  const dueInsp = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM project_inspections i
    JOIN projects pr ON pr.id = i.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND i.created_by_id = ${managerId}
      AND ${inspOpenSqlI}
      AND COALESCE(i.scheduled_date, i.requested_date) >= ${winStart}
      AND COALESCE(i.scheduled_date, i.requested_date) <= ${winEnd}
  `);

  // Team mode: manager + reports.
  const everyone = [managerId, ...reportIds];
  const everyoneList = sql.join(everyone.map((id) => sql`${id}`), sql`, `);
  const teamTask = await scalar(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE organization_id = ${orgId} AND assigned_to_id IN (${everyoneList}) AND ${taskOpenSql}`);
  const teamCrm = await scalar(sql`SELECT COUNT(*)::int AS n FROM crm_tasks WHERE organization_id = ${orgId} AND assigned_to_id IN (${everyoneList}) AND ${crmOpenSql}`);
  const teamPunch = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM punch_list_items p
    JOIN projects pr ON pr.id = p.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND p.assigned_to_user_id IN (${everyoneList})
      AND ${punchOpenSqlP}
  `);
  const teamRfi = await scalar(sql`SELECT COUNT(*)::int AS n FROM rfis WHERE organization_id = ${orgId} AND (assigned_to_id IN (${everyoneList}) OR forwarded_to_id IN (${everyoneList})) AND ${rfiOpenSql}`);
  const teamInsp = await scalar(sql`
    SELECT COUNT(*)::int AS n
    FROM project_inspections i
    JOIN projects pr ON pr.id = i.project_id
    WHERE pr.gc_organization_id = ${orgId}
      AND i.created_by_id IN (${everyoneList})
      AND ${inspOpenSqlI}
  `);

  return {
    perTypeOpen: {
      TASK: taskOpen,
      CRM_TASK: crmOpen,
      PUNCH: punchOpen,
      RFI: rfiOpen,
      INSPECTION: inspOpen,
    },
    managerOpenTotal,
    managerCompletedTotal: taskDone + crmDone + punchDone + rfiDone + inspDone,
    highPriorityOpen: highTask + highCrm + highPunch + highRfi,
    projectAOpen: projATask + projAPunch + projARfi + projAInsp,
    searchOpen: searchTask,
    dueWindowOpen: dueTask + dueCrm + duePunch + dueRfi + dueInsp,
    teamOpenTotal: teamTask + teamCrm + teamPunch + teamRfi + teamInsp,
  };
}

async function cleanupLoadFixture(orgId: string): Promise<void> {
  // Delete in FK-safe order. We don't swallow errors — a teardown failure
  // would leave fixture rows behind and silently contaminate later runs.
  const steps: Array<{ label: string; query: SQL }> = [
    { label: "crm_tasks", query: sql`DELETE FROM crm_tasks WHERE organization_id = ${orgId}` },
    { label: "tasks", query: sql`DELETE FROM tasks WHERE organization_id = ${orgId}` },
    { label: "rfis", query: sql`DELETE FROM rfis WHERE organization_id = ${orgId}` },
    {
      label: "punch_list_items",
      query: sql`DELETE FROM punch_list_items WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`,
    },
    {
      label: "project_inspections",
      query: sql`DELETE FROM project_inspections WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`,
    },
    { label: "projects", query: sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}` },
    { label: "users", query: sql`DELETE FROM users WHERE organization_id = ${orgId}` },
    { label: "organizations", query: sql`DELETE FROM organizations WHERE id = ${orgId}` },
  ];
  const failures: Array<{ label: string; error: unknown }> = [];
  for (const step of steps) {
    try {
      await db.execute(step.query);
    } catch (error) {
      failures.push({ label: step.label, error });
    }
  }
  if (failures.length > 0) {
    const summary = failures
      .map((f) => `${f.label}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
      .join("; ");
    throw new Error(`my-work fixture teardown failed: ${summary}`);
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  seed = await seedLoadFixture();
}, 180_000);

afterAll(async () => {
  if (seed?.orgId) {
    await cleanupLoadFixture(seed.orgId);
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 60_000);

interface MyWorkResponse {
  items: Array<{
    id: string;
    type: "TASK" | "CRM_TASK" | "PUNCH" | "RFI" | "INSPECTION";
    title: string;
    dueDate: string | null;
    status: string;
    priority: string | null;
    projectId: string | null;
    isCompleted: boolean;
    updatedAt: string | null;
  }>;
  nextCursor: string | null;
  counts: {
    total: number;
    byType: Record<string, number>;
  };
}

function getWork(query: Record<string, string | number | undefined>) {
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return request(app)
    .get(`/api/me/work${params ? `?${params}` : ""}`)
    .set("Cookie", `auth_token=${seed.managerToken}`);
}

async function walkAllPages(query: Record<string, string | number | undefined>) {
  const ids = new Set<string>();
  const dups: string[] = [];
  const ordering: Array<{ due: string | null; updated: string | null; id: string }> = [];
  const counts: Record<string, number> = { TASK: 0, CRM_TASK: 0, PUNCH: 0, RFI: 0, INSPECTION: 0 };
  let cursor: string | undefined;
  let firstResp: MyWorkResponse | null = null;
  let pageCount = 0;
  while (pageCount < 200) {
    pageCount++;
    const resp = await getWork({ ...query, cursor, limit: 200 });
    expect(resp.status).toBe(200);
    const body = resp.body as MyWorkResponse;
    if (!firstResp) firstResp = body;
    for (const item of body.items) {
      if (ids.has(item.id)) dups.push(item.id);
      ids.add(item.id);
      counts[item.type] = (counts[item.type] ?? 0) + 1;
      ordering.push({ due: item.dueDate, updated: item.updatedAt, id: item.id });
    }
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return { ids, dups, ordering, counts, pageCount, firstResp: firstResp! };
}

describe("GET /api/me/work — load fixture", () => {
  it("first page returns within 1.5s and reports per-type counts", async () => {
    const start = Date.now();
    const resp = await getWork({ status: "OPEN", limit: 200 });
    const elapsed = Date.now() - start;
    expect(resp.status).toBe(200);
    const body = resp.body as MyWorkResponse;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(200);
    expect(body.counts.byType.TASK).toBe(seed.expected.perTypeOpen.TASK);
    expect(body.counts.byType.CRM_TASK).toBe(seed.expected.perTypeOpen.CRM_TASK);
    expect(body.counts.byType.PUNCH).toBe(seed.expected.perTypeOpen.PUNCH);
    expect(body.counts.byType.RFI).toBe(seed.expected.perTypeOpen.RFI);
    expect(body.counts.byType.INSPECTION).toBe(seed.expected.perTypeOpen.INSPECTION);
    expect(body.counts.total).toBe(seed.expected.managerOpenTotal);
    expect(elapsed).toBeLessThan(1500);
  }, 30_000);

  it("cursor walk visits every open item exactly once across all sources", async () => {
    const { ids, dups, ordering, counts, pageCount } = await walkAllPages({ status: "OPEN" });
    expect(dups).toEqual([]);
    expect(ids.size).toBe(seed.expected.managerOpenTotal);
    expect(counts.TASK).toBe(seed.expected.perTypeOpen.TASK);
    expect(counts.CRM_TASK).toBe(seed.expected.perTypeOpen.CRM_TASK);
    expect(counts.PUNCH).toBe(seed.expected.perTypeOpen.PUNCH);
    expect(counts.RFI).toBe(seed.expected.perTypeOpen.RFI);
    expect(counts.INSPECTION).toBe(seed.expected.perTypeOpen.INSPECTION);
    expect(pageCount).toBeGreaterThan(1);

    // Composite sort key: dueDate ASC NULLS LAST, updatedAt DESC, id ASC.
    // Verify every adjacent pair under the full comparator so that a
    // regression in any tier (primary date, secondary tiebreaker, or final
    // id tiebreaker) trips the test rather than going unnoticed.
    const ts = (iso: string | null): number | null =>
      iso === null ? null : new Date(iso).getTime();
    for (let i = 1; i < ordering.length; i++) {
      const prev = ordering[i - 1];
      const cur = ordering[i];
      const pd = ts(prev.due);
      const cd = ts(cur.due);

      if (pd === null && cd !== null) {
        throw new Error(`NULL dueDate appeared before non-null at index ${i}`);
      }

      if (pd !== null && cd === null) {
        // non-null < null under NULLS LAST — ordering is fine, no further checks.
        continue;
      }

      if (pd !== null && cd !== null && pd !== cd) {
        expect(pd).toBeLessThan(cd);
        continue;
      }

      // Same dueDate (or both NULL): updatedAt must be strictly DESC, with id
      // ASC as the final tiebreaker.
      const pu = ts(prev.updated);
      const cu = ts(cur.updated);
      if (pu === null || cu === null) {
        throw new Error(`expected updatedAt to be present at index ${i}`);
      }
      if (pu !== cu) {
        expect(pu).toBeGreaterThan(cu);
        continue;
      }

      // Same dueDate AND same updatedAt → id must be strictly ASC.
      expect(prev.id < cur.id).toBe(true);
    }
  }, 60_000);

  it("source filter narrows the result to the requested types", async () => {
    const { ids, counts } = await walkAllPages({ status: "OPEN", source: "TASK" });
    expect(counts.TASK).toBe(seed.expected.perTypeOpen.TASK);
    expect(counts.CRM_TASK).toBe(0);
    expect(counts.PUNCH).toBe(0);
    expect(counts.RFI).toBe(0);
    expect(counts.INSPECTION).toBe(0);
    expect(ids.size).toBe(seed.expected.perTypeOpen.TASK);
  }, 60_000);

  it("priority filter is pushed down (HIGH only)", async () => {
    const { ids, counts } = await walkAllPages({ status: "OPEN", priority: "HIGH" });
    // Inspections have no priority column → filter excludes them entirely.
    expect(counts.INSPECTION).toBe(0);
    expect(ids.size).toBe(seed.expected.highPriorityOpen);
    expect(ids.size).toBeGreaterThan(0);
  }, 30_000);

  it("projects filter is pushed down (project A) and excludes CRM tasks", async () => {
    const { ids, counts } = await walkAllPages({
      status: "OPEN",
      projects: seed.projectIds[0],
    });
    expect(counts.CRM_TASK).toBe(0);
    expect(ids.size).toBe(seed.expected.projectAOpen);
    expect(ids.size).toBeGreaterThan(0);
  }, 30_000);

  it("search filter narrows to titles containing the needle", async () => {
    const { ids, counts } = await walkAllPages({ status: "OPEN", search: SEARCH_NEEDLE });
    // Only TASK rows were tagged with the needle.
    expect(counts.TASK).toBe(seed.expected.searchOpen);
    expect(counts.CRM_TASK + counts.PUNCH + counts.RFI + counts.INSPECTION).toBe(0);
    expect(ids.size).toBe(seed.expected.searchOpen);
    expect(ids.size).toBeGreaterThan(0);
  }, 30_000);

  it("dueFrom/dueTo restrict to the date window", async () => {
    const fromDate = dayOffset(0).toISOString().slice(0, 10);
    const toDate = dayOffset(14).toISOString().slice(0, 10);
    const { ids } = await walkAllPages({ status: "OPEN", dueFrom: fromDate, dueTo: toDate });
    expect(ids.size).toBe(seed.expected.dueWindowOpen);
    expect(ids.size).toBeGreaterThan(0);
  }, 30_000);

  it("status=COMPLETED returns only completed items", async () => {
    const { ids } = await walkAllPages({ status: "COMPLETED" });
    expect(ids.size).toBe(seed.expected.managerCompletedTotal);
    expect(ids.size).toBeGreaterThan(0);
  }, 30_000);

  it("manager team-view aggregates direct-report items", async () => {
    const solo = await getWork({ status: "OPEN", limit: 1 });
    expect(solo.status).toBe(200);
    const soloTotal = (solo.body as MyWorkResponse).counts.total;

    const teamResp = await getWork({ status: "OPEN", team: "direct-reports", limit: 1 });
    expect(teamResp.status).toBe(200);
    const teamTotal = (teamResp.body as MyWorkResponse).counts.total;

    expect(teamTotal).toBeGreaterThan(soloTotal);
    expect(teamTotal).toBe(seed.expected.teamOpenTotal);

    // Walk team view and confirm uniqueness still holds with a wider assignee
    // pool (no double-counting from the merge).
    const { ids, dups } = await walkAllPages({ status: "OPEN", team: "direct-reports" });
    expect(dups).toEqual([]);
    expect(ids.size).toBe(teamTotal);
  }, 120_000);
});
