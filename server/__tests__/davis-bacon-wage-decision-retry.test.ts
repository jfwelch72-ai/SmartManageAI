// Task #1354 — Scheduled retry of failed Davis-Bacon wage-decision syncs
// with exponential backoff. Verifies that:
//  - Failures populate retryCount + nextRetryAt on integration_sync_state.
//  - The retry sweep picks up due rows and re-runs the import, clearing
//    the failure state on success.
//  - Rows whose nextRetryAt is still in the future are skipped.
//  - After MAX_WAGE_DECISION_RETRIES failures the row stops auto-retrying.
//  - A successful sync resets retryCount/nextRetryAt to null.
//  - A manual retry click re-arms the auto-retry chain after exhaustion.

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
          { classification: "Carpenter", baseRate: 55.5, fringeRate: 12.0 },
        ],
      },
    }),
  })),
}));

const PREFIX = "__dbretry__";

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

describe("wage-decision auto-retry with backoff", () => {
  it("populates retryCount and nextRetryAt on first failure", async () => {
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockImplementationOnce(async () => ({
      ok: false, status: 503, text: async () => "down", json: async () => ({}),
    }));

    const { queueWageDecisionSync, WAGE_DECISION_RETRY_BACKOFF_MINUTES } = await import("../integrations/providers/dol_davis_bacon/sync");
    const before = Date.now();
    const out = await queueWageDecisionSync(orgId, "CA20260100", { awaitResult: true });
    expect(out.status).toBe("completed");
    if (out.status === "completed") expect(out.result.success).toBe(false);

    const row = await getRow("CA20260100");
    expect(row).toBeTruthy();
    expect(row.retryCount).toBe(1);
    expect(row.lastError).toBeTruthy();
    expect(row.nextRetryAt).toBeTruthy();
    const expectedDelayMs = WAGE_DECISION_RETRY_BACKOFF_MINUTES[0] * 60_000;
    const actualDelayMs = row.nextRetryAt!.getTime() - before;
    // Allow a generous tolerance window — db round-trip + clock skew.
    expect(actualDelayMs).toBeGreaterThanOrEqual(expectedDelayMs - 5_000);
    expect(actualDelayMs).toBeLessThanOrEqual(expectedDelayMs + 30_000);
  });

  it("retry sweep re-runs syncs whose nextRetryAt window has elapsed", async () => {
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    // First failure to seed the row.
    safeFetch.mockImplementationOnce(async () => ({
      ok: false, status: 503, text: async () => "down", json: async () => ({}),
    }));
    const { queueWageDecisionSync, processFailedWageDecisionRetries } = await import("../integrations/providers/dol_davis_bacon/sync");
    await queueWageDecisionSync(orgId, "CA20260101", { awaitResult: true });

    // Force the row's nextRetryAt to be in the past so the sweep picks it up.
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, connectionId),
        eq(integrationSyncState.entityType, "wage_determination:CA20260101"),
      ));

    const result = await processFailedWageDecisionRetries();
    expect(result.attempted).toBeGreaterThanOrEqual(1);
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const row = await getRow("CA20260101");
    expect(row.lastError).toBeNull();
    expect(row.lastSyncAt).toBeTruthy();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
  });

  it("skips rows whose nextRetryAt is still in the future", async () => {
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockImplementationOnce(async () => ({
      ok: false, status: 503, text: async () => "down", json: async () => ({}),
    }));
    const { queueWageDecisionSync, processFailedWageDecisionRetries } = await import("../integrations/providers/dol_davis_bacon/sync");
    await queueWageDecisionSync(orgId, "CA20260102", { awaitResult: true });

    safeFetch.mockClear();
    const result = await processFailedWageDecisionRetries();
    expect(result.attempted).toBe(0);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("stops scheduling retries after MAX_WAGE_DECISION_RETRIES failures", async () => {
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    const { queueWageDecisionSync, processFailedWageDecisionRetries, MAX_WAGE_DECISION_RETRIES } = await import("../integrations/providers/dol_davis_bacon/sync");

    // First seed-failure
    safeFetch.mockImplementationOnce(async () => ({
      ok: false, status: 503, text: async () => "down", json: async () => ({}),
    }));
    await queueWageDecisionSync(orgId, "CA20260103", { awaitResult: true });

    // Run MAX-1 more failed retries by fast-forwarding nextRetryAt each time.
    for (let i = 1; i < MAX_WAGE_DECISION_RETRIES; i++) {
      await db.update(integrationSyncState)
        .set({ nextRetryAt: new Date(Date.now() - 60_000) })
        .where(and(
          eq(integrationSyncState.connectionId, connectionId),
          eq(integrationSyncState.entityType, "wage_determination:CA20260103"),
        ));
      safeFetch.mockImplementationOnce(async () => ({
        ok: false, status: 503, text: async () => "down", json: async () => ({}),
      }));
      await processFailedWageDecisionRetries();
    }

    const row = await getRow("CA20260103");
    expect(row.retryCount).toBe(MAX_WAGE_DECISION_RETRIES);
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastError).toBeTruthy();
  });

  it("manual retry re-arms the auto-retry chain after exhaustion", async () => {
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    const { queueWageDecisionSync, MAX_WAGE_DECISION_RETRIES } = await import("../integrations/providers/dol_davis_bacon/sync");

    // Seed a row in the "exhausted" state directly.
    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId,
      entityType: "wage_determination:CA20260104",
      lastError: "previous outage",
      lastAttemptAt: new Date(),
      retryCount: MAX_WAGE_DECISION_RETRIES,
      nextRetryAt: null,
    });

    // Manual retry that itself fails — should reset the counter to 0
    // before attempting, then increment to 1 on the new failure so the
    // retry sweep will pick it up again.
    safeFetch.mockImplementationOnce(async () => ({
      ok: false, status: 503, text: async () => "down", json: async () => ({}),
    }));
    await queueWageDecisionSync(orgId, "CA20260104", { awaitResult: true, manualRetry: true });

    const row = await getRow("CA20260104");
    expect(row.retryCount).toBe(1);
    expect(row.nextRetryAt).toBeTruthy();
    expect(row.lastError).toBeTruthy();
  });
});
