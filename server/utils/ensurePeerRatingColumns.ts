import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensurePeerRatingColumns(): Promise<void> {
  const orgColumns = [
    { name: "peer_rating_anonymity_mode", table: "organizations", type: "text NOT NULL DEFAULT 'fully_anonymous'" },
    { name: "peer_rating_scope_mode", table: "organizations", type: "text NOT NULL DEFAULT 'project_crew'" },
  ];

  const permColumns = [
    { name: "can_submit_peer_ratings", table: "user_dashboard_permissions", type: "boolean NOT NULL DEFAULT false" },
    { name: "can_view_peer_ratings", table: "user_dashboard_permissions", type: "boolean NOT NULL DEFAULT false" },
  ];

  const allColumns = [...orgColumns, ...permColumns];

  for (const col of allColumns) {
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
          sql.raw(`ALTER TABLE "${col.table}" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`)
        );
        logInfo(`[migration] ${col.table}.${col.name} — applied`);
      } else {
        logInfo(`[migration] ${col.table}.${col.name} — already present, skipped`);
      }
    } catch (err) {
      logError(`[migration] Failed to ensure ${col.table}.${col.name}:`, {}, err instanceof Error ? err : new Error(String(err)));
    }
  }
}
