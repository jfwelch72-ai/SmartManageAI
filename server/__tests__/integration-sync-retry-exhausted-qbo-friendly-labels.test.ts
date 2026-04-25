// Task #1945 — Friendly QuickBooks entity labels (customer name /
// "Pay app #N — projectCode" / "Pay run #N") in admin emails + digests
// when a `qbo_sync:%` integration_sync_state row exhausts its retry
// budget. Without this enrichment, admins receive an opaque uuid and
// have to copy-paste it back into the app to find the affected record.
//
// Verifies:
//  * resolveQboEntityLabels resolves customer / invoice / payroll /
//    certified_payroll subKinds to (displayName, link) pairs scoped to
//    the same org, and falls back to the raw entityType for orphan IDs
//    (record was deleted) without throwing.
//  * notifyAdminsOfExhaustedSyncRetry uses the resolved displayName in
//    title + body when available; orphan IDs render the existing
//    kindLabel + itemId fallback.
//  * backfillExhaustedSyncRetryAlerts batches one resolver call per
//    (org, connection) group and renders entries as
//    "<displayName> (<entityType>)" — keeping the raw token in parens
//    so existing test assertions and grep-style log searches still
//    work — and falls back to the raw entityType for orphans.
//  * composeEmailContent renders a secondary "Open <recordLabel>" CTA
//    pointing at the deep link (/crm, /progress-billing,
//    /payroll-management) when the record was resolvable, and omits it
//    for orphans / non-QBO providers.

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
  crmOrganisations,
  payApplications,
  payRuns,
  projects,
  scheduleOfValues,
} from "@shared/schema";

import { MAX_SYNC_RETRIES } from "../integrations/syncRetry";
import {
  notifyAdminsOfExhaustedSyncRetry,
  backfillExhaustedSyncRetryAlerts,
} from "../services/integrationSyncRetryNotifications";
import {
  resolveQboEntityLabel,
  resolveQboEntityLabels,
} from "../services/qboEntityLabels";
import { composeEmailContent } from "../services/notificationDelivery";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const PREFIX = "__sr_friendly__";

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
    await db.delete(payApplications).where(eq(payApplications.organizationId, id));
    await db.delete(scheduleOfValues).where(eq(scheduleOfValues.organizationId, id));
    await db.delete(payRuns).where(eq(payRuns.organizationId, id));
    await db.delete(crmOrganisations).where(eq(crmOrganisations.organizationId, id));
    await db.delete(notificationChannelPrefs).where(
      sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${id})`,
    );
    await db.delete(users).where(eq(users.organizationId, id));
    // projects don't carry organizationId; clean by code prefix instead.
    await db.delete(projects).where(sql`${projects.code} LIKE ${PREFIX + "%"}`);
    await db.delete(organizations).where(eq(organizations.id, id));
  }
  // Sweep any orphaned projects from prior runs that share our prefix.
  await db.delete(projects).where(sql`${projects.code} LIKE ${PREFIX + "%"}`);
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
  await db.delete(payApplications).where(eq(payApplications.organizationId, orgId));
  await db.delete(scheduleOfValues).where(eq(scheduleOfValues.organizationId, orgId));
  await db.delete(payRuns).where(eq(payRuns.organizationId, orgId));
  await db.delete(crmOrganisations).where(eq(crmOrganisations.organizationId, orgId));
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
  );
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(projects).where(sql`${projects.code} LIKE ${PREFIX + "%"}`);
});

let userIdCounter = 0;
async function makeUser(role: "ADMIN" | "SUPER_ADMIN" = "ADMIN") {
  userIdCounter += 1;
  const [u] = await db.insert(users).values({
    organizationId: orgId,
    firstName: "T",
    lastName: `u${userIdCounter}`,
    email: `${PREFIX}u${userIdCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    role,
    isActive: true,
    passwordHash: "x",
  }).returning();
  return u;
}

async function makeQboConnection(displayName = "QuickBooks Online") {
  const [c] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: "qbo",
    status: "active",
    displayName,
    metadata: { realmId: "r", accessToken: "tok" },
  }).returning();
  return c;
}

async function makeCustomer(name: string) {
  const [o] = await db.insert(crmOrganisations).values({
    organizationId: orgId,
    type: "OWNER_REP",
    name,
  }).returning();
  return o;
}

