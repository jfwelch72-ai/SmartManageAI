import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureFieldWorkerPermColumns(): Promise<void> {
  const columns = [
    { name: "can_view_safety", table: "user_dashboard_permissions" },
    { name: "can_view_ai_summaries", table: "user_dashboard_permissions" },
  ];

  for (const col of columns) {
    try {
      const colCheck = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = ${col.table} AND column_name = ${col.name}
        )::boolean AS col_exists
      `);
      const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

      if (!colAlreadyExists) {
        await db.execute(
          sql.raw(`ALTER TABLE "${col.table}" ADD COLUMN IF NOT EXISTS "${col.name}" boolean NOT NULL DEFAULT false`)
        );
        console.log(`[migration] ${col.table}.${col.name} — applied`);
      } else {
        console.log(`[migration] ${col.table}.${col.name} — already present, skipped`);
      }
    } catch (err) {
      console.error(`[migration] Failed to ensure ${col.table}.${col.name}:`, err);
    }
  }

  await ensureProjectScopeColumn();

  await ensureFinancialsAccessColumn("user_dashboard_permissions", "none");
  await ensureFinancialsAccessColumn("hustler_delegates", "view");
}

async function ensureProjectScopeColumn(): Promise<void> {
  const table = "user_dashboard_permissions";
  try {
    const newColCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = 'project_scope'
      )::boolean AS col_exists
    `);
    const newColExists = newColCheck.rows[0]?.col_exists === true;

    if (!newColExists) {
      await db.execute(sql.raw(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "project_scope" text NOT NULL DEFAULT 'ALL'`
      ));
      console.log(`[migration] ${table}.project_scope — column added`);
    }

    const oldColCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = 'can_access_active_projects_only'
      )::boolean AS col_exists
    `);
    if (oldColCheck.rows[0]?.col_exists === true) {
      await db.execute(sql.raw(`
        UPDATE "${table}" SET project_scope = 'ACTIVE_ONLY'
        WHERE can_access_active_projects_only = true AND project_scope = 'ALL'
      `));
      await db.execute(sql.raw(
        `ALTER TABLE "${table}" DROP COLUMN "can_access_active_projects_only"`
      ));
      console.log(`[migration] ${table}.project_scope — backfilled and dropped legacy column`);
    } else if (!newColExists) {
      console.log(`[migration] ${table}.project_scope — applied`);
    } else {
      console.log(`[migration] ${table}.project_scope — already present, skipped`);
    }
  } catch (err) {
    console.error(`[migration] Failed to ensure ${table}.project_scope:`, err);
  }
}

async function ensureFinancialsAccessColumn(table: string, defaultVal: string): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = 'financials_access'
      )::boolean AS col_exists
    `);
    const exists = colCheck.rows[0]?.col_exists === true;

    if (!exists) {
      await db.execute(sql.raw(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "financials_access" text NOT NULL DEFAULT '${defaultVal}'`
      ));

      const hasLegacyView = await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = ${table} AND column_name = 'can_view_financials'
        )::boolean AS col_exists
      `);
      if (hasLegacyView.rows[0]?.col_exists === true) {
        if (table === "user_dashboard_permissions") {
          await db.execute(sql.raw(`
            UPDATE "${table}" SET financials_access = CASE
              WHEN can_edit_financials = true THEN 'manage'
              WHEN can_view_financials = true OR can_access_financials = true THEN 'view'
              ELSE 'none'
            END
          `));
        } else {
          await db.execute(sql.raw(`
            UPDATE "${table}" SET financials_access = CASE
              WHEN can_view_financials = true THEN 'view'
              ELSE 'none'
            END
          `));
        }
      }
      console.log(`[migration] ${table}.financials_access — applied`);
    } else {
      console.log(`[migration] ${table}.financials_access — already present, skipped`);
    }

    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.check_constraints
          WHERE constraint_name = '${table}_financials_access_check'
        ) THEN
          ALTER TABLE "${table}" ADD CONSTRAINT "${table}_financials_access_check"
            CHECK (financials_access IN ('none', 'view', 'manage'));
        END IF;
      END $$;
    `));
  } catch (err) {
    console.error(`[migration] Failed to ensure ${table}.financials_access:`, err);
  }
}
