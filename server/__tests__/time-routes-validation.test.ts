/**
 * Task #2180 — regression coverage for the validation 400 path on the
 * time-clock and time-entry routes that wrap a Zod `.parse(...)` around
 * the request body.
 *
 * Before this task, those routes called `schema.parse(sanitizedBody)`
 * directly inside an `async` handler. A malformed payload made the
 * synchronous Zod throw bubble up as an unhandled promise rejection,
 * leaving the request hanging on the client until it timed out. This
 * file pins the new contract: every wrapped route returns
 * `400 { error: "Invalid request body", details }` instead.
 *
 * Mocking pattern follows server/__tests__/library-validation-routes.test.ts:
 * vitest + supertest with the auth middleware, audit logger, and the `db`
 * module stubbed. The validation paths short-circuit before any db call,
 * so a no-op db stub is enough.
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

type TestUser = { id: string; organizationId: string; role: string; effectiveRole?: string } | null;
let testUser: TestUser = null;

vi.mock("../auth", () => ({
  requireAuth: (
    req: Request & { user?: TestUser },
    _res: Response,
    next: NextFunction,
  ) => {
    if (testUser) req.user = testUser;
    next();
  },
  requireRole: (..._roles: string[]) =>
    (req: Request & { user?: TestUser }, _res: Response, next: NextFunction) => {
      if (testUser) req.user = testUser;
      next();
    },
}));

vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../orgFilter", () => ({
  getOrgIdForFilter: () => ({
    shouldFilter: true,
    orgId: "org-1",
    mustDenyAccess: false,
    isSuperAdmin: false,
  }),
}));

vi.mock("../services/approvalService", () => ({
  createApprovalRequest: vi.fn(),
}));

vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn(async () => false),
}));

vi.mock("../services/workflowEngine", () => ({}));

// The validation paths reject before touching the db, so a chainable no-op
// is enough. If a test accidentally falls through to a db call we'd rather
// see the test hang on a never-resolving promise so we can debug it than
// have a mock silently invent a "successful" insert.
vi.mock("../db", () => ({
  db: {
    select: vi.fn(() => {
      const chain: any = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.innerJoin = () => chain;
      chain.leftJoin = () => chain;
      chain.limit = () => chain;
      chain.orderBy = () => chain;
      chain.then = (resolve: any) => resolve([]);
      return chain;
    }),
    insert: vi.fn(() => {
      const chain: any = {};
      chain.values = () => chain;
      chain.returning = () => Promise.resolve([{ id: "should-not-be-reached" }]);
      return chain;
    }),
    update: vi.fn(() => {
      const chain: any = {};
      chain.set = () => chain;
      chain.where = () => chain;
      chain.returning = () => Promise.resolve([]);
      return chain;
    }),
    delete: vi.fn(() => {
      const chain: any = {};
      chain.where = () => chain;
      chain.returning = () => Promise.resolve([]);
      return chain;
    }),
  },
}));

let app: Express;

beforeAll(async () => {
  const { default: timeClockRoutes } = await import("../timeClockRoutes");
  const { default: timeEntryRoutes } = await import("../timeEntryRoutes");
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (testUser) req.user = testUser;
    next();
  });
  app.use(timeClockRoutes);
  app.use(timeEntryRoutes);
  // Express 4 does not auto-forward async handler rejections to the error
  // middleware. Mounting one here ensures that if a route falls back to
  // throwing (the regression we're guarding against), the test fails
  // loudly with a 500 instead of hanging until supertest's socket
  // timeout — which is exactly the user-visible symptom this task fixed.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err?.message ?? "boom" });
  });
});

beforeEach(() => {
  testUser = { id: "user-1", organizationId: "org-1", role: "ADMIN" };
});

const REQUIRES_VALIDATION: Array<{
  label: string;
  method: "post" | "patch";
  path: string;
  // A body that is guaranteed to fail the route's Zod schema. Each route
  // enforces its own required columns / types so the failing field
  // differs per case.
  body: any;
}> = [
  {
    label: "POST /api/time-clock/clock-in with non-numeric latitude",
    method: "post",
    path: "/api/time-clock/clock-in",
    body: { latitude: "not-a-number" },
  },
  {
    label: "POST /api/time-clock/clock-out with non-numeric latitude",
    method: "post",
    path: "/api/time-clock/clock-out",
    body: { latitude: "not-a-number" },
  },
  {
    label: "PATCH /api/time-clock/my-shifts/:id/notes with no notes field",
    method: "patch",
    path: "/api/time-clock/my-shifts/00000000-0000-0000-0000-000000000000/notes",
    body: {},
  },
  {
    label: "POST /api/time-clock/shifts/:id/adjust with no reason",
    method: "post",
    path: "/api/time-clock/shifts/00000000-0000-0000-0000-000000000000/adjust",
    body: {},
  },
  {
    label: "POST /api/time-clock/shift/:id/admin-clock-out with empty reason",
    method: "post",
    path: "/api/time-clock/shift/00000000-0000-0000-0000-000000000000/admin-clock-out",
    body: { reason: "" },
  },
  {
    label: "POST /api/time-clock/shifts/:id/reject with empty reason",
    method: "post",
    path: "/api/time-clock/shifts/00000000-0000-0000-0000-000000000000/reject",
    body: { reason: "" },
  },
  {
    label: "POST /api/time-entries/:id/reject with empty reason",
    method: "post",
    path: "/api/time-entries/00000000-0000-0000-0000-000000000000/reject",
    body: { reason: "" },
  },
];

describe("time-clock and time-entry validation returns a clean 400", () => {
  for (const { label, method, path, body } of REQUIRES_VALIDATION) {
    it(label, async () => {
      const res = await request(app)[method](path).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "Invalid request body" });
      // ZodError.flatten() always produces { formErrors, fieldErrors }.
      expect(res.body.details).toBeTruthy();
      expect(res.body.details).toHaveProperty("fieldErrors");
    });
  }
});
