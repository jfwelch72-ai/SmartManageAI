/**
 * Task #2184 — regression coverage for the validation 400 path on three more
 * route files that wrap a Zod `.parse(...)` around the request body.
 *
 * Before this task, these routes called `schema.parse(req.body|sanitizedBody)`
 * directly inside an `async` handler. A malformed payload made the synchronous
 * Zod throw bubble up as an unhandled promise rejection, leaving the request
 * hanging on the client until it timed out — the same regression Task #2180
 * just fixed for the time-clock and time-entry routes. This file pins the new
 * contract: each wrapped route returns
 * `400 { error: "Invalid request body", details }` instead.
 *
 * Mocking pattern follows server/__tests__/time-routes-validation.test.ts:
 * vitest + supertest with the auth middleware, audit logger, takeoff helpers,
 * and the `db` module stubbed. The validation paths short-circuit before any
 * post-parse db call, so a chainable no-op + a single "row exists" select
 * stub is enough to push past the pre-parse 404 / access checks and reach
 * the schema.
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
  logApprove: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../utils/jobMetrics", () => ({
  recordJobMetrics: vi.fn(),
}));

vi.mock("../orgFilter", () => ({
  verifyOrgAccess: vi.fn(async () => true),
  requireOrgOwnership: vi.fn(async () => true),
  getOrgIdForFilter: () => ({
    shouldFilter: true,
    orgId: "org-1",
    mustDenyAccess: false,
    isSuperAdmin: false,
  }),
}));

// The takeoff measurement PATCH consults these helpers between the existing-row
// lookup and the parse. Stubbing them lets the request reach the schema where
// the regression actually lives.
vi.mock("../takeoffHelpers", () => ({
  verifySheetAccess: vi.fn(async () => ({ allowed: true, sheet: { id: "sheet-1" } })),
  verifyGroupAccess: vi.fn(async () => ({ allowed: true })),
  isMeasurementLocked: vi.fn(async () => false),
  safeParsePoints: vi.fn(() => null),
  getActiveDraftVersionId: vi.fn(async () => null),
  getDefaultVersionId: vi.fn(async () => null),
  getDefaultVersionIdsBatch: vi.fn(async () => new Map()),
  hasAnyVersions: vi.fn(async () => false),
}));

vi.mock("../takeoffCollaboration", () => ({
  broadcastTakeoffEvent: vi.fn(),
}));

// The pre-parse selects (existing measurement / existing category) need to
// resolve to a single row so the route does not bail with 404 before the
// schema runs. Subsequent db calls after the parse are unreachable on the
// failure path so a single shared row shape is enough.
vi.mock("../db", () => {
  const existingRow = {
    id: "row-1",
    sheetId: "sheet-1",
    type: "AREA",
    projectId: null,
    bidId: null,
  };
  return {
    db: {
      select: vi.fn(() => {
        const chain: any = {};
        chain.from = () => chain;
        chain.where = () => chain;
        chain.innerJoin = () => chain;
        chain.leftJoin = () => chain;
        chain.limit = () => chain;
        chain.orderBy = () => chain;
        chain.then = (resolve: any) => resolve([existingRow]);
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
  };
});

let app: Express;

beforeAll(async () => {
  const { default: projectFinancialRoutes } = await import("../projectFinancialRoutes");
  const { default: takeoffCategoryRoutes } = await import("../takeoffCategoryRoutes");
  const { default: takeoffMeasurementRoutes } = await import("../takeoffMeasurementRoutes");
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (testUser) req.user = testUser;
    next();
  });
  app.use(projectFinancialRoutes);
  app.use(takeoffCategoryRoutes);
  app.use(takeoffMeasurementRoutes);
  // Express 4 does not auto-forward async handler rejections to the error
  // middleware. Mounting one here ensures that if a route falls back to
  // throwing (the regression we're guarding against), the test fails loudly
  // with a 500 instead of hanging until supertest's socket timeout — which
  // is exactly the user-visible symptom this task fixed.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err?.message ?? "boom" });
  });
});

beforeEach(() => {
  // SUPER_ADMIN bypasses the project/bid access lookup inside the
  // quantity-categories PATCH so the only db call before the parse is the
  // single "existing row" select that our chain stub already covers.
  testUser = { id: "user-1", organizationId: "org-1", role: "SUPER_ADMIN" };
});

const REQUIRES_VALIDATION: Array<{
  label: string;
  method: "patch";
  path: string;
  body: any;
}> = [
  {
    // PATCH schema: { hoursRegular: z.string().optional(), ... } — passing a
    // number for a string field is the simplest payload that bypasses the
    // optional-everywhere shape and trips the parser.
    label: "PATCH /api/time-entries/:id with non-string hoursRegular",
    method: "patch",
    path: "/api/time-entries/00000000-0000-0000-0000-000000000000",
    body: { hoursRegular: 123 },
  },
  {
    // insertQuantityCategorySchema.partial() — wasteFactor is a
    // doublePrecision column, so drizzle-zod expects a number; sending a
    // non-numeric string fails before the route would attempt to update.
    label: "PATCH /api/quantity-categories/:id with non-numeric wasteFactor",
    method: "patch",
    path: "/api/quantity-categories/00000000-0000-0000-0000-000000000000",
    body: { wasteFactor: "not-a-number" },
  },
  {
    // insertTakeoffMeasurementSchema.partial() — `type` is a pgEnum so an
    // unknown value fails the enum check. `label` would have been coerced
    // to a string by sanitizeShortText, so the enum field is the cleanest
    // way to provoke the parser without first being normalised.
    label: "PATCH /api/takeoff/measurements/:id with invalid measurement type",
    method: "patch",
    path: "/api/takeoff/measurements/00000000-0000-0000-0000-000000000000",
    body: { type: "NOT_A_REAL_MEASUREMENT_TYPE" },
  },
];

describe("takeoff and project-finance validation returns a clean 400", () => {
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
