import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { ensureOauthStateTable } from "../utils/ensureOauthStateTable";
import {
  createOAuthState,
  consumeOAuthState,
  __setOAuthStateStoreForTests,
} from "../oauthStateStore";

// Task #2056 — exercises the real Postgres-backed `oauth_state` store
// against the test database (the in-memory mirror is covered by the
// sibling `oauth-state-store.test.ts` suite). The two failure modes
// this task is fixing — server restart between issuing the state and
// the Apple callback, and a load-balanced hop to a sibling replica —
// both reduce to "any process attached to the same Postgres can
// consume any state issued against the same Postgres", which is what
// these tests pin down by talking to PG directly.

describe("oauthStateStore (Postgres)", () => {
  beforeAll(async () => {
    await ensureOauthStateTable();
    // Make every test in this file go through the production default
    // (Postgres) store, regardless of what other suites left wired up.
    __setOAuthStateStoreForTests(null);
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE oauth_state`);
  });

  afterAll(async () => {
    await db.execute(sql`TRUNCATE TABLE oauth_state`);
  });

  it("persists an issued state to oauth_state and lets consume read it back", async () => {
    const state = await createOAuthState("apple");

    const before = await db.execute<{ state: string; provider: string }>(
      sql`SELECT state, provider FROM oauth_state WHERE state = ${state}`,
    );
    const beforeRows = before.rows ?? [];
    expect(beforeRows).toHaveLength(1);
    expect(beforeRows[0].provider).toBe("apple");

    expect(await consumeOAuthState("apple", state)).toBe(true);

    // The atomic DELETE consume must remove the row so a replay can't
    // succeed and the table can't grow on every issued state.
    const after = await db.execute(
      sql`SELECT 1 FROM oauth_state WHERE state = ${state}`,
    );
    const afterRows = after.rows ?? [];
    expect(afterRows).toHaveLength(0);
  });

  it("survives a simulated server restart between issue and consume", async () => {
    // Process A issues the state, then dies before Apple POSTs the
    // callback — modeled by issuing the state and then doing nothing
    // else. With the previous in-memory Map the next test step would
    // fail; with the Postgres store the row is still in the DB.
    const state = await createOAuthState("apple");

    // Process B (or the same process after a restart) handles the
    // form_post callback. Nothing is in this process's memory yet,
    // but the row is in PG so the consume succeeds.
    expect(await consumeOAuthState("apple", state)).toBe(true);
  });

  it("lets two different connections consume each other's states (multi-replica)", async () => {
    // Replica A issues a state.
    const stateFromA = await createOAuthState("apple");
    // Replica B issues an unrelated state — both rows now coexist in PG.
    const stateFromB = await createOAuthState("apple");

    // The Apple form_post for replica A's state lands on replica B
    // and vice versa. Both consumes hit the same Postgres table and
    // therefore both succeed, which is the multi-replica fix this
    // task is delivering.
    expect(await consumeOAuthState("apple", stateFromA)).toBe(true);
    expect(await consumeOAuthState("apple", stateFromB)).toBe(true);
  });

  it("rejects a replayed state under concurrent consumes (one-time-use)", async () => {
    const state = await createOAuthState("apple");

    // Two callbacks racing on the same state — only one can win.
    const [first, second] = await Promise.all([
      consumeOAuthState("apple", state),
      consumeOAuthState("apple", state),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);

    // And any later attempt is also rejected.
    expect(await consumeOAuthState("apple", state)).toBe(false);
  });

  it("rejects a state whose expires_at has passed (TTL enforced in SQL)", async () => {
    const state = await createOAuthState("apple", 60_000);
    // Force the row to look expired without waiting in real time. The
    // consume's `expires_at > now()` filter is what should reject it.
    await db.execute(
      sql`UPDATE oauth_state SET expires_at = now() - interval '1 second' WHERE state = ${state}`,
    );
    expect(await consumeOAuthState("apple", state)).toBe(false);

    // Bonus check: an expired row that was never consumed is still
    // physically present until the periodic sweeper cleans it up; the
    // SQL filter alone is what makes the consume safe.
    const remaining = await db.execute(
      sql`SELECT 1 FROM oauth_state WHERE state = ${state}`,
    );
    expect((remaining.rows ?? []).length).toBe(1);
  });

  it("isolates state values by provider so an Apple state cannot be consumed as Google", async () => {
    const state = await createOAuthState("apple");
    expect(await consumeOAuthState("google", state)).toBe(false);
    // The Apple-namespaced consume still works — wrong-provider
    // attempts are no-ops, not destructive.
    expect(await consumeOAuthState("apple", state)).toBe(true);
  });
});
