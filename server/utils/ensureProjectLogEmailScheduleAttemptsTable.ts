import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1652 — append-only per-schedule send history. Mirrors
 * `migrations/0061_project_log_email_schedule_attempts.sql` so freshly
 * pulled dev DBs auto-apply without `npx drizzle-kit migrate`.
 *
 * The schedule row only carries the most recent attempt; this table
 * lets admins see trend data ("failed 5 times this week, then
 * succeeded once after I edited the list") and gives support a paper
 * trail of who triggered each manual send.
 */
export async function ensureProjectLogEmailScheduleAttemptsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS project_log_email_schedule_attempts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        schedule_id varchar NOT NULL REFERENCES project_log_email_schedules(id) ON DELETE CASCADE,
        organization_id varchar NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        project_id varchar NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        log_type text NOT NULL,
        status text NOT NULL,
        error text,
        recipient_count integer NOT NULL DEFAULT 0,
        trigger_type text NOT NULL,
        triggered_by_id varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS project_log_email_schedule_attempts_schedule_idx
        ON project_log_email_schedule_attempts (schedule_id, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS project_log_email_schedule_attempts_org_idx
        ON project_log_email_schedule_attempts (organization_id)
    `);
    console.log(
      "[migration] project_log_email_schedule_attempts table ready",
    );
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailScheduleAttemptsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
