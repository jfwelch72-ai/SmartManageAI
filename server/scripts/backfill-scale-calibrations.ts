/**
 * One-shot backfill: emit synthetic structured `scale_calibration` audit
 * rows for every `takeoff_sheets` row that was calibrated *before* Task #2325
 * started writing structured `{kind:"scale_calibration"}` audit entries.
 *
 * Without this, the new Scale History panel (`GET
 * /api/takeoff/sheets/:sheetId/scale-history`) shows only the "Current"
 * section for sheets calibrated under the old code path — the timeline below
 * is empty even though the sheet plainly has a px/ft value.
 *
 * What gets inserted (per qualifying sheet):
 *   - action     = 'UPDATE'
 *   - oldValue   = NULL                 (no prior structured state)
 *   - newValue   = JSON-stringified payload with kind="scale_calibration",
 *                  the sheet's current scale fields, and source="backfill"
 *                  so the panel can label this entry as a synthetic baseline
 *   - createdAt  = sheet.scale_calibrated_at  (so the timeline lands the
 *                  entry at the moment the calibration originally happened)
 *   - userId     = sheet.scale_calibrated_by_id
 *
 * Qualifying sheets: scale_px_per_foot IS NOT NULL AND
 * scale_calibrated_at IS NOT NULL AND scale_calibrated_by_id IS NOT NULL.
 * The third predicate is required because audit_log.user_id is NOT NULL with
 * an FK to users.id — sheets without a recorded calibrator are reported in
 * stats but skipped (extremely rare in practice; every calibration write
 * sets req.user!.id, and supersede inheritance copies the parent's value).
 *
 * Idempotent: a sheet already covered by ANY structured scale_calibration
 * audit row (legacy or backfilled) is left alone via NOT EXISTS. Safe to
 * re-run; subsequent calls insert zero rows.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-scale-calibrations.ts            # real run
 *   npx tsx server/scripts/backfill-scale-calibrations.ts --dry-run  # report only
 *
 * Programmatic use: see `runScaleCalibrationBackfill` below — the post-deploy
 * one-shot runner in `server/utils/runScaleCalibrationBackfillOnce.ts` calls
 * it directly so every tenant gets backfilled without an admin running tsx.
 */

import { sql } from "drizzle-orm";
import { db, pool } from "../db";

export interface ScaleCalibrationBackfillOptions {
  dryRun?: boolean;
}

export interface ScaleCalibrationBackfillStats {
  inserted: number;
  alreadyHadStructured: number;
  missingCalibratedBy: number;
  candidatesScanned: number;
  dryRun: boolean;
}

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return { dryRun: argv.includes("--dry-run") };
}

/**
 * Run the scale-calibration backfill. Returns a stats object describing what
 * was inserted/skipped. Safe to call repeatedly — sheets that already have a
 * structured `scale_calibration` audit row are filtered out by NOT EXISTS.
 *
 * Implementation notes:
 *   - Counts (`alreadyHadStructured`, `missingCalibratedBy`) are computed
 *     from the same candidate pool that drives the INSERT, so the stats are
 *     internally consistent with the run that just executed.
 *   - Detection uses a POSIX regex (`~ '"kind"[[:space:]]*:[[:space:]]*"scale_calibration"'`)
 *     rather than a substring/`LIKE` match. The live JS-side writers in
 *     `server/takeoffSheetRoutes.ts`, `server/takeoffSheetSetRoutes.ts`, and
 *     `server/takeoffMeasurementRoutes.ts` use `JSON.stringify(...)` and
 *     therefore emit the compact form `"kind":"scale_calibration"`, BUT the
 *     synthetic payload below is built by Postgres' `json_build_object(...)::text`,
 *     which serialises with a space after the colon (`"kind": "scale_calibration"`).
 *     A naive `LIKE '%"kind":"scale_calibration"%'` would therefore fail to
 *     match the very rows this backfill itself just inserted, breaking
 *     idempotency on the second run. The whitespace-tolerant regex matches
 *     both forms. We deliberately keep this as a text predicate (no jsonb
 *     cast) because audit_log.new_value is plain text and not every row is
 *     valid JSON; casting at the row level would throw.
 */
