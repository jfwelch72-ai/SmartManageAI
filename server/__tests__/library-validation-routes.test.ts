/**
 * Task #2165 — regression coverage for the validation 400 path on the library
 * routes that wrap a Zod `.parse(...)` around the request body.
 *
 * Before this task, those routes called `schema.parse(...)` directly inside
 * an `async` handler. A malformed payload (e.g. missing `unitOfMeasure` on
 * an assembly create) made the synchronous Zod throw bubble up as an
 * unhandled promise rejection, leaving the request hanging on the client
 * until it timed out. This file pins the new contract: every wrapped route
 * returns `400 { error, details }` instead.
 *
 * Mocking pattern follows server/__tests__/library-bulk-routes.test.ts:
 * vitest + supertest with the auth middleware, audit logger, and the `db`
 * module stubbed. Drizzle operators are passed through untouched — the
 * validation paths short-circuit before any db call, so a no-op db stub
 * is enough.
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
  const { default: libraryRoutes } = await import("../libraryRoutes");
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (testUser) req.user = testUser;
    next();
  });
  app.use(libraryRoutes);
  // Express 4 does not auto-forward async handler rejections to the error
  // middleware. Mounting one here ensures that if the route ever falls back
  // to throwing (the regression we're guarding against), the test fails
  // loudly with a 500 instead of hanging until supertest's socket timeout —
  // which is exactly the user-visible symptom the task was filed to fix.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err?.message ?? "boom" });
  });
});

beforeEach(() => {
  testUser = { id: "user-1", organizationId: "org-1", role: "ESTIMATOR" };
});

const REQUIRES_VALIDATION: Array<{
  label: string;
  method: "post";
  path: string;
  // A body that is guaranteed to be missing at least one required field
  // for the route's insert schema. Each route enforces its own required
  // columns so the missing fields differ per case.
  body: any;
}> = [
  {
    label: "POST /api/custom-libraries with no name",
    method: "post",
    path: "/api/custom-libraries",
    body: {},
  },
  {
    label: "POST /api/library-categories with no name",
    method: "post",
    path: "/api/library-categories",
    body: { tradeType: "CONCRETE" },
  },
  {
    label: "POST /api/library-items with no name / unitOfMeasure",
    method: "post",
    path: "/api/library-items",
    body: { itemNumber: "100" },
  },
  {
    label: "POST /api/library-assemblies with no unitOfMeasure (the originally reported case)",
    method: "post",
    path: "/api/library-assemblies",
    body: { name: "Missing UOM Assembly" },
  },
  {
    label: "POST /api/saved-takeoffs with no name / data",
    method: "post",
    path: "/api/saved-takeoffs",
    body: {},
  },
];

describe("library route validation returns a clean 400", () => {
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

  it("POST /api/library-items/import surfaces the failing item index", async () => {
    const res = await request(app).post("/api/library-items/import").send({
      items: [
        // First entry has every required column on insertLibraryItemSchema
        // (the route stamps organizationId from the auth user) so the loop
        // gets past index 0; the second is missing `unitOfMeasure` /
        // `purchaseUnit` / `name` so the route must point us at index 1.
        { name: "OK Item", unitOfMeasure: "EA", purchaseUnit: "EA" },
        { itemNumber: "bad-row" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ index: 1 });
    expect(res.body.error).toContain("index 1");
    expect(res.body.details).toHaveProperty("fieldErrors");
  });

  it("returns 401 (not 400) when the caller has no org, regardless of body shape", async () => {
    testUser = null;
    const res = await request(app).post("/api/library-assemblies").send({});
    expect(res.status).toBe(401);
  });
});
