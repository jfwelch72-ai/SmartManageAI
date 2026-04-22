import { Router, type Response, type NextFunction } from "express";
import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  projects,
  users,
  rfis,
  changeOrders,
  punchListItems,
  projectScheduleTasks,
  projectSchedules,
  timeEntries,
} from "@shared/schema";
import { rfiStatusEnum, changeOrderStatusEnum, punchListStatusEnum, projectStatusEnum } from "@shared/schema/enums";
import { requireAuth, requireAnyFeaturePermission, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { calculateAllProjectsProfitability } from "./ai/profitabilityEngine";
import { logError } from "./utils/logger";

const router = Router();

const REQUIRED_PERMS = ["canViewPortfolio", "canAccessCFODashboard"] as const;

type GroupBy = "program" | "division" | "trade" | "pm" | "none";
type RfiStatus = (typeof rfiStatusEnum.enumValues)[number];
type ChangeOrderStatus = (typeof changeOrderStatusEnum.enumValues)[number];
type PunchListStatus = (typeof punchListStatusEnum.enumValues)[number];
type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];

const VALID_PROJECT_STATUSES = new Set<string>(projectStatusEnum.enumValues);

const OPEN_RFI_STATUSES: RfiStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "FORWARDED"];
const OPEN_CO_STATUSES: ChangeOrderStatus[] = ["DRAFT", "PENDING_APPROVAL", "SUBMITTED", "PCO", "PRICING_REVIEW"];
const OPEN_PUNCH_STATUSES: PunchListStatus[] = ["OPEN", "IN_PROGRESS"];

interface ProjectRow {
  id: string;
  code: string;
  name: string;
  status: string;
  state: string | null;
  clientName: string;
  startDate: Date | null;
  endDate: Date | null;
  estimatedCompletionDate: Date | null;
  projectManagerId: string | null;
  pmFirstName: string | null;
  pmLastName: string | null;
  budget: string | null;
  contractAmount: string | null;
}

interface PortfolioFilters {
  groupBy: GroupBy;
  statuses: string[];
  ownerId: string | null;
  startAfter: Date | null;
  endBefore: Date | null;
  minHealth: number | null;
}

function parseFilters(req: AuthRequest): PortfolioFilters {
  const groupBy = (String(req.query.groupBy || "none") as GroupBy);
  const statuses = req.query.status
    ? String(req.query.status).split(",").filter((s) => VALID_PROJECT_STATUSES.has(s))
    : [];
  const ownerId = req.query.ownerId ? String(req.query.ownerId) : null;
  const startAfter = req.query.startAfter ? new Date(String(req.query.startAfter)) : null;
  const endBefore = req.query.endBefore ? new Date(String(req.query.endBefore)) : null;
  const minHealth = req.query.minHealth ? Number(req.query.minHealth) : null;
  return { groupBy, statuses, ownerId, startAfter, endBefore, minHealth };
}

async function loadProjects(req: AuthRequest, filters: PortfolioFilters): Promise<ProjectRow[] | null> {
  const orgCtx = getOrgIdForFilter(req);
  if (orgCtx.mustDenyAccess) return null;

  const where: any[] = [];
  if (orgCtx.shouldFilter && orgCtx.orgId) {
    where.push(eq(projects.gcOrganizationId, orgCtx.orgId));
  }
  if (filters.statuses.length) where.push(inArray(projects.status, filters.statuses as ProjectStatus[]));
  if (filters.ownerId) where.push(eq(projects.projectManagerId, filters.ownerId));
  if (filters.startAfter) where.push(gte(projects.startDate, filters.startAfter));
  if (filters.endBefore) where.push(lte(projects.endDate, filters.endBefore));

  const q = db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      status: projects.status,
      state: projects.state,
      clientName: projects.clientName,
      startDate: projects.startDate,
      endDate: projects.endDate,
      estimatedCompletionDate: projects.estimatedCompletionDate,
      projectManagerId: projects.projectManagerId,
      pmFirstName: users.firstName,
      pmLastName: users.lastName,
      budget: projects.budget,
      contractAmount: projects.contractAmount,
    })
    .from(projects)
    .leftJoin(users, eq(projects.projectManagerId, users.id));

  const rows = where.length ? await q.where(and(...where)) : await q;
  return rows as ProjectRow[];
}

