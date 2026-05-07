import { logInfo, logError } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2495 — adds the auth + role-change audit action values to the
 * long-lived `audit_action` enum on a running DB. `reconcileSchemaDrift`
 * (Task #1075) auto-creates *missing enum types* but cannot add new
 * values to a type that already exists, so deploy environments would
 * otherwise be missing these values and any insert that uses them
 * would fail at the DB layer. `logAudit` swallows that failure
 * (silent dropped audit), which is exactly what the SOC 2 trail
 * cannot afford. Run on startup, idempotent.
 */
// CUMULATIVE list of every non-foundational `audit_action` value that has
// been added to the Drizzle enum after the original schema landed. New
// additions MUST be appended here as well — never remove or replace, since
// long-lived deploy DBs may still be missing any prior addition. The
// foundational values (CREATE/UPDATE/DELETE/...) are not listed because
// they shipped with the very first migration and are guaranteed to exist
// on every environment.
const REQUIRED_AUDIT_ACTION_VALUES = [
  // Task #1180 — certified payroll archive history
  "ARCHIVE",
  "UNARCHIVE",
  // Task #1847 — explicit RESTORE for soft-delete restores
  "RESTORE",
  // Task #2096 — explicit RESET for destructive admin resets
  "RESET",
  // Task #2153 — bulk library mutations
  "BULK_DELETE",
  "BULK_DUPLICATE",
  // Task #2495 — auth + role-change events
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "PASSWORD_CHANGE",
  "PASSWORD_RESET",
  "PASSWORD_RESET_REQUESTED",
  "ROLE_CHANGED",
  "ROLE_GRANTED",
  "ROLE_REVOKED",
  "MFA_ENABLED",
  "MFA_DISABLED",
];

export async function ensureAuditActionEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::audit_action))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map((r) => r.val));

    let added = 0;
    for (const val of REQUIRED_AUDIT_ACTION_VALUES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      logInfo(`[migration] audit_action enum — added ${added} missing value(s)`);
    }
  } catch (err) {
    // The enum may not exist yet on a brand-new DB; reconcileSchemaDrift will
    // create it later from the Drizzle schema (which already includes all
    // the required values), so swallow the error rather than blocking startup.
    logError(
      "[migration] Failed to ensure audit_action enum values:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
