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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  users,
  projects,
  payRuns,
  payRunLineItems,
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
    // Pay-run rows + their line items (cascade via pay_run_id) only exist
    // for the QBO payroll/certified-payroll dispatch tests below; clean
    // them out before the cascading org delete so the cleanup keeps
    // working even if Drizzle's cascade order changes.
    await db.delete(payRuns).where(eq(payRuns.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
  // Users + projects don't cascade off the org delete (users.organizationId
  // is `set null`, projects has no FK back to org). Wipe by the same
  // PREFIX so reruns don't accumulate orphans or trip the unique
  // constraints on `users.email` / `projects.code`.
  await db.execute(sql`DELETE FROM ${users} WHERE email LIKE ${PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM ${projects} WHERE code LIKE ${PREFIX + "%"}`);
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

// Task #1393 — payload-bearing QBO retries (Task #1377). The generic
// retry sweep keys these rows as `qbo_sync:<kind>:<localId>` and reads
// the original push payload from `metadata.payload`. These tests cover
// each kind end-to-end so a future refactor of the entity-type encoding
// or the metadata payload format can't silently break replay.
describe("QBO payload-bearing scheduled sync auto-retry", () => {
  type FetchCall = { url: string; method: string; body?: any };
  let realFetch: typeof global.fetch;
  let fetchCalls: FetchCall[];

  beforeEach(() => {
    realFetch = global.fetch;
    fetchCalls = [];
    // Generic recorder that returns 200 OK for any QBO POST. Tests that
    // care about the response shape do their own assertions on the
    // captured calls.
    global.fetch = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();
      let body: any = undefined;
      if (init.body) {
        try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
      }
      fetchCalls.push({ url, method, body });

      // Default success payloads keyed by endpoint suffix.
      if (/\/invoice(\?|$)/.test(url) && method === "POST") {
        return { ok: true, status: 200, text: async () => "", json: async () => ({ Invoice: { Id: "QBO-INV-1" } }) } as any;
      }
      if (/\/customer(\?|$)/.test(url) && method === "POST") {
        return { ok: true, status: 200, text: async () => "", json: async () => ({ Customer: { Id: "QBO-CUST-1" } }) } as any;
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) } as any;
    }) as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  async function seedDueFailure(
    conn: Awaited<ReturnType<typeof makeConnection>>,
    entity: string,
    payload: any,
  ) {
    await recordSyncFailure(conn, entity, "previous push failed", {
      metadata: payload === undefined ? undefined : { payload },
    });
    await db.update(integrationSyncState)
      .set({ nextRetryAt: new Date(Date.now() - 60_000) })
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, entity),
      ));
  }

  it("dispatches a qbo_sync:invoice failure row to exportInvoice using metadata.payload", async () => {
    const conn = await makeConnection("qbo", { realmId: "r1", accessToken: "tok" });
    const localInvoiceId = "INV-LOCAL-1";
    const entity = `qbo_sync:invoice:${localInvoiceId}`;
    const payload = {
      customerRef: "CUST-99",
      lineItems: [{ description: "Concrete pour", amount: 1500 }],
      dueDate: "2026-05-01",
      docNumber: "TEST-0001",
      localInvoiceId,
    };

    await seedDueFailure(conn, entity, payload);

    const out = await processIntegrationSyncRetries();
    expect(out.attempted).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBeGreaterThanOrEqual(1);
    expect(out.byProvider["qbo"]).toMatchObject({ attempted: 1, succeeded: 1 });

    const invoicePosts = fetchCalls.filter(
      (c) => c.method === "POST" && /\/v3\/company\/r1\/invoice(\?|$)/.test(c.url),
    );
    expect(invoicePosts.length).toBe(1);
    expect(invoicePosts[0].body.CustomerRef.value).toBe("CUST-99");
    expect(invoicePosts[0].body.DocNumber).toBe("TEST-0001");
    expect(invoicePosts[0].body.DueDate).toBe("2026-05-01");
    expect(Array.isArray(invoicePosts[0].body.Line)).toBe(true);
    expect(invoicePosts[0].body.Line[0].Description).toBe("Concrete pour");
    expect(invoicePosts[0].body.Line[0].Amount).toBe(1500);

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
  });

  it("dispatches a qbo_sync:customer failure row to exportCustomers using metadata.payload", async () => {
    const conn = await makeConnection("qbo", { realmId: "r1", accessToken: "tok" });
    const localCustomerId = "CUST-LOCAL-1";
    const entity = `qbo_sync:customer:${localCustomerId}`;
    const payload = {
      id: localCustomerId,
      name: "Acme Construction LLC",
      email: "ap@acme.example",
      phone: "555-0100",
    };

    await seedDueFailure(conn, entity, payload);

    const out = await processIntegrationSyncRetries();
    expect(out.attempted).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBeGreaterThanOrEqual(1);
    expect(out.byProvider["qbo"]).toMatchObject({ attempted: 1, succeeded: 1 });

    const customerPosts = fetchCalls.filter(
      (c) => c.method === "POST" && /\/v3\/company\/r1\/customer(\?|$)/.test(c.url),
    );
    expect(customerPosts.length).toBe(1);
    expect(customerPosts[0].body.DisplayName).toBe("Acme Construction LLC");
    expect(customerPosts[0].body.PrimaryEmailAddr.Address).toBe("ap@acme.example");
    expect(customerPosts[0].body.PrimaryPhone.FreeFormNumber).toBe("555-0100");

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
  });

  // Seed an org-scoped user, project, pay run + line items, and a QBO
  // chart-of-accounts state with both an Expense and a Liability account.
  // Used by the payroll / certified-payroll dispatch tests so the QBO
  // export functions can run end-to-end and POST a journal entry —
  // letting the tests verify dispatch via the *unique* `PrivateNote`
  // shape each function emits (mis-routing fails the assertion).
  async function seedPayRunFixture(connectionId: string, runNumber: string) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db.insert(users).values({
      organizationId: orgId,
      firstName: "Sync",
      lastName: "Worker",
      email: `${PREFIX}user-${stamp}@example.test`,
    }).returning();
    const [project] = await db.insert(projects).values({
      name: `${PREFIX}Project ${stamp}`,
      code: `${PREFIX}P-${stamp}`,
      clientName: "Sync Client",
    }).returning();
    const [payRun] = await db.insert(payRuns).values({
      organizationId: orgId,
      payPeriodStart: "2026-04-01",
      payPeriodEnd: "2026-04-15",
      status: "APPROVED",
      runNumber,
      createdById: user.id,
    }).returning();
    await db.insert(payRunLineItems).values({
      payRunId: payRun.id,
      userId: user.id,
      projectId: project.id,
      costCode: "01-100",
      regularHours: "40",
      overtimeHours: "0",
      regularRate: "50",
      totalAmount: "2000",
      grossAmount: "2000",
    });
    await db.insert(integrationSyncState).values({
      organizationId: orgId,
      connectionId,
      entityType: "chart_of_accounts",
      metadata: {
        accounts: [
          { qboId: "100", name: "Direct Labor", classification: "Expense", active: true },
          { qboId: "200", name: "Payroll Liabilities", classification: "Liability", accountType: "Other Current Liability", active: true },
        ],
      },
      lastSyncAt: new Date(),
    });
    return { payRun, user, project };
  }

  it("dispatches a qbo_sync:payroll failure row to exportPayroll (not exportCertifiedPayroll)", async () => {
    const conn = await makeConnection("qbo", { realmId: "r1", accessToken: "tok" });
    const { payRun } = await seedPayRunFixture(conn.id, "RN-PAY-1");
    const entity = `qbo_sync:payroll:${payRun.id}`;

    await seedDueFailure(conn, entity, { payRunId: payRun.id });

    const out = await processIntegrationSyncRetries();
    expect(out.attempted).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBeGreaterThanOrEqual(1);
    expect(out.byProvider["qbo"]).toMatchObject({ attempted: 1, succeeded: 1 });

    // The journal-entry POST `PrivateNote` is the load-bearing dispatch
    // discriminator: `exportPayroll` writes "SmartManageAI Pay Run #..."
    // while `exportCertifiedPayroll` writes "Certified Payroll WH-347...".
    // Asserting the payroll-specific note guarantees the right export
    // function ran — a future regression that swapped the two branches in
    // `runQboPayloadOperation` would fail this expectation.
    const journalPosts = fetchCalls.filter(
      (c) => c.method === "POST" && /\/v3\/company\/r1\/journalentry(\?|$)/.test(c.url),
    );
    expect(journalPosts.length).toBe(1);
    expect(journalPosts[0].body.PrivateNote).toContain("SmartManageAI Pay Run");
    expect(journalPosts[0].body.PrivateNote).toContain("RN-PAY-1");
    expect(journalPosts[0].body.PrivateNote).not.toContain("Certified Payroll WH-347");

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
  });

  it("dispatches a qbo_sync:certified_payroll failure row to exportCertifiedPayroll (not exportPayroll)", async () => {
    const conn = await makeConnection("qbo", { realmId: "r1", accessToken: "tok" });
    const { payRun } = await seedPayRunFixture(conn.id, "RN-CP-1");
    const entity = `qbo_sync:certified_payroll:${payRun.id}`;

    await seedDueFailure(conn, entity, { payRunId: payRun.id });

    const out = await processIntegrationSyncRetries();
    expect(out.attempted).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBeGreaterThanOrEqual(1);
    expect(out.byProvider["qbo"]).toMatchObject({ attempted: 1, succeeded: 1 });

    // Mirror of the payroll test: the WH-347 `PrivateNote` is unique to
    // `exportCertifiedPayroll`, so a wrong dispatch into `exportPayroll`
    // would emit the "SmartManageAI Pay Run" note and fail this contains
    // check (and inversely, the negative assertion guards a regression
    // the other way).
    const journalPosts = fetchCalls.filter(
      (c) => c.method === "POST" && /\/v3\/company\/r1\/journalentry(\?|$)/.test(c.url),
    );
    expect(journalPosts.length).toBe(1);
    expect(journalPosts[0].body.PrivateNote).toContain("Certified Payroll WH-347");
    expect(journalPosts[0].body.PrivateNote).toContain("RN-CP-1");
    expect(journalPosts[0].body.PrivateNote).not.toContain("SmartManageAI Pay Run");

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toBeNull();
    expect(row.retryCount).toBe(0);
    expect(row.nextRetryAt).toBeNull();
  });

  it("returns a clear 'Missing payload' error for legacy invoice rows that lack metadata.payload", async () => {
    const conn = await makeConnection("qbo", { realmId: "r1", accessToken: "tok" });
    const localInvoiceId = "INV-LEGACY-1";
    const entity = `qbo_sync:invoice:${localInvoiceId}`;

    // Simulate a legacy failure row written before Task #1377 added the
    // `metadata.payload` persistence (or one whose metadata was wiped by
    // an admin tool). The handler must surface a clear error rather than
    // crashing inside `exportInvoice` on `payload.lineItems.map(...)`.
    await seedDueFailure(conn, entity, undefined);

    const out = await processIntegrationSyncRetries();
    expect(out.failed).toBeGreaterThanOrEqual(1);
    expect(out.attempted).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBe(0);

    // No QBO request should ever fly for a row that has no payload to
    // replay — the handler must short-circuit before touching the network.
    const invoicePosts = fetchCalls.filter(
      (c) => c.method === "POST" && /\/v3\/company\/r1\/invoice(\?|$)/.test(c.url),
    );
    expect(invoicePosts.length).toBe(0);

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toContain("Missing payload");
    expect(row.lastError).toContain("invoice");
    expect(row.retryCount).toBe(2);
  });

  it("returns a clear 'Missing payload' error for legacy customer rows that lack metadata.payload", async () => {
    const conn = await makeConnection("qbo", { realmId: "r1", accessToken: "tok" });
    const localCustomerId = "CUST-LEGACY-1";
    const entity = `qbo_sync:customer:${localCustomerId}`;

    await seedDueFailure(conn, entity, undefined);

    const out = await processIntegrationSyncRetries();
    expect(out.failed).toBeGreaterThanOrEqual(1);
    expect(out.succeeded).toBe(0);

    const customerPosts = fetchCalls.filter(
      (c) => c.method === "POST" && /\/v3\/company\/r1\/customer(\?|$)/.test(c.url),
    );
    expect(customerPosts.length).toBe(0);

    const row = await getRow(conn.id, entity);
    expect(row.lastError).toContain("Missing payload");
    expect(row.lastError).toContain("customer");
    expect(row.retryCount).toBe(2);
  });
});
