/**
 * Task #1313 — automated tests for the Davis-Bacon fallback that backs the
 * certified-payroll JSON and PDF endpoints in `server/payrollRoutes.ts`.
 *
 * The certified report logic falls back to cached Davis-Bacon rates when no
 * explicit `prevailingWageRates` row exists for a (project, classification)
 * pair, and surfaces a `missingWageDecisions` warning when a referenced wage
 * decision has not been imported into the cache. These tests cover the four
 * permutations called out in the task brief plus the cache-warning behavior:
 *
 *   - project-only wageDecision (project.wageDecision present, no PWR row)
 *   - PWR-only wageDecision (no project.wageDecision, PWR row carries the WD)
 *   - both (project + PWR), exercising PROJECT_OVERRIDE for the matched
 *     classification AND DOL_FEED fallback for a sibling classification on
 *     the same project that has no PWR row
 *   - neither (no decision anywhere) → prevailingRateSource = NONE
 *   - missing decision (isWageDeterminationCached=false) appears in
 *     missingWageDecisions; cached decisions never do
 *
 * The Davis-Bacon helpers (`lookupCachedWageRate`, `lookupCachedRateByLocale`,
 * `isWageDeterminationCached`) are mocked so we can control fallback behavior
 * without seeding `integration_sync_state`. Auth, ObjectStorage, the WH-347
 * generator, and the feature-flag service are mocked the same way the
 * existing `payrollCertifiedReportsAdmin.test.ts` mocks them — this lets us
 * call the real route handlers, against the real test DB, without dragging
 * GCS or PDFKit into the suite.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

type TestUser = {
  id: string;
  role: string;
  organizationId: string | null;
} | null;

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
  requireFeaturePermission: () =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      next();
    },
  requireRole: (..._roles: string[]) =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      next();
    },
}));

// Davis-Bacon lookup helpers are the *unit under test boundary* — we mock
// them so each test can pin exactly which decisions are cached and which
// classifications resolve to which base rates.
const lookupCachedWageRateMock = vi.fn();
const lookupCachedRateByLocaleMock = vi.fn();
const isWageDeterminationCachedMock = vi.fn();
vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  lookupCachedWageRate: (...args: unknown[]) => lookupCachedWageRateMock(...args),
  lookupCachedRateByLocale: (...args: unknown[]) => lookupCachedRateByLocaleMock(...args),
  isWageDeterminationCached: (...args: unknown[]) => isWageDeterminationCachedMock(...args),
  fetchWageDetermination: vi.fn(),
  importWageDetermination: vi.fn(),
}));

// Feature-flag check on the PDF endpoint — always grant WH_347_PAYROLL.
vi.mock("../services/featureFlagService", () => ({
  getFeatureFlags: vi.fn(async () => ({ WH_347_PAYROLL: true })),
}));

// PDF generator is mocked so we can capture what the route handed it
// (specifically the per-employee rows + missingWageDecisions) instead of
// asserting against a binary PDF.
const generateWH347PdfMock = vi.fn(async (_payload: unknown, _variant: string) => {
  return Buffer.from("%PDF-1.4 stub");
});
vi.mock("../services/wh347Generator", () => ({
  generateWH347Pdf: (...args: unknown[]) => generateWH347PdfMock(...(args as [unknown, string])),
}));

// Heavy / unrelated transitive deps — quiet the import graph.
vi.mock("../events", () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }));
vi.mock("../rateLimiter", () => ({
  exportLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  apiLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  authLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  sensitiveLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    deleteObjectByKey = vi.fn(async () => undefined);
  },
  objectStorageClient: {
    bucket: () => ({ file: () => ({ save: vi.fn(async () => undefined) }) }),
  },
}));
vi.mock("../objectAcl", () => ({
  setObjectAclPolicy: vi.fn(async () => undefined),
}));
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(),
  composeEmailContent: vi.fn(),
}));
vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(),
  insertNotifications: vi.fn(),
}));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const TEST_PREFIX = "__cpr_db_fallback__";

let app: Express;
let db: typeof import("../db").db;

interface Fixtures {
  orgId: string;
  adminId: string;
  payRunId: string;
  projects: {
    A: string; // project.wageDecision only, no PWR row
    B: string; // PWR row only (carries wageDecision), no project.wageDecision
    C: string; // both project.wageDecision AND PWR row(s)
    D: string; // neither — no decision anywhere
    E: string; // project.wageDecision that is *not* cached → missing
  };
  classifications: {
    carpA: string;
    elecB: string;
    carpC: string;
    laborC: string;
    carpD: string;
    glazE: string;
  };
  users: {
    uA: string;
    uB: string;
    uC1: string;
    uC2: string;
    uD: string;
    uE: string;
  };
}

let fx: Fixtures;

async function cleanup(): Promise<void> {
  // Order matters: dependents first.
  await db.execute(sql`
    DELETE FROM "certified_payroll_reports" WHERE "object_key" LIKE ${TEST_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM "pay_run_line_items" WHERE pay_run_id IN (
      SELECT id FROM "pay_runs" WHERE notes = ${TEST_PREFIX}
    )
  `);
  await db.execute(sql`DELETE FROM "pay_runs" WHERE notes = ${TEST_PREFIX}`);
  await db.execute(sql`
    DELETE FROM "prevailing_wage_rates" WHERE project_id IN (
      SELECT id FROM "projects" WHERE code LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`
    DELETE FROM "employee_classifications" WHERE user_id IN (
      SELECT id FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`
    DELETE FROM "audit_log" WHERE user_id IN (
      SELECT id FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`DELETE FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM "projects" WHERE code LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`
    DELETE FROM "job_classifications" WHERE name LIKE ${TEST_PREFIX + "%"}
  `);
  await db.execute(sql`DELETE FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}`);
}

async function seedFixtures(): Promise<Fixtures> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const orgRow = await db.execute(sql`
    INSERT INTO "organizations" (name, slug)
    VALUES (${TEST_PREFIX + "org"}, ${TEST_PREFIX + suffix})
    RETURNING id
  `);
  const orgId = (orgRow.rows[0] as { id: string }).id;

  const adminRow = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Admin', 'A', ${TEST_PREFIX + suffix + "-admin@example.com"}, 'ADMIN')
    RETURNING id
  `);
  const adminId = (adminRow.rows[0] as { id: string }).id;

  const insertProject = async (label: string, wageDecision: string | null) => {
    const r = await db.execute(sql`
      INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision, payroll_form_variant, state)
      VALUES (
        ${TEST_PREFIX + label},
        ${TEST_PREFIX + suffix + "-" + label},
        ${TEST_PREFIX + "client"},
        ${orgId},
        'ACTIVE',
        ${wageDecision},
        'WH_347',
        'CA'
      )
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };

  const projects = {
    A: await insertProject("pA", "WD-A"),
    B: await insertProject("pB", null),
    C: await insertProject("pC", "WD-C"),
    D: await insertProject("pD", null),
    E: await insertProject("pE", "WD-E"),
  };

  const insertClass = async (name: string) => {
    const r = await db.execute(sql`
      INSERT INTO "job_classifications" (organization_id, name)
      VALUES (${orgId}, ${TEST_PREFIX + name})
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };

  const classifications = {
    carpA: await insertClass("Carpenter-A"),
    elecB: await insertClass("Electrician-B"),
    carpC: await insertClass("Carpenter-C"),
    laborC: await insertClass("Laborer-C"),
    carpD: await insertClass("Carpenter-D"),
    glazE: await insertClass("Glazier-E"),
  };

  const insertUser = async (label: string) => {
    const r = await db.execute(sql`
      INSERT INTO "users" (organization_id, first_name, last_name, email, role)
      VALUES (${orgId}, ${"Emp"}, ${label}, ${TEST_PREFIX + suffix + "-" + label + "@example.com"}, 'FIELD_WORKER')
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };

  const users = {
    uA: await insertUser("uA"),
    uB: await insertUser("uB"),
    uC1: await insertUser("uC1"),
    uC2: await insertUser("uC2"),
    uD: await insertUser("uD"),
    uE: await insertUser("uE"),
  };

  const assignClass = async (
    userId: string,
    classificationId: string,
    regular = "20.00",
    overtime = "30.00",
  ) => {
    await db.execute(sql`
      INSERT INTO "employee_classifications"
        (organization_id, user_id, classification_id, regular_rate, overtime_rate, is_primary, effective_date)
      VALUES
        (${orgId}, ${userId}, ${classificationId}, ${regular}, ${overtime}, true, '2026-01-01')
    `);
  };
  await assignClass(users.uA, classifications.carpA);
  await assignClass(users.uB, classifications.elecB);
  await assignClass(users.uC1, classifications.carpC);
  await assignClass(users.uC2, classifications.laborC);
  await assignClass(users.uD, classifications.carpD);
  await assignClass(users.uE, classifications.glazE);

  // Scenario B: PWR row covers (Project B, Electrician-B) and carries
  // its own wage decision "WD-B". This exercises (i) PROJECT_OVERRIDE
  // labeling and (ii) the "borrow decision from PWR row" path — the route
  // adds WD-B to projectDecisionMap so isWageDeterminationCached("WD-B")
  // is asked at warning-collection time.
  await db.execute(sql`
    INSERT INTO "prevailing_wage_rates"
      (organization_id, project_id, classification_id, wage_rate, fringe_rate, total_rate, effective_date, wage_decision)
    VALUES
      (${orgId}, ${projects.B}, ${classifications.elecB}, '60.00', '0.00', '60.00', '2026-01-01', 'WD-B')
  `);

  // Scenario C "both": project.wageDecision="WD-C" PLUS a PWR row that
  // covers Carpenter-C → that classification is PROJECT_OVERRIDE, but
  // sibling Laborer-C on the same project has no PWR row and must
  // fall back via project.wageDecision="WD-C" → DOL_FEED.
  await db.execute(sql`
    INSERT INTO "prevailing_wage_rates"
      (organization_id, project_id, classification_id, wage_rate, fringe_rate, total_rate, effective_date)
    VALUES
      (${orgId}, ${projects.C}, ${classifications.carpC}, '55.00', '0.00', '55.00', '2026-01-01')
  `);

  const payRunRow = await db.execute(sql`
    INSERT INTO "pay_runs" (organization_id, pay_period_start, pay_period_end, run_number, created_by_id, notes)
    VALUES (${orgId}, '2026-04-13', '2026-04-19', '1', ${adminId}, ${TEST_PREFIX})
    RETURNING id
  `);
  const payRunId = (payRunRow.rows[0] as { id: string }).id;

  // Worker rate (10.00) is intentionally well below every prevailing rate
  // we set up, so `belowPrevailingWage=true` whenever a rate resolves.
  const insertLine = async (userId: string, projectId: string) => {
    await db.execute(sql`
      INSERT INTO "pay_run_line_items"
        (pay_run_id, user_id, project_id, regular_hours, overtime_hours, regular_rate, overtime_rate, total_amount, gross_amount, total_deductions, net_amount)
      VALUES
        (${payRunId}, ${userId}, ${projectId}, '40', '0', '10.00', '15.00', '400.00', '400.00', '0', '400.00')
    `);
  };
  await insertLine(users.uA, projects.A);
  await insertLine(users.uB, projects.B);
  await insertLine(users.uC1, projects.C);
  await insertLine(users.uC2, projects.C);
  await insertLine(users.uD, projects.D);
  await insertLine(users.uE, projects.E);

  return { orgId, adminId, payRunId, projects, classifications, users };
}

beforeAll(async () => {
  ({ db } = await import("../db"));
  const { default: payrollRoutes } = await import("../payrollRoutes");

  app = express();
  app.use(express.json());
  app.use(payrollRoutes);

  await cleanup();
  fx = await seedFixtures();
}, 60_000);

beforeEach(() => {
  testUser = null;
  lookupCachedWageRateMock.mockReset();
  lookupCachedRateByLocaleMock.mockReset();
  isWageDeterminationCachedMock.mockReset();
  generateWH347PdfMock.mockClear();

  // Default mocks: nothing cached, nothing resolves. Individual tests
  // override as needed.
  lookupCachedWageRateMock.mockResolvedValue(null);
  lookupCachedRateByLocaleMock.mockResolvedValue(null);
  isWageDeterminationCachedMock.mockResolvedValue(true);

  // Authenticate as the seeded org admin for every test by default.
  testUser = { id: fx.adminId, role: "ADMIN", organizationId: fx.orgId };
});

afterAll(async () => {
  await cleanup();
});

/**
 * Configure the Davis-Bacon mocks for the standard "all decisions cached
 * except WD-E" scenario shared by several tests.
 *
 * - WD-A (project-only) → resolves Carpenter-A to baseRate 50
 * - WD-C (both) → resolves Laborer-C to baseRate 30 (sibling fallback)
 * - WD-B (PWR-only) → no lookup needed because PWR row already provides
 *   the rate for Electrician-B; WD-B is only consulted by
 *   isWageDeterminationCached for the warning sweep
 * - WD-E → not cached → must surface in missingWageDecisions
 */
