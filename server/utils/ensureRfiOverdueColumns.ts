import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1599: per-RFI bookkeeping for the nightly overdue escalation
 * sweep + an external-assignee email field for the EXTERNAL_DOC_EMAIL
 * branch. Adds three columns idempotently so existing deployments pick
 * them up on boot:
 *   - last_overdue_notified_at  (timestamp, nullable)
 *   - overdue_reminder_count    (integer NOT NULL DEFAULT 0)
 *   - external_assignee_email   (text, nullable)
 *
 * Mirrors `ensureSwpppOverdueNotificationColumn` in shape.
 */
export async function ensureRfiOverdueColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE rfis
        ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamp
    `);
    await db.execute(sql`
      ALTER TABLE rfis
        ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE rfis
        ADD COLUMN IF NOT EXISTS external_assignee_email text
    `);
    console.log("[migration] rfis overdue + external assignee columns ready");
  } catch (err) {
    logError(
      "[migration] ensureRfiOverdueColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
