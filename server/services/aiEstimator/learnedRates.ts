import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorLearnedRates,
  type AiEstimatorLearnedRate,
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
  sourceType?: "historical_actual" | "estimate_line_item" | "feedback_event";
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

export async function recordRateSample(
  organizationId: string,
  update: RateUpdate,
): Promise<AiEstimatorLearnedRate> {
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
      recentSamples: samples,
      lastSourceType: update.sourceType ?? "feedback_event",
      lastUpdatedAt: new Date(),
    })
    .where(eq(aiEstimatorLearnedRates.id, existing.id))
    .returning();
  return row;
}

export async function bulkRecordRateSamples(
  organizationId: string,
  updates: RateUpdate[],
): Promise<number> {
  let updated = 0;
  for (const u of updates) {
    if (!u.costCode || !u.metric || !u.unit) continue;
    if (!Number.isFinite(u.value)) continue;
    await recordRateSample(organizationId, u);
    updated++;
  }
  return updated;
}

export function summarizeRate(rate: AiEstimatorLearnedRate | null): {
  point: number | null;
  range: { low: number | null; high: number | null };
  n: number;
} {
  if (!rate) return { point: null, range: { low: null, high: null }, n: 0 };
  const num = (v: string | null) => (v == null ? null : Number(v));
  return {
    point: num(rate.medianValue) ?? num(rate.meanValue),
    range: { low: num(rate.p25Value) ?? num(rate.minValue), high: num(rate.p75Value) ?? num(rate.maxValue) },
    n: rate.sampleSize,
  };
}
