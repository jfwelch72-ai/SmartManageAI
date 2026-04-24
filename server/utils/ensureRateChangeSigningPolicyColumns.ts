import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1485: ensure the columns backing the certified-payroll signing
 * gate exist on existing databases.
 *
 *   - organization_payroll_settings.rate_change_signing_policy (text NOT NULL DEFAULT 'WARN')
 *   - projects.rate_change_signing_policy (text NULL)
 *
 * Both are idempotent ADD COLUMN IF NOT EXISTS so re-runs are no-ops.
 * Defaults preserve the original behavior on the org-level column
 * (soft-confirm via the WARN policy) and leave the per-project column
 * NULL so projects fall back to the org default unless explicitly set.
 */
export async function ensureRateChangeSigningPolicyColumns(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE organization_payroll_settings
      ADD COLUMN IF NOT EXISTS rate_change_signing_policy text NOT NULL DEFAULT 'WARN'
    `);
    await db.execute(sql`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS rate_change_signing_policy text
    `);
    console.log("[migration] rate_change_signing_policy columns — applied");
  } catch (err) {
    logError(
      "[migration] Failed to ensure rate_change_signing_policy columns:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
