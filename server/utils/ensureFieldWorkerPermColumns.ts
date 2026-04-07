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

  await ensureFinancialsAccessColumn("user_dashboard_permissions", "none");
  await ensureFinancialsAccessColumn("hustler_delegates", "view");
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
