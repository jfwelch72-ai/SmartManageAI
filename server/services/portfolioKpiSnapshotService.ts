import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  projects,
  rfis,
  changeOrders,
  punchListItems,
  projectScheduleTasks,
  projectSchedules,
  timeEntries,
  projectKpiSnapshots,
  projectProfitabilitySnapshots,
} from "@shared/schema";
import {
  rfiStatusEnum,
  changeOrderStatusEnum,
  punchListStatusEnum,
} from "@shared/schema/enums";
import { calculateAllProjectsProfitability } from "../ai/profitabilityEngine";
import { logInfo, logError } from "../utils/logger";

type RfiStatus = (typeof rfiStatusEnum.enumValues)[number];
type ChangeOrderStatus = (typeof changeOrderStatusEnum.enumValues)[number];
type PunchListStatus = (typeof punchListStatusEnum.enumValues)[number];

const OPEN_RFI_STATUSES: RfiStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FORWARDED"];
const OPEN_CO_STATUSES: ChangeOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "SUBMITTED", "PCO", "PRICING_REVIEW"];
const OPEN_PUNCH_STATUSES: PunchListStatus[] = ["OPEN", "IN_PROGRESS"];

export function startOfWeekUtc(d: Date): Date {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  const day = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt;
}

export function weekStartIso(d: Date): string {
  return startOfWeekUtc(d).toISOString().slice(0, 10);
}

