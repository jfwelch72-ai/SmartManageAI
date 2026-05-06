/**
 * Task #2454 — One-shot backfill: index every existing standalone takeoff
 * into the AI Estimator knowledge index, and emit `library_assignment`
 * rate samples for every standalone takeoff that has already been tagged
 * to a bid/project.
 *
 * Why this exists
 * ---------------
 * Task #2443 added an ingestion hook (`indexStandaloneTakeoffSafe` /
 * `emitLibraryAssignmentSamplesSafe`) that fires on standalone-takeoff
 * create/update/tag, so anything *new* shows up in AI Estimator
 * suggestions immediately. Standalone takeoffs that already exist in
 * production (created before that hook shipped) won't appear in
 * suggestions until someone touches them again. This script walks every
 * org's existing rows once and brings them up to parity.
 *
 * What it does
 * ------------
 *   1. Page through `standalone_takeoffs` in id-order (stable cursor,
 *      restart-safe, no OFFSET drift).
 *   2. For each takeoff: call `indexStandaloneTakeoff`. That helper
 *      upserts a `standalone_takeoff` knowledge row plus one
 *      `takeoff_measurement` row per measurement on every sheet (capped
 *      at 200 measurements per sheet, mirroring `runIngestion`). It is
 *      idempotent — re-running over the same takeoff produces the same
 *      final state thanks to the content-hash shortcut in
 *      `upsertKnowledgeRow`.
 *   3. For each takeoff that has at least one row in `takeoff_tags`,
 *      call `emitLibraryAssignmentSamplesForTakeoff` once per tag with
 *      the tag's `bidId`/`projectId`. That emits a `library_assignment`
 *      rate sample per costed measurement so the learned-rates store
 *      reflects the prior speculative work the same way it would have
 *      had the tag been created today.
 *
 * Idempotency / safety
 * --------------------
 *   - Knowledge index upserts are content-hashed; a re-run touches no
 *     rows whose content didn't change.
 *   - `bulkRecordRateSamples` (the underlying call for library
 *     assignments) buckets by (costCode, metric, unit) and updates an
 *     existing sample for (sourceType='library_assignment',
 *     sourceRowId=measurement.id) in place rather than appending — so
 *     re-running doesn't double-count the same measurement.
 *   - Failures on a single takeoff are logged and skipped; the script
 *     keeps going so one bad row never blocks the whole backfill.
 *   - Archived takeoffs are included by default (their measurements
 *     are still useful retrieval signal). Pass `--skip-archived` to
 *     exclude them.
 *
 * Usage
 * -----
 *   npx tsx scripts/backfill-standalone-takeoff-ai-index.ts
 *   npx tsx scripts/backfill-standalone-takeoff-ai-index.ts --dry-run
 *   npx tsx scripts/backfill-standalone-takeoff-ai-index.ts --batch-size=100
 *   npx tsx scripts/backfill-standalone-takeoff-ai-index.ts --org=<organizationId>
 *   npx tsx scripts/backfill-standalone-takeoff-ai-index.ts --skip-archived
 */

import { and, asc, eq, gt, isNull, type SQL } from "drizzle-orm";
import { db } from "../server/db";
import { standaloneTakeoffs, takeoffTags } from "@shared/schema";
import {
  indexStandaloneTakeoff,
  emitLibraryAssignmentSamplesForTakeoff,
} from "../server/services/aiEstimator/standaloneIngestion";

interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  organizationId: string | null;
  skipArchived: boolean;
}

interface OrgTotals {
  organizationId: string;
  takeoffsIndexed: number;
  takeoffsFailed: number;
  tagsProcessed: number;
  rateSamplesEmitted: number;
}

interface BackfillResult {
  scannedTakeoffs: number;
  indexedTakeoffs: number;
  failedTakeoffs: number;
  taggedTakeoffsProcessed: number;
  rateSamplesEmitted: number;
  perOrg: Map<string, OrgTotals>;
}

