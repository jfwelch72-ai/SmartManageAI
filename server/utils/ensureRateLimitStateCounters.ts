import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2427 — adds the counter columns (`hit_count`, `window_expires_at`)
 * needed by the express-rate-limit Postgres-backed Store onto the existing
 * `rate_limit_state` table introduced in 0067. The Task #1831 debounce
 * code keeps using `last_invoked_at` and ignores these columns; the new
 * `PgExpressRateLimitStore` reads/writes only the new columns. Distinct
 * key prefixes (`debounce:` vs `erl:`) keep the two record types from
 * colliding on the primary key.
 */
export async function ensureRateLimitStateCounters(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE "rate_limit_state"
        ADD COLUMN IF NOT EXISTS "hit_count" integer,
        ADD COLUMN IF NOT EXISTS "window_expires_at" timestamptz
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "rate_limit_state_window_expires_idx"
        ON "rate_limit_state" ("window_expires_at")
        WHERE "window_expires_at" IS NOT NULL
    `);
    console.log("[migration] rate_limit_state counter columns ready");
  } catch (err) {
    logError(
      "[migration] ensureRateLimitStateCounters failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
