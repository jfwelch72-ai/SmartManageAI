import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1747 — adds the `muted_until` column to `notification_type_prefs`
 * so per-type mutes can carry an auto-clear deadline (snooze).
 *
 * Semantics enforced by the read paths:
 *   - NULL          ⇒ indefinite mute (the historical behavior).
 *   - future ts     ⇒ active snooze; mute applies until the deadline.
 *   - past ts       ⇒ row treated as if it didn't exist; channel default
 *                     wins, both for the in-app feed and outbound
 *                     delivery (email/SMS/push/Teams/Slack).
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensureNotificationTypePrefsMutedUntil(): Promise<void> {
  try {
    await db.execute(sql.raw(
      `ALTER TABLE notification_type_prefs
         ADD COLUMN IF NOT EXISTS muted_until timestamp`,
    ));
    logInfo("[migration] notification_type_prefs.muted_until ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure notification_type_prefs.muted_until:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
