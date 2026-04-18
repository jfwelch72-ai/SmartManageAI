import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Adds the four DOT/heavy-civil integration provider enum values and the
 * surety bond verification columns. Idempotent — safe to run on every boot.
 */
export async function ensureDotIntegrationSchema(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::integration_provider))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    const wanted = ["aashtoware", "dol_davis_bacon", "dbe_directory", "surety_verification"];
    for (const v of wanted) {
      if (!existing.has(v)) {
        await db.execute(sql.raw(`ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS '${v}'`));
        console.log(`[migration] integration_provider enum — added '${v}' value`);
      }
    }

    // surety_bonds may not exist yet on orgs without the heavy-civil
    // schema applied — guard so we don't fail the whole startup pass.
    const tableCheck = await db.execute(sql`
      SELECT to_regclass('public.surety_bonds') AS oid
    `);
    if ((tableCheck.rows as any[])[0]?.oid) {
      await db.execute(sql.raw(`ALTER TABLE surety_bonds ADD COLUMN IF NOT EXISTS verification_status text`));
      await db.execute(sql.raw(`ALTER TABLE surety_bonds ADD COLUMN IF NOT EXISTS last_verified_at timestamp`));
    }
  } catch (err) {
    logError("[migration] ensureDotIntegrationSchema failed:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
