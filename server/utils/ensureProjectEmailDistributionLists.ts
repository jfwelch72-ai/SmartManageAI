import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #611: project_email_distribution_lists — reusable email distribution
 * lists for project email blasts. Originally project-scoped; now `project_id`
 * is nullable so a list can be shared across the entire organization.
 */
export async function ensureProjectEmailDistributionLists(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "project_email_distribution_lists" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" varchar NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "project_id" varchar REFERENCES "projects"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "contact_emails" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "extra_emails" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "created_by_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // Backfill: drop NOT NULL on project_id for orgs that already created the
    // table when it was project-scoped only.
    await db.execute(sql`
      ALTER TABLE "project_email_distribution_lists"
        ALTER COLUMN "project_id" DROP NOT NULL
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "project_email_lists_org_idx"
        ON "project_email_distribution_lists" ("organization_id")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "project_email_lists_project_idx"
        ON "project_email_distribution_lists" ("project_id")
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "project_email_lists_project_name_uniq"
        ON "project_email_distribution_lists" ("project_id", "name")
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "project_email_lists_org_name_uniq"
        ON "project_email_distribution_lists" ("organization_id", "name")
        WHERE "project_id" IS NULL
    `);

    console.log("[migration] project_email_distribution_lists table ready");
  } catch (err) {
    logError(
      "[migration] ensureProjectEmailDistributionLists failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
