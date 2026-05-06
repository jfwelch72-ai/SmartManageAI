import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureMessageColumns(): Promise<void> {
  try {
    const colCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'is_field_note'
      )::boolean AS col_exists
    `);
    const colAlreadyExists = colCheck.rows[0]?.col_exists === true;

    if (!colAlreadyExists) {
      await db.execute(sql`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "is_field_note" boolean NOT NULL DEFAULT false`);
      logInfo("[migration] messages.is_field_note — applied");
    } else {
      logInfo("[migration] messages.is_field_note — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure messages columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
