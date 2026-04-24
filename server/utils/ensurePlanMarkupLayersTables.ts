import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1662: plan_markup_layers + plan_markup_layer_visibility.
 *
 * Layers are scoped per plan_document so each sheet can carry its own
 * named buckets (e.g. "QA/QC", "Design Review"). One auto-created
 * `Default` layer is materialised lazily by the API the first time a
 * plan document's layers are read or a markup is drawn — keeping the
 * migration itself bounded and idempotent.
 *
 * Visibility is per (user, layer) so two reviewers sharing a sheet can
 * independently focus on their own layers without affecting anyone else.
 */
export async function ensurePlanMarkupLayersTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "plan_markup_layers" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "plan_document_id" varchar NOT NULL REFERENCES "plan_documents"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "color" text NOT NULL DEFAULT '#94a3b8',
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_markup_layers_doc_idx"
      ON "plan_markup_layers"("plan_document_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_markup_layers_org_idx"
      ON "plan_markup_layers"("organization_id")
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plan_markup_layers_doc_name_unique'
        ) THEN
          ALTER TABLE "plan_markup_layers"
          ADD CONSTRAINT "plan_markup_layers_doc_name_unique"
          UNIQUE ("plan_document_id", "name");
        END IF;
      END$$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "plan_markup_layer_visibility" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "layer_id" varchar NOT NULL REFERENCES "plan_markup_layers"("id") ON DELETE CASCADE,
        "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "is_visible" boolean NOT NULL DEFAULT true,
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_markup_layer_visibility_layer_idx"
      ON "plan_markup_layer_visibility"("layer_id")
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plan_markup_layer_visibility_user_layer_unique'
        ) THEN
          ALTER TABLE "plan_markup_layer_visibility"
          ADD CONSTRAINT "plan_markup_layer_visibility_user_layer_unique"
          UNIQUE ("user_id", "layer_id");
        END IF;
      END$$;
    `);

    // Defer-add the FK from plan_document_markups.layer_id to
    // plan_markup_layers.id (the column was added by
    // ensurePlanDocumentMarkupsTable; we wire the constraint here once
    // the parent table exists). ON DELETE SET NULL means deleting a
    // layer drops its markups back to the default bucket instead of
    // wiping them out.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plan_document_markups_layer_id_fkey'
        ) THEN
          ALTER TABLE "plan_document_markups"
          ADD CONSTRAINT "plan_document_markups_layer_id_fkey"
          FOREIGN KEY ("layer_id") REFERENCES "plan_markup_layers"("id")
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    console.log("[migration] plan_markup_layers + visibility ready");
  } catch (err) {
    logError(
      "[migration] ensurePlanMarkupLayersTables failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
