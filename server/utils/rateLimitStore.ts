import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #1831 — shared, cross-replica backing store for the per-key
 * debounces that previously lived as module-level `Map` instances inside
 * `server/projectLogEmailScheduleRoutes.ts`.
 *
 * Why this exists
 * ---------------
 * The "Send now" button (per-schedule) and the "Send test digest" button
 * (per-organization) both have a short debounce window so a frantic user
 * can't fan out duplicate emails by clicking repeatedly. The original
 * implementation kept the last-invocation timestamp in a module-level
 * `Map`, which works on a single Node process but silently breaks the
 * moment the deployment runs more than one replica behind a load
 * balancer: each pod has its own `Map`, so a click that round-robins to
 * a different pod sees an empty bucket and is allowed through. With N
 * replicas the worst case is N concurrent sends per click.
 *
 * Moving the timestamp into Postgres gives us an atomic claim that all
 * replicas write against. The default Postgres-backed store performs
 * the rate-limit decision in a single `INSERT ... ON CONFLICT DO UPDATE
 * ... WHERE` statement so two replicas racing on the same key still
 * end up with exactly one allowed claim and one 429.
 *
 * Public API
 * ----------
 *   - `consumeRateLimit(key, windowMs, nowMs)` — atomic claim. Returns
 *     `{ allowed: true, retryAfterSeconds: 0 }` on a successful claim or
 *     `{ allowed: false, retryAfterSeconds: N }` when the key is still
 *     within its window. `retryAfterSeconds` is always at least `1` when
 *     denied so the HTTP `Retry-After` header is a valid positive int.
 *   - `resetRateLimitStore()` — clears the active store. Intended for
 *     tests and for the legacy `__resetXxxDebounceForTests` aliases the
 *     existing route-level test suites still call.
 *   - `__setRateLimitStoreForTests(store | null)` — swaps the active
 *     store. Tests inject `createInMemoryRateLimitStore()` here so they
 *     don't have to mock `db.execute` for every rate-limit call.
 *   - `createInMemoryRateLimitStore()` — factory for an in-memory store
 *     that mirrors the Postgres store's semantics. Two route module
 *     instances pointed at the same factory result share the same Map,
 *     which is how we simulate a multi-replica deployment in tests
 *     without needing a real database.
 */

export interface RateLimitDecision {
  /** True when the caller successfully claimed the bucket. */
  allowed: boolean;
  /**
   * Seconds the caller should wait before retrying. Always `0` when
   * `allowed` is true; always >= 1 when `allowed` is false so the HTTP
   * `Retry-After` header value stays a valid positive integer.
   */
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitDecision>;
  /** Test/dev only — wipes the entire store. */
  reset(): Promise<void>;
}

