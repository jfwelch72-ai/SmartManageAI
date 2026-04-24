/**
 * Task #1665 — nightly retention sweep for
 * `project_log_email_schedule_attempts`.
 *
 * Verifies:
 *   - Default retention window is 90 days when the env var is unset.
 *   - The configured window comes from
 *     PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS.
 *   - A non-numeric override falls back to the default (matches the
 *     `pruneSuppressionResets` precedent so an operator typo can't
 *     accidentally pause the sweep).
 *   - A non-positive (<= 0) override disables the sweep (the helper
 *     returns 0 and never issues a SELECT/DELETE).
 *   - When enabled, the sweep selects ids older than (now - days) and
 *     issues a DELETE WHERE id IN (...) per batch.
 *   - The sweep loops in batches: it keeps draining while each SELECT
 *     returns a full batch, and short-circuits as soon as a SELECT
 *     returns fewer rows than the batch size.
 *   - The sweep stops at the configured max-batches ceiling and flags
 *     the run with `cappedAtMaxBatches` so operators can spot the
 *     backlog.
 *   - DB failures are re-thrown so the cron wrapper records a failed
 *     sample for the prune job.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let selectCalls = 0;
let deleteCalls = 0;
let lastDeleteWhere: unknown = null;
let lastSelectLimit: number | null = null;
// Sequence of "what the next SELECT should return". Defaults to one
// empty batch (no work to do) when the test doesn't override it.
let selectBatches: Array<Array<{ id: string }>> = [];
let throwOnSelect = false;
let throwOnDelete = false;

const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async (n: number) => {
            selectCalls += 1;
            lastSelectLimit = n;
            if (throwOnSelect) throw new Error("simulated select failure");
            const next = selectBatches.shift();
            return next ?? [];
          },
        }),
      }),
    }),
  }),
  delete: () => ({
    where: (cond: unknown) => {
      lastDeleteWhere = cond;
      return {
        returning: async (_sel: unknown) => {
          deleteCalls += 1;
          if (throwOnDelete) throw new Error("simulated delete failure");
          // Echo back rows matching the `inArray(... ids)` predicate
          // — easiest stand-in is "however many ids were just queued
          // for deletion" by returning the most recent select batch.
          const last = (cond as any)?.__ids ?? [];
          return last.map((id: string) => ({ id }));
        },
      };
    },
  }),
  insert: () => ({ values: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

// `inArray(col, ids)` returns an opaque object — capture the ids list
// onto it so the delete().returning() above can synthesise a realistic
// returning() count.
vi.mock("drizzle-orm", async () => {
  const actual: any = await vi.importActual("drizzle-orm");
  return {
    ...actual,
    inArray: (col: unknown, ids: unknown[]) => ({ __kind: "inArray", col, __ids: ids }),
    lt: (col: unknown, val: unknown) => ({ __kind: "lt", col, val }),
    asc: (col: unknown) => ({ __kind: "asc", col }),
  };
});

const ORIGINAL = process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS;

beforeEach(() => {
  selectCalls = 0;
  deleteCalls = 0;
  lastDeleteWhere = null;
  lastSelectLimit = null;
  selectBatches = [];
  throwOnSelect = false;
  throwOnDelete = false;
  delete process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS;
  } else {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = ORIGINAL;
  }
});

describe("pruneProjectLogEmailScheduleAttempts (Task #1665)", () => {
  it("defaults to a 90-day retention window when the env var is unset", async () => {
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    expect(mod.getProjectLogEmailAttemptRetentionDays()).toBe(90);
    expect(mod.PROJECT_LOG_EMAIL_ATTEMPT_DEFAULT_RETENTION_DAYS).toBe(90);
  });

  it("respects PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS override", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "30";
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    expect(mod.getProjectLogEmailAttemptRetentionDays()).toBe(30);
  });

  it("falls back to the default for non-numeric overrides", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "not-a-number";
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    expect(mod.getProjectLogEmailAttemptRetentionDays()).toBe(90);
  });

  it("disables the sweep when retention is 0 or negative", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "0";
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    const result = await mod.pruneProjectLogEmailScheduleAttempts();
    expect(result).toEqual({ deleted: 0, batches: 0, cappedAtMaxBatches: false });
    expect(selectCalls).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it("returns zero and stops after a single empty SELECT when no rows are stale", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "7";
    selectBatches = [[]];
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    const result = await mod.pruneProjectLogEmailScheduleAttempts();
    expect(result).toEqual({ deleted: 0, batches: 0, cappedAtMaxBatches: false });
    expect(selectCalls).toBe(1);
    expect(deleteCalls).toBe(0);
  });

  it("deletes a single partial batch and stops without re-querying", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "7";
    selectBatches = [[{ id: "a" }, { id: "b" }, { id: "c" }]];
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    const result = await mod.pruneProjectLogEmailScheduleAttempts();
    expect(result.deleted).toBe(3);
    expect(result.batches).toBe(1);
    expect(result.cappedAtMaxBatches).toBe(false);
    expect(selectCalls).toBe(1);
    expect(deleteCalls).toBe(1);
    expect(lastDeleteWhere).not.toBeNull();
  });

  it("loops while each SELECT returns a full batch, then stops on the first short batch", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "7";
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    const batchSize = mod.PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_BATCH_SIZE;
    const fullBatch1 = Array.from({ length: batchSize }, (_, i) => ({ id: `a-${i}` }));
    const fullBatch2 = Array.from({ length: batchSize }, (_, i) => ({ id: `b-${i}` }));
    const tail = [{ id: "tail-1" }, { id: "tail-2" }];
    selectBatches = [fullBatch1, fullBatch2, tail];

    const result = await mod.pruneProjectLogEmailScheduleAttempts();
    expect(result.deleted).toBe(batchSize * 2 + tail.length);
    expect(result.batches).toBe(3);
    expect(result.cappedAtMaxBatches).toBe(false);
    expect(selectCalls).toBe(3);
    expect(deleteCalls).toBe(3);
    expect(lastSelectLimit).toBe(batchSize);
  });

  it("stops at the max-batches ceiling and flags cappedAtMaxBatches", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "7";
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    const batchSize = mod.PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_BATCH_SIZE;
    const maxBatches = mod.PROJECT_LOG_EMAIL_ATTEMPT_PRUNE_MAX_BATCHES;
    // Always-full batches: synthesize an unbounded supplier by giving
    // the mock more full batches than the ceiling can consume.
    selectBatches = Array.from({ length: maxBatches + 5 }, () =>
      Array.from({ length: batchSize }, (_, i) => ({ id: `row-${i}` })),
    );

    const result = await mod.pruneProjectLogEmailScheduleAttempts();
    expect(result.batches).toBe(maxBatches);
    expect(result.deleted).toBe(maxBatches * batchSize);
    expect(result.cappedAtMaxBatches).toBe(true);
    expect(selectCalls).toBe(maxBatches);
    expect(deleteCalls).toBe(maxBatches);
  });

  it("re-throws SELECT failures so the cron wrapper records a failed sample", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "7";
    throwOnSelect = true;
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    await expect(mod.pruneProjectLogEmailScheduleAttempts()).rejects.toThrow(
      "simulated select failure",
    );
  });

  it("re-throws DELETE failures so the cron wrapper records a failed sample", async () => {
    process.env.PROJECT_LOG_EMAIL_ATTEMPT_RETENTION_DAYS = "7";
    selectBatches = [[{ id: "a" }, { id: "b" }]];
    throwOnDelete = true;
    const mod = await import("../jobs/projectLogEmailScheduleAttemptPrune");
    await expect(mod.pruneProjectLogEmailScheduleAttempts()).rejects.toThrow(
      "simulated delete failure",
    );
  });
});
