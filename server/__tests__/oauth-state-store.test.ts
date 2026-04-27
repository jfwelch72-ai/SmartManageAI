import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createOAuthState,
  consumeOAuthState,
  _testClearOAuthStateStore,
  _testOAuthStateStoreSize,
} from "../oauthStateStore";

describe("oauthStateStore", () => {
  beforeEach(() => {
    _testClearOAuthStateStore();
    vi.useRealTimers();
  });

  it("issues a unique high-entropy state value", () => {
    const a = createOAuthState("apple");
    const b = createOAuthState("apple");
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validates a freshly issued state once and only once", () => {
    const state = createOAuthState("apple");
    expect(consumeOAuthState("apple", state)).toBe(true);
    // Replay must not be accepted.
    expect(consumeOAuthState("apple", state)).toBe(false);
  });

  it("rejects unknown state values", () => {
    expect(consumeOAuthState("apple", "deadbeef")).toBe(false);
    expect(consumeOAuthState("apple", "")).toBe(false);
  });

  it("isolates state values by provider", () => {
    const state = createOAuthState("apple");
    expect(consumeOAuthState("google", state)).toBe(false);
    // Original lookup should still succeed because the wrong-provider call
    // is a no-op for the apple-namespaced key.
    expect(consumeOAuthState("apple", state)).toBe(true);
  });

  it("expires state after the configured TTL", () => {
    vi.useFakeTimers();
    const state = createOAuthState("apple", 1000);
    vi.advanceTimersByTime(1500);
    expect(consumeOAuthState("apple", state)).toBe(false);
  });

  it("removes the entry on consumption (no leak)", () => {
    const state = createOAuthState("apple");
    expect(_testOAuthStateStoreSize()).toBe(1);
    consumeOAuthState("apple", state);
    expect(_testOAuthStateStoreSize()).toBe(0);
  });
});
