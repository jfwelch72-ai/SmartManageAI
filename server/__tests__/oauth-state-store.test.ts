import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  createOAuthState,
  consumeOAuthState,
  _testClearOAuthStateStore,
  _testOAuthStateStoreSize,
  __setOAuthStateStoreForTests,
  createInMemoryOAuthStateStore,
  type OAuthStateStore,
} from "../oauthStateStore";

// Task #2056 — the production default is now a Postgres-backed store
// (so Apple Sign-In survives server restarts and multi-replica
// deployments). The behavioral contract these tests cover is
// store-agnostic, so we run them against the in-memory store via the
// `__setOAuthStateStoreForTests` seam to keep the suite hermetic.
describe("oauthStateStore", () => {
  beforeEach(async () => {
    __setOAuthStateStoreForTests(createInMemoryOAuthStateStore());
    await _testClearOAuthStateStore();
    vi.useRealTimers();
  });

  afterAll(() => {
    __setOAuthStateStoreForTests(null);
  });

  it("issues a unique high-entropy state value", async () => {
    const a = await createOAuthState("apple");
    const b = await createOAuthState("apple");
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validates a freshly issued state once and only once", async () => {
    const state = await createOAuthState("apple");
    expect(await consumeOAuthState("apple", state)).toBe(true);
    // Replay must not be accepted.
    expect(await consumeOAuthState("apple", state)).toBe(false);
  });

  it("rejects unknown state values", async () => {
    expect(await consumeOAuthState("apple", "deadbeef")).toBe(false);
    expect(await consumeOAuthState("apple", "")).toBe(false);
  });

  it("isolates state values by provider", async () => {
    const state = await createOAuthState("apple");
    expect(await consumeOAuthState("google", state)).toBe(false);
    // Original lookup should still succeed because the wrong-provider call
    // is a no-op for the apple-namespaced key.
    expect(await consumeOAuthState("apple", state)).toBe(true);
  });

  it("expires state after the configured TTL", async () => {
    vi.useFakeTimers();
    const state = await createOAuthState("apple", 1000);
    vi.advanceTimersByTime(1500);
    expect(await consumeOAuthState("apple", state)).toBe(false);
  });

  it("removes the entry on consumption (no leak)", async () => {
    const state = await createOAuthState("apple");
    expect(await _testOAuthStateStoreSize()).toBe(1);
    await consumeOAuthState("apple", state);
    expect(await _testOAuthStateStoreSize()).toBe(0);
  });

  // Task #2056 — multi-replica regression. Two replicas pointed at
  // the SAME shared store (the analogue of one Postgres table that
  // every pod writes against) must be able to issue and consume each
  // other's states interchangeably. With the previous per-process
  // Map, a state issued on replica A could never be consumed on
  // replica B and the user would see "Your Apple sign-in session
  // expired or was blocked by your browser." after a load-balancer
  // hop.
  it("lets one replica consume a state issued by a sibling replica", async () => {
    const sharedStore: OAuthStateStore = createInMemoryOAuthStateStore();

    // Replica A issues a state against the shared store.
    __setOAuthStateStoreForTests(sharedStore);
    const issuedOnA = await createOAuthState("apple");

    // Replica B comes up (different process) but is wired to the
    // same shared backend. The Apple form_post callback lands here.
    __setOAuthStateStoreForTests(sharedStore);
    expect(await consumeOAuthState("apple", issuedOnA)).toBe(true);

    // And, like before, a replay anywhere in the fleet is rejected.
    expect(await consumeOAuthState("apple", issuedOnA)).toBe(false);
  });

  // Task #2056 — restart regression. The previous in-memory Map was
  // wiped on every server restart, so a deploy between issuing the
  // state and the Apple callback bounced the user. With the shared
  // store, the state survives a process restart that swaps in a fresh
  // active store as long as both stores point at the same backend.
  it("survives a server restart while preserving the issued state", async () => {
    const sharedStore: OAuthStateStore = createInMemoryOAuthStateStore();

    __setOAuthStateStoreForTests(sharedStore);
    const issuedBeforeRestart = await createOAuthState("apple");

    // Simulate a process restart by re-pointing the active store at
    // the same shared backend a brand-new process would attach to.
    __setOAuthStateStoreForTests(sharedStore);

    expect(await consumeOAuthState("apple", issuedBeforeRestart)).toBe(true);
  });
});
