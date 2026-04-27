import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2065 — Ensure the `takeoff_tool_chest_items` table exists.
 *
 * Mirrors the Drizzle definition in `shared/schema/features.ts`. Idempotent
 * so it is safe to run on every startup; matches the pattern of the other
 * `ensure*` helpers registered in `runStartupMigrations.ts`.
 */
export async function ensureTakeoffToolChestTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "takeoff_tool_chest_items" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
      "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "item_kind" text NOT NULL,
      "item_id" text NOT NULL,
      "label" text,
      "color" text,
      "shortcut" text,
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_shared" boolean NOT NULL DEFAULT false,
      "last_used_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT NOW(),
      "updated_at" timestamp NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_tool_chest_items_org_idx"
      ON "takeoff_tool_chest_items"("organization_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "takeoff_tool_chest_items_user_idx"
      ON "takeoff_tool_chest_items"("user_id")
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "takeoff_tool_chest_items_user_kind_id_uq"
      ON "takeoff_tool_chest_items"("user_id", "item_kind", "item_id")
  `);
}
