/**
 * Task #1384 — verifies that the in-app integrations UI can read,
 * per (connection, decision), how many auto-sync failure alerts the
 * coalescing window has absorbed since the last delivery.
 *
 * This exercises the persistence path end-to-end at the data layer:
 *   1. A streak of 5 failures within the 1h window for a single decision
 *      should leave `suppressedCount = 4` on the row's
 *      `metadata.failureNotification` (the first failure delivers, the
 *      next four are suppressed).
 *   2. `listSuppressedFailureNotifications(orgId)` should return that
 *      decision with the expected count and `suppressedSince` timestamp,
 *      ignoring rows where the persisted suppression is back to zero.
 *   3. After a successful sync resolves the decision, the row's metadata
 *      is overwritten wholesale — confirmed by clearing the persisted
 *      key here — and the helper drops the entry from its results so the
 *      UI badge auto-clears without any explicit teardown.
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

const dbMock = {
  select: () => ({
    from: () => ({
      where: (..._args: unknown[]) => {
        // The tests only ever ask for rows in two shapes:
        //   - getWageDecisionRow: where(connectionId AND entityType) → limit 1
        //   - listSuppressedFailureNotifications: where(orgId AND entityType LIKE)
        // We don't try to interpret the predicate here; instead the call sites
        // chain `.limit(1)` for the first and iterate the array for the second.
        const builder: any = {
          limit: async (_n: number) => {
            // Return the most recently mutated row whose entityType starts with
            // 'wage_determination:' — sufficient for the single-decision streak
            // tested below.
            const r = [...rows].reverse().find((x) => x.entityType.startsWith("wage_determination:"));
            return r ? [r] : [];
          },
          then: undefined,
          [Symbol.asyncIterator]: undefined,
        };
        // Allow `await` directly on the where(...) chain (no .limit)
        builder.then = (resolve: (v: FakeRow[]) => void) =>
          resolve(rows.filter((r) => r.entityType.startsWith("wage_determination:")));
        return builder;
      },
    }),
  }),
  update: () => ({
    set: (vals: Partial<FakeRow>) => ({
      where: async () => {
        // Apply to every wage_determination row — the tests only ever have one.
        for (const r of rows) {
          if (r.entityType.startsWith("wage_determination:")) Object.assign(r, vals);
        }
      },
    }),
  }),
  insert: () => ({
    values: async (vals: Omit<FakeRow, "id">) => {
      rows.push({ id: `row-${rows.length + 1}`, ...vals });
    },
  }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

beforeEach(() => {
  insertNotificationMock.mockClear();
  rows.length = 0;
});

describe("listSuppressedFailureNotifications (Task #1384)", () => {
  it("surfaces the absorbed-failure count and 'since' timestamp for an active streak", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1384-streak",
      organizationId: "org-1384",
      createdByUserId: "owner-1",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    // 5 consecutive failures within the coalescing window: 1 delivered,
    // 4 absorbed → suppressedCount = 4 on the persisted row.
    for (let i = 0; i < 5; i += 1) {
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260999", `boom-${i}`);
    }
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);

    const items = await sync.listSuppressedFailureNotifications("org-1384");
    expect(items).toHaveLength(1);
    const entry = items[0];
    expect(entry.connectionId).toBe("conn-1384-streak");
    expect(entry.decisionNumber).toBe("CA20260999");
    expect(entry.suppressedCount).toBe(4);
    expect(entry.suppressedSince).not.toBeNull();
    expect(typeof entry.lastNotifiedAt).toBe("number");
  });

  it("drops decisions whose suppressedCount is zero (steady state)", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    // Single failure → notification delivered, suppressedCount stays 0.
    const connection = {
      id: "conn-1384-quiet",
      organizationId: "org-1384",
      createdByUserId: "owner-2",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;
    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260111", "first");

    const items = await sync.listSuppressedFailureNotifications("org-1384");
    expect(items).toEqual([]);
  });

  it("auto-clears once a successful sync overwrites the row's metadata", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1384-recover",
      organizationId: "org-1384",
      createdByUserId: "owner-3",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    // Build up a streak first.
    for (let i = 0; i < 3; i += 1) {
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260555", `boom-${i}`);
    }
    let items = await sync.listSuppressedFailureNotifications("org-1384");
    expect(items).toHaveLength(1);
    expect(items[0].suppressedCount).toBe(2);

    // Simulate a successful sync overwriting the row's metadata wholesale
    // (importWageDetermination's `markRowSuccess` path). The
    // `failureNotification` key is gone → the helper should no longer
    // surface this decision so the UI badge auto-clears.
    for (const r of rows) {
      if (r.entityType === "wage_determination:CA20260555") {
        r.metadata = { rates: [{ classification: "Ironworker" }] };
      }
    }
    items = await sync.listSuppressedFailureNotifications("org-1384");
    expect(items).toEqual([]);
  });
});
