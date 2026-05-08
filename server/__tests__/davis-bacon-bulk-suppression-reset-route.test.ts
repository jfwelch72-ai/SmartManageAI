/**
 * Task #1443 — route-level coverage for
 * `POST /api/integrations/davis-bacon/suppressed-failures/reset-all`.
 *
 *  - 401 unauthenticated
 *  - 403 for MANAGER (read-only on the suppression panel)
 *  - 200 + single combined audit entry naming every cleared decision
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
vi.mock("../integrations/audit", () => ({
  logIntegrationAudit: auditMock,
  getSecurityAuditLog: () => [],
}));

const resetAllMock = vi.fn();
vi.mock("../integrations/providers/dol_davis_bacon", () => ({
  importWageDetermination: vi.fn(),
  listSuppressedFailureNotifications: vi.fn(async () => []),
  resetSuppressedFailureNotification: vi.fn(),
  resetAllSuppressedFailureNotifications: resetAllMock,
}));

const getConnectionMock = vi.fn();
vi.mock("../integrations/connectionService", () => ({
  listConnections: vi.fn(async () => []),
  getConnection: getConnectionMock,
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

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined, returning: async () => [] }),
    delete: () => ({ where: async () => undefined }),
    transaction: async (fn: any) => fn({}),
  },
  pool: {},
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

let app: Express;

beforeEach(async () => {
  resetAllMock.mockReset();
  auditMock.mockReset();
  getConnectionMock.mockReset();
  testUser = null;

  const router = (await import("../integrationRoutes")).default;
  app = express();
  app.use(express.json());
  app.use("/api/integrations", router);
});

describe("POST /api/integrations/davis-bacon/suppressed-failures/reset-all (Task #1443)", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({ connectionId: "conn-1" });
    expect(res.status).toBe(401);
    expect(resetAllMock).not.toHaveBeenCalled();
  });

  it("forbids MANAGER role", async () => {
    testUser = { id: "u-1", role: "MANAGER", organizationId: "org-1" };
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({ connectionId: "conn-1" });
    expect(res.status).toBe(403);
    expect(resetAllMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies with 400", async () => {
    testUser = { id: "u-1", role: "ADMIN", organizationId: "org-1" };
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({});
    expect(res.status).toBe(400);
    expect(resetAllMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the connection belongs to another org", async () => {
    testUser = { id: "u-1", role: "ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({ connectionId: "conn-other" });
    expect(res.status).toBe(404);
    expect(getConnectionMock).toHaveBeenCalledWith("conn-other", "org-1");
    expect(resetAllMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the connection is for a different provider", async () => {
    testUser = { id: "u-1", role: "ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue({
      id: "conn-1", organizationId: "org-1", provider: "qbo",
    });
    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({ connectionId: "conn-1" });
    expect(res.status).toBe(404);
    expect(resetAllMock).not.toHaveBeenCalled();
  });

  it("clears every suppression and writes one combined audit entry", async () => {
    testUser = { id: "u-admin", role: "ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue({
      id: "conn-1",
      organizationId: "org-1",
      provider: "dol_davis_bacon",
    });
    resetAllMock.mockResolvedValue({
      cleared: 3,
      decisionNumbers: ["CA20260001", "CA20260002", "CA20260003"],
    });

    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({ connectionId: "conn-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      cleared: 3,
      decisionNumbers: ["CA20260001", "CA20260002", "CA20260003"],
    });
    expect(resetAllMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(
      "davis_bacon.suppression_reset_all",
      expect.objectContaining({
        orgId: "org-1",
        userId: "u-admin",
        connectionId: "conn-1",
        cleared: 3,
        decisionNumbers: ["CA20260001", "CA20260002", "CA20260003"],
      }),
    );
  });

  it("returns cleared=0 (not an error) when the connection had nothing suppressed", async () => {
    testUser = { id: "u-admin", role: "SUPER_ADMIN", organizationId: "org-1" };
    getConnectionMock.mockResolvedValue({
      id: "conn-1",
      organizationId: "org-1",
      provider: "dol_davis_bacon",
    });
    resetAllMock.mockResolvedValue({ cleared: 0, decisionNumbers: [] });

    const res = await request(app)
      .post("/api/integrations/davis-bacon/suppressed-failures/reset-all")
      .send({ connectionId: "conn-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, cleared: 0, decisionNumbers: [] });
    expect(auditMock).toHaveBeenCalledWith(
      "davis_bacon.suppression_reset_all",
      expect.objectContaining({ cleared: 0 }),
    );
  });
});
