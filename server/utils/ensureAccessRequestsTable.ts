import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2143 — Self-serve "Request access" flow.
 *
 * Idempotent startup migration that creates the `access_requests` table
 * (and its supporting enum + indexes) on databases that haven't yet run
 * `migrations/0072_access_requests.sql`. Mirrors the SQL exactly so dev
 * containers and long-lived environments stay in sync without an explicit
 * drizzle-kit push.
 */
export async function ensureAccessRequestsTable(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_request_status') THEN
          CREATE TYPE access_request_status AS ENUM ('PENDING', 'APPROVED', 'DENIED');
        END IF;
      END $$;
    `));

    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'access_requests'
      )::boolean AS table_exists
    `);
    const tableAlreadyExists = tableCheck.rows[0]?.table_exists === true;

    if (!tableAlreadyExists) {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS access_requests (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          requester_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          requested_role user_role,
          requested_permissions text[],
          feature_context text,
          reason text NOT NULL,
          status access_request_status NOT NULL DEFAULT 'PENDING',
          decided_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
          decided_at timestamp,
          decision_note text,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `));
      await db.execute(sql.raw(
        `CREATE INDEX IF NOT EXISTS access_requests_org_status_idx
           ON access_requests (organization_id, status)`,
      ));
      await db.execute(sql.raw(
        `CREATE INDEX IF NOT EXISTS access_requests_requester_idx
           ON access_requests (requester_user_id)`,
      ));
      logInfo(`[migration] access_requests table — created`);
    } else {
      logInfo(`[migration] access_requests table — already exists, skipped`);
    }
  } catch (err) {
    logError(
      `[migration] Failed to ensure access_requests table:`,
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
