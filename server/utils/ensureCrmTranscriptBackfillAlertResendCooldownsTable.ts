import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1092 — fleet-wide dedupe ledger for transcript-backfill alert resends.
 * Mirrors the Drizzle definition in
 * `shared/schema/operations.ts :: crmTranscriptBackfillAlertResendCooldowns`.
 *
 * The schema-drift reconciler can add missing columns/enums but never whole
 * tables, so without this ensure-helper the table only existed in DBs where
 * someone had run `npx drizzle-kit push` by hand. Every other fresh checkout
 * 500s the moment the transcript-backfill notification service tries to
 * reserve a cooldown row.
 *
 * Idempotent; safe on every cold start.
 */
export async function ensureCrmTranscriptBackfillAlertResendCooldownsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_transcript_backfill_alert_resend_cooldowns" (
      "org_id" varchar NOT NULL,
      "job_id" varchar NOT NULL,
      "channel" text NOT NULL,
      "last_resend_at" timestamp NOT NULL DEFAULT now(),
      CONSTRAINT "crm_transcript_backfill_alert_resend_cooldowns_pk"
        UNIQUE ("org_id", "job_id", "channel")
    )
  `);
  logInfo("[migration] crm_transcript_backfill_alert_resend_cooldowns table ready");
}