function startOfWeek(d: Date): Date {
  const dt = new Date(d);
  dt.setUTCHours(0, 0, 0, 0);
  const day = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt;
}

interface WeekBucket { start: Date; end: Date; key: string }

function buildWeekBuckets(weeks = 12): WeekBucket[] {
  const now = startOfWeek(new Date());
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    buckets.push({ start, end, key: start.toISOString().slice(0, 10) });
  }
  return buckets;
}

function pmNameOf(p: ProjectRow): string | null {
  if (!p.pmFirstName && !p.pmLastName) return null;
  return [p.pmFirstName, p.pmLastName].filter(Boolean).join(" ").trim() || null;
}

function groupKeyFor(p: ProjectRow, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "program":
      return { key: p.clientName || "unassigned", label: p.clientName || "Unassigned Program" };
    case "division":
      return { key: p.state || "unassigned", label: p.state || "Unassigned Division" };
    case "trade":
      return { key: "__trade__", label: "Trade (data not yet captured)" };
    case "pm":
      return {
        key: p.projectManagerId || "unassigned",
        label: pmNameOf(p) || "Unassigned PM",
      };
    case "none":
    default:
      return { key: "all", label: "All Projects" };
  }
}

function computeHealth(opts: {
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

function toIsoOrNull(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function bucketIndex(buckets: WeekBucket[], ts: number): number {
  return buckets.findIndex((b) => ts >= b.start.getTime() && ts < b.end.getTime());
}

router.get(
  "/api/portfolio/health-heatmap",
  requireAuth,
  requireAnyFeaturePermission(...REQUIRED_PERMS),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filters = parseFilters(req);
      const projectRows = await loadProjects(req, filters);
      if (projectRows === null) return res.status(403).json({ error: "Forbidden" });
      if (projectRows.length === 0) {
        return res.json({
          groupBy: filters.groupBy,
          groups: [],
          kpiKeys: ["health", "spi", "cpi", "rfis", "cos", "punch"],
          generatedAt: new Date().toISOString(),
        });
      }

      const projectIds = projectRows.map((p) => p.id);
      const projectIdSet = new Set(projectIds);
      const profitability = await calculateAllProjectsProfitability().catch(() => []);
      const profByCode = new Map(profitability.map((p) => [p.project_code, p]));

      const buckets = buildWeekBuckets(12);
      const earliest = buckets[0].start;

      const [openRfiRows, openCoRows, openPunchRows, scheduleAgg, sparkRfiRows, sparkCoRows, sparkPunchRows] = await Promise.all([
        db.select({ projectId: rfis.projectId, count: sql<number>`count(*)::int` })
          .from(rfis)
          .where(and(inArray(rfis.projectId, projectIds), inArray(rfis.status, OPEN_RFI_STATUSES)))
          .groupBy(rfis.projectId),
        db.select({ projectId: changeOrders.projectId, count: sql<number>`count(*)::int` })
          .from(changeOrders)
          .where(and(inArray(changeOrders.projectId, projectIds), inArray(changeOrders.status, OPEN_CO_STATUSES)))
          .groupBy(changeOrders.projectId),
        db.select({ projectId: punchListItems.projectId, count: sql<number>`count(*)::int` })
          .from(punchListItems)
          .where(and(inArray(punchListItems.projectId, projectIds), inArray(punchListItems.status, OPEN_PUNCH_STATUSES)))
          .groupBy(punchListItems.projectId),
        db.select({
            projectId: projectSchedules.projectId,
            avgPct: sql<number>`coalesce(avg(${projectScheduleTasks.percentComplete}), 0)::float`,
            nextMilestone: sql<Date | null>`min(case when ${projectScheduleTasks.isMilestone} = true and ${projectScheduleTasks.percentComplete} < 100 then ${projectScheduleTasks.plannedEndDate} end)`,
          })
          .from(projectSchedules)
          .leftJoin(projectScheduleTasks, eq(projectScheduleTasks.scheduleId, projectSchedules.id))
          .where(inArray(projectSchedules.projectId, projectIds))
          .groupBy(projectSchedules.projectId),
        db.select({ projectId: rfis.projectId, createdAt: rfis.createdAt })
          .from(rfis)
          .where(and(inArray(rfis.projectId, projectIds), gte(rfis.createdAt, earliest))),
        db.select({ projectId: changeOrders.projectId, createdAt: changeOrders.createdAt })
          .from(changeOrders)
          .where(and(inArray(changeOrders.projectId, projectIds), gte(changeOrders.createdAt, earliest))),
        db.select({ projectId: punchListItems.projectId, createdAt: punchListItems.createdAt })
          .from(punchListItems)
          .where(and(inArray(punchListItems.projectId, projectIds), gte(punchListItems.createdAt, earliest))),
      ]);

      const rfiMap = new Map(openRfiRows.map((r) => [r.projectId, Number(r.count)]));
      const coMap = new Map(openCoRows.map((r) => [r.projectId, Number(r.count)]));
      const punchMap = new Map(openPunchRows.map((r) => [r.projectId, Number(r.count)]));
      const schedMap = new Map(scheduleAgg.map((r) => [r.projectId, r]));

      const sparkRfi: Record<string, number[]> = {};
      const sparkCo: Record<string, number[]> = {};
      const sparkPunch: Record<string, number[]> = {};
      for (const id of projectIds) {
        sparkRfi[id] = new Array(buckets.length).fill(0);
        sparkCo[id] = new Array(buckets.length).fill(0);
        sparkPunch[id] = new Array(buckets.length).fill(0);
      }
      for (const r of sparkRfiRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const idx = bucketIndex(buckets, new Date(r.createdAt).getTime());
        if (idx >= 0) sparkRfi[r.projectId][idx] += 1;
      }
      for (const r of sparkCoRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const idx = bucketIndex(buckets, new Date(r.createdAt).getTime());
        if (idx >= 0) sparkCo[r.projectId][idx] += 1;
      }
      for (const r of sparkPunchRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const idx = bucketIndex(buckets, new Date(r.createdAt).getTime());
        if (idx >= 0) sparkPunch[r.projectId][idx] += 1;
      }

      let cells = projectRows.map((p) => {
        const prof = profByCode.get(p.code);
        const variancePct = prof ? prof.variance_percent : 0;
        const sched = schedMap.get(p.id);
        const schedulePct = sched ? Number(sched.avgPct) || 0 : 0;
        const expectedPct = (() => {
          const end = p.endDate || p.estimatedCompletionDate;
          if (!p.startDate || !end) return schedulePct;
          const endMs = end.getTime();
          const startMs = p.startDate.getTime();
          if (endMs <= startMs) return schedulePct;
          return Math.max(0, Math.min(100, ((Date.now() - startMs) / (endMs - startMs)) * 100));
        })();
        const openRfiCount = rfiMap.get(p.id) || 0;
        const openCoCount = coMap.get(p.id) || 0;
        const openPunchCount = punchMap.get(p.id) || 0;
        const health = computeHealth({
          budgetVariancePct: variancePct,
          openRfis: openRfiCount,
          openCos: openCoCount,
          openPunch: openPunchCount,
          schedulePctComplete: schedulePct,
          expectedPctComplete: expectedPct,
        });
        const nextMilestone = sched?.nextMilestone ? new Date(sched.nextMilestone) : null;
        const daysToNext = nextMilestone
          ? Math.round((nextMilestone.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;
        const spi = expectedPct > 0 ? Math.round((schedulePct / expectedPct) * 100) / 100 : 1;
        const cpi = prof && prof.total_actual_cost > 0
          ? Math.round((prof.adjusted_budget / prof.total_actual_cost) * 100) / 100
          : 1;

        const flatSeries = (n: number, len: number) => new Array(len).fill(n);
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          pmName: pmNameOf(p),
          clientName: p.clientName,
          state: p.state,
          health,
          spi,
          cpi,
          budgetVariancePct: Math.round(variancePct * 10) / 10,
          openRfis: openRfiCount,
          openCos: openCoCount,
          openPunch: openPunchCount,
          schedulePct: Math.round(schedulePct),
          expectedPct: Math.round(expectedPct),
          daysToNextMilestone: daysToNext,
          // Per-KPI 12-week sparklines for the matrix view
          kpis: [
            { key: "health", label: "Health", value: health, sparkline: flatSeries(health, buckets.length), tab: "overview" },
            { key: "spi", label: "SPI", value: spi, sparkline: flatSeries(spi, buckets.length), tab: "schedule" },
            { key: "cpi", label: "CPI", value: cpi, sparkline: flatSeries(cpi, buckets.length), tab: "financials" },
            { key: "rfis", label: "Open RFIs", value: openRfiCount, sparkline: sparkRfi[p.id], tab: "rfis" },
            { key: "cos", label: "Open COs", value: openCoCount, sparkline: sparkCo[p.id], tab: "change-orders" },
            { key: "punch", label: "Punch", value: openPunchCount, sparkline: sparkPunch[p.id], tab: "punch-list" },
          ],
        };
      });

      if (filters.minHealth !== null) cells = cells.filter((c) => c.health >= (filters.minHealth as number));

      const groupsMap = new Map<string, { key: string; label: string; cells: typeof cells }>();
      for (const cell of cells) {
        const proj = projectRows.find((p) => p.id === cell.projectId)!;
        const g = groupKeyFor(proj, filters.groupBy);
        if (!groupsMap.has(g.key)) groupsMap.set(g.key, { key: g.key, label: g.label, cells: [] });
        groupsMap.get(g.key)!.cells.push(cell);
      }
      const groups = Array.from(groupsMap.values()).map((g) => {
        const avg = (sel: (c: typeof cells[number]) => number) =>
          g.cells.length ? Math.round((g.cells.reduce((s, c) => s + sel(c), 0) / g.cells.length) * 10) / 10 : 0;
        return {
          ...g,
          summary: {
            projectCount: g.cells.length,
            avgHealth: avg((c) => c.health),
            avgSpi: avg((c) => c.spi),
            avgCpi: avg((c) => c.cpi),
            totalOpenRfis: g.cells.reduce((s, c) => s + c.openRfis, 0),
            totalOpenCos: g.cells.reduce((s, c) => s + c.openCos, 0),
            totalOpenPunch: g.cells.reduce((s, c) => s + c.openPunch, 0),
          },
        };
      });
      groups.sort((a, b) => a.label.localeCompare(b.label));

      res.json({ groupBy: filters.groupBy, groups, kpiKeys: ["health", "spi", "cpi", "rfis", "cos", "punch"], generatedAt: new Date().toISOString() });
    } catch (err) {
      logError("portfolio.health-heatmap", err);
      next(err);
    }
  }
);

router.get(
  "/api/portfolio/gantt",
  requireAuth,
  requireAnyFeaturePermission(...REQUIRED_PERMS),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filters = parseFilters(req);
      const projectRows = await loadProjects(req, filters);
      if (projectRows === null) return res.status(403).json({ error: "Forbidden" });

      const projectIds = projectRows.map((p) => p.id);
      const milestones = projectIds.length
        ? await db
            .select({
              projectId: projectSchedules.projectId,
              name: projectScheduleTasks.name,
              plannedEndDate: projectScheduleTasks.plannedEndDate,
              actualEndDate: projectScheduleTasks.actualEndDate,
              baselineEndDate: projectScheduleTasks.baselineEndDate,
              percentComplete: projectScheduleTasks.percentComplete,
            })
            .from(projectScheduleTasks)
            .innerJoin(projectSchedules, eq(projectSchedules.id, projectScheduleTasks.scheduleId))
            .where(and(inArray(projectSchedules.projectId, projectIds), eq(projectScheduleTasks.isMilestone, true)))
        : [];

      const milestonesByProject = new Map<string, typeof milestones>();
      for (const m of milestones) {
        if (!milestonesByProject.has(m.projectId)) milestonesByProject.set(m.projectId, []);
        milestonesByProject.get(m.projectId)!.push(m);
      }

      const bars = projectRows
        .map((p) => ({
          projectId: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          pmName: pmNameOf(p),
          clientName: p.clientName,
          state: p.state,
          start: toIsoOrNull(p.startDate),
          end: toIsoOrNull(p.endDate || p.estimatedCompletionDate),
          milestones: (milestonesByProject.get(p.id) || []).slice(0, 8),
          group: groupKeyFor(p, filters.groupBy),
        }))
        .filter((b) => b.start && b.end);

      const groupsMap = new Map<string, { key: string; label: string; bars: typeof bars }>();
      for (const b of bars) {
        if (!groupsMap.has(b.group.key))
          groupsMap.set(b.group.key, { key: b.group.key, label: b.group.label, bars: [] });
        groupsMap.get(b.group.key)!.bars.push(b);
      }
      const groups = Array.from(groupsMap.values()).sort((a, b) => a.label.localeCompare(b.label));
      res.json({ groupBy: filters.groupBy, groups, generatedAt: new Date().toISOString() });
    } catch (err) {
      logError("portfolio.gantt", err);
      next(err);
    }
  }
);

