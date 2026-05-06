import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2323 — AI takeoff closed-loop feedback.
 *
 * Idempotent startup migration that:
 *   1. Creates the `ai_takeoff_suggestion_status` and
 *      `ai_takeoff_reject_reason` enums.
 *   2. Creates the `ai_takeoff_suggestions` and
 *      `ai_takeoff_confidence_calibration` tables (mirrors
 *      `migrations/0075_ai_takeoff_suggestions.sql`).
 *   3. **Backfills** one PENDING suggestion row per detected item from
 *      every existing `ai_takeoff_analyses.detected_items_json` blob
 *      that doesn't yet have any suggestion rows. This is the one-shot
 *      backfill required to flip the closed-loop dashboard on without
 *      losing visibility into pre-feedback analyses.
 *
 * Safe to run on every boot — both the table creates and the backfill
 * use NOT EXISTS guards so they're no-ops once applied.
 */
export async function ensureAiTakeoffSuggestionsTables(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_takeoff_suggestion_status') THEN
          CREATE TYPE ai_takeoff_suggestion_status AS ENUM (
            'PENDING', 'ACCEPTED', 'REJECTED', 'EDITED'
          );
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_takeoff_reject_reason') THEN
          CREATE TYPE ai_takeoff_reject_reason AS ENUM (
            'WRONG_TRADE', 'DUPLICATE', 'NOT_PRESENT',
            'WRONG_QUANTITY', 'WRONG_LOCATION', 'OTHER'
          );
        END IF;
      END $$;
    `));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ai_takeoff_suggestions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        analysis_id varchar NOT NULL REFERENCES ai_takeoff_analyses(id) ON DELETE CASCADE,
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        trade_type trade_type NOT NULL,
        item_key text NOT NULL,
        item_type text NOT NULL,
        description text NOT NULL,
        quantity double precision NOT NULL,
        unit text NOT NULL,
        confidence double precision NOT NULL,
        bounding_box_json text,
        status ai_takeoff_suggestion_status NOT NULL DEFAULT 'PENDING',
        reviewed_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at timestamp,
        accepted_measurement_id varchar REFERENCES takeoff_measurements(id) ON DELETE SET NULL,
        edited_quantity double precision,
        edited_unit text,
        edited_item_type text,
        reject_reason ai_takeoff_reject_reason,
        reject_note text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS ai_takeoff_sug_analysis_idx
         ON ai_takeoff_suggestions (analysis_id)`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS ai_takeoff_sug_org_trade_status_idx
         ON ai_takeoff_suggestions (organization_id, trade_type, status)`,
    ));

    // Task #2343 — dedupe any existing duplicates on (analysis_id, item_key)
    // before installing the unique index. Keeps the row whose status carries
    // the most signal (ACCEPTED/EDITED beat REJECTED/PENDING), breaking ties
    // on earliest created_at so we keep the first reviewer's verdict.
    // No-op once dedupe + the unique index below have run on a given DB.
    await db.execute(sql.raw(`
      WITH ranked AS (
        SELECT id,
               row_number() OVER (
                 PARTITION BY analysis_id, item_key
                 ORDER BY CASE status
                            WHEN 'ACCEPTED' THEN 0
                            WHEN 'EDITED' THEN 1
                            WHEN 'REJECTED' THEN 2
                            WHEN 'PENDING' THEN 3
                            ELSE 4
                          END,
                          created_at ASC,
                          id ASC
               ) AS rn
          FROM ai_takeoff_suggestions
      )
      DELETE FROM ai_takeoff_suggestions s
       USING ranked
       WHERE s.id = ranked.id
         AND ranked.rn > 1
    `));
    // Task #2343 — DB-level idempotency for the closed-loop insert path
    // (`persistDetectedItemsAsSuggestions` and the
    // `scripts/backfill-ai-takeoff-suggestions.ts` job). Lets both call sites
    // safely use ON CONFLICT (analysis_id, item_key) DO NOTHING and prevents
    // duplicate rows under retry / concurrent backfill runs.
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_takeoff_sug_analysis_item_key_uq
         ON ai_takeoff_suggestions (analysis_id, item_key)`,
    ));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ai_takeoff_confidence_calibration (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        trade_type trade_type NOT NULL,
        model_confidence_bucket integer NOT NULL,
        empirical_acceptance_rate double precision NOT NULL,
        sample_count integer NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS ai_takeoff_calib_org_trade_bucket_uq
         ON ai_takeoff_confidence_calibration (organization_id, trade_type, model_confidence_bucket)`,
    ));

    // Backfill: for any analysis that has detected_items_json but no
    // suggestion rows yet, insert one PENDING row per detected item.
    // We only consider COMPLETE analyses (PROCESSING/FAILED have nothing to track).
    const candidates = await db.execute(sql.raw(`
      SELECT a.id AS analysis_id,
             a.organization_id,
             a.trade_type,
             a.detected_items_json
        FROM ai_takeoff_analyses a
        LEFT JOIN ai_takeoff_suggestions s ON s.analysis_id = a.id
       WHERE a.detected_items_json IS NOT NULL
         AND a.status = 'COMPLETE'
         AND s.id IS NULL
       GROUP BY a.id
       LIMIT 5000
    `));

    let backfilledRows = 0;
    let backfilledAnalyses = 0;
    for (const row of (candidates.rows as Array<{
      analysis_id: string;
      organization_id: string;
      trade_type: string;
      detected_items_json: string | null;
    }>)) {
      if (!row.detected_items_json) continue;
      let items: any[] = [];
      try {
        items = JSON.parse(row.detected_items_json);
      } catch {
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) continue;

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx] || {};
        const itemKey = String(item.id ?? `item-${idx + 1}`);
        const itemType = String(item.itemType ?? "other");
        const description = String(item.description ?? itemType);
        const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
        const unit = String(item.unit ?? "EA");
        const confidence = Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 75;
        const bboxJson = item.boundingBox ? JSON.stringify(item.boundingBox) : null;
        // ON CONFLICT against the ai_takeoff_sug_analysis_item_key_uq
        // unique index keeps this no-op safe even when an item-key collides
        // (positional `item-1` ids can repeat within a single payload if a
        // detected-items blob happens to duplicate them) or when the
        // standalone backfill script has already populated the row.
        // RETURNING lets `backfilledRows` reflect committed inserts only.
        const ins = await db.execute(sql`
          INSERT INTO ai_takeoff_suggestions
            (analysis_id, organization_id, trade_type,
             item_key, item_type, description, quantity, unit,
             confidence, bounding_box_json, status)
          VALUES
            (${row.analysis_id}, ${row.organization_id}, ${row.trade_type}::trade_type,
             ${itemKey}, ${itemType}, ${description}, ${quantity}, ${unit},
             ${confidence}, ${bboxJson}, 'PENDING')
          ON CONFLICT (analysis_id, item_key) DO NOTHING
          RETURNING id
        `);
        if ((ins.rows?.length ?? 0) > 0) backfilledRows++;
      }
      backfilledAnalyses++;
    }

    if (backfilledAnalyses > 0) {
      logInfo(
        `[migration] ai_takeoff_suggestions — backfilled ${backfilledRows} rows from ${backfilledAnalyses} analyses`,
      );
    } else {
      logInfo(`[migration] ai_takeoff_suggestions — table ready, nothing to backfill`);
    }
  } catch (err) {
    logError(
      `[migration] Failed to ensure ai_takeoff_suggestions tables:`,
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
