import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1286: Per-organization escalation policy for the nightly SWPPP
 * overdue corrective-action sweep. Adds two columns idempotently so
 * existing deployments pick them up on boot without a manual migration:
 *   - swppp_overdue_reminder_max_count   (default 5)
 *   - swppp_overdue_reminder_interval_hours (default 22)
 *
 * Defaults mirror the previous hard-coded constants
 * (SWPPP_OVERDUE_REMINDER_CAP / SWPPP_OVERDUE_REMINDER_INTERVAL_MS) so
 * upgrading is a no-op until an admin explicitly tunes them.
 */
export async function ensureSwpppOverdueReminderSettings(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS swppp_overdue_reminder_max_count integer NOT NULL DEFAULT 5
    `);
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS swppp_overdue_reminder_interval_hours integer NOT NULL DEFAULT 22
    `);
    logInfo("[migration] organizations.swppp_overdue_reminder_* columns ready");
  } catch (err) {
    logError(
      "[migration] ensureSwpppOverdueReminderSettings failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
