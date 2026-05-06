import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1606 — project_log_email_schedules: per-project schedule for
 * emailing the RFI / submittal log PDFs to the project distribution
 * lists. Default cadence is 'OFF' so no behaviour change for existing
 * projects until someone opts in.
 */
export async function ensureProjectLogEmailSchedules(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "project_log_email_schedules" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "log_type" text NOT NULL,
        "cadence" text NOT NULL DEFAULT 'OFF',
        "weekday" integer NOT NULL DEFAULT 1,
        "hour" integer NOT NULL DEFAULT 8,
        "timezone" text NOT NULL DEFAULT 'UTC',
        "last_sent_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "project_log_email_schedules_org_idx"
        ON "project_log_email_schedules" ("organization_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "project_log_email_schedules_project_idx"
        ON "project_log_email_schedules" ("project_id")
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "project_log_email_schedules_project_logtype_uniq"
        ON "project_log_email_schedules" ("project_id", "log_type")
    `);

    logInfo("[migration] project_log_email_schedules table ready");
  } catch (err) {
    logError(
      "[migration] ensureProjectLogEmailSchedules failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
