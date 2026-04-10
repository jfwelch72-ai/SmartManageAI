import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureStackctProviderEnum(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::integration_provider))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    if (!existing.has("stackct")) {
      await db.execute(sql.raw(`ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'stackct'`));
      console.log("[migration] integration_provider enum — added 'stackct' value");
    }
  } catch (err) {
    console.error("[migration] ensureStackctProviderEnum failed:", err);
  }
}
