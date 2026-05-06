import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1396: dol_classification_mappings — remember which existing
 * `job_classifications` row a DOL feed name (as it appears in the cached
 * Davis-Bacon decision) was mapped to for a given project. Subsequent DOL
 * syncs read this table and skip the case-insensitive name match, which
 * can otherwise pick the wrong classification (e.g. "Carpenter (Group 1)"
 * vs. "Carpenter").
 *
 * Idempotent CREATE IF NOT EXISTS so fresh environments get the table at
 * boot without requiring `drizzle-kit push`.
 */
export async function ensureDolClassificationMappingsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "dol_classification_mappings" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "project_id" varchar NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
        "dol_feed_name" text NOT NULL,
        "classification_id" varchar NOT NULL REFERENCES "job_classifications"("id") ON DELETE CASCADE,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "dol_classification_mappings_organization_id_project_id_dol_feed_name_unique"
          UNIQUE ("organization_id", "project_id", "dol_feed_name")
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "dol_class_mappings_project_idx"
        ON "dol_classification_mappings"("project_id")
    `);

    logInfo("[migration] dol_classification_mappings table ready");
  } catch (err) {
    logError(
      "[migration] ensureDolClassificationMappingsTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
