import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureUsersManagerIdColumn(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'manager_id'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`
        ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "manager_id" varchar
          REFERENCES "users"("id") ON DELETE SET NULL
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS users_manager_id_idx ON "users"("manager_id")
      `);
      console.log("[migration] users.manager_id — applied");
    } else {
      console.log("[migration] users.manager_id — already present, skipped");
    }
  } catch (err) {
    logError(
      "[migration] Failed to ensure users.manager_id column:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