router.get(
  "/api/portfolio/financial-rollup",
  requireAuth,
  requireAnyFeaturePermission(...REQUIRED_PERMS),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filters = parseFilters(req);
      const projectRows = await loadProjects(req, filters);
      if (projectRows === null) return res.status(403).json({ error: "Forbidden" });

      const projectCodeSet = new Set(projectRows.map((p) => p.code));
      const profitability = (await calculateAllProjectsProfitability().catch(() => []))
        .filter((p) => projectCodeSet.has(p.project_code));
      const profByCode = new Map(profitability.map((p) => [p.project_code, p]));

      const projectIds = projectRows.map((p) => p.id);
      const buckets = buildWeekBuckets(12);
      const earliest = buckets[0].start;

      const burnRows = projectIds.length
        ? await db
            .select({
              projectId: timeEntries.projectId,
              date: timeEntries.date,
              hoursRegular: timeEntries.hoursRegular,
              hoursOvertime: timeEntries.hoursOvertime,
            })
            .from(timeEntries)
            .where(and(inArray(timeEntries.projectId, projectIds), gte(timeEntries.date, earliest)))
        : [];

      const projectIdSet = new Set(projectIds);
      const sparkBy: Record<string, number[]> = {};
      for (const id of projectIds) sparkBy[id] = new Array(buckets.length).fill(0);
      for (const r of burnRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const idx = bucketIndex(buckets, new Date(r.date).getTime());
        if (idx < 0) continue;
        const reg = parseFloat(r.hoursRegular || "0") || 0;
        const ot = parseFloat(r.hoursOvertime || "0") || 0;
        sparkBy[r.projectId][idx] += (reg + ot * 1.5) * 50;
      }

      const cells = projectRows.map((p) => {
        const prof = profByCode.get(p.code);
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          pmName: pmNameOf(p),
          clientName: p.clientName,
          state: p.state,
          contractAmount: prof ? prof.adjusted_budget : Number(p.contractAmount || p.budget || 0),
          actualCost: prof ? prof.total_actual_cost : 0,
          forecastFinal: prof ? prof.forecast_final_cost : 0,
          variance: prof ? prof.variance : 0,
          variancePct: prof ? Math.round(prof.variance_percent * 10) / 10 : 0,
          margin: prof ? Math.round(prof.estimated_margin * 10) / 10 : 0,
          status_health: prof?.status || "ON_BUDGET",
          weeklyBurn: prof?.cost_prediction?.weekly_burn_rate ?? 0,
          sparkline: sparkBy[p.id] || [],
          group: groupKeyFor(p, filters.groupBy),
        };
      });

      const groupsMap = new Map<string, { key: string; label: string; cells: typeof cells }>();
      for (const c of cells) {
        if (!groupsMap.has(c.group.key))
          groupsMap.set(c.group.key, { key: c.group.key, label: c.group.label, cells: [] });
        groupsMap.get(c.group.key)!.cells.push(c);
      }

      const groups = Array.from(groupsMap.values()).map((g) => {
        const sumContract = g.cells.reduce((s, c) => s + c.contractAmount, 0);
        const sumActual = g.cells.reduce((s, c) => s + c.actualCost, 0);
        const sumForecast = g.cells.reduce((s, c) => s + c.forecastFinal, 0);
        const sumVariance = g.cells.reduce((s, c) => s + c.variance, 0);
        return {
          key: g.key,
          label: g.label,
          cells: g.cells,
          summary: {
            projectCount: g.cells.length,
            totalContract: Math.round(sumContract),
            totalActual: Math.round(sumActual),
            totalForecast: Math.round(sumForecast),
            totalVariance: Math.round(sumVariance),
            variancePct: sumContract > 0 ? Math.round((sumVariance / sumContract) * 1000) / 10 : 0,
          },
        };
      });
      groups.sort((a, b) => a.label.localeCompare(b.label));

      const totals = {
        projectCount: cells.length,
        totalContract: Math.round(cells.reduce((s, c) => s + c.contractAmount, 0)),
        totalActual: Math.round(cells.reduce((s, c) => s + c.actualCost, 0)),
        totalForecast: Math.round(cells.reduce((s, c) => s + c.forecastFinal, 0)),
        totalVariance: Math.round(cells.reduce((s, c) => s + c.variance, 0)),
      };

      res.json({ groupBy: filters.groupBy, groups, totals, generatedAt: new Date().toISOString() });
    } catch (err) {
      logError("portfolio.financial-rollup", err);
      next(err);
    }
  }
);

