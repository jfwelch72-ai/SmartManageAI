import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Task #2693 — Mobile Sync Conflict Resolution Hardening.
 *
 * Idempotent startup helper that mirrors
 * `migrations/0108_mobile_sync_events.sql`:
 *   1. Creates the `mobile_sync_events` table with all required columns.
 *   2. Creates supporting indexes.
 *   3. Adds a `logical_clock` column to `offline_sync_queue` for Lamport
 *      timestamps from mobile devices.
 */
export async function ensureMobileSyncEventsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mobile_sync_events (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        local_id TEXT,
        server_id TEXT,
        operation TEXT NOT NULL,
        strategy TEXT NOT NULL,
        outcome TEXT NOT NULL,
        client_timestamp TIMESTAMPTZ,
        server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        logical_clock INTEGER,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        conflict_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`CREATE INDEX IF NOT EXISTS mobile_sync_events_org_idx ON mobile_sync_events(organization_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS mobile_sync_events_device_idx ON mobile_sync_events(device_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS mobile_sync_events_entity_type_idx ON mobile_sync_events(entity_type)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS mobile_sync_events_outcome_idx ON mobile_sync_events(outcome)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS mobile_sync_events_created_at_idx ON mobile_sync_events(created_at)`);

    await db.execute(sql`
      ALTER TABLE offline_sync_queue ADD COLUMN IF NOT EXISTS logical_clock INTEGER
    `);

    logInfo("[ensureMobileSyncEventsTable] mobile_sync_events table ready");
  } catch (err) {
    logError(err, { helper: "ensureMobileSyncEventsTable" });
    throw err;
  }
}