function configureStandardDavisBaconMocks(): void {
  lookupCachedWageRateMock.mockImplementation(
    async (_orgId: string, decision: string, classification: string) => {
      const norm = classification.toLowerCase();
      if (decision === "WD-A" && norm.includes("carpenter-a")) {
        return { classification, baseRate: 50, fringeRate: 0, totalRate: 50 };
      }
      if (decision === "WD-C" && norm.includes("laborer-c")) {
        return { classification, baseRate: 30, fringeRate: 0, totalRate: 30 };
      }
      // WD-E intentionally returns null even though it's looked up — the
      // missing-cache path is asserted via isWageDeterminationCached.
      return null;
    },
  );
  isWageDeterminationCachedMock.mockImplementation(async (_orgId: string, decision: string) => {
    return decision !== "WD-E";
  });
}

describe("GET /api/payroll/pay-runs/:id/certified-report — Davis-Bacon fallback", () => {
  it("labels prevailingRateSource as PROJECT_OVERRIDE, DOL_FEED, or NONE per (project, classification)", async () => {
    configureStandardDavisBaconMocks();

    const res = await request(app).get(`/api/payroll/pay-runs/${fx.payRunId}/certified-report`);
    expect(res.status).toBe(200);

    const employees = res.body.employees as Array<{
      name: string;
      workClassification: string;
      prevailingRate: number | null;
      prevailingRateSource: "PROJECT_OVERRIDE" | "DOL_FEED" | "NONE";
      belowPrevailingWage: boolean;
      projectName: string;
    }>;

    const byClass = new Map(employees.map((e) => [e.workClassification, e]));

    // Scenario A — project-only wageDecision → DOL_FEED
    const carpA = byClass.get(TEST_PREFIX + "Carpenter-A")!;
    expect(carpA.prevailingRateSource).toBe("DOL_FEED");
    expect(carpA.prevailingRate).toBe(50);
    expect(carpA.belowPrevailingWage).toBe(true);

    // Scenario B — PWR-only (PWR row provides the rate) → PROJECT_OVERRIDE
    const elecB = byClass.get(TEST_PREFIX + "Electrician-B")!;
    expect(elecB.prevailingRateSource).toBe("PROJECT_OVERRIDE");
    expect(elecB.prevailingRate).toBe(60);
    expect(elecB.belowPrevailingWage).toBe(true);

    // Scenario C "both" — Carpenter-C is covered by an explicit PWR row
    // and must remain PROJECT_OVERRIDE even though the project also has
    // wageDecision="WD-C".
    const carpC = byClass.get(TEST_PREFIX + "Carpenter-C")!;
    expect(carpC.prevailingRateSource).toBe("PROJECT_OVERRIDE");
    expect(carpC.prevailingRate).toBe(55);

    // Scenario C sibling — Laborer-C has no PWR row, so the project's
    // wageDecision drives a Davis-Bacon lookup → DOL_FEED at 30.
    const laborC = byClass.get(TEST_PREFIX + "Laborer-C")!;
    expect(laborC.prevailingRateSource).toBe("DOL_FEED");
    expect(laborC.prevailingRate).toBe(30);

    // Scenario D — no decision anywhere → NONE / null rate.
    const carpD = byClass.get(TEST_PREFIX + "Carpenter-D")!;
    expect(carpD.prevailingRateSource).toBe("NONE");
    expect(carpD.prevailingRate).toBeNull();
    expect(carpD.belowPrevailingWage).toBe(false);

    // Scenario E — has a wageDecision but the cached lookup returns null,
    // so no rate is resolved (NONE). The missing warning is asserted in
    // the next test.
    const glazE = byClass.get(TEST_PREFIX + "Glazier-E")!;
    expect(glazE.prevailingRateSource).toBe("NONE");
    expect(glazE.prevailingRate).toBeNull();
  });

  it("populates missingWageDecisions only for decisions where isWageDeterminationCached returns false", async () => {
    configureStandardDavisBaconMocks();

    const res = await request(app).get(`/api/payroll/pay-runs/${fx.payRunId}/certified-report`);
    expect(res.status).toBe(200);

    const missing = res.body.missingWageDecisions as Array<{
      projectId: string;
      projectName: string;
      wageDecision: string;
    }>;

    // WD-A, WD-B, and WD-C are all cached → none of them appear here.
    // WD-E is the only uncached decision referenced by the pay run.
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      projectId: fx.projects.E,
      wageDecision: "WD-E",
    });
    expect(missing[0].projectName).toContain("pE");

    // Also assert the inverse direction: WD-A is asked about, and because
    // the cache check returns true it does NOT appear in missing. This
    // proves the warning is gated on the cache check, not on whether a
    // rate was successfully resolved.
    const askedDecisions = isWageDeterminationCachedMock.mock.calls.map((c) => c[1]);
    expect(askedDecisions).toEqual(expect.arrayContaining(["WD-A", "WD-B", "WD-C", "WD-E"]));
  });

  it("treats every referenced decision as missing when the cache check uniformly returns false", async () => {
    // Override the standard config so isWageDeterminationCached → false
    // for every decision. Every project that references a decision must
    // now appear in missingWageDecisions.
    lookupCachedWageRateMock.mockResolvedValue(null);
    isWageDeterminationCachedMock.mockResolvedValue(false);

    const res = await request(app).get(`/api/payroll/pay-runs/${fx.payRunId}/certified-report`);
    expect(res.status).toBe(200);

    const missing = res.body.missingWageDecisions as Array<{ wageDecision: string }>;
    const decisions = new Set(missing.map((m) => m.wageDecision));
    // Project D has no decision anywhere → never in missing.
    expect(decisions).toEqual(new Set(["WD-A", "WD-B", "WD-C", "WD-E"]));
  });
});

