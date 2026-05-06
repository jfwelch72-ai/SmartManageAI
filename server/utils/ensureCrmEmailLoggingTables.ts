import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #886 — CRM email logging tables + permission column.
 * Idempotent; safe on every cold start.
 */
export async function ensureCrmEmailLoggingTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_email_logging_settings" (
      "organization_id" varchar PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
      "mode" text NOT NULL DEFAULT 'OFF',
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_email_logging_suppressions" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "pattern" text NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_supp_org_idx" ON "crm_email_logging_suppressions"("organization_id")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_supp_org_pattern_uidx" ON "crm_email_logging_suppressions"("organization_id","pattern")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_email_threads" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "organisation_id" varchar REFERENCES "crm_organisations"("id") ON DELETE SET NULL,
      "subject" text NOT NULL,
      "external_thread_id" text,
      "provider" text NOT NULL,
      "message_count" integer NOT NULL DEFAULT 0,
      "last_message_at" timestamp NOT NULL DEFAULT now(),
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_threads_org_idx" ON "crm_email_threads"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_threads_contact_idx" ON "crm_email_threads"("contact_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_threads_opp_idx" ON "crm_email_threads"("opportunity_id")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_threads_org_ext_uidx" ON "crm_email_threads"("organization_id","external_thread_id")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_email_messages" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "thread_id" varchar NOT NULL REFERENCES "crm_email_threads"("id") ON DELETE CASCADE,
      "contact_id" varchar REFERENCES "crm_contacts"("id") ON DELETE SET NULL,
      "opportunity_id" varchar REFERENCES "crm_opportunities"("id") ON DELETE SET NULL,
      "external_message_id" text NOT NULL,
      "direction" text NOT NULL,
      "from_address" text NOT NULL,
      "to_addresses" text,
      "cc_addresses" text,
      "subject" text NOT NULL,
      "snippet" text,
      "body_text" text,
      "sent_at" timestamp NOT NULL,
      "source_email_message_id" varchar REFERENCES "email_messages"("id") ON DELETE SET NULL,
      "activity_id" varchar REFERENCES "crm_opportunity_activities"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_messages_org_idx" ON "crm_email_messages"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_messages_thread_idx" ON "crm_email_messages"("thread_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_messages_contact_idx" ON "crm_email_messages"("contact_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_messages_opp_idx" ON "crm_email_messages"("opportunity_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_email_messages_sent_at_idx" ON "crm_email_messages"("sent_at")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_messages_org_ext_dir_uidx" ON "crm_email_messages"("organization_id","external_message_id","direction")`);

  await db.execute(sql`ALTER TABLE "crm_email_messages" ADD COLUMN IF NOT EXISTS "provider_deep_link" text`);
  await db.execute(sql`ALTER TABLE "crm_email_messages" ADD COLUMN IF NOT EXISTS "provider" text`);

  // Permission column on user_dashboard_permissions
  await db.execute(sql`ALTER TABLE "user_dashboard_permissions" ADD COLUMN IF NOT EXISTS "can_view_crm_emails" boolean DEFAULT false`);

  logInfo("[migration] crm_email_logging_tables — ensured");
}
