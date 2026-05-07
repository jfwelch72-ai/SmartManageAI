// Verifies the fail-closed tenant scoping on the support admin endpoints
// (`GET /api/support/tickets` and `/metrics`). A non-SUPER_ADMIN admin
// without an organizationId must NEVER see the global ticket pool.
//
// The test mocks `server/db` and the auth middleware so we can exercise
// the route logic without standing up a real Postgres or seeded users.

import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

let capturedWhere: unknown = null;
let returnedRows: unknown[] = [];

vi.mock("../../db", () => {
  const builder = {
    select: () => builder,
    from: () => builder,
    where: (cond: unknown) => {
      capturedWhere = cond;
      return builder;
    },
    orderBy: () => builder,
    limit: async () => returnedRows,
    then: (resolve: (v: unknown[]) => unknown) => resolve(returnedRows),
  };
  return {
    db: {
      select: () => builder,
    },
  };
});

vi.mock("../../auth", () => ({
  requireAuth: (req: express.Request & { user?: unknown }, _res: express.Response, next: express.NextFunction) => {
    req.user = (req.headers["x-test-user"] as unknown as object) ?? undefined;
    if (req.headers["x-test-user-json"]) {
      req.user = JSON.parse(req.headers["x-test-user-json"] as string);
    }
    next();
  },
  requireRole:
    (..._roles: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

vi.mock("../../email", () => ({ sendEmail: async () => undefined }));
vi.mock("../slaMonitor", () => ({ runSlaSweep: async () => ({ updated: 0 }) }));

let app: Express;

beforeAll(async () => {
  const mod = await import("../../supportRoutes");
  app = express();
  app.use(express.json());
  app.use(mod.default);
});

const ADMIN_NO_ORG = JSON.stringify({
  id: "u1",
  role: "ADMIN",
  organizationId: null,
});
const ADMIN_WITH_ORG = JSON.stringify({
  id: "u2",
  role: "ADMIN",
  organizationId: "org-A",
});
const SUPER_ADMIN = JSON.stringify({
  id: "u3",
  role: "SUPER_ADMIN",
  organizationId: null,
});

describe("GET /api/support/tickets — tenant scoping", () => {
  it("returns an empty list for a non-SUPER_ADMIN admin with no organizationId", async () => {
    capturedWhere = "SHOULD_NOT_BE_SET";
    returnedRows = [{ id: "leak", subject: "should-not-leak" }];
    const res = await request(app)
      .get("/api/support/tickets")
      .set("x-test-user-json", ADMIN_NO_ORG);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tickets: [] });
    // The DB query must NOT have been executed (no where capture).
    expect(capturedWhere).toBe("SHOULD_NOT_BE_SET");
  });

  it("scopes the query for an admin with an organizationId", async () => {
    capturedWhere = null;
    returnedRows = [];
    const res = await request(app)
      .get("/api/support/tickets")
      .set("x-test-user-json", ADMIN_WITH_ORG);
    expect(res.status).toBe(200);
    // A scoping condition must have been applied.
    expect(capturedWhere).not.toBeNull();
  });

  it("does not constrain by org for SUPER_ADMIN", async () => {
    capturedWhere = null;
    returnedRows = [];
    const res = await request(app)
      .get("/api/support/tickets")
      .set("x-test-user-json", SUPER_ADMIN);
    expect(res.status).toBe(200);
    // SUPER_ADMIN with no status filter → no conditions → undefined where.
    expect(capturedWhere).toBeUndefined();
  });
});

describe("GET /api/support/tickets/metrics — tenant scoping", () => {
  it("returns zeros for a non-SUPER_ADMIN admin with no organizationId", async () => {
    capturedWhere = "SHOULD_NOT_BE_SET";
    returnedRows = [{ id: "leak", status: "open" }];
    const res = await request(app)
      .get("/api/support/tickets/metrics")
      .set("x-test-user-json", ADMIN_NO_ORG);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 0,
      open: 0,
      resolved: 0,
      firstResponseBreached: 0,
      resolutionBreached: 0,
    });
    expect(capturedWhere).toBe("SHOULD_NOT_BE_SET");
  });
});
