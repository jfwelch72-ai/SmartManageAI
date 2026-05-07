/**
 * Task #2586 — Server coverage that PUT /api/org/estimating-factors
 * writes an audit_log row whose oldValue/newValue contain the
 * old and new fraction values for every markup factor.
 *
 * The orgFactors service and auditLogger are stubbed so the test runs
 * in-memory without touching Postgres — the route surface is what we
 * actually care about (the call site of logAudit + the payload it
 * receives).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

type TestUser = { id: string; role: string; organizationId: string | null } | null;
let testUser: TestUser = null;

vi.mock("../auth", () => ({
  requireAuth: (
    req: Request & { user?: TestUser },
    res: Response,
    next: NextFunction,
  ) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
    next();
  },
  requireRole: (...roles: string[]) =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (req.user.role === "SUPER_ADMIN" || roles.includes(req.user.role)) {
        next();
        return;
      }
      res.status(403).json({ error: "Insufficient permissions" });
    },
}));

const STORE: Record<string, any> = {
  org1: {
    id: "factors-row-1",
    organizationId: "org1",
    laborBurdenPercent: 0.2,
    smallToolsPercent: 0.02,
    overheadPercent: 0.08,
    profitPercent: 0.05,
    bondPercent: 0.01,
    escalationPercent: 0.0,
    defaultWasteFactor: 0.04,
    updatedAt: new Date("2026-04-01T00:00:00Z"),
  },
};

vi.mock("../services/aiEstimator/orgFactors", () => ({
  getOrgFactors: vi.fn(async (orgId: string) => STORE[orgId]),
  upsertOrgFactors: vi.fn(async (orgId: string, patch: Record<string, unknown>) => {
    STORE[orgId] = { ...STORE[orgId], ...patch, updatedAt: new Date() };
    return STORE[orgId];
  }),
}));

const auditCalls: any[] = [];
vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(async (data: any, _req?: any) => {
    auditCalls.push(data);
  }),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// Estimate-override / totals routes pull these in; stub them out so we
// don't drag the real DB module into the test process.
vi.mock("../db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }), update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }) } }));

let app: Express;

beforeAll(async () => {
  const { default: router } = await import("../orgEstimatingFactorsRoutes");
  app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (!res.headersSent) res.status(err?.status || 500).json({ error: err?.message || "error" });
  });
});

beforeEach(() => {
  auditCalls.length = 0;
  testUser = { id: "user-1", role: "ADMIN", organizationId: "org1" };
  STORE.org1 = {
    id: "factors-row-1",
    organizationId: "org1",
    laborBurdenPercent: 0.2,
    smallToolsPercent: 0.02,
    overheadPercent: 0.08,
    profitPercent: 0.05,
    bondPercent: 0.01,
    escalationPercent: 0.0,
    defaultWasteFactor: 0.04,
    updatedAt: new Date("2026-04-01T00:00:00Z"),
  };
});

describe("PUT /api/org/estimating-factors — audit row", () => {
  it("writes an audit_log row whose oldValue/newValue carry the old and new fraction values", async () => {
    const newFactors = {
      laborBurdenPercent: 0.3,
      smallToolsPercent: 0.025,
      overheadPercent: 0.12,
      profitPercent: 0.1,
      bondPercent: 0.015,
      escalationPercent: 0.005,
      wasteFactorPercent: 0.06,
    };

    const res = await request(app)
      .put("/api/org/estimating-factors")
      .send(newFactors);

    expect(res.status).toBe(200);
    expect(res.body.laborBurdenPercent).toBeCloseTo(0.3, 6);
    expect(res.body.wasteFactorPercent).toBeCloseTo(0.06, 6);

    expect(auditCalls.length).toBe(1);
    const row = auditCalls[0];
    expect(row.entityType).toBe("org_estimating_factors");
    expect(row.entityId).toBe("org1");
    expect(row.action).toBe("UPDATE");
    expect(row.userId).toBe("user-1");

    const oldParsed = JSON.parse(row.oldValue);
    const newParsed = JSON.parse(row.newValue);

    // Old fractions reflect the pre-update STORE state. Note the route
    // maps `defaultWasteFactor` → `wasteFactorPercent` for the public
    // view, so the audit captures the fraction under the public name.
    expect(oldParsed.laborBurdenPercent).toBeCloseTo(0.2, 6);
    expect(oldParsed.smallToolsPercent).toBeCloseTo(0.02, 6);
    expect(oldParsed.overheadPercent).toBeCloseTo(0.08, 6);
    expect(oldParsed.profitPercent).toBeCloseTo(0.05, 6);
    expect(oldParsed.bondPercent).toBeCloseTo(0.01, 6);
    expect(oldParsed.escalationPercent).toBeCloseTo(0.0, 6);
    expect(oldParsed.wasteFactorPercent).toBeCloseTo(0.04, 6);

    // New fractions are exactly what the client PUT.
    expect(newParsed.laborBurdenPercent).toBeCloseTo(0.3, 6);
    expect(newParsed.smallToolsPercent).toBeCloseTo(0.025, 6);
    expect(newParsed.overheadPercent).toBeCloseTo(0.12, 6);
    expect(newParsed.profitPercent).toBeCloseTo(0.1, 6);
    expect(newParsed.bondPercent).toBeCloseTo(0.015, 6);
    expect(newParsed.escalationPercent).toBeCloseTo(0.005, 6);
    expect(newParsed.wasteFactorPercent).toBeCloseTo(0.06, 6);

    // All values are stored as fractions in [0, 1] — guard against a
    // future regression that accidentally records percents (>1) in the
    // audit trail.
    for (const v of Object.values(oldParsed) as number[]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const v of Object.values(newParsed) as number[]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("rejects out-of-range fractions without writing an audit row", async () => {
    const res = await request(app)
      .put("/api/org/estimating-factors")
      .send({ laborBurdenPercent: 1.5 });

    expect(res.status).toBe(400);
    expect(auditCalls.length).toBe(0);
  });

  it("returns 403 for non-admin/manager roles and writes no audit row", async () => {
    testUser = { id: "user-2", role: "ESTIMATOR", organizationId: "org1" };
    const res = await request(app)
      .put("/api/org/estimating-factors")
      .send({ laborBurdenPercent: 0.3 });
    expect(res.status).toBe(403);
    expect(auditCalls.length).toBe(0);
  });
});
