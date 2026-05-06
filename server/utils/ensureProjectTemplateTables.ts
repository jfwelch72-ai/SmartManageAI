import { logError, logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureProjectTemplateTables(): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'project_templates') AS templates_exist,
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'project_template_versions') AS versions_exist
  `);

  const row = result.rows[0] as Record<string, boolean>;

  if (!row.templates_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "project_templates" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" VARCHAR REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "category" TEXT,
        "source_project_id" VARCHAR REFERENCES "projects"("id") ON DELETE SET NULL,
        "source_project_code" TEXT,
        "is_system_seed" BOOLEAN NOT NULL DEFAULT FALSE,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "current_version" INTEGER NOT NULL DEFAULT 1,
        "usage_count" INTEGER NOT NULL DEFAULT 0,
        "last_used_at" TIMESTAMP,
        "created_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_templates_org_idx" ON "project_templates" ("organization_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_templates_system_seed_idx" ON "project_templates" ("is_system_seed")`);
  }

  if (!row.versions_exist) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "project_template_versions" (
        "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        "template_id" VARCHAR NOT NULL REFERENCES "project_templates"("id") ON DELETE CASCADE,
        "version" INTEGER NOT NULL,
        "snapshot" JSONB NOT NULL,
        "notes" TEXT,
        "created_by_id" VARCHAR REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT "project_template_versions_uniq" UNIQUE ("template_id", "version")
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "project_template_versions_template_idx" ON "project_template_versions" ("template_id")`);
  }

  // Add the can_manage_project_templates flag to the dashboard permissions
  // table so role-based gating works in pre-existing organizations.
  try {
    await db.execute(sql`
      ALTER TABLE "user_dashboard_permissions"
      ADD COLUMN IF NOT EXISTS "can_manage_project_templates" BOOLEAN DEFAULT FALSE
    `);
  } catch (err) {
    logError("[migration] failed to add can_manage_project_templates:", err);
  }

  logInfo("[migration] project template tables — created successfully");
}
