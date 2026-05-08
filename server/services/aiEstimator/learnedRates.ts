import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorLearnedRates,
  aiEstimatorRateSamples,
  aiEstimatorExcludedSources,
  aiEstimatorOrgFactors,
  bids,
  type AiEstimatorLearnedRate,
  type AiEstimatorRateSample,
  type AiEstimatorExcludedSource,
} from "@shared/schema";

const MAX_SAMPLES = 200;

export type RateMetric =
  | "unit_cost"
  | "labor_hours_per_unit"
  | "production_rate";

export interface RateLookup {
  costCode: string;
  metric: RateMetric;
  unit: string;
}

export interface RateUpdate extends RateLookup {
  value: number;
  sourceType?:
    | "historical_actual"
    | "estimate_line_item"
    | "feedback_event"
    | "legacy"
    // Task #2443 — sample contributed when a standalone takeoff is
    // tagged to a bid/project. Treats prior speculative takeoffs as a
    // soft signal in the learned-rates pool for that org's library.
    | "library_assignment";
  sourceRowId?: string;
  projectId?: string | null;
  bidId?: string | null;
}

export async function getLearnedRate(
  organizationId: string,
  lookup: RateLookup,
): Promise<AiEstimatorLearnedRate | null> {
  const [row] = await db
    .select()
    .from(aiEstimatorLearnedRates)
    .where(
      and(
        eq(aiEstimatorLearnedRates.organizationId, organizationId),
        eq(aiEstimatorLearnedRates.costCode, lookup.costCode),
        eq(aiEstimatorLearnedRates.metric, lookup.metric),
        eq(aiEstimatorLearnedRates.unit, lookup.unit),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listLearnedRatesForOrg(
  organizationId: string,
): Promise<AiEstimatorLearnedRate[]> {
  return db
    .select()
    .from(aiEstimatorLearnedRates)
    .where(eq(aiEstimatorLearnedRates.organizationId, organizationId))
    .orderBy(aiEstimatorLearnedRates.costCode);
}

function percentile(sortedAsc: number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const upper = sortedAsc[Math.min(base + 1, sortedAsc.length - 1)];
  return sortedAsc[base] + rest * (upper - sortedAsc[base]);
}

/** Load the set of excluded projectIds for an org (cached within the request) */
export async function getExcludedIds(organizationId: string): Promise<{ projectIds: Set<string>; bidIds: Set<string> }> {
  const [rows, qualityBidIds] = await Promise.all([
    db
      .select({ projectId: aiEstimatorExcludedSources.projectId, bidId: aiEstimatorExcludedSources.bidId })
      .from(aiEstimatorExcludedSources)
      .where(eq(aiEstimatorExcludedSources.organizationId, organizationId)),
    getQualityFilteredBidIds(organizationId),
  ]);
  const projectIds = new Set<string>();
  const bidIds = new Set<string>(qualityBidIds);
  for (const r of rows) {
    if (r.projectId) projectIds.add(r.projectId);
    if (r.bidId) bidIds.add(r.bidId);
  }
  return { projectIds, bidIds };
}

/**
 * Task #2627 — Quality filter. When the org has
 * `excludeCancelledLostJobs` enabled (default true), pull every
 * LOST/CANCELLED bid id so any rate sample whose `bidId` matches is
 * dropped from the recompute pool. Returns an empty set when the
 * filter is disabled. Failure-safe: if the org-factors row hasn't
 * been provisioned yet, defaults to "filter on".
 */
export async function getQualityFilteredBidIds(
  organizationId: string,
): Promise<Set<string>> {
  const [factors] = await db
    .select({ excludeCancelledLostJobs: aiEstimatorOrgFactors.excludeCancelledLostJobs })
    .from(aiEstimatorOrgFactors)
    .where(eq(aiEstimatorOrgFactors.organizationId, organizationId))
    .limit(1);
  const enabled = factors?.excludeCancelledLostJobs ?? true;
  if (!enabled) return new Set<string>();
  const rows = await db
    .select({ id: bids.id })
    .from(bids)
    .where(
      and(
        eq(bids.gcOrganizationId, organizationId),
        inArray(bids.status, ["LOST", "CANCELLED"]),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** @deprecated Use getExcludedIds */
export async function getExcludedProjectIds(organizationId: string): Promise<Set<string>> {
  const { projectIds } = await getExcludedIds(organizationId);
  return projectIds;
}

/**
 * Recompute mean/median/percentiles for a single (costCode, metric, unit)
 * from the `ai_estimator_rate_samples` table, honoring exclusions.
 * Writes back to `ai_estimator_learned_rates`.
 */
export async function recomputeLearnedRate(
  organizationId: string,
  costCode: string,
  metric: string,
  unit: string,
): Promise<AiEstimatorLearnedRate | null> {
  const { projectIds: excludedProjectIds, bidIds: excludedBidIds } = await getExcludedIds(organizationId);

  const allSamples = await db
    .select()
    .from(aiEstimatorRateSamples)
    .where(
      and(
        eq(aiEstimatorRateSamples.organizationId, organizationId),
        eq(aiEstimatorRateSamples.costCode, costCode),
        eq(aiEstimatorRateSamples.metric, metric),
        eq(aiEstimatorRateSamples.unit, unit),
      ),
    );

  const validSamples = allSamples
    .filter((s) =>
      (!s.projectId || !excludedProjectIds.has(s.projectId)) &&
      (!s.bidId || !excludedBidIds.has(s.bidId))
    )
    .map((s) => Number(s.value))
    .filter((v) => Number.isFinite(v));

  const sortedSamples = [...validSamples].sort((a, b) => a - b);
  const n = sortedSamples.length;
  const mean = n > 0 ? sortedSamples.reduce((acc, v) => acc + v, 0) / n : null;
  const median = percentile(sortedSamples, 0.5);
  const p25 = percentile(sortedSamples, 0.25);
  const p75 = percentile(sortedSamples, 0.75);
  const minV = n > 0 ? sortedSamples[0] : null;
  const maxV = n > 0 ? sortedSamples[n - 1] : null;
  const fmt = (v: number | null) => (v == null ? null : v.toFixed(4));

  const recentSamples = validSamples.slice(-MAX_SAMPLES);

  const existing = await getLearnedRate(organizationId, { costCode, metric: metric as RateMetric, unit });
  if (!existing) {
    if (n === 0) return null;
    const [row] = await db
      .insert(aiEstimatorLearnedRates)
      .values({
        organizationId,
        costCode,
        metric,
        unit,
        sampleSize: n,
        meanValue: fmt(mean),
        medianValue: fmt(median),
        p25Value: fmt(p25),
        p75Value: fmt(p75),
        minValue: fmt(minV),
        maxValue: fmt(maxV),
        recentSamples,
      })
      .returning();
    return row;
  }

  const [row] = await db
    .update(aiEstimatorLearnedRates)
    .set({
      sampleSize: n,
      meanValue: fmt(mean),
      medianValue: fmt(median),
      p25Value: fmt(p25),
      p75Value: fmt(p75),
      minValue: fmt(minV),
      maxValue: fmt(maxV),
      recentSamples,
      lastUpdatedAt: new Date(),
    })
    .where(eq(aiEstimatorLearnedRates.id, existing.id))
    .returning();
  return row;
}

export async function recordRateSample(
  organizationId: string,
  update: RateUpdate,
): Promise<AiEstimatorLearnedRate> {
  const { projectIds: excludedProjectIds, bidIds: excludedBidIds } = await getExcludedIds(organizationId);
  const isExcluded =
    (update.projectId != null && excludedProjectIds.has(update.projectId)) ||
    (update.bidId != null && excludedBidIds.has(update.bidId));
  if (isExcluded) {
    const existing = await getLearnedRate(organizationId, update);
    if (existing) return existing;
    const [row] = await db
      .insert(aiEstimatorLearnedRates)
      .values({
        organizationId,
        costCode: update.costCode,
        metric: update.metric,
        unit: update.unit,
        sampleSize: 0,
        recentSamples: [],
      })
      .onConflictDoNothing()
      .returning();
    return row ?? (await getLearnedRate(organizationId, update))!;
  }

  const existing = await getLearnedRate(organizationId, update);
  const samples = Array.isArray(existing?.recentSamples)
    ? (existing!.recentSamples as number[])
    : [];
  if (Number.isFinite(update.value)) samples.push(update.value);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);

  const sortedSamples = [...samples].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sortedSamples.length;
  const mean = n > 0 ? sortedSamples.reduce((acc, v) => acc + v, 0) / n : null;
  const median = percentile(sortedSamples, 0.5);
  const p25 = percentile(sortedSamples, 0.25);
  const p75 = percentile(sortedSamples, 0.75);
  const minV = n > 0 ? sortedSamples[0] : null;
  const maxV = n > 0 ? sortedSamples[n - 1] : null;
  const fmt = (v: number | null) => (v == null ? null : v.toFixed(4));

  let rateRow: AiEstimatorLearnedRate;
  if (!existing) {
    const [row] = await db
      .insert(aiEstimatorLearnedRates)
      .values({
        organizationId,
        costCode: update.costCode,
        metric: update.metric,
        unit: update.unit,
        sampleSize: n,
        meanValue: fmt(mean),
        medianValue: fmt(median),
        p25Value: fmt(p25),
        p75Value: fmt(p75),
        minValue: fmt(minV),
        maxValue: fmt(maxV),
        recentSamples: samples,
        lastSourceType: update.sourceType ?? "feedback_event",
      })
      .returning();
    rateRow = row;
  } else {
    const [row] = await db
      .update(aiEstimatorLearnedRates)
      .set({
        sampleSize: n,
        meanValue: fmt(mean),
        medianValue: fmt(median),
        p25Value: fmt(p25),
        p75Value: fmt(p75),
        minValue: fmt(minV),
        maxValue: fmt(maxV),
        recentSamples: samples,
        lastSourceType: update.sourceType ?? "feedback_event",
        lastUpdatedAt: new Date(),
      })
      .where(eq(aiEstimatorLearnedRates.id, existing.id))
      .returning();
    rateRow = row;
  }

  await db.insert(aiEstimatorRateSamples).values({
    organizationId,
    learnedRateId: rateRow.id,
    costCode: update.costCode,
    metric: update.metric,
    unit: update.unit,
    value: update.value.toFixed(4),
    sourceType: update.sourceType ?? "feedback_event",
    sourceRowId: update.sourceRowId ?? null,
    projectId: update.projectId ?? null,
    bidId: update.bidId ?? null,
  });

  return rateRow;
}

/**
 * Task #2396 — Batched implementation. The previous implementation
 * looped per-update, calling `recordRateSample` which issues a SELECT,
 * an UPDATE/INSERT and an INSERT against `ai_estimator_rate_samples` for
 * every row. For a large tenant with thousands of estimate line items
 * that's tens of thousands of round-trips inside the nightly ingest. We
 * now:
 *
 *   1. Filter invalid / excluded updates first (preserves the original
 *      `Number.isFinite`, missing-field, and exclusion-list semantics so
 *      the existing unit tests keep passing).
 *   2. Group remaining updates by `(costCode, metric, unit)` so each
 *      learned-rate row is read and rewritten exactly once per call.
 *   3. Fetch all matching learned-rate rows for the org in a single
 *      SELECT, recompute mean/median/percentiles in memory, and issue
 *      one UPDATE per group plus one bulk INSERT for new groups.
 *   4. Bulk-insert all `ai_estimator_rate_samples` rows in a single
 *      statement (chunked to stay well under the parameter cap).
 *
 * The return value is unchanged: count of updates that were actually
 * applied (i.e. survived filtering and exclusion).
 */
export async function bulkRecordRateSamples(
  organizationId: string,
  updates: RateUpdate[],
): Promise<number> {
  const { projectIds: excludedProjectIds, bidIds: excludedBidIds } = await getExcludedIds(organizationId);

  // Step 1 — filter. Mirrors per-update validation that
  // `recordRateSample` would have applied internally. Excluded keys are
  // tracked separately so we still create the empty stub row that
  // `recordRateSample` would have produced (sampleSize=0), preserving
  // legacy callers' expectation that a learned-rate row exists for
  // every (costCode, metric, unit) we've seen — even excluded ones.
  const valid: RateUpdate[] = [];
  const excludedKeys: RateLookup[] = [];
  for (const u of updates) {
    if (!u.costCode || !u.metric || !u.unit) continue;
    if (!Number.isFinite(u.value)) continue;
    const isExcluded =
      (u.projectId != null && excludedProjectIds.has(u.projectId)) ||
      (u.bidId != null && excludedBidIds.has(u.bidId));
    if (isExcluded) {
      excludedKeys.push({ costCode: u.costCode, metric: u.metric, unit: u.unit });
      continue;
    }
    valid.push(u);
  }
  if (valid.length === 0 && excludedKeys.length === 0) return 0;

  // Step 2 — group by the unique-rate key.
  const keyOf = (u: { costCode: string; metric: string; unit: string }) =>
    `${u.costCode}\u0001${u.metric}\u0001${u.unit}`;
  const groups = new Map<
    string,
    { costCode: string; metric: string; unit: string; updates: RateUpdate[] }
  >();
  for (const u of valid) {
    const k = keyOf(u);
    let g = groups.get(k);
    if (!g) {
      g = { costCode: u.costCode, metric: u.metric, unit: u.unit, updates: [] };
      groups.set(k, g);
    }
    g.updates.push(u);
  }

  // Step 3 — fetch all existing learned-rate rows for the touched keys
  // in one query. We pre-filter by costCode set (small selectivity boost
  // on the org_cc index) and resolve metric/unit in memory. Include
  // excluded keys so we know whether to emit a stub row for them.
  const costCodes = Array.from(new Set([
    ...Array.from(groups.values()).map((g) => g.costCode),
    ...excludedKeys.map((k) => k.costCode),
  ]));
  const existingRates = costCodes.length
    ? await db
        .select()
        .from(aiEstimatorLearnedRates)
        .where(
          and(
            eq(aiEstimatorLearnedRates.organizationId, organizationId),
            inArray(aiEstimatorLearnedRates.costCode, costCodes),
          ),
        )
    : [];
  const existingByKey = new Map<string, AiEstimatorLearnedRate>();
  for (const r of existingRates) {
    existingByKey.set(keyOf({ costCode: r.costCode, metric: r.metric, unit: r.unit }), r);
  }

  const fmt = (v: number | null) => (v == null ? null : v.toFixed(4));
  const now = new Date();

  // Step 4 — compute updated stats per group and split into
  // INSERT-needed vs UPDATE-needed lists. Keep the rate-row id around
  // (or filled in after insert RETURNING) so step 5 can attach it to
  // each per-sample row.
  type LearnedRateInsert = typeof aiEstimatorLearnedRates.$inferInsert;
  type LearnedRateUpdate = Partial<LearnedRateInsert> & { lastUpdatedAt?: Date };
  type GroupResult = {
    group: { costCode: string; metric: string; unit: string; updates: RateUpdate[] };
    learnedRateId: string | null;
    lastSourceType: string | null;
  };
  const inserts: Array<{ values: LearnedRateInsert; result: GroupResult }> = [];
  const updateOps: Array<{ existingId: string; values: LearnedRateUpdate; result: GroupResult }> = [];

  for (const group of Array.from(groups.values())) {
    const existing = existingByKey.get(keyOf(group));
    const samples = Array.isArray(existing?.recentSamples)
      ? [...(existing!.recentSamples as number[])]
      : [];
    for (const u of group.updates) samples.push(u.value);
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);

    const sortedSamples = [...samples].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const n = sortedSamples.length;
    const mean = n > 0 ? sortedSamples.reduce((acc, v) => acc + v, 0) / n : null;
    const median = percentile(sortedSamples, 0.5);
    const p25 = percentile(sortedSamples, 0.25);
    const p75 = percentile(sortedSamples, 0.75);
    const minV = n > 0 ? sortedSamples[0] : null;
    const maxV = n > 0 ? sortedSamples[n - 1] : null;
    const lastSourceType =
      group.updates[group.updates.length - 1]?.sourceType ?? "feedback_event";

    const baseValues = {
      sampleSize: n,
      meanValue: fmt(mean),
      medianValue: fmt(median),
      p25Value: fmt(p25),
      p75Value: fmt(p75),
      minValue: fmt(minV),
      maxValue: fmt(maxV),
      recentSamples: samples,
      lastSourceType,
    };

    const result: GroupResult = {
      group,
      learnedRateId: existing?.id ?? null,
      lastSourceType,
    };

    if (existing) {
      updateOps.push({
        existingId: existing.id,
        values: { ...baseValues, lastUpdatedAt: now },
        result,
      });
    } else {
      inserts.push({
        values: {
          organizationId,
          costCode: group.costCode,
          metric: group.metric,
          unit: group.unit,
          ...baseValues,
        },
        result,
      });
    }
  }

  // Issue updates sequentially (one per touched key — already << per-row).
  for (const op of updateOps) {
    await db
      .update(aiEstimatorLearnedRates)
      .set(op.values)
      .where(eq(aiEstimatorLearnedRates.id, op.existingId));
  }

  // Stub-row parity with `recordRateSample`: for excluded keys we still
  // ensure a (sampleSize=0, recentSamples=[]) row exists, so downstream
  // lookups by (costCode, metric, unit) can find a record. We only
  // insert stubs for keys that don't already exist and that aren't
  // already going to be inserted as a "real" group above.
  const queuedInsertKeys = new Set(
    inserts.map((i) => keyOf(i.result.group)),
  );
  const stubInserts: LearnedRateInsert[] = [];
  const seenStubKeys = new Set<string>();
  for (const k of excludedKeys) {
    const key = keyOf(k);
    if (seenStubKeys.has(key)) continue;
    if (existingByKey.has(key)) continue;
    if (queuedInsertKeys.has(key)) continue;
    seenStubKeys.add(key);
    stubInserts.push({
      organizationId,
      costCode: k.costCode,
      metric: k.metric,
      unit: k.unit,
      sampleSize: 0,
      recentSamples: [],
    });
  }
  if (stubInserts.length > 0) {
    await db
      .insert(aiEstimatorLearnedRates)
      .values(stubInserts)
      .onConflictDoNothing();
  }

  // Bulk-insert any new (costCode, metric, unit) keys in one statement.
  // `onConflictDoNothing` covers the rare race where another writer
  // raced us between the SELECT above and this INSERT — we fall back to
  // a SELECT for those ids below so we can attach samples to the right
  // learned-rate row.
  if (inserts.length > 0) {
    const inserted = await db
      .insert(aiEstimatorLearnedRates)
      .values(inserts.map((i) => i.values))
      .onConflictDoNothing()
      .returning({
        id: aiEstimatorLearnedRates.id,
        costCode: aiEstimatorLearnedRates.costCode,
        metric: aiEstimatorLearnedRates.metric,
        unit: aiEstimatorLearnedRates.unit,
      });
    const idByKey = new Map(
      inserted.map((r) => [keyOf({ costCode: r.costCode, metric: r.metric, unit: r.unit }), r.id]),
    );
    const stillMissing: typeof inserts = [];
    for (const op of inserts) {
      const id = idByKey.get(keyOf(op.result.group));
      if (id) op.result.learnedRateId = id;
      else stillMissing.push(op);
    }
    // Race fallback — a concurrent writer beat us to it. Re-read those
    // rows so the per-sample inserts below get a valid FK.
    if (stillMissing.length > 0) {
      const refetch = await db
        .select({
          id: aiEstimatorLearnedRates.id,
          costCode: aiEstimatorLearnedRates.costCode,
          metric: aiEstimatorLearnedRates.metric,
          unit: aiEstimatorLearnedRates.unit,
        })
        .from(aiEstimatorLearnedRates)
        .where(
          and(
            eq(aiEstimatorLearnedRates.organizationId, organizationId),
            inArray(
              aiEstimatorLearnedRates.costCode,
              Array.from(new Set(stillMissing.map((m) => m.result.group.costCode))),
            ),
          ),
        );
      const refetchById = new Map(
        refetch.map((r) => [keyOf({ costCode: r.costCode, metric: r.metric, unit: r.unit }), r.id]),
      );
      for (const op of stillMissing) {
        const id = refetchById.get(keyOf(op.result.group));
        if (id) op.result.learnedRateId = id;
      }
    }
  }

  // Step 5 — bulk-insert the per-sample provenance rows in one shot
  // (chunked so we don't exceed Postgres' 65 535 parameter limit; ~10
  // columns per row → 5000 rows per chunk is comfortably safe).
  const sampleRows: Array<typeof aiEstimatorRateSamples.$inferInsert> = [];
  const allGroupResults = [
    ...inserts.map((i) => i.result),
    ...updateOps.map((o) => o.result),
  ];
  for (const result of allGroupResults) {
    if (!result.learnedRateId) continue; // race fallback also failed — skip provenance
    for (const u of result.group.updates) {
      sampleRows.push({
        organizationId,
        learnedRateId: result.learnedRateId,
        costCode: result.group.costCode,
        metric: result.group.metric,
        unit: result.group.unit,
        value: u.value.toFixed(4),
        sourceType: u.sourceType ?? "feedback_event",
        sourceRowId: u.sourceRowId ?? null,
        projectId: u.projectId ?? null,
        bidId: u.bidId ?? null,
      });
    }
  }
  const SAMPLE_CHUNK = 1000;
  for (let i = 0; i < sampleRows.length; i += SAMPLE_CHUNK) {
    await db
      .insert(aiEstimatorRateSamples)
      .values(sampleRows.slice(i, i + SAMPLE_CHUNK));
  }

  return valid.length;
}

export function summarizeRate(
  rate: AiEstimatorLearnedRate | null,
  opts: { regionMultiplier?: number | null } = {},
): {
  point: number | null;
  range: { low: number | null; high: number | null };
  n: number;
  /** Region multiplier actually applied (1 if none / invalid). */
  regionMultiplier: number;
} {
  if (!rate) {
    return { point: null, range: { low: null, high: null }, n: 0, regionMultiplier: 1 };
  }
  const m =
    typeof opts.regionMultiplier === "number" && Number.isFinite(opts.regionMultiplier) && opts.regionMultiplier > 0
      ? opts.regionMultiplier
      : 1;
  const num = (v: string | null) => (v == null ? null : Number(v) * m);
  return {
    point: num(rate.medianValue) ?? num(rate.meanValue),
    range: { low: num(rate.p25Value) ?? num(rate.minValue), high: num(rate.p75Value) ?? num(rate.maxValue) },
    n: rate.sampleSize,
    regionMultiplier: m,
  };
}

export function confidenceBucket(sampleSize: number, p25: string | null, p75: string | null, median: string | null): "Strong" | "Mixed" | "Sparse" {
  if (sampleSize < 5) return "Sparse";
  if (p25 && p75 && median) {
    const spread = (Number(p75) - Number(p25)) / (Number(median) || 1);
    if (spread > 0.5) return "Mixed";
  }
  return "Strong";
}

export async function listExcludedSources(organizationId: string): Promise<AiEstimatorExcludedSource[]> {
  return db
    .select()
    .from(aiEstimatorExcludedSources)
    .where(eq(aiEstimatorExcludedSources.organizationId, organizationId))
    .orderBy(aiEstimatorExcludedSources.excludedAt);
}

export async function addExcludedSource(opts: {
  organizationId: string;
  projectId?: string | null;
  bidId?: string | null;
  reason?: string;
  excludedById: string;
}): Promise<AiEstimatorExcludedSource> {
  const [inserted] = await db
    .insert(aiEstimatorExcludedSources)
    .values({
      organizationId: opts.organizationId,
      projectId: opts.projectId ?? null,
      bidId: opts.bidId ?? null,
      reason: opts.reason ?? null,
      excludedById: opts.excludedById,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  // Conflict: row already exists — return the existing one
  const conditions = [eq(aiEstimatorExcludedSources.organizationId, opts.organizationId)];
  if (opts.projectId) {
    conditions.push(eq(aiEstimatorExcludedSources.projectId, opts.projectId));
  }
  if (opts.bidId) {
    conditions.push(eq(aiEstimatorExcludedSources.bidId, opts.bidId));
  }
  const [existing] = await db
    .select()
    .from(aiEstimatorExcludedSources)
    .where(and(...conditions))
    .limit(1);
  if (!existing) throw new Error("addExcludedSource: conflict but existing row not found");
  return existing;
}

export async function removeExcludedSource(id: string, organizationId: string): Promise<void> {
  await db
    .delete(aiEstimatorExcludedSources)
    .where(and(
      eq(aiEstimatorExcludedSources.id, id),
      eq(aiEstimatorExcludedSources.organizationId, organizationId),
    ));
}

export async function listRateSamples(opts: {
  organizationId: string;
  learnedRateId: string;
  limit?: number;
  offset?: number;
}): Promise<{ samples: AiEstimatorRateSample[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [samples, countRows] = await Promise.all([
    db
      .select()
      .from(aiEstimatorRateSamples)
      .where(
        and(
          eq(aiEstimatorRateSamples.organizationId, opts.organizationId),
          eq(aiEstimatorRateSamples.learnedRateId, opts.learnedRateId),
        ),
      )
      .orderBy(sql`${aiEstimatorRateSamples.recordedAt} desc`)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiEstimatorRateSamples)
      .where(
        and(
          eq(aiEstimatorRateSamples.organizationId, opts.organizationId),
          eq(aiEstimatorRateSamples.learnedRateId, opts.learnedRateId),
        ),
      ),
  ]);

  return { samples, total: countRows[0]?.count ?? 0 };
}
