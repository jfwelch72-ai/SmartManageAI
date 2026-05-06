import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1720 — Per-user CRM owner-filter selections, promoted from
 * per-user-id `localStorage` keys (`crm:contactOwnerFilter:<uid>` and
 * `crm:orgOwnerFilter:<uid>`) to server-side columns so the
 * estimator's "Show only my orgs / contacts" toggle syncs across
 * every device the user signs in on (mirroring the Task #1695 pattern
 * for `users.plansToolbarLabeled` / `users.plansTourCompleted`).
 *
 *   - `crm_contact_owner_filter` — text, NULL by default. Stores the
 *     last-applied owner filter on the CRM › Contacts tab. Allowed
 *     values are the same sentinels and user ids the in-page state
 *     accepts ("all", "me", "__unassigned__", or a `users.id`).
 *   - `crm_org_owner_filter`     — text, NULL by default. Same shape
 *     for the Organisations tab.
 *
 * Both columns are nullable so existing rows don't need a backfill —
 * the client treats NULL as "no preference saved yet" and falls back
 * to "all" on first render. The schema-drift reconciler (Task #1075)
 * would also auto-add these columns in dev, but the explicit ensure
 * keeps the startup migration manifest authoritative and matches the
 * pattern used by every other `users.*` preference column.
 *
 * Idempotent: safe to run on every startup.
 */
export async function ensureUsersCrmOwnerFilterColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS crm_contact_owner_filter TEXT,
        ADD COLUMN IF NOT EXISTS crm_org_owner_filter TEXT
    `);
    logInfo("[migration] users crm_contact_owner_filter / crm_org_owner_filter columns ready");
  } catch (err) {
    logError(
      "[migration] ensureUsersCrmOwnerFilterColumns failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
