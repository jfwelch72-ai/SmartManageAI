// Task #1391 — Email/in-app fan-out to org admins the first time an
// integration sync row exhausts MAX_SYNC_RETRIES.
//
// Verifies:
//  - First exhaustion fires one notification per active org admin
//    (ADMIN + SUPER_ADMIN), skipping inactive admins and non-admin roles.
//  - The notification names the integration (display name), entity type,
//    and last error.
//  - integration_sync_state.exhausted_notified_at is stamped.
//  - A *repeat* call to recordSyncFailure on the same exhausted row
//    does NOT produce another notification (dedup by exhausted_notified_at).
//  - clearSyncRetryState (manual "Retry") re-arms the alert so a future
//    re-exhaustion produces a fresh notification.
//  - recordSyncSuccess clears the marker too.
//  - notifyAdminsOfExhaustedSyncRetry's atomic claim is a no-op on a row
//    that was already notified (concurrent caller).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  integrationSyncAlertMutes,
  notifications,
  notificationChannelPrefs,
  users,
} from "@shared/schema";

import {
  MAX_SYNC_RETRIES,
  recordSyncFailure,
  recordSyncSuccess,
  clearSyncRetryState,
} from "../integrations/syncRetry";
import { notifyAdminsOfExhaustedSyncRetry } from "../services/integrationSyncRetryNotifications";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const PREFIX = "__sr_exh__";

let orgId: string;
let priorEmailTransport: string | undefined;

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db.delete(notifications).where(eq(notifications.organizationId, id));
    await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, id));
    await db.delete(integrationSyncAlertMutes).where(eq(integrationSyncAlertMutes.organizationId, id));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, id));
    await db.delete(notificationChannelPrefs).where(
      sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${id})`,
    );
    await db.delete(users).where(eq(users.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

beforeAll(async () => {
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";
  await cleanup();
  const [org] = await db.insert(organizations).values({
    name: `${PREFIX}org`,
    slug: `${PREFIX}org-${Date.now()}`,
  }).returning();
  orgId = org.id;
});

afterAll(async () => {
  await cleanup();
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
});

beforeEach(async () => {
  await db.delete(notifications).where(eq(notifications.organizationId, orgId));
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, orgId));
  await db.delete(integrationSyncAlertMutes).where(eq(integrationSyncAlertMutes.organizationId, orgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
  );
  await db.delete(users).where(eq(users.organizationId, orgId));
});

async function makeUser(
  role: "ADMIN" | "SUPER_ADMIN" | "MANAGER" | "ESTIMATOR",
  suffix: string,
  isActive = true,
) {
  const [u] = await db.insert(users).values({
    organizationId: orgId,
    firstName: "Test",
    lastName: suffix,
    email: `${PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    role,
    isActive,
    passwordHash: "x",
  }).returning();
  return u;
}

async function makeConnection(displayName = "QuickBooks Online") {
  const [c] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: "qbo",
    status: "active",
    displayName,
    metadata: { realmId: "r", accessToken: "tok" },
  }).returning();
  return c;
}

async function getRow(connectionId: string, entityType: string) {
  const [row] = await db
    .select()
    .from(integrationSyncState)
    .where(sql`${integrationSyncState.connectionId} = ${connectionId} AND ${integrationSyncState.entityType} = ${entityType}`);
  return row;
}

async function fanRetriesUntilExhausted(connectionId: string, organizationId: string, entity: string) {
  const conn = { id: connectionId, organizationId };
  let last: Awaited<ReturnType<typeof recordSyncFailure>> | null = null;
  for (let i = 0; i < MAX_SYNC_RETRIES; i++) {
    last = await recordSyncFailure(conn, entity, `outage attempt ${i + 1}`);
  }
  return last!;
}

async function waitForRows<T>(fn: () => Promise<T[]>, atLeast: number, timeoutMs = 2000): Promise<T[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await fn();
    if (rows.length >= atLeast) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

describe("notifyAdminsOfExhaustedSyncRetry — direct", () => {
  it("fans one notification per active ADMIN/SUPER_ADMIN, skipping others", async () => {
    const adminA = await makeUser("ADMIN", "a");
    const superAdmin = await makeUser("SUPER_ADMIN", "su");
    await makeUser("MANAGER", "mgr"); // ignored
    await makeUser("ESTIMATOR", "est"); // ignored
    await makeUser("ADMIN", "inactive", false); // ignored — inactive

    const conn = await makeConnection("QuickBooks Online");
    const entity = "qbo_sync:chart_of_accounts";
    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "QBO 503 upstream down",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    });
    const row = await getRow(conn.id, entity);

    const out = await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "QBO 503 upstream down",
    });

    expect(out.notified).toBe(true);
    expect(out.recipients).toBe(2);

    const inserted = await waitForRows(
      async () =>
        await db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      2,
    );
    expect(inserted.length).toBe(2);
    const userIds = inserted.map((n) => n.userId).sort();
    expect(userIds).toEqual([adminA.id, superAdmin.id].sort());
    for (const n of inserted) {
      expect(n.type).toBe("INTEGRATION_SYNC_RETRIES_EXHAUSTED");
      expect(n.title).toContain("QuickBooks Online");
      expect(n.title).toContain(entity);
      expect(n.message).toContain("QBO 503 upstream down");
      expect(n.relatedEntityType).toBe("INTEGRATION_SYNC_STATE");
      expect(n.relatedEntityId).toBe(row.id);
    }

    const after = await getRow(conn.id, entity);
    expect(after.exhaustedNotifiedAt).toBeTruthy();

    // Second call (concurrent caller) is a no-op — atomic claim fails.
    const dup = await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "QBO 503 upstream down",
    });
    expect(dup.notified).toBe(false);
    expect(dup.recipients).toBe(0);

    const final = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(final.length).toBe(2); // unchanged
  });
});

