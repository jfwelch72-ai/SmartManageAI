/**
 * Task #2628 — AI takeoff calibration feedback loop.
 *
 * Closes the loop between user reviews on `ai_takeoff_suggestions` and
 * the next AI draft:
 *
 *   1. `runCalibrationAggregator` (nightly) walks each AI_ESTIMATOR-
 *      enabled org, rebuilds a curated few-shot exemplar set per
 *      (org, trade), proposes per-trade `quantity_bias` nudges when the
 *      team has consistently scaled AI quantities up or down, and
 *      writes a daily accuracy snapshot row.
 *   2. `loadCalibrationExemplars` + `formatExemplarsForPrompt` are the
 *      retrieval/format helpers consumed by `takeoffDraft.ts` and
 *      `mapReduceDraft.ts` to inject the exemplars into the prompt.
 *   3. `acceptCalibrationNudge` writes the accepted factor into
 *      `ai_estimator_org_factors.tradeCalibrationFactors` so the next
 *      draft picks it up via `formatTradeCalibrationFactorsForPrompt`.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorAccuracySnapshots,
  aiEstimatorCalibrationExemplars,
  aiEstimatorCalibrationNudges,
  aiEstimatorOrgFactors,
  aiTakeoffSuggestions,
  organizations,
  type AiEstimatorAccuracySnapshot,
  type AiEstimatorCalibrationExemplar,
  type AiEstimatorCalibrationNudge,
  type AiTakeoffSuggestion,
  type InsertAiEstimatorCalibrationExemplar,
} from "@shared/schema";
import { isFeatureEnabled } from "../featureFlagService";
import { logError, logInfo } from "../../utils/logger";

const WINDOW_DAYS = 30;
const EXEMPLARS_PER_KIND = 5;
const NUDGE_MIN_EDITS = 10;
const NUDGE_MIN_BIAS = 0.05;
const RATIO_FLOOR = 0.1;
const RATIO_CEILING = 10;

export interface CalibrationAggregatorSummary {
  orgsConsidered: number;
  orgsRefreshed: number;
  exemplarsWritten: number;
  nudgesProposed: number;
  snapshotsWritten: number;
  durationMs: number;
}

export interface CalibrationAggregatorOrgResult {
  exemplarsWritten: number;
  nudgesProposed: number;
  snapshotsWritten: number;
}

interface AggregateStats {
  total: number;
  accepted: number;
  edited: number;
  rejected: number;
  acceptanceRate: number | null;
  mape: number | null;
}

function computeStats(items: readonly AiTakeoffSuggestion[]): AggregateStats {
  const total = items.length;
  let accepted = 0;
  let edited = 0;
  let rejected = 0;
  const mapeValues: number[] = [];
  for (const i of items) {
    if (i.status === "ACCEPTED") accepted++;
    else if (i.status === "EDITED") edited++;
    else if (i.status === "REJECTED") rejected++;
    if (
      i.status === "EDITED" &&
      typeof i.editedQuantity === "number" &&
      typeof i.quantity === "number" &&
      i.quantity > 0
    ) {
      mapeValues.push(Math.abs((i.editedQuantity - i.quantity) / i.quantity));
    }
  }
  const reviewed = accepted + edited + rejected;
  const acceptanceRate = reviewed > 0 ? (accepted + edited) / reviewed : null;
  const mape =
    mapeValues.length > 0
      ? mapeValues.reduce((a, b) => a + b, 0) / mapeValues.length
      : null;
  return { total, accepted, edited, rejected, acceptanceRate, mape };
}

async function upsertSnapshot(
  orgId: string,
  tradeType: string | null,
  start: Date,
  end: Date,
  s: AggregateStats,
): Promise<void> {
  // Day-level idempotency: collapse to one row per (org, trade) per UTC
  // day so manual + cron triggers don't duplicate snapshots.
  const dayStart = new Date(end);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const tradeMatch = tradeType
    ? eq(aiEstimatorAccuracySnapshots.tradeType, tradeType)
    : sql`${aiEstimatorAccuracySnapshots.tradeType} IS NULL`;
  const [existing] = await db
    .select({ id: aiEstimatorAccuracySnapshots.id })
    .from(aiEstimatorAccuracySnapshots)
    .where(
      and(
        eq(aiEstimatorAccuracySnapshots.organizationId, orgId),
        tradeMatch,
        gte(aiEstimatorAccuracySnapshots.windowEnd, dayStart),
        sql`${aiEstimatorAccuracySnapshots.windowEnd} < ${dayEnd}`,
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(aiEstimatorAccuracySnapshots)
      .set({
        windowStart: start,
        windowEnd: end,
        totalSuggestions: s.total,
        acceptedCount: s.accepted,
        editedCount: s.edited,
        rejectedCount: s.rejected,
        acceptanceRate: s.acceptanceRate,
        mape: s.mape,
      })
      .where(eq(aiEstimatorAccuracySnapshots.id, existing.id));
  } else {
    await db.insert(aiEstimatorAccuracySnapshots).values({
      organizationId: orgId,
      tradeType,
      windowStart: start,
      windowEnd: end,
      totalSuggestions: s.total,
      acceptedCount: s.accepted,
      editedCount: s.edited,
      rejectedCount: s.rejected,
      acceptanceRate: s.acceptanceRate,
      mape: s.mape,
    });
  }
}

export async function runCalibrationAggregatorForOrg(
  orgId: string,
  opts: { now?: Date } = {},
): Promise<CalibrationAggregatorOrgResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

  const rows = await db
    .select()
    .from(aiTakeoffSuggestions)
    .where(
      and(
        eq(aiTakeoffSuggestions.organizationId, orgId),
        gte(aiTakeoffSuggestions.reviewedAt, since),
      ),
    );

  const byTrade = new Map<string, AiTakeoffSuggestion[]>();
  for (const r of rows) {
    if (!r.reviewedAt) continue;
    const key = r.tradeType;
    const arr = byTrade.get(key) ?? [];
    arr.push(r);
    byTrade.set(key, arr);
  }

  let exemplarsWritten = 0;
  let nudgesProposed = 0;
  let snapshotsWritten = 0;

  // Replace exemplars wholesale per org so stale rows can't linger after
  // a user reverses an earlier review.
  await db
    .delete(aiEstimatorCalibrationExemplars)
    .where(eq(aiEstimatorCalibrationExemplars.organizationId, orgId));

  for (const [trade, items] of byTrade) {
    const sortedDesc = items
      .slice()
      .sort(
        (a, b) =>
          (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0),
      );
    const accepted = sortedDesc
      .filter((i) => i.status === "ACCEPTED")
      .slice(0, EXEMPLARS_PER_KIND);
    const edited = sortedDesc
      .filter((i) => i.status === "EDITED")
      .slice(0, EXEMPLARS_PER_KIND);
    const rejected = sortedDesc
      .filter((i) => i.status === "REJECTED")
      .slice(0, EXEMPLARS_PER_KIND);

    const exemplarRows: InsertAiEstimatorCalibrationExemplar[] = [];
    for (const r of accepted) {
      exemplarRows.push({
        organizationId: orgId,
        tradeType: trade,
        kind: "ACCEPTED",
        label: r.description,
        itemType: r.itemType,
        unit: r.unit,
        originalQuantity: r.quantity,
        finalQuantity: r.quantity,
        sourceSuggestionId: r.id,
      });
    }
    for (const r of edited) {
      exemplarRows.push({
        organizationId: orgId,
        tradeType: trade,
        kind: "EDITED",
        label: r.description,
        itemType: r.editedItemType ?? r.itemType,
        unit: r.editedUnit ?? r.unit,
        originalQuantity: r.quantity,
        finalQuantity: r.editedQuantity ?? r.quantity,
        sourceSuggestionId: r.id,
      });
    }
    for (const r of rejected) {
      exemplarRows.push({
        organizationId: orgId,
        tradeType: trade,
        kind: "REJECTED",
        label: r.description,
        itemType: r.itemType,
        unit: r.unit,
        originalQuantity: r.quantity,
        rejectReason: r.rejectReason ?? null,
        comment: r.rejectNote ?? null,
        sourceSuggestionId: r.id,
      });
    }
    if (exemplarRows.length > 0) {
      await db.insert(aiEstimatorCalibrationExemplars).values(exemplarRows);
      exemplarsWritten += exemplarRows.length;
    }

    // Quantity-bias nudge: average ratio of editedQuantity / quantity.
    const ratios: number[] = [];
    for (const r of items) {
      if (r.status !== "EDITED") continue;
      if (
        typeof r.editedQuantity !== "number" ||
        typeof r.quantity !== "number" ||
        r.quantity <= 0
      ) {
        continue;
      }
      const ratio = r.editedQuantity / r.quantity;
      if (Number.isFinite(ratio) && ratio > RATIO_FLOOR && ratio < RATIO_CEILING) {
        ratios.push(ratio);
      }
    }
    if (ratios.length >= NUDGE_MIN_EDITS) {
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      if (Math.abs(mean - 1) >= NUDGE_MIN_BIAS) {
        const [existing] = await db
          .select({ id: aiEstimatorCalibrationNudges.id })
          .from(aiEstimatorCalibrationNudges)
          .where(
            and(
              eq(aiEstimatorCalibrationNudges.organizationId, orgId),
              eq(aiEstimatorCalibrationNudges.tradeType, trade),
              eq(aiEstimatorCalibrationNudges.metric, "quantity_bias"),
              eq(aiEstimatorCalibrationNudges.status, "PENDING"),
            ),
          )
          .limit(1);
        if (!existing) {
          const pct = ((mean - 1) * 100).toFixed(1);
          await db.insert(aiEstimatorCalibrationNudges).values({
            organizationId: orgId,
            tradeType: trade,
            metric: "quantity_bias",
            unit: null,
            suggestedFactor: Number(mean.toFixed(4)),
            basis:
              `Based on ${ratios.length} EDITED ${trade} suggestions in the last ` +
              `${WINDOW_DAYS} days, your team adjusted AI quantities by an average ` +
              `factor of ${mean.toFixed(3)} (${pct}%).`,
            sampleSize: ratios.length,
          });
          nudgesProposed++;
        }
      }
    }

    await upsertSnapshot(orgId, trade, since, now, computeStats(items));
    snapshotsWritten++;
  }

  await upsertSnapshot(orgId, null, since, now, computeStats(rows));
  snapshotsWritten++;

  return { exemplarsWritten, nudgesProposed, snapshotsWritten };
}

export async function runCalibrationAggregator(
  opts: { now?: Date } = {},
): Promise<CalibrationAggregatorSummary> {
  const startedAt = Date.now();
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.isActive, true));
  const summary: CalibrationAggregatorSummary = {
    orgsConsidered: 0,
    orgsRefreshed: 0,
    exemplarsWritten: 0,
    nudgesProposed: 0,
    snapshotsWritten: 0,
    durationMs: 0,
  };
  for (const org of orgs) {
    summary.orgsConsidered++;
    try {
      const enabled = await isFeatureEnabled(org.id, "AI_ESTIMATOR");
      if (!enabled) continue;
      const out = await runCalibrationAggregatorForOrg(org.id, opts);
      summary.orgsRefreshed++;
      summary.exemplarsWritten += out.exemplarsWritten;
      summary.nudgesProposed += out.nudgesProposed;
      summary.snapshotsWritten += out.snapshotsWritten;
    } catch (err) {
      logError("AI takeoff calibration aggregator failed for org", {
        orgId: org.id,
        error: String(err),
      });
    }
  }
  summary.durationMs = Date.now() - startedAt;
  logInfo("AI takeoff calibration aggregator tick", summary);
  return summary;
}

// ---------------------------------------------------------------------
// Retrieval + formatting for prompt injection
// ---------------------------------------------------------------------

export async function loadCalibrationExemplars(opts: {
  organizationId: string;
  tradeType?: string | null;
  limit?: number;
}): Promise<AiEstimatorCalibrationExemplar[]> {
  const conds = [
    eq(aiEstimatorCalibrationExemplars.organizationId, opts.organizationId),
  ];
  if (opts.tradeType) {
    conds.push(eq(aiEstimatorCalibrationExemplars.tradeType, opts.tradeType));
  }
  return db
    .select()
    .from(aiEstimatorCalibrationExemplars)
    .where(and(...conds))
    .orderBy(desc(aiEstimatorCalibrationExemplars.generatedAt))
    .limit(Math.min(opts.limit ?? 15, 30));
}

export function formatExemplarsForPrompt(
  exemplars: readonly AiEstimatorCalibrationExemplar[],
): string {
  if (exemplars.length === 0) return "";
  const accepted = exemplars
    .filter((e) => e.kind === "ACCEPTED")
    .slice(0, EXEMPLARS_PER_KIND);
  const edited = exemplars
    .filter((e) => e.kind === "EDITED")
    .slice(0, EXEMPLARS_PER_KIND);
  const rejected = exemplars
    .filter((e) => e.kind === "REJECTED")
    .slice(0, EXEMPLARS_PER_KIND);
  const lines: string[] = [
    "Calibration exemplars from this team's prior takeoff reviews. Treat as soft guidance — match the style of accepted items, avoid the patterns of rejected ones, and bias toward the corrected quantities of edited items:",
  ];
  if (accepted.length) {
    lines.push("Accepted (good detections):");
    for (const e of accepted) {
      const qty = e.finalQuantity ?? e.originalQuantity;
      lines.push(
        `- ${e.label} = ${qty ?? "?"} ${e.unit ?? ""}`.trim(),
      );
    }
  }
  if (edited.length) {
    lines.push("Edited (model directionally right but quantity off):");
    for (const e of edited) {
      const oq = e.originalQuantity;
      const fq = e.finalQuantity;
      const delta =
        typeof oq === "number" && typeof fq === "number" && oq > 0
          ? `${oq} → ${fq} (factor ${(fq / oq).toFixed(2)})`
          : `${oq ?? "?"} → ${fq ?? "?"}`;
      lines.push(`- ${e.label} ${e.unit ?? ""}: ${delta}`.trim());
    }
  }
  if (rejected.length) {
    lines.push("Rejected (do NOT emit anything like these):");
    for (const e of rejected) {
      const reason = e.rejectReason ? ` (reason: ${e.rejectReason})` : "";
      lines.push(`- ${e.label}${reason}`);
    }
  }
  const text = lines.join("\n");
  return text.length > 3000 ? text.slice(0, 3000) + "…" : text;
}

interface TradeCalibrationFactor {
  quantity_bias?: number;
}
type TradeCalibrationFactorsMap = Record<string, TradeCalibrationFactor>;

function isFactorMap(v: unknown): v is TradeCalibrationFactorsMap {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function loadTradeCalibrationFactors(
  organizationId: string,
): Promise<TradeCalibrationFactorsMap> {
  const [row] = await db
    .select({ factors: aiEstimatorOrgFactors.tradeCalibrationFactors })
    .from(aiEstimatorOrgFactors)
    .where(eq(aiEstimatorOrgFactors.organizationId, organizationId))
    .limit(1);
  const raw = row?.factors;
  return isFactorMap(raw) ? (raw as TradeCalibrationFactorsMap) : {};
}

export function formatTradeCalibrationFactorsForPrompt(
  factors: TradeCalibrationFactorsMap,
  tradeType?: string | null,
): string {
  const entries = Object.entries(factors).filter(([trade, f]) => {
    if (!isFactorMap(f) && typeof f !== "object") return false;
    const qb = (f as TradeCalibrationFactor).quantity_bias;
    if (typeof qb !== "number" || !Number.isFinite(qb)) return false;
    if (tradeType && trade !== tradeType) return false;
    return true;
  });
  if (entries.length === 0) return "";
  const lines = [
    "Per-trade calibration factors learned from this team's accepted nudges. Apply these as a final scaling pass on quantities you emit:",
  ];
  for (const [trade, f] of entries) {
    const qb = (f as TradeCalibrationFactor).quantity_bias!;
    const pct = ((qb - 1) * 100).toFixed(1);
    lines.push(`- ${trade}: scale quantities by ${qb.toFixed(3)}x (${pct}%).`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// Nudge admin operations
// ---------------------------------------------------------------------

export async function listPendingNudges(
  organizationId: string,
): Promise<AiEstimatorCalibrationNudge[]> {
  return db
    .select()
    .from(aiEstimatorCalibrationNudges)
    .where(
      and(
        eq(aiEstimatorCalibrationNudges.organizationId, organizationId),
        eq(aiEstimatorCalibrationNudges.status, "PENDING"),
      ),
    )
    .orderBy(desc(aiEstimatorCalibrationNudges.createdAt));
}

export async function listAccuracyTrend(opts: {
  organizationId: string;
  tradeType?: string | null;
  limit?: number;
}): Promise<AiEstimatorAccuracySnapshot[]> {
  const conds = [
    eq(aiEstimatorAccuracySnapshots.organizationId, opts.organizationId),
  ];
  if (opts.tradeType !== undefined) {
    conds.push(
      opts.tradeType === null
        ? (sql`${aiEstimatorAccuracySnapshots.tradeType} IS NULL` as ReturnType<typeof eq>)
        : eq(aiEstimatorAccuracySnapshots.tradeType, opts.tradeType),
    );
  }
  return db
    .select()
    .from(aiEstimatorAccuracySnapshots)
    .where(and(...conds))
    .orderBy(desc(aiEstimatorAccuracySnapshots.windowEnd))
    .limit(Math.min(opts.limit ?? 90, 365));
}

export async function acceptCalibrationNudge(
  organizationId: string,
  nudgeId: string,
  reviewerId: string,
): Promise<AiEstimatorCalibrationNudge | null> {
  const [nudge] = await db
    .select()
    .from(aiEstimatorCalibrationNudges)
    .where(
      and(
        eq(aiEstimatorCalibrationNudges.id, nudgeId),
        eq(aiEstimatorCalibrationNudges.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!nudge || nudge.status !== "PENDING") return nudge ?? null;

  const [factorsRow] = await db
    .select({
      id: aiEstimatorOrgFactors.id,
      factors: aiEstimatorOrgFactors.tradeCalibrationFactors,
    })
    .from(aiEstimatorOrgFactors)
    .where(eq(aiEstimatorOrgFactors.organizationId, organizationId))
    .limit(1);
  const existing: TradeCalibrationFactorsMap = isFactorMap(factorsRow?.factors)
    ? (factorsRow!.factors as TradeCalibrationFactorsMap)
    : {};
  const tradeKey = nudge.tradeType ?? "__overall__";
  const tradeFactor: TradeCalibrationFactor = {
    ...(existing[tradeKey] ?? {}),
    [nudge.metric]: nudge.suggestedFactor,
  };
  const updated: TradeCalibrationFactorsMap = {
    ...existing,
    [tradeKey]: tradeFactor,
  };

  if (factorsRow) {
    await db
      .update(aiEstimatorOrgFactors)
      .set({ tradeCalibrationFactors: updated, updatedById: reviewerId })
      .where(eq(aiEstimatorOrgFactors.id, factorsRow.id));
  } else {
    await db.insert(aiEstimatorOrgFactors).values({
      organizationId,
      tradeCalibrationFactors: updated,
      updatedById: reviewerId,
    });
  }

  const [out] = await db
    .update(aiEstimatorCalibrationNudges)
    .set({ status: "ACCEPTED", reviewedById: reviewerId, reviewedAt: new Date() })
    .where(eq(aiEstimatorCalibrationNudges.id, nudgeId))
    .returning();
  return out ?? null;
}

export async function rejectCalibrationNudge(
  organizationId: string,
  nudgeId: string,
  reviewerId: string,
): Promise<AiEstimatorCalibrationNudge | null> {
  const [out] = await db
    .update(aiEstimatorCalibrationNudges)
    .set({ status: "REJECTED", reviewedById: reviewerId, reviewedAt: new Date() })
    .where(
      and(
        eq(aiEstimatorCalibrationNudges.id, nudgeId),
        eq(aiEstimatorCalibrationNudges.organizationId, organizationId),
        eq(aiEstimatorCalibrationNudges.status, "PENDING"),
      ),
    )
    .returning();
  return out ?? null;
}
