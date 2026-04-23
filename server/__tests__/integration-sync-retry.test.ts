// Task #1368 — Generic scheduled-retry helper for failed integration syncs.
// Verifies that:
//  - recordSyncFailure populates retryCount + nextRetryAt and follows the
//    same exponential-backoff schedule as the Davis-Bacon-only sweep.
//  - recordSyncSuccess clears prior failure state.
//  - The generic sweep dispatches via the registered (provider, prefix)
//    handler, retries due rows, and tallies per-provider stats.
//  - QBO scheduled syncs are picked up by the QBO retry handler and
//    re-fired against the original connection.
//  - Rows whose connection is gone or whose entity has no registered
//    handler are paused (nextRetryAt cleared) so the sweep stops chasing
//    them every 5 minutes forever.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
} from "@shared/schema";

import {
  SYNC_RETRY_BACKOFF_MINUTES,
  MAX_SYNC_RETRIES,
  computeNextSyncRetryAt,
  recordSyncFailure,
  recordSyncSuccess,
  registerSyncRetryHandler,
  processIntegrationSyncRetries,
} from "../integrations/syncRetry";

// Pull the real QBO sync module so its retry handler registers itself.
import "../integrations/providers/qbo/sync";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const PREFIX = "__syncretry__";
let orgId: string;

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, id));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, id));
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
});

async function makeConnection(provider: string, metadata: Record<string, any> = {}) {
  const [conn] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: provider as any,
    status: "active",
    displayName: `${provider} test`,
    metadata,
  }).returning();
  return conn;
}

async function getRow(connectionId: string, entityType: string) {
  return (await db.select().from(integrationSyncState).where(
    and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType),
    ),
  ))[0];
}

describe("computeNextSyncRetryAt", () => {
  it("matches the documented backoff schedule", () => {
    const base = new Date("2026-04-23T00:00:00Z");
    for (let i = 1; i <= SYNC_RETRY_BACKOFF_MINUTES.length; i++) {
      const at = computeNextSyncRetryAt(i, base);
      expect(at).toBeTruthy();
      expect(at!.getTime() - base.getTime()).toBe(SYNC_RETRY_BACKOFF_MINUTES[i - 1] * 60_000);
    }
    // Beyond the last slot returns null so the sweep stops.
    expect(computeNextSyncRetryAt(SYNC_RETRY_BACKOFF_MINUTES.length + 1, base)).toBeNull();
  });
});

describe("recordSyncFailure / recordSyncSuccess", () => {
  it("upserts retry bookkeeping and clears it on success", async () => {
    const conn = await makeConnection("qbo", { realmId: "r", accessToken: "a" });
    const entity = "qbo_sync:chart_of_accounts";

    const fail1 = await recordSyncFailure(conn, entity, new Error("boom"));
    expect(fail1.retryCount).toBe(1);
    expect(fail1.nextRetryAt).toBeTruthy();
    expect(fail1.exhausted).toBe(false);
    let row = await getRow(conn.id, entity);
    expect(row.lastError).toBe("Error: boom");
    expect(row.retryCount).toBe(1);
    expect(row.lastAttemptAt).toBeTruthy();

    const fail2 = await recordSyncFailure(conn, entity, "still down");
    expect(fail2.retryCount).toBe(2);
    row = await getRow(conn.id, entity);
    expect(row.retryCount).toBe(2);

    await recordSyncSuccess(conn, entity);
    row = await getRow(conn.id, entity);
    expect(row.lastError).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastSyncAt).toBeTruthy();
  });

  it("stops scheduling retries once the backoff schedule is exhausted", async () => {
    const conn = await makeConnection("qbo", { realmId: "r", accessToken: "a" });
    const entity = "qbo_sync:purchase_orders";
    let last: Awaited<ReturnType<typeof recordSyncFailure>> | null = null;
    for (let i = 0; i < MAX_SYNC_RETRIES; i++) {
      last = await recordSyncFailure(conn, entity, "outage");
    }
    expect(last!.retryCount).toBe(MAX_SYNC_RETRIES);
    expect(last!.nextRetryAt).toBeNull();
    expect(last!.exhausted).toBe(true);
  });
});