export async function runScaleCalibrationBackfill(
  options: ScaleCalibrationBackfillOptions = {},
): Promise<ScaleCalibrationBackfillStats> {
  const dryRun = !!options.dryRun;

  // First, characterise the candidate pool so the stats reflect the pre-INSERT
  // state of the world even when dryRun=true (and even when the INSERT below
  // is a zero-row no-op because everything is already covered).
  const overviewRes = await db.execute(sql`
    WITH candidates AS (
      SELECT
        id,
        scale_calibrated_by_id,
        EXISTS (
          SELECT 1
          FROM audit_log al
          WHERE al.entity_type = 'takeoff_sheet'
            AND al.entity_id = takeoff_sheets.id
            AND al.new_value ~ '"kind"[[:space:]]*:[[:space:]]*"scale_calibration"'
        ) AS already_has_structured
      FROM takeoff_sheets
      WHERE scale_px_per_foot IS NOT NULL
        AND scale_calibrated_at IS NOT NULL
    )
    SELECT
      COUNT(*)::int AS candidates_scanned,
      COUNT(*) FILTER (WHERE already_has_structured)::int AS already_had_structured,
      COUNT(*) FILTER (
        WHERE NOT already_has_structured AND scale_calibrated_by_id IS NULL
      )::int AS missing_calibrated_by
    FROM candidates
  `);

  const overviewRow = (overviewRes.rows?.[0] ?? {}) as {
    candidates_scanned?: number | string | null;
    already_had_structured?: number | string | null;
    missing_calibrated_by?: number | string | null;
  };
  const candidatesScanned = Number(overviewRow.candidates_scanned ?? 0);
  const alreadyHadStructured = Number(overviewRow.already_had_structured ?? 0);
  const missingCalibratedBy = Number(overviewRow.missing_calibrated_by ?? 0);

  if (dryRun) {
    // Dry run: don't INSERT, but compute how many rows *would* be inserted
    // by counting the eligible candidates (not already structured, has a
    // calibrator). Same WHERE shape as the INSERT below.
    const wouldInsertRes = await db.execute(sql`
      SELECT COUNT(*)::int AS would_insert
      FROM takeoff_sheets ts
      WHERE ts.scale_px_per_foot IS NOT NULL
        AND ts.scale_calibrated_at IS NOT NULL
        AND ts.scale_calibrated_by_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM audit_log al
          WHERE al.entity_type = 'takeoff_sheet'
            AND al.entity_id = ts.id
            AND al.new_value ~ '"kind"[[:space:]]*:[[:space:]]*"scale_calibration"'
        )
    `);
    const wouldRow = (wouldInsertRes.rows?.[0] ?? {}) as {
      would_insert?: number | string | null;
    };
    return {
      inserted: Number(wouldRow.would_insert ?? 0),
      alreadyHadStructured,
      missingCalibratedBy,
      candidatesScanned,
      dryRun: true,
    };
  }

  // Real INSERT. We build the JSON payload server-side via json_build_object
  // so the exact field order and quoting matches what a JS-side
  // `JSON.stringify({ kind: "scale_calibration", … })` would produce
  // closely enough for the panel parser (which only cares about `kind` +
  // present keys, not key ordering). We also bake `source: "backfill"` into
  // the payload so the future Scale History UI can label these synthetic
  // entries as a one-time baseline rather than a real recalibration.
  const insertRes = await db.execute(sql`
    INSERT INTO audit_log (
      user_id,
      entity_type,
      entity_id,
      action,
      old_value,
      new_value,
      created_at
    )
    SELECT
      ts.scale_calibrated_by_id,
      'takeoff_sheet',
      ts.id,
      'UPDATE',
      NULL,
      json_build_object(
        'kind', 'scale_calibration',
        'scalePxPerFoot', ts.scale_px_per_foot,
        'scaleLabel', ts.scale_label,
        'units', ts.units,
        'scaleSource', ts.scale_source,
        'scaleConfidence', ts.scale_confidence,
        'scaleCalibratedById', ts.scale_calibrated_by_id,
        'scaleCalibratedAt', to_char(
          ts.scale_calibrated_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'source', 'backfill'
      )::text,
      ts.scale_calibrated_at
    FROM takeoff_sheets ts
    WHERE ts.scale_px_per_foot IS NOT NULL
      AND ts.scale_calibrated_at IS NOT NULL
      AND ts.scale_calibrated_by_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM audit_log al
        WHERE al.entity_type = 'takeoff_sheet'
          AND al.entity_id = ts.id
          AND al.new_value ~ '"kind"[[:space:]]*:[[:space:]]*"scale_calibration"'
      )
    RETURNING id
  `);
  const inserted = insertRes.rows?.length ?? 0;

  return {
    inserted,
    alreadyHadStructured,
    missingCalibratedBy,
    candidatesScanned,
    dryRun: false,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stats = await runScaleCalibrationBackfill(opts);
  console.log(
    `[backfill-scale-calibrations] done. inserted=${stats.inserted} ` +
      `alreadyHadStructured=${stats.alreadyHadStructured} ` +
      `missingCalibratedBy=${stats.missingCalibratedBy} ` +
      `candidatesScanned=${stats.candidatesScanned} dryRun=${stats.dryRun}`,
  );
}

// Only run as a CLI when invoked directly. Importing this file from the
// startup runner must NOT close the shared pg pool.
const isDirectInvocation = (() => {
  try {
    const entry = process.argv[1] || "";
    return (
      entry.endsWith("backfill-scale-calibrations.ts") ||
      entry.endsWith("backfill-scale-calibrations.js")
    );
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main()
    .catch((err) => {
      console.error("[backfill-scale-calibrations] failed", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end().catch(() => {});
    });
}
