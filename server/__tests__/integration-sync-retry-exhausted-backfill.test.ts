// Task #1405 — Backfill of "integration sync gave up" alerts for sync rows
// that were already exhausted before the Task #1391 notification feature
// shipped.
//
// Verifies:
//  - Pre-existing exhausted rows (retry_count >= MAX_SYNC_RETRIES,
//    exhausted_notified_at IS NULL) are claimed and stamped.
//  - One *summary* notification per (organization, connection) is emitted to
//    every active org admin.
//  - Rows that were already notified are ignored.
//  - Rows whose retry_count is below MAX are ignored.
//  - A second backfill run is a no-op (every candidate has been claimed).
//  - The atomic claim survives a concurrent re-run.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  notifications,
  notificationChannelPrefs,
  users,
} from "@shared/schema";

import { MAX_SYNC_RETRIES } from "../integrations/syncRetry";
import { backfillExhaustedSyncRetryAlerts } from "../services/integrationSyncRetryNotifications";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const PREFIX = "__sr_bf__";

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
  const [org] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}org`, slug: `${PREFIX}org-${Date.now()}` })
    .returning();
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
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
  );
  await db.delete(users).where(eq(users.organizationId, orgId));
});

async function makeUser(role: "ADMIN" | "SUPER_ADMIN" | "MANAGER", suffix: string, isActive = true) {
  const [u] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Bf",
      lastName: suffix,
      email: `${PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
      role,
      isActive,
      passwordHash: "x",
    })
    .returning();
  return u;
}

async function makeConnection(displayName: string) {
  const [c] = await db
    .insert(integrationConnections)
    .values({
      organizationId: orgId,
      provider: "qbo",
      status: "active",
      displayName,
      metadata: { realmId: "r", accessToken: "tok" },
    })
    .returning();
  return c;
}

async function insertExhaustedRow(
  connectionId: string,
  entityType: string,
  opts: { lastError?: string | null; alreadyNotified?: boolean; retryCount?: number } = {},
) {
  const [row] = await db
    .insert(integrationSyncState)
    .values({
      organizationId: orgId,
      connectionId,
      entityType,
      lastError: opts.lastError ?? "stale failure",
      retryCount: opts.retryCount ?? MAX_SYNC_RETRIES,
      nextRetryAt: null,
      exhaustedNotifiedAt: opts.alreadyNotified ? new Date() : null,
    })
    .returning();
  return row;
}