describe("processIntegrationSyncRetries dispatch", () => {
  it("invokes the registered handler and clears state on success", async () => {
    const conn = await makeConnection("dropbox", {});
    const entity = "fake_widget:42";
    const handler = vi.fn(async () => ({ success: true as const }));
    registerSyncRetryHandler({
      provider: "dropbox",
      entityTypePrefix: "fake_widget:",
      handler,
    });

    await recordSyncFailure(conn, entity, "first failure");
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, entity),
      ));

    const out = await processIntegrationSyncRetries();
    expect(out.attempted).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBeGreaterThanOrEqual(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(out.byProvider["dropbox"]).toMatchObject({ attempted: 1, succeeded: 1 });

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
  });

  it("bumps retryCount on handler failure when handler is not selfRecorded", async () => {
    const conn = await makeConnection("gdrive", {});
    const entity = "fake_widget_b:1";
    registerSyncRetryHandler({
      provider: "gdrive",
      entityTypePrefix: "fake_widget_b:",
      handler: async () => ({ success: false as const, error: "still down" }),
    });

    await recordSyncFailure(conn, entity, "seed failure");
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, entity),
      ));

    const out = await processIntegrationSyncRetries();
    expect(out.failed).toBeGreaterThanOrEqual(1);
    const row = await getRow(conn.id, entity);
    expect(row.retryCount).toBe(2);
    expect(row.lastError).toBe("still down");
    expect(row.nextRetryAt).toBeTruthy();
  });

  it("pauses rows whose connection is no longer active", async () => {
    const conn = await makeConnection("onedrive", {});
    const entity = "fake_widget_c:1";
    registerSyncRetryHandler({
      provider: "onedrive",
      entityTypePrefix: "fake_widget_c:",
      handler: async () => ({ success: true as const }),
    });

    await recordSyncFailure(conn, entity, "outage");
    // Make the connection inactive.
    await db.update(integrationConnections)
      .set({ status: "disconnected" as any })
      .where(eq(integrationConnections.id, conn.id));
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, entity),
      ));

    const out = await processIntegrationSyncRetries();
    expect(out.skippedNoConnection).toBeGreaterThanOrEqual(1);
    const row = await getRow(conn.id, entity);
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastError).toBe("outage");
  });

  it("pauses rows that no provider claims a handler for", async () => {
    const conn = await makeConnection("dol_davis_bacon", { apiKey: "k" });
    const entity = "totally_unknown_entity:foo";

    await recordSyncFailure(conn, entity, "outage");
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, entity),
      ));

    const out = await processIntegrationSyncRetries();
    expect(out.skippedNoHandler).toBeGreaterThanOrEqual(1);
    const row = await getRow(conn.id, entity);
    expect(row.nextRetryAt).toBeNull();
  });

  it("respects MAX_SYNC_RETRIES and clears nextRetryAt for exhausted rows", async () => {
    const conn = await makeConnection("box", {});
    const entity = "fake_widget_d:1";
    registerSyncRetryHandler({
      provider: "box",
      entityTypePrefix: "fake_widget_d:",
      handler: async () => ({ success: true as const }),
    });

    // Insert a row that already hit the retry ceiling but somehow still
    // has a due nextRetryAt (e.g. migrated from an older codebase).
    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "old failure",
      lastAttemptAt: new Date(),
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: new Date(Date.now() - 60_000),
    });

    const out = await processIntegrationSyncRetries();
    expect(out.exhausted).toBeGreaterThanOrEqual(1);
    expect(out.attempted).toBe(0);
    const row = await getRow(conn.id, entity);
    expect(row.nextRetryAt).toBeNull();
  });
});

describe("QBO scheduled sync auto-retry", () => {
  it("invokes the QBO handler against parameterless scheduled operations", async () => {
    // Mock QBO chart-of-accounts fetch via the global fetch — the qbo
    // sync module uses `fetch` directly (see getQboBaseUrl/qboFetch).
    const realFetch = global.fetch;
    let attempts = 0;
    global.fetch = vi.fn(async () => {
      attempts++;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ QueryResponse: { Account: [{ Id: "1", Name: "Bank", AccountType: "Bank", Active: true }] } }),
      } as any;
    }) as any;

    try {
      const conn = await makeConnection("qbo", { realmId: "r", accessToken: "tok" });
      const entity = "qbo_sync:chart_of_accounts";

      // Seed a failure row that's due.
      await recordSyncFailure(conn, entity, "previous outage");
      await db.update(integrationSyncState)
        .set({ nextRetryAt: new Date(Date.now() - 60_000) })
        .where(and(
          eq(integrationSyncState.connectionId, conn.id),
          eq(integrationSyncState.entityType, entity),
        ));

      const out = await processIntegrationSyncRetries();
      expect(out.attempted).toBeGreaterThanOrEqual(1);
      expect(out.succeeded).toBeGreaterThanOrEqual(1);
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(out.byProvider["qbo"]).toMatchObject({ attempted: 1, succeeded: 1 });

      const row = await getRow(conn.id, entity);
      expect(row.lastError).toBeNull();
      expect(row.retryCount).toBe(0);
    } finally {
      global.fetch = realFetch;
    }
  });

  it("rejects unsupported QBO operations without re-firing them", async () => {
    const conn = await makeConnection("qbo", { realmId: "r", accessToken: "tok" });
    const entity = "qbo_sync:invoices"; // intentionally not in QBO_RETRYABLE_OPS

    await recordSyncFailure(conn, entity, "previous failure");
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, entity),
      ));

    const out = await processIntegrationSyncRetries();
    expect(out.failed).toBeGreaterThanOrEqual(1);
    const row = await getRow(conn.id, entity);
    expect(row.lastError).toContain("Unsupported QBO operation");
    expect(row.retryCount).toBe(2);
  });
});
