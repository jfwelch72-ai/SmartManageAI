import { getLearnedRate, summarizeRate, type RateMetric } from "./learnedRates";
import { resolveRegionForBid } from "./regionFactors";

export interface InlineSuggestion {
  metric: RateMetric;
  costCode: string;
  unit: string;
  point: number | null;
  range: { low: number | null; high: number | null };
  sampleSize: number;
  source: "learned_rate";
  message: string;
  /**
   * Task #2627 — Region adjustment that was applied (if any). Surfaced
   * so the UI's "Why this number?" expander can show the math.
   * `multiplier === 1` means no region adjustment.
   */
  region: {
    multiplier: number;
    name: string | null;
    code: string | null;
  };
}

/**
 * Inline cost / labor / production-rate suggestion driven exclusively by
 * the org's learned-rates store. Returns null when there's no data for
 * the (costCode, metric, unit) tuple — the UI then degrades gracefully
 * (no suggestion shown, never a fabricated number).
 */
export async function suggestInline(opts: {
  organizationId: string;
  costCode: string;
  metric: RateMetric;
  unit: string;
  /** Task #2627 — when provided, the active project's region factor is applied. */
  bidId?: string | null;
}): Promise<InlineSuggestion | null> {
  if (!opts.costCode || !opts.unit) return null;
  const [rate, regionInfo] = await Promise.all([
    getLearnedRate(opts.organizationId, {
      costCode: opts.costCode,
      metric: opts.metric,
      unit: opts.unit,
    }),
    resolveRegionForBid(opts.organizationId, opts.bidId ?? null),
  ]);
  if (!rate) return null;
  const summary = summarizeRate(rate, { regionMultiplier: regionInfo.multiplier });
  if (summary.point == null) return null;
  const verb =
    opts.metric === "unit_cost"
      ? "unit cost"
      : opts.metric === "labor_hours_per_unit"
        ? "labor hours / unit"
        : "production rate";
  const regionSuffix =
    regionInfo.region && summary.regionMultiplier !== 1
      ? ` × ${summary.regionMultiplier.toFixed(2)} (${regionInfo.region.name})`
      : "";
  return {
    metric: opts.metric,
    costCode: opts.costCode,
    unit: opts.unit,
    point: summary.point,
    range: summary.range,
    sampleSize: summary.n,
    source: "learned_rate",
    message: `Your last ${summary.n} ${opts.costCode} jobs averaged ${summary.point.toFixed(2)} ${verb}${
      summary.range.low != null && summary.range.high != null
        ? ` (range ${summary.range.low.toFixed(2)} – ${summary.range.high.toFixed(2)})`
        : ""
    }${regionSuffix}.`,
    region: {
      multiplier: summary.regionMultiplier,
      name: regionInfo.region?.name ?? null,
      code: regionInfo.region?.code ?? null,
    },
  };
}
