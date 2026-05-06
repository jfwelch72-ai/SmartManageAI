import type { Store, Options, IncrementResponse, ClientRateLimitInfo } from "express-rate-limit";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

/**
 * Task #2427 — Postgres-backed `Store` implementation for
 * `express-rate-limit`.
 *
 * The autoscale deployment runs N Node replicas behind a load balancer.
 * The default in-memory `MemoryStore` is per-process, so a client whose
 * requests round-robin across pods could effectively get N times the
 * configured per-window quota. This store persists the `(hit_count,
 * window_expires_at)` pair into the existing `rate_limit_state` table
 * (extended in migration 0075) so every replica sees the same counter.
 *
 * Concurrency contract:
 *   - `increment(key)` is implemented as a single `INSERT ... ON
 *     CONFLICT DO UPDATE ... RETURNING` round-trip. Two replicas racing
 *     on the same key both atomically advance the row and observe their
 *     own post-update `hit_count` value, so neither double-counts and
 *     neither misses.
 *   - When the existing row's `window_expires_at` has lapsed, the
 *     conflicting upsert resets the counter back to 1 inside the same
 *     statement — the window roll is atomic and never produces a
 *     half-rolled state visible to a parallel reader.
 *   - Keys are namespaced with `erl:<prefix>:` so the per-instance
 *     limiters don't collide with each other or with the Task #1831
 *     `debounce:` rows that share the same table.
 *
 * Failure mode:
 *   - On any Postgres error we open the gate (return totalHits = 1).
 *     Rate limits are a best-effort DDoS / abuse defense — we'd rather
 *     temporarily under-enforce than 500 every API call when Postgres
 *     hiccups. Errors are logged loudly so they show up in the
 *     Super Admin error log dashboard.
 *
 * `localKeys = false` tells `express-rate-limit`'s built-in misuse
 * detector that the same store instance can safely back multiple
 * limiters. Each limiter still gets its own logical bucket because we
 * embed `options.windowMs` and the limiter's `prefix` into the row key.
 */
export class PgExpressRateLimitStore implements Store {
  /** Optional namespace embedded into every key (e.g. `auth`, `api`). */
  public readonly prefix: string;
  public readonly localKeys = false;

  private windowMs: number = 60_000;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private fullKey(key: string): string {
    return `erl:${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const fullKey = this.fullKey(key);
    const windowSeconds = Math.max(1, Math.ceil(this.windowMs / 1000));
    try {
      // Atomic upsert. Three cases:
      //   1. No existing row → insert with hit_count = 1 and a fresh
      //      window_expires_at.
      //   2. Existing row whose window has expired → reset hit_count to
      //      1 and slide the window forward (`now() + windowMs`).
      //   3. Existing row still inside its window → increment hit_count
      //      by 1, keep window_expires_at.
      // RETURNING gives us the post-update counter so the limiter sees
      // an accurate `totalHits` for THIS request.
      const result = await db.execute(sql`
        INSERT INTO rate_limit_state (key, hit_count, window_expires_at, last_invoked_at)
        VALUES (
          ${fullKey},
          1,
          now() + make_interval(secs => ${windowSeconds}),
          now()
        )
        ON CONFLICT (key) DO UPDATE
          SET hit_count = CASE
                WHEN rate_limit_state.window_expires_at IS NULL
                  OR rate_limit_state.window_expires_at <= now()
                THEN 1
                ELSE COALESCE(rate_limit_state.hit_count, 0) + 1
              END,
              window_expires_at = CASE
                WHEN rate_limit_state.window_expires_at IS NULL
                  OR rate_limit_state.window_expires_at <= now()
                THEN now() + make_interval(secs => ${windowSeconds})
                ELSE rate_limit_state.window_expires_at
              END,
              last_invoked_at = now()
        RETURNING hit_count, window_expires_at
      `);

      const rows = (result as { rows?: unknown[] }).rows ?? [];
      const row = rows[0] as { hit_count?: number; window_expires_at?: string | Date } | undefined;
      const totalHits = Number(row?.hit_count ?? 1);
      const resetAt = row?.window_expires_at
        ? row.window_expires_at instanceof Date
          ? row.window_expires_at
          : new Date(row.window_expires_at)
        : new Date(Date.now() + this.windowMs);
      return { totalHits, resetTime: resetAt };
    } catch (err) {
      logError(
        "PgExpressRateLimitStore.increment failed — failing OPEN",
        { prefix: this.prefix, key },
        err instanceof Error ? err : new Error(String(err)),
      );
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    const fullKey = this.fullKey(key);
    try {
      await db.execute(sql`
        UPDATE rate_limit_state
           SET hit_count = GREATEST(COALESCE(hit_count, 1) - 1, 0)
         WHERE key = ${fullKey}
           AND hit_count IS NOT NULL
      `);
    } catch (err) {
      logError(
        "PgExpressRateLimitStore.decrement failed",
        { prefix: this.prefix, key },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  async resetKey(key: string): Promise<void> {
    const fullKey = this.fullKey(key);
    try {
      await db.execute(sql`DELETE FROM rate_limit_state WHERE key = ${fullKey}`);
    } catch (err) {
      logError(
        "PgExpressRateLimitStore.resetKey failed",
        { prefix: this.prefix, key },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  async resetAll(): Promise<void> {
    try {
      await db.execute(sql`
        DELETE FROM rate_limit_state
         WHERE key LIKE ${"erl:" + this.prefix + ":%"}
      `);
    } catch (err) {
      logError(
        "PgExpressRateLimitStore.resetAll failed",
        { prefix: this.prefix },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const fullKey = this.fullKey(key);
    try {
      const result = await db.execute(sql`
        SELECT hit_count, window_expires_at
          FROM rate_limit_state
         WHERE key = ${fullKey}
      `);
      const rows = (result as { rows?: unknown[] }).rows ?? [];
      const row = rows[0] as { hit_count?: number; window_expires_at?: string | Date } | undefined;
      if (!row || row.hit_count == null) return undefined;
      const resetAt = row.window_expires_at
        ? row.window_expires_at instanceof Date
          ? row.window_expires_at
          : new Date(row.window_expires_at)
        : undefined;
      return { totalHits: Number(row.hit_count), resetTime: resetAt };
    } catch (err) {
      logError(
        "PgExpressRateLimitStore.get failed",
        { prefix: this.prefix, key },
        err instanceof Error ? err : new Error(String(err)),
      );
      return undefined;
    }
  }
}

/**
 * Sweep expired counter rows. Safe to call on a schedule from a single
 * leader (the job runner already wraps cron ticks in advisory locks per
 * Task #2427 step 2). Idempotent and fast — uses the predicate index
 * created in migration 0075.
 */
export async function pruneExpiredRateLimitCounters(): Promise<number> {
  try {
    const result = await db.execute(sql`
      DELETE FROM rate_limit_state
       WHERE window_expires_at IS NOT NULL
         AND window_expires_at < now() - interval '1 hour'
    `);
    return (result as { rowCount?: number }).rowCount ?? 0;
  } catch (err) {
    logError(
      "pruneExpiredRateLimitCounters failed",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return 0;
  }
}
