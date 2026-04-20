import { Router } from "express";
import { db } from "./db";
import { crmOpportunities, users, crmTasks } from "@shared/schema";
import { and, eq, gte, lte, isNotNull, sql, ne } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
const ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"] as const;

const STAGES = ["LEAD", "QUALIFIED", "ESTIMATING", "BID_SUBMITTED", "NEGOTIATION", "WON", "LOST"] as const;

router.get("/api/crm/analytics/dashboard", requireAuth, requireRole(...ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    // Funnel: counts + total value per stage (open + closed)
    const funnel = await db.select({
      stage: crmOpportunities.stage,
      count: sql<number>`count(*)::int`,
      totalValue: sql<string>`coalesce(sum(${crmOpportunities.dealValue}), 0)`,
      weighted: sql<string>`coalesce(sum(${crmOpportunities.dealValue} * ${crmOpportunities.probability} / 100.0), 0)`,
    }).from(crmOpportunities)
      .where(eq(crmOpportunities.organizationId, orgId))
      .groupBy(crmOpportunities.stage);

    // Forecast: weighted pipeline value of OPEN deals by expected close month (next 6 months)
    const forecast = await db.select({
      month: sql<string>`to_char(date_trunc('month', ${crmOpportunities.expectedCloseDate}), 'YYYY-MM')`,
      weighted: sql<string>`coalesce(sum(${crmOpportunities.dealValue} * ${crmOpportunities.probability} / 100.0), 0)`,
      pipeline: sql<string>`coalesce(sum(${crmOpportunities.dealValue}), 0)`,
      count: sql<number>`count(*)::int`,
    }).from(crmOpportunities)
      .where(and(
        eq(crmOpportunities.organizationId, orgId),
        ne(crmOpportunities.stage, "WON"),
        ne(crmOpportunities.stage, "LOST"),
        isNotNull(crmOpportunities.expectedCloseDate),
      ))
      .groupBy(sql`date_trunc('month', ${crmOpportunities.expectedCloseDate})`)
      .orderBy(sql`date_trunc('month', ${crmOpportunities.expectedCloseDate})`);

    // Velocity: avg days to close (won) and avg deal age for open
    const velocityWon = await db.select({
      avgDaysToWin: sql<number>`coalesce(avg(extract(epoch from (${crmOpportunities.wonAt} - ${crmOpportunities.createdAt})) / 86400), 0)::float`,
      countWon: sql<number>`count(*)::int`,
      totalWonValue: sql<string>`coalesce(sum(${crmOpportunities.dealValue}), 0)`,
    }).from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, orgId), eq(crmOpportunities.stage, "WON"), isNotNull(crmOpportunities.wonAt)));

    // Leaderboard: rep won-this-quarter + open pipeline
    const leaderboard = await db.select({
      userId: crmOpportunities.assignedToId,
      firstName: users.firstName,
      lastName: users.lastName,
      wonValue: sql<string>`coalesce(sum(case when ${crmOpportunities.stage} = 'WON' then ${crmOpportunities.dealValue} else 0 end), 0)`,
      wonCount: sql<number>`count(case when ${crmOpportunities.stage} = 'WON' then 1 end)::int`,
      lostCount: sql<number>`count(case when ${crmOpportunities.stage} = 'LOST' then 1 end)::int`,
      openValue: sql<string>`coalesce(sum(case when ${crmOpportunities.stage} not in ('WON','LOST') then ${crmOpportunities.dealValue} else 0 end), 0)`,
      openCount: sql<number>`count(case when ${crmOpportunities.stage} not in ('WON','LOST') then 1 end)::int`,
    }).from(crmOpportunities)
      .leftJoin(users, eq(crmOpportunities.assignedToId, users.id))
      .where(and(eq(crmOpportunities.organizationId, orgId), isNotNull(crmOpportunities.assignedToId)))
      .groupBy(crmOpportunities.assignedToId, users.firstName, users.lastName);

    // Lost reasons breakdown
    const lostReasons = await db.select({
      category: crmOpportunities.lostCategory,
      count: sql<number>`count(*)::int`,
      lostValue: sql<string>`coalesce(sum(${crmOpportunities.dealValue}), 0)`,
    }).from(crmOpportunities)
      .where(and(eq(crmOpportunities.organizationId, orgId), eq(crmOpportunities.stage, "LOST")))
      .groupBy(crmOpportunities.lostCategory);

    // Source effectiveness
    const sources = await db.select({
      source: crmOpportunities.source,
      total: sql<number>`count(*)::int`,
      won: sql<number>`count(case when ${crmOpportunities.stage} = 'WON' then 1 end)::int`,
      wonValue: sql<string>`coalesce(sum(case when ${crmOpportunities.stage} = 'WON' then ${crmOpportunities.dealValue} else 0 end), 0)`,
    }).from(crmOpportunities)
      .where(eq(crmOpportunities.organizationId, orgId))
      .groupBy(crmOpportunities.source);

    // Tasks summary org-wide
    const tasksSummary = await db.select({
      status: crmTasks.status,
      count: sql<number>`count(*)::int`,
    }).from(crmTasks).where(eq(crmTasks.organizationId, orgId)).groupBy(crmTasks.status);

    // Headline KPIs
    const totalOpenValue = funnel.filter(f => f.stage !== "WON" && f.stage !== "LOST").reduce((s, f) => s + Number(f.totalValue || 0), 0);
    const totalWeighted = funnel.filter(f => f.stage !== "WON" && f.stage !== "LOST").reduce((s, f) => s + Number(f.weighted || 0), 0);
    const wonCount = funnel.find(f => f.stage === "WON")?.count ?? 0;
    const lostCount = funnel.find(f => f.stage === "LOST")?.count ?? 0;
    const winRate = wonCount + lostCount > 0 ? (wonCount / (wonCount + lostCount)) * 100 : 0;

    res.json({
      kpis: {
        openPipeline: totalOpenValue,
        weightedPipeline: totalWeighted,
        wonCount,
        lostCount,
        winRate: Math.round(winRate * 10) / 10,
        avgDaysToWin: Math.round((velocityWon[0]?.avgDaysToWin ?? 0) * 10) / 10,
      },
      funnel: STAGES.map(s => {
        const f = funnel.find(x => x.stage === s);
        return { stage: s, count: f?.count ?? 0, totalValue: Number(f?.totalValue ?? 0), weighted: Number(f?.weighted ?? 0) };
      }),
      forecast: forecast.map(f => ({ month: f.month, weighted: Number(f.weighted), pipeline: Number(f.pipeline), count: f.count })),
      leaderboard: leaderboard.map(l => ({
        userId: l.userId,
        name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() || "Unassigned",
        wonValue: Number(l.wonValue),
        wonCount: l.wonCount,
        lostCount: l.lostCount,
        openValue: Number(l.openValue),
        openCount: l.openCount,
        winRate: l.wonCount + l.lostCount > 0 ? Math.round((l.wonCount / (l.wonCount + l.lostCount)) * 1000) / 10 : 0,
      })).sort((a, b) => b.wonValue - a.wonValue),
      lostReasons: lostReasons.map(l => ({ category: l.category ?? "UNCATEGORIZED", count: l.count, lostValue: Number(l.lostValue) })),
      sources: sources.map(s => ({
        source: s.source ?? "UNKNOWN",
        total: s.total,
        won: s.won,
        wonValue: Number(s.wonValue),
        winRate: s.total > 0 ? Math.round((s.won / s.total) * 1000) / 10 : 0,
      })),
      tasks: tasksSummary,
    });
  } catch (e) { next(e); }
});

export default router;
