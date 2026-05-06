import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #990: consolidate Gantt + Portfolio PDF alert recipients/deliveries
 * into a single shared table with per-service opt-in flags.
 *
 * Idempotent — safe to run repeatedly. Backfills from the legacy
 * gantt_pdf_alert_* and portfolio_pdf_alert_* tables when they exist.
 */
export async function ensurePdfAlertSharedTables(): Promise<void> {
  try {
    const check = await db.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pdf_alert_recipients')::boolean AS recipients_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pdf_alert_deliveries')::boolean AS deliveries_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gantt_pdf_alert_recipients')::boolean AS gantt_recipients_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_pdf_alert_recipients')::boolean AS portfolio_recipients_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gantt_pdf_alert_deliveries')::boolean AS gantt_deliveries_exists,
        EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_pdf_alert_deliveries')::boolean AS portfolio_deliveries_exists
    `);
    const row = check.rows[0] as {
      recipients_exists: boolean;
      deliveries_exists: boolean;
      gantt_recipients_exists: boolean;
      portfolio_recipients_exists: boolean;
      gantt_deliveries_exists: boolean;
      portfolio_deliveries_exists: boolean;
    };

    let createdAny = false;

    if (!row.recipients_exists) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "pdf_alert_recipients" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "email" text NOT NULL UNIQUE,
          "notify_in_app" boolean NOT NULL DEFAULT true,
          "notify_gantt" boolean NOT NULL DEFAULT true,
          "notify_portfolio" boolean NOT NULL DEFAULT true,
          "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      createdAny = true;
    }

    if (!row.deliveries_exists) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "pdf_alert_deliveries" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "service" text NOT NULL,
          "kind" text NOT NULL,
          "recipients" text[] NOT NULL,
          "recipient_count" integer NOT NULL,
          "email_success" boolean NOT NULL,
          "error_message" text,
          "triggered_by" text,
          "created_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "pdf_alert_deliveries_service_created_at_idx"
        ON "pdf_alert_deliveries" ("service", "created_at")
      `);
      createdAny = true;
    }

    // ---- Backfill recipients from legacy per-service tables ----
    // Add the recipient if missing; otherwise OR-in the per-service opt-in
    // flag so a row that exists in both legacy tables ends up opted-in for
    // both services. We seed the OTHER service's flag to false so backfilled
    // rows preserve historical "only opted-in for the table they came from"
    // semantics — admins can flip the other flag on later if desired.
    if (row.gantt_recipients_exists) {
      await db.execute(sql`
        INSERT INTO "pdf_alert_recipients"
          ("id", "email", "notify_in_app", "notify_gantt", "notify_portfolio", "user_id", "created_at", "updated_at")
        SELECT
          "id", lower("email"), "notify_in_app", true, false, "user_id", "created_at", "updated_at"
        FROM "gantt_pdf_alert_recipients"
        ON CONFLICT ("email") DO UPDATE SET
          "notify_gantt" = true,
          "notify_in_app" = "pdf_alert_recipients"."notify_in_app" OR EXCLUDED."notify_in_app",
          "user_id" = COALESCE("pdf_alert_recipients"."user_id", EXCLUDED."user_id"),
          "updated_at" = now()
      `);
    }
    if (row.portfolio_recipients_exists) {
      await db.execute(sql`
        INSERT INTO "pdf_alert_recipients"
          ("id", "email", "notify_in_app", "notify_gantt", "notify_portfolio", "user_id", "created_at", "updated_at")
        SELECT
          "id", lower("email"), "notify_in_app", false, true, "user_id", "created_at", "updated_at"
        FROM "portfolio_pdf_alert_recipients"
        ON CONFLICT ("email") DO UPDATE SET
          "notify_portfolio" = true,
          "notify_in_app" = "pdf_alert_recipients"."notify_in_app" OR EXCLUDED."notify_in_app",
          "user_id" = COALESCE("pdf_alert_recipients"."user_id", EXCLUDED."user_id"),
          "updated_at" = now()
      `);
    }

    // ---- Backfill deliveries from legacy per-service tables ----
    // Old rows have a unique varchar id which we copy verbatim so re-running
    // is idempotent via ON CONFLICT.
    if (row.gantt_deliveries_exists) {
      await db.execute(sql`
        INSERT INTO "pdf_alert_deliveries"
          ("id", "service", "kind", "recipients", "recipient_count", "email_success", "error_message", "triggered_by", "created_at")
        SELECT
          "id", 'gantt', "kind", "recipients", "recipient_count", "email_success", "error_message", "triggered_by", "created_at"
        FROM "gantt_pdf_alert_deliveries"
        ON CONFLICT ("id") DO NOTHING
      `);
    }
    if (row.portfolio_deliveries_exists) {
      await db.execute(sql`
        INSERT INTO "pdf_alert_deliveries"
          ("id", "service", "kind", "recipients", "recipient_count", "email_success", "error_message", "triggered_by", "created_at")
        SELECT
          "id", 'portfolio', "kind", "recipients", "recipient_count", "email_success", "error_message", "triggered_by", "created_at"
        FROM "portfolio_pdf_alert_deliveries"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (createdAny) {
      logInfo("[migration] pdf_alert_* shared tables — applied");
    } else {
      logInfo("[migration] pdf_alert_* shared tables — already present, skipped");
    }
  } catch (err) {
    logError(
      "[migration] Failed to ensure pdf_alert shared tables:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
