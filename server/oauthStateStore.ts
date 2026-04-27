import crypto from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

// Task #2056 — persistent, cross-replica store for the short-lived OAuth
// state values that must survive a cross-site form_post (specifically Apple
// Sign-In, where the browser drops SameSite cookies on the cross-site POST
// callback).
//
// History
// -------
// This used to be a per-process `Map`. That worked for a single Node
// process, but two failure modes broke it the moment we needed more than
// one:
//   1. A server restart (e.g. a deploy) between the user clicking
//      "Continue with Apple" and Apple POSTing back the callback wiped
//      every issued state from memory and bounced the user with
//      "Your Apple sign-in session expired or was blocked by your browser."
//   2. With horizontal scaling, the callback POST might land on a sibling
//      replica that never issued the state — same error, same dead end.
// Moving the state into Postgres makes every issued state visible to every
// replica for the full ~10-minute TTL, and an atomic
// `DELETE ... WHERE expires_at > now() RETURNING` consume preserves the
// one-time-use semantics under concurrent callbacks.
//
// Properties (preserved from the in-memory implementation)
// --------------------------------------------------------
//   - 32-byte random hex state values (256 bits of entropy).
//   - One-time use: a state value can only be consumed once. The
//     atomic DELETE ... RETURNING is what enforces this — two replicas
//     racing on the same state will both run the DELETE, but Postgres
//     row-level locking guarantees only one of them gets the row back.
//   - TTL of 10 minutes by default (Apple consent screens rarely take
//     longer). The TTL is stored on the row, so a state that expires
//     while the user is mid-flow is rejected without needing a
//     separate sweeper to have run yet.
//   - Provider-namespaced so an Apple state cannot be consumed as a
//     Google state.
//
// Public API
// ----------
//   - `createOAuthState(provider, ttlMs)` — issues and persists a state.
//   - `consumeOAuthState(provider, state)` — atomic single-use consume.
//   - `__setOAuthStateStoreForTests(store | null)` — swap in an
//     in-memory store for tests so they don't have to mock `db.execute`.
//   - `createInMemoryOAuthStateStore()` — factory mirroring the
//     Postgres store's semantics.

export interface OAuthStateStore {
  create(provider: string, state: string, expiresAt: Date): Promise<void>;
  consume(provider: string, state: string, nowMs: number): Promise<boolean>;
  /** Test/dev only — wipes the entire store. */
  reset(): Promise<void>;
  /** Test-only inspector — number of entries currently retained. */
  size(): Promise<number>;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

class PostgresOAuthStateStore implements OAuthStateStore {
  async create(provider: string, state: string, expiresAt: Date): Promise<void> {
    // 32-byte hex from `crypto.randomBytes` is globally unique in
    // practice; an `ON CONFLICT DO NOTHING` keeps `create` idempotent
    // in the astronomically unlikely collision case so the caller
    // always gets a usable state back without surfacing a 23505.
    await db.execute(sql`
      INSERT INTO oauth_state (state, provider, expires_at)
      VALUES (${state}, ${provider}, ${expiresAt})
      ON CONFLICT (state) DO NOTHING
    `);
  }

  async consume(provider: string, state: string, nowMs: number): Promise<boolean> {
    // Atomic one-time consume:
    //   - DELETE removes the row so a replay can't succeed.
    //   - The `expires_at > $now` filter rejects stale rows that the
    //     periodic sweep hasn't gotten to yet, without having to
    //     SELECT-then-DELETE (which would race a parallel callback).
    //   - The `provider = $provider` filter enforces namespacing
    //     symmetrically with the in-memory store: a state issued for
    //     Apple cannot be consumed as a Google state.
    //   - RETURNING tells us whether a row actually matched, which is
    //     the definitive "consume succeeded" signal under concurrency:
    //     two replicas POSTing the same state both run the DELETE, but
    //     Postgres serializes them and only one gets a row back.
    const nowDate = new Date(nowMs);
    const result = await db.execute(sql`
      DELETE FROM oauth_state
      WHERE state = ${state}
        AND provider = ${provider}
        AND expires_at > ${nowDate}
      RETURNING state
    `);
    const rows = (result as { rows?: unknown[] }).rows ?? [];
    return rows.length > 0;
  }

