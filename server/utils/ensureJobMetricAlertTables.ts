import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureJobMetricAlertTables(): Promise<void> {
  const rulesExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'job_metric_alert_rules'
    ) AS exists
  `);
  if (!(rulesExists.rows[0] as { exists: boolean }).exists) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "job_metric_alert_rules" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "job" text NOT NULL,
        "counter" text,
        "kind" text NOT NULL,
        "threshold" numeric(12,4) NOT NULL,
        "min_absolute" integer NOT NULL DEFAULT 0,
        "dedupe_minutes" integer NOT NULL DEFAULT 60,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "job_metric_alert_rules_job_kind_idx"
      ON "job_metric_alert_rules" ("job", "kind")
    `);
    logInfo("[migration] job_metric_alert_rules — table created");
  }

  const emailColumnExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'job_metric_alert_rules'
        AND column_name = 'email_when_above'
    ) AS exists
  `);
  if (!(emailColumnExists.rows[0] as { exists: boolean }).exists) {
    await db.execute(sql`
      ALTER TABLE "job_metric_alert_rules"
      ADD COLUMN "email_when_above" numeric(12,4)
    `);
    logInfo("[migration] job_metric_alert_rules.email_when_above — column added");
  }

  const eventsExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'job_metric_alert_events'
    ) AS exists
  `);
  if (!(eventsExists.rows[0] as { exists: boolean }).exists) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "job_metric_alert_events" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "job" text NOT NULL,
        "counter" text,
        "kind" text NOT NULL,
        "rule_id" varchar,
        "message" text NOT NULL,
        "observed_value" numeric(18,4),
        "baseline_value" numeric(18,4),
        "triggered_at" timestamp NOT NULL DEFAULT now(),
        "notified_user_count" integer NOT NULL DEFAULT 0
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "job_metric_alert_events_job_triggered_idx"
      ON "job_metric_alert_events" ("job", "triggered_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "job_metric_alert_events_triggered_idx"
      ON "job_metric_alert_events" ("triggered_at")
    `);
    logInfo("[migration] job_metric_alert_events — table created");
  }

  // Task #739 — track email escalation outcome per event so the
  // dashboard can badge alerts that paged Super Admins by email.
  const eventEmailedExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'job_metric_alert_events'
        AND column_name = 'emailed'
    ) AS exists
  `);
  if (!(eventEmailedExists.rows[0] as { exists: boolean }).exists) {
    await db.execute(sql`
      ALTER TABLE "job_metric_alert_events"
      ADD COLUMN "emailed" boolean NOT NULL DEFAULT false
    `);
    logInfo("[migration] job_metric_alert_events.emailed — column added");
  }
  const eventEmailedCountExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'job_metric_alert_events'
        AND column_name = 'emailed_recipient_count'
    ) AS exists
  `);
  if (!(eventEmailedCountExists.rows[0] as { exists: boolean }).exists) {
    await db.execute(sql`
      ALTER TABLE "job_metric_alert_events"
      ADD COLUMN "emailed_recipient_count" integer NOT NULL DEFAULT 0
    `);
    logInfo("[migration] job_metric_alert_events.emailed_recipient_count — column added");
  }

  // Task #760 — ledger of quiet-hours digest emails so the dashboard can
  // show recent sends per Super Admin and link back to the underlying
  // alert events covered by each digest window.
  const digestSendsExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'job_metric_alert_quiet_hours_digest_sends'
    ) AS exists
  `);
  if (!(digestSendsExists.rows[0] as { exists: boolean }).exists) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "job_metric_alert_quiet_hours_digest_sends" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "recipient_email" text NOT NULL,
        "sent_at" timestamp NOT NULL DEFAULT now(),
        "alert_count" integer NOT NULL DEFAULT 0,
        "window_start" timestamp,
        "window_end" timestamp,
        "subject" text NOT NULL,
        "is_test" boolean NOT NULL DEFAULT false
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "job_metric_alert_quiet_hours_digest_sends_user_sent_idx"
      ON "job_metric_alert_quiet_hours_digest_sends" ("user_id", "sent_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "job_metric_alert_quiet_hours_digest_sends_sent_idx"
      ON "job_metric_alert_quiet_hours_digest_sends" ("sent_at")
    `);
    logInfo("[migration] job_metric_alert_quiet_hours_digest_sends — table created");
  }
}
