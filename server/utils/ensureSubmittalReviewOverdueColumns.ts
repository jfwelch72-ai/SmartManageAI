import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1599: per-review bookkeeping for the nightly submittal-review
 * overdue escalation sweep + an external-reviewer email field for the
 * EXTERNAL_DOC_EMAIL branch. Adds three columns idempotently:
 *   - last_overdue_notified_at  (timestamp, nullable)
 *   - overdue_reminder_count    (integer NOT NULL DEFAULT 0)
 *   - reviewer_email            (text, nullable)
 */
export async function ensureSubmittalReviewOverdueColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE submittal_reviews
        ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamp
    `);
    await db.execute(sql`
      ALTER TABLE submittal_reviews
        ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE submittal_reviews
        ADD COLUMN IF NOT EXISTS reviewer_email text
    `);
    logInfo("[migration] submittal_reviews overdue + reviewer email columns ready");
  } catch (err) {
    logError(
      "[migration] ensureSubmittalReviewOverdueColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
