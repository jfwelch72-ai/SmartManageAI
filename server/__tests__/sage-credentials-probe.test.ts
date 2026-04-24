// Task #1603 — Verifies the POST /sage/credentials route runs a Sage XML
// Gateway probe before flipping the connection to active, so admins see
// a bad companyId/userPassword inline on the integrations page instead
// of discovering the failure later inside a background sync.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../integrations/audit", () => ({
  logIntegrationAudit: vi.fn(),
  getSecurityAuditLog: vi.fn().mockResolvedValue([]),
  recordSuppressionReset: vi.fn(),
  listSuppressionResets: vi.fn().mockResolvedValue([]),
}));

const dbState = {
  selectQueue: [] as any[][],
  inserted: [] as any[],
  insertedReturning: [] as any[],
  updated: [] as any[],
  updatedWhere: [] as any[],
};

vi.mock("../db", () => {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(dbState.selectQueue.shift() ?? []),
        }),
      }),
      insert: () => ({
        values: (v: any) => {
          dbState.inserted.push(v);
          return {
            returning: () =>
              Promise.resolve(dbState.insertedReturning.shift() ?? [v]),
          };
        },
      }),
      update: () => ({
        set: (v: any) => ({
          where: () => {
            dbState.updated.push(v);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

const sageRequestMock = vi.fn();
vi.mock("../integrations/providers/sage/xmlGateway", async () => {
  const actual = await vi.importActual<any>(
    "../integrations/providers/sage/xmlGateway",
  );
  return {
    ...actual,
    sageRequest: (...args: any[]) => sageRequestMock(...args),
  };
});

beforeEach(() => {
  dbState.selectQueue = [];
  dbState.inserted = [];
  dbState.insertedReturning = [];
  dbState.updated = [];
  dbState.updatedWhere = [];
  sageRequestMock.mockReset();
  process.env.SAGE_INTACCT_SENDER_ID = "SMARTMANAGE";
  process.env.SAGE_INTACCT_SENDER_PASSWORD = "sender-pw";
  process.env.INTEGRATION_SAGE = "true";
  process.env.INTEGRATION_ENCRYPTION_KEY =
    process.env.INTEGRATION_ENCRYPTION_KEY || "test-encryption-key-not-secret";
});

async function getCredentialsHandler() {
  const mod: any = await import("../integrationRoutes");
  const router: any = mod.default;
  const layer = router.stack.find(
    (l: any) => l.route?.path === "/sage/credentials",
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  let status = 200;
  let body: any = null;
  const res: any = {
    status(s: number) {
      status = s;
      return res;
    },
    json(b: any) {
      body = b;
      return res;
    },
    send() {
      return res;
    },
  };
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
  };
}

describe("POST /sage/credentials probe + activation", () => {
  it("rejects when companyId/userId/userPassword missing", async () => {
    const handler = await getCredentialsHandler();

    for (const body of [
      {},
      { userId: "u", userPassword: "p" }, // missing companyId
      { companyId: "C", userPassword: "p" }, // missing userId
      { companyId: "C", userId: "u" }, // missing userPassword
    ]) {
      const r = makeRes();
      await handler(
        {
          user: { role: "ADMIN", id: "u1", organizationId: "org-1" },
          body,
        },
        r.res,
        () => {},
      );
      expect(r.status).toBe(400);
      expect(String(r.body?.error || "")).toMatch(/required/i);
    }
  });

  it("creates a pending sage connection on first use, runs probe, flips to active on success", async () => {
    const handler = await getCredentialsHandler();

    // loadAnySageConnection → no rows
    dbState.selectQueue = [[]];
    // createConnection.insert(...).returning() → new pending row
    dbState.insertedReturning = [
      [
        {
          id: "conn-new",
          organizationId: "org-1",
          provider: "sage_intacct",
          status: "pending",
          metadata: {},
        },
      ],
    ];

    sageRequestMock.mockResolvedValue({
      success: true,
      data: {},
      errors: [],
      raw: {},
    });

    const r = makeRes();
    await handler(
      {
        user: { role: "ADMIN", id: "u1", organizationId: "org-1" },
        body: {
          companyId: "ACME-PROD",
          userId: "ws-user",
          userPassword: "ws-pw",
          locationId: "100",
        },
      },
      r.res,
      () => {},
    );

    expect(sageRequestMock).toHaveBeenCalledTimes(1);
    const probeFns = sageRequestMock.mock.calls[0][1];
    expect(probeFns[0].name).toBe("readByQuery");
    expect(probeFns[0].body.object).toBe("COMPANY");

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "active" });

    // Last update should set status=active and lastSyncError=null.
    const finalUpdate = dbState.updated[dbState.updated.length - 1];
    expect(finalUpdate.status).toBe("active");
    expect(finalUpdate.lastSyncError).toBeNull();
  });

  it("leaves a pending connection in pending and surfaces probe error on auth failure", async () => {
    const handler = await getCredentialsHandler();

    // loadAnySageConnection → existing pending row (already encrypted)
    const { encryptMetadata } = await import("../integrations/encryption");
    const existingMeta = encryptMetadata({});
    dbState.selectQueue = [
      [
        {
          id: "conn-pending",
          organizationId: "org-1",
          provider: "sage_intacct",
          status: "pending",
          metadata: existingMeta,
        },
      ],
    ];

    sageRequestMock.mockResolvedValue({
      success: false,
      data: {},
      errors: [
        { message: "XL03000009: Sign-in information is incorrect." },
      ],
      raw: {},
    });

    const r = makeRes();
    await handler(
      {
        user: { role: "ADMIN", id: "u1", organizationId: "org-1" },
        body: {
          companyId: "ACME-PROD",
          userId: "ws-user",
          userPassword: "wrong-pw",
        },
      },
      r.res,
      () => {},
    );

    expect(r.status).toBe(400);
    expect(String(r.body?.error || "")).toMatch(/probe failed/i);
    expect(String(r.body?.detail || "")).toMatch(/Sign-in information/);

    // The persisted update should keep status=pending and stash the error.
    const finalUpdate = dbState.updated[dbState.updated.length - 1];
    expect(finalUpdate.status).toBe("pending");
    expect(String(finalUpdate.lastSyncError)).toMatch(/Sign-in/);
    // Bug-class guard: never persist unverified credentials. metadata
    // must NOT be touched on probe failure — only status + lastSyncError.
    expect(finalUpdate).not.toHaveProperty("metadata");
  });

  it("keeps an already-active connection alive on a transient probe failure WITHOUT overwriting prior credentials", async () => {
    const handler = await getCredentialsHandler();

    const { encryptMetadata, decryptMetadata } = await import(
      "../integrations/encryption"
    );
    const priorEncrypted = encryptMetadata({
      userId: "old-user",
      userPassword: "old-pw",
      companyId: "ACME-PROD",
    });
    dbState.selectQueue = [
      [
        {
          id: "conn-active",
          organizationId: "org-1",
          provider: "sage_intacct",
          status: "active",
          metadata: priorEncrypted,
        },
      ],
    ];

    sageRequestMock.mockRejectedValue(new Error("network down"));

    const r = makeRes();
    await handler(
      {
        user: { role: "ADMIN", id: "u1", organizationId: "org-1" },
        body: {
          companyId: "ACME-PROD",
          userId: "ws-user",
          userPassword: "ws-pw",
        },
      },
      r.res,
      () => {},
    );

    expect(r.status).toBe(400);
    const finalUpdate = dbState.updated[dbState.updated.length - 1];
    // Bug-class guard: a transient probe outage must not knock an
    // already-working connection back to pending and break sync.
    expect(finalUpdate.status).toBe("active");
    // Critical: must NOT replace the previously-working credentials with
    // unverified ones — otherwise a flaky probe would silently break the
    // next background sync.
    expect(finalUpdate).not.toHaveProperty("metadata");
    // Sanity: the prior encrypted blob still decrypts to the old creds.
    expect(decryptMetadata(priorEncrypted as any)).toMatchObject({
      userId: "old-user",
      userPassword: "old-pw",
    });
  });

  it("returns 403 when INTEGRATION_SAGE feature flag is off", async () => {
    process.env.INTEGRATION_SAGE = "false";
    const handler = await getCredentialsHandler();
    const r = makeRes();
    await handler(
      {
        user: { role: "ADMIN", id: "u1", organizationId: "org-1" },
        body: { companyId: "C", userId: "u", userPassword: "p" },
      },
      r.res,
      () => {},
    );
    expect(r.status).toBe(403);
    expect(String(r.body?.error || "")).toMatch(/disabled/i);
  });
});
