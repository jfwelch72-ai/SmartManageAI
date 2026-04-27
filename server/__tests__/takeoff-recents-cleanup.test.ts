/**
 * Task #2105 — Auto-tidy stale Takeoff "Recent" entries when their
 * underlying bid or project is deleted.
 *
 * Hermetic: drives the small `pruneTakeoffRecentsForEntity` helper against
 * an in-process db mock so we can assert the WHERE predicate (kind +
 * entityId, across all users — no userId filter) without spinning up
 * Postgres.
 *
 * Task #2129 — Same db mock is reused to drive the
 * `pruneOrphanedTakeoffRecents` nightly safety-net helper. The mock
 * captures every DELETE so we can assert that the sweep issues two
 * passes (one per kind), each with a `NOT EXISTS` subquery against
 * the appropriate parent table, and that the per-kind / total counts
 * returned to the cron wrapper are sourced from the per-statement
 * `.returning({ id })` payloads (so the operations log line reflects
 * the real number of rows the DELETE removed).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { takeoffRecents } from "@shared/schema";

const pgDialect = new PgDialect();

interface CapturedDelete {
  table: string;
  predicate: unknown;
  predicateSql: string;
}

const deletes: CapturedDelete[] = [];
const errorLogs: Array<{ message: string; context?: Record<string, unknown>; error?: Error }> = [];
let nextDeleteShouldThrow = false;
// Task #2129 — successive .returning() payloads consumed in the order
// the per-kind DELETEs run inside `pruneOrphanedTakeoffRecents`.
let returningQueue: Array<Array<{ id: string }>> = [];

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

// Render the predicate tree to the SQL string drizzle would emit so
// we can assert that `pruneOrphanedTakeoffRecents` issues a
// `NOT EXISTS (SELECT 1 FROM "bids"|"projects" ...)` clause keyed off
// the right parent table. Uses the real PgDialect so the rendered SQL
// matches what production would actually send to Postgres.
function renderSql(node: unknown): string {
  try {
    return pgDialect.sqlToQuery(node as never).sql;
  } catch {
    return "";
  }
}

const dbMock = {
  delete: (t: unknown) => {
    const name = tableName(t);
    return {
      where: (predicate: unknown) => {
        const predicateSql = renderSql(predicate);
        const captured: CapturedDelete = { table: name, predicate, predicateSql };
        // Task #2105 path: callers `await` the .where(...) directly
        // without chaining .returning(), so the chain has to be
        // thenable to satisfy that signature.
        const thenable: PromiseLike<unknown> & {
          returning: (sel?: unknown) => Promise<Array<{ id: string }>>;
        } = {
          then: (resolve, reject) => {
            deletes.push(captured);
            if (nextDeleteShouldThrow) {
              nextDeleteShouldThrow = false;
              return Promise.reject(new Error("boom")).then(resolve as never, reject as never);
            }
            return Promise.resolve(undefined).then(resolve as never, reject as never);
          },
          // Task #2129 path: `pruneOrphanedTakeoffRecents` chains
          // `.returning({ id: takeoffRecents.id })` so the helper can
          // count exactly which rows were removed per pass.
          returning: async (_sel?: unknown) => {
            deletes.push(captured);
            if (nextDeleteShouldThrow) {
              nextDeleteShouldThrow = false;
              throw new Error("boom");
            }
            const next = returningQueue.shift();
            return next ?? [];
          },
        };
        return thenable;
      },
    };
  },
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn((message: string, context?: Record<string, unknown>, error?: Error) => {
    errorLogs.push({ message, context, error });
  }),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// Task #2156 — capture per-tick `recordJobMetrics` calls so we can
// assert the nightly sweep publishes a sample on every tick (including
// the "nothing to prune" path) for the operations dashboard.
const recordedMetrics: Array<{ job: string; counters: Record<string, number> }> = [];
vi.mock("../utils/jobMetrics", () => ({
  recordJobMetrics: vi.fn((job: string, counters: Record<string, number>) => {
    recordedMetrics.push({ job, counters: { ...counters } });
    return { timestamp: Date.now(), counters: { ...counters } };
  }),
  // Surface members consumed by `jobRunner.ts` so the
  // `jobRegistry` describe block below can still import the module
  // without ReferenceErrors after this file's mock takes over.
  loadJobMetricsFromDb: vi.fn(async () => 0),
  pruneJobMetricsDb: vi.fn(async () => 0),
}));

beforeEach(() => {
  deletes.length = 0;
  errorLogs.length = 0;
  nextDeleteShouldThrow = false;
  returningQueue = [];
  recordedMetrics.length = 0;
  vi.resetModules();
});

// Walks the drizzle SQL/condition tree and collects every literal
// param value the query carries. Used to assert that the WHERE clause
// references the expected (kind, entityId) values and — critically —
// does NOT include a userId so the prune fires across every user.
function collectParamValues(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined) return out;
  if (typeof node !== "object") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectParamValues(v, out);
    return out;
  }
  // drizzle's Param wraps the literal under `value`.
  const obj = node as Record<string, unknown>;
  if ("value" in obj && (typeof obj.value === "string" || typeof obj.value === "number")) {
    out.push(obj.value);
  }
  // Recurse common drizzle internal shapes.
  for (const key of ["queryChunks", "left", "right", "args", "conditions", "params"]) {
    if (key in obj) collectParamValues(obj[key], out);
  }
  return out;
}

// Walks the same tree but collects the column references the predicate
// touches. Used to confirm the WHERE clause filters by kind and
// entityId rather than (e.g.) userId.
function collectColumnNames(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) collectColumnNames(v, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.name === "string" && typeof obj.columnType === "string") {
    out.push(obj.name);
  }
  for (const key of ["queryChunks", "left", "right", "args", "conditions", "params"]) {
    if (key in obj) collectColumnNames(obj[key], out);
  }
  return out;
}

describe("pruneTakeoffRecentsForEntity", () => {
  it("issues a delete against takeoff_recents filtered by (kind, entityId) for a bid", async () => {
    const { pruneTakeoffRecentsForEntity } = await import("../takeoffRecentsCleanup");
    await pruneTakeoffRecentsForEntity("bid", "bid-uuid-1");

    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("takeoff_recents");

    const params = collectParamValues(deletes[0].predicate);
    expect(params).toContain("bid");
    expect(params).toContain("bid-uuid-1");

    const cols = collectColumnNames(deletes[0].predicate);
    expect(cols).toContain(takeoffRecents.kind.name);
    expect(cols).toContain(takeoffRecents.entityId.name);
    // No user filter — the prune must clean rows across all users so
    // every device's rail stops counting the dead entity against its cap.
    expect(cols).not.toContain(takeoffRecents.userId.name);
  });

  it("issues a delete against takeoff_recents filtered by (kind, entityId) for a project", async () => {
    const { pruneTakeoffRecentsForEntity } = await import("../takeoffRecentsCleanup");
    await pruneTakeoffRecentsForEntity("project", "proj-uuid-7");

    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("takeoff_recents");

    const params = collectParamValues(deletes[0].predicate);
    expect(params).toContain("project");
    expect(params).toContain("proj-uuid-7");

    const cols = collectColumnNames(deletes[0].predicate);
    expect(cols).toContain(takeoffRecents.kind.name);
    expect(cols).toContain(takeoffRecents.entityId.name);
    expect(cols).not.toContain(takeoffRecents.userId.name);
  });

  it("is a no-op for a missing entityId so callers can pass null/undefined safely", async () => {
    const { pruneTakeoffRecentsForEntity } = await import("../takeoffRecentsCleanup");
    await pruneTakeoffRecentsForEntity("bid", "");
    expect(deletes).toHaveLength(0);
  });

  it("swallows db errors and logs them — the parent delete should not be undone by a tidy failure", async () => {
    const { pruneTakeoffRecentsForEntity } = await import("../takeoffRecentsCleanup");
    nextDeleteShouldThrow = true;
    await expect(
      pruneTakeoffRecentsForEntity("project", "proj-uuid-explode"),
    ).resolves.toBeUndefined();
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].context).toMatchObject({
      kind: "project",
      entityId: "proj-uuid-explode",
    });
    expect(errorLogs[0].error).toBeInstanceOf(Error);
  });
});

describe("pruneOrphanedTakeoffRecents (Task #2129 nightly safety-net)", () => {
  it("issues one DELETE per kind, each scoping the NOT EXISTS subquery to the right parent table", async () => {
    const { pruneOrphanedTakeoffRecents } = await import("../takeoffRecentsCleanup");
    // Empty per-kind returning() payloads — we only care about the
    // shape of the issued statements in this assertion.
    returningQueue = [[], []];

    const result = await pruneOrphanedTakeoffRecents();

    // Two statements: one for kind='bid', one for kind='project'.
    expect(deletes).toHaveLength(2);
    expect(deletes[0].table).toBe("takeoff_recents");
    expect(deletes[1].table).toBe("takeoff_recents");

    const bidSql = deletes[0].predicateSql.toLowerCase();
    const bidParams = collectParamValues(deletes[0].predicate);
    expect(bidParams).toContain("bid");
    expect(bidSql).toContain("not exists");
    // The bid pass must subquery `bids`, not `projects` — otherwise a
    // bid-kind row would be deleted whenever any project disappeared.
    expect(bidSql).toContain('"bids"');
    expect(bidSql).not.toContain('"projects"');

    const projectSql = deletes[1].predicateSql.toLowerCase();
    const projectParams = collectParamValues(deletes[1].predicate);
    expect(projectParams).toContain("project");
    expect(projectSql).toContain("not exists");
    expect(projectSql).toContain('"projects"');
    expect(projectSql).not.toContain('"bids"');

    // No userId filter — the sweep must reclaim orphaned rows across
    // every user, mirroring `pruneTakeoffRecentsForEntity`.
    const bidCols = collectColumnNames(deletes[0].predicate);
    const projectCols = collectColumnNames(deletes[1].predicate);
    expect(bidCols).not.toContain(takeoffRecents.userId.name);
    expect(projectCols).not.toContain(takeoffRecents.userId.name);

    // Result counts collapse to zero when nothing is orphaned.
    expect(result.bidRowsPruned).toBe(0);
    expect(result.projectRowsPruned).toBe(0);
    expect(result.totalPruned).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns per-kind counts sourced from the .returning() payload so ops can spot a regressed hook", async () => {
    const { pruneOrphanedTakeoffRecents } = await import("../takeoffRecentsCleanup");
    returningQueue = [
      [{ id: "tr-1" }, { id: "tr-2" }, { id: "tr-3" }],
      [{ id: "tr-4" }, { id: "tr-5" }],
    ];

    const result = await pruneOrphanedTakeoffRecents();

    expect(result.bidRowsPruned).toBe(3);
    expect(result.projectRowsPruned).toBe(2);
    expect(result.totalPruned).toBe(5);
  });

  it("re-throws DB errors so the cron wrapper records a failed sample instead of silently succeeding", async () => {
    const { pruneOrphanedTakeoffRecents } = await import("../takeoffRecentsCleanup");
    nextDeleteShouldThrow = true;
    await expect(pruneOrphanedTakeoffRecents()).rejects.toThrow("boom");
  });
});

// Task #2156 — assert the nightly sweep publishes a per-tick metrics
// sample with `bidRowsPruned`, `projectRowsPruned`, `totalPruned`, and
// `durationMs` so the operations dashboard can trend the per-kind
// counts over time and the existing spike-detection rules in
// `jobMetricAlerts.ts` automatically apply (mirrors the metric-
// sampling pattern used by `purgePlanDocumentMarkupTrash`).
describe("pruneOrphanedTakeoffRecents publishes job metric samples (Task #2156)", () => {
  it("records a sample on every tick — including the no-op path — so the dashboard has a baseline", async () => {
    const {
      pruneOrphanedTakeoffRecents,
      TAKEOFF_RECENTS_ORPHAN_PRUNE_JOB,
    } = await import("../takeoffRecentsCleanup");
    // No orphaned rows on either pass.
    returningQueue = [[], []];

    const result = await pruneOrphanedTakeoffRecents();

    expect(result.totalPruned).toBe(0);
    expect(recordedMetrics).toHaveLength(1);
    const sample = recordedMetrics[0];
    expect(sample.job).toBe(TAKEOFF_RECENTS_ORPHAN_PRUNE_JOB);
    expect(sample.job).toBe("takeoff_recents_orphan_prune");
    expect(sample.counters.bidRowsPruned).toBe(0);
    expect(sample.counters.projectRowsPruned).toBe(0);
    expect(sample.counters.totalPruned).toBe(0);
    expect(typeof sample.counters.durationMs).toBe("number");
    expect(sample.counters.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records the per-kind row counts so a regressed delete hook is visible on the dashboard", async () => {
    const { pruneOrphanedTakeoffRecents } = await import("../takeoffRecentsCleanup");
    returningQueue = [
      [{ id: "tr-bid-1" }, { id: "tr-bid-2" }, { id: "tr-bid-3" }, { id: "tr-bid-4" }],
      [{ id: "tr-proj-1" }, { id: "tr-proj-2" }],
    ];

    const result = await pruneOrphanedTakeoffRecents();

    expect(result.bidRowsPruned).toBe(4);
    expect(result.projectRowsPruned).toBe(2);
    expect(result.totalPruned).toBe(6);

    expect(recordedMetrics).toHaveLength(1);
    const sample = recordedMetrics[0];
    expect(sample.counters.bidRowsPruned).toBe(4);
    expect(sample.counters.projectRowsPruned).toBe(2);
    expect(sample.counters.totalPruned).toBe(6);
    // Duration must round-trip as a number so the dashboard's
    // duration sparkline has data.
    expect(typeof sample.counters.durationMs).toBe("number");
  });

  it("does NOT record a sample when the sweep throws — the cron wrapper publishes a failed-outcome sample instead", async () => {
    const { pruneOrphanedTakeoffRecents } = await import("../takeoffRecentsCleanup");
    nextDeleteShouldThrow = true;
    await expect(pruneOrphanedTakeoffRecents()).rejects.toThrow("boom");
    // The sweep aborted before the metrics call ran so we don't
    // double-publish — the cron wrapper's `recordJobOutcome(_, false)`
    // path covers the failure case via the same job key.
    expect(recordedMetrics).toHaveLength(0);
  });
});

describe("jobRegistry exposes the nightly takeoff-recents orphan prune", () => {
  it("registers the job under takeoff_recents_orphan_prune with a nightly schedule", async () => {
    // The runner pulls in a large dependency graph (cron, db, etc.)
    // that we don't want to spin up here — stub the heavy modules so
    // the import resolves without side effects.
    vi.doMock("node-cron", () => ({
      default: { schedule: vi.fn(() => ({ stop: vi.fn() })) },
    }));
    const { jobRegistry } = await import("../jobs/jobRunner");
    const entry = jobRegistry["takeoff_recents_orphan_prune"];
    expect(entry).toBeDefined();
    expect(typeof entry.fn).toBe("function");
    // Once-a-day cron — five fields, no slash spec on the minute.
    expect(entry.schedule).toMatch(/^\d+\s+\d+\s+\*\s+\*\s+\*$/);
  });
});
