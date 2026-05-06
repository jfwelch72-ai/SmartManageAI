import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureGanttPdfAlertTables(): Promise<void> {
  try {
    const check = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gantt_pdf_alert_recipients')::boolean AS recipients_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gantt_pdf_alert_deliveries')::boolean AS deliveries_exists
    `);
    const row = check.rows[0] as { recipients_exists: boolean; deliveries_exists: boolean };

    if (row.recipients_exists && row.deliveries_exists) {
      logInfo("[migration] gantt_pdf_alert_* tables — already present, skipped");
      return;
    }

    if (!row.recipients_exists) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "gantt_pdf_alert_recipients" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "email" text NOT NULL UNIQUE,
          "notify_in_app" boolean NOT NULL DEFAULT true,
          "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
    }

    if (!row.deliveries_exists) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "gantt_pdf_alert_deliveries" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "kind" text NOT NULL,
          "recipients" text[] NOT NULL,
          "recipient_count" integer NOT NULL,
          "email_success" boolean NOT NULL,
          "error_message" text,
          "triggered_by" text,
          "created_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "gantt_pdf_alert_deliveries_created_at_idx" ON "gantt_pdf_alert_deliveries" ("created_at")`);
    }

    logInfo("[migration] gantt_pdf_alert_* tables — applied");
  } catch (err) {
    logError("[migration] Failed to ensure gantt_pdf_alert tables:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
