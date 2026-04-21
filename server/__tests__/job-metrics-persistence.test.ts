/**
 * Task #705: regression tests for the persisted job metrics layer.
 *
 * The in-memory surface in `jobMetrics.ts` now mirrors writes to the
 * `job_metric_samples` table and hydrates from it at startup so trend
 * data survives server restarts. We mock the db module so these tests
 * stay hermetic while still exercising the real persist/hydrate code
 * paths end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type Row = { job: string; recordedAt: Date; counters: Record<string, number> };

interface InsertChain {
  values: (row: Row) => Promise<void>;
}

interface DbMock {
  insert: () => InsertChain;
  select: () => Record<string, unknown>;
  delete: () => { where: (cond: unknown) => { returning: (cols: unknown) => Promise<Array<{ id: string }>> } };
}

const inserted: Row[] = [];
let selectRows: Row[] = [];
let lastDeleteCutoff: Date | null = null;
let lastDeleteJob: string | null = null;

const defaultInsert = (): InsertChain => ({
  values: async (row: Row) => {
    inserted.push({
      job: row.job,
      recordedAt: row.recordedAt,
      counters: { ...row.counters },
    });
  },
});

const dbMock: DbMock = {
  insert: () => defaultInsert(),
  select: () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => Promise.resolve(selectRows);
    return chain;
  },
  delete: () => {
    const applyPrune = () => {
      const before = selectRows.length;
      if (lastDeleteCutoff) {
        selectRows = selectRows.filter((r) => r.recordedAt >= lastDeleteCutoff!);
      }
      return before - selectRows.length;
    };
    const whereChain = {
      // Drizzle's `.delete().where(...).returning(...)` path used by
      // pruneJobMetricsDb returns the deleted rows; we mimic that by
      // returning a synthetic id row per pruned record.
      returning: async (_cols: unknown) => {
        const removed = lastDeleteJob
          ? (() => {
              const before = selectRows.length;
              selectRows = selectRows.filter((r) => r.job !== lastDeleteJob);
              return before - selectRows.length;
            })()
          : applyPrune();
        return Array.from({ length: removed }, (_, i) => ({ id: `deleted-${i}` }));
      },
    };
    return {
      where: (_cond: unknown) => whereChain,
      // Drizzle's `.delete().returning(...)` (no where) path used by
      // clearJobMetrics() to wipe every persisted sample.
      returning: async (_cols: unknown) => {
        const removed = selectRows.length;
        selectRows = [];
        return Array.from({ length: removed }, (_, i) => ({ id: `wiped-${i}` }));
      },
    };
  },
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

let mod: typeof import("../utils/jobMetrics");

beforeEach(async () => {
  inserted.length = 0;
  selectRows = [];
  lastDeleteCutoff = null;
  lastDeleteJob = null;
  mod = await import("../utils/jobMetrics");
  mod.setJobMetricsPersistenceEnabled(true);
  mod.resetJobMetrics();
});

afterEach(() => {
  vi.useRealTimers();
  mod.resetJobMetrics();
  mod.setJobMetricsPersistenceEnabled(true);
});

describe("jobMetrics persistence (Task #705)", () => {
  it("writes each recorded sample to the job_metric_samples table", async () => {
    mod.recordJobMetrics("crm_birthday_digest", { digestsSent: 4, skippedDedupe: 1 });
    mod.recordJobMetrics("crm_birthday_digest", { digestsSent: 0, skippedDedupe: 0 });

    // Persistence is fire-and-forget — let the microtask queue drain.
    await new Promise((r) => setImmediate(r));

    expect(inserted).toHaveLength(2);
    expect(inserted[0].job).toBe("crm_birthday_digest");
    expect(inserted[0].counters).toEqual({ digestsSent: 4, skippedDedupe: 1 });
    expect(inserted[1].counters).toEqual({ digestsSent: 0, skippedDedupe: 0 });
  });

  it("hydrates the in-memory window from persisted samples on startup", async () => {
    const now = Date.now();
    selectRows = [
      { job: "crm_birthday_digest", recordedAt: new Date(now - 60_000), counters: { digestsSent: 2 } },
      { job: "crm_birthday_digest", recordedAt: new Date(now - 30_000), counters: { digestsSent: 5 } },
      { job: "outbox", recordedAt: new Date(now - 10_000), counters: { processed: 7 } },
    ];

    const loaded = await mod.loadJobMetricsFromDb();
    expect(loaded).toBe(3);

    const digest = mod.getJobMetrics("crm_birthday_digest");
    expect(digest.samples).toHaveLength(2);
    expect(digest.totals.digestsSent).toBe(7);
    expect(digest.latest?.counters.digestsSent).toBe(5);

    const all = mod.getAllJobMetrics().map((j) => j.job).sort();
    expect(all).toEqual(["crm_birthday_digest", "outbox"]);
  });

  it("ignores hydration rows older than the 24h retention window", async () => {
    // loadJobMetricsFromDb passes a cutoff of (now - 24h) into the query;
    // the in-memory pruner additionally drops any leaked stale rows, so
    // even if the DB returned an over-broad result set we'd stay within
    // the window. Simulate that by seeding one stale row.
    const now = Date.now();
    selectRows = [
      { job: "crm_birthday_digest", recordedAt: new Date(now - 30 * 60 * 60 * 1000), counters: { digestsSent: 99 } },
      { job: "crm_birthday_digest", recordedAt: new Date(now - 60_000), counters: { digestsSent: 1 } },
    ];

    await mod.loadJobMetricsFromDb();
    const digest = mod.getJobMetrics("crm_birthday_digest");
    expect(digest.totals.digestsSent).toBe(1);
    expect(digest.samples).toHaveLength(1);
  });

  it("pruneJobMetricsDb deletes stale persisted samples", async () => {
    const now = Date.now();
    selectRows = [
      { job: "j", recordedAt: new Date(now - 26 * 60 * 60 * 1000), counters: { n: 1 } },
      { job: "j", recordedAt: new Date(now - 60_000), counters: { n: 2 } },
    ];
    lastDeleteCutoff = new Date(now - 24 * 60 * 60 * 1000);

    const deleted = await mod.pruneJobMetricsDb();
    expect(deleted).toBe(1);
    expect(selectRows).toHaveLength(1);
    expect(selectRows[0].counters.n).toBe(2);
  });

  it("does not throw when the DB write fails — record still succeeds in-memory", async () => {
    // Force the next insert to throw by swapping in a failing chain.
    const original = dbMock.insert;
    dbMock.insert = (): InsertChain => ({
      values: async () => {
        throw new Error("simulated DB outage");
      },
    });

    try {
      const sample = mod.recordJobMetrics("crm_birthday_digest", { digestsSent: 9 });
      expect(sample.counters.digestsSent).toBe(9);
      // Drain the fire-and-forget promise so the rejection is observed
      // by the catch block instead of bubbling up as an unhandled error.
      await new Promise((r) => setImmediate(r));

      const result = mod.getJobMetrics("crm_birthday_digest");
      expect(result.totals.digestsSent).toBe(9);
    } finally {
      dbMock.insert = original;
    }
  });

  it("clearJobMetrics() wipes all in-memory and persisted samples", async () => {
    const now = Date.now();
    selectRows = [
      { job: "a", recordedAt: new Date(now - 60_000), counters: { n: 1 } },
      { job: "b", recordedAt: new Date(now - 30_000), counters: { n: 2 } },
    ];
    await mod.loadJobMetricsFromDb();
    expect(mod.getAllJobMetrics()).toHaveLength(2);

    const deleted = await mod.clearJobMetrics();
    expect(deleted).toBe(2);
    expect(selectRows).toHaveLength(0);
    expect(mod.getAllJobMetrics()).toHaveLength(0);
  });

  it("clearJobMetrics(job) only clears the named job", async () => {
    const now = Date.now();
    selectRows = [
      { job: "a", recordedAt: new Date(now - 60_000), counters: { n: 1 } },
      { job: "a", recordedAt: new Date(now - 30_000), counters: { n: 3 } },
      { job: "b", recordedAt: new Date(now - 10_000), counters: { n: 2 } },
    ];
    await mod.loadJobMetricsFromDb();
    lastDeleteJob = "a";

    const deleted = await mod.clearJobMetrics("a");
    expect(deleted).toBe(2);
    expect(selectRows.map((r) => r.job)).toEqual(["b"]);

    const all = mod.getAllJobMetrics().map((j) => j.job);
    expect(all).toEqual(["b"]);
  });

  it("clearJobMetrics() still wipes memory when persistence is disabled", async () => {
    mod.setJobMetricsPersistenceEnabled(false);
    mod.recordJobMetrics("a", { n: 1 });
    expect(mod.getAllJobMetrics()).toHaveLength(1);

    const deleted = await mod.clearJobMetrics();
    expect(deleted).toBe(0);
    expect(mod.getAllJobMetrics()).toHaveLength(0);
  });

  it("persistence can be disabled (test helper short-circuits DB writes)", async () => {
    mod.setJobMetricsPersistenceEnabled(false);
    mod.recordJobMetrics("crm_birthday_digest", { digestsSent: 1 });
    await new Promise((r) => setImmediate(r));
    expect(inserted).toHaveLength(0);

    const loaded = await mod.loadJobMetricsFromDb();
    expect(loaded).toBe(0);

    const pruned = await mod.pruneJobMetricsDb();
    expect(pruned).toBe(0);
  });
});