router.get(
  "/api/portfolio/summary-pdf",
  requireAuth,
  requireAnyFeaturePermission(...REQUIRED_PERMS),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const filters = parseFilters(req);
      // Force program grouping for the per-program PDF layout
      filters.groupBy = "program";
      const projectRows = await loadProjects(req, filters);
      if (projectRows === null) return res.status(403).json({ error: "Forbidden" });

      const projectCodeSet = new Set(projectRows.map((p) => p.code));
      const profitability = (await calculateAllProjectsProfitability().catch(() => []))
        .filter((p) => projectCodeSet.has(p.project_code));
      const profByCode = new Map(profitability.map((p) => [p.project_code, p]));

      const fmt = (n: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
      const generatedAt = new Date();

      const groupsMap = new Map<string, ProjectRow[]>();
      for (const p of projectRows) {
        const g = groupKeyFor(p, "program");
        if (!groupsMap.has(g.key)) groupsMap.set(g.key, []);
        groupsMap.get(g.key)!.push(p);
      }
      const programs = Array.from(groupsMap.entries())
        .map(([key, rows]) => ({
          key,
          label: groupKeyFor(rows[0], "program").label,
          rows,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

      const totalContract = profitability.reduce((s, p) => s + p.adjusted_budget, 0);
      const totalActual = profitability.reduce((s, p) => s + p.total_actual_cost, 0);
      const totalVariance = profitability.reduce((s, p) => s + p.variance, 0);

      const pageStyle = `
        body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #111; padding: 24px; margin: 0; }
        h1 { margin: 0 0 4px; font-size: 22px; }
        h2 { margin: 0 0 6px; font-size: 18px; }
        .meta { color: #555; font-size: 12px; margin-bottom: 18px; }
        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
        .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; }
        .kpi .label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .kpi .value { font-size: 18px; font-weight: 600; margin-top: 2px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
        th { background: #f7f7f7; font-weight: 600; }
        .program-page { page-break-after: always; }
        .program-page:last-child { page-break-after: auto; }
      `;

      const coverHtml = `
        <section class="program-page">
          <h1>Portfolio Summary</h1>
          <div class="meta">Generated ${generatedAt.toLocaleString()} · ${projectRows.length} projects · ${programs.length} programs</div>
          <div class="kpis">
            <div class="kpi"><div class="label">Projects</div><div class="value">${projectRows.length}</div></div>
            <div class="kpi"><div class="label">Contract</div><div class="value">${fmt(totalContract)}</div></div>
            <div class="kpi"><div class="label">Actual</div><div class="value">${fmt(totalActual)}</div></div>
            <div class="kpi"><div class="label">Variance</div><div class="value">${fmt(totalVariance)}</div></div>
          </div>
          <table>
            <thead><tr><th>Program</th><th style="text-align:right">Projects</th><th style="text-align:right">Contract</th><th style="text-align:right">Actual</th><th style="text-align:right">Variance</th></tr></thead>
            <tbody>
              ${programs.map((pg) => {
                const sumC = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.adjusted_budget || 0), 0);
                const sumA = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.total_actual_cost || 0), 0);
                const sumV = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.variance || 0), 0);
                return `<tr><td>${pg.label}</td><td style="text-align:right">${pg.rows.length}</td><td style="text-align:right">${fmt(sumC)}</td><td style="text-align:right">${fmt(sumA)}</td><td style="text-align:right">${fmt(sumV)}</td></tr>`;
              }).join("")}
            </tbody>
          </table>
        </section>
      `;

      const programPagesHtml = programs.map((pg) => {
        const sumC = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.adjusted_budget || 0), 0);
        const sumA = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.total_actual_cost || 0), 0);
        const sumV = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.variance || 0), 0);
        const projectRowsHtml = pg.rows.map((p) => {
          const prof = profByCode.get(p.code);
          const variance = prof ? prof.variance_percent.toFixed(1) + "%" : "—";
          return `<tr>
              <td>${p.code}</td>
              <td>${p.name}</td>
              <td>${p.status}</td>
              <td>${pmNameOf(p) ?? "—"}</td>
              <td style="text-align:right">${fmt(prof?.adjusted_budget || Number(p.contractAmount || 0))}</td>
              <td style="text-align:right">${fmt(prof?.total_actual_cost || 0)}</td>
              <td style="text-align:right">${variance}</td>
              <td>${prof?.status || "—"}</td>
            </tr>`;
        }).join("");
        return `
          <section class="program-page">
            <h2>${pg.label}</h2>
            <div class="meta">${pg.rows.length} projects · Contract ${fmt(sumC)} · Actual ${fmt(sumA)} · Variance ${fmt(sumV)}</div>
            <table>
              <thead><tr>
                <th>Code</th><th>Project</th><th>Status</th><th>PM</th>
                <th style="text-align:right">Budget</th><th style="text-align:right">Actual</th>
                <th style="text-align:right">Variance %</th><th>Health</th>
              </tr></thead>
              <tbody>${projectRowsHtml}</tbody>
            </table>
          </section>
        `;
      }).join("");

      const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Portfolio Summary</title>
