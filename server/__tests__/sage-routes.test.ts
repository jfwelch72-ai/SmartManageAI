// Sage Intacct Phase A — route + idempotency coverage.
// Verifies the named REST routes are registered with auth + RBAC gating
// and that the export functions honour the idempotency contract
// (re-export becomes update / alreadyExported).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../integrations/audit", () => ({
  logIntegrationAudit: vi.fn(),
}));

const dbState = {
  selectQueue: [] as any[][],
  inserted: [] as any[],
  updated: [] as any[],
};

vi.mock("../db", () => {
  return {
    db: {
      select: () => ({
        from: (_table: any) => ({
          where: () => Promise.resolve(dbState.selectQueue.shift() ?? []),
        }),
      }),
      insert: (_table: any) => ({
        values: (v: any) => {
          dbState.inserted.push(v);
          return Promise.resolve();
        },
      }),
      update: (_table: any) => ({
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
  dbState.updated = [];
  sageRequestMock.mockReset();
  process.env.SAGE_INTACCT_SENDER_ID = "SMARTMANAGE";
  process.env.SAGE_INTACCT_SENDER_PASSWORD = "sender-pw";
});

const baseConnection: any = {
  id: "conn-1",
  organizationId: "org-1",
  provider: "sage_intacct",
  status: "active",
  metadata: {
    userId: "ws-user",
    userPassword: "ws-pw",
    companyId: "COMPANY",
  },
};

describe("sage routes registration + RBAC", () => {
  it("registers POST handlers for each named Sage route under /sage/*", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    expect(router?.stack).toBeDefined();

    const paths = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => ({ path: l.route.path, methods: l.route.methods }));

    const expected = [
      "/sage/sync-coa",
      "/sage/export-customers",
      "/sage/export-invoice/:invoiceId",
      "/sage/import-payments",
    ];
    for (const p of expected) {
      const hit = paths.find((x: any) => x.path === p);
      expect(hit, `missing route ${p}`).toBeDefined();
      expect(hit.methods.post).toBe(true);
    }
  });

  it("each named Sage route is wired with multiple middleware (auth + handler)", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const sageRoutes = router.stack.filter((l: any) =>
      l.route?.path?.startsWith("/sage/"),
    );
    expect(sageRoutes.length).toBeGreaterThan(0);
    for (const layer of sageRoutes) {
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("registers chart-of-accounts mapping CRUD routes", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const paths = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => l.route.path);
    expect(paths).toContain("/connections/:id/sage-account-mappings");
    expect(paths).toContain("/connections/:id/sage-account-mappings/:mappingId");
    expect(paths).toContain("/connections/:id/sage-account-mappings/auto-map");
  });

  it("registers Sage payment-status read + refresh endpoints (Task #1604)", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const paths = router.stack
      .filter((l: any) => l.route)
      .map((l: any) => ({ path: l.route.path, methods: l.route.methods }));

    const getStatuses = paths.find((x: any) => x.path === "/sage/payment-statuses");
    expect(getStatuses, "missing GET /sage/payment-statuses").toBeDefined();
    expect(getStatuses.methods.get).toBe(true);

    const refresh = paths.find((x: any) => x.path === "/sage/payment-statuses/refresh");
    expect(refresh, "missing POST /sage/payment-statuses/refresh").toBeDefined();
    expect(refresh.methods.post).toBe(true);
  });

  it("allows MANAGER on POST /sage/payment-statuses/refresh (PMs need refresh)", async () => {
    process.env.INTEGRATION_SAGE = "true";
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/sage/payment-statuses/refresh",
    );
    expect(layer).toBeDefined();
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    let status = 200;
    let body: any = null;
    const req: any = {
      user: { role: "MANAGER", id: "u1", organizationId: "org-no-conn" },
      params: {},
      body: {},
    };
    const res: any = {
      status(s: number) { status = s; return res; },
      json(b: any) { body = b; return res; },
    };
    await handler(req, res, () => {});
    // MANAGER should not be rejected with 403; lacking a connection yields 404 instead.
    expect(status, `expected non-403 for MANAGER, got ${status} body=${JSON.stringify(body)}`).not.toBe(403);
  });

  it("denies non-MANAGER+ roles on POST /sage/payment-statuses/refresh", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/sage/payment-statuses/refresh",
    );
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    for (const role of ["VIEWER", "USER", "MEMBER"]) {
      let status = 200;
      const req: any = { user: { role, id: "u1", organizationId: "org-1" }, params: {}, body: {} };
      const res: any = {
        status(s: number) { status = s; return res; },
        json() { return res; },
      };
      await handler(req, res, () => {});
      expect(status, `expected 403 for role ${role}`).toBe(403);
    }
  });

  it("GET /sage/payment-statuses maps Sage RECORDNOs back to local pay-app IDs", async () => {
    process.env.INTEGRATION_SAGE = "true";
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/sage/payment-statuses",
    );
    expect(layer).toBeDefined();
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    // Three sequential .where() reads: connection, exported_sage_invoices row, payment_status_snapshot row.
    dbState.selectQueue = [
      [{ ...baseConnection }],
      [{
        connectionId: "conn-1",
        entityType: "exported_sage_invoices",
        metadata: {
          idMapping: {
            "payapp-A": "1001",
            "payapp-B": "1002",
            "payapp-C": "1003", // exported but no snapshot entry → "No status yet"
          },
        },
      }],
      [{
        connectionId: "conn-1",
        entityType: "payment_status_snapshot",
        metadata: {
          checkedAt: "2026-04-24T08:00:00.000Z",
          statuses: [
            { invoiceId: "1001", status: "paid", totalDue: 100, totalPaid: 100 },
            { invoiceId: "1002", status: "partial", totalDue: 200, totalPaid: 50, dueDate: "2026-05-01" },
            { invoiceId: "9999", status: "paid", totalDue: 1, totalPaid: 1 }, // unmapped → ignored
          ],
        },
        lastSyncAt: new Date("2026-04-24T08:00:00.000Z"),
      }],
    ];

    let body: any = null;
    const req: any = { user: { role: "MANAGER", id: "u1", organizationId: "org-1" }, params: {}, body: {} };
    const res: any = {
      status() { return res; },
      json(b: any) { body = b; return res; },
    };
    await handler(req, res, () => {});

    expect(body?.enabled).toBe(true);
    expect(body?.connected).toBe(true);
    expect(body?.checkedAt).toBe("2026-04-24T08:00:00.000Z");
    expect(body?.exportedPayAppIds).toEqual(expect.arrayContaining(["payapp-A", "payapp-B", "payapp-C"]));

    expect(body?.statuses?.["payapp-A"]).toMatchObject({
      status: "paid",
      totalDue: 100,
      totalPaid: 100,
      sageInvoiceId: "1001",
    });
    expect(body?.statuses?.["payapp-B"]).toMatchObject({
      status: "partial",
      totalDue: 200,
      totalPaid: 50,
      dueDate: "2026-05-01",
      sageInvoiceId: "1002",
    });
    // payapp-C exported but no snapshot entry → not in statuses, but listed in exportedPayAppIds.
    expect(body?.statuses?.["payapp-C"]).toBeUndefined();
    // Unmapped Sage RECORDNO 9999 must not surface under any local id.
    for (const v of Object.values(body?.statuses ?? {})) {
      expect((v as any).sageInvoiceId).not.toBe("9999");
    }
  });

  it("GET /sage/payment-statuses returns empty payload when feature flag is off", async () => {
    process.env.INTEGRATION_SAGE = "false";
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/sage/payment-statuses",
    );
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    let body: any = null;
    const req: any = { user: { role: "MANAGER", id: "u1", organizationId: "org-1" }, params: {}, body: {} };
    const res: any = {
      status() { return res; },
      json(b: any) { body = b; return res; },
    };
    await handler(req, res, () => {});

    expect(body).toMatchObject({ enabled: false, connected: false, statuses: {}, exportedPayAppIds: [] });
    process.env.INTEGRATION_SAGE = "true";
  });

  it("registers POST /sage/credentials for secure tenant credential upload", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/sage/credentials",
    );
    expect(layer, "missing /sage/credentials").toBeDefined();
    expect(layer.route.methods.post).toBe(true);
  });

  it("denies MANAGER role on every named /sage/* route (ADMIN-only)", async () => {
    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;

    const sagePaths = [
      "/sage/sync-coa",
      "/sage/export-customers",
      "/sage/export-invoice/:invoiceId",
      "/sage/import-payments",
      "/sage/credentials",
    ];

    for (const p of sagePaths) {
      const layer = router.stack.find((l: any) => l.route?.path === p);
      expect(layer, `missing route ${p}`).toBeDefined();
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      let status = 200;
      let body: any = null;
      const req: any = {
        user: { role: "MANAGER", id: "u1", organizationId: "org-1" },
        params: { invoiceId: "pa-1" },
        body: {},
      };
      const res: any = {
        status(s: number) { status = s; return res; },
        json(b: any) { body = b; return res; },
      };
      await handler(req, res, () => {});
      expect(status, `expected 403 for MANAGER on ${p}`).toBe(403);
      expect(String(body?.error || "")).toMatch(/permission/i);
    }
  });

  it("denies MANAGER role on unified POST /connections/:id/sync for sage_intacct", async () => {
    process.env.INTEGRATION_SAGE = "true";
    const connectionService = await import("../integrations/connectionService");
    const spy = vi
      .spyOn(connectionService, "getDecryptedConnection" as any)
      .mockResolvedValue({
        id: "conn-1",
        organizationId: "org-1",
        provider: "sage_intacct",
        status: "active",
        metadata: {},
      } as any);

    const mod: any = await import("../integrationRoutes");
    const router: any = mod.default;
    const layer = router.stack.find(
      (l: any) => l.route?.path === "/connections/:id/sync",
    );
    expect(layer, "missing /connections/:id/sync").toBeDefined();
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;

    let status = 200;
    let body: any = null;
    const req: any = {
      user: { role: "MANAGER", id: "u1", organizationId: "org-1" },
      params: { id: "conn-1" },
      body: { operation: "sage_chart_of_accounts", dryRun: true },
    };
    const res: any = {
      status(s: number) { status = s; return res; },
      json(b: any) { body = b; return res; },
    };
    await handler(req, res, () => {});
    expect(status).toBe(403);
    expect(String(body?.error || "")).toMatch(/SUPER_ADMIN|ADMIN/);
    spy.mockRestore();
  });
});

