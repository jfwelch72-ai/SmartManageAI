import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

/**
 * Task #2755 / #2804 — OAuth reconnect alert flow.
 *
 * migration 0114_oauth_reconnect_alert.sql adds two enum values that
 * cannot be synthesized by reconcileSchemaDrift (which creates missing
 * enum types but never appends values to existing ones):
 *
 *   - `needs_reconnect` on `integration_connection_status` — distinguishes
 *     permanent auth failures (invalid_grant, revoked token) from transient
 *     errors so the sync engine skips retrying until the user re-authorizes.
 *
 *   - `INTEGRATION_RECONNECT_REQUIRED` on `notification_type` — in-app bell
 *     notification when an OAuth connection expires permanently.
 *
 * Both use `IF NOT EXISTS` so repeated calls are idempotent.
 */
export async function ensureOauthReconnectAlertEnumValues(): Promise<void> {
  try {
    await db.execute(
      sql.raw(
        `ALTER TYPE integration_connection_status ADD VALUE IF NOT EXISTS 'needs_reconnect'`,
      ),
    );
    await db.execute(
      sql.raw(
        `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'INTEGRATION_RECONNECT_REQUIRED'`,
      ),
    );
    logInfo(
      "[migration] integration_connection_status + notification_type — oauth reconnect enum values ready",
    );
  } catch (err) {
    logError(err, { helper: "ensureOauthReconnectAlertEnumValues" });
    throw err;
  }
}
