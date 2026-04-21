import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #731: explicit owner field on CRM organisations so reassignment events
 * can be detected and notified through the coalesced reassignment helper,
 * matching contacts/opportunities/projects.
 *
 * Idempotent — safe to run on every cold start. The owner_id backfill from
 * created_by_id only runs the *first* time the column is created so that
 * intentionally cleared owners (the routes explicitly support setting
 * ownerId back to null) aren't rehydrated on every restart.
 */
export async function ensureCrmOrganisationOwnerColumn(): Promise<void> {
  const existing = await db.execute(sql`
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'crm_organisations'
       AND column_name = 'owner_id'
     LIMIT 1
  `);
  const columnAlreadyExists = (existing.rows ?? []).length > 0;

  await db.execute(sql`
    ALTER TABLE "crm_organisations"
      ADD COLUMN IF NOT EXISTS "owner_id" varchar
        REFERENCES "users"("id") ON DELETE SET NULL
  `);

  if (!columnAlreadyExists) {
    // First-time backfill only — preserves any null owners persisted later by
    // the single/bulk reassignment routes.
    await db.execute(sql`
      UPDATE "crm_organisations"
         SET owner_id = created_by_id
       WHERE owner_id IS NULL AND created_by_id IS NOT NULL
    `);
  }

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "crm_organisations_owner_idx"
      ON "crm_organisations" ("owner_id")
  `);
}
