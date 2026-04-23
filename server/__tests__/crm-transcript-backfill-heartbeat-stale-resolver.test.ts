/**
 * Task #1084 — unit coverage for `resolveBackfillHeartbeatStaleMs` (added
 * by Task #1078). The resolver reads `CRM_BACKFILL_HEARTBEAT_STALE_SECONDS`
 * and clamps it to [30s, 60min] with a 5-minute fallback. The bounds matter
 * because the value drives both the worker's reaping decision and the
 * cross-org Cancel hint copy on the admin page; a regression that dropped
 * the clamp would let ops accidentally disable reaping or race the
 * heartbeat cadence.
 *
 * Task #1126 — extended to assert that bad input also produces a startup
 * warning. A clean unset env var must stay silent (treated as "ops did not
 * opt in" — not worth a log line); set-but-broken values must warn so ops
 * notice misconfigurations the moment the process boots.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
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

describe("resolveBackfillHeartbeatStaleMs startup warnings (Task #1126)", () => {
  it("stays silent when the env var is unset", () => {
    delete process.env[ENV_KEY];
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(DEFAULT_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the env var is blank/whitespace", () => {
    process.env[ENV_KEY] = "   ";
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(DEFAULT_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent for valid in-range input", () => {
    process.env[ENV_KEY] = "600";
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(10 * 60 * 1000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and falls back on non-numeric input, naming the bad value and the default", () => {
    process.env[ENV_KEY] = "not-a-number";
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(DEFAULT_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, context] = warn.mock.calls[0];
    expect(message).toMatch(/CRM_BACKFILL_HEARTBEAT_STALE_SECONDS/);
    expect(message).toMatch(/invalid/i);
    expect(context).toMatchObject({
      rawValue: "not-a-number",
      defaultMs: DEFAULT_MS,
    });
  });

  it("warns and falls back on zero/negative input", () => {
    process.env[ENV_KEY] = "-5";
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(DEFAULT_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ rawValue: "-5" });
  });

  it("warns and clamps when below the minimum, naming requested vs clamped", () => {
    process.env[ENV_KEY] = "5";
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(MIN_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, context] = warn.mock.calls[0];
    expect(message).toMatch(/below minimum|clamp/i);
    expect(context).toMatchObject({
      rawValue: "5",
      requestedMs: 5_000,
      clampedMs: MIN_MS,
    });
  });

  it("warns and clamps when above the maximum, naming requested vs clamped", () => {
    process.env[ENV_KEY] = "7200"; // 2 hours
    const warn = vi.fn();
    expect(resolveBackfillHeartbeatStaleMs(warn)).toBe(MAX_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, context] = warn.mock.calls[0];
    expect(message).toMatch(/above maximum|clamp/i);
    expect(context).toMatchObject({
      rawValue: "7200",
      requestedMs: 7_200_000,
      clampedMs: MAX_MS,
    });
  });
});
