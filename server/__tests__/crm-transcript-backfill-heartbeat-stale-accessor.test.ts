/**
 * Task #1131 — verify the heartbeat-staleness window is read through a
 * single accessor that supports runtime overrides without re-importing the
 * module or monkey-patching internals. Previously every worker site
 * referenced a module-level `const` captured at import time, which meant
 * tests could not exercise alternate windows without `vi.resetModules()`
 * gymnastics. The new accessor (`getBackfillHeartbeatStaleMs`) plus the
 * test-only override (`__setBackfillHeartbeatStaleMsForTests`) is what
 * unblocks future per-org tuning and hot-reload work called out in the
 * task description, so this test pins the contract.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  getBackfillHeartbeatStaleMs,
  __setBackfillHeartbeatStaleMsForTests,
} from "../crmCallsRoutes";

afterEach(() => {
  __setBackfillHeartbeatStaleMsForTests(null);
});

describe("getBackfillHeartbeatStaleMs accessor (Task #1131)", () => {
  it("returns a positive number resolved from the env at module load", () => {
    const value = getBackfillHeartbeatStaleMs();
    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThan(0);
  });

  it("reflects test overrides applied at runtime without re-importing", () => {
    const original = getBackfillHeartbeatStaleMs();
    const override = 90 * 1000;
    expect(override).not.toBe(original);

    __setBackfillHeartbeatStaleMsForTests(override);
    expect(getBackfillHeartbeatStaleMs()).toBe(override);

    __setBackfillHeartbeatStaleMsForTests(null);
    expect(getBackfillHeartbeatStaleMs()).toBe(original);
  });
});
