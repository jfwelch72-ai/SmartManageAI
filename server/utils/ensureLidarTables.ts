import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureLidarTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lidar_scans') AS scans_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lidar_annotations') AS annotations_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lidar_comparisons') AS comparisons_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;
  if (row.scans_exist && row.annotations_exist && row.comparisons_exist) {
    logInfo("[migration] lidar tables — already present, skipped");
    return;
  }

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "lidar_scan_status" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'ERROR');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "lidar_annotation_type" AS ENUM ('DISTANCE', 'AREA', 'VOLUME', 'NOTE');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "lidar_comparison_type" AS ENUM ('SCAN_VS_SCAN', 'SCAN_VS_BIM');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lidar_scans" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "uploaded_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "file_name" text NOT NULL,
      "file_url" text NOT NULL,
      "file_size" integer,
      "file_format" text,
      "status" "lidar_scan_status" NOT NULL DEFAULT 'UPLOADING',
      "capture_date" timestamp,
      "capture_device" text,
      "location" text,
      "notes" text,
      "point_count" integer,
      "thumbnail_url" text,
      "metadata" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_scans_project_idx" ON "lidar_scans"("project_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_scans_org_idx" ON "lidar_scans"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_scans_status_idx" ON "lidar_scans"("status")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_scans_capture_date_idx" ON "lidar_scans"("capture_date")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lidar_annotations" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "scan_id" varchar NOT NULL REFERENCES "lidar_scans"("id") ON DELETE CASCADE,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "type" "lidar_annotation_type" NOT NULL,
      "label" text NOT NULL,
      "points" text NOT NULL,
      "value" double precision,
      "unit" text,
      "note" text,
      "color" text DEFAULT '#ff0000',
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_annotations_scan_idx" ON "lidar_annotations"("scan_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_annotations_type_idx" ON "lidar_annotations"("type")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lidar_comparisons" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "type" "lidar_comparison_type" NOT NULL,
      "name" text NOT NULL,
      "scan_a_id" varchar NOT NULL REFERENCES "lidar_scans"("id") ON DELETE CASCADE,
      "scan_b_id" varchar REFERENCES "lidar_scans"("id") ON DELETE CASCADE,
      "bim_document_id" varchar,
      "bim_document_url" text,
      "tolerance_mm" double precision DEFAULT 25,
      "deviation_data" text,
      "notes" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_comparisons_project_idx" ON "lidar_comparisons"("project_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_comparisons_org_idx" ON "lidar_comparisons"("organization_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "lidar_comparisons_scan_a_idx" ON "lidar_comparisons"("scan_a_id")`);

  logInfo("[migration] lidar tables — created");
}