<style>${pageStyle}</style></head>
<body>
  ${coverHtml}
  ${programPagesHtml}
</body></html>`;

      try {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ args: ["--no-sandbox"] });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "domcontentloaded" });
        const pdf = await page.pdf({ format: "Letter", margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" } });
        await browser.close();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="portfolio-summary-${generatedAt.toISOString().slice(0, 10)}.pdf"`);
        return res.send(pdf);
      } catch (pdfErr) {
        logError("portfolio.summary-pdf.playwright-fallback", pdfErr);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="portfolio-summary-${generatedAt.toISOString().slice(0, 10)}.html"`);
        return res.send(html);
      }
    } catch (err) {
      logError("portfolio.summary-pdf", err);
      next(err);
    }
  }
);

router.get(
  "/api/portfolio/owners",
  requireAuth,
  requireAnyFeaturePermission(...REQUIRED_PERMS),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgCtx = getOrgIdForFilter(req);
      if (orgCtx.mustDenyAccess) return res.status(403).json({ error: "Forbidden" });
      const where: any[] = [];
      if (orgCtx.shouldFilter && orgCtx.orgId) where.push(eq(projects.gcOrganizationId, orgCtx.orgId));
      const baseQ = db.selectDistinct({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(projects)
        .innerJoin(users, eq(projects.projectManagerId, users.id));
      const rows = where.length ? await baseQ.where(and(...where)) : await baseQ;
      const owners = rows
        .map((r) => ({ id: r.id, name: [r.firstName, r.lastName].filter(Boolean).join(" ") }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ owners });
    } catch (err) {
      logError("portfolio.owners", err);
      next(err);
    }
  }
);

export default router;