describe("GET /api/payroll/pay-runs/:id/certified-payroll-pdf — Davis-Bacon fallback", () => {
  it("hands the WH-347 generator the same prevailingRateSource labels and missingWageDecisions list", async () => {
    configureStandardDavisBaconMocks();

    const res = await request(app).get(`/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);

    expect(generateWH347PdfMock).toHaveBeenCalledTimes(1);
    const [payload] = generateWH347PdfMock.mock.calls[0] as [
      {
        employees: Array<{
          workClassification: string;
          prevailingRate: number | null;
          prevailingRateSource: "PROJECT_OVERRIDE" | "DOL_FEED" | "NONE";
        }>;
        missingWageDecisions: Array<{ projectName: string; wageDecision: string }>;
      },
      string,
    ];

    const byClass = new Map(payload.employees.map((e) => [e.workClassification, e]));

    expect(byClass.get(TEST_PREFIX + "Carpenter-A")?.prevailingRateSource).toBe("DOL_FEED");
    expect(byClass.get(TEST_PREFIX + "Carpenter-A")?.prevailingRate).toBe(50);

    expect(byClass.get(TEST_PREFIX + "Electrician-B")?.prevailingRateSource).toBe("PROJECT_OVERRIDE");
    expect(byClass.get(TEST_PREFIX + "Electrician-B")?.prevailingRate).toBe(60);

    expect(byClass.get(TEST_PREFIX + "Carpenter-C")?.prevailingRateSource).toBe("PROJECT_OVERRIDE");
    expect(byClass.get(TEST_PREFIX + "Carpenter-C")?.prevailingRate).toBe(55);

    expect(byClass.get(TEST_PREFIX + "Laborer-C")?.prevailingRateSource).toBe("DOL_FEED");
    expect(byClass.get(TEST_PREFIX + "Laborer-C")?.prevailingRate).toBe(30);

    expect(byClass.get(TEST_PREFIX + "Carpenter-D")?.prevailingRateSource).toBe("NONE");
    expect(byClass.get(TEST_PREFIX + "Carpenter-D")?.prevailingRate).toBeNull();

    expect(payload.missingWageDecisions).toHaveLength(1);
    expect(payload.missingWageDecisions[0].wageDecision).toBe("WD-E");
    expect(payload.missingWageDecisions[0].projectName).toContain("pE");
  });
});
