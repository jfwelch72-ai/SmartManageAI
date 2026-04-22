import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #890 — CRM call logging tables, recordings, and permission column.
 * Idempotent; safe on every cold start.
 */
export async function ensureCrmCallTables(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "crm_call_direction" AS ENUM ('INBOUND', 'OUTBOUND');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "crm_call_outcome" AS ENUM ('CONNECTED','VOICEMAIL','NO_ANSWER','BUSY','FAILED','WRONG_NUMBER','MEETING_SCHEDULED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "crm_call_status" AS ENUM ('LOGGED','QUEUED','RINGING','IN_PROGRESS','COMPLETED','FAILED','CANCELED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_calls" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "crm_organisation_id" varchar REFERENCES "crm_organisations"("id") ON DELETE SET NULL,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "direction" "crm_call_direction" NOT NULL DEFAULT 'OUTBOUND',
      "outcome" "crm_call_outcome",
      "status" "crm_call_status" NOT NULL DEFAULT 'LOGGED',
      "from_number" text,
      "to_number" text,
      "duration_seconds" integer NOT NULL DEFAULT 0,
      "started_at" timestamp NOT NULL DEFAULT now(),
      "ended_at" timestamp,
      "notes" text,
      "twilio_call_sid" text,
      "twilio_recording_sid" text,
      "source" text NOT NULL DEFAULT 'MANUAL',
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_calls_org_idx" ON "crm_calls"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_calls_opp_idx" ON "crm_calls"("opportunity_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_calls_contact_idx" ON "crm_calls"("contact_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_calls_started_at_idx" ON "crm_calls"("started_at")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_calls_twilio_sid_idx" ON "crm_calls"("twilio_call_sid")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_call_recordings" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "call_id" varchar NOT NULL REFERENCES "crm_calls"("id") ON DELETE CASCADE,
      "recording_url" text NOT NULL,
      "duration_seconds" integer NOT NULL DEFAULT 0,
      "twilio_recording_sid" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_call_recordings_call_idx" ON "crm_call_recordings"("call_id")`);

  // Task #921 — transcripts on call recordings.
  await db.execute(sql`ALTER TABLE "crm_call_recordings" ADD COLUMN IF NOT EXISTS "transcript" text`);
  await db.execute(sql`ALTER TABLE "crm_call_recordings" ADD COLUMN IF NOT EXISTS "transcript_status" text NOT NULL DEFAULT 'PENDING'`);
  await db.execute(sql`ALTER TABLE "crm_call_recordings" ADD COLUMN IF NOT EXISTS "transcript_provider" text`);
  await db.execute(sql`ALTER TABLE "crm_call_recordings" ADD COLUMN IF NOT EXISTS "transcript_error" text`);
  await db.execute(sql`ALTER TABLE "crm_call_recordings" ADD COLUMN IF NOT EXISTS "transcribed_at" timestamp`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_call_recordings_transcript_search_idx"
    ON "crm_call_recordings" USING gin (to_tsvector('english', coalesce("transcript", '')))`);

  await db.execute(sql`ALTER TABLE "user_dashboard_permissions" ADD COLUMN IF NOT EXISTS "can_log_crm_calls" boolean DEFAULT false`);

  console.log("[migration] crm_call_tables — ensured");
}