describe("encryption: Sage credentials at rest", () => {
  it("encryptMetadata encrypts userPassword and decryptMetadata round-trips it", async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY =
      process.env.INTEGRATION_ENCRYPTION_KEY || "test-encryption-key-not-secret";
    const { encryptMetadata, decryptMetadata, isEncrypted } = await import(
      "../integrations/encryption"
    );
    const enc = encryptMetadata({
      userId: "ws-user",
      userPassword: "super-secret-pw",
      companyId: "COMPANY",
    });
    expect(isEncrypted(enc.userPassword as string)).toBe(true);
    expect(enc.userId).toBe("ws-user");
    expect(enc.companyId).toBe("COMPANY");
    const dec = decryptMetadata(enc);
    expect(dec.userPassword).toBe("super-secret-pw");
  });

  it("/sage/credentials merge path encrypts plaintext input without double-encrypting prior tokens", async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY =
      process.env.INTEGRATION_ENCRYPTION_KEY || "test-encryption-key-not-secret";
    const { encryptMetadata, decryptMetadata, isEncrypted } = await import(
      "../integrations/encryption"
    );

    // Simulate what loadActiveSageConnection now returns: decrypted view
    // of metadata that was previously encrypted at rest by storeConnectionTokens.
    const decryptedExisting = {
      accessToken: "plaintext-access-token",
      refreshToken: "plaintext-refresh-token",
      companyId: "COMPANY",
    };
    const merged = {
      ...decryptedExisting,
      userId: "ws-user",
      userPassword: "super-secret-pw",
    };
    const encrypted = encryptMetadata(merged);
    expect(isEncrypted(encrypted.accessToken as string)).toBe(true);
    expect(isEncrypted(encrypted.refreshToken as string)).toBe(true);
    expect(isEncrypted(encrypted.userPassword as string)).toBe(true);
    const dec = decryptMetadata(encrypted);
    expect(dec.accessToken).toBe("plaintext-access-token");
    expect(dec.refreshToken).toBe("plaintext-refresh-token");
    expect(dec.userPassword).toBe("super-secret-pw");
    expect(dec.userId).toBe("ws-user");
  });
});

