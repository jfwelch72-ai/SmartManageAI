import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2056 — persistent, cross-replica backing store for the short-lived
 * Apple Sign-In OAuth state values consumed by the cross-site form_post
 * callback. Mirrors `migrations/0070_oauth_state.sql` so freshly pulled
 * dev DBs and cold-start prod replicas get the table without needing
 * `npx drizzle-kit migrate`.
 *
 * Why this is needed
 * ------------------
 * The previous in-memory Map (`server/oauthStateStore.ts`) was per-process,
 * so any Node restart between the user clicking "Continue with Apple" and
 * Apple POSTing back the callback — or any load balancer hop to a sibling
 * pod — bounced the user to "Your Apple sign-in session expired or was
 * blocked by your browser." Persisting the state in Postgres makes every
 * issued state visible to every replica for the full ~10-minute TTL.
 */
export async function ensureOauthStateTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS oauth_state (
        state text PRIMARY KEY,
        provider text NOT NULL,
        expires_at timestamptz NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS oauth_state_expires_at_idx
        ON oauth_state (expires_at)
    `);
    logInfo("[migration] oauth_state table ready");
  } catch (err) {
    logError(
      "[migration] ensureOauthStateTable failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  }
}
