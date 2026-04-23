/**
 * Task #1403 — route-level coverage for the new
 * `POST /api/integrations/davis-bacon/suppressed-failures/reset` endpoint.
 *
 *  - 401 unauthenticated
 *  - 403 for MANAGER (read-only on the suppression panel)
 *  - 200 + audit entry + sync-helper invoked when ADMIN posts
 *  - 404 when the connection belongs to another org / different provider
 *  - 400 when the body fails schema validation
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

const auditMock = vi.fn();
const recordSuppressionResetMock = vi.fn();
const listSuppressionResetsMock = vi.fn(() => []);
vi.mock("../integrations/audit", () => ({
  logIntegrationAudit: auditMock,
  getSecurityAuditLog: () => [],
  recordSuppressionReset: (...args: unknown[]) => recordSuppressionResetMock(...args),
  listSuppressionResets: (...args: unknown[]) => listSuppressionResetsMock(...args),
}));

const resetMock = vi.fn();
vi.mock("../integrations/providers/dol_davis_bacon", () => ({
  importWageDetermination: vi.fn(),
  listSuppressedFailureNotifications: vi.fn(async () => []),
  resetSuppressedFailureNotification: (...args: unknown[]) => resetMock(...args),
}));

const getConnectionMock = vi.fn();
vi.mock("../integrations/connectionService", () => ({
  listConnections: vi.fn(async () => []),
  getConnection: (...args: unknown[]) => getConnectionMock(...args),
  getDecryptedConnection: vi.fn(),
  createConnection: vi.fn(),
  storeConnectionTokens: vi.fn(),
  sanitizeConnections: (c: unknown) => c,
}));

// Stub out heavy modules pulled in by integrationRoutes.ts that aren't relevant
// for this route test.
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

// db is referenced by some routes we don't exercise; provide an inert stub.
vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined, returning: async () => [] }),
    delete: () => ({ where: async () => undefined }),
  },
  pool: {},
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

let app: Express;

beforeEach(async () => {
  resetMock.mockReset();
  auditMock.mockReset();
  recordSuppressionResetMock.mockReset();
  listSuppressionResetsMock.mockReset();
  listSuppressionResetsMock.mockReturnValue([]);
  getConnectionMock.mockReset();
  testUser = null;

  const router = (await import("../integrationRoutes")).default;
  app = express();
  app.use(express.json());
  app.use("/api/integrations", router);
});

describe("POST /api/integrations/davis-bacon/suppressed-failures/reset (Task #1403)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "conn-1", decisionNumber: "CA20260001" });
    expect(res.status).toBe(401);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("forbids MANAGER role (read-only on the suppression panel)", async () => {
    testUser = { id: "u-1", role: "MANAGER", organizationId: "org-1" };
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "conn-1", decisionNumber: "CA20260001" });
    expect(res.status).toBe(403);
    expect(resetMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies with 400", async () => {
    testUser = { id: "u-1", role: "ADMIN", organizationId: "org-1" };
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "" });
    expect(res.status).toBe(400);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the connection belongs to another org", async () => {
    testUser = { id: "u-1", role: "ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "conn-other", decisionNumber: "CA20260001" });
    expect(res.status).toBe(404);
    expect(getConnectionMock).toHaveBeenCalledWith("conn-other", "org-1");
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the connection is for a different provider", async () => {
    testUser = { id: "u-1", role: "ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue({
      id: "conn-1", organizationId: "org-1", provider: "qbo",
    });
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "conn-1", decisionNumber: "CA20260001" });
    expect(res.status).toBe(404);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("clears the suppression and writes an audit entry on success", async () => {
    testUser = { id: "u-admin", role: "ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue({
      id: "conn-1",
      organizationId: "org-1",
      provider: "dol_davis_bacon",
    });
    resetMock.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "conn-1", decisionNumber: "CA20260001" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, cleared: true });
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(resetMock.mock.calls[0][1]).toBe("CA20260001");
    expect(auditMock).toHaveBeenCalledWith(
      "davis_bacon.suppression_reset",
      expect.objectContaining({
        orgId: "org-1",
        userId: "u-admin",
        connectionId: "conn-1",
        decisionNumber: "CA20260001",
        cleared: true,
      }),
    );
    // Task #1442 — also pushed into the per-org reset history buffer.
    expect(recordSuppressionResetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        userId: "u-admin",
        connectionId: "conn-1",
        decisionNumber: "CA20260001",
        cleared: true,
      }),
    );
  });

  it("returns cleared=false (not an error) when there was nothing to reset", async () => {
    testUser = { id: "u-admin", role: "SUPER_ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue({
      id: "conn-1",
      organizationId: "org-1",
      provider: "dol_davis_bacon",
    });
    resetMock.mockResolvedValue(false);

    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset")
      .send({ connectionId: "conn-1", decisionNumber: "CA20269999" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, cleared: false });
    expect(auditMock).toHaveBeenCalledWith(
      "davis_bacon.suppression_reset",
      expect.objectContaining({ cleared: false }),
    );
  });
});
