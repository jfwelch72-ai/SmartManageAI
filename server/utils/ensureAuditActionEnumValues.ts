import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1180 — adds the ARCHIVE / UNARCHIVE values to the long-lived
 * `audit_action` Postgres enum. The certified payroll archive /
 * unarchive admin endpoints in `server/payrollRoutes.ts` write audit
 * rows with these actions, but `reconcileSchemaDrift` (Task #1075)
 * auto-creates *missing enum types* and cannot add new values to a
 * type that already exists. Without this migration, long-lived dev /
 * production DBs would silently drop those audit rows because
 * `logAudit` swallows the enum-mismatch insert error.
 */
const REQUIRED_AUDIT_ACTION_VALUES = ["ARCHIVE", "UNARCHIVE"];

export async function ensureAuditActionEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::audit_action))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    let added = 0;
    for (const val of REQUIRED_AUDIT_ACTION_VALUES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      console.log(`[migration] audit_action enum — added ${added} missing value(s)`);
    }
  } catch (err) {
    // The enum may not exist yet on a brand-new DB; reconcileSchemaDrift will
    // create it later from the Drizzle schema (which already includes both
    // values), so swallow the error rather than blocking startup.
    logError(
      "[migration] Failed to ensure audit_action enum values:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
