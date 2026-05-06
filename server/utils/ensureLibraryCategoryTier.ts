import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2068 — Trade > Category > Item catalog restructure.
 *
 * Adds the `library_categories` table (the middle "Category" tier) and the
 * supporting `trade_type` / `category_id` columns on `library_items`. Backfills
 * existing items into per-organization "Uncategorized" categories so the new
 * three-tier UI has a sensible default to render against.
 */
export async function ensureLibraryCategoryTier(): Promise<void> {
  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'library_categories'
      )::boolean AS e
    `);
    if (tableCheck.rows[0]?.e !== true) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "library_categories" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
          "library_id" varchar REFERENCES "custom_libraries"("id") ON DELETE SET NULL,
          "trade_type" varchar(60),
          "name" varchar(120) NOT NULL,
          "description" text,
          "display_order" integer NOT NULL DEFAULT 0,
          "source_id" varchar,
          "is_prebuilt" boolean NOT NULL DEFAULT false,
          "is_active" boolean NOT NULL DEFAULT true,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "library_categories_org_idx" ON "library_categories" ("organization_id")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "library_categories_trade_idx" ON "library_categories" ("trade_type")`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "library_categories_library_idx" ON "library_categories" ("library_id")`);
      logInfo("[migration] library_categories table — created");
    }

    const itemCols = [
      { col: "trade_type", ddl: "varchar(60)" },
      { col: "category_id", ddl: "varchar" },
    ];
    for (const c of itemCols) {
      const chk = await db.execute(sql.raw(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='library_items' AND column_name='${c.col}')::boolean AS e`
      ));
      if (chk.rows[0]?.e !== true) {
        await db.execute(sql.raw(`ALTER TABLE "library_items" ADD COLUMN IF NOT EXISTS "${c.col}" ${c.ddl}`));
        logInfo(`[migration] library_items.${c.col} — applied`);
      }
    }

    const fkCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'library_items'
          AND constraint_name = 'library_items_category_id_library_categories_id_fk'
      )::boolean AS e
    `);
    if (fkCheck.rows[0]?.e !== true) {
      await db.execute(sql`
        ALTER TABLE "library_items"
        ADD CONSTRAINT "library_items_category_id_library_categories_id_fk"
        FOREIGN KEY ("category_id") REFERENCES "library_categories"("id") ON DELETE SET NULL
      `);
      logInfo("[migration] library_items.category_id FK — applied");
    }

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "library_items_trade_idx" ON "library_items" ("trade_type")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "library_items_category_idx" ON "library_items" ("category_id")`);

    // Backfill: stamp `trade_type` from the organization's primary trade when
    // the item itself has none so legacy items show up under the right
    // top-level Trade tier.
    //
    // We intentionally LEAVE `category_id` as NULL for legacy items. The new
    // three-tier UI groups items with a NULL category under a virtual
    // "Uncategorized" bucket on the client, and the API exposes that bucket
    // via `?categoryId=uncategorized` (which translates to IS NULL). Inserting
    // a real category row here would break that filter for migrated rows.
    await db.execute(sql`
      UPDATE "library_items" li
      SET "trade_type" = COALESCE(li."trade_type", o."trade_type"::text)
      FROM "organizations" o
      WHERE li."organization_id" = o."id"
        AND li."trade_type" IS NULL
    `);
  } catch (err) {
    logError("[migration] Failed to ensure library category tier:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
