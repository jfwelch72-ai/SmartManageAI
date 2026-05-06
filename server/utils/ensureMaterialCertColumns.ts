import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

export async function ensureMaterialCertColumns(): Promise<void> {
  try {
    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'material_certifications'
      )::boolean AS table_exists
    `);
    if (tableCheck.rows[0]?.table_exists !== true) {
      logInfo("[migration] material_certifications submit columns — table absent, skipped");
      return;
    }

    const colCheck = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'material_certifications'
        AND column_name IN ('submitted_by_id', 'submitted_at', 'expiration_date')
    `);
    const present = new Set((colCheck.rows as { column_name: string }[]).map(r => r.column_name));

    let added = 0;
    if (!present.has("submitted_by_id")) {
      await db.execute(sql`ALTER TABLE "material_certifications" ADD COLUMN IF NOT EXISTS "submitted_by_id" varchar REFERENCES "users"("id")`);
      added++;
    }
    if (!present.has("submitted_at")) {
      await db.execute(sql`ALTER TABLE "material_certifications" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp`);
      added++;
    }
    if (!present.has("expiration_date")) {
      await db.execute(sql`ALTER TABLE "material_certifications" ADD COLUMN IF NOT EXISTS "expiration_date" date`);
      added++;
    }

    if (added > 0) {
      logInfo(`[migration] material_certifications submit columns — added ${added} column(s)`);
    } else {
      logInfo("[migration] material_certifications submit columns — already present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure material_certifications columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
