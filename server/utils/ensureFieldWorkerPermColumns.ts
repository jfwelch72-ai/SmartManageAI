import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureFieldWorkerPermColumns(): Promise<void> {
  const columns = [
    { name: "can_view_safety", table: "user_dashboard_permissions" },
    { name: "can_view_ai_summaries", table: "user_dashboard_permissions" },
    { name: "can_view_financials", table: "user_dashboard_permissions" },
    { name: "can_edit_financials", table: "user_dashboard_permissions" },
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

  await backfillFinancialPermissionsSplit();
}

async function backfillFinancialPermissionsSplit(): Promise<void> {
  try {
    const viewResult = await db.execute(sql`
      UPDATE user_dashboard_permissions
      SET can_view_financials = true
      WHERE can_access_financials = true
        AND can_view_financials = false
    `);
    const viewRows = viewResult && typeof viewResult === 'object' && 'rowCount' in viewResult ? viewResult.rowCount : 0;
    console.log(`[migration] backfill can_view_financials from can_access_financials — ${viewRows || 0} rows updated`);

    const editResult = await db.execute(sql`
      UPDATE user_dashboard_permissions
      SET can_edit_financials = true
      WHERE can_access_financials = true
        AND can_edit_financials = false
    `);
    const editRows = editResult && typeof editResult === 'object' && 'rowCount' in editResult ? editResult.rowCount : 0;
    console.log(`[migration] backfill can_edit_financials from can_access_financials — ${editRows || 0} rows updated`);
  } catch (err) {
    console.error(`[migration] Failed to backfill financial permissions split:`, err);
  }
}
