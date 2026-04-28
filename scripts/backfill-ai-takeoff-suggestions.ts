/**
 * Task #2343 — One-shot backfill: synthesize `ai_takeoff_suggestions` rows
 * for every historical `ai_takeoff_analyses` row that ran before Task
 * #2323 shipped. The closed-loop accuracy dashboard and nightly
 * confidence-calibration job both read this table; without a backfill they
 * stay data-starved for weeks until enough new analyses accumulate.
 *
 * For each COMPLETE analysis with a non-null `detected_items_json`:
 *   1. Parse the detected items.
 *   2. For every detected item, ensure exactly one suggestion row exists,
 *      keyed on (analysisId, itemKey). Defaults mirror the runtime insert
 *      shape in `server/aiTakeoffFeatureRoutes.ts::persistDetectedItemsAsSuggestions`
 *      and the boot-time helper in `server/utils/ensureAiTakeoffSuggestionsTables.ts`.
 *      Inserts use ON CONFLICT (analysis_id, item_key) DO NOTHING against the
 *      `ai_takeoff_sug_analysis_item_key_uq` index so the script is safe to
 *      re-run and crash-safe under concurrent invocations.
 *   3. If a `takeoff_measurements` row on the analysis's sheet *unambiguously*
 *      references this detected item, the suggestion is inserted/upgraded to
 *      status `ACCEPTED` with `acceptedMeasurementId` pointing at that
 *      measurement.
 *
 * ACCEPTED matching (analysis-scoped, conservative):
 *   The AI import path in `client/src/components/TakeoffWorkspace.tsx`
 *   stamps measurement.metadata with `aiItemId`, `itemType`, `unit`,
 *   `confidence`, and writes the detected item's description into
 *   measurement.label. `aiItemId` alone is positional ("item-1", "item-2",
 *   ...) so it can collide across multiple analyses on the same sheet —
 *   we therefore additionally require:
 *     - measurement.label === detected.description
 *     - metadata.itemType === detected.itemType
 *     - metadata.unit === detected.unit
 *     - for COUNT-typed measurements: measurement.count === detected.quantity
 *     - measurement.createdAt >= analysis.updatedAt (the measurement must
 *       have been imported *after* the analysis completed)
 *   Each measurement may be claimed by at most one suggestion across the
 *   whole backfill run (we track claimed measurement ids in-memory). When
 *   more than one measurement on the sheet matches all the above filters
 *   for the same detected item, the suggestion stays PENDING and the
 *   ambiguous count is surfaced in the per-org totals so the operator can
 *   investigate.
 *
 * Idempotent: re-running is a no-op for rows that already exist with the
 * correct status. PENDING rows synthesized by an earlier run (or by the
 * boot-time helper) are upgraded to ACCEPTED when an unambiguous matching
 * measurement is now found. Never downgrades or overwrites a row the user
 * has already reviewed (ACCEPTED/EDITED/REJECTED).
 *
 * Usage:
 *   npx tsx scripts/backfill-ai-takeoff-suggestions.ts                       # apply
 *   npx tsx scripts/backfill-ai-takeoff-suggestions.ts --dry-run             # preview
 *   npx tsx scripts/backfill-ai-takeoff-suggestions.ts --batch-size=500      # paginate
 *   npx tsx scripts/backfill-ai-takeoff-suggestions.ts --also-recalibrate    # Task #2361
 *
 * Task #2361 — `--also-recalibrate` re-runs the per-org confidence
 * calibration immediately after the backfill finishes, but only for the
 * organizations whose suggestion table actually changed. The nightly
 * calibration cron only runs once a day at 03:30 UTC, so without this
 * flag the dashboard and calibrated-confidence overlay won't reflect the
 * new sample counts (often a large block of ACCEPTED rows) until the
 * next tick. Skipped automatically in `--dry-run` so the preview never
 * mutates `ai_takeoff_confidence_calibration`.
 */

import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  aiTakeoffAnalyses,
  aiTakeoffSuggestions,
  takeoffMeasurements,
  type TradeType,
} from "@shared/schema";

interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  alsoRecalibrate: boolean;
}

interface OrgTotals {
  organizationId: string;
  analyses: number;
  inserted: number;
  accepted: number;
  ambiguous: number;
}

interface BackfillResult {
  scannedAnalyses: number;
  processedAnalyses: number;
  insertedSuggestions: number;
  acceptedSuggestions: number;
  upgradedToAccepted: number;
  ambiguousMatches: number;
  skippedExisting: number;
  perOrg: Map<string, OrgTotals>;
}

