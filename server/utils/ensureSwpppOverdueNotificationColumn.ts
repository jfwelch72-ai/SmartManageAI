import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1173: SWPPP corrective action overdue notifications need a
 * per-inspection dedupe marker so the nightly sweep only fans out one
 * notification per overdue cycle. Adds `last_overdue_notified_at`
 * idempotently so existing deployments pick it up on boot without a
 * manual migration step.
 */
export async function ensureSwpppOverdueNotificationColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE swppp_inspections
        ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamp
    `);
    logInfo("[migration] swppp_inspections.last_overdue_notified_at ready");
  } catch (err) {
    logError(
      "[migration] ensureSwpppOverdueNotificationColumn failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
