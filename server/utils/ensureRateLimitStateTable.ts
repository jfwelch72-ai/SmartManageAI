import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #1831 — cross-replica backing store for the per-key debounces that
 * previously lived in module-level Maps inside
 * `server/projectLogEmailScheduleRoutes.ts`. Mirrors
 * `migrations/0067_rate_limit_state.sql` so freshly pulled dev DBs and
 * cold-start prod replicas get the table without `npx drizzle-kit migrate`.
 *
 * The "Send now" and "Send test digest" routes need 429-with-Retry-After
 * semantics that hold across all running replicas. With per-process Maps,
 * a frantic user clicking "Send" against a load balancer that round-robins
 * across N pods could fan out N sends instead of one. This shared row is
 * the atomic claim each replica writes against to gate the next attempt.
 */
export async function ensureRateLimitStateTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        key text PRIMARY KEY,
        last_invoked_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    logInfo("[migration] rate_limit_state table ready");
  } catch (err) {
    logError(
      "[migration] ensureRateLimitStateTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