describe("recordSyncFailure exhaustion → admin fan-out", () => {
  it("fires the admin notification on the failure that exhausts retries", async () => {
    await makeUser("ADMIN", "a");
    await makeUser("ADMIN", "b");
    const conn = await makeConnection();
    const entity = "qbo_sync:purchase_orders";

    const last = await fanRetriesUntilExhausted(conn.id, orgId, entity);
    expect(last.exhausted).toBe(true);
    expect(last.retryCount).toBe(MAX_SYNC_RETRIES);

    const inserted = await waitForRows(
      async () =>
        await db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      2,
    );
    expect(inserted.length).toBe(2);
    expect(inserted.every((n) => n.type === "INTEGRATION_SYNC_RETRIES_EXHAUSTED")).toBe(true);

    const row = await getRow(conn.id, entity);
    expect(row.exhaustedNotifiedAt).toBeTruthy();
    expect(row.lastError).toContain("outage attempt");
  });

  it("does not double-fire when recordSyncFailure runs again on an already-exhausted row", async () => {
    await makeUser("ADMIN", "a");
    const conn = await makeConnection();
    const entity = "qbo_sync:vendors";

    await fanRetriesUntilExhausted(conn.id, orgId, entity);
    await waitForRows(
      async () =>
        await db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    const before = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(before.length).toBe(1);

    // Another failure on the same exhausted row (e.g. someone manually
    // re-running the sync without clearing retry state) must NOT fire a
    // second notification.
    await recordSyncFailure({ id: conn.id, organizationId: orgId }, entity, "still down");
    await new Promise((r) => setTimeout(r, 100));
    const after = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(after.length).toBe(1);
  });

  it("re-arms the alert after manual clearSyncRetryState so a future exhaustion re-fires", async () => {
    await makeUser("ADMIN", "a");
    const conn = await makeConnection();
    const entity = "qbo_sync:invoices_a";

    await fanRetriesUntilExhausted(conn.id, orgId, entity);
    await waitForRows(
      async () => await db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    expect((await getRow(conn.id, entity)).exhaustedNotifiedAt).toBeTruthy();

    // Manual retry — clears the marker.
    await clearSyncRetryState({ id: conn.id, organizationId: orgId }, entity);
    expect((await getRow(conn.id, entity)).exhaustedNotifiedAt).toBeNull();

    // Re-exhaust — fresh notification should fan out.
    await fanRetriesUntilExhausted(conn.id, orgId, entity);
    await waitForRows(
      async () => await db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      2,
    );
    const all = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(all.length).toBe(2);
  });

  it("clears the exhausted-notified marker on recordSyncSuccess", async () => {
    await makeUser("ADMIN", "a");
    const conn = await makeConnection();
    const entity = "qbo_sync:items";

    await fanRetriesUntilExhausted(conn.id, orgId, entity);
    await waitForRows(
      async () => await db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    await recordSyncSuccess({ id: conn.id, organizationId: orgId }, entity);
    const row = await getRow(conn.id, entity);
    expect(row.exhaustedNotifiedAt).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.lastError).toBeNull();
  });

  // Task #1404 — mute fan-out for a chronically broken integration.
  it("suppresses fan-out when an entity-scoped mute is active, still stamps the marker", async () => {
    const admin = await makeUser("ADMIN", "a");
    const conn = await makeConnection("QuickBooks Online");
    const entity = "qbo_sync:customers";

    await db.insert(integrationSyncAlertMutes).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      mutedByUserId: admin.id,
      reason: "triage",
    });

    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "upstream 500",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    });
    const row = await getRow(conn.id, entity);

    const out = await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "upstream 500",
    });

    expect(out.muted).toBe(true);
    expect(out.notified).toBe(true);
    expect(out.recipients).toBe(0);

    await new Promise((r) => setTimeout(r, 50));
    const notes = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(notes.length).toBe(0);

    const after = await getRow(conn.id, entity);
    expect(after.exhaustedNotifiedAt).toBeTruthy();
  });

  it("suppresses fan-out when a connection-wide mute is active (entityType IS NULL matches all)", async () => {
    const admin = await makeUser("ADMIN", "a");
    const conn = await makeConnection("QuickBooks Online");
    const entity = "qbo_sync:estimates";

    await db.insert(integrationSyncAlertMutes).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: null,
      mutedByUserId: admin.id,
    });

    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "upstream 500",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    });
    const row = await getRow(conn.id, entity);

    const out = await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "upstream 500",
    });

    expect(out.muted).toBe(true);
    expect(out.recipients).toBe(0);
    const notes = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(notes.length).toBe(0);
  });

  it("succeeds quietly when the org has no admins", async () => {
    // No admin users created.
    const conn = await makeConnection();
    const entity = "qbo_sync:bills";

    const last = await fanRetriesUntilExhausted(conn.id, orgId, entity);
    expect(last.exhausted).toBe(true);

    const all = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(all.length).toBe(0);
    // Marker is still stamped so we don't re-attempt fan-out forever.
    const row = await getRow(conn.id, entity);
    expect(row.exhaustedNotifiedAt).toBeTruthy();
  });
});
