/**
 * Task #1443 — verifies the bulk variant of the suppression-reset helper.
 *
 * During a long SAM.gov outage an org can have many wage-decision rows
 * stuck inside the 1h coalescing window simultaneously. The bulk helper
 * wipes `metadata.failureNotification` from every wage-decision row on a
 * given connection in a single transaction and clears the matching
 * in-memory entries so the next failure on each decision delivers
 * immediately.
 *
 * Coverage:
 *   1. Multiple suppressed rows on the same connection are all cleared in
 *      one transaction; the returned decisionNumbers list includes each
 *      one (used by the route for the combined audit entry).
 *   2. Wage-decision rows that don't carry a failureNotification key are
 *      left alone, so the function is safe to invoke even when only some
 *      of the listed rows still have a live suppression.
 *   3. The bulk reset flow runs inside `db.transaction(...)` so a partial
 *      failure can't leave half the rows stale.
 *   4. After the bulk reset, the next failure on a previously-suppressed
 *      decision is delivered as a fresh notification (no "X failures in
 *      the last hour" suffix).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const insertNotificationMock = vi.fn(async () => undefined);
vi.mock("../services/notificationService", () => ({
  insertNotification: insertNotificationMock,
  insertNotifications: vi.fn(async () => undefined),
}));
vi.mock("../integrations/encryption", () => ({
  decryptMetadata: (m: unknown) => m,
}));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

interface FakeRow {
  id: string;
  organizationId: string;
  connectionId: string;
  entityType: string;
  metadata: Record<string, unknown> | null;
  lastError?: string | null;
}

const rows: FakeRow[] = [];
let inTransaction = false;

// The bulk helper iterates the SELECT result in order and calls
// tx.update().set({metadata}).where(eq(integrationSyncState.id, row.id))
// for each row that carries a failureNotification. We mirror that by
// walking the same filtered list in order and applying the cleaned
// metadata back to the same row reference.
let updateCursor = 0;
let updateOrder: FakeRow[] = [];

function buildSelect() {
  return {
    from: () => ({
      where: (..._args: unknown[]) => {
        const matching = rows.filter((r) =>
          r.entityType.startsWith("wage_determination:"),
        );
        const builder: any = {
          limit: async (n: number) => matching.slice(-n),
          then: undefined,
        };
        builder.then = (resolve: (v: FakeRow[]) => void) => resolve(matching);
        return builder;
      },
    }),
  };
}

function buildUpdate() {
  return {
    set: (vals: Partial<FakeRow>) => ({
      where: async () => {
        if (inTransaction) {
          // Per-row update inside the bulk helper's transaction.
          const target = updateOrder[updateCursor++];
          if (target) Object.assign(target, vals);
        } else {
          // Single-row update path used by `resetSuppressedFailureNotification`.
          for (const r of rows) {
            if (r.entityType.startsWith("wage_determination:")) {
              Object.assign(r, vals);
              break;
            }
          }
        }
      },
    }),
  };
}

const dbMock = {
  select: buildSelect,
  update: buildUpdate,
  insert: () => ({
    values: async (vals: Omit<FakeRow, "id">) => {
      rows.push({ id: `row-${rows.length + 1}`, ...vals });
    },
  }),
  transaction: async (fn: (tx: any) => Promise<unknown>) => {
    inTransaction = true;
    // Stage the per-row update order to match the bulk helper's iteration
    // (only rows that currently carry a failureNotification will receive
    // an update call from the helper).
    updateOrder = rows.filter(
      (r) =>
        r.entityType.startsWith("wage_determination:") &&
        r.metadata &&
        typeof r.metadata === "object" &&
        "failureNotification" in (r.metadata as Record<string, unknown>),
    );
    updateCursor = 0;
    try {
      return await fn({
        select: buildSelect,
        update: buildUpdate,
      });
    } finally {
      inTransaction = false;
      updateOrder = [];
    }
  },
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

beforeEach(() => {
  insertNotificationMock.mockClear();
  rows.length = 0;
  updateOrder = [];
  updateCursor = 0;
  inTransaction = false;
});

describe("resetAllSuppressedFailureNotifications (Task #1443)", () => {
  it("clears every suppressed row on the connection and returns each decision number", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1443-bulk",
      organizationId: "org-1443",
      createdByUserId: "owner-1",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    rows.push({
      id: "row-a",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260001",
      metadata: {
        rates: [],
        failureNotification: { lastNotifiedAt: 1, suppressedSince: 1, suppressedCount: 5 },
      },
    });
    rows.push({
      id: "row-b",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260002",
      metadata: {
        failureNotification: { lastNotifiedAt: 2, suppressedSince: 2, suppressedCount: 12 },
      },
    });
    rows.push({
      id: "row-c",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260003",
      metadata: {
        failureNotification: { lastNotifiedAt: 3, suppressedSince: 3, suppressedCount: 1 },
      },
    });
    rows.push({
      id: "row-clean",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260999",
      metadata: { rates: [] },
    });

    const result = await sync.resetAllSuppressedFailureNotifications(connection);
    expect(result.cleared).toBe(3);
    expect(result.decisionNumbers.sort()).toEqual([
      "CA20260001",
      "CA20260002",
      "CA20260003",
    ]);

    for (const id of ["row-a", "row-b", "row-c"]) {
      const r = rows.find((x) => x.id === id)!;
      expect(r.metadata && "failureNotification" in r.metadata).toBe(false);
    }
    const clean = rows.find((x) => x.id === "row-clean")!;
    expect(clean.metadata).toEqual({ rates: [] });

    const items = await sync.listSuppressedFailureNotifications("org-1443");
    expect(items).toEqual([]);
  });

  it("returns cleared=0 when no row on the connection carries a suppression", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1443-empty",
      organizationId: "org-1443",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;
    rows.push({
      id: "row-only",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260000",
      metadata: { rates: [] },
    });

    const result = await sync.resetAllSuppressedFailureNotifications(connection);
    expect(result.cleared).toBe(0);
    expect(result.decisionNumbers).toEqual([]);
  });

  it("runs the row updates inside db.transaction", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const txSpy = vi.spyOn(dbMock, "transaction");
    const connection = {
      id: "conn-1443-tx",
      organizationId: "org-1443",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;
    rows.push({
      id: "row-tx",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260555",
      metadata: {
        failureNotification: { lastNotifiedAt: 1, suppressedSince: 1, suppressedCount: 4 },
      },
    });

    await sync.resetAllSuppressedFailureNotifications(connection);
    expect(txSpy).toHaveBeenCalledTimes(1);
    txSpy.mockRestore();
  });

  it("delivers the next failure as fresh after a bulk reset", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1443-fresh",
      organizationId: "org-1443",
      createdByUserId: "owner-1",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;
    rows.push({
      id: "row-fresh",
      organizationId: "org-1443",
      connectionId: connection.id,
      entityType: "wage_determination:CA20260777",
      metadata: {
        failureNotification: {
          lastNotifiedAt: Date.now(),
          suppressedSince: Date.now(),
          suppressedCount: 9,
        },
      },
    });

    await sync.resetAllSuppressedFailureNotifications(connection);

    insertNotificationMock.mockClear();
    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260777", "post-bulk-reset");
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);
    const sent = ((insertNotificationMock.mock.calls[0] as unknown[])[0] as any).message as string;
    expect(sent).not.toContain("failures in the last hour");
  });
});
