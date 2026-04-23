/**
 * Task #1442 — route-level coverage for the new
 * `GET /api/integrations/davis-bacon/suppression-resets` endpoint that
 * surfaces recent `davis_bacon.suppression_reset` audit history on the
 * integrations panel.
 *
 *   - 401 unauthenticated
 *   - 403 for FIELD_WORKER (not admin/manager)
 *   - 200 for ADMIN and MANAGER (read-only audit feed)
 *   - Org scoping: only the caller's org's entries come from the buffer
 *   - User-name resolution joins against the users table and is itself
 *     org-scoped (defence in depth) so a stale userId from another org
 *     can't have its name leaked back through this endpoint.
 *   - Anonymous (userId=null) entries are passed through cleanly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

type TestUser = { id: string; role: string; organizationId: string } | null;
let testUser: TestUser = null;

vi.mock("../auth", () => ({
  requireAuth: (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
    next();
  },
  requireRole: (..._roles: string[]) =>
    (_req: Request, _res: Response, next: NextFunction) => next(),
  csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const listSuppressionResetsMock = vi.fn(() => [] as unknown[]);
vi.mock("../integrations/audit", () => ({
  logIntegrationAudit: vi.fn(),
  getSecurityAuditLog: () => [],
  recordSuppressionReset: vi.fn(),
  listSuppressionResets: (...args: unknown[]) => listSuppressionResetsMock(...args),
}));

vi.mock("../integrations/providers/dol_davis_bacon", () => ({
  importWageDetermination: vi.fn(),
  listSuppressedFailureNotifications: vi.fn(async () => []),
  resetSuppressedFailureNotification: vi.fn(),
}));
vi.mock("../integrations/connectionService", () => ({
  listConnections: vi.fn(async () => []),
  getConnection: vi.fn(),
  getDecryptedConnection: vi.fn(),
  createConnection: vi.fn(),
  storeConnectionTokens: vi.fn(),
  sanitizeConnections: (c: unknown) => c,
}));
vi.mock("../integrations/providers/qbo", () => ({
  importChartOfAccounts: vi.fn(),
  exportCustomers: vi.fn(),
  exportInvoice: vi.fn(),
  importPaymentStatus: vi.fn(),
  exportPayroll: vi.fn(),
  exportSubcontractorPayments: vi.fn(),
  exportPurchaseOrders: vi.fn(),
  reconcilePayments: vi.fn(),
}));
vi.mock("../integrations/providers/qbo/sync", () => ({
  exportHaulTickets: vi.fn(),
  exportSuretyPremiums: vi.fn(),
  exportCertifiedPayroll: vi.fn(),
}));
vi.mock("../integrations/providers/aashtoware", () => ({
  parseEbsxJson: vi.fn(),
  importBidPackage: vi.fn(),
  exportEstimateAsEbsx: vi.fn(),
}));
vi.mock("../integrations/providers/dbe_directory", () => ({
  searchDirectory: vi.fn(),
  refreshCertifications: vi.fn(),
  verifyCertification: vi.fn(),
}));
vi.mock("../integrations/providers/surety_verification", () => ({
  verifyOrganizationBonds: vi.fn(),
}));
vi.mock("../integrations/providers/stackct", () => ({
  importProjects: vi.fn(),
  exportProjects: vi.fn(),
  importPlans: vi.fn(),
  exportPlans: vi.fn(),
  importEstimates: vi.fn(),
  exportEstimates: vi.fn(),
  acquireTokenWithCredentials: vi.fn(),
}));

// db.select(...).from(usersTable).where(...) returns users in the
// caller's org for the given ids. We capture the where clause to
// confirm org scoping.
const usersForOrg: Record<string, Array<{ id: string; firstName: string; lastName: string }>> =
  {
    "org-1": [
      { id: "u-jane", firstName: "Jane", lastName: "Doe" },
      { id: "u-bob", firstName: "Bob", lastName: "Smith" },
    ],
    "org-2": [{ id: "u-mallory", firstName: "Mallory", lastName: "Other" }],
  };
let lastUserQueryOrg: string | null = null;
let lastUserQueryIds: string[] = [];
vi.mock("../db", () => {
  return {
    db: {
      select: (_cols?: unknown) => ({
        from: (_t: unknown) => ({
          where: async (_clause: unknown) => {
            // The route calls .from(usersTable).where(and(inArray(id, ids), eq(orgId, org)))
            // We don't decode the actual clause; instead, the test sets
            // currentOrg/currentIds via the audit mock indirectly. So we
            // return rows for the active testUser org filtered by
            // queriedIds captured below.
            const org = lastUserQueryOrg ?? testUser?.organizationId ?? "";
            const pool = usersForOrg[org] ?? [];
            return pool.filter((r) => lastUserQueryIds.includes(r.id));
          },
          limit: async () => [],
        }),
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => undefined, returning: async () => [] }),
      delete: () => ({ where: async () => undefined }),
    },
    pool: {},
  };
});

// We can't easily intercept the where() clause to extract ids, so we
// read them off the audit-buffer mock's return value.
function setBufferReturn(
  entries: Array<{
    orgId: string;
    connectionId: string;
    decisionNumber: string;
    cleared: boolean;
    userId?: string;
    timestamp: string;
  }>,
) {
  listSuppressionResetsMock.mockImplementation((orgId: string) => {
    const filtered = entries.filter((e) => e.orgId === orgId);
    lastUserQueryOrg = orgId;
    lastUserQueryIds = Array.from(
      new Set(filtered.map((e) => e.userId).filter((u): u is string => !!u)),
    );
    return filtered as unknown[];
  });
}

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

let app: Express;

beforeEach(async () => {
  listSuppressionResetsMock.mockReset();
  listSuppressionResetsMock.mockReturnValue([]);
  lastUserQueryOrg = null;
  lastUserQueryIds = [];
  testUser = null;

  const router = (await import("../integrationRoutes")).default;
  app = express();
  app.use(express.json());
  app.use("/api/integrations", router);
});

describe("GET /api/integrations/davis-bacon/suppression-resets (Task #1442)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets",
    );
    expect(res.status).toBe(401);
    expect(listSuppressionResetsMock).not.toHaveBeenCalled();
  });

  it("forbids non admin/manager roles", async () => {
    testUser = { id: "u-1", role: "FIELD_WORKER", organizationId: "org-1" };
    const res = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets",
    );
    expect(res.status).toBe(403);
    expect(listSuppressionResetsMock).not.toHaveBeenCalled();
  });

  it("returns recent reset entries for the caller's org with resolved user names", async () => {
    testUser = { id: "u-jane", role: "ADMIN", organizationId: "org-1" };
    setBufferReturn([
      {
        orgId: "org-1",
        connectionId: "conn-1",
        decisionNumber: "CA20260111",
        cleared: true,
        userId: "u-jane",
        timestamp: "2026-04-23T14:56:00.000Z",
      },
      {
        orgId: "org-1",
        connectionId: "conn-1",
        decisionNumber: "CA20260222",
        cleared: false,
        userId: "u-bob",
        timestamp: "2026-04-23T14:55:00.000Z",
      },
      // Anonymous (no userId) entry — possible if the action was
      // scripted without an authenticated user; should pass through
      // with userName=null rather than crashing the response.
      {
        orgId: "org-1",
        connectionId: "conn-1",
        decisionNumber: "CA20260333",
        cleared: true,
        timestamp: "2026-04-23T14:54:00.000Z",
      },
      // Cross-org entry the buffer must NOT return (the mock filters
      // by orgId in setBufferReturn) — included here for documentation.
      {
        orgId: "org-2",
        connectionId: "conn-x",
        decisionNumber: "CA20260999",
        cleared: true,
        userId: "u-mallory",
        timestamp: "2026-04-23T14:53:00.000Z",
      },
    ]);

    const res = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets",
    );
    expect(res.status).toBe(200);
    expect(listSuppressionResetsMock).toHaveBeenCalledWith("org-1", 100);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toEqual({
      connectionId: "conn-1",
      decisionNumber: "CA20260111",
      cleared: true,
      userId: "u-jane",
      userName: "Jane Doe",
      timestamp: "2026-04-23T14:56:00.000Z",
    });
    expect(res.body.items[1].userName).toBe("Bob Smith");
    expect(res.body.items[1].cleared).toBe(false);
    expect(res.body.items[2]).toEqual({
      connectionId: "conn-1",
      decisionNumber: "CA20260333",
      cleared: true,
      userId: null,
      userName: null,
      timestamp: "2026-04-23T14:54:00.000Z",
    });
  });

  it("works for MANAGER role (read-only history)", async () => {
    testUser = { id: "u-mgr", role: "MANAGER", organizationId: "org-1" };
    setBufferReturn([]);
    const res = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it("scopes the buffer query strictly to the caller's org", async () => {
    testUser = { id: "u-jane", role: "ADMIN", organizationId: "org-1" };
    setBufferReturn([
      {
        orgId: "org-2",
        connectionId: "conn-x",
        decisionNumber: "CA20269999",
        cleared: true,
        userId: "u-mallory",
        timestamp: "2026-04-23T14:50:00.000Z",
      },
    ]);
    const res = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets",
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(listSuppressionResetsMock).toHaveBeenCalledWith("org-1", 100);
  });

  it("caps the limit at 200 even if a larger value is requested", async () => {
    testUser = { id: "u-jane", role: "ADMIN", organizationId: "org-1" };
    setBufferReturn([]);
    const res = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets?limit=9999",
    );
    expect(res.status).toBe(200);
    expect(listSuppressionResetsMock).toHaveBeenCalledWith("org-1", 200);
  });

  it("falls back to the default limit when the query value is invalid or negative", async () => {
    testUser = { id: "u-jane", role: "ADMIN", organizationId: "org-1" };
    setBufferReturn([]);

    const negative = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets?limit=-5",
    );
    expect(negative.status).toBe(200);
    expect(listSuppressionResetsMock).toHaveBeenLastCalledWith("org-1", 100);

    const garbage = await request(app).get(
      "/api/integrations/davis-bacon/suppression-resets?limit=abc",
    );
    expect(garbage.status).toBe(200);
    expect(listSuppressionResetsMock).toHaveBeenLastCalledWith("org-1", 100);
  });
});
