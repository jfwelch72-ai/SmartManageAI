import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1144 — mirrors `migrations/0016_calendar_cleanup.sql` which adds
 * `MEETING` and `PROJECT_DEADLINE` to the long-lived `calendar_event_type`
 * enum. `reconcileSchemaDrift` (Task #1075) auto-creates *missing enum
 * types* but cannot add new values to a type that already exists, so a
 * long-lived dev DB created before this migration would otherwise be missing
 * these values and any insert/select that uses them would 500.
 */
const REQUIRED_CALENDAR_EVENT_TYPE_VALUES = ["MEETING", "PROJECT_DEADLINE"];

export async function ensureCalendarEventTypeEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::calendar_event_type))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    let added = 0;
    for (const val of REQUIRED_CALENDAR_EVENT_TYPE_VALUES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE calendar_event_type ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      logInfo(`[migration] calendar_event_type enum — added ${added} missing value(s)`);
    }
  } catch (err) {
    logError(
      "[migration] Failed to ensure calendar_event_type enum values:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