async function makeProject(code: string, name: string) {
  const [p] = await db.insert(projects).values({
    name,
    code: `${PREFIX}${code}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    clientName: "Client",
  }).returning();
  return p;
}

async function makePayApplication(projectId: string, applicationNumber: number) {
  const [sov] = await db.insert(scheduleOfValues).values({
    organizationId: orgId,
    projectId,
    sovNumber: `SOV-${applicationNumber}`,
    title: "T",
    contractValue: "0",
  }).returning();
  const [pa] = await db.insert(payApplications).values({
    organizationId: orgId,
    projectId,
    sovId: sov.id,
    applicationNumber,
  }).returning();
  return pa;
}

async function makePayRun(runNumber: string | null, periodStart = "2025-01-01", periodEnd = "2025-01-15") {
  const creator = await makeUser("ADMIN");
  const [pr] = await db.insert(payRuns).values({
    organizationId: orgId,
    payPeriodStart: periodStart,
    payPeriodEnd: periodEnd,
    runNumber,
    createdById: creator.id,
  }).returning();
  return pr;
}

describe("resolveQboEntityLabels (Task #1945)", () => {
  it("resolves customer entityType to {displayName, link} scoped to /crm", async () => {
    const cust = await makeCustomer("Acme Holdings, Inc.");
    const et = `qbo_sync:customer:${cust.id}`;
    const map = await resolveQboEntityLabels(orgId, [et]);
    expect(map.get(et)).toEqual({
      subKind: "customer",
      itemId: cust.id,
      displayName: "Acme Holdings, Inc.",
      link: `/crm?organisationId=${encodeURIComponent(cust.id)}`,
    });
  });

  it("resolves invoice entityType to 'Pay app #N — projectCode' with /progress-billing link", async () => {
    const proj = await makeProject("PROJ123", "Downtown Tower");
    const pa = await makePayApplication(proj.id, 7);
    const et = `qbo_sync:invoice:${pa.id}`;
    const resolved = await resolveQboEntityLabel(orgId, et);
    expect(resolved).not.toBeNull();
    expect(resolved!.subKind).toBe("invoice");
    expect(resolved!.displayName).toBe(`Pay app #7 — ${proj.code}`);
    expect(resolved!.link).toBe(`/progress-billing?payApplicationId=${encodeURIComponent(pa.id)}`);
  });

  it("resolves payroll entityType to 'Pay run #runNumber' with /payroll-management link", async () => {
    const run = await makePayRun("PR-45");
    const et = `qbo_sync:payroll:${run.id}`;
    const resolved = await resolveQboEntityLabel(orgId, et);
    expect(resolved!.subKind).toBe("payroll");
    expect(resolved!.displayName).toBe("Pay run #PR-45");
    expect(resolved!.link).toBe(`/payroll-management?payRunId=${encodeURIComponent(run.id)}`);
  });

  it("resolves certified_payroll entityType to 'Certified pay run #runNumber'", async () => {
    const run = await makePayRun("CR-3");
    const resolved = await resolveQboEntityLabel(orgId, `qbo_sync:certified_payroll:${run.id}`);
    expect(resolved!.subKind).toBe("certified_payroll");
    expect(resolved!.displayName).toBe("Certified pay run #CR-3");
  });

  it("falls back to period range for pay runs without a runNumber", async () => {
    const run = await makePayRun(null, "2025-02-01", "2025-02-15");
    const resolved = await resolveQboEntityLabel(orgId, `qbo_sync:payroll:${run.id}`);
    expect(resolved!.displayName).toBe("Pay run 2025-02-01 – 2025-02-15");
  });

  it("returns null (orphan) for an unknown id without throwing", async () => {
    const resolved = await resolveQboEntityLabel(
      orgId,
      "qbo_sync:customer:00000000-0000-0000-0000-000000000000",
    );
    expect(resolved).toBeNull();
  });

  it("does not cross orgs — customer in another org is treated as an orphan", async () => {
    // A customer whose row exists, but in a different org. Lookup must
    // be scoped by organizationId so we don't leak labels across tenants.
    const [otherOrg] = await db.insert(organizations).values({
      name: `${PREFIX}other`,
      slug: `${PREFIX}other-${Date.now()}`,
    }).returning();
    try {
      const [foreign] = await db.insert(crmOrganisations).values({
        organizationId: otherOrg.id,
        type: "OWNER_REP",
        name: "Foreign Co",
      }).returning();
      const resolved = await resolveQboEntityLabel(
        orgId,
        `qbo_sync:customer:${foreign.id}`,
      );
      expect(resolved).toBeNull();
    } finally {
      await db.delete(crmOrganisations).where(eq(crmOrganisations.organizationId, otherOrg.id));
      await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
    }
  });

  it("returns null for non-per-item entityTypes (bare ops, non-qbo providers)", async () => {
    expect(await resolveQboEntityLabel(orgId, "qbo_sync:chart_of_accounts")).toBeNull();
    expect(await resolveQboEntityLabel(orgId, "qbo_sync:customers")).toBeNull();
    expect(await resolveQboEntityLabel(orgId, "dol_wage_decision:CA-2024-01")).toBeNull();
  });

  it("batches mixed entity types into one map", async () => {
    const cust = await makeCustomer("Acme");
    const proj = await makeProject("MIX1", "Mixed");
    const pa = await makePayApplication(proj.id, 2);
    const run = await makePayRun("PR-9");
    const ets = [
      `qbo_sync:customer:${cust.id}`,
      `qbo_sync:invoice:${pa.id}`,
      `qbo_sync:payroll:${run.id}`,
      "qbo_sync:customer:missing-id",
    ];
    const map = await resolveQboEntityLabels(orgId, ets);
    expect(map.size).toBe(3);
    expect(map.get(ets[0])!.displayName).toBe("Acme");
    expect(map.get(ets[1])!.displayName).toBe(`Pay app #2 — ${proj.code}`);
    expect(map.get(ets[2])!.displayName).toBe("Pay run #PR-9");
    expect(map.has(ets[3])).toBe(false);
  });
});

