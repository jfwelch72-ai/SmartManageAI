import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #969 — persist transcript backfill job state so admins can still see
 * progress (or the last-known status) after a server restart. Idempotent;
 * safe to run on every cold start.
 */
export async function ensureCrmTranscriptBackfillJobsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_transcript_backfill_jobs" (
      "id" varchar PRIMARY KEY,
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "status" text NOT NULL DEFAULT 'RUNNING',
      "total" integer NOT NULL DEFAULT 0,
      "processed" integer NOT NULL DEFAULT 0,
      "succeeded" integer NOT NULL DEFAULT 0,
      "failed" integer NOT NULL DEFAULT 0,
      "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "started_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "started_at" timestamp NOT NULL DEFAULT now(),
      "completed_at" timestamp,
      "heartbeat_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_jobs_org_idx" ON "crm_transcript_backfill_jobs"("organization_id")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_jobs_status_idx" ON "crm_transcript_backfill_jobs"("status")`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "crm_transcript_backfill_jobs_started_at_idx" ON "crm_transcript_backfill_jobs"("started_at")`,
  );
  logInfo("[migration] crm_transcript_backfill_jobs table ready");
}
