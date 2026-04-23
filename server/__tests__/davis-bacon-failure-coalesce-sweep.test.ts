// Task #1385 — sweepStaleFailureNotifications cleanup behaviour.

import { describe, it, expect, beforeEach, vi } from "vitest";

interface FailureNotification {
  lastNotifiedAt: number;
  suppressedSince: number;
  suppressedCount: number;
}

vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
  insertNotifications: vi.fn(async () => undefined),
}));
vi.mock("../integrations/encryption", () => ({
  decryptMetadata: (m: unknown) => m,
}));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

// Override `eq` so the db mock can identify which row to update.
vi.mock("drizzle-orm", async () => {
  const real = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...real,
    eq: (_col: unknown, val: unknown) => ({ __rowId: val }),
  };
});

interface Row {
  id: string;
  connectionId: string;
  entityType: string;
  lastError: string | null;
  metadata: Record<string, unknown> | null;
}

let rows: Row[] = [];
const updates: { id: string; metadata: Record<string, unknown> }[] = [];

const dbMock = {
  select: () => ({
    from: () => ({
      where: () =>
        Promise.resolve(
          rows.filter(
            (r) =>
              r.lastError === null &&
              r.entityType.startsWith("wage_determination:"),
          ),
        ),
    }),
  }),
  update: () => ({
    set: (vals: Record<string, unknown>) => ({
      where: async (predicate: unknown) => {
        const id = (predicate as { __rowId?: string })?.__rowId;
        const target = rows.find((r) => r.id === id);
        if (!target) return;
        Object.assign(target, vals);
        updates.push({
          id: target.id,
          metadata: vals.metadata as Record<string, unknown>,
        });
      },
    }),
  }),
  insert: () => ({ values: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

beforeEach(() => {
  rows = [];
  updates.length = 0;
});

const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function makeRow(overrides: Partial<Row>): Row {
  return {
    id: overrides.id ?? "r",
    connectionId: overrides.connectionId ?? "conn",
    entityType: overrides.entityType ?? "wage_determination:CA20260000",
    lastError: overrides.lastError ?? null,
    metadata: overrides.metadata ?? null,
  };
}

describe("sweepStaleFailureNotifications (Task #1385)", () => {
  it("clears failureNotification when stale and there is no current error", async () => {
    rows.push(
      makeRow({
        id: "stale-no-err",
        metadata: {
          rates: [],
          failureNotification: {
            lastNotifiedAt: Date.now() - EIGHT_DAYS,
            suppressedSince: 0,
            suppressedCount: 2,
          },
        },
      }),
    );

    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const cleared = await sync.sweepStaleFailureNotifications();

    expect(cleared).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("stale-no-err");
    expect("failureNotification" in updates[0].metadata).toBe(false);
    // Other metadata (e.g. cached rates) is preserved.
    expect(updates[0].metadata.rates).toEqual([]);
  });

  it("leaves failureNotification alone when lastError is currently set", async () => {
    const row = makeRow({
      id: "stale-with-err",
      lastError: "SAM.gov 503",
      metadata: {
        failureNotification: {
          lastNotifiedAt: Date.now() - EIGHT_DAYS,
          suppressedSince: 0,
          suppressedCount: 5,
        },
      },
    });
    rows.push(row);

    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const cleared = await sync.sweepStaleFailureNotifications();

    expect(cleared).toBe(0);
    expect(updates).toHaveLength(0);
    const fn = (row.metadata as Record<string, unknown>).failureNotification as FailureNotification | undefined;
    expect(fn).toBeDefined();
    expect(fn!.suppressedCount).toBe(5);
  });

  it("leaves failureNotification alone when lastNotifiedAt is recent", async () => {
    const row = makeRow({
      id: "recent-no-err",
      metadata: {
        failureNotification: {
          lastNotifiedAt: Date.now() - ONE_DAY,
          suppressedSince: 0,
          suppressedCount: 0,
        },
      },
    });
    rows.push(row);

    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const cleared = await sync.sweepStaleFailureNotifications();

    expect(cleared).toBe(0);
    expect(updates).toHaveLength(0);
    const fn = (row.metadata as Record<string, unknown>).failureNotification as FailureNotification | undefined;
    expect(fn).toBeDefined();
    expect(typeof fn!.lastNotifiedAt).toBe("number");
  });
});
