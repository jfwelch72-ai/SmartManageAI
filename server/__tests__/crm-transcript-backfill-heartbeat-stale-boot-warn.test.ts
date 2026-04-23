/**
 * Task #1130 — pin that the heartbeat staleness resolver emits a one-shot
 * boot-time WARN log when the operator's CRM_BACKFILL_HEARTBEAT_STALE_SECONDS
 * value was either invalid (non-numeric / non-positive) or had to be clamped
 * to the [30s, 60min] band. Silent fallbacks (env unset entirely) must stay
 * quiet so production logs aren't noisy on the happy path.
 *
 * The WARN runs at module init (alongside `BACKFILL_HEARTBEAT_STALE_MS`),
 * so each scenario uses `vi.resetModules()` + `vi.doMock(...)` to spy on
 * `logWarn` *before* re-importing `crmCallsRoutes`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEY = "CRM_BACKFILL_HEARTBEAT_STALE_SECONDS";
const originalEnv = process.env[ENV_KEY];

const logWarnSpy = vi.fn();
const logInfoSpy = vi.fn();
const logErrorSpy = vi.fn();
const logDebugSpy = vi.fn();

beforeEach(() => {
  logWarnSpy.mockReset();
  logInfoSpy.mockReset();
  logErrorSpy.mockReset();
  logDebugSpy.mockReset();
  vi.resetModules();
  vi.doMock("../utils/logger", () => ({
    logWarn: logWarnSpy,
    logInfo: logInfoSpy,
    logError: logErrorSpy,
    logDebug: logDebugSpy,
    createLogger: () => ({
      debug: logDebugSpy,
      info: logInfoSpy,
      warn: logWarnSpy,
      error: logErrorSpy,
    }),
    generateCorrelationId: () => "test-corr-id",
  }));
});

afterEach(() => {
  vi.doUnmock("../utils/logger");
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
});

function clampWarnCalls(): unknown[][] {
  // Only the heartbeat-staleness resolver currently emits a logWarn at module
  // load (other warns are inside request handlers), so this filter is
  // defensive against a future co-import that adds a sibling boot-time warn
  // — we only assert on the messages we own.
  return logWarnSpy.mock.calls.filter((call) => {
    const msg = String(call[0] ?? "");
    return msg.includes("CRM_BACKFILL_HEARTBEAT_STALE_SECONDS");
  });
}

// Re-importing crmCallsRoutes after vi.resetModules() recompiles a large
// surface (drizzle, Twilio SDK, etc.), so each test can spend several
// seconds on the cold import. Bump the per-test timeout so the suite is
// stable in CI without inflating the global default. These tests must
// stay sequential — they share `process.env`.
describe("CRM_BACKFILL_HEARTBEAT_STALE_SECONDS boot-time WARN (Task #1130)", { timeout: 30_000 }, () => {
  it("does NOT warn when the env var is unset (silent default is intentional)", async () => {
    delete process.env[ENV_KEY];
    await import("../crmCallsRoutes");
    expect(clampWarnCalls()).toEqual([]);
  });

  it("does NOT warn when the env var is empty/whitespace (treated as unset)", async () => {
    // Task #1130 — secret managers and docker-compose ${VAR:-} patterns
    // commonly materialize unset env vars as "" / "   ". Warning on those
    // would generate false-positive boot noise on every deploy that
    // hasn't explicitly opted in to a custom heartbeat window.
    process.env[ENV_KEY] = "   ";
    await import("../crmCallsRoutes");
    expect(clampWarnCalls()).toEqual([]);
  });

  it("warns once with requested raw + effective ms when input is invalid", async () => {
    process.env[ENV_KEY] = "not-a-number";
    await import("../crmCallsRoutes");
    const calls = clampWarnCalls();
    expect(calls.length).toBe(1);
    const [message, ctx] = calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/invalid/i);
    expect(ctx).toMatchObject({
      requestedRaw: "not-a-number",
      effectiveMs: 5 * 60 * 1000,
      defaultMs: 5 * 60 * 1000,
    });
  });

  it("warns once with requested + effective ms when input is clamped below the floor", async () => {
    process.env[ENV_KEY] = "20"; // ops set 20 expecting 20s — gets floored to 30s
    await import("../crmCallsRoutes");
    const calls = clampWarnCalls();
    expect(calls.length).toBe(1);
    const [message, ctx] = calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/clamped/i);
    expect(ctx).toMatchObject({
      requestedRaw: "20",
      requestedMs: 20 * 1000,
      effectiveMs: 30 * 1000,
      minMs: 30 * 1000,
      maxMs: 60 * 60 * 1000,
    });
  });

  it("warns once with requested + effective ms when input is clamped above the ceiling", async () => {
    process.env[ENV_KEY] = "7200"; // ops set 7200 expecting 2h — gets capped to 60min
    await import("../crmCallsRoutes");
    const calls = clampWarnCalls();
    expect(calls.length).toBe(1);
    const [message, ctx] = calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/clamped/i);
    expect(ctx).toMatchObject({
      requestedRaw: "7200",
      requestedMs: 7200 * 1000,
      effectiveMs: 60 * 60 * 1000,
    });
  });

  it("does NOT warn when the env value parses cleanly inside the band", async () => {
    process.env[ENV_KEY] = "600"; // 10 minutes — the canonical ops-tuned value
    await import("../crmCallsRoutes");
    expect(clampWarnCalls()).toEqual([]);
  });
});
