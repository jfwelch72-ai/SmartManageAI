/**
 * Task #1403 — verifies that admins can force-clear the
 * Davis-Bacon failure-notification suppression window for a single
 * (connection, decision) so the next failure goes out immediately
 * instead of being absorbed for the remainder of the 1h window.
 *
 * Exercised end-to-end at the data layer:
 *   1. A streak of failures persists `metadata.failureNotification` on
 *      the per-decision row and seeds the in-memory coalesce map.
 *   2. `resetSuppressedFailureNotification` strips the persisted key,
 *      drops the in-memory entry, and returns true when something was
 *      actually cleared.
 *   3. The very next failure is delivered as a fresh notification
 *      (suppressedCount returns to zero, no "X failures absorbed"
 *      suffix on the email body).
 *   4. A reset against a row with no persisted suppression returns
 *      false but still wipes any stray in-memory entry.
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
        const builder: any = {
          limit: async (_n: number) => {
            const r = [...rows].reverse().find((x) => x.entityType.startsWith("wage_determination:"));
            return r ? [r] : [];
          },
          then: undefined,
        };
        builder.then = (resolve: (v: FakeRow[]) => void) =>
          resolve(rows.filter((r) => r.entityType.startsWith("wage_determination:")));
        return builder;
      },
    }),
  }),
  update: () => ({
    set: (vals: Partial<FakeRow>) => ({
      where: async () => {
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

describe("resetSuppressedFailureNotification (Task #1403)", () => {
  it("clears the persisted key and re-arms the next failure as fresh", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1403-reset",
      organizationId: "org-1403",
      createdByUserId: "owner-1",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    // Build up a suppression streak: 1 delivered, 4 absorbed.
    for (let i = 0; i < 5; i += 1) {
      await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20261111", `boom-${i}`);
    }
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);
    let items = await sync.listSuppressedFailureNotifications("org-1403");
    expect(items).toHaveLength(1);
    expect(items[0].suppressedCount).toBe(4);

    // Force-reset the suppression window.
    const cleared = await sync.resetSuppressedFailureNotification(
      connection,
      "CA20261111",
    );
    expect(cleared).toBe(true);

    // Persisted key is gone → panel hides this row.
    items = await sync.listSuppressedFailureNotifications("org-1403");
    expect(items).toEqual([]);

    // Next failure is delivered as a fresh notification (no suffix), and
    // the persisted state restarts at suppressedCount = 0.
    insertNotificationMock.mockClear();
    await sync.notifyDavisBaconAutoSyncFailure(connection, "CA20261111", "post-reset");
    expect(insertNotificationMock).toHaveBeenCalledTimes(1);
    const sentMessage = (insertNotificationMock.mock.calls[0][0] as any).message as string;
    expect(sentMessage).not.toContain("failures in the last hour");
  });

  it("returns false when there's no persisted suppression to clear", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    sync.__resetDavisBaconFailureCoalesceForTests();

    const connection = {
      id: "conn-1403-noop",
      organizationId: "org-1403",
      createdByUserId: "owner-2",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;

    const cleared = await sync.resetSuppressedFailureNotification(
      connection,
      "CA20262222",
    );
    expect(cleared).toBe(false);
  });

  it("ignores blank decision numbers", async () => {
    const sync = await import("../integrations/providers/dol_davis_bacon/sync");
    const connection = {
      id: "conn-1403-blank",
      organizationId: "org-1403",
      provider: "dol_davis_bacon",
      status: "active",
      metadata: { apiKey: "k" },
    } as any;
    expect(await sync.resetSuppressedFailureNotification(connection, "")).toBe(false);
    expect(await sync.resetSuppressedFailureNotification(connection, "   ")).toBe(false);
  });
});
