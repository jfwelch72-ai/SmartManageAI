import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1609: plan_document_markups — project-side markup overlay table
 * keyed to (plan_document_id, page_number). Sibling to bid-side
 * `takeoff_markups`, intentionally not polymorphic so the blast radius
 * of changes in either surface stays bounded. Carryover-on-revision
 * is supported via `source_markup_id` + a partial unique index on
 * (plan_document_id, source_markup_id) for idempotency.
 *
 * Task #1662: also adds the `layer_id` + `group_id` columns for the
 * markups parity pass (named layers, grouping, per-user visibility).
 * Both columns are nullable so legacy rows render unchanged: a NULL
 * `layer_id` means "default layer", a NULL `group_id` means "ungrouped".
 */
export async function ensurePlanDocumentMarkupsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "plan_document_markups" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "project_id" varchar REFERENCES "projects"("id") ON DELETE CASCADE,
        "plan_document_id" varchar NOT NULL REFERENCES "plan_documents"("id") ON DELETE CASCADE,
        "page_number" integer NOT NULL DEFAULT 1,
        "tool" text NOT NULL,
        "points" text NOT NULL,
        "color" text NOT NULL DEFAULT '#ff0000',
        "thickness" integer NOT NULL DEFAULT 2,
        "text" text,
        "created_by" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "source_markup_id" varchar
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_document_markups_doc_page_idx"
      ON "plan_document_markups"("plan_document_id","page_number")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_document_markups_org_idx"
      ON "plan_document_markups"("organization_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_document_markups_created_by_idx"
      ON "plan_document_markups"("created_by")
    `);
    // Idempotency for carryover-on-revision: a (plan_document, source_markup)
    // pair can only exist once. Partial index ignores rows where
    // source_markup_id IS NULL (manually-drawn markups).
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "plan_document_markups_doc_source_unique"
      ON "plan_document_markups"("plan_document_id","source_markup_id")
      WHERE "source_markup_id" IS NOT NULL
    `);

    // Task #1662: layer + group membership columns. Added via ALTER so
    // existing deployments pick them up without rebuilding the table.
    // The FK on layer_id is added below in ensurePlanMarkupLayersTables
    // (after the parent table exists) to avoid a circular bootstrap.
    await db.execute(sql`
      ALTER TABLE "plan_document_markups"
      ADD COLUMN IF NOT EXISTS "layer_id" varchar
    `);
    await db.execute(sql`
      ALTER TABLE "plan_document_markups"
      ADD COLUMN IF NOT EXISTS "group_id" varchar
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_document_markups_layer_idx"
      ON "plan_document_markups"("layer_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_document_markups_group_idx"
      ON "plan_document_markups"("group_id")
    `);

    // Task #1775: soft-delete column for one-click "Undo plan-markup
    // delete". The DELETE route stamps this column instead of removing
    // the row so the new per-id restore endpoint can clear it and
    // bring the markup back with id/layer/group/points/etc all intact.
    // Nullable + added via ALTER so existing deployments pick it up
    // without a backfill (every existing row stays "live" because the
    // column defaults to NULL).
    await db.execute(sql`
      ALTER TABLE "plan_document_markups"
      ADD COLUMN IF NOT EXISTS "deleted_at" timestamp
    `);

    console.log("[migration] plan_document_markups table ready");
  } catch (err) {
    logError(
      "[migration] ensurePlanDocumentMarkupsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
