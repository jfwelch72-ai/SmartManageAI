import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureEmailCampaignTables(): Promise<void> {
  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'email_campaigns'
      )::boolean AS table_exists
    `);
    const alreadyExists = tableCheck.rows[0]?.table_exists === true;

    if (!alreadyExists) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "email_campaigns" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id"),
          "name" text NOT NULL,
          "subject" text NOT NULL,
          "html_content" text NOT NULL,
          "text_content" text,
          "from_name" text,
          "reply_to" text,
          "status" text NOT NULL DEFAULT 'DRAFT',
          "scheduled_at" timestamp,
          "sent_at" timestamp,
          "total_recipients" integer DEFAULT 0,
          "total_sent" integer DEFAULT 0,
          "total_opened" integer DEFAULT 0,
          "total_clicked" integer DEFAULT 0,
          "total_bounced" integer DEFAULT 0,
          "total_unsubscribed" integer DEFAULT 0,
          "tags" text[],
          "created_by_id" varchar REFERENCES "users"("id"),
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "email_campaigns_org_idx" ON "email_campaigns" ("organization_id")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "email_campaign_contacts" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "campaign_id" varchar NOT NULL REFERENCES "email_campaigns"("id") ON DELETE CASCADE,
          "email" text NOT NULL,
          "name" text,
          "status" text NOT NULL DEFAULT 'PENDING',
          "sent_at" timestamp,
          "opened_at" timestamp,
          "clicked_at" timestamp,
          "error_message" text
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "email_campaign_contacts_campaign_idx" ON "email_campaign_contacts" ("campaign_id")`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "email_campaign_templates" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id"),
          "name" text NOT NULL,
          "subject" text,
          "html_content" text NOT NULL,
          "category" text DEFAULT 'GENERAL',
          "is_default" boolean DEFAULT false,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "email_campaign_templates_org_idx" ON "email_campaign_templates" ("organization_id")`);

      logInfo("[migration] email campaign tables — applied");
    } else {
      logInfo("[migration] email campaign tables — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure email campaign tables:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
