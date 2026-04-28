import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2190 — Persist the WebAuthn RP ID a passkey was registered under.
 *
 * Idempotent startup migration that adds the `rp_id` column to
 * `passkey_credentials` on databases that haven't yet run
 * `migrations/0073_passkey_credentials_rp_id.sql`. Mirrors the SQL exactly
 * so dev containers and long-lived environments stay in sync without
 * an explicit `drizzle-kit push`.
 *
 * The column is intentionally nullable: pre-existing rows predate
 * per-credential rpID tracking. They are surfaced in the user's settings
 * list as "unknown domain" and are explicitly refused at authentication
 * time, forcing a re-register on the current domain.
 */
export async function ensurePasskeyRpIdColumn(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'passkey_credentials' AND column_name = 'rp_id'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    await db.execute(sql`
      ALTER TABLE passkey_credentials
      ADD COLUMN IF NOT EXISTS rp_id text
    `);

    console.log(colAlreadyExists
      ? "[migration] passkey_credentials.rp_id — already present, skipped"
      : "[migration] passkey_credentials.rp_id — applied");
  } catch (err) {
    logError(
      "[migration] Failed to ensure passkey_credentials.rp_id:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
