import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1614 — mirrors migrations/0058_portal_token_lookup_hash.sql.
 *
 * Adds the deterministic `token_lookup_hash` column and a btree index on
 * it to `subcontractor_portal_tokens` so `requirePortalAuth` can resolve
 * a raw portal token to its row by an indexed equality lookup instead of
 * scanning every active+unexpired row and bcrypt-comparing each one.
 *
 * Idempotent — safe to run on every boot.
 */
export async function ensurePortalTokenLookupHashColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE subcontractor_portal_tokens
        ADD COLUMN IF NOT EXISTS token_lookup_hash text
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS sub_portal_tokens_token_lookup_idx
        ON subcontractor_portal_tokens(token_lookup_hash)
    `);
    console.log("[migration] subcontractor_portal_tokens.token_lookup_hash + index ready");
  } catch (err) {
    logError(
      "[migration] ensurePortalTokenLookupHashColumn failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
