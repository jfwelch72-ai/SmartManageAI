import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1087 — create the 14 CRM/reporting tables that the schema-drift
 * detector reported as missing on a freshly-pulled checkout. These tables
 * exist in the Drizzle schema (`shared/schema/{crm-upgrade,features,operations}.ts`)
 * but the static migration runner never auto-applied them, and `drizzle-kit
 * push` is interactive (it can prompt for ambiguous renames), so dev users
 * had to run it by hand.
 *
 * Mirrors the Drizzle definitions exactly. All statements are
 * IF NOT EXISTS / DO $$ ... duplicate_object guards, so safe on every cold
 * start regardless of which subset is already present.
 *
 * Tables created here (14 total). Note: the task description listed
 * `crm_transcript_backfill_test_alerts` as one of the 14, but that table
 * is already created by `ensureCrmTranscriptBackfillTestAlertsTable`
 * (Task #1062). The actual 14th table missing on a fresh DB at the time
 * this migration was authored was `alert_fallback_sent` (Task #1067), so
 * we cover that here instead.
 *
 *   CRM (from `crm-upgrade.ts`):
 *     - crm_lead_forms, crm_lead_form_submissions
 *     - crm_meeting_links, crm_meeting_bookings
 *     - crm_stage_slas
 *     - crm_automations, crm_automation_runs
 *     - crm_custom_reports
 *   Reporting / integrations (from `features.ts`):
 *     - integration_api_keys, integration_api_request_log
 *     - safety_observations
 *     - daily_reports
 *   Ops (from `operations.ts`):
 *     - job_metric_samples
 *     - alert_fallback_sent
 */
export async function ensureCrmAndReportingTables(): Promise<void> {
  // --- Enums required by the CRM tables below. The schema-drift reconciler
  // also creates these, but it runs AFTER the migrations list — so we have
  // to make sure they exist before we reference them in CREATE TABLE.
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_pipeline_stage" AS ENUM ('LEAD','QUALIFIED','ESTIMATING','BID_SUBMITTED','NEGOTIATION','WON','LOST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_lead_form_status" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_meeting_booking_status" AS ENUM ('SCHEDULED','CANCELED','COMPLETED','NO_SHOW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_automation_trigger" AS ENUM ('STAGE_CHANGE','IDLE_DAYS','SCORE_THRESHOLD','FORM_SUBMIT','FIELD_CHANGE','EMAIL_REPLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  // --- crm_lead_forms ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_lead_forms" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "slug" text NOT NULL,
      "status" "crm_lead_form_status" NOT NULL DEFAULT 'DRAFT',
      "fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "success_message" text NOT NULL DEFAULT 'Thanks! We''ll be in touch shortly.',
      "notify_user_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "create_opportunity" boolean NOT NULL DEFAULT true,
      "default_stage" "crm_pipeline_stage" NOT NULL DEFAULT 'LEAD',
      "default_source" text DEFAULT 'Web Form',
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_lead_forms_org_idx" ON "crm_lead_forms"("organization_id")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_lead_forms_slug_uniq" ON "crm_lead_forms"("slug")`);

  // --- crm_lead_form_submissions ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_lead_form_submissions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "form_id" varchar NOT NULL REFERENCES "crm_lead_forms"("id") ON DELETE CASCADE,
      "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "remote_ip" text,
      "user_agent" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_lead_form_subs_org_idx" ON "crm_lead_form_submissions"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_lead_form_subs_form_idx" ON "crm_lead_form_submissions"("form_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_lead_form_subs_created_idx" ON "crm_lead_form_submissions"("created_at")`);

  // --- crm_meeting_links ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_meeting_links" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "owner_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "slug" text NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "duration_minutes" integer NOT NULL DEFAULT 30,
      "buffer_minutes" integer NOT NULL DEFAULT 0,
      "availability" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "timezone" text NOT NULL DEFAULT 'America/New_York',
      "is_active" boolean NOT NULL DEFAULT true,
      "notify_on_booking" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_meeting_links_org_idx" ON "crm_meeting_links"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_meeting_links_owner_idx" ON "crm_meeting_links"("owner_user_id")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_meeting_links_slug_uniq" ON "crm_meeting_links"("slug")`);

  // --- crm_meeting_bookings ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_meeting_bookings" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "link_id" varchar NOT NULL REFERENCES "crm_meeting_links"("id") ON DELETE CASCADE,
      "owner_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "invitee_name" text NOT NULL,
      "invitee_email" text NOT NULL,
      "invitee_phone" text,
      "notes" text,
      "start_at" timestamp NOT NULL,
      "end_at" timestamp NOT NULL,
      "status" "crm_meeting_booking_status" NOT NULL DEFAULT 'SCHEDULED',
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_meeting_bookings_org_idx" ON "crm_meeting_bookings"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_meeting_bookings_owner_idx" ON "crm_meeting_bookings"("owner_user_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_meeting_bookings_start_idx" ON "crm_meeting_bookings"("start_at")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_meeting_bookings_owner_start_uniq" ON "crm_meeting_bookings"("owner_user_id","start_at")`);

  // --- crm_stage_slas ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_stage_slas" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "stage" "crm_pipeline_stage" NOT NULL,
      "max_days_in_stage" integer NOT NULL DEFAULT 7,
      "warn_at_days" integer NOT NULL DEFAULT 5,
      "notify_assignee" boolean NOT NULL DEFAULT true,
      "notify_manager" boolean NOT NULL DEFAULT false,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_stage_slas_org_stage_uniq" ON "crm_stage_slas"("organization_id","stage")`);

  // --- crm_automations ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_automations" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "is_active" boolean NOT NULL DEFAULT true,
      "trigger" "crm_automation_trigger" NOT NULL,
      "trigger_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_automations_org_idx" ON "crm_automations"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_automations_trigger_idx" ON "crm_automations"("trigger")`);

  // --- crm_automation_runs ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_automation_runs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "automation_id" varchar NOT NULL REFERENCES "crm_automations"("id") ON DELETE CASCADE,
      "entity_type" text NOT NULL,
      "entity_id" varchar NOT NULL,
      "status" text NOT NULL DEFAULT 'SUCCESS',
      "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "error_message" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_automation_runs_org_idx" ON "crm_automation_runs"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_automation_runs_automation_idx" ON "crm_automation_runs"("automation_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_automation_runs_entity_idx" ON "crm_automation_runs"("entity_type","entity_id")`);

  // --- crm_custom_reports ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_custom_reports" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "is_shared" boolean NOT NULL DEFAULT false,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_custom_reports_org_idx" ON "crm_custom_reports"("organization_id")`);

  // --- integration_api_keys ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "integration_api_keys" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "prefix" varchar(16) NOT NULL,
      "key_hash" text NOT NULL,
      "scopes" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "rate_limit_per_minute" integer NOT NULL DEFAULT 120,
      "is_active" boolean NOT NULL DEFAULT true,
      "last_used_at" timestamp,
      "expires_at" timestamp,
      "created_by_user_id" varchar REFERENCES "users"("id"),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "revoked_at" timestamp
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "integration_api_keys_org_idx" ON "integration_api_keys"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "integration_api_keys_prefix_idx" ON "integration_api_keys"("prefix")`);

  // --- integration_api_request_log ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "integration_api_request_log" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "api_key_id" varchar REFERENCES "integration_api_keys"("id") ON DELETE SET NULL,
      "method" varchar(10) NOT NULL,
      "path" text NOT NULL,
      "status_code" integer NOT NULL,
      "duration_ms" integer,
      "scope_used" text,
      "error_message" text,
      "ip" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "integration_api_log_org_idx" ON "integration_api_request_log"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "integration_api_log_key_idx" ON "integration_api_request_log"("api_key_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "integration_api_log_created_idx" ON "integration_api_request_log"("created_at")`);

  // --- safety_observations ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "safety_observations" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "project_id" varchar REFERENCES "projects"("id") ON DELETE SET NULL,
      "observation_type" text NOT NULL,
      "category" text NOT NULL,
      "severity" text NOT NULL DEFAULT 'LOW',
      "location" text,
      "description" text NOT NULL,
      "immediate_action" text,
      "photos" text[] DEFAULT ARRAY[]::text[],
      "observed_at" timestamp NOT NULL DEFAULT now(),
      "observed_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "observed_by_name" text,
      "involved_party_name" text,
      "involved_trade" text,
      "status" text NOT NULL DEFAULT 'OPEN',
      "corrective_action_id" varchar,
      "closed_at" timestamp,
      "closed_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "safety_observations_org_idx" ON "safety_observations"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "safety_observations_project_idx" ON "safety_observations"("project_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "safety_observations_observed_at_idx" ON "safety_observations"("observed_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "safety_observations_type_idx" ON "safety_observations"("observation_type")`);

  // --- daily_reports ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "daily_reports" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "project_id" varchar REFERENCES "projects"("id") ON DELETE SET NULL,
      "report_date" date NOT NULL,
      "notes" text,
      "weather" text,
      "attachments_json" json DEFAULT '[]'::json,
      "submitted_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "submitted_by_device_id" varchar,
      "submitted_local_id" varchar,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "daily_reports_org_idx" ON "daily_reports"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "daily_reports_project_idx" ON "daily_reports"("project_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "daily_reports_date_idx" ON "daily_reports"("report_date")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "daily_reports_org_local_id_uniq" ON "daily_reports"("organization_id","submitted_local_id")`);

  // --- job_metric_samples ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "job_metric_samples" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "job" text NOT NULL,
      "recorded_at" timestamp NOT NULL DEFAULT now(),
      "counters" jsonb NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "job_metric_samples_job_recorded_at_idx" ON "job_metric_samples"("job","recorded_at")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "job_metric_samples_recorded_at_idx" ON "job_metric_samples"("recorded_at")`);

  // --- alert_fallback_sent (Task #1067 dedupe ledger) ---
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "alert_fallback_sent" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "org_id" varchar NOT NULL,
      "channel" text NOT NULL,
      "recipient_summary" text NOT NULL DEFAULT '',
      "error_hash" varchar(64) NOT NULL,
      "sent_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "alert_fallback_sent_lookup_idx" ON "alert_fallback_sent"("org_id","channel","error_hash","sent_at")`);

  logInfo("[migration] crm_and_reporting_tables — ensured 14 tables (CRM forms/meetings/SLAs/automations/reports + integration api + safety + daily reports + job metrics + alert fallback)");
}
