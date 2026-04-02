import { db } from "../db";
import { sql } from "drizzle-orm";

const REQUIRED_NOTIFICATION_TYPES = [
  "BID_SUBMITTED",
  "BID_STATUS_CHANGED",
  "BID_ASSIGNED",
  "BID_DUE_DATE_APPROACHING",
];

export async function ensureNotificationEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::notification_type))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    let added = 0;
    for (const val of REQUIRED_NOTIFICATION_TYPES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      console.log(`[migration] notification_type enum — added ${added} missing value(s)`);
    } else {
      console.log("[migration] notification_type enum — all values present, skipped");
    }
  } catch (err) {
    console.error("[migration] Failed to ensure notification_type enum values:", err);
  }
}
