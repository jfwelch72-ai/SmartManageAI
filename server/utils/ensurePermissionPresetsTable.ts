import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensurePermissionPresetsTable(): Promise<void> {
  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'permission_presets'
      )::boolean AS table_exists
    `);
    const tableAlreadyExists = tableCheck.rows[0]?.table_exists === true;

    if (!tableAlreadyExists) {
      await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS permission_presets (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          name varchar(255) NOT NULL,
          description text,
          target_role varchar(50) NOT NULL,
          permissions text NOT NULL,
          is_built_in boolean NOT NULL DEFAULT false,
          organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `));
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS permission_presets_org_idx ON permission_presets(organization_id)`));
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS permission_presets_role_idx ON permission_presets(target_role)`));
      console.log(`[migration] permission_presets table — created`);
    } else {
      console.log(`[migration] permission_presets table — already exists, skipped`);
    }
  } catch (err) {
    logError(`[migration] Failed to ensure permission_presets table:`, {}, err instanceof Error ? err : new Error(String(err)));
  }
}
