import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2482 — billing & subscription productization adds:
 *   - subscription_status += 'suspended'  (post grace-period auto-suspend)
 *   - usage_key            += 'ai_tokens', 'ai_jobs', 'storage_bytes'
 *
 * `reconcileSchemaDrift` does NOT add new VALUES to existing enum types
 * (only enum CREATE / column ADD). This helper closes that gap with
 * idempotent `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements.
 */
const NEW_SUBSCRIPTION_STATUS_VALUES = ["suspended"] as const;
const NEW_USAGE_KEY_VALUES = ["ai_tokens", "ai_jobs", "storage_bytes"] as const;

export async function ensureBillingEnumValues(): Promise<void> {
  try {
    for (const v of NEW_SUBSCRIPTION_STATUS_VALUES) {
      await db.execute(sql.raw(`ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS '${v}'`));
    }
    for (const v of NEW_USAGE_KEY_VALUES) {
      await db.execute(sql.raw(`ALTER TYPE usage_key ADD VALUE IF NOT EXISTS '${v}'`));
    }
  } catch (err) {
    logError(
      "[migration] Failed to ensure billing enum values:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
