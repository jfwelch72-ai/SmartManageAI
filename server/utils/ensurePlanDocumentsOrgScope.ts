import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "./logger";

/**
 * Task #491 — relax `plan_documents` so an organization-scoped document
 * (e.g. a CRM organisation DBE/MBE/WBE certification PDF) is a valid
 * first-class entity. Previously `project_id` was NOT NULL, which forced
 * org-scoped uploads onto the legacy `documentUrl` column with no version
 * history. We:
 *
 *   1. Create the `plan_document_scope` enum (PROJECT|ORG) if missing.
 *   2. Add the `scope` column (default 'PROJECT') and `organization_id` FK.
 *   3. Drop the NOT NULL constraint on `project_id`.
 *   4. Backfill `organization_id` from `projects.gc_organization_id` for
 *      every project-scoped row so existing documents carry their tenant.
 *
 * The migration is idempotent: every step is guarded with IF NOT EXISTS or
 * a prior-state check, so re-runs are safe.
 */
export async function ensurePlanDocumentsOrgScope(): Promise<void> {
  try {
    // 1. Enum
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_document_scope') THEN
          CREATE TYPE "plan_document_scope" AS ENUM ('PROJECT', 'ORG');
        END IF;
      END$$;
    `);

    // 2. Add scope + organization_id columns
    await db.execute(sql`
      ALTER TABLE "plan_documents"
        ADD COLUMN IF NOT EXISTS "scope" "plan_document_scope" NOT NULL DEFAULT 'PROJECT'
    `);
    await db.execute(sql`
      ALTER TABLE "plan_documents"
        ADD COLUMN IF NOT EXISTS "organization_id" varchar
        REFERENCES "organizations"("id") ON DELETE CASCADE
    `);

    // 3. Drop NOT NULL on project_id (safe — we already require either a
    //    project_id or an organization_id at the application layer).
    await db.execute(sql`
      ALTER TABLE "plan_documents" ALTER COLUMN "project_id" DROP NOT NULL
    `);

    // 4. Backfill organization_id from projects.gc_organization_id where
    //    missing. Only project-scoped rows are eligible — org-scoped rows
    //    were never possible until this migration.
    const backfill = await db.execute(sql`
      UPDATE "plan_documents" pd
      SET "organization_id" = p."gc_organization_id"
      FROM "projects" p
      WHERE pd."organization_id" IS NULL
        AND pd."project_id" IS NOT NULL
        AND pd."project_id" = p."id"
    `);
    const backfilled = (backfill as unknown as { rowCount?: number })?.rowCount ?? 0;
    if (backfilled > 0) {
      logInfo(`[migration] plan_documents_org_scope — backfilled ${backfilled} organization_id value(s)`);
    } else {
      logInfo("[migration] plan_documents_org_scope — no rows needed organization_id backfill");
    }

    // 5. Add an index on organization_id since org-scoped queries (e.g. the
    //    Compliance dashboard, CRM org cert tab) filter by tenant first.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "plan_documents_org_idx" ON "plan_documents" ("organization_id")
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation .* does not exist/i.test(msg)) {
      logWarn(`[migration] plan_documents_org_scope — skipped due to schema drift: ${msg}`);
      return;
    }
    logError("[migration] Failed to relax plan_documents project scope:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
