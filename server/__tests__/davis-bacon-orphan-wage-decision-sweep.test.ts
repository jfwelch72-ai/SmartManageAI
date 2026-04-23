// Task #1392 — sweepOrphanedWageDecisionRows cleanup behaviour.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
  insertNotifications: vi.fn(async () => undefined),
}));
vi.mock("../integrations/encryption", () => ({
  decryptMetadata: (m: unknown) => m,
}));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("drizzle-orm", async () => {
  const real = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...real,
    eq: (_col: unknown, val: unknown) => ({ __rowId: val }),
  };
});

interface SyncRow {
  id: string;
  organizationId: string;
  connectionId: string;
  entityType: string;
  lastSyncAt: Date | null;
  lastAttemptAt: Date | null;
  metadata: Record<string, unknown> | null;
}

interface ProjectRow {
  gcOrganizationId: string | null;
  wageDecision: string | null;
}

let syncRows: SyncRow[] = [];
let projectRows: ProjectRow[] = [];
const deletes: string[] = [];

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const NOW = new Date("2026-04-23T00:00:00.000Z");

const dbMock = {
  select: (cols?: Record<string, unknown>) => ({
    from: () => ({
      where: () => {
        // The sweep issues two queries:
        //  1. `select()` over integration_sync_state (no projection)
        //  2. `select({organizationId, wageDecision})` over projects
        // Use the presence of `wageDecision` in the projection to tell
        // them apart — this matches what the production code passes.
        if (cols && "wageDecision" in cols) {
          return Promise.resolve(
            projectRows
              .filter((p) => p.wageDecision !== null)
              .map((p) => ({
                organizationId: p.gcOrganizationId,
                wageDecision: p.wageDecision,
              })),
          );
        }
        // integration_sync_state candidate query — apply the cutoff +
        // entity-type filters in JS so the sweep sees exactly the rows
        // it would in production.
        const cutoff = NOW.getTime() - NINETY_DAYS;
        return Promise.resolve(
          syncRows.filter((r) => {
            if (!r.entityType.startsWith("wage_determination:")) return false;
            // Mirror the GREATEST(...) SQL: most-recent of either touch
            // timestamp must be older than cutoff. Both null → keep.
            const newest = Math.max(
              r.lastSyncAt?.getTime() ?? -Infinity,
              r.lastAttemptAt?.getTime() ?? -Infinity,
            );
            if (!Number.isFinite(newest)) return false;
            return newest < cutoff;
          }),
        );
      },
    }),
  }),
  delete: () => ({
    where: async (predicate: unknown) => {
      const id = (predicate as { __rowId?: string })?.__rowId;
      if (!id) return;
      const idx = syncRows.findIndex((r) => r.id === id);
      if (idx >= 0) {
        syncRows.splice(idx, 1);
        deletes.push(id);
      }
    },
  }),
  update: () => ({
    set: () => ({ where: async () => undefined }),
  }),
  insert: () => ({ values: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

beforeEach(() => {
  syncRows = [];
  projectRows = [];
  deletes.length = 0;
});

function makeSyncRow(overrides: Partial<SyncRow>): SyncRow {
  return {
    id: overrides.id ?? "r",
    organizationId: overrides.organizationId ?? "org-1",
    connectionId: overrides.connectionId ?? "conn-1",
    entityType: overrides.entityType ?? "wage_determination:CA20240001",
    lastSyncAt: overrides.lastSyncAt ?? null,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
    metadata: overrides.metadata ?? null,
  };
}

describe("sweepOrphanedWageDecisionRows (Task #1392)", () => {
  it("deletes rows that are orphaned and long-untouched", async () => {
    syncRows.push(
      makeSyncRow({
        id: "orphan-old",
        organizationId: "org-1",
        entityType: "wage_determination:CA20230099",
        lastSyncAt: new Date(NOW.getTime() - 120 * 24 * 60 * 60 * 1000),
      }),
    );
    // No project references CA20230099.
    projectRows.push({ gcOrganizationId: "org-1", wageDecision: "CA20240001" });

    const sync = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const deleted = await sync.sweepOrphanedWageDecisionRows(NOW);

    expect(deleted).toBe(1);
    expect(deletes).toEqual(["orphan-old"]);
    expect(syncRows).toHaveLength(0);
  });

  it("keeps orphaned rows that are still recent", async () => {
    syncRows.push(
      makeSyncRow({
        id: "orphan-recent",
        organizationId: "org-1",
        entityType: "wage_determination:CA20260010",
        // Touched 30 days ago — well inside the 90-day retention window.
        lastSyncAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
        lastAttemptAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
      }),
    );
    // No project references the decision, but the row is still fresh.

    const sync = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const deleted = await sync.sweepOrphanedWageDecisionRows(NOW);

    expect(deleted).toBe(0);
    expect(deletes).toEqual([]);
    expect(syncRows).toHaveLength(1);
  });

  it("keeps long-untouched rows that are still referenced by a project", async () => {
    syncRows.push(
      makeSyncRow({
        id: "referenced-old",
        organizationId: "org-1",
        entityType: "wage_determination:CA20230099",
        lastSyncAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      }),
    );
    projectRows.push({
      gcOrganizationId: "org-1",
      wageDecision: "CA20230099",
    });

    const sync = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const deleted = await sync.sweepOrphanedWageDecisionRows(NOW);

    expect(deleted).toBe(0);
    expect(deletes).toEqual([]);
    expect(syncRows).toHaveLength(1);
  });

  it("scopes referenced decisions per organization", async () => {
    // Same decision number, two orgs. Org-2's row should be swept because
    // only org-1 still references the decision.
    syncRows.push(
      makeSyncRow({
        id: "org1-referenced",
        organizationId: "org-1",
        entityType: "wage_determination:CA20230099",
        lastSyncAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      }),
      makeSyncRow({
        id: "org2-orphan",
        organizationId: "org-2",
        entityType: "wage_determination:CA20230099",
        lastSyncAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      }),
    );
    projectRows.push({
      gcOrganizationId: "org-1",
      wageDecision: "CA20230099",
    });

    const sync = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const deleted = await sync.sweepOrphanedWageDecisionRows(NOW);

    expect(deleted).toBe(1);
    expect(deletes).toEqual(["org2-orphan"]);
    expect(syncRows.map((r) => r.id)).toEqual(["org1-referenced"]);
  });

  it("keeps rows whose lastSyncAt is ancient but lastAttemptAt is recent", async () => {
    // Common after a historical success followed by recent failed
    // retries: lastSyncAt is old, but the row is still actively being
    // touched. Must NOT be swept.
    syncRows.push(
      makeSyncRow({
        id: "synced-old-attempted-recent",
        organizationId: "org-1",
        entityType: "wage_determination:CA20210001",
        lastSyncAt: new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000),
        lastAttemptAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
      }),
    );
    // No project references it — but the recent attempt should still
    // protect it from cleanup.

    const sync = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const deleted = await sync.sweepOrphanedWageDecisionRows(NOW);

    expect(deleted).toBe(0);
    expect(deletes).toEqual([]);
    expect(syncRows).toHaveLength(1);
  });

  it("falls back to lastAttemptAt when lastSyncAt is null", async () => {
    syncRows.push(
      makeSyncRow({
        id: "attempt-old",
        organizationId: "org-1",
        entityType: "wage_determination:CA20220001",
        lastSyncAt: null,
        lastAttemptAt: new Date(NOW.getTime() - 200 * 24 * 60 * 60 * 1000),
      }),
    );

    const sync = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const deleted = await sync.sweepOrphanedWageDecisionRows(NOW);

    expect(deleted).toBe(1);
    expect(deletes).toEqual(["attempt-old"]);
  });
});