describe("backfillExhaustedSyncRetryAlerts", () => {
  it("emits one summary notification per (org, connection) and stamps every claimed row", async () => {
    const adminA = await makeUser("ADMIN", "a");
    const superAdmin = await makeUser("SUPER_ADMIN", "su");
    await makeUser("MANAGER", "mgr"); // ignored
    await makeUser("ADMIN", "inactive", false); // ignored

    const conn = await makeConnection("QuickBooks Online");
    const r1 = await insertExhaustedRow(conn.id, "qbo_sync:invoices", { lastError: "QBO 503" });
    const r2 = await insertExhaustedRow(conn.id, "qbo_sync:vendors");
    const r3 = await insertExhaustedRow(conn.id, "qbo_sync:bills");

    const stats = await backfillExhaustedSyncRetryAlerts();
    expect(stats.claimedRows).toBe(3);
    expect(stats.groupsNotified).toBe(1);
    expect(stats.groupsWithoutAdmins).toBe(0);
    expect(stats.recipients).toBe(2);

    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId));
    expect(inserted.length).toBe(2);
    const userIds = inserted.map((n) => n.userId).sort();
    expect(userIds).toEqual([adminA.id, superAdmin.id].sort());
    for (const n of inserted) {
      expect(n.type).toBe("INTEGRATION_SYNC_RETRIES_EXHAUSTED");
      expect(n.title).toContain("QuickBooks Online");
      expect(n.title).toContain("3 entities");
      expect(n.message).toContain("qbo_sync:invoices");
      expect(n.message).toContain("qbo_sync:vendors");
      expect(n.message).toContain("qbo_sync:bills");
      expect(n.message).toContain("QBO 503");
      expect(n.relatedEntityType).toBe("INTEGRATION_SYNC_STATE");
      expect([r1.id, r2.id, r3.id]).toContain(n.relatedEntityId!);
    }

    for (const id of [r1.id, r2.id, r3.id]) {
      const [row] = await db
        .select()
        .from(integrationSyncState)
        .where(eq(integrationSyncState.id, id));
      expect(row.exhaustedNotifiedAt).toBeTruthy();
    }
  });

  it("emits a separate summary per integration connection within the same org", async () => {
    await makeUser("ADMIN", "a");

    const connQbo = await makeConnection("QuickBooks Online");
    const connDot = await makeConnection("DOT Wage Decisions");
    await insertExhaustedRow(connQbo.id, "qbo_sync:invoices");
    await insertExhaustedRow(connDot.id, "dot_wage_decision:CA-2024-01");
    await insertExhaustedRow(connDot.id, "dot_wage_decision:CA-2024-02");

    const stats = await backfillExhaustedSyncRetryAlerts();
    expect(stats.claimedRows).toBe(3);
    expect(stats.groupsNotified).toBe(2);
    expect(stats.recipients).toBe(2);

    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId));
    expect(inserted.length).toBe(2);
    const titles = inserted.map((n) => n.title).sort();
    expect(titles[0]).toContain("DOT Wage Decisions");
    expect(titles[0]).toContain("2 entities");
    expect(titles[1]).toContain("QuickBooks Online");
    expect(titles[1]).toContain("qbo_sync:invoices");
  });

  it("skips rows already notified or not yet exhausted", async () => {
    await makeUser("ADMIN", "a");

    const conn = await makeConnection("QBO");
    await insertExhaustedRow(conn.id, "qbo_sync:notify_me");
    await insertExhaustedRow(conn.id, "qbo_sync:already_notified", { alreadyNotified: true });
    await insertExhaustedRow(conn.id, "qbo_sync:still_retrying", { retryCount: 1 });

    const stats = await backfillExhaustedSyncRetryAlerts();
    expect(stats.claimedRows).toBe(1);
    expect(stats.groupsNotified).toBe(1);
    expect(stats.recipients).toBe(1);

    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId));
    expect(inserted.length).toBe(1);
    expect(inserted[0].message).toContain("qbo_sync:notify_me");
  });

  it("is a no-op on a second run (every candidate already claimed)", async () => {
    await makeUser("ADMIN", "a");
    const conn = await makeConnection("QBO");
    await insertExhaustedRow(conn.id, "qbo_sync:invoices");

    const first = await backfillExhaustedSyncRetryAlerts();
    expect(first.claimedRows).toBe(1);
    expect(first.recipients).toBe(1);

    const second = await backfillExhaustedSyncRetryAlerts();
    expect(second.claimedRows).toBe(0);
    expect(second.groupsNotified).toBe(0);
    expect(second.recipients).toBe(0);

    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId));
    expect(inserted.length).toBe(1);
  });

  it("stamps the marker even when the org has no admins so future runs skip", async () => {
    const conn = await makeConnection("QBO");
    const row = await insertExhaustedRow(conn.id, "qbo_sync:lonely");

    const stats = await backfillExhaustedSyncRetryAlerts();
    expect(stats.claimedRows).toBe(1);
    expect(stats.groupsWithoutAdmins).toBe(1);
    expect(stats.groupsNotified).toBe(0);
    expect(stats.recipients).toBe(0);

    const [after] = await db
      .select()
      .from(integrationSyncState)
      .where(eq(integrationSyncState.id, row.id));
    expect(after.exhaustedNotifiedAt).toBeTruthy();

    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId));
    expect(inserted.length).toBe(0);
  });

  it("survives concurrent runs without duplicating notifications", async () => {
    await makeUser("ADMIN", "a");
    const conn = await makeConnection("QBO");
    await insertExhaustedRow(conn.id, "qbo_sync:race1");
    await insertExhaustedRow(conn.id, "qbo_sync:race2");

    const [a, b] = await Promise.all([
      backfillExhaustedSyncRetryAlerts(),
      backfillExhaustedSyncRetryAlerts(),
    ]);
    const totalClaimed = a.claimedRows + b.claimedRows;
    const totalRecipients = a.recipients + b.recipients;
    expect(totalClaimed).toBe(2);
    // Whichever caller wins the atomic UPDATE delivers — the other sees zero.
    expect(totalRecipients).toBeLessThanOrEqual(1);

    const inserted = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, orgId));
    expect(inserted.length).toBeLessThanOrEqual(1);
  });
});
