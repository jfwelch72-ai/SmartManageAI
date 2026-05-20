import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2962 — SLA & routing intelligence.
 *
 * Creates the `support_settings` (per-org timezone + escalation policy +
 * auto-assign config) and `support_holidays` (DB-backed holiday calendar)
 * tables idempotently via IF NOT EXISTS.
 */
export async function ensureSupportSettings(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "support_settings" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
      "support_timezone" text NOT NULL DEFAULT 'UTC',
      "escalation_emails" text[],
      "escalation_threshold_pct" integer NOT NULL DEFAULT 75,
      "auto_assign_grace_minutes" integer NOT NULL DEFAULT 60,
      "enterprise_agent_ids" varchar[],
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  logInfo("[migration] support_settings — table ready");
}

export async function ensureSupportHolidays(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "support_holidays" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "date" text NOT NULL,
      "name" text NOT NULL,
      "country" text NOT NULL DEFAULT 'US',
      CONSTRAINT "support_holidays_date_country_uniq" UNIQUE ("date", "country")
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_holidays_date_country_idx"
      ON "support_holidays" ("date", "country")
  `);
  logInfo("[migration] support_holidays — table ready");
}
