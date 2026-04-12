import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureNullablePermissions(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'user_dashboard_permissions'
        AND column_name NOT IN ('id', 'organization_id', 'user_id', 'granted_by_user_id', 'granted_at', 'applied_preset_id', 'created_at', 'updated_at')
        AND is_nullable = 'NO'
    `);

    const columnsToFix = result.rows.map((r: Record<string, unknown>) => r.column_name as string);

    if (columnsToFix.length === 0) {
      console.log("[migration] user_dashboard_permissions nullable — already applied, skipped");
      return;
    }

    for (const col of columnsToFix) {
      await db.execute(sql.raw(`ALTER TABLE user_dashboard_permissions ALTER COLUMN "${col}" DROP NOT NULL`));
    }
    console.log(`[migration] user_dashboard_permissions nullable — applied to ${columnsToFix.length} columns`);
  } catch (err) {
    logError("[migration] Failed to ensure nullable permissions:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
