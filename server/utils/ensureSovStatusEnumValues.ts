import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1144 — mirrors `migrations/0006_add_aia_billing_tables.sql` which
 * adds two values to the long-lived `sov_status` enum. `reconcileSchemaDrift`
 * (Task #1075) auto-creates *missing enum types* but cannot add new values
 * to a type that already exists, so a long-lived dev DB created before the
 * AIA migration would otherwise be missing these values and any query that
 * filters by `UNDER_REVIEW` / `REJECTED` would 500.
 */
const REQUIRED_SOV_STATUS_VALUES = ["UNDER_REVIEW", "REJECTED"];

export async function ensureSovStatusEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::sov_status))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    let added = 0;
    for (const val of REQUIRED_SOV_STATUS_VALUES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE sov_status ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      console.log(`[migration] sov_status enum — added ${added} missing value(s)`);
    }
  } catch (err) {
    // The enum may not exist yet on a brand-new DB; reconcileSchemaDrift will
    // create it later from the Drizzle schema (which already includes both
    // values), so swallow the error rather than blocking startup.
    logError(
      "[migration] Failed to ensure sov_status enum values:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