describe("exportCustomers idempotency / source-of-truth", () => {
  it("issues create on first sync, update on second sync via idMapping", async () => {
    const { exportCustomers } = await import(
      "../integrations/providers/sage/sync"
    );

    sageRequestMock.mockResolvedValue({
      success: true,
      data: { "cust-acme-1": { key: "SAGE-CUST-99", customerid: "CUST-99" } },
      errors: [],
      raw: {},
    });

    // First sync: getIdMapping → [], then trackExportedId reads existing → []
    dbState.selectQueue = [[], []];
    const r1 = await exportCustomers(
      baseConnection,
      [{ id: "acme-1", name: "ACME Inc" }],
    );
    expect(r1.created).toBe(1);
    expect(r1.updated).toBe(0);
    expect(sageRequestMock.mock.calls[0][1][0].name).toBe("create");

    // Second sync: getIdMapping returns prior mapping; trackExportedId
    // reads existing row to update it.
    const seedRow = {
      id: "state-1",
      connectionId: "conn-1",
      organizationId: "org-1",
      entityType: "exported_sage_customers",
      metadata: {
        exportedIds: ["acme-1"],
        idMapping: { "acme-1": "SAGE-CUST-99" },
      },
    };
    dbState.selectQueue = [[seedRow], [seedRow]];
    sageRequestMock.mockResolvedValue({
      success: true,
      data: { "cust-acme-1": {} },
      errors: [],
      raw: {},
    });

    const r2 = await exportCustomers(
      baseConnection,
      [{ id: "acme-1", name: "ACME Inc Renamed" }],
    );
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    const fns = sageRequestMock.mock.calls[1][1];
    expect(fns[0].name).toBe("update");
    expect(fns[0].body.CUSTOMER.CUSTOMERID).toBe("SAGE-CUST-99");
    expect(fns[0].body.CUSTOMER.NAME).toBe("ACME Inc Renamed");
  });

  it("when payload empty, sources from CRM organisations table", async () => {
    const { exportCustomers } = await import(
      "../integrations/providers/sage/sync"
    );

    // getIdMapping → [], crmOrganisations → 2 rows, then per-customer track reads []
    dbState.selectQueue = [
      [],
      [
        { id: "org-cust-1", name: "GC One", type: "CONTRACTOR" },
        { id: "org-cust-2", name: "Owner Rep Two", type: "OWNER_REP" },
      ],
      [],
      [],
    ];
    sageRequestMock.mockResolvedValue({
      success: true,
      data: {
        "cust-org-cust-1": { key: "S1", customerid: "S1" },
        "cust-org-cust-2": { key: "S2", customerid: "S2" },
      },
      errors: [],
      raw: {},
    });

    const r = await exportCustomers(baseConnection, []);
    expect(r.created).toBe(2);
    expect(sageRequestMock).toHaveBeenCalledTimes(2);
    expect(sageRequestMock.mock.calls[0][1][0].name).toBe("create");
  });
});

