/**
 * Task #2181 — Contract tests for `parseOrRespond` (server/utils/validation.ts).
 *
 * `parseOrRespond` was promoted from libraryRoutes to a shared helper in
 * Task #2179 and is now used across ~20 route modules. The helper exists to
 * stop a Zod throw from a malformed payload bubbling out of an `async`
 * Express handler as an unhandled promise rejection (which leaves the
 * request hanging on the client until socket timeout, then surfaces as a
 * generic 500). The contract is:
 *
 *     status   === 400
 *     body     === { error: "Invalid request body", details: <ZodError.flatten()> }
 *
 * `ZodError.flatten()` always produces an object of the shape
 * `{ formErrors: string[], fieldErrors: Record<string, string[]> }`, so a
 * non-empty `fieldErrors` is the closest stable shape to "non-empty
 * details" called for in the task brief. The `parseOrRespond` source — not
 * the brief — is the source of truth for the literal error string.
 *
 * The library routes already have their own dedicated regression suite
 * (`server/__tests__/library-validation-routes.test.ts`, Task #2165). This
 * file widens the net to a representative sample of the *other* route
 * modules that adopted `parseOrRespond` so a future refactor of the helper
 * (or a route reverting to bare `.parse(...)`) gets caught everywhere it
 * matters: status page admin, takeoff markups, equipment rentals, labor
 * rates, payroll notifications, and field productivity (voice log parse).
 *
 * Each test sends an intentionally malformed body (missing required fields
 * or wrong-typed values). Because validation short-circuits before the
 * route touches the database, the no-op `db` stub below never has to model
 * an "imaginary success" — if a route ever fell back to throwing, the
 * Express error middleware mounted in `buildApp()` would translate it to
 * a 500 and the test would fail loudly instead of timing out.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

type TestUser = {
  id: string;
  organizationId: string;
  role: string;
  firstName?: string;
  lastName?: string;
  effectiveRole?: string;
};

const TEST_USER: TestUser = {
  id: "user-1",
  organizationId: "org-1",
  role: "ADMIN",
  firstName: "Test",
  lastName: "User",
  effectiveRole: "ADMIN",
};

vi.mock("../auth", () => {
  const passthrough = (
    req: Request & { user?: TestUser },
    _res: Response,
    next: NextFunction,
  ) => {
    req.user = TEST_USER;
    next();
  };
  return {
    requireAuth: passthrough,
    requireRole: () => passthrough,
    requireFeaturePermission: () => passthrough,
    requireRoleOrFeature: () => passthrough,
    requireActiveOrganization: passthrough,
  };
});

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

// `parseOrRespond` short-circuits before any db call, so a no-op chainable
// is enough. If a route accidentally falls through to a real query, we'd
// rather see the test hang on a never-resolving promise so we can debug it
// than have a mock silently invent a "successful" insert that lets a 500
// regression slip through as a 200.
vi.mock("../db", () => {
  // The chainable resolves to a single `{ count: 0 }` row so routes that
  // pre-compute a sequence number (e.g. `rfiRoutes` builds `RFI-001` from
  // `select({ count }).from(rfis)`) can reach `parseOrRespond` without
  // crashing on `undefined.count`. Tests that don't read fields off the
  // row simply ignore the extra column.
  const chainable = (): any => {
    const chain: any = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.values = () => chain;
    chain.set = () => chain;
    chain.returning = () => Promise.resolve([{ count: 0 }]);
    chain.then = (resolve: any) => resolve([{ count: 0 }]);
    return chain;
  };
  return {
    db: {
      select: vi.fn(chainable),
      insert: vi.fn(chainable),
      update: vi.fn(chainable),
      delete: vi.fn(chainable),
      execute: vi.fn(async () => ({ rows: [{ count: 0 }] })),
    },
    pool: {},
  };
});

vi.mock("../orgFilter", async () => {
  const actual = await vi.importActual<typeof import("../orgFilter")>(
    "../orgFilter",
  );
  return {
    ...actual,
    getOrgIdForFilter: () => ({
      shouldFilter: true,
      orgId: TEST_USER.organizationId,
      isSuperAdmin: false,
      mustDenyAccess: false,
    }),
    verifyOrgAccess: () => true,
  };
});

vi.mock("../sanitization", () => ({
  sanitizeShortText: (v: unknown) => v,
  sanitizeText: (v: unknown) => v,
}));

vi.mock("../takeoffHelpers", () => ({
  verifySheetAccess: vi.fn(async () => ({ allowed: true })),
  safeParsePoints: () => [],
}));

// statusPageRoutes pulls in scheduler/audit modules that touch the DB on
// import. We don't exercise their code paths here, but stub them to keep
// the import side-effect-free.
vi.mock("../statusProbeScheduler", () => ({
  runProbeSweep: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../statusAlertService", () => ({
  getAlertOverview: vi.fn(async () => ({})),
  sendTestAlert: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../webhookSecretsAudit", () => ({
  collectWebhookSecretFindings: () => [],
}));

function mountErrorHandler(app: Express) {
  // Express 4 does not auto-forward async handler rejections. Mounting one
  // here makes the regression we're guarding against (a route falling back
  // to throwing through Zod) fail loudly with a 500 instead of the
  // user-visible symptom that motivated `parseOrRespond` in the first
  // place: a request hanging until supertest's socket timeout.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err?.message ?? "boom" });
  });
}

let statusApp: Express;
let takeoffApp: Express;
let equipmentApp: Express;
let laborRateApp: Express;
let payrollApp: Express;
let fieldProductivityApp: Express;
let libraryApp: Express;
let rfiApp: Express;

beforeAll(async () => {
  const { default: statusPageRoutes } = await import("../statusPageRoutes");
  const { default: takeoffCategoryRoutes } = await import(
    "../takeoffCategoryRoutes"
  );
  const { default: equipmentRoutes } = await import("../equipmentRoutes");
  const { default: laborRateRoutes } = await import("../laborRateRoutes");
  const { default: payrollRoutes } = await import("../payrollRoutes");
  const { default: fieldProductivityRoutes } = await import(
    "../fieldProductivityRoutes"
  );
  const { default: libraryRoutes } = await import("../libraryRoutes");
  const { default: rfiRoutes } = await import("../rfiRoutes");

  function build(mount: (app: Express) => void): Express {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = TEST_USER;
      next();
    });
    mount(app);
    mountErrorHandler(app);
    return app;
  }

  statusApp = build((a) => a.use(statusPageRoutes));
  takeoffApp = build((a) => a.use(takeoffCategoryRoutes));
  equipmentApp = build((a) => a.use(equipmentRoutes));
  // laborRateRoutes is mounted under `/api/labor-rates` in production
  // (server/routes.ts), so its internal paths are `/classifications`, etc.
  laborRateApp = build((a) => a.use("/api/labor-rates", laborRateRoutes));
  payrollApp = build((a) => a.use(payrollRoutes));
  // fieldProductivityRoutes is mounted under `/api/field-productivity`.
  fieldProductivityApp = build((a) =>
    a.use("/api/field-productivity", fieldProductivityRoutes),
  );
  libraryApp = build((a) => a.use(libraryRoutes));
  // rfiRoutes is mounted under `/api` in production (server/routes.ts), so
  // its internal paths (`/rfi`) become `/api/rfi`.
  rfiApp = build((a) => a.use("/api", rfiRoutes));
});

/**
 * Asserts the `parseOrRespond` 400 contract on a single response. We assert
 * on the literal `error` string because regressing to "Invalid input" /
 * "Validation failed" / a generic 500 are exactly the failure modes Task
 * #2179 wanted ruled out across the converted routes. `details` is the
 * `ZodError.flatten()` shape, so a populated `fieldErrors` is the
 * "non-empty details" signal — the brief calls it an "array" but the
 * helper has always returned the flattened object form, and that's what
 * the converted routes (and existing libraryRoutes test) ship.
 */
