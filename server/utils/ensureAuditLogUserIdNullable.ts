import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

/**
 * Task #2962 — SLA & routing intelligence.
 *
 * Makes `audit_log.user_id` nullable so that system-initiated audit rows
 * (ESCALATE, AUTO_ASSIGN) can be written without a foreign-key violation.
 * Previously the column was NOT NULL, which caused any `userId: null` insert
 * to fail silently (the error was swallowed by the catch in `logAudit`).
 *
 * The migration is idempotent: it only drops the NOT NULL constraint if the
 * column is currently non-nullable.
 */
export async function ensureAuditLogUserIdNullable(): Promise<void> {
  try {
    // Check if column is currently NOT NULL
    const result = await db.execute(sql`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'audit_log'
        AND column_name = 'user_id'
    `);

    const isNullable = result.rows[0]?.is_nullable === "YES";
    if (isNullable) {
      logInfo("[migration] audit_log.user_id — already nullable, skipped");
      return;
    }

    // Drop NOT NULL constraint. The FK itself remains; only NULL values are
    // permitted now (NULL = system-initiated row).
    await db.execute(sql`
      ALTER TABLE audit_log ALTER COLUMN user_id DROP NOT NULL
    `);

    logInfo("[migration] audit_log.user_id — NOT NULL constraint dropped (system audit rows now allowed)");
  } catch (err) {
    logError(err, { helper: "ensureAuditLogUserIdNullable" });
    throw err;
  }
}