export function computeHealthScore(opts: {
  budgetVariancePct: number;
  openRfis: number;
  openCos: number;
  openPunch: number;
  schedulePctComplete: number;
  expectedPctComplete: number;
}): number {
  const { budgetVariancePct, openRfis, openCos, openPunch, schedulePctComplete, expectedPctComplete } = opts;
  let score = 100;
  if (budgetVariancePct < -15) score -= 35;
  else if (budgetVariancePct < -5) score -= 18;
  else if (budgetVariancePct < 0) score -= 8;
  const sched = schedulePctComplete - expectedPctComplete;
  if (sched < -20) score -= 25;
  else if (sched < -10) score -= 15;
  else if (sched < -5) score -= 7;
  if (openRfis > 20) score -= 10;
  else if (openRfis > 10) score -= 5;
  if (openCos > 8) score -= 8;
  else if (openCos > 4) score -= 4;
  if (openPunch > 30) score -= 8;
  else if (openPunch > 15) score -= 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Capture a per-project KPI snapshot for the current week. Idempotent:
 * re-running on the same day overwrites the row for the current week
 * (one row per project per week, keyed by `(projectId, weekStart)`).
 */
export async function captureWeeklyKpiSnapshots(now: Date = new Date()): Promise<{ snapshots: number }> {
  const weekStart = startOfWeekUtc(now);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  // Burn for the *current* week is summed from time entries since the start of the week.
  const burnSince = weekStart;

  const projectRows = await db
    .select({
      id: projects.id,
      code: projects.code,
      gcOrganizationId: projects.gcOrganizationId,
      startDate: projects.startDate,
      endDate: projects.endDate,
      estimatedCompletionDate: projects.estimatedCompletionDate,
    })
    .from(projects);

  if (projectRows.length === 0) return { snapshots: 0 };

  const projectIds = projectRows.map((p) => p.id);

  const profitability = await calculateAllProjectsProfitability().catch((err) => {
    logError("kpi-snapshot.profitability", err);
    return [] as Awaited<ReturnType<typeof calculateAllProjectsProfitability>>;
  });
  const profByCode = new Map(profitability.map((p) => [p.project_code, p]));

  const [rfiRows, coRows, punchRows, schedRows, burnRows] = await Promise.all([
    db
      .select({ projectId: rfis.projectId, count: sql<number>`count(*)::int` })
      .from(rfis)
      .where(and(inArray(rfis.projectId, projectIds), inArray(rfis.status, OPEN_RFI_STATUSES)))
      .groupBy(rfis.projectId),
    db
      .select({ projectId: changeOrders.projectId, count: sql<number>`count(*)::int` })
      .from(changeOrders)
      .where(and(inArray(changeOrders.projectId, projectIds), inArray(changeOrders.status, OPEN_CO_STATUSES)))
      .groupBy(changeOrders.projectId),
    db
      .select({ projectId: punchListItems.projectId, count: sql<number>`count(*)::int` })
      .from(punchListItems)
      .where(and(inArray(punchListItems.projectId, projectIds), inArray(punchListItems.status, OPEN_PUNCH_STATUSES)))
      .groupBy(punchListItems.projectId),
    db
      .select({
        projectId: projectSchedules.projectId,
        avgPct: sql<number>`coalesce(avg(${projectScheduleTasks.percentComplete}), 0)::float`,
      })
      .from(projectSchedules)
      .leftJoin(projectScheduleTasks, eq(projectScheduleTasks.scheduleId, projectSchedules.id))
      .where(inArray(projectSchedules.projectId, projectIds))
      .groupBy(projectSchedules.projectId),
    db
      .select({
        projectId: timeEntries.projectId,
        hoursRegular: timeEntries.hoursRegular,
        hoursOvertime: timeEntries.hoursOvertime,
      })
      .from(timeEntries)
      .where(and(inArray(timeEntries.projectId, projectIds), gte(timeEntries.date, burnSince))),
  ]);

  const rfiMap = new Map(rfiRows.map((r) => [r.projectId, Number(r.count)]));
  const coMap = new Map(coRows.map((r) => [r.projectId, Number(r.count)]));
  const punchMap = new Map(punchRows.map((r) => [r.projectId, Number(r.count)]));
  const schedMap = new Map(schedRows.map((r) => [r.projectId, Number(r.avgPct) || 0]));

  const burnMap = new Map<string, number>();
  for (const r of burnRows) {
    const reg = parseFloat(r.hoursRegular || "0") || 0;
    const ot = parseFloat(r.hoursOvertime || "0") || 0;
    const dollars = (reg + ot * 1.5) * 50;
    burnMap.set(r.projectId, (burnMap.get(r.projectId) || 0) + dollars);
  }

  let inserted = 0;
  for (const p of projectRows) {
    const prof = profByCode.get(p.code);
    const variancePct = prof ? prof.variance_percent : 0;
    const schedulePct = schedMap.get(p.id) || 0;
    const end = p.endDate || p.estimatedCompletionDate;
    const expectedPct = (() => {
      if (!p.startDate || !end) return schedulePct;
      const endMs = end.getTime();
      const startMs = p.startDate.getTime();
      if (endMs <= startMs) return schedulePct;
      return Math.max(0, Math.min(100, ((now.getTime() - startMs) / (endMs - startMs)) * 100));
    })();
    const openRfis = rfiMap.get(p.id) || 0;
    const openCos = coMap.get(p.id) || 0;
    const openPunch = punchMap.get(p.id) || 0;
    const health = computeHealthScore({
      budgetVariancePct: variancePct,
      openRfis,
      openCos,
      openPunch,
      schedulePctComplete: schedulePct,
      expectedPctComplete: expectedPct,
    });
    const spi = expectedPct > 0 ? Math.round((schedulePct / expectedPct) * 1000) / 1000 : 1;
    const cpi = prof && prof.total_actual_cost > 0
      ? Math.round((prof.adjusted_budget / prof.total_actual_cost) * 1000) / 1000
      : 1;
    const burn = burnMap.get(p.id) || 0;

    await db
      .insert(projectKpiSnapshots)
      .values({
        organizationId: p.gcOrganizationId ?? null,
        projectId: p.id,
        weekStart: weekStartStr,
        health,
        spi: String(spi),
        cpi: String(cpi),
        burn: String(Math.round(burn * 100) / 100),
        variancePct: String(Math.round(variancePct * 100) / 100),
        schedulePct: Math.round(schedulePct),
        expectedPct: Math.round(expectedPct),
        openRfis,
        openCos,
        openPunch,
      })
      .onConflictDoUpdate({
        target: [projectKpiSnapshots.projectId, projectKpiSnapshots.weekStart],
        set: {
          organizationId: p.gcOrganizationId ?? null,
          health,
          spi: String(spi),
          cpi: String(cpi),
          burn: String(Math.round(burn * 100) / 100),
          variancePct: String(Math.round(variancePct * 100) / 100),
          schedulePct: Math.round(schedulePct),
          expectedPct: Math.round(expectedPct),
          openRfis,
          openCos,
          openPunch,
          capturedAt: new Date(),
        },
      });
    inserted += 1;
  }

  logInfo("Portfolio KPI snapshots captured", { weekStart: weekStartStr, projects: inserted });
  return { snapshots: inserted };
}

/**
 * Backfill up to `weeks` (default 12) prior weekly KPI snapshots for every
 * project from existing data sources:
 *   - variance / CPI: latest `project_profitability_snapshots` row whose
 *     `created_at` falls on or before each historical week-end
 *   - burn: sum of `time_entries` for that ISO week (Sun→Sat UTC)
 *   - openRfis / openCos / openPunch: approximate "open at end of week"
 *     counts derived from `created_at` and (resolved/closed/approved)At
 *     timestamps on each table
 *   - schedulePct / expectedPct: linear interpolation between project
 *     start and end (we have no historical schedule snapshots)
 *
 * Idempotent: relies on `project_kpi_snap_project_week_uniq` and uses
 * `onConflictDoNothing` so live capture rows already present for a week
 * are preserved.
 */
export async function backfillKpiSnapshots(
  options: { weeks?: number; now?: Date } = {},
): Promise<{ projects: number; weeks: number; inserted: number; skipped: number }> {
  const weeks = Math.max(1, Math.min(52, options.weeks ?? 12));
  const now = options.now ?? new Date();
  const currentWeekStart = startOfWeekUtc(now);

  // Build the list of week-start dates we want to backfill, oldest first.
  // We seed prior weeks only — the current week is handled by captureWeeklyKpiSnapshots.
  const weekStarts: Date[] = [];
  for (let i = weeks; i >= 1; i--) {
    const ws = new Date(currentWeekStart);
    ws.setUTCDate(ws.getUTCDate() - i * 7);
    weekStarts.push(ws);
  }
  const oldestWeekStart = weekStarts[0];

  const projectRows = await db
    .select({
      id: projects.id,
      code: projects.code,
      gcOrganizationId: projects.gcOrganizationId,
      startDate: projects.startDate,
      endDate: projects.endDate,
      estimatedCompletionDate: projects.estimatedCompletionDate,
    })
    .from(projects);

  if (projectRows.length === 0) {
    return { projects: 0, weeks: weekStarts.length, inserted: 0, skipped: 0 };
  }

  const projectIds = projectRows.map((p) => p.id);

  // Pull all relevant historical rows once and bucket in memory.
  const [profRows, rfiRows, coRows, punchRows, burnRows] = await Promise.all([
    db
      .select({
        projectId: projectProfitabilitySnapshots.projectId,
        createdAt: projectProfitabilitySnapshots.createdAt,
        adjustedBudget: projectProfitabilitySnapshots.adjustedBudget,
        totalActualCost: projectProfitabilitySnapshots.totalActualCost,
        variancePercent: projectProfitabilitySnapshots.variancePercent,
      })
      .from(projectProfitabilitySnapshots)
      .where(inArray(projectProfitabilitySnapshots.projectId, projectIds))
      .orderBy(desc(projectProfitabilitySnapshots.createdAt)),
    db
      .select({
        projectId: rfis.projectId,
        createdAt: rfis.createdAt,
        closedAt: rfis.closedAt,
      })
      .from(rfis)
      .where(inArray(rfis.projectId, projectIds)),
    db
      .select({
        projectId: changeOrders.projectId,
        createdAt: changeOrders.createdAt,
        approvedAt: changeOrders.approvedAt,
      })
      .from(changeOrders)
      .where(inArray(changeOrders.projectId, projectIds)),
    db
      .select({
        projectId: punchListItems.projectId,
        createdAt: punchListItems.createdAt,
        resolvedAt: punchListItems.resolvedAt,
      })
      .from(punchListItems)
      .where(inArray(punchListItems.projectId, projectIds)),
    db
      .select({
        projectId: timeEntries.projectId,
        date: timeEntries.date,
        hoursRegular: timeEntries.hoursRegular,
        hoursOvertime: timeEntries.hoursOvertime,
      })
      .from(timeEntries)
      .where(and(inArray(timeEntries.projectId, projectIds), gte(timeEntries.date, oldestWeekStart))),
  ]);

  // Bucket by project for fast per-week lookups.
  const profByProject = new Map<string, typeof profRows>();
  for (const r of profRows) {
    const arr = profByProject.get(r.projectId) ?? [];
    arr.push(r);
    profByProject.set(r.projectId, arr);
  }
  const rfiByProject = new Map<string, typeof rfiRows>();
  for (const r of rfiRows) {
    const arr = rfiByProject.get(r.projectId) ?? [];
    arr.push(r);
    rfiByProject.set(r.projectId, arr);
  }
  const coByProject = new Map<string, typeof coRows>();
  for (const r of coRows) {
    const arr = coByProject.get(r.projectId) ?? [];
    arr.push(r);
    coByProject.set(r.projectId, arr);
  }
  const punchByProject = new Map<string, typeof punchRows>();
  for (const r of punchRows) {
    const arr = punchByProject.get(r.projectId) ?? [];
    arr.push(r);
    punchByProject.set(r.projectId, arr);
  }

  // Bucket time entries into (projectId, weekStartIso) -> burn dollars.
  const burnByProjectWeek = new Map<string, number>();
  for (const r of burnRows) {
    if (!r.date) continue;
    const ws = startOfWeekUtc(r.date).toISOString().slice(0, 10);
    const key = `${r.projectId}::${ws}`;
    const reg = parseFloat(r.hoursRegular || "0") || 0;
    const ot = parseFloat(r.hoursOvertime || "0") || 0;
    const dollars = (reg + ot * 1.5) * 50;
    burnByProjectWeek.set(key, (burnByProjectWeek.get(key) || 0) + dollars);
  }

  let inserted = 0;
  let skipped = 0;

  for (const p of projectRows) {
    const projProf = profByProject.get(p.id) ?? [];
    const projRfis = rfiByProject.get(p.id) ?? [];
    const projCos = coByProject.get(p.id) ?? [];
    const projPunch = punchByProject.get(p.id) ?? [];

    for (const ws of weekStarts) {
      const weekEnd = new Date(ws);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const weekStartStr = ws.toISOString().slice(0, 10);

      // Latest profitability snapshot strictly before the next week starts
      // (i.e. inside this week). profRows is ordered desc by createdAt
      // globally; per-project list inherits that order.
      const profAtWeek = projProf.find((r) => r.createdAt && r.createdAt.getTime() < weekEnd.getTime());
      const variancePct = profAtWeek ? Number(profAtWeek.variancePercent) || 0 : 0;
      const adjustedBudget = profAtWeek ? Number(profAtWeek.adjustedBudget) || 0 : 0;
      const actualCost = profAtWeek ? Number(profAtWeek.totalActualCost) || 0 : 0;
      const cpi = actualCost > 0 ? Math.round((adjustedBudget / actualCost) * 1000) / 1000 : 1;

      // Open-at-end-of-week approximations. Use strict `<` against the next
      // week's start so an event at exactly next-week-midnight bucketed
      // into the next week, not this one.
      const openRfis = projRfis.filter(
        (r) => r.createdAt && r.createdAt.getTime() < weekEnd.getTime() &&
          (!r.closedAt || r.closedAt.getTime() >= weekEnd.getTime()),
      ).length;
      const openCos = projCos.filter(
        (r) => r.createdAt && r.createdAt.getTime() < weekEnd.getTime() &&
          (!r.approvedAt || r.approvedAt.getTime() >= weekEnd.getTime()),
      ).length;
      const openPunch = projPunch.filter(
        (r) => r.createdAt && r.createdAt.getTime() < weekEnd.getTime() &&
          (!r.resolvedAt || r.resolvedAt.getTime() >= weekEnd.getTime()),
      ).length;

      // Schedule + expected % via linear interpolation between project start/end.
      const end = p.endDate || p.estimatedCompletionDate;
      let expectedPct = 0;
      if (p.startDate && end) {
        const startMs = p.startDate.getTime();
        const endMs = end.getTime();
        if (endMs > startMs) {
          expectedPct = Math.max(0, Math.min(100, ((weekEnd.getTime() - startMs) / (endMs - startMs)) * 100));
        }
      }
      const schedulePct = expectedPct; // no historical schedule data

      const burn = burnByProjectWeek.get(`${p.id}::${weekStartStr}`) || 0;
      const spi = expectedPct > 0 ? Math.round((schedulePct / expectedPct) * 1000) / 1000 : 1;
      const health = computeHealthScore({
        budgetVariancePct: variancePct,
        openRfis,
        openCos,
        openPunch,
        schedulePctComplete: schedulePct,
        expectedPctComplete: expectedPct,
      });

      const result = await db
        .insert(projectKpiSnapshots)
        .values({
          organizationId: p.gcOrganizationId ?? null,
          projectId: p.id,
          weekStart: weekStartStr,
          health,
          spi: String(spi),
          cpi: String(cpi),
          burn: String(Math.round(burn * 100) / 100),
          variancePct: String(Math.round(variancePct * 100) / 100),
          schedulePct: Math.round(schedulePct),
          expectedPct: Math.round(expectedPct),
          openRfis,
          openCos,
          openPunch,
        })
        .onConflictDoNothing({
          target: [projectKpiSnapshots.projectId, projectKpiSnapshots.weekStart],
        })
        .returning({ id: projectKpiSnapshots.id });

      if (result.length > 0) inserted += 1;
      else skipped += 1;
    }
  }

  logInfo("Portfolio KPI snapshots backfilled", {
    projects: projectRows.length,
    weeks: weekStarts.length,
    inserted,
    skipped,
  });

  return { projects: projectRows.length, weeks: weekStarts.length, inserted, skipped };
}
