/**
 * Task #1084 — unit coverage for `resolveBackfillHeartbeatStaleMs` (added
 * by Task #1078). The resolver reads `CRM_BACKFILL_HEARTBEAT_STALE_SECONDS`
 * and clamps it to [30s, 60min] with a 5-minute fallback. The bounds matter
 * because the value drives both the worker's reaping decision and the
 * cross-org Cancel hint copy on the admin page; a regression that dropped
 * the clamp would let ops accidentally disable reaping or race the
 * heartbeat cadence.
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveBackfillHeartbeatStaleMs } from "../crmCallsRoutes";

const ENV_KEY = "CRM_BACKFILL_HEARTBEAT_STALE_SECONDS";
const DEFAULT_MS = 5 * 60 * 1000;
const MIN_MS = 30 * 1000;
const MAX_MS = 60 * 60 * 1000;

const originalEnv = process.env[ENV_KEY];

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
});

describe("resolveBackfillHeartbeatStaleMs (Task #1078 / #1084)", () => {
  it("falls back to 5 minutes when the env var is unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveBackfillHeartbeatStaleMs()).toBe(DEFAULT_MS);
  });

  it("falls back to 5 minutes when the env var is empty/whitespace", () => {
    process.env[ENV_KEY] = "   ";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(DEFAULT_MS);
  });

  it("falls back to 5 minutes on non-numeric input", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(DEFAULT_MS);
  });

  it("falls back to 5 minutes on zero/negative input", () => {
    process.env[ENV_KEY] = "0";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(DEFAULT_MS);
    process.env[ENV_KEY] = "-30";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(DEFAULT_MS);
  });

  it("clamps values below the 30-second minimum", () => {
    process.env[ENV_KEY] = "5"; // 5 seconds
    expect(resolveBackfillHeartbeatStaleMs()).toBe(MIN_MS);
    process.env[ENV_KEY] = "29";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(MIN_MS);
  });

  it("clamps values above the 60-minute maximum", () => {
    process.env[ENV_KEY] = "3601"; // 1s past the 60-minute ceiling
    expect(resolveBackfillHeartbeatStaleMs()).toBe(MAX_MS);
    process.env[ENV_KEY] = "999999";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(MAX_MS);
  });

  it("returns the parsed value (in ms) for valid in-range input", () => {
    process.env[ENV_KEY] = "30";
    expect(resolveBackfillHeartbeatStaleMs()).toBe(30 * 1000);
    process.env[ENV_KEY] = "600"; // 10 minutes — the canonical "ops-tuned" value
    expect(resolveBackfillHeartbeatStaleMs()).toBe(10 * 60 * 1000);
    process.env[ENV_KEY] = "3600"; // exactly 60 minutes (max boundary)
    expect(resolveBackfillHeartbeatStaleMs()).toBe(MAX_MS);
    process.env[ENV_KEY] = "  90  "; // trims whitespace
    expect(resolveBackfillHeartbeatStaleMs()).toBe(90 * 1000);
  });
});
