import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1404 — mirrors migrations/0052_integration_sync_alert_mutes.sql.
 * Creates `integration_sync_alert_mutes` so org admins can silence the
 * INTEGRATION_SYNC_RETRIES_EXHAUSTED fan-out per integration connection
 * (and optionally per entity type) when a chronically broken integration
 * would otherwise keep spamming every distinct-entity exhaustion to every
 * org admin.
 *
 * The COALESCE expression index enforces "one mute per (connection,
 * entity_type)" because a plain UNIQUE would treat NULLs as distinct
 * (so you could end up with multiple connection-wide mutes).
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensureIntegrationSyncAlertMutes(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `CREATE TABLE IF NOT EXISTS integration_sync_alert_mutes (
         id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
         organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         connection_id varchar NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
         entity_type text,
         muted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
         reason text,
         created_at timestamp NOT NULL DEFAULT now(),
         updated_at timestamp NOT NULL DEFAULT now()
       )`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS integration_sync_alert_mutes_org_idx ON integration_sync_alert_mutes(organization_id)`,
    ));
    await db.execute(sql.raw(
      `CREATE INDEX IF NOT EXISTS integration_sync_alert_mutes_connection_idx ON integration_sync_alert_mutes(connection_id)`,
    ));
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS integration_sync_alert_mutes_conn_entity_uniq ON integration_sync_alert_mutes(connection_id, COALESCE(entity_type, ''))`,
    ));
    logInfo("[migration] integration_sync_alert_mutes ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure integration_sync_alert_mutes:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
