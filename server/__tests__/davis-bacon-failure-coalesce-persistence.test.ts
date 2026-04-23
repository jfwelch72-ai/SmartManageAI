/**
 * Task #1370 — Persist Davis-Bacon failure-notification coalescing across
 * server restarts. The in-memory `failureCoalesceMap` is a hot cache; the
 * authoritative timestamp lives on the per-decision row in
 * `integration_sync_state.metadata.failureNotification`. On a cold worker
 * we must seed the cache from that row so a SAM.gov outage that spans a
 * restart does not flood the connection owner with a fresh email on the
 * very next failure.
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

let storedRow: Record<string, unknown> | null = null;
const updateSets: Record<string, unknown>[] = [];
const inserts: Record<string, unknown>[] = [];

const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => (storedRow ? [storedRow] : []),
      }),
    }),
  }),
  update: () => ({
    set: (vals: Record<string, unknown>) => ({
      where: async () => {
        updateSets.push(vals);
        if (storedRow) Object.assign(storedRow, vals);
      },
    }),
  }),
  insert: () => ({
    values: async (vals: Record<string, unknown>) => {
      inserts.push(vals);
      storedRow = { id: `row-${inserts.length}`, ...vals };
    },
  }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

beforeEach(() => {
  insertNotificationMock.mockClear();
  updateSets.length = 0;
  inserts.length = 0;
  storedRow = null;
});

describe("notifyDavisBaconAutoSyncFailure — restart persistence (Task #1370)", () => {
  it("persists lastNotifiedAt on the row's metadata after the first delivery", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-persist-1",
      organizationId: "org-1",
      createdByUserId: "owner-1",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260111", "boom");
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);

    // The persistence call inserted a row carrying the failureNotification key.
    expect(inserts).toHaveLength(1);
    const meta = (inserts[0].metadata as Record<string, unknown>) || {};
    const fn = meta.failureNotification as Record<string, unknown> | undefined;
    expect(fn).toBeDefined();
    expect(typeof fn!.lastNotifiedAt).toBe("number");
    expect(fn!.suppressedCount).toBe(0);
  });

  it("suppresses a failure on a cold worker when the persisted timestamp is still inside the window", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");

    // Simulate a row written by a previous (now-restarted) worker: the
    // last notification went out 10 minutes ago, well inside the 1h window.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    storedRow = {
      id: "row-existing",
      metadata: {
        failureNotification: {
          lastNotifiedAt: tenMinAgo,
          suppressedSince: 0,
          suppressedCount: 0,
        },
        rates: [],
      },
    };

    // Cold worker — wipe the in-memory map to simulate a fresh process.
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-cold",
      organizationId: "org-1",
      createdByUserId: "owner-2",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260222", "boom-after-restart");

    // Should NOT have sent a notification — persisted state suppressed it.
    expect(insertNotificationMock).not.toHaveBeenCalled();

    // The suppressed count should have been bumped on the persisted row.
    expect(updateSets.length).toBeGreaterThanOrEqual(1);
    const lastUpdateMeta = (updateSets[updateSets.length - 1].metadata as Record<string, unknown>) || {};
    const fn = lastUpdateMeta.failureNotification as Record<string, unknown>;
    expect(fn.suppressedCount).toBe(1);
    expect(fn.lastNotifiedAt).toBe(tenMinAgo); // unchanged
  });

  it("delivers immediately on a cold worker when the persisted timestamp is outside the window", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");

    // Persisted notification from 90 minutes ago — outside the 60 min window.
    const ninetyMinAgo = Date.now() - 90 * 60 * 1000;
    storedRow = {
      id: "row-existing",
      metadata: {
        failureNotification: {
          lastNotifiedAt: ninetyMinAgo,
          suppressedSince: 0,
          suppressedCount: 3,
        },
      },
    };

    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-stale",
      organizationId: "org-1",
      createdByUserId: "owner-3",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20260333", "boom-stale-window");

    // Window expired → notification goes out, with the absorbed-count suffix
    // sourced from the persisted suppressedCount.
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);
    const call = insertNotificationMock.mock.calls[0][0] as Record<string, unknown>;
    expect(call.message as string).toMatch(/4 failures in the last hour/);

    // Persisted state was refreshed with the new lastNotifiedAt.
    const lastUpdateMeta = (updateSets[updateSets.length - 1].metadata as Record<string, unknown>) || {};
    const fn = lastUpdateMeta.failureNotification as Record<string, unknown>;
    expect(typeof fn.lastNotifiedAt).toBe("number");
    expect(fn.lastNotifiedAt).not.toBe(ninetyMinAgo);
    expect(fn.suppressedCount).toBe(0);
  });
});