function expectParseOrRespond400(res: { status: number; body: any }) {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ error: "Invalid request body" });
  expect(res.body.details).toBeTruthy();
  expect(res.body.details).toHaveProperty("fieldErrors");
  const fieldErrors = res.body.details.fieldErrors as Record<string, string[]>;
  // At least one field has at least one validation message — proves the
  // 400 isn't a generic short-circuit unrelated to the malformed body.
  const populatedFields = Object.values(fieldErrors).filter(
    (msgs) => Array.isArray(msgs) && msgs.length > 0,
  );
  expect(populatedFields.length).toBeGreaterThan(0);
}

describe("parseOrRespond contract — status page admin routes", () => {
  it("POST /api/admin/status/components rejects an empty body (key + name required)", async () => {
    const res = await request(statusApp)
      .post("/api/admin/status/components")
      .send({});
    expectParseOrRespond400(res);
  });

  it("POST /api/admin/status/incidents rejects a too-short title", async () => {
    const res = await request(statusApp)
      .post("/api/admin/status/incidents")
      .send({ title: "x" }); // min(3) on title
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — takeoff routes", () => {
  it("POST /api/takeoff/markups rejects a body missing the required sheetId/kind/points", async () => {
    const res = await request(takeoffApp)
      .post("/api/takeoff/markups")
      .send({});
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — equipment routes", () => {
  it("POST /api/rental-vendors rejects a body missing the required vendor name", async () => {
    const res = await request(equipmentApp)
      .post("/api/rental-vendors")
      .send({});
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — labor rate routes", () => {
  it("POST /api/labor-rates/classifications rejects an empty body", async () => {
    const res = await request(laborRateApp)
      .post("/api/labor-rates/classifications")
      .send({});
    expectParseOrRespond400(res);
  });

  it("POST /api/labor-rates/employee-classifications rejects an empty body", async () => {
    const res = await request(laborRateApp)
      .post("/api/labor-rates/employee-classifications")
      .send({});
    expectParseOrRespond400(res);
  });

  it("POST /api/labor-rates/burden-rates rejects an empty body", async () => {
    const res = await request(laborRateApp)
      .post("/api/labor-rates/burden-rates")
      .send({});
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — payroll routes", () => {
  it("POST /api/payroll-notifications rejects a body missing periodStart/periodEnd", async () => {
    const res = await request(payrollApp)
      .post("/api/payroll-notifications")
      .send({});
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — field productivity routes", () => {
  it("POST /api/field-productivity/voice-logs/parse rejects an empty body (transcription + outputType required)", async () => {
    const res = await request(fieldProductivityApp)
      .post("/api/field-productivity/voice-logs/parse")
      .send({});
    expectParseOrRespond400(res);
  });

  it("POST /api/field-productivity/voice-logs rejects a body missing required voice-log fields", async () => {
    const res = await request(fieldProductivityApp)
      .post("/api/field-productivity/voice-logs")
      .send({});
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — RFI routes", () => {
  it("POST /api/rfi rejects a body missing the required RFI fields (subject/projectId)", async () => {
    // The handler builds rfiNumber from a count query before calling
    // `parseOrRespond`, so the db mock returns `[{ count: 0 }]` — see the
    // `vi.mock("../db", ...)` block above. With that in place, an empty
    // body still fails the Zod schema and surfaces the JSON 400 contract.
    const res = await request(rfiApp).post("/api/rfi").send({});
    expectParseOrRespond400(res);
  });
});

describe("parseOrRespond contract — library routes (smoke)", () => {
  // Deeper library coverage lives in
  // server/__tests__/library-validation-routes.test.ts (Task #2165). One
  // smoke case here keeps libraryRoutes in the cross-route guarantee so
  // a future helper-level regression is caught here too.
  it("POST /api/library-assemblies rejects a body missing unitOfMeasure", async () => {
    const res = await request(libraryApp)
      .post("/api/library-assemblies")
      .send({ name: "Missing UOM Assembly" });
    expectParseOrRespond400(res);
  });
});
