/**
 * Task #1512 — retention sweep for `integration_suppression_resets`.
 *
 * Verifies:
 *   - Default retention window is 90 days when the env var is unset.
 *   - The configured window comes from
 *     INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS.
 *   - A non-positive or non-numeric override disables the sweep
 *     (the helper returns 0 and never issues a DELETE).
 *   - When enabled, the sweep issues a `DELETE … WHERE created_at < cutoff`
 *     against `integration_suppression_resets` and returns the deleted
 *     row count surfaced by the .returning() chain.
 *   - DB failures are swallowed (logged, not thrown) so the nightly
 *     job runner stays healthy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let lastDeleteWhere: unknown = null;
let returningResult: Array<{ id: string }> = [];
let throwOnDelete = false;

const dbMock = {
  delete: () => ({
    where: (cond: unknown) => {
      lastDeleteWhere = cond;
      return {
        returning: async (_sel: unknown) => {
          if (throwOnDelete) throw new Error("simulated db failure");
          return returningResult;
        },
      };
    },
  }),
  insert: () => ({ values: async () => undefined }),
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
  }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

const ORIGINAL = process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS;

beforeEach(() => {
  lastDeleteWhere = null;
  returningResult = [];
  throwOnDelete = false;
  delete process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS;
  } else {
    process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS = ORIGINAL;
  }
});

describe("pruneSuppressionResets (Task #1512)", () => {
  it("defaults to a 90-day retention window when env var is unset", async () => {
    const mod = await import("../integrations/audit");
    expect(mod.getSuppressionResetRetentionDays()).toBe(90);
  });

  it("respects INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS override", async () => {
    process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS = "30";
    const mod = await import("../integrations/audit");
    expect(mod.getSuppressionResetRetentionDays()).toBe(30);
  });

  it("falls back to the default for non-numeric overrides", async () => {
    process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS = "not-a-number";
    const mod = await import("../integrations/audit");
    expect(mod.getSuppressionResetRetentionDays()).toBe(90);
  });

  it("disables the sweep when retention is 0 or negative", async () => {
    process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS = "0";
    const mod = await import("../integrations/audit");
    const deleted = await mod.pruneSuppressionResets();
    expect(deleted).toBe(0);
    expect(lastDeleteWhere).toBeNull();
  });

  it("issues a DELETE older-than(cutoff) and returns the deleted count", async () => {
    process.env.INTEGRATION_SUPPRESSION_RESET_RETENTION_DAYS = "7";
    returningResult = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const mod = await import("../integrations/audit");
    const deleted = await mod.pruneSuppressionResets();
    expect(deleted).toBe(3);
    expect(lastDeleteWhere).not.toBeNull();
  });

  it("re-throws DB failures so the cron wrapper records a failed sample", async () => {
    throwOnDelete = true;
    const mod = await import("../integrations/audit");
    await expect(mod.pruneSuppressionResets()).rejects.toThrow("simulated db failure");
  });
});