async function waitForRows<T>(fn: () => Promise<T[]>, atLeast: number, timeoutMs = 2000): Promise<T[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await fn();
    if (rows.length >= atLeast) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

describe("notifyAdminsOfExhaustedSyncRetry — friendly QBO labels (Task #1945)", () => {
  it("uses the resolved customer name in the title + body", async () => {
    await makeUser("ADMIN");
    const conn = await makeQboConnection();
    const cust = await makeCustomer("Acme Holdings, Inc.");
    const entity = `qbo_sync:customer:${cust.id}`;
    const [row] = await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "QBO 503",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    }).returning();

    const out = await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "QBO 503",
    });
    expect(out.notified).toBe(true);

    const [n] = await waitForRows(
      () => db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    expect(n.title).toContain("Acme Holdings, Inc.");
    expect(n.title).toContain(entity); // raw token kept in parens
    expect(n.message).toContain("Acme Holdings, Inc.");
    expect(n.message).toContain(`(id ${cust.id})`);
  });

  it("uses 'Pay app #N — projectCode' for invoice rows", async () => {
    await makeUser("ADMIN");
    const conn = await makeQboConnection();
    const proj = await makeProject("PROJ7", "Tower");
    const pa = await makePayApplication(proj.id, 12);
    const entity = `qbo_sync:invoice:${pa.id}`;
    const [row] = await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "boom",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    }).returning();

    await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "boom",
    });
    const [n] = await waitForRows(
      () => db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    expect(n.title).toContain(`Pay app #12 — ${proj.code}`);
    expect(n.message).toContain(`Pay app #12 — ${proj.code}`);
  });

  it("falls back to the raw kindLabel + itemId for orphan IDs", async () => {
    await makeUser("ADMIN");
    const conn = await makeQboConnection();
    const orphanId = "00000000-0000-0000-0000-000000000000";
    const entity = `qbo_sync:customer:${orphanId}`;
    const [row] = await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "gone",
      retryCount: MAX_SYNC_RETRIES,
      nextRetryAt: null,
    }).returning();

    await notifyAdminsOfExhaustedSyncRetry({
      syncStateId: row.id,
      organizationId: orgId,
      connectionId: conn.id,
      entityType: entity,
      lastError: "gone",
    });
    const [n] = await waitForRows(
      () => db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    // Falls through to the kindLabel + itemId rendering — not the
    // friendly displayName (since there's no record to resolve).
    expect(n.title).toContain(`Customer ${orphanId}`);
    expect(n.message).toContain(`this customer`);
    expect(n.message).toContain(`(id ${orphanId})`);
  });
});

