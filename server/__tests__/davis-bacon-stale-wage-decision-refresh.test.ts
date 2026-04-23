// Task #1380 — Auto-refresh prevailing wage rates when cached wage
// determinations cross the configured staleness threshold.
//
// Verifies that:
//  - The scheduled sweep re-syncs cached rows whose lastSyncAt is older
//    than DOL_DAVIS_BACON_STALE_AFTER_DAYS, stamping a fresh lastSyncAt
//    so the project payroll panel's "Stale" badge clears on next load.
//  - Fresh rows (lastSyncAt within threshold) are skipped.
//  - Rows in the failure-backoff lane (lastError set or nextRetryAt
//    pending) are skipped so the sweep does not hammer DOL when prior
//    attempts failed.
//  - A failure during the sweep is recorded via the standard backoff
//    path so the next sweep skips the row (no hammering).
//  - The configurable threshold is honored.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  notifications,
  users,
} from "@shared/schema";

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
  deliverNotifications: vi.fn(async () => undefined),
  composeEmailContent: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../utils/safeFetch", () => ({
  safeFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      wageDetermination: {
        state: "CA",
        county: "Alameda",
        constructionType: "Heavy",
        effectiveDate: "2026-01-01",
        rates: [
          { classification: "Carpenter", baseRate: 60.0, fringeRate: 14.0 },
        ],
      },
    }),
  })),
}));

const PREFIX = "__dbstale__";

let orgId: string;
let connectionId: string;

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db.delete(notifications).where(eq(notifications.organizationId, id));
    await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, id));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, id));
    await db.delete(users).where(eq(users.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

beforeAll(async () => {
  await cleanup();
  const [org] = await db.insert(organizations).values({
    name: `${PREFIX}org`,
    slug: `${PREFIX}org-${Date.now()}`,
  }).returning();
  orgId = org.id;
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, orgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  const [conn] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: "dol_davis_bacon",
    status: "active",
    displayName: "DOL",
    metadata: { apiKey: "test-key" },
  }).returning();
  connectionId = conn.id;
});

async function seedRow(decisionNumber: string, patch: Partial<typeof integrationSyncState.$inferInsert>) {
  const entityType = `wage_determination:${decisionNumber}`;
  await db.insert(integrationSyncState).values({
    organizationId: orgId,
    connectionId,
    entityType,
    metadata: { rates: [{ classification: "Carpenter", baseRate: 50, fringeRate: 10, totalRate: 60 }] } as any,
    lastSyncAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    lastAttemptAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    lastError: null,
    retryCount: 0,
    nextRetryAt: null,
    ...patch,
  });
}

async function getRow(decisionNumber: string) {
  const entityType = `wage_determination:${decisionNumber}`;
  return (await db
    .select()
    .from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType),
    )))[0];
}

describe("processStaleWageDecisions", () => {
  it("re-syncs rows whose lastSyncAt is older than the staleness threshold", async () => {
    await seedRow("CA20260200", {
      lastSyncAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    });

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const before = Date.now();
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });

    expect(out.candidates).toBe(1);
    expect(out.attempted).toBe(1);
    expect(out.succeeded).toBe(1);
    expect(out.failed).toBe(0);

    const row = await getRow("CA20260200");
    expect(row.lastError).toBeNull();
    expect(row.lastSyncAt).toBeTruthy();
    expect(row.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    // Fresh import payload landed on the row.
    const meta = row.metadata as { rates?: { baseRate: number }[] };
    expect(meta?.rates?.[0]?.baseRate).toBe(60);
  });

  it("skips rows whose lastSyncAt is still inside the staleness window", async () => {
    await seedRow("CA20260201", {
      lastSyncAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockClear();

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });

    expect(out.candidates).toBe(0);
    expect(out.attempted).toBe(0);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("skips rows currently in the failure-backoff lane (lastError set)", async () => {
    await seedRow("CA20260202", {
      lastSyncAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      lastError: "previous outage",
      retryCount: 2,
      nextRetryAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockClear();

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });

    expect(out.candidates).toBe(0);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("records failure via the backoff path so the next sweep skips it", async () => {
    await seedRow("CA20260203", {
      lastSyncAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockImplementationOnce(async () => ({
      ok: false, status: 503, text: async () => "down", json: async () => ({}),
    }));

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });

    expect(out.attempted).toBe(1);
    expect(out.failed).toBe(1);

    const row = await getRow("CA20260203");
    expect(row.lastError).toBeTruthy();
    expect(row.retryCount).toBeGreaterThanOrEqual(1);
    expect(row.nextRetryAt).toBeTruthy();

    // Next sweep should now skip this row because lastError is set.
    safeFetch.mockClear();
    const next = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });
    expect(next.candidates).toBe(0);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("skips rows whose connection is no longer active", async () => {
    await seedRow("CA20260204", {
      lastSyncAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    await db.update(integrationConnections)
      .set({ status: "disconnected" as any })
      .where(eq(integrationConnections.id, connectionId));
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockClear();

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });

    expect(out.candidates).toBe(1);
    expect(out.skippedNoConnection).toBe(1);
    expect(out.attempted).toBe(0);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("honors a custom staleness threshold", async () => {
    await seedRow("CA20260205", {
      lastSyncAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 7 });

    expect(out.candidates).toBe(1);
    expect(out.succeeded).toBe(1);
  });
});

describe("getWageDecisionStaleAfterDays", () => {
  const ORIGINAL = process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS;
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS;
    else process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS = ORIGINAL;
  });

  it("defaults to 30 days when unset or invalid", async () => {
    const { getWageDecisionStaleAfterDays, DEFAULT_WAGE_DECISION_STALE_AFTER_DAYS } = await import("../integrations/providers/dol_davis_bacon/sync");
    delete process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS;
    expect(getWageDecisionStaleAfterDays()).toBe(DEFAULT_WAGE_DECISION_STALE_AFTER_DAYS);
    process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS = "not-a-number";
    expect(getWageDecisionStaleAfterDays()).toBe(DEFAULT_WAGE_DECISION_STALE_AFTER_DAYS);
    process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS = "0";
    expect(getWageDecisionStaleAfterDays()).toBe(DEFAULT_WAGE_DECISION_STALE_AFTER_DAYS);
  });

  it("honors a positive integer override", async () => {
    const { getWageDecisionStaleAfterDays } = await import("../integrations/providers/dol_davis_bacon/sync");
    process.env.DOL_DAVIS_BACON_STALE_AFTER_DAYS = "14";
    expect(getWageDecisionStaleAfterDays()).toBe(14);
  });
});