function deniedFromLastMs(
  lastMs: number,
  windowMs: number,
  nowMs: number,
): RateLimitDecision {
  const elapsedMs = Math.max(0, nowMs - lastMs);
  const retryAfterMs = Math.max(0, windowMs - elapsedMs);
  // The Retry-After HTTP header is "delta-seconds" — a non-negative
  // integer. We round up so the client never re-fires a millisecond
  // early, and we floor at 1 so a sub-second remaining window doesn't
  // emit `Retry-After: 0` (which a browser may treat as "retry now").
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

class PostgresRateLimitStore implements RateLimitStore {
  async consume(
    key: string,
    windowMs: number,
    nowMs: number,
  ): Promise<RateLimitDecision> {
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const nowDate = new Date(nowMs);

    // Atomic claim:
    //   - INSERT inserts the row (and counts as a successful claim) when
    //     no row exists yet for `key`.
    //   - On conflict we only overwrite `last_invoked_at` when the
    //     existing row is already older than the window — i.e. the
    //     bucket has refilled. The `WHERE` filter on the UPDATE is what
    //     makes this safe under concurrency: two racing INSERTs both
    //     trip the conflict, only one of them satisfies the WHERE, and
    //     therefore only one of them returns a row from RETURNING.
    //
    // `RETURNING last_invoked_at`:
    //   - returns the inserted/updated row when the claim succeeded
    //   - returns zero rows when the conflict fired and the WHERE
    //     filter rejected the update (i.e. still inside the window)
    const upsertResult = await db.execute(sql`
      INSERT INTO rate_limit_state (key, last_invoked_at)
      VALUES (${key}, ${nowDate})
      ON CONFLICT (key) DO UPDATE
        SET last_invoked_at = EXCLUDED.last_invoked_at
        WHERE rate_limit_state.last_invoked_at
              <= EXCLUDED.last_invoked_at - make_interval(secs => ${windowSeconds})
      RETURNING last_invoked_at
    `);

    const upsertRows = (upsertResult as { rows?: unknown[] }).rows ?? [];
    if (upsertRows.length > 0) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    // Claim was rejected — fetch the existing row to compute Retry-After.
    const existing = await db.execute(sql`
      SELECT last_invoked_at FROM rate_limit_state WHERE key = ${key}
    `);
    const existingRows = (existing as { rows?: unknown[] }).rows ?? [];
    const row = existingRows[0] as { last_invoked_at?: string | Date } | undefined;
    if (!row || row.last_invoked_at == null) {
      // Row vanished between the upsert and the select (extremely
      // unlikely — only happens if something DELETE'd the key in the
      // microsecond gap, e.g. a parallel `resetRateLimitStore()` from
      // a test). The upsert already told us the bucket was held by
      // someone else, so be conservative and deny with a short
      // 1-second `Retry-After` rather than allowing through. A
      // 1-second client retry will then re-run the atomic INSERT
      // and either claim the now-empty bucket or get the real
      // remaining window back.
      return { allowed: false, retryAfterSeconds: 1 };
    }
    const lastMs =
      row.last_invoked_at instanceof Date
        ? row.last_invoked_at.getTime()
        : new Date(row.last_invoked_at).getTime();
    return deniedFromLastMs(lastMs, windowMs, nowMs);
  }

  async reset(): Promise<void> {
    await db.execute(sql`TRUNCATE TABLE rate_limit_state`);
  }
}

/**
 * In-memory store that mirrors the Postgres store's semantics. Used
 * directly by tests (so they don't have to mock `db.execute` for every
 * rate-limit call) and indirectly by the multi-replica simulation test
 * — two route module instances pointed at the same store instance
 * share the same Map, which is how a single shared Postgres row
 * behaves in production.
 */
export function createInMemoryRateLimitStore(): RateLimitStore {
  const lastInvokedAtByKey = new Map<string, number>();

  return {
    async consume(
      key: string,
      windowMs: number,
      nowMs: number,
    ): Promise<RateLimitDecision> {
      const last = lastInvokedAtByKey.get(key);
      if (last !== undefined && nowMs - last < windowMs) {
        return deniedFromLastMs(last, windowMs, nowMs);
      }
      lastInvokedAtByKey.set(key, nowMs);

      // Bounded best-effort cleanup so a long-running test process or
      // dev server can't grow the map unboundedly. We only sweep when
      // the map crosses a generous threshold so the common case stays
      // O(1). `forEach` is used instead of a `for...of` loop because
      // the project's tsconfig doesn't enable `downlevelIteration`.
      if (lastInvokedAtByKey.size > 1000) {
        const cutoff = nowMs - windowMs * 5;
        lastInvokedAtByKey.forEach((ts, k) => {
          if (ts < cutoff) lastInvokedAtByKey.delete(k);
        });
      }

      return { allowed: true, retryAfterSeconds: 0 };
    },

    async reset(): Promise<void> {
      lastInvokedAtByKey.clear();
    },
  };
}

const defaultStore: RateLimitStore = new PostgresRateLimitStore();
let activeStore: RateLimitStore = defaultStore;

export function consumeRateLimit(
  key: string,
  windowMs: number,
  nowMs: number,
): Promise<RateLimitDecision> {
  return activeStore.consume(key, windowMs, nowMs);
}

export async function resetRateLimitStore(): Promise<void> {
  await activeStore.reset();
}

/**
 * Test-only seam. Pass an in-memory store to opt out of Postgres for
 * the duration of a test; pass `null` to restore the default Postgres
 * store. This is how `server/__tests__/*.test.ts` keep their existing
 * `vi.mock("../db")` setups working without having to mock the
 * INSERT-ON-CONFLICT statement.
 */
export function __setRateLimitStoreForTests(
  store: RateLimitStore | null,
): void {
  activeStore = store ?? defaultStore;
}