function parseArgs(argv: string[]): BackfillOptions {
  const dryRun = argv.includes("--dry-run");
  const skipArchived = argv.includes("--skip-archived");
  const batchArg = argv.find((a) => a.startsWith("--batch-size="));
  let batchSize = 200;
  if (batchArg) {
    const n = parseInt(batchArg.split("=")[1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) batchSize = Math.min(n, 1000);
  }
  const orgArg = argv.find((a) => a.startsWith("--org="));
  const organizationId = orgArg ? orgArg.split("=")[1] || null : null;
  return { dryRun, batchSize, organizationId, skipArchived };
}

function bumpOrg(
  result: BackfillResult,
  orgId: string,
  patch: Partial<Omit<OrgTotals, "organizationId">>,
): void {
  const cur = result.perOrg.get(orgId) ?? {
    organizationId: orgId,
    takeoffsIndexed: 0,
    takeoffsFailed: 0,
    tagsProcessed: 0,
    rateSamplesEmitted: 0,
  };
  if (patch.takeoffsIndexed) cur.takeoffsIndexed += patch.takeoffsIndexed;
  if (patch.takeoffsFailed) cur.takeoffsFailed += patch.takeoffsFailed;
  if (patch.tagsProcessed) cur.tagsProcessed += patch.tagsProcessed;
  if (patch.rateSamplesEmitted) cur.rateSamplesEmitted += patch.rateSamplesEmitted;
  result.perOrg.set(orgId, cur);
}

export async function backfillStandaloneTakeoffAiIndex(
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const result: BackfillResult = {
    scannedTakeoffs: 0,
    indexedTakeoffs: 0,
    failedTakeoffs: 0,
    taggedTakeoffsProcessed: 0,
    rateSamplesEmitted: 0,
    perOrg: new Map(),
  };

  let cursor: string | null = null;

  while (true) {
    const conditions: SQL[] = [];
    if (cursor) conditions.push(gt(standaloneTakeoffs.id, cursor));
    if (opts.organizationId) {
      conditions.push(eq(standaloneTakeoffs.organizationId, opts.organizationId));
    }
    if (opts.skipArchived) {
      conditions.push(isNull(standaloneTakeoffs.archivedAt));
    }
    const where: SQL | undefined =
      conditions.length === 0
        ? undefined
        : conditions.length === 1
          ? conditions[0]
          : and(...conditions);

    const batch = await db
      .select({
        id: standaloneTakeoffs.id,
        organizationId: standaloneTakeoffs.organizationId,
      })
      .from(standaloneTakeoffs)
      .where(where)
      .orderBy(asc(standaloneTakeoffs.id))
      .limit(opts.batchSize);

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    result.scannedTakeoffs += batch.length;

    for (const t of batch) {
      // 1. Knowledge index upsert (takeoff row + measurement rows).
      if (!opts.dryRun) {
        try {
          await indexStandaloneTakeoff(t.id);
          result.indexedTakeoffs += 1;
          bumpOrg(result, t.organizationId, { takeoffsIndexed: 1 });
        } catch (err) {
          result.failedTakeoffs += 1;
          bumpOrg(result, t.organizationId, { takeoffsFailed: 1 });
          console.warn(
            `[backfill-standalone-takeoff-ai-index] index failed takeoffId=${t.id} org=${t.organizationId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }
      } else {
        result.indexedTakeoffs += 1;
        bumpOrg(result, t.organizationId, { takeoffsIndexed: 1 });
      }

      // 2. Library-assignment rate samples for every tag this takeoff
      //    already carries. One emit per tag so a takeoff tagged to
      //    multiple bids/projects fans out the same way the runtime
      //    `tagStandaloneTakeoff` route does.
      const tags = await db
        .select({
          bidId: takeoffTags.bidId,
          projectId: takeoffTags.projectId,
        })
        .from(takeoffTags)
        .where(eq(takeoffTags.standaloneTakeoffId, t.id));

      if (tags.length === 0) continue;

      let touchedAnyTag = false;
      for (const tag of tags) {
        if (!tag.bidId && !tag.projectId) continue;
        if (opts.dryRun) {
          touchedAnyTag = true;
          continue;
        }
        try {
          const emitted = await emitLibraryAssignmentSamplesForTakeoff(t.id, {
            bidId: tag.bidId ?? null,
            projectId: tag.projectId ?? null,
          });
          if (emitted > 0) {
            result.rateSamplesEmitted += emitted;
            bumpOrg(result, t.organizationId, { rateSamplesEmitted: emitted });
          }
          touchedAnyTag = true;
        } catch (err) {
          console.warn(
            `[backfill-standalone-takeoff-ai-index] library_assignment emit failed takeoffId=${t.id} tag=${tag.bidId ?? tag.projectId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      if (touchedAnyTag) {
        result.taggedTakeoffsProcessed += 1;
        bumpOrg(result, t.organizationId, { tagsProcessed: 1 });
      }
    }

    if (batch.length < opts.batchSize) break;
  }

  return result;
}

function printPerOrgTotals(result: BackfillResult): void {
  if (result.perOrg.size === 0) {
    console.log("[backfill-standalone-takeoff-ai-index] Per-org totals: (none touched)");
    return;
  }
  const rows = Array.from(result.perOrg.values()).sort(
    (a, b) => b.takeoffsIndexed - a.takeoffsIndexed,
  );
  console.log("[backfill-standalone-takeoff-ai-index] Per-org totals:");
  for (const row of rows) {
    console.log(
      `  ${row.organizationId} — indexed=${row.takeoffsIndexed} failed=${row.takeoffsFailed} taggedTakeoffs=${row.tagsProcessed} rateSamples=${row.rateSamplesEmitted}`,
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[backfill-standalone-takeoff-ai-index] Starting${opts.dryRun ? " (dry-run)" : ""} batchSize=${opts.batchSize}${opts.organizationId ? ` org=${opts.organizationId}` : ""}${opts.skipArchived ? " skip-archived" : ""}…`,
  );
  const t0 = Date.now();
  const result = await backfillStandaloneTakeoffAiIndex(opts);
  const ms = Date.now() - t0;
  console.log(
    `[backfill-standalone-takeoff-ai-index] Done in ${ms}ms — scanned=${result.scannedTakeoffs} indexed=${result.indexedTakeoffs} failed=${result.failedTakeoffs} taggedTakeoffsProcessed=${result.taggedTakeoffsProcessed} rateSamplesEmitted=${result.rateSamplesEmitted}`,
  );
  printPerOrgTotals(result);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-standalone-takeoff-ai-index] FAILED", err);
    process.exit(1);
  });
