/**
 * Task #2579 — Takeoff Phase D, Step 4: Bid hit-rate & estimated-vs-actual
 * dashboard.
 *
 * Backs `client/src/pages/bid-hit-rate.tsx` with a single aggregation
 * endpoint that reads from `bids` (status, geography, amounts) and
 * `projects` (final/actual cost when a bid converted into a project).
 *
 * Buckets:
 *   - by trade (client-supplied "tradeType"-equivalent — currently
 *     derived from the project's primary trade type when present, else
 *     "Unspecified")
 *   - by project type (uses `projects.projectType` when available,
 *     else "Unspecified")
 *   - by geography (state)
 *   - estimated-vs-actual variance per project (only for converted
 *     bids that now have an awarded amount + actuals on the project)
 *
 * Tenant scoping is via the existing `getOrgIdForFilter` helper — same
 * pattern as `bidRoutes.ts`. SUPER_ADMIN sees all orgs; everyone else
 * sees their own.
 */
import { Router } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { bids, projects } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

interface HitRateBucket {
  key: string;
  total: number;
  won: number;
  lost: number;
  pending: number;
  hitRate: number;
  totalValue: number;
  wonValue: number;
}

function emptyBucket(key: string): HitRateBucket {
  return {
    key,
    total: 0,
    won: 0,
    lost: 0,
    pending: 0,
    hitRate: 0,
    totalValue: 0,
    wonValue: 0,
  };
}

router.get(
  "/api/bids/analytics/hit-rate",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgIdForFilter(req);
      if (ctx.mustDenyAccess) {
        res.json({
          summary: {
            totalBids: 0,
            wonBids: 0,
            lostBids: 0,
            pendingBids: 0,
            hitRate: 0,
            totalEstimatedValue: 0,
            totalAwardedValue: 0,
          },
          byTrade: [],
          byProjectType: [],
          byState: [],
          variance: [],
        });
        return;
      }

      // Pull lean rows we need for in-memory bucketing. Aggregating in
      // SQL would require lots of CASE/SUM combos; for the realistic
      // bid volume this dashboard targets (low thousands per org)
      // grouping in app code is fine and keeps the SQL portable.
      const baseSelect = db
        .select({
          id: bids.id,
          status: bids.status,
          state: bids.state,
          city: bids.city,
          bidAmount: bids.bidAmount,
          convertedToProjectId: bids.convertedToProjectId,
        })
        .from(bids);
      const bidRows =
        !ctx.isSuperAdmin && ctx.orgId
          ? await baseSelect.where(eq(bids.gcOrganizationId, ctx.orgId))
          : await baseSelect;

      // Project metadata for converted bids — primary trade + type +
      // estimated/actual cost so we can fold variance.
      const projectIds = bidRows
        .map((b) => b.convertedToProjectId)
        .filter((id): id is string => !!id);

      type ProjectRow = {
        id: string;
        projectType: string | null;
        primaryTradeType: string | null;
        estimatedCost: string | null;
        actualCost: string | null;
        contractAmount: string | null;
      };
      let projectRows: ProjectRow[] = [];
      if (projectIds.length > 0) {
        // Use raw SQL fallback for columns that may or may not be
        // typed in the shared schema (estimatedCost / actualCost
        // exist in the DB; other variance-related columns vary by
        // tenant). Selecting only the ones we know exist on the
        // shared `projects` table.
        const rows = await db.execute<ProjectRow>(sql`
          SELECT id,
                 project_type AS "projectType",
                 primary_trade_type AS "primaryTradeType",
                 estimated_cost AS "estimatedCost",
                 actual_cost AS "actualCost",
                 contract_amount AS "contractAmount"
          FROM projects
          WHERE id = ANY(${projectIds})
        `);
        projectRows = rows.rows as ProjectRow[];
      }
      const projectsById = new Map(projectRows.map((p) => [p.id, p]));

      const summary = {
        totalBids: 0,
        wonBids: 0,
        lostBids: 0,
        pendingBids: 0,
        hitRate: 0,
        totalEstimatedValue: 0,
        totalAwardedValue: 0,
      };
      const byTrade = new Map<string, HitRateBucket>();
      const byProjectType = new Map<string, HitRateBucket>();
      const byState = new Map<string, HitRateBucket>();
      const variance: Array<{
        bidId: string;
        projectId: string;
        estimatedValue: number;
        actualValue: number;
        variance: number;
        variancePct: number;
      }> = [];

      const bump = (m: Map<string, HitRateBucket>, key: string, b: { won: boolean; lost: boolean; pending: boolean; value: number }) => {
        const k = key || "Unspecified";
        const cur = m.get(k) ?? emptyBucket(k);
        cur.total += 1;
        cur.totalValue += b.value;
        if (b.won) {
          cur.won += 1;
          cur.wonValue += b.value;
        } else if (b.lost) {
          cur.lost += 1;
        } else if (b.pending) {
          cur.pending += 1;
        }
        m.set(k, cur);
      };

      for (const bid of bidRows) {
        const value = Number(bid.bidAmount ?? 0) || 0;
        const won = bid.status === "AWARDED";
        const lost = bid.status === "LOST" || bid.status === "CANCELLED";
        const pending = !won && !lost;
        summary.totalBids += 1;
        summary.totalEstimatedValue += value;
        if (won) {
          summary.wonBids += 1;
          summary.totalAwardedValue += value;
        } else if (lost) {
          summary.lostBids += 1;
        } else {
          summary.pendingBids += 1;
        }

        const project = bid.convertedToProjectId
          ? projectsById.get(bid.convertedToProjectId) ?? null
          : null;
        const trade = project?.primaryTradeType ?? "Unspecified";
        const ptype = project?.projectType ?? "Unspecified";
        const state = bid.state || "Unspecified";

        bump(byTrade, trade, { won, lost, pending, value });
        bump(byProjectType, ptype, { won, lost, pending, value });
        bump(byState, state, { won, lost, pending, value });

        if (project && (project.estimatedCost || project.contractAmount) && project.actualCost) {
          const est = Number(project.estimatedCost ?? project.contractAmount ?? 0) || 0;
          const act = Number(project.actualCost ?? 0) || 0;
          if (est > 0) {
            variance.push({
              bidId: bid.id,
              projectId: project.id,
              estimatedValue: est,
              actualValue: act,
              variance: act - est,
              variancePct: ((act - est) / est) * 100,
            });
          }
        }
      }

      const finalize = (m: Map<string, HitRateBucket>): HitRateBucket[] =>
        Array.from(m.values())
          .map((b) => ({
            ...b,
            hitRate: b.total > 0 ? (b.won / b.total) * 100 : 0,
          }))
          .sort((a, b) => b.total - a.total);

      summary.hitRate =
        summary.totalBids > 0
          ? (summary.wonBids / summary.totalBids) * 100
          : 0;

      res.json({
        summary,
        byTrade: finalize(byTrade),
        byProjectType: finalize(byProjectType),
        byState: finalize(byState),
        variance: variance
          .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
          .slice(0, 50),
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