interface RawDetectedItem {
  id?: string | number;
  itemType?: string;
  description?: string;
  quantity?: number | string;
  unit?: string;
  confidence?: number | string;
  boundingBox?: unknown;
}

interface NormalizedItem {
  itemKey: string;
  itemType: string;
  description: string;
  quantity: number;
  unit: string;
  confidence: number;
  boundingBoxJson: string | null;
}

interface MeasurementCandidate {
  id: string;
  type: string;
  label: string;
  count: number | null;
  createdAt: Date;
  metadata: { aiItemId?: string; itemType?: string; unit?: string } | null;
}

function parseArgs(argv: string[]): BackfillOptions {
  const dryRun = argv.includes("--dry-run");
  const alsoRecalibrate = argv.includes("--also-recalibrate");
  const batchArg = argv.find((a) => a.startsWith("--batch-size="));
  let batchSize = 200;
  if (batchArg) {
    const n = parseInt(batchArg.split("=")[1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) batchSize = Math.min(n, 1000);
  }
  return { dryRun, batchSize, alsoRecalibrate };
}

function normalizeItem(raw: RawDetectedItem, idx: number): NormalizedItem {
  const itemKey = String(raw.id ?? `item-${idx + 1}`);
  const itemType = String(raw.itemType ?? "other");
  const description = String(raw.description ?? itemType);
  const quantity = Number.isFinite(Number(raw.quantity)) ? Number(raw.quantity) : 0;
  const unit = String(raw.unit ?? "EA");
  const confidence = Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 75;
  const boundingBoxJson = raw.boundingBox ? JSON.stringify(raw.boundingBox) : null;
  return { itemKey, itemType, description, quantity, unit, confidence, boundingBoxJson };
}

/**
 * Build a Map<aiItemId, MeasurementCandidate[]> for every measurement on the
 * given sheet whose `metadata` JSON blob carries an `aiItemId`. Multiple
 * candidates per key are normal (positional `item-1` ids collide across
 * analyses on the same sheet) — disambiguation happens at the per-suggestion
 * matching step, not here.
 */
async function loadMeasurementCandidates(
  sheetId: string | null,
): Promise<Map<string, MeasurementCandidate[]>> {
  const map = new Map<string, MeasurementCandidate[]>();
  if (!sheetId) return map;
  const rows = await db
    .select({
      id: takeoffMeasurements.id,
      type: takeoffMeasurements.type,
      label: takeoffMeasurements.label,
      count: takeoffMeasurements.count,
      createdAt: takeoffMeasurements.createdAt,
      metadata: takeoffMeasurements.metadata,
    })
    .from(takeoffMeasurements)
    .where(
      and(
        eq(takeoffMeasurements.sheetId, sheetId),
        isNotNull(takeoffMeasurements.metadata),
      ),
    );
  for (const row of rows) {
    if (!row.metadata) continue;
    let meta: { aiItemId?: unknown; itemType?: unknown; unit?: unknown };
    try {
      meta = JSON.parse(row.metadata);
    } catch {
      continue;
    }
    const aiItemId = meta?.aiItemId;
    if (typeof aiItemId !== "string" || aiItemId.length === 0) continue;
    const candidate: MeasurementCandidate = {
      id: row.id,
      type: row.type,
      label: row.label,
      count: row.count,
      createdAt: row.createdAt,
      metadata: {
        aiItemId,
        itemType: typeof meta.itemType === "string" ? meta.itemType : undefined,
        unit: typeof meta.unit === "string" ? meta.unit : undefined,
      },
    };
    const list = map.get(aiItemId);
    if (list) list.push(candidate);
    else map.set(aiItemId, [candidate]);
  }
  return map;
}

/**
 * Pick the unique measurement (if any) that this detected item produced.
 * Returns the matched id, "ambiguous" when multiple measurements satisfy
 * every check, or null when no candidate matches.
 *
 * `claimed` tracks measurement ids already attached to another suggestion
 * during this run so a single measurement can never anchor two analyses.
 */
function matchMeasurement(
  item: NormalizedItem,
  candidates: MeasurementCandidate[] | undefined,
  analysisCompletedAt: Date,
  claimed: Set<string>,
): { measurementId: string } | "ambiguous" | null {
  if (!candidates || candidates.length === 0) return null;
  const matches = candidates.filter((c) => {
    if (claimed.has(c.id)) return false;
    if (c.label !== item.description) return false;
    if (c.metadata?.itemType !== item.itemType) return false;
    if (c.metadata?.unit !== item.unit) return false;
    if (c.type === "COUNT" && c.count !== null && c.count !== item.quantity) return false;
    // Allow a small clock skew (5 min) so we don't drop legitimate matches
    // when measurement.createdAt rounds slightly before analysis.updatedAt.
    if (c.createdAt.getTime() < analysisCompletedAt.getTime() - 5 * 60 * 1000) return false;
    return true;
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) return "ambiguous";
  return { measurementId: matches[0].id };
}

export async function backfillAiTakeoffSuggestions(
  opts: BackfillOptions,
): Promise<BackfillResult> {
  const result: BackfillResult = {
    scannedAnalyses: 0,
    processedAnalyses: 0,
    insertedSuggestions: 0,
    acceptedSuggestions: 0,
    upgradedToAccepted: 0,
    ambiguousMatches: 0,
    skippedExisting: 0,
    perOrg: new Map(),
  };

  const bumpOrg = (
    orgId: string,
    patch: Partial<Omit<OrgTotals, "organizationId">>,
  ) => {
    const cur = result.perOrg.get(orgId) ?? {
      organizationId: orgId,
      analyses: 0,
      inserted: 0,
      accepted: 0,
      ambiguous: 0,
    };
    if (patch.analyses) cur.analyses += patch.analyses;
    if (patch.inserted) cur.inserted += patch.inserted;
    if (patch.accepted) cur.accepted += patch.accepted;
    if (patch.ambiguous) cur.ambiguous += patch.ambiguous;
    result.perOrg.set(orgId, cur);
  };

  // Run-wide "claimed measurement" set. Seeded with every measurement that
  // any existing suggestion already references so prior backfill / runtime
  // ACCEPTED rows take precedence — and persisted across analyses so a
  // single measurement.id can never anchor more than one suggestion (the
  // collision the analysis-scoped ACCEPTED match is designed to prevent
  // when positional `aiItemId`s like "item-1" repeat across analyses on
  // the same sheet).
  const priorClaims = await db
    .select({ id: aiTakeoffSuggestions.acceptedMeasurementId })
    .from(aiTakeoffSuggestions)
    .where(isNotNull(aiTakeoffSuggestions.acceptedMeasurementId));
  const claimed = new Set<string>(
    priorClaims
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string"),
  );

  // Walk analyses in id-order pages so the script is restartable and uses
  // a stable cursor (no OFFSET drift on insert).
  let cursor: string | null = null;

  while (true) {
    const where = cursor
      ? and(
          eq(aiTakeoffAnalyses.status, "COMPLETE"),
          isNotNull(aiTakeoffAnalyses.detectedItemsJson),
          gt(aiTakeoffAnalyses.id, cursor),
        )
      : and(
          eq(aiTakeoffAnalyses.status, "COMPLETE"),
          isNotNull(aiTakeoffAnalyses.detectedItemsJson),
        );

    const batch = await db
      .select({
        id: aiTakeoffAnalyses.id,
        organizationId: aiTakeoffAnalyses.organizationId,
        tradeType: aiTakeoffAnalyses.tradeType,
        takeoffSheetId: aiTakeoffAnalyses.takeoffSheetId,
        detectedItemsJson: aiTakeoffAnalyses.detectedItemsJson,
        createdAt: aiTakeoffAnalyses.createdAt,
        updatedAt: aiTakeoffAnalyses.updatedAt,
      })
      .from(aiTakeoffAnalyses)
      .where(where)
      .orderBy(asc(aiTakeoffAnalyses.id))
      .limit(opts.batchSize);

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    result.scannedAnalyses += batch.length;

    for (const analysis of batch) {
      let items: unknown;
      try {
        items = JSON.parse(analysis.detectedItemsJson ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) continue;

      const normalized: NormalizedItem[] = (items as RawDetectedItem[]).map(normalizeItem);

      // Existing suggestion rows for this analysis, keyed by itemKey.
      const existingRows = await db
        .select({
          id: aiTakeoffSuggestions.id,
          itemKey: aiTakeoffSuggestions.itemKey,
          status: aiTakeoffSuggestions.status,
          acceptedMeasurementId: aiTakeoffSuggestions.acceptedMeasurementId,
        })
        .from(aiTakeoffSuggestions)
        .where(eq(aiTakeoffSuggestions.analysisId, analysis.id));
      const existingByKey = new Map(existingRows.map((r) => [r.itemKey, r]));

      const candidatesByKey = await loadMeasurementCandidates(analysis.takeoffSheetId);
      // `claimed` lives at run scope so a single measurement.id can never
      // anchor more than one suggestion across the whole backfill (see the
      // seeding above the analysis loop).
      const analysisCompletedAt = analysis.updatedAt ?? analysis.createdAt;

      let analysisTouched = false;

      for (const item of normalized) {
        const match = matchMeasurement(
          item,
          candidatesByKey.get(item.itemKey),
          analysisCompletedAt,
          claimed,
        );

        let targetStatus: "PENDING" | "ACCEPTED" = "PENDING";
        let matchedMeasurementId: string | null = null;
        if (match === "ambiguous") {
          result.ambiguousMatches += 1;
          bumpOrg(analysis.organizationId, { ambiguous: 1 });
        } else if (match) {
          targetStatus = "ACCEPTED";
          matchedMeasurementId = match.measurementId;
        }

        const existing = existingByKey.get(item.itemKey);

        if (!existing) {
          // ON CONFLICT DO NOTHING against the
          // ai_takeoff_sug_analysis_item_key_uq unique index gives us
          // crash-safe / concurrent-safe idempotency at the DB layer.
          // RETURNING lets us count only rows that actually committed
          // (a payload with duplicate item_keys, or a concurrent backfill,
          // can hit the conflict path even though our pre-read said the row
          // was missing — those cases must not inflate the metrics).
          let inserted = !opts.dryRun ? false : true;
          if (!opts.dryRun) {
            const res = await db.execute(sql`
              INSERT INTO ai_takeoff_suggestions
                (analysis_id, organization_id, trade_type,
                 item_key, item_type, description, quantity, unit,
                 confidence, bounding_box_json, status,
                 accepted_measurement_id, reviewed_at)
              VALUES
                (${analysis.id}, ${analysis.organizationId},
                 ${analysis.tradeType as TradeType}::trade_type,
                 ${item.itemKey}, ${item.itemType}, ${item.description},
                 ${item.quantity}, ${item.unit}, ${item.confidence},
                 ${item.boundingBoxJson},
                 ${targetStatus}::ai_takeoff_suggestion_status,
                 ${matchedMeasurementId},
                 ${targetStatus === "ACCEPTED" ? new Date() : null})
              ON CONFLICT (analysis_id, item_key) DO NOTHING
              RETURNING id
            `);
            inserted = (res.rows?.length ?? 0) > 0;
          }
          if (!inserted) {
            // Lost the race to another writer. Treat as already-existing.
            result.skippedExisting += 1;
            continue;
          }
          if (matchedMeasurementId) claimed.add(matchedMeasurementId);
          result.insertedSuggestions += 1;
          if (targetStatus === "ACCEPTED") result.acceptedSuggestions += 1;
          bumpOrg(analysis.organizationId, {
            inserted: 1,
            accepted: targetStatus === "ACCEPTED" ? 1 : 0,
          });
          analysisTouched = true;
          continue;
        }

        // Existing row — only upgrade PENDING → ACCEPTED when an unambiguous
        // matching measurement is now known. Never downgrade or overwrite a
        // row the user has already reviewed (ACCEPTED/EDITED/REJECTED).
        if (
          existing.status === "PENDING" &&
          targetStatus === "ACCEPTED" &&
          matchedMeasurementId &&
          existing.acceptedMeasurementId !== matchedMeasurementId
        ) {
          if (!opts.dryRun) {
            await db
              .update(aiTakeoffSuggestions)
              .set({
                status: "ACCEPTED",
                acceptedMeasurementId: matchedMeasurementId,
                reviewedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(aiTakeoffSuggestions.id, existing.id));
          }
          claimed.add(matchedMeasurementId);
          result.upgradedToAccepted += 1;
          result.acceptedSuggestions += 1;
          bumpOrg(analysis.organizationId, { accepted: 1 });
          analysisTouched = true;
        } else {
          result.skippedExisting += 1;
        }
      }

      if (analysisTouched) {
        result.processedAnalyses += 1;
        bumpOrg(analysis.organizationId, { analyses: 1 });
      }
    }

    if (batch.length < opts.batchSize) break;
  }

  return result;
}

function printPerOrgTotals(result: BackfillResult): void {
  if (result.perOrg.size === 0) {
    console.log("[backfill-ai-takeoff-suggestions] Per-org totals: (none touched)");
    return;
  }
  const rows = Array.from(result.perOrg.values()).sort(
    (a, b) => b.inserted + b.accepted - (a.inserted + a.accepted),
  );
  console.log("[backfill-ai-takeoff-suggestions] Per-org totals:");
  for (const row of rows) {
    console.log(
      `  ${row.organizationId} — analyses=${row.analyses} inserted=${row.inserted} accepted=${row.accepted} ambiguous=${row.ambiguous}`,
    );
  }
}

/**
 * Task #2361 — re-runs the per-org confidence calibration immediately after
 * the backfill, scoped to the orgs whose suggestion table actually changed
 * (insert + upgrade-to-ACCEPTED counts > 0). Touched orgs whose changes
 * were all PENDING (insert with `accepted=0`) still feed the calibration —
 * a brand-new wave of PENDING rows doesn't shift the empirical numbers
 * (the SQL filters on `reviewed_at IS NOT NULL`), but the upserted row
 * count surfacing zero is itself a useful "nothing crossed the threshold"
 * signal for the operator.
 */
async function recalibrateTouchedOrgs(result: BackfillResult): Promise<void> {
  const touched = Array.from(result.perOrg.values())
    .filter((o) => o.inserted > 0 || o.accepted > 0)
    .map((o) => o.organizationId);

  if (touched.length === 0) {
    console.log(
      "[backfill-ai-takeoff-suggestions] --also-recalibrate: no touched orgs, skipping calibration recompute.",
    );
    return;
  }

  console.log(
    `[backfill-ai-takeoff-suggestions] --also-recalibrate: recomputing ai_takeoff_confidence_calibration for ${touched.length} org${touched.length === 1 ? "" : "s"}…`,
  );

  // Lazy-imported so the script doesn't pull the whole Express router
  // graph on a `--dry-run` (recalibrate is a no-op in dry-run anyway).
  const { runAiTakeoffCalibrationJob } = await import(
    "../server/aiTakeoffFeatureRoutes"
  );
  const t0 = Date.now();
  const calibResult = await runAiTakeoffCalibrationJob({
    organizationIds: touched,
  });
  const ms = Date.now() - t0;

  console.log(
    `[backfill-ai-takeoff-suggestions] --also-recalibrate: done in ${ms}ms — totalRowsUpserted=${calibResult.rowsUpserted}`,
  );

  // Stable ordering: orgs with the most upserts first, then most below-
  // threshold buckets, then by id. Mirrors the per-org backfill totals
  // ordering so the two reports line up visually.
  const orgs = Array.from(calibResult.perOrg.values()).sort((a, b) => {
    if (b.bucketsUpserted !== a.bucketsUpserted) {
      return b.bucketsUpserted - a.bucketsUpserted;
    }
    if (b.bucketsBelowThreshold !== a.bucketsBelowThreshold) {
      return b.bucketsBelowThreshold - a.bucketsBelowThreshold;
    }
    return a.organizationId.localeCompare(b.organizationId);
  });

  for (const org of orgs) {
    if (org.buckets.length === 0) {
      console.log(
        `  ${org.organizationId} — no reviewed suggestions in the last 90 days (no buckets to compute)`,
      );
      continue;
    }
    const bucketParts = org.buckets
      .slice()
      .sort((a, b) => {
        if (a.tradeType !== b.tradeType) return a.tradeType.localeCompare(b.tradeType);
        return a.bucket - b.bucket;
      })
      .map((b) => {
        const rate = (b.acceptanceRate * 100).toFixed(1);
        const tag = b.upserted ? "upserted" : "below-threshold";
        return `${b.tradeType}/${b.bucket}=${b.samples}@${rate}%(${tag})`;
      })
      .join(" ");
    console.log(
      `  ${org.organizationId} — upserted=${org.bucketsUpserted} belowThreshold=${org.bucketsBelowThreshold} | ${bucketParts}`,
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[backfill-ai-takeoff-suggestions] Starting${opts.dryRun ? " (dry-run)" : ""} batchSize=${opts.batchSize}${opts.alsoRecalibrate ? " also-recalibrate" : ""}…`,
  );
  const t0 = Date.now();
  const result = await backfillAiTakeoffSuggestions(opts);
  const ms = Date.now() - t0;
  console.log(
    `[backfill-ai-takeoff-suggestions] Done in ${ms}ms — scanned=${result.scannedAnalyses} processed=${result.processedAnalyses} inserted=${result.insertedSuggestions} acceptedTotal=${result.acceptedSuggestions} upgraded=${result.upgradedToAccepted} ambiguous=${result.ambiguousMatches} skippedExisting=${result.skippedExisting}`,
  );
  printPerOrgTotals(result);

  if (opts.alsoRecalibrate) {
    if (opts.dryRun) {
      console.log(
        "[backfill-ai-takeoff-suggestions] --also-recalibrate ignored under --dry-run (would mutate ai_takeoff_confidence_calibration).",
      );
    } else {
      await recalibrateTouchedOrgs(result);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-ai-takeoff-suggestions] FAILED", err);
    process.exit(1);
  });
