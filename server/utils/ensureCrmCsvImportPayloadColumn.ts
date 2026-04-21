import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Ensure the crm_csv_import_jobs table exists with the columns the async
 * import worker needs (`payload`, `started_at`). Idempotent — safe to run on
 * every cold start.
 */
export async function ensureCrmCsvImportPayloadColumn(): Promise<void> {
  // Required enums.
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_csv_import_entity" AS ENUM ('CONTACT','ORGANISATION','OPPORTUNITY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`DO $$ BEGIN CREATE TYPE "crm_csv_import_status" AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED','REVERTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "crm_csv_import_jobs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "entity_type" "crm_csv_import_entity" NOT NULL,
      "status" "crm_csv_import_status" NOT NULL DEFAULT 'PENDING',
      "filename" text,
      "total_rows" integer NOT NULL DEFAULT 0,
      "processed_rows" integer NOT NULL DEFAULT 0,
      "inserted_rows" integer NOT NULL DEFAULT 0,
      "updated_rows" integer NOT NULL DEFAULT 0,
      "skipped_rows" integer NOT NULL DEFAULT 0,
      "error_rows" integer NOT NULL DEFAULT 0,
      "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "inserted_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "completed_at" timestamp
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_csv_import_jobs_org_idx" ON "crm_csv_import_jobs" ("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "crm_csv_import_jobs_status_idx" ON "crm_csv_import_jobs" ("status")`);

  // Async-worker columns added on top of the original synchronous schema.
  await db.execute(sql`ALTER TABLE "crm_csv_import_jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE "crm_csv_import_jobs" ADD COLUMN IF NOT EXISTS "started_at" timestamp`);
}
