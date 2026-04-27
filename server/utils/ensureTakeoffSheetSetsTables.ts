import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2065 — Ensure the `takeoff_sheet_sets` and
 * `takeoff_sheet_set_members` tables exist.
 *
 * Mirrors the Drizzle definitions in `shared/schema/features.ts`.
 * Idempotent so it is safe to run on every startup.
 */
export async function ensureTakeoffSheetSetsTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "takeoff_sheet_sets" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "project_id" varchar REFERENCES "projects"("id") ON DELETE CASCADE,
      "bid_id" varchar REFERENCES "bids"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "description" text,
      "color" text NOT NULL DEFAULT '#3b82f6',
      "default_scale_px_per_foot" double precision,
      "default_scale_label" text,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_by" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "created_at" timestamp NOT NULL DEFAULT NOW(),
      "updated_at" timestamp NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_sheet_sets_org_idx"
      ON "takeoff_sheet_sets"("organization_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_sheet_sets_project_idx"
      ON "takeoff_sheet_sets"("project_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_sheet_sets_bid_idx"
      ON "takeoff_sheet_sets"("bid_id")
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "takeoff_sheet_set_members" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "set_id" varchar NOT NULL REFERENCES "takeoff_sheet_sets"("id") ON DELETE CASCADE,
      "sheet_id" varchar NOT NULL REFERENCES "takeoff_sheets"("id") ON DELETE CASCADE,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamp NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_sheet_set_members_set_idx"
      ON "takeoff_sheet_set_members"("set_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_sheet_set_members_sheet_idx"
      ON "takeoff_sheet_set_members"("sheet_id")
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "takeoff_sheet_set_members_set_sheet_uq"
      ON "takeoff_sheet_set_members"("set_id", "sheet_id")
  `);
}
