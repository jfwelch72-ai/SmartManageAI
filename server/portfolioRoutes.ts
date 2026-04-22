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
  projectKpiSnapshots,
} from "@shared/schema";
import { rfiStatusEnum, changeOrderStatusEnum, punchListStatusEnum, projectStatusEnum } from "@shared/schema/enums";
import { requireAuth, requireAnyFeaturePermission, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { calculateAllProjectsProfitability } from "./ai/profitabilityEngine";
import { logError, logWarn } from "./utils/logger";
import {
  isPortfolioRendererAvailable,
  renderPortfolioSummaryPdf,
  isAllowedAssetUrl,
  getPortfolioRendererStatus,
  getPortfolioPdfHistory,
  getPortfolioPdfAlertConfig,
  updatePortfolioPdfAlertConfig,
  getPortfolioPdfAlertState,
  evaluatePortfolioPdfAlerts,
} from "./portfolio-pdf-service";
import {
  getPortfolioPdfAlertRecipientConfig,
  listPortfolioPdfAlertRecipients,
  addPortfolioPdfAlertRecipient,
  updatePortfolioPdfAlertRecipient,
  deletePortfolioPdfAlertRecipient,
  sendPortfolioPdfTestAlert,
  listPortfolioPdfAlertDeliveries,
  clearPortfolioPdfAlertDeliveries,
  PORTFOLIO_PDF_ALERT_DELIVERIES_RETENTION_MS,
} from "./portfolio-pdf-alerts";
import { z } from "zod";
import { getOrganizationBranding } from "./organizationBranding";

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
  programId: string | null;
  divisionId: string | null;
  primaryTradeType: string | null;
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
      programId: projects.programId,
      divisionId: projects.divisionId,
      primaryTradeType: projects.primaryTradeType,
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

interface SnapshotSeries {
  health: Record<string, number[]>;
  spi: Record<string, number[]>;
  cpi: Record<string, number[]>;
  burn: Record<string, number[]>;
}

function deltaVs(series: number[], weeksAgo: number): number | null {
  if (!series.length) return null;
  const lastIdx = series.length - 1;
  const refIdx = lastIdx - weeksAgo;
  if (refIdx < 0) return null;
  return Math.round((series[lastIdx] - series[refIdx]) * 100) / 100;
}

function pmNameOf(p: ProjectRow): string | null {
  if (!p.pmFirstName && !p.pmLastName) return null;
  return [p.pmFirstName, p.pmLastName].filter(Boolean).join(" ").trim() || null;
}

function groupKeyFor(p: ProjectRow, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "program": {
      // Task #900: prefer the explicit programId field; fall back to
      // clientName so existing data still groups sensibly until orgs
      // backfill the new column.
      const program = p.programId || p.clientName;
      return { key: program || "unassigned", label: program || "Unassigned Program" };
    }
    case "division": {
      const division = p.divisionId || p.state;
      return { key: division || "unassigned", label: division || "Unassigned Division" };
    }
    case "trade":
      // Task #900: when projects have an explicit primaryTradeType, group
      // by it; otherwise fall back to the legacy single bucket so existing
      // dashboard consumers see the same key/label they did before.
      return p.primaryTradeType
        ? { key: p.primaryTradeType, label: p.primaryTradeType.replace(/_/g, " ") }
        : { key: "__trade__", label: "Trade (data not yet captured)" };
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
      const earliestKey = buckets[0].key;

      const [openRfiRows, openCoRows, openPunchRows, scheduleAgg, sparkRfiRows, sparkCoRows, sparkPunchRows, snapshotRows] = await Promise.all([
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
        db.select({
            projectId: projectKpiSnapshots.projectId,
            weekStart: projectKpiSnapshots.weekStart,
            health: projectKpiSnapshots.health,
            spi: projectKpiSnapshots.spi,
            cpi: projectKpiSnapshots.cpi,
            burn: projectKpiSnapshots.burn,
          })
          .from(projectKpiSnapshots)
          .where(and(inArray(projectKpiSnapshots.projectId, projectIds), gte(projectKpiSnapshots.weekStart, earliestKey))),
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

      // Task #902: build the per-project KPI series from the weekly
      // snapshots table. The current values come from live data so the
      // most recent point reflects today.
      const liveKpis: Record<string, { health: number; spi: number; cpi: number; burn: number; variancePct: number; schedulePct: number; expectedPct: number; openRfis: number; openCos: number; openPunch: number }> = {};
      for (const p of projectRows) {
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
        const spi = expectedPct > 0 ? Math.round((schedulePct / expectedPct) * 100) / 100 : 1;
        const cpi = prof && prof.total_actual_cost > 0
          ? Math.round((prof.adjusted_budget / prof.total_actual_cost) * 100) / 100
          : 1;
        liveKpis[p.id] = { health, spi, cpi, burn: 0, variancePct, schedulePct, expectedPct, openRfis: openRfiCount, openCos: openCoCount, openPunch: openPunchCount };
      }

      const series: SnapshotSeries = { health: {}, spi: {}, cpi: {}, burn: {} };
      for (const id of projectIds) {
        const fallback = liveKpis[id] || { health: 0, spi: 1, cpi: 1, burn: 0 };
        series.health[id] = new Array(buckets.length).fill(fallback.health);
        series.spi[id] = new Array(buckets.length).fill(fallback.spi);
        series.cpi[id] = new Array(buckets.length).fill(fallback.cpi);
        series.burn[id] = new Array(buckets.length).fill(0);
      }
      const idxByKey = new Map(buckets.map((b, i) => [b.key, i]));
      const seenWeek: Record<string, boolean[]> = {};
      for (const id of projectIds) seenWeek[id] = new Array(buckets.length).fill(false);
      for (const r of snapshotRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const key = typeof r.weekStart === "string" ? r.weekStart : new Date(r.weekStart as unknown as string).toISOString().slice(0, 10);
        const i = idxByKey.get(key);
        if (i === undefined) continue;
        series.health[r.projectId][i] = Number(r.health) || 0;
        series.spi[r.projectId][i] = Number(r.spi) || 0;
        series.cpi[r.projectId][i] = Number(r.cpi) || 0;
        series.burn[r.projectId][i] = Number(r.burn) || 0;
        seenWeek[r.projectId][i] = true;
      }
      // Forward-fill missing weeks; pin the current week to live values
      // so today's calculation is always reflected on the trailing point.
      for (const id of projectIds) {
        let lastH = series.health[id][0];
        let lastS = series.spi[id][0];
        let lastC = series.cpi[id][0];
        for (let i = 0; i < buckets.length; i++) {
          if (seenWeek[id][i]) {
            lastH = series.health[id][i];
            lastS = series.spi[id][i];
            lastC = series.cpi[id][i];
          } else {
            series.health[id][i] = lastH;
            series.spi[id][i] = lastS;
            series.cpi[id][i] = lastC;
          }
        }
        const live = liveKpis[id];
        if (live) {
          const last = buckets.length - 1;
          series.health[id][last] = live.health;
          series.spi[id][last] = live.spi;
          series.cpi[id][last] = live.cpi;
        }
      }

      let cells = projectRows.map((p) => {
        const live = liveKpis[p.id];
        const sched = schedMap.get(p.id);
        const nextMilestone = sched?.nextMilestone ? new Date(sched.nextMilestone) : null;
        const daysToNext = nextMilestone
          ? Math.round((nextMilestone.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null;

        const healthSeries = series.health[p.id];
        const spiSeries = series.spi[p.id];
        const cpiSeries = series.cpi[p.id];

        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          pmName: pmNameOf(p),
          clientName: p.clientName,
          state: p.state,
          health: live.health,
          spi: live.spi,
          cpi: live.cpi,
          budgetVariancePct: Math.round(live.variancePct * 10) / 10,
          openRfis: live.openRfis,
          openCos: live.openCos,
          openPunch: live.openPunch,
          schedulePct: Math.round(live.schedulePct),
          expectedPct: Math.round(live.expectedPct),
          daysToNextMilestone: daysToNext,
          // Task #902: 12-week deltas vs 4 weeks ago and 12 weeks ago,
          // surfaced numerically on each card.
          deltas: {
            health: { fourWeek: deltaVs(healthSeries, 4), twelveWeek: deltaVs(healthSeries, 11) },
            spi: { fourWeek: deltaVs(spiSeries, 4), twelveWeek: deltaVs(spiSeries, 11) },
            cpi: { fourWeek: deltaVs(cpiSeries, 4), twelveWeek: deltaVs(cpiSeries, 11) },
          },
          // Per-KPI 12-week sparklines for the matrix view, sourced from
          // the weekly snapshots table for health/SPI/CPI.
          kpis: [
            { key: "health", label: "Health", value: live.health, sparkline: healthSeries, tab: "overview", delta4w: deltaVs(healthSeries, 4) },
            { key: "spi", label: "SPI", value: live.spi, sparkline: spiSeries, tab: "schedule", delta4w: deltaVs(spiSeries, 4) },
            { key: "cpi", label: "CPI", value: live.cpi, sparkline: cpiSeries, tab: "financials", delta4w: deltaVs(cpiSeries, 4) },
            { key: "rfis", label: "Open RFIs", value: live.openRfis, sparkline: sparkRfi[p.id], tab: "rfis" },
            { key: "cos", label: "Open COs", value: live.openCos, sparkline: sparkCo[p.id], tab: "change-orders" },
            { key: "punch", label: "Punch", value: live.openPunch, sparkline: sparkPunch[p.id], tab: "punch-list" },
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
      const earliestKey = buckets[0].key;
      const projectIdSet = new Set(projectIds);

      // Live current-week burn (in-progress) is summed from time entries
      // since the start of this week so the trailing point reflects real
      // activity, not just last night's snapshot.
      const currentWeekStart = buckets[buckets.length - 1].start;
      const [burnRows, snapshotRows] = await Promise.all([
        projectIds.length
          ? db
              .select({
                projectId: timeEntries.projectId,
                date: timeEntries.date,
                hoursRegular: timeEntries.hoursRegular,
                hoursOvertime: timeEntries.hoursOvertime,
              })
              .from(timeEntries)
              .where(and(inArray(timeEntries.projectId, projectIds), gte(timeEntries.date, currentWeekStart)))
          : Promise.resolve([] as Array<{ projectId: string; date: Date; hoursRegular: string | null; hoursOvertime: string | null }>),
        projectIds.length
          ? db
              .select({
                projectId: projectKpiSnapshots.projectId,
                weekStart: projectKpiSnapshots.weekStart,
                burn: projectKpiSnapshots.burn,
              })
              .from(projectKpiSnapshots)
              .where(and(inArray(projectKpiSnapshots.projectId, projectIds), gte(projectKpiSnapshots.weekStart, earliestKey)))
          : Promise.resolve([] as Array<{ projectId: string; weekStart: string; burn: string }>),
      ]);

      const sparkBy: Record<string, number[]> = {};
      for (const id of projectIds) sparkBy[id] = new Array(buckets.length).fill(0);
      const idxByKey = new Map(buckets.map((b, i) => [b.key, i]));
      for (const r of snapshotRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const key = typeof r.weekStart === "string" ? r.weekStart : new Date(r.weekStart as unknown as string).toISOString().slice(0, 10);
        const i = idxByKey.get(key);
        if (i === undefined) continue;
        sparkBy[r.projectId][i] = Number(r.burn) || 0;
      }
      // Overlay live current-week burn on the trailing bucket.
      const currentBurn: Record<string, number> = {};
      for (const r of burnRows) {
        if (!projectIdSet.has(r.projectId)) continue;
        const reg = parseFloat(r.hoursRegular || "0") || 0;
        const ot = parseFloat(r.hoursOvertime || "0") || 0;
        currentBurn[r.projectId] = (currentBurn[r.projectId] || 0) + (reg + ot * 1.5) * 50;
      }
      const lastIdx = buckets.length - 1;
      for (const id of projectIds) {
        if (currentBurn[id] !== undefined) sparkBy[id][lastIdx] = Math.round(currentBurn[id] * 100) / 100;
      }

      const cells = projectRows.map((p) => {
        const prof = profByCode.get(p.code);
        const burnSeries = sparkBy[p.id] || [];
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
          sparkline: burnSeries,
          // Task #902: 12-week burn deltas surfaced numerically per card.
          deltas: {
            burn: { fourWeek: deltaVs(burnSeries, 4), twelveWeek: deltaVs(burnSeries, 11) },
          },
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
      const escapeHtml = (s: string) =>
        String(s).replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c]!));
      const generatedAt = new Date();

      const branding = await getOrganizationBranding(req.user?.organizationId || "");
      const primary = branding.primaryColor || "#1a365d";
      const accent = branding.accentColor || "#2563eb";
      const allowedLogoOrigins = (process.env.PORTFOLIO_PDF_ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Only render the org logo if the URL is in our allowlist — defense in
      // depth on top of the renderer's network blocker. Otherwise we fall
      // back to a branded letter placeholder so the PDF still looks polished.
      const logoTag =
        branding.logoUrl && isAllowedAssetUrl(branding.logoUrl, allowedLogoOrigins)
          ? `<img src="${escapeHtml(branding.logoUrl)}" alt="logo" class="logo"/>`
          : `<div class="logo logo-placeholder">${escapeHtml((branding.organizationName || "S").slice(0, 1))}</div>`;

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
      const variancePct = totalContract > 0 ? (totalVariance / totalContract) * 100 : 0;

      const pageStyle = `
        @page { size: Letter; margin: 0.5in; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111827; margin: 0; }
        .header { display: flex; align-items: center; justify-content: space-between;
                  border-bottom: 3px solid ${primary}; padding-bottom: 12px; margin-bottom: 18px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { width: 48px; height: 48px; object-fit: contain; }
        .logo-placeholder { background: ${primary}; color: #fff; border-radius: 8px;
                            display: flex; align-items: center; justify-content: center;
                            font-weight: 700; font-size: 22px; }
        .brand-name { font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
        .brand-title { font-size: 22px; font-weight: 700; color: ${primary}; margin-top: 2px; }
        .header .meta { text-align: right; font-size: 11px; color: #6b7280; line-height: 1.4; }
        h2 { margin: 0 0 6px; font-size: 16px; color: ${primary}; }
        .section-meta { color: #6b7280; font-size: 11px; margin-bottom: 12px; }
        .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
        .kpi { border: 1px solid #e5e7eb; border-left: 3px solid ${accent}; border-radius: 6px; padding: 10px 12px; background: #fff; }
        .kpi .label { color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
        .kpi .value { font-size: 18px; font-weight: 600; margin-top: 4px; color: #111827; }
        .kpi .sub { font-size: 10px; color: #6b7280; margin-top: 2px; }
        .kpi.neg .value { color: #b91c1c; }
        .kpi.pos .value { color: #047857; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        th, td { border-bottom: 1px solid #eef0f3; padding: 6px 8px; text-align: left; vertical-align: top; }
        thead th { background: ${primary}; color: #fff; font-weight: 600; font-size: 10px;
                    text-transform: uppercase; letter-spacing: 0.04em; border-bottom: none; }
        tbody tr:nth-child(even) { background: #fafbfc; }
        tfoot td { font-weight: 600; background: #f3f4f6; border-top: 2px solid ${primary}; }
        .right { text-align: right; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 9px;
                 font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
                 background: #e5e7eb; color: #374151; }
        .badge.OVER_BUDGET, .badge.AT_RISK { background: #fee2e2; color: #b91c1c; }
        .badge.ON_BUDGET { background: #d1fae5; color: #047857; }
        .badge.UNDER_BUDGET { background: #dbeafe; color: #1d4ed8; }
        .program-page { page-break-after: always; }
        .program-page:last-child { page-break-after: auto; }
        .footer { margin-top: 14px; font-size: 9px; color: #9ca3af; text-align: center; }
      `;

      const renderHeader = (subtitle: string) => `
        <div class="header">
          <div class="brand">
            ${logoTag}
            <div>
              <div class="brand-name">${escapeHtml(branding.organizationName)}</div>
              <div class="brand-title">${escapeHtml(subtitle)}</div>
            </div>
          </div>
          <div class="meta">
            Generated ${escapeHtml(generatedAt.toLocaleString())}<br/>
            ${projectRows.length} projects · ${programs.length} programs
          </div>
        </div>`;

      const varianceClass = totalVariance > 0 ? "neg" : totalVariance < 0 ? "pos" : "";
      const coverHtml = `
        <section class="program-page">
          ${renderHeader("Portfolio Summary")}
          <div class="kpis">
            <div class="kpi"><div class="label">Projects</div><div class="value">${projectRows.length}</div><div class="sub">across ${programs.length} programs</div></div>
            <div class="kpi"><div class="label">Contract</div><div class="value">${fmt(totalContract)}</div></div>
            <div class="kpi"><div class="label">Actual to date</div><div class="value">${fmt(totalActual)}</div></div>
            <div class="kpi ${varianceClass}"><div class="label">Variance</div><div class="value">${fmt(totalVariance)}</div><div class="sub">${variancePct.toFixed(1)}% of contract</div></div>
          </div>
          <h2>Programs</h2>
          <table>
            <thead><tr>
              <th>Program</th>
              <th class="right">Projects</th>
              <th class="right">Contract</th>
              <th class="right">Actual</th>
              <th class="right">Variance</th>
              <th class="right">Var %</th>
            </tr></thead>
            <tbody>
              ${programs.map((pg) => {
                const sumC = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.adjusted_budget || 0), 0);
                const sumA = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.total_actual_cost || 0), 0);
                const sumV = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.variance || 0), 0);
                const vPct = sumC > 0 ? (sumV / sumC) * 100 : 0;
                return `<tr>
                  <td>${escapeHtml(pg.label)}</td>
                  <td class="right">${pg.rows.length}</td>
                  <td class="right">${fmt(sumC)}</td>
                  <td class="right">${fmt(sumA)}</td>
                  <td class="right">${fmt(sumV)}</td>
                  <td class="right">${vPct.toFixed(1)}%</td>
                </tr>`;
              }).join("")}
            </tbody>
            <tfoot><tr>
              <td>Total</td>
              <td class="right">${projectRows.length}</td>
              <td class="right">${fmt(totalContract)}</td>
              <td class="right">${fmt(totalActual)}</td>
              <td class="right">${fmt(totalVariance)}</td>
              <td class="right">${variancePct.toFixed(1)}%</td>
            </tr></tfoot>
          </table>
          <div class="footer">${escapeHtml(branding.organizationName)} · Portfolio Summary · Page 1</div>
        </section>
      `;

      const programPagesHtml = programs.map((pg, idx) => {
        const sumC = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.adjusted_budget || 0), 0);
        const sumA = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.total_actual_cost || 0), 0);
        const sumV = pg.rows.reduce((s, p) => s + (profByCode.get(p.code)?.variance || 0), 0);
        const vPct = sumC > 0 ? (sumV / sumC) * 100 : 0;
        const projectRowsHtml = pg.rows.map((p) => {
          const prof = profByCode.get(p.code);
          const variance = prof ? prof.variance_percent.toFixed(1) + "%" : "—";
          const health = prof?.status || "";
          return `<tr>
              <td>${escapeHtml(p.code)}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.status)}</td>
              <td>${escapeHtml(pmNameOf(p) ?? "—")}</td>
              <td class="right">${fmt(prof?.adjusted_budget || Number(p.contractAmount || 0))}</td>
              <td class="right">${fmt(prof?.total_actual_cost || 0)}</td>
              <td class="right">${variance}</td>
              <td>${health ? `<span class="badge ${escapeHtml(health)}">${escapeHtml(health.replace(/_/g, " "))}</span>` : "—"}</td>
            </tr>`;
        }).join("");
        return `
          <section class="program-page">
            ${renderHeader(pg.label)}
            <div class="kpis">
              <div class="kpi"><div class="label">Projects</div><div class="value">${pg.rows.length}</div></div>
              <div class="kpi"><div class="label">Contract</div><div class="value">${fmt(sumC)}</div></div>
              <div class="kpi"><div class="label">Actual</div><div class="value">${fmt(sumA)}</div></div>
              <div class="kpi ${sumV > 0 ? "neg" : sumV < 0 ? "pos" : ""}"><div class="label">Variance</div><div class="value">${fmt(sumV)}</div><div class="sub">${vPct.toFixed(1)}% of contract</div></div>
            </div>
            <h2>Project detail</h2>
            <table>
              <thead><tr>
                <th>Code</th><th>Project</th><th>Status</th><th>PM</th>
                <th class="right">Budget</th><th class="right">Actual</th>
                <th class="right">Var %</th><th>Health</th>
              </tr></thead>
              <tbody>${projectRowsHtml}</tbody>
            </table>
            <div class="footer">${escapeHtml(branding.organizationName)} · ${escapeHtml(pg.label)} · Page ${idx + 2}</div>
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

      const filenameBase = `portfolio-summary-${generatedAt.toISOString().slice(0, 10)}`;
      const isProduction = process.env.NODE_ENV === "production";
      const rendererAvailable = await isPortfolioRendererAvailable();

      if (!rendererAvailable) {
        if (isProduction) {
          logError("portfolio.summary-pdf.renderer-unavailable", {
            reason: "Chromium is not available in production",
          });
          return res.status(503).json({
            error: "Portfolio PDF renderer is unavailable",
            detail: "Chromium (Playwright) is not installed in this environment. Contact an administrator.",
          });
        }
        logWarn("portfolio.summary-pdf.html-fallback", {
          reason: "Chromium unavailable in non-production environment",
        });
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.html"`);
        return res.send(html);
      }

      try {
        const pdf = await renderPortfolioSummaryPdf(html);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
        return res.send(pdf);
      } catch (pdfErr) {
        logError(
          "portfolio.summary-pdf.render-failed",
          {},
          pdfErr instanceof Error ? pdfErr : new Error(String(pdfErr)),
        );
        if (isProduction) {
          return res.status(500).json({
            error: "Failed to render portfolio summary PDF",
          });
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.html"`);
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

const RENDERER_STATUS_REFRESH_MS = 30_000;
/**
 * @openapi
 * /api/portfolio/renderer-status:
 *   get:
 *     tags: [Portfolio]
 *     summary: Lightweight Portfolio PDF renderer availability check
 *     description: |
 *       Returns whether the Portfolio PDF renderer (headless Chromium) is
 *       currently available. Used by the Portfolio Rollup page to display a
 *       banner when exports are temporarily unavailable. The cached status is
 *       refreshed at most once every 30s to avoid launching a browser on
 *       every poll.
 *     responses:
 *       200: { description: Renderer availability snapshot }
 */
router.get(
  "/api/portfolio/renderer-status",
  requireAuth,
  requireAnyFeaturePermission(...REQUIRED_PERMS),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // The cached availability flag in portfolio-pdf-service is intentionally
      // non-sticky on negative results (it stays `null` so the next probe can
      // retry). Throttle probes strictly by `lastCheckedAt` so a sustained
      // outage doesn't cause us to launch Chromium on every poll. When the
      // cache is fresh, treat cached `true` as available and `null` (which
      // means the most recent probe failed) as offline.
      const cached = getPortfolioRendererStatus();
      const stale =
        cached.lastCheckedAt === null ||
        Date.now() - cached.lastCheckedAt > RENDERER_STATUS_REFRESH_MS;
      const available = stale
        ? await isPortfolioRendererAvailable()
        : cached.available === true;
      const status = getPortfolioRendererStatus();
      res.json({
        available,
        lastCheckedAt: status.lastCheckedAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/admin/portfolio-pdf/health:
 *   get:
 *     tags: [Admin]
 *     summary: Get Portfolio PDF renderer health status
 *     description: |
 *       Returns the cached availability status of the Portfolio PDF renderer
 *       (headless Chromium pool). Pass `?check=true` to force a fresh
 *       availability probe (launches and closes a throwaway browser). Requires
 *       SUPER_ADMIN.
 *     parameters:
 *       - name: check
 *         in: query
 *         required: false
 *         schema: { type: boolean }
 *     responses:
 *       200: { description: Renderer status snapshot }
 */
router.get(
  "/api/admin/portfolio-pdf/health",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const force =
        String(req.query.check ?? "").toLowerCase() === "true" ||
        req.query.check === "1";
      if (force) {
        await isPortfolioRendererAvailable();
      }
      const status = getPortfolioRendererStatus();
      res.json({
        available: status.available,
        error: status.error,
        lastCheckedAt: status.lastCheckedAt,
        cachedBrowser: status.cachedBrowser,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ===========================================================================
// Portfolio PDF render history + failure-rate / availability alerting
// (Task #940 — mirrors /api/admin/gantt-pdf/* for portfolio summary PDFs)
// ===========================================================================

router.get(
  "/api/admin/portfolio-pdf/history",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json(getPortfolioPdfHistory());
    } catch (error) {
      next(error);
    }
  },
);

const updatePortfolioAlertConfigSchema = z.object({
  enabled: z.boolean().optional(),
  evaluationWindowMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000).optional(),
  minSamples: z.number().int().min(1).max(1000).optional(),
  failureRatePct: z.number().min(0).max(100).optional(),
  avgDurationMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
  maxDurationMs: z.number().int().min(0).max(30 * 60 * 1000).optional(),
  cooldownMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

router.get(
  "/api/admin/portfolio-pdf/alerts",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const recipients = await getPortfolioPdfAlertRecipientConfig();
      res.json({
        config: getPortfolioPdfAlertConfig(),
        state: getPortfolioPdfAlertState(),
        recipients,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/api/admin/portfolio-pdf/alerts",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = updatePortfolioAlertConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid alert config", details: parsed.error.flatten() });
      }
      const config = updatePortfolioPdfAlertConfig(parsed.data);
      evaluatePortfolioPdfAlerts();
      const recipients = await getPortfolioPdfAlertRecipientConfig();
      res.json({ config, state: getPortfolioPdfAlertState(), recipients });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/api/admin/portfolio-pdf/alerts/evaluate",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const event = evaluatePortfolioPdfAlerts();
      res.json({ triggered: event !== null, event, state: getPortfolioPdfAlertState() });
    } catch (error) {
      next(error);
    }
  },
);

const portfolioRecipientEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Must be a valid email address");

const createPortfolioRecipientSchema = z.object({
  email: portfolioRecipientEmailSchema,
  notifyInApp: z.boolean().optional(),
});

const updatePortfolioRecipientSchema = z
  .object({
    email: portfolioRecipientEmailSchema.optional(),
    notifyInApp: z.boolean().optional(),
  })
  .refine((v) => v.email !== undefined || v.notifyInApp !== undefined, {
    message: "At least one of email or notifyInApp is required",
  });

router.get(
  "/api/admin/portfolio-pdf/alert-recipients",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const [rows, config] = await Promise.all([
        listPortfolioPdfAlertRecipients(),
        getPortfolioPdfAlertRecipientConfig(),
      ]);
      res.json({ recipients: rows, config });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/api/admin/portfolio-pdf/alert-recipients",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = createPortfolioRecipientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid recipient", details: parsed.error.flatten() });
      }
      try {
        const row = await addPortfolioPdfAlertRecipient(parsed.data);
        res.status(201).json({ recipient: row });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/duplicate key|unique/i.test(msg)) {
          return res
            .status(409)
            .json({ error: "A recipient with that email already exists" });
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/api/admin/portfolio-pdf/alert-recipients/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = updatePortfolioRecipientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "Invalid update", details: parsed.error.flatten() });
      }
      try {
        const row = await updatePortfolioPdfAlertRecipient(req.params.id, parsed.data);
        if (!row) return res.status(404).json({ error: "Recipient not found" });
        res.json({ recipient: row });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/duplicate key|unique/i.test(msg)) {
          return res
            .status(409)
            .json({ error: "A recipient with that email already exists" });
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/api/admin/portfolio-pdf/alert-recipients/test",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const triggeredBy = req.user?.email || req.user?.id || null;
      const result = await sendPortfolioPdfTestAlert({ triggeredBy });
      if (result.recipientCount === 0) {
        return res.status(409).json({
          error:
            "No recipients are currently configured. Add a recipient, set PORTFOLIO_PDF_ALERT_EMAILS, or ensure an active super admin exists.",
          recipientCount: 0,
          sentAt: result.sentAt,
        });
      }
      res.json({
        ok: true,
        recipientCount: result.recipientCount,
        recipients: result.recipients,
        sentAt: result.sentAt,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/api/admin/portfolio-pdf/alert-recipients/:id",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const removed = await deletePortfolioPdfAlertRecipient(req.params.id);
      if (!removed) return res.status(404).json({ error: "Recipient not found" });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

const ALLOWED_PORTFOLIO_DELIVERY_KINDS = new Set([
  "renderer_unavailable",
  "renderer_recovered",
  "browser_disconnected",
  "failure_rate",
  "test_alert",
]);

function parsePortfolioDeliveryKindsParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const cleaned = values
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && ALLOWED_PORTFOLIO_DELIVERY_KINDS.has(v));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
}

function parsePortfolioDeliverySuccessParam(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toLowerCase();
  if (v === "true" || v === "success" || v === "delivered" || v === "1") return true;
  if (v === "false" || v === "failed" || v === "failure" || v === "0") return false;
  return undefined;
}

router.get(
  "/api/admin/portfolio-pdf/alert-deliveries",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
      const kinds = parsePortfolioDeliveryKindsParam(req.query.kind);
      const emailSuccess = parsePortfolioDeliverySuccessParam(req.query.success);
      const sinceMsRaw = Number(req.query.sinceMs);
      const sinceMs =
        Number.isFinite(sinceMsRaw) && sinceMsRaw > 0 ? sinceMsRaw : undefined;
      const deliveries = await listPortfolioPdfAlertDeliveries({
        limit,
        kinds,
        emailSuccess,
        sinceMs,
      });
      res.json({
        deliveries,
        retentionMs: PORTFOLIO_PDF_ALERT_DELIVERIES_RETENTION_MS,
        filters: {
          kinds: kinds ?? null,
          emailSuccess: emailSuccess ?? null,
          sinceMs: sinceMs ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/api/admin/portfolio-pdf/alert-deliveries",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const olderThanMsRaw = Number(req.query.olderThanMs);
      const olderThanMs =
        Number.isFinite(olderThanMsRaw) && olderThanMsRaw > 0
          ? olderThanMsRaw
          : undefined;
      const removed = await clearPortfolioPdfAlertDeliveries(
        olderThanMs ? { olderThanMs } : undefined,
      );
      res.json({ ok: true, removed, olderThanMs: olderThanMs ?? null });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