describe("exportInvoice idempotency", () => {
  it("returns alreadyExported=true with stored sageInvoiceId on re-submission", async () => {
    const { exportInvoice } = await import(
      "../integrations/providers/sage/sync"
    );

    const seedRow = {
      id: "state-2",
      connectionId: "conn-1",
      organizationId: "org-1",
      entityType: "exported_sage_invoices",
      metadata: {
        exportedIds: ["payapp-77"],
        idMapping: { "payapp-77": "SAGE-AR-1234" },
      },
    };
    // getExportedIds → [seedRow], getIdMapping → [seedRow]
    dbState.selectQueue = [[seedRow], [seedRow]];

    const result = await exportInvoice(baseConnection, {
      customerRef: "CUST-99",
      lineItems: [{ description: "Phase 1", amount: 1000 }],
      localInvoiceId: "payapp-77",
    });

    expect(result.success).toBe(true);
    expect(result.alreadyExported).toBe(true);
    expect(result.sageInvoiceId).toBe("SAGE-AR-1234");
    expect(result.created).toBe(0);
    expect(sageRequestMock).not.toHaveBeenCalled();
  });

  it("creates a new AR invoice when localInvoiceId has not been exported", async () => {
    const { exportInvoice } = await import(
      "../integrations/providers/sage/sync"
    );

    // getExportedIds → [], getAccountMappings → [], trackExportedId.select → []
    dbState.selectQueue = [[], [], []];
    sageRequestMock.mockResolvedValue({
      success: true,
      data: { "inv-payapp-88": { key: "SAGE-AR-5555", recordno: "5555" } },
      errors: [],
      raw: {},
    });

    const result = await exportInvoice(baseConnection, {
      customerRef: "CUST-99",
      lineItems: [{ description: "Phase 2", amount: 2500 }],
      localInvoiceId: "payapp-88",
    });

    expect(result.success).toBe(true);
    expect(result.alreadyExported).toBeUndefined();
    expect(result.created).toBe(1);
    expect(result.sageInvoiceId).toBe("SAGE-AR-5555");
    const fns = sageRequestMock.mock.calls[0][1];
    expect(fns[0].name).toBe("create");
    expect(fns[0].body.ARINVOICE.CUSTOMERID).toBe("CUST-99");
  });
});
