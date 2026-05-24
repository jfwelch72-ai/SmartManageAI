import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #3064 — AI Line Item Enrichment Engine.
 *
 * Creates three learning-loop tables idempotently:
 *   enrichment_log       — full request/response pair for every Claude call
 *   enrichment_feedback  — real-time Accept/Modify/Dismiss events per suggestion field
 *   bid_outcomes         — bid award outcomes for improving future org history
 *
 * All jsonb — no rigid per-field columns so the schema can evolve without
 * new migrations every time the enrichment output contract changes.
 */
export async function ensureEnrichmentTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS enrichment_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id          TEXT NOT NULL,
      user_id         TEXT,
      estimate_line_item_id TEXT,
      cost_code       TEXT,
      mode            TEXT NOT NULL DEFAULT 'ON_DEMAND',
      request         JSONB NOT NULL,
      response        JSONB,
      duration_ms     TEXT,
      error_message   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS enrichment_log_org_id_idx
      ON enrichment_log (org_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS enrichment_log_cost_code_idx
      ON enrichment_log (org_id, cost_code)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS enrichment_log_created_at_idx
      ON enrichment_log (created_at)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS enrichment_feedback (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id              TEXT NOT NULL,
      user_id             TEXT NOT NULL,
      enrichment_log_id   UUID REFERENCES enrichment_log(id),
      cost_code           TEXT,
      project_type        TEXT,
      project_size        TEXT,
      location            TEXT,
      labor_type          TEXT,
      field_name          TEXT NOT NULL,
      outcome             TEXT NOT NULL,
      suggested_value     JSONB,
      accepted_value      JSONB,
      payload             JSONB,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS enrichment_feedback_org_cost_code_idx
      ON enrichment_feedback (org_id, cost_code)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS enrichment_feedback_enrichment_log_idx
      ON enrichment_feedback (enrichment_log_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS enrichment_feedback_created_at_idx
      ON enrichment_feedback (created_at)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bid_outcomes (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id                      TEXT NOT NULL,
      project_id                  TEXT,
      bid_id                      TEXT,
      cost_code                   TEXT NOT NULL,
      project_type                TEXT,
      project_size                TEXT,
      location                    TEXT,
      labor_type                  TEXT,
      final_bid_unit_cost_material TEXT,
      final_bid_unit_cost_labor    TEXT,
      bid_outcome                 TEXT NOT NULL,
      competitor_low_bid          TEXT,
      payload                     JSONB,
      created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bid_outcomes_org_cost_code_idx
      ON bid_outcomes (org_id, cost_code)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS bid_outcomes_created_at_idx
      ON bid_outcomes (created_at)
  `);

  // Task #3064 — backfill new columns added to existing tables.
  // These are idempotent ADD COLUMN IF NOT EXISTS statements so they
  // can run safely on an already-migrated database.
  await db.execute(sql`
    ALTER TABLE enrichment_log
      ADD COLUMN IF NOT EXISTS measurement_id TEXT
  `);
  await db.execute(sql`
    ALTER TABLE takeoff_measurements
      ADD COLUMN IF NOT EXISTS enrichment_id TEXT
  `);

  logInfo("[migration] enrichment_log / enrichment_feedback / bid_outcomes — tables ready");
}
