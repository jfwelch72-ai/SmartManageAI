// Task #1312 — Auto-trigger a Davis-Bacon sync when a project references an
// unimported wage decision. Verifies the queueWageDecisionSync helper short
// circuits when the decision is already cached or when the org has no
// active connection, and runs the import otherwise.
//
// Task #1332 — Persisted "last sync attempt" tracking + integration-owner
// notification on background failure so users find out before opening a
// payroll report.

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

const PREFIX = "__dbasync__";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../utils/safeFetch", () => ({
  safeFetch: vi.fn(async (url: string) => ({
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

let orgId: string;

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
  // Wipe per-test sync state and connections so each test starts clean.
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, orgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
});

describe("queueWageDecisionSync", () => {
  it("returns 'cached' when the determination is already in sync state and does not call SAM.gov", async () => {
    const { queueWageDecisionSync } = await import("../integrations/providers/dol_davis_bacon/sync");
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    safeFetch.mockClear();

    await db.insert(integrationConnections).values({
      organizationId: orgId,
      provider: "dol_davis_bacon" as any,
      status: "active" as any,
      displayName: "DOL",
      metadata: { apiKey: "k" },
    });
    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: (await db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, orgId)))[0].id,
      entityType: "wage_determination:CA20260001",
      metadata: { decisionNumber: "CA20260001", rates: [] },
      lastSyncAt: new Date(),
    });

    const out = await queueWageDecisionSync(orgId, "CA20260001", { awaitResult: true });
    expect(out.status).toBe("cached");
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("returns 'no_connection' when the org has no active Davis-Bacon connection", async () => {
    const { queueWageDecisionSync } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await queueWageDecisionSync(orgId, "CA20260002", { awaitResult: true });
    expect(out.status).toBe("no_connection");
  });

  it("returns 'no_credentials' when the connection lacks an API key", async () => {
    const { queueWageDecisionSync } = await import("../integrations/providers/dol_davis_bacon/sync");
    await db.insert(integrationConnections).values({
      organizationId: orgId,
      provider: "dol_davis_bacon" as any,
      status: "active" as any,
      displayName: "DOL",
      metadata: {},
    });
    const out = await queueWageDecisionSync(orgId, "CA20260003", { awaitResult: true });
    expect(out.status).toBe("no_credentials");
  });

  it("imports the determination when awaitResult=true and an active connection exists", async () => {
    const { queueWageDecisionSync, isWageDeterminationCached } = await import("../integrations/providers/dol_davis_bacon/sync");
    await db.insert(integrationConnections).values({
      organizationId: orgId,
      provider: "dol_davis_bacon" as any,
      status: "active" as any,
      displayName: "DOL",
      metadata: { apiKey: "test-key" },
    });

    const out = await queueWageDecisionSync(orgId, "CA20260004", { awaitResult: true });
    expect(out.status).toBe("completed");
    if (out.status === "completed") {
      expect(out.result.success).toBe(true);
    }
    expect(await isWageDeterminationCached(orgId, "CA20260004")).toBe(true);
  });

  // Task #1332 — When a background sync fails we must persist the error on
  // the integration_sync_state row AND notify the integration owner so the
  // failure isn't silently swallowed. A subsequent successful sync clears
  // the failure so the UI banner goes away on its own.
  it("records lastError + lastAttemptAt and notifies the connection owner on background failure, then clears on success", async () => {
    const safeFetch = (await import("../utils/safeFetch")).safeFetch as unknown as ReturnType<typeof vi.fn>;
    const { queueWageDecisionSync } = await import("../integrations/providers/dol_davis_bacon/sync");

    const [owner] = await db.insert(users).values({
      organizationId: orgId,
      firstName: "Test",
      lastName: "Owner",
      email: `${PREFIX}owner-${Date.now()}@example.com`,
      role: "ADMIN" as any,
    } as any).returning();

    await db.insert(integrationConnections).values({
      organizationId: orgId,
      provider: "dol_davis_bacon" as any,
      status: "active" as any,
      displayName: "DOL",
      metadata: { apiKey: "test-key" },
      createdByUserId: owner.id,
    } as any);

    // Make the next call fail. The background path swallows the failure
    // into integration_sync_state.lastError + a notification — no exception
    // bubbles back up to the awaitResult caller — so we drive it via the
    // fire-and-forget branch and poll for the persisted state.
    safeFetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 503,
      text: async () => "upstream down",
      json: async () => ({}),
    }));

    const queued = await queueWageDecisionSync(orgId, "CA20260999", { awaitResult: false });
    expect(queued.status).toBe("queued");

    let failedRow: typeof integrationSyncState.$inferSelect | undefined;
    for (let i = 0; i < 50; i++) {
      failedRow = (await db.select().from(integrationSyncState).where(and(
        eq(integrationSyncState.organizationId, orgId),
        eq(integrationSyncState.entityType, "wage_determination:CA20260999"),
      )))[0];
      if (failedRow?.lastError) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(failedRow).toBeTruthy();
    expect(failedRow!.lastError).toBeTruthy();
    expect(failedRow!.lastAttemptAt).toBeTruthy();
    expect(failedRow!.lastSyncAt).toBeNull();

    let note: typeof notifications.$inferSelect | undefined;
    for (let i = 0; i < 50; i++) {
      note = (await db.select().from(notifications).where(and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, owner.id),
      )))[0];
      if (note) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(note).toBeTruthy();
    expect(note!.type as string).toBe("DAVIS_BACON_AUTO_SYNC_FAILED");

    // Now succeed — should clear lastError and set lastSyncAt.
    const ok = await queueWageDecisionSync(orgId, "CA20260999", { awaitResult: true });
    expect(ok.status).toBe("completed");
    const okRow = (await db.select().from(integrationSyncState).where(and(
      eq(integrationSyncState.organizationId, orgId),
      eq(integrationSyncState.entityType, "wage_determination:CA20260999"),
    )))[0];
    expect(okRow.lastError).toBeNull();
    expect(okRow.lastSyncAt).toBeTruthy();
  });
});
