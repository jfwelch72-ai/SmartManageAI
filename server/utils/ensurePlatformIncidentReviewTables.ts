import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo } from "./logger";

/**
 * Task #1578 — platform-support incident review tables. Stores the lightweight
 * incident-review record + per-attachment metadata (object-storage key,
 * dataset branch, windowHours, super-admin actor) for the
 * /api/crm/.../attach-to-incident-review handler that streams the alert
 * failures CSV directly into Replit object storage. Idempotent.
 */
export async function ensurePlatformIncidentReviewTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "platform_incident_reviews" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "title" text NOT NULL,
      "summary" text,
      "status" text NOT NULL DEFAULT 'OPEN',
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "platform_incident_reviews_status_idx" ON "platform_incident_reviews"("status", "created_at")`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "platform_incident_review_attachments" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "review_id" varchar NOT NULL REFERENCES "platform_incident_reviews"("id") ON DELETE CASCADE,
      "source" text NOT NULL DEFAULT 'alert_failures_digest',
      "dataset" text NOT NULL,
      "window_hours" integer NOT NULL,
      "file_name" text NOT NULL,
      "object_key" text NOT NULL,
      "file_size" integer NOT NULL DEFAULT 0,
      "content_type" text NOT NULL DEFAULT 'text/csv',
      "org_row_count" integer NOT NULL DEFAULT 0,
      "sample_row_count" integer NOT NULL DEFAULT 0,
      "attached_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "attached_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS "platform_incident_review_attachments_review_idx" ON "platform_incident_review_attachments"("review_id", "attached_at")`,
  );
  logInfo("[migration] platform_incident_review tables ready");
}
