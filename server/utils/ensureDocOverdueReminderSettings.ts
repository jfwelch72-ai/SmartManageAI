import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1599: per-organization escalation policy for the nightly RFI
 * and submittal-review overdue sweeps. Adds two columns idempotently
 * so existing deployments pick them up on boot without a manual
 * migration:
 *   - doc_overdue_reminder_max_count   (default 5)
 *   - doc_overdue_reminder_interval_hours (default 22)
 *
 * Defaults match DOC_OVERDUE_REMINDER_DEFAULT_CAP /
 * DOC_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS so upgrading is a no-op.
 */
export async function ensureDocOverdueReminderSettings(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS doc_overdue_reminder_max_count integer NOT NULL DEFAULT 5
    `);
    await db.execute(sql`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS doc_overdue_reminder_interval_hours integer NOT NULL DEFAULT 22
    `);
    logInfo("[migration] organizations.doc_overdue_reminder_* columns ready");
  } catch (err) {
    logError(
      "[migration] ensureDocOverdueReminderSettings failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