  async reset(): Promise<void> {
    await db.execute(sql`TRUNCATE TABLE oauth_state`);
  }

  async size(): Promise<number> {
    const result = await db.execute(sql`SELECT COUNT(*)::int AS n FROM oauth_state`);
    const rows = (result as { rows?: Array<{ n?: number }> }).rows ?? [];
    return rows[0]?.n ?? 0;
  }
}

/**
 * In-memory store mirroring the Postgres store's semantics. Used by the
 * test suite (so tests don't have to mock `db.execute`) and by anyone
 * who explicitly wants per-process state — but the production default
 * is the Postgres-backed store above.
 */
export function createInMemoryOAuthStateStore(): OAuthStateStore {
  interface Entry {
    provider: string;
    expiresAtMs: number;
  }
  const map = new Map<string, Entry>();

  return {
    async create(provider: string, state: string, expiresAt: Date): Promise<void> {
      map.set(state, { provider, expiresAtMs: expiresAt.getTime() });
    },
    async consume(provider: string, state: string, nowMs: number): Promise<boolean> {
      const entry = map.get(state);
      if (!entry) return false;
      if (entry.provider !== provider) return false;
      // One-time-use: delete the entry whether or not it has expired,
      // mirroring the Postgres DELETE ... RETURNING semantics.
      map.delete(state);
      if (entry.expiresAtMs <= nowMs) return false;
      return true;
    },
    async reset(): Promise<void> {
      map.clear();
    },
    async size(): Promise<number> {
      return map.size;
    },
  };
}

const defaultStore: OAuthStateStore = new PostgresOAuthStateStore();
let activeStore: OAuthStateStore = defaultStore;

export async function createOAuthState(
  provider: string,
  ttlMs: number = STATE_TTL_MS,
): Promise<string> {
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMs);
  await activeStore.create(provider, state, expiresAt);
  return state;
}

export async function consumeOAuthState(
  provider: string,
  state: string,
): Promise<boolean> {
  if (!state || typeof state !== "string") return false;
  return activeStore.consume(provider, state, Date.now());
}

/**
 * Periodic best-effort sweep to keep the table from growing
 * unboundedly. The atomic consume already filters on `expires_at`, so
 * abandoned-but-not-yet-consumed states sit harmlessly in the table —
 * this just trims them after the TTL has passed. Failures are logged
 * but never thrown so a transient DB hiccup can't crash the process.
 */
async function sweepExpired(): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM oauth_state WHERE expires_at <= now()`);
  } catch {
    // Intentionally swallowed — the active consume path is what
    // actually enforces correctness; this is just a janitor.
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function startSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweepExpired, CLEANUP_INTERVAL_MS);
  // .unref() prevents the timer from holding the process alive in
  // tests / one-shot scripts, mirroring the previous behavior.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}
// Only start the sweeper outside the test runner so unit tests don't
// observe stray DELETE traffic against a mocked db.
if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  startSweepTimer();
}

/**
 * Test-only seam. Pass an in-memory store to opt out of Postgres for
 * the duration of a test; pass `null` to restore the default
 * Postgres-backed store. Mirrors `__setRateLimitStoreForTests` in
 * `server/utils/rateLimitStore.ts`.
 */
export function __setOAuthStateStoreForTests(
  store: OAuthStateStore | null,
): void {
  activeStore = store ?? defaultStore;
}

/**
 * Test-only — clears whichever store is currently active. Kept under
 * the legacy name (`_testClearOAuthStateStore`) so existing tests can
 * keep importing it. The async return type is new — old call sites
 * that ignored the void return continue to work.
 */
export async function _testClearOAuthStateStore(): Promise<void> {
  await activeStore.reset();
}

/**
 * Test-only — entry count of whichever store is currently active.
 * Kept under the legacy name so existing tests keep working.
 */
export async function _testOAuthStateStoreSize(): Promise<number> {
  return activeStore.size();
}
