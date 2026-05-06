import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2403 + #2404 — Standalone Takeoff Tool.
 *
 * Idempotent startup migration that ensures the standalone takeoff
 * tables, the `takeoff_sheets.standalone_takeoff_id` column + FK, and
 * the `estimate_line_items` send-to-estimate provenance columns all
 * exist. Safe to run on every boot.
 */
export async function ensureStandaloneTakeoffTables(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS standalone_takeoffs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        owner_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title text NOT NULL,
        trade_type trade_type,
        client_name text,
        location_address text,
        notes text,
        settings text NOT NULL DEFAULT '{}',
        archived_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS standalone_takeoffs_org_idx ON standalone_takeoffs(organization_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS standalone_takeoffs_owner_idx ON standalone_takeoffs(owner_user_id, updated_at)`));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS takeoff_tags (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        standalone_takeoff_id varchar NOT NULL REFERENCES standalone_takeoffs(id) ON DELETE CASCADE,
        bid_id varchar REFERENCES bids(id) ON DELETE CASCADE,
        project_id varchar REFERENCES projects(id) ON DELETE CASCADE,
        tagged_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT takeoff_tags_exactly_one_dest CHECK (
          (bid_id IS NOT NULL AND project_id IS NULL) OR
          (bid_id IS NULL AND project_id IS NOT NULL)
        )
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS takeoff_tags_takeoff_idx ON takeoff_tags(standalone_takeoff_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS takeoff_tags_bid_idx ON takeoff_tags(bid_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS takeoff_tags_project_idx ON takeoff_tags(project_id)`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS takeoff_tags_takeoff_bid_unique ON takeoff_tags(standalone_takeoff_id, bid_id) WHERE bid_id IS NOT NULL`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS takeoff_tags_takeoff_project_unique ON takeoff_tags(standalone_takeoff_id, project_id) WHERE project_id IS NOT NULL`));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS standalone_takeoff_files (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        standalone_takeoff_id varchar NOT NULL REFERENCES standalone_takeoffs(id) ON DELETE CASCADE,
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        uploaded_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        file_name text NOT NULL,
        file_url text NOT NULL,
        object_key text,
        mime_type text,
        file_size integer,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS standalone_takeoff_files_takeoff_idx ON standalone_takeoff_files(standalone_takeoff_id)`));

    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS takeoff_suggestion_dismissals (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        standalone_takeoff_id varchar NOT NULL REFERENCES standalone_takeoffs(id) ON DELETE CASCADE,
        destination_kind text NOT NULL,
        destination_id varchar NOT NULL,
        outcome text NOT NULL DEFAULT 'DISMISSED',
        created_at timestamp NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS takeoff_suggestion_dismissals_user_dest_idx ON takeoff_suggestion_dismissals(user_id, destination_kind, destination_id)`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS takeoff_suggestion_dismissals_unique ON takeoff_suggestion_dismissals(user_id, standalone_takeoff_id, destination_kind, destination_id)`));

    // takeoff_sheets — add nullable standalone_takeoff_id + FK.
    await db.execute(sql.raw(`
      ALTER TABLE takeoff_sheets
        ADD COLUMN IF NOT EXISTS standalone_takeoff_id varchar
    `));
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'takeoff_sheets_standalone_takeoff_fkey'
        ) THEN
          ALTER TABLE takeoff_sheets
            ADD CONSTRAINT takeoff_sheets_standalone_takeoff_fkey
            FOREIGN KEY (standalone_takeoff_id) REFERENCES standalone_takeoffs(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS takeoff_sheets_standalone_idx ON takeoff_sheets(standalone_takeoff_id)`));

    // estimate_line_items — send-to-estimate provenance + soft-delete.
    await db.execute(sql.raw(`
      ALTER TABLE estimate_line_items
        ADD COLUMN IF NOT EXISTS source_type text,
        ADD COLUMN IF NOT EXISTS source_takeoff_id varchar,
        ADD COLUMN IF NOT EXISTS source_measurement_id varchar,
        ADD COLUMN IF NOT EXISTS deleted_at timestamp
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS estimate_line_items_source_measurement_idx
        ON estimate_line_items(estimate_id, source_measurement_id)
    `));
    // Idempotency guard for send-to-estimate. Partial unique index over
    // live (non-soft-deleted) rows so the same measurement can only have
    // one active estimate row per estimate at a time.
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS estimate_line_items_source_measurement_unique
        ON estimate_line_items(estimate_id, source_measurement_id)
        WHERE source_measurement_id IS NOT NULL AND deleted_at IS NULL
    `));

    logInfo("[migration] standalone takeoff tables ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure standalone takeoff tables:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
