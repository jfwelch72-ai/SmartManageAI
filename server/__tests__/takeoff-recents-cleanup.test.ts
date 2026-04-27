/**
 * Task #2105 — Auto-tidy stale Takeoff "Recent" entries when their
 * underlying bid or project is deleted.
 *
 * Hermetic: drives the small `pruneTakeoffRecentsForEntity` helper against
 * an in-process db mock so we can assert the WHERE predicate (kind +
 * entityId, across all users — no userId filter) without spinning up
 * Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { takeoffRecents } from "@shared/schema";

interface CapturedDelete {
  table: string;
  predicate: unknown;
}

const deletes: CapturedDelete[] = [];
const errorLogs: Array<{ message: string; context?: Record<string, unknown>; error?: Error }> = [];
let nextDeleteShouldThrow = false;

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

const dbMock = {
  delete: (t: unknown) => {
    const name = tableName(t);
    return {
      where: async (predicate: unknown) => {
        deletes.push({ table: name, predicate });
        if (nextDeleteShouldThrow) {
          nextDeleteShouldThrow = false;
          throw new Error("boom");
        }
        return undefined;
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

beforeEach(() => {
  deletes.length = 0;
  errorLogs.length = 0;
  nextDeleteShouldThrow = false;
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
