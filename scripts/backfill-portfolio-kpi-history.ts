/**
 * One-shot backfill: seed up to 12 weeks of `project_kpi_snapshots` from
 * existing `project_profitability_snapshots`, `time_entries`, `rfis`,
 * `change_orders`, and `punch_list_items` so portfolio sparklines and
 * deltas have history immediately, before the weekly capture has run for
 * 12 real weeks.
 *
 * Idempotent — re-running will not duplicate rows (relies on the
 * `(project_id, week_start)` unique index and INSERT ... ON CONFLICT
 * DO NOTHING).
 *
 * Usage:
 *   npx tsx scripts/backfill-portfolio-kpi-history.ts            # 12 weeks
 *   npx tsx scripts/backfill-portfolio-kpi-history.ts --weeks=8  # custom
 */

import { backfillKpiSnapshots } from "../server/services/portfolioKpiSnapshotService";

function parseWeeks(argv: string[]): number {
  const arg = argv.find((a) => a.startsWith("--weeks="));
  if (!arg) return 12;
  const n = parseInt(arg.split("=")[1] ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return n;
}

async function main() {
  const weeks = parseWeeks(process.argv.slice(2));
  console.log(`[backfill-kpi] Starting backfill for last ${weeks} week(s)…`);
  const t0 = Date.now();
  const result = await backfillKpiSnapshots({ weeks });
  const ms = Date.now() - t0;
  console.log(
    `[backfill-kpi] Done in ${ms}ms — projects=${result.projects} weeks=${result.weeks} inserted=${result.inserted} skipped=${result.skipped}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-kpi] FAILED", err);
    process.exit(1);
  });
