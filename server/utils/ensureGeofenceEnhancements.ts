import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureGeofenceEnhancements(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'time_clock_shifts' AND column_name = 'clock_in_accuracy'
      )::boolean AS col_exists
    `);
    const alreadyApplied = colCheck.rows[0]?.col_exists === true;

    if (!alreadyApplied) {
      await db.execute(sql`ALTER TABLE "time_clock_shifts" ADD COLUMN IF NOT EXISTS "clock_in_accuracy" double precision`);
      await db.execute(sql`ALTER TABLE "time_clock_shifts" ADD COLUMN IF NOT EXISTS "clock_out_accuracy" double precision`);
      await db.execute(sql`ALTER TABLE "time_clock_shifts" ADD COLUMN IF NOT EXISTS "spoofing_flag" boolean DEFAULT false`);
      await db.execute(sql`ALTER TABLE "time_clock_shifts" ADD COLUMN IF NOT EXISTS "spoofing_details" text`);
      await db.execute(sql`ALTER TABLE "time_clock_shifts" ADD COLUMN IF NOT EXISTS "geofence_override" boolean DEFAULT false`);
      await db.execute(sql`ALTER TABLE "time_clock_shifts" ADD COLUMN IF NOT EXISTS "geofence_override_reason" text`);

      await db.execute(sql`ALTER TABLE "time_clock_events" ADD COLUMN IF NOT EXISTS "accuracy" double precision`);
      await db.execute(sql`ALTER TABLE "time_clock_events" ADD COLUMN IF NOT EXISTS "geofence_status" varchar(20)`);
      await db.execute(sql`ALTER TABLE "time_clock_events" ADD COLUMN IF NOT EXISTS "spoofing_flag" boolean DEFAULT false`);

      await db.execute(sql`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'LOCATION_PING' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'clock_event_type')) THEN
            ALTER TYPE "clock_event_type" ADD VALUE 'LOCATION_PING';
          END IF;
        END $$
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "project_geofence_zones" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          "name" text NOT NULL,
          "type" varchar(10) NOT NULL DEFAULT 'circle',
          "latitude" double precision,
          "longitude" double precision,
          "radius" integer,
          "polygon" text,
          "is_active" boolean NOT NULL DEFAULT true,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "geofence_zones_project_id_idx" ON "project_geofence_zones" ("project_id")
      `);

      console.log("[migration] geofence enhancements — applied");
    } else {
      console.log("[migration] geofence enhancements — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure geofence enhancements:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