describe("backfillExhaustedSyncRetryAlerts — friendly QBO labels (Task #1945)", () => {
  it("renders '<displayName> (<entityType>)' for resolvable rows and bare entityType for orphans", async () => {
    await makeUser("ADMIN");
    const conn = await makeQboConnection();
    const cust = await makeCustomer("Beta Builders");
    const proj = await makeProject("BIZ", "Biz");
    const pa = await makePayApplication(proj.id, 4);
    const run = await makePayRun("PR-2");
    const orphanCustomer = "00000000-0000-0000-0000-000000000000";
    const entries = [
      `qbo_sync:customer:${cust.id}`,
      `qbo_sync:invoice:${pa.id}`,
      `qbo_sync:payroll:${run.id}`,
      `qbo_sync:customer:${orphanCustomer}`,
    ];
    const now = new Date();
    for (const entity of entries) {
      await db.insert(integrationSyncState).values({
        organizationId: orgId,
        connectionId: conn.id,
        entityType: entity,
        lastError: "outage",
        retryCount: MAX_SYNC_RETRIES,
        nextRetryAt: null,
        // Backfill only picks up rows whose retries are exhausted but
        // were never notified (exhausted_notified_at IS NULL) — the
        // default insert leaves this null.
        updatedAt: now,
      });
    }

    const result = await backfillExhaustedSyncRetryAlerts();
    expect(result.groupsNotified).toBeGreaterThanOrEqual(1);

    const [n] = await waitForRows(
      () => db.select().from(notifications).where(eq(notifications.organizationId, orgId)),
      1,
    );
    expect(n.title).toContain("4 entities");

    // Resolved rows: friendly displayName + raw entityType in parens.
    expect(n.message).toContain(`Beta Builders (qbo_sync:customer:${cust.id})`);
    expect(n.message).toContain(`Pay app #4 — ${proj.code} (qbo_sync:invoice:${pa.id})`);
    expect(n.message).toContain(`Pay run #PR-2 (qbo_sync:payroll:${run.id})`);
    // Orphan row: raw entityType only, no parens wrapper around a label.
    expect(n.message).toContain(`qbo_sync:customer:${orphanCustomer}`);
    expect(n.message).not.toContain(`undefined (qbo_sync:customer:${orphanCustomer})`);
  });
});

describe("composeEmailContent — secondary 'Open <recordLabel>' CTA (Task #1945)", () => {
  const baseNotification = {
    id: "notif-1",
    userId: "user-admin",
    type: "INTEGRATION_SYNC_RETRIES_EXHAUSTED" as const,
    title: "Integration sync gave up: QuickBooks Online — Acme Holdings, Inc. (qbo_sync:customer:cust-1)",
    message:
      "QuickBooks ran out of automatic retries while syncing Acme Holdings, Inc. (id cust-1). Last error: QBO 503...",
    relatedEntityId: "sync-state-7",
    relatedEntityType: "INTEGRATION_SYNC_STATE",
  };

  it("renders the 'Open <recordLabel>' button pointing at the deep link when ctx provides recordLink + recordLabel", () => {
    const result = composeEmailContent(baseNotification, {
      integrationSyncContext: {
        connectionId: "conn-qbo",
        entityType: "qbo_sync:customer:cust-1",
        integrationLabel: "QuickBooks Online",
        provider: "qbo",
        recordLink: "/crm?organisationId=cust-1",
        recordLabel: "Acme Holdings, Inc.",
      },
    });
    expect(result.html).toContain("/crm?organisationId=cust-1");
    expect(result.html).toContain("Open Acme Holdings, Inc.");
    expect(result.html).toContain("link-integration-sync-exhausted-record");
  });

  it("omits the secondary CTA when recordLink is not provided (orphan ID)", () => {
    const result = composeEmailContent(baseNotification, {
      integrationSyncContext: {
        connectionId: "conn-qbo",
        entityType: "qbo_sync:customer:cust-1",
        integrationLabel: "QuickBooks Online",
        provider: "qbo",
      },
    });
    expect(result.html).not.toContain("link-integration-sync-exhausted-record");
    expect(result.html).not.toContain("Open Acme Holdings");
  });

  it("escapes HTML special characters in the recordLabel", () => {
    const result = composeEmailContent(baseNotification, {
      integrationSyncContext: {
        connectionId: "conn-qbo",
        entityType: "qbo_sync:customer:cust-1",
        integrationLabel: "QuickBooks Online",
        provider: "qbo",
        recordLink: "/crm?organisationId=cust-1",
        recordLabel: "Acme & Sons <Inc.>",
      },
    });
    expect(result.html).toContain("Open Acme &amp; Sons &lt;Inc.&gt;");
    expect(result.html).not.toContain("Open Acme & Sons <Inc.>");
  });
});
