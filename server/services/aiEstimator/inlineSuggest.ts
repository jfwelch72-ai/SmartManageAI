import { getLearnedRate, summarizeRate, type RateMetric } from "./learnedRates";

export interface InlineSuggestion {
  metric: RateMetric;
  costCode: string;
  unit: string;
  point: number | null;
  range: { low: number | null; high: number | null };
  sampleSize: number;
  source: "learned_rate";
  message: string;
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
}): Promise<InlineSuggestion | null> {
  if (!opts.costCode || !opts.unit) return null;
  const rate = await getLearnedRate(opts.organizationId, {
    costCode: opts.costCode,
    metric: opts.metric,
    unit: opts.unit,
  });
  if (!rate) return null;
  const summary = summarizeRate(rate);
  if (summary.point == null) return null;
  const verb =
    opts.metric === "unit_cost"
      ? "unit cost"
      : opts.metric === "labor_hours_per_unit"
        ? "labor hours / unit"
        : "production rate";
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
    }.`,
  };
}
