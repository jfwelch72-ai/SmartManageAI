/**
 * Task #1325 — automated tests for the project prevailing wage summary
 * endpoint:
 *
 *   GET /api/projects/:id/prevailing-wage-summary
 *
 * The handler resolves classifications from two sources:
 *   1. PROJECT_OVERRIDE — explicit `prevailing_wage_rates` rows for the
 *      project + classification.
 *   2. DOL_FEED — when the project has a `wage_decision` set, classifications
 *      referenced by employees who logged time on the project (and are NOT
 *      already covered by an override) get backfilled from the cached
 *      Davis-Bacon feed via `lookupCachedWageRate`.
 *
 * It also surfaces a "missing decision" warning by reporting
 * `wageDecisionCached` (true / false / null) based on
 * `isWageDeterminationCached` for the project's wage decision.
 *
 * The Davis-Bacon helpers are mocked so each scenario can pin which
 * decisions are cached and which classification names resolve to which
 * cached rates without seeding `integration_sync_state`.
 *
 * The five scenarios required by the task brief, all in a single seeded
 * organization with five sibling projects:
 *
 *   - A: project with only overrides (no project.wageDecision)
 *   - B: project with only DOL feed hits (wageDecision set, no PWR rows;
 *        time-tracked users supply the classifications to look up)
 *   - C: project with mixed sources (wageDecision + one PWR row + a
 *        sibling classification that must fall back to DOL_FEED)
 *   - D: project with a wage decision that is NOT cached
 *        (wageDecisionCached=false fires the missing-decision warning;
 *        no DOL_FEED rows resolve)
 *   - E: project with no wage decision at all (wageDecisionCached=null,
 *        no classifications resolved)
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

// Davis-Bacon lookup helpers are the resolution boundary under test —
// mock them so we can pin exactly which decisions are cached and which
// classifications resolve to which cached base rates.
const lookupCachedWageRateMock = vi.fn();
const lookupCachedRateByLocaleMock = vi.fn();
const isWageDeterminationCachedMock = vi.fn();
const listCachedDecisionClassificationsMock = vi.fn();
const queueWageDecisionSyncMock = vi.fn();
const getWageDecisionSyncStatusMock = vi.fn();
vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  lookupCachedWageRate: lookupCachedWageRateMock,
  lookupCachedRateByLocale: lookupCachedRateByLocaleMock,
  isWageDeterminationCached: isWageDeterminationCachedMock,
  listCachedDecisionClassifications: listCachedDecisionClassificationsMock,
  queueWageDecisionSync: queueWageDecisionSyncMock,
  getWageDecisionSyncStatus: getWageDecisionSyncStatusMock,
  fetchWageDetermination: vi.fn(),
  importWageDetermination: vi.fn(),
}));

// Quiet unrelated transitive deps from the payroll route module.
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

const TEST_PREFIX = "__pwsum__";

let app: Express;
let db: typeof import("../db").db;

interface Fixtures {
  orgId: string;
  otherOrgId: string;
  adminId: string;
  otherAdminId: string;
  projects: {
    A: string; // overrides only, no wageDecision
    B: string; // wageDecision="WD-B", no overrides; users with time
    C: string; // wageDecision="WD-C", one override + one DOL_FEED sibling
    D: string; // wageDecision="WD-D" but NOT cached; no overrides
    E: string; // no wageDecision and no overrides
    F: string; // wageDecision="WD-F", cached, but NO time entries yet
  };
  classifications: {
    carpA: string;
    elecA: string;
    carpB: string;
    elecB: string;
    carpC: string; // override on project C
    laborC: string; // DOL_FEED fallback on project C
    glazD: string;
    carpF: string; // matched cached WD entry on project F
  };
  users: {
    uA1: string; // for project A — but A is overrides-only, so no time needed
    uB1: string;
    uB2: string;
    uC1: string;
    uC2: string;
    uD1: string;
  };
}

let fx: Fixtures;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "prevailing_wage_rates" WHERE project_id IN (
      SELECT id FROM "projects" WHERE code LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`
    DELETE FROM "time_entries" WHERE project_id IN (
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

  const insertOrg = async (label: string) => {
    const r = await db.execute(sql`
      INSERT INTO "organizations" (name, slug)
      VALUES (${TEST_PREFIX + label}, ${TEST_PREFIX + suffix + "-" + label})
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };
  const orgId = await insertOrg("org");
  const otherOrgId = await insertOrg("other");

  const insertAdmin = async (organizationId: string, label: string) => {
    const r = await db.execute(sql`
      INSERT INTO "users" (organization_id, first_name, last_name, email, role)
      VALUES (
        ${organizationId},
        'Admin',
        ${label},
        ${TEST_PREFIX + suffix + "-admin-" + label + "@example.com"},
        'ADMIN'
      )
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };
  const adminId = await insertAdmin(orgId, "main");
  const otherAdminId = await insertAdmin(otherOrgId, "other");

  const insertProject = async (label: string, wageDecision: string | null) => {
    const r = await db.execute(sql`
      INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision)
      VALUES (
        ${TEST_PREFIX + label},
        ${TEST_PREFIX + suffix + "-" + label},
        ${TEST_PREFIX + "client"},
        ${orgId},
        'ACTIVE',
        ${wageDecision}
      )
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };

  const projects = {
    A: await insertProject("pA", null),
    B: await insertProject("pB", "WD-B"),
    C: await insertProject("pC", "WD-C"),
    D: await insertProject("pD", "WD-D"),
    E: await insertProject("pE", null),
    F: await insertProject("pF", "WD-F"),
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
    // Names chosen so alphabetical ordering on `classificationName`
    // produces a deterministic, easy-to-assert sequence per project.
    carpA: await insertClass("Carpenter-A"),
    elecA: await insertClass("Electrician-A"),
    carpB: await insertClass("Carpenter-B"),
    elecB: await insertClass("Electrician-B"),
    carpC: await insertClass("Carpenter-C"),
    laborC: await insertClass("Laborer-C"),
    glazD: await insertClass("Glazier-D"),
    // Project F: cached WD names "Carpenter-F" (matches this row) plus
    // "Ironworker-F" (no matching job_classifications row → synthetic id).
    carpF: await insertClass("Carpenter-F"),
  };

  const insertUser = async (label: string) => {
    const r = await db.execute(sql`
      INSERT INTO "users" (organization_id, first_name, last_name, email, role)
      VALUES (
        ${orgId},
        'Emp',
        ${label},
        ${TEST_PREFIX + suffix + "-" + label + "@example.com"},
        'FIELD_WORKER'
      )
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };
  const users = {
    uA1: await insertUser("uA1"),
    uB1: await insertUser("uB1"),
    uB2: await insertUser("uB2"),
    uC1: await insertUser("uC1"),
    uC2: await insertUser("uC2"),
    uD1: await insertUser("uD1"),
  };

  const assignClass = async (userId: string, classificationId: string) => {
    await db.execute(sql`
      INSERT INTO "employee_classifications"
        (organization_id, user_id, classification_id, regular_rate, overtime_rate, is_primary, effective_date)
      VALUES
        (${orgId}, ${userId}, ${classificationId}, '20.00', '30.00', true, '2026-01-01')
    `);
  };
  await assignClass(users.uA1, classifications.carpA);
  await assignClass(users.uB1, classifications.carpB);
  await assignClass(users.uB2, classifications.elecB);
  await assignClass(users.uC1, classifications.carpC); // covered by override
  await assignClass(users.uC2, classifications.laborC); // sibling fallback
  await assignClass(users.uD1, classifications.glazD); // decision uncached

  // Time entries so the route's "classifications referenced by employees
  // who logged time on this project" branch is exercised. Project A uses
  // overrides only — no time entries needed because PROJECT_OVERRIDE rows
  // surface independently of time entries.
  const insertTime = async (userId: string, projectId: string) => {
    await db.execute(sql`
      INSERT INTO "time_entries" (user_id, project_id, date, hours_regular, hours_overtime)
      VALUES (${userId}, ${projectId}, '2026-04-15', '8', '0')
    `);
  };
  await insertTime(users.uB1, projects.B);
  await insertTime(users.uB2, projects.B);
  await insertTime(users.uC1, projects.C);
  await insertTime(users.uC2, projects.C);
  await insertTime(users.uD1, projects.D);

  // Project A — override-only rows for Carpenter-A and Electrician-A.
  await db.execute(sql`
    INSERT INTO "prevailing_wage_rates"
      (organization_id, project_id, classification_id, wage_rate, fringe_rate, total_rate,
       overtime_multiplier, effective_date, expiration_date, wage_decision)
    VALUES
      (${orgId}, ${projects.A}, ${classifications.carpA},
       '50.00', '10.00', '60.00', '1.50', '2026-01-01', '2026-12-31', 'WD-A-CARP'),
      (${orgId}, ${projects.A}, ${classifications.elecA},
       '70.00', '12.00', '82.00', '1.50', '2026-01-01', '2026-12-31', 'WD-A-ELEC')
  `);

  // Project C — explicit override for Carpenter-C only. Sibling
  // Laborer-C has no override and must fall through to DOL_FEED.
  await db.execute(sql`
    INSERT INTO "prevailing_wage_rates"
      (organization_id, project_id, classification_id, wage_rate, fringe_rate, total_rate,
       overtime_multiplier, effective_date)
    VALUES
      (${orgId}, ${projects.C}, ${classifications.carpC},
       '55.00', '5.00', '60.00', '1.50', '2026-01-01')
  `);

  return {
    orgId,
    otherOrgId,
    adminId,
    otherAdminId,
    projects,
    classifications,
    users,
  };
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
  listCachedDecisionClassificationsMock.mockReset();
  queueWageDecisionSyncMock.mockReset();
  getWageDecisionSyncStatusMock.mockReset();

  // Defaults — individual tests override.
  lookupCachedWageRateMock.mockResolvedValue(null);
  lookupCachedRateByLocaleMock.mockResolvedValue(null);
  isWageDeterminationCachedMock.mockResolvedValue(true);
  listCachedDecisionClassificationsMock.mockResolvedValue(null);
  queueWageDecisionSyncMock.mockResolvedValue({
    status: "completed",
    result: { success: true, created: 3, errors: [] },
  });
  getWageDecisionSyncStatusMock.mockResolvedValue(null);

  // Authenticate as the seeded org admin by default.
  testUser = { id: fx.adminId, role: "ADMIN", organizationId: fx.orgId };
});

afterAll(async () => {
  await cleanup();
});

describe("GET /api/projects/:id/prevailing-wage-summary — source labeling", () => {
  it("project with only overrides labels every classification PROJECT_OVERRIDE and never calls Davis-Bacon", async () => {
    const res = await request(app).get(
      `/api/projects/${fx.projects.A}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(fx.projects.A);
    expect(res.body.wageDecision).toBeNull();
    // No project-level decision → cache check is skipped → null.
    expect(res.body.wageDecisionCached).toBeNull();

    const classifications = res.body.classifications as Array<{
      classificationName: string;
      source: string;
      wageRate: number;
      fringeRate: number | null;
      totalRate: number | null;
      wageDecision: string | null;
      effectiveDate: string | null;
      expirationDate: string | null;
    }>;
    expect(classifications).toHaveLength(2);
    // Sorted alphabetically by classificationName.
    expect(classifications.map((c) => c.classificationName)).toEqual([
      TEST_PREFIX + "Carpenter-A",
      TEST_PREFIX + "Electrician-A",
    ]);
    for (const c of classifications) {
      expect(c.source).toBe("PROJECT_OVERRIDE");
    }
    const carp = classifications[0];
    expect(carp.wageRate).toBe(50);
    expect(carp.fringeRate).toBe(10);
    expect(carp.totalRate).toBe(60);
    expect(carp.wageDecision).toBe("WD-A-CARP");
    expect(carp.effectiveDate).toBe("2026-01-01");
    expect(carp.expirationDate).toBe("2026-12-31");

    // Cache helpers were never asked because there is no decision.
    expect(lookupCachedWageRateMock).not.toHaveBeenCalled();
    expect(isWageDeterminationCachedMock).not.toHaveBeenCalled();
  });

  it("project with only DOL feed hits labels every classification DOL_FEED and reports wageDecisionCached=true", async () => {
    lookupCachedWageRateMock.mockImplementation(
      async (_orgId: string, decision: string, classification: string) => {
        if (decision !== "WD-B") return null;
        if (classification.includes("Carpenter-B")) {
          return { classification, baseRate: 41, fringeRate: 7, totalRate: 48 };
        }
        if (classification.includes("Electrician-B")) {
          return { classification, baseRate: 65, fringeRate: 9, totalRate: 74 };
        }
        return null;
      },
    );
    isWageDeterminationCachedMock.mockResolvedValue(true);

    const res = await request(app).get(
      `/api/projects/${fx.projects.B}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBe("WD-B");
    expect(res.body.wageDecisionCached).toBe(true);

    const classifications = res.body.classifications as Array<{
      classificationName: string;
      source: string;
      wageRate: number;
      fringeRate: number | null;
      totalRate: number | null;
      wageDecision: string | null;
    }>;
    expect(classifications).toHaveLength(2);
    expect(classifications.map((c) => c.classificationName)).toEqual([
      TEST_PREFIX + "Carpenter-B",
      TEST_PREFIX + "Electrician-B",
    ]);
    for (const c of classifications) {
      expect(c.source).toBe("DOL_FEED");
      expect(c.wageDecision).toBe("WD-B");
    }
    expect(classifications[0].wageRate).toBe(41);
    expect(classifications[0].fringeRate).toBe(7);
    expect(classifications[0].totalRate).toBe(48);
    expect(classifications[1].wageRate).toBe(65);

    // Cache check fires exactly once with the project's decision.
    expect(isWageDeterminationCachedMock).toHaveBeenCalledWith(
      fx.orgId,
      "WD-B",
    );
  });

  it("project with mixed sources keeps PROJECT_OVERRIDE for matched classifications and adds DOL_FEED for siblings", async () => {
    lookupCachedWageRateMock.mockImplementation(
      async (_orgId: string, decision: string, classification: string) => {
        if (decision !== "WD-C") return null;
        if (classification.includes("Laborer-C")) {
          return { classification, baseRate: 33, fringeRate: 4, totalRate: 37 };
        }
        // Even if asked for Carpenter-C (covered by override), we should
        // never reach this branch — the override is recorded into
        // seenClassIds before the DOL pass runs.
        return null;
      },
    );
    isWageDeterminationCachedMock.mockResolvedValue(true);

    const res = await request(app).get(
      `/api/projects/${fx.projects.C}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBe("WD-C");
    expect(res.body.wageDecisionCached).toBe(true);

    const classifications = res.body.classifications as Array<{
      classificationName: string;
      source: string;
      wageRate: number;
      wageDecision: string | null;
    }>;
    // Two entries: Carpenter-C (override) and Laborer-C (DOL_FEED),
    // sorted alphabetically.
    expect(classifications.map((c) => c.classificationName)).toEqual([
      TEST_PREFIX + "Carpenter-C",
      TEST_PREFIX + "Laborer-C",
    ]);
    expect(classifications[0].source).toBe("PROJECT_OVERRIDE");
    expect(classifications[0].wageRate).toBe(55);
    expect(classifications[1].source).toBe("DOL_FEED");
    expect(classifications[1].wageRate).toBe(33);
    expect(classifications[1].wageDecision).toBe("WD-C");

    // Override classification is NOT looked up against the DOL feed.
    const lookedUpClasses = lookupCachedWageRateMock.mock.calls.map(
      (c) => c[2],
    );
    expect(lookedUpClasses).toContain(TEST_PREFIX + "Laborer-C");
    expect(lookedUpClasses).not.toContain(TEST_PREFIX + "Carpenter-C");
  });

  it("project with a wage decision that is NOT cached fires the missing-decision warning and returns no DOL_FEED rows", async () => {
    // Lookup returns null for everything (cache miss); cache check
    // returns false → wageDecisionCached=false signals the UI warning.
    lookupCachedWageRateMock.mockResolvedValue(null);
    isWageDeterminationCachedMock.mockResolvedValue(false);

    const res = await request(app).get(
      `/api/projects/${fx.projects.D}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBe("WD-D");
    expect(res.body.wageDecisionCached).toBe(false);
    expect(res.body.classifications).toEqual([]);

    // We still asked the cache about the decision exactly once.
    expect(isWageDeterminationCachedMock).toHaveBeenCalledWith(
      fx.orgId,
      "WD-D",
    );
    // And we attempted to look up the user's classification before
    // giving up — that's how the route knows there's nothing to add.
    const lookedUpClasses = lookupCachedWageRateMock.mock.calls.map(
      (c) => c[2],
    );
    expect(lookedUpClasses).toContain(TEST_PREFIX + "Glazier-D");
  });

  it("project with a cached wage decision and zero time entries surfaces every classification from the cached determination (Task #1342)", async () => {
    // Cache hit reports true so the missing-decision banner stays away.
    isWageDeterminationCachedMock.mockResolvedValue(true);
    // The per-employee path must NOT fire — there are no time entries
    // on project F, so the route should never call lookupCachedWageRate.
    lookupCachedWageRateMock.mockResolvedValue(null);
    // The cached determination carries two classifications: one whose
    // name matches a seeded job_classifications row (Carpenter-F → real
    // UUID + "Override" button works) and one without a matching row
    // (Ironworker-F → synthetic display id so the row still renders).
    listCachedDecisionClassificationsMock.mockImplementation(
      async (_orgId: string, decision: string) => {
        if (decision !== "WD-F") return null;
        return [
          {
            classification: TEST_PREFIX + "Carpenter-F",
            baseRate: 47,
            fringeRate: 8,
            totalRate: 55,
          },
          {
            classification: TEST_PREFIX + "Ironworker-F",
            baseRate: 52,
            fringeRate: 11,
            totalRate: 63,
          },
          // baseRate=0 is treated as "no usable rate" and dropped to
          // mirror the per-employee branch's `cached.baseRate > 0` guard.
          {
            classification: TEST_PREFIX + "Apprentice-F",
            baseRate: 0,
            fringeRate: 0,
            totalRate: 0,
          },
        ];
      },
    );

    const res = await request(app).get(
      `/api/projects/${fx.projects.F}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBe("WD-F");
    expect(res.body.wageDecisionCached).toBe(true);

    const classifications = res.body.classifications as Array<{
      classificationId: string;
      classificationName: string;
      source: string;
      wageRate: number;
      fringeRate: number | null;
      totalRate: number | null;
      wageDecision: string | null;
    }>;

    // Two usable rows, sorted alphabetically by classificationName.
    expect(classifications.map((c) => c.classificationName)).toEqual([
      TEST_PREFIX + "Carpenter-F",
      TEST_PREFIX + "Ironworker-F",
    ]);
    for (const c of classifications) {
      expect(c.source).toBe("DOL_FEED");
      expect(c.wageDecision).toBe("WD-F");
    }

    // Carpenter-F matched the seeded job_classifications row by name,
    // so its classificationId is the real UUID (no synthetic prefix).
    expect(classifications[0].classificationId).toBe(fx.classifications.carpF);
    expect(classifications[0].wageRate).toBe(47);
    expect(classifications[0].fringeRate).toBe(8);
    expect(classifications[0].totalRate).toBe(55);

    // Ironworker-F has no matching jobClassifications row → synthetic
    // display id so the row still renders in the panel.
    expect(classifications[1].classificationId).toMatch(/^dol-feed:/);
    expect(classifications[1].wageRate).toBe(52);

    // Cache check fires, list helper fires, but the per-employee
    // resolver never runs because there are no time entries.
    expect(isWageDeterminationCachedMock).toHaveBeenCalledWith(
      fx.orgId,
      "WD-F",
    );
    expect(listCachedDecisionClassificationsMock).toHaveBeenCalledWith(
      fx.orgId,
      "WD-F",
    );
    expect(lookupCachedWageRateMock).not.toHaveBeenCalled();
  });

  it("project with a wage decision, zero time entries, and an empty cache returns no DOL_FEED rows", async () => {
    // Decision is "cached" but the helper returns an empty classification
    // list — the route must not invent rows out of thin air.
    isWageDeterminationCachedMock.mockResolvedValue(true);
    listCachedDecisionClassificationsMock.mockResolvedValue([]);

    const res = await request(app).get(
      `/api/projects/${fx.projects.F}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBe("WD-F");
    expect(res.body.wageDecisionCached).toBe(true);
    expect(res.body.classifications).toEqual([]);
    expect(lookupCachedWageRateMock).not.toHaveBeenCalled();
  });

  it("project with no wage decision at all returns wageDecisionCached=null and an empty classifications list", async () => {
    const res = await request(app).get(
      `/api/projects/${fx.projects.E}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBeNull();
    expect(res.body.wageDecisionCached).toBeNull();
    expect(res.body.classifications).toEqual([]);

    // No decision → no Davis-Bacon traffic at all.
    expect(lookupCachedWageRateMock).not.toHaveBeenCalled();
    expect(isWageDeterminationCachedMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/projects/:id/prevailing-wage-summary — acknowledged rate-change audit (Task #1451)", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM "wage_decision_rate_changes" WHERE organization_id = ${fx.orgId}`);
    // Project B is wired with WD-B + Carpenter-B/Electrician-B time
    // entries, so its summary will resolve both classifications via DOL_FEED.
    lookupCachedWageRateMock.mockImplementation(
      async (_orgId: string, decision: string, classification: string) => {
        if (decision !== "WD-B") return null;
        if (classification.includes("Carpenter-B")) {
          return { classification, baseRate: 41, fringeRate: 7, totalRate: 48 };
        }
        if (classification.includes("Electrician-B")) {
          return { classification, baseRate: 65, fringeRate: 9, totalRate: 74 };
        }
        return null;
      },
    );
    isWageDeterminationCachedMock.mockResolvedValue(true);
  });

  it("returns lastAcknowledgedRateChange with acknowledger name only for rows the PM acknowledged", async () => {
    const { persistRateChangeRecords, acknowledgeRateChanges } = await import(
      "../integrations/providers/dol_davis_bacon/rateChangeFlags"
    );
    // Seed two rate-change flags for WD-B (Carpenter-B + Electrician-B),
    // then PM-acknowledge only Carpenter-B. The endpoint should return
    // lastAcknowledgedRateChange populated for Carpenter-B and null for
    // Electrician-B (still flagged, never acknowledged).
    await persistRateChangeRecords(fx.orgId, "WD-B", [
      {
        kind: "changed",
        classification: TEST_PREFIX + "Carpenter-B",
        oldBaseRate: 40,
        newBaseRate: 41,
        oldFringeRate: 7,
        newFringeRate: 7,
        oldTotalRate: 47,
        newTotalRate: 48,
      } as any,
      {
        kind: "changed",
        classification: TEST_PREFIX + "Electrician-B",
        oldBaseRate: 64,
        newBaseRate: 65,
        oldFringeRate: 9,
        newFringeRate: 9,
        oldTotalRate: 73,
        newTotalRate: 74,
      } as any,
    ]);
    await acknowledgeRateChanges({
      organizationId: fx.orgId,
      decisionNumber: "WD-B",
      userId: fx.adminId,
      classifications: [TEST_PREFIX + "Carpenter-B"],
    });

    const res = await request(app).get(
      `/api/projects/${fx.projects.B}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    const classifications = res.body.classifications as Array<{
      classificationName: string;
      recentRateChange: unknown;
      lastAcknowledgedRateChange: {
        acknowledgedAt: string | null;
        acknowledgedByUserId: string | null;
        acknowledgedByName: string | null;
      } | null;
    }>;
    const carp = classifications.find((c) => c.classificationName === TEST_PREFIX + "Carpenter-B");
    const elec = classifications.find((c) => c.classificationName === TEST_PREFIX + "Electrician-B");

    expect(carp?.lastAcknowledgedRateChange).toBeTruthy();
    expect(carp?.lastAcknowledgedRateChange?.acknowledgedByUserId).toBe(fx.adminId);
    // Seeded admin is firstName='Admin', lastName='main'.
    expect(carp?.lastAcknowledgedRateChange?.acknowledgedByName).toBe("Admin main");
    expect(carp?.lastAcknowledgedRateChange?.acknowledgedAt).toBeTruthy();
    // Acknowledged rows clear the per-row badge (loadUnacknowledged...
    // skips acknowledged rows), so the recentRateChange field is null.
    expect(carp?.recentRateChange).toBeNull();

    // Electrician-B was never acknowledged, so no audit metadata.
    expect(elec?.lastAcknowledgedRateChange).toBeNull();
    expect(elec?.recentRateChange).toBeTruthy();
  });

  it("does not surface a stale acknowledger after a no-diff auto-clear refresh", async () => {
    const { persistRateChangeRecords, acknowledgeRateChanges } = await import(
      "../integrations/providers/dol_davis_bacon/rateChangeFlags"
    );
    await persistRateChangeRecords(fx.orgId, "WD-B", [
      {
        kind: "changed",
        classification: TEST_PREFIX + "Carpenter-B",
        oldBaseRate: 40,
        newBaseRate: 41,
        oldFringeRate: 7,
        newFringeRate: 7,
        oldTotalRate: 47,
        newTotalRate: 48,
      } as any,
    ]);
    await acknowledgeRateChanges({
      organizationId: fx.orgId,
      decisionNumber: "WD-B",
      userId: fx.adminId,
    });
    // Subsequent no-diff refresh deletes every flag for the (org,
    // decision) pair — auto-cleared, never PM-acknowledged this time.
    await persistRateChangeRecords(fx.orgId, "WD-B", []);

    const res = await request(app).get(
      `/api/projects/${fx.projects.B}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    const classifications = res.body.classifications as Array<{
      classificationName: string;
      recentRateChange: unknown;
      lastAcknowledgedRateChange: unknown;
    }>;
    for (const c of classifications) {
      expect(c.recentRateChange).toBeNull();
      // No acknowledgement record exists, so the audit line must be hidden.
      expect(c.lastAcknowledgedRateChange).toBeNull();
    }
  });
});

describe("GET /api/projects/:id/prevailing-wage-summary — access control", () => {
  it("rejects requests for a project that belongs to a different organization with 404", async () => {
    testUser = {
      id: fx.otherAdminId,
      role: "ADMIN",
      organizationId: fx.otherOrgId,
    };
    const res = await request(app).get(
      `/api/projects/${fx.projects.A}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Project not found/);
    expect(lookupCachedWageRateMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests with 401", async () => {
    testUser = null;
    const res = await request(app).get(
      `/api/projects/${fx.projects.A}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(401);
  });
});

// Task #1388 regression — the project lookup in the sync handler used to
// filter on `projects.organizationId` (a column that does not exist),
// which silently 404'd every request. Pin the canonical
// `gcOrganizationId` scoping with both a positive and a negative test.
describe("POST /api/projects/:id/prevailing-wage-summary/sync — org scoping", () => {
  it("rejects sync for a project that belongs to a different organization with 404 and never queues a sync", async () => {
    testUser = {
      id: fx.otherAdminId,
      role: "ADMIN",
      organizationId: fx.otherOrgId,
    };
    const res = await request(app).post(
      `/api/projects/${fx.projects.B}/prevailing-wage-summary/sync`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Project not found/);
    expect(queueWageDecisionSyncMock).not.toHaveBeenCalled();
  });

  it("queues a wage decision sync for a project owned by the caller's org via gcOrganizationId", async () => {
    const res = await request(app).post(
      `/api/projects/${fx.projects.B}/prevailing-wage-summary/sync`,
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.decisionNumber).toBe("WD-B");
    expect(queueWageDecisionSyncMock).toHaveBeenCalledTimes(1);
    expect(queueWageDecisionSyncMock).toHaveBeenCalledWith(
      fx.orgId,
      "WD-B",
      expect.objectContaining({ awaitResult: true, manualRetry: true }),
    );
  });

  it("returns 400 when the resolved project has no wage decision set", async () => {
    const res = await request(app).post(
      `/api/projects/${fx.projects.E}/prevailing-wage-summary/sync`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no wage decision/i);
    expect(queueWageDecisionSyncMock).not.toHaveBeenCalled();
  });
});

// Task #1388 regression — pin the org-scoping behavior of the
// payroll-page status endpoint that powers the proactive
// "missing wage decisions" banner. The endpoint must filter projects
// via `gcOrganizationId` (the canonical project↔org link) and never
// leak a project from a sibling org into another org admin's badge
// list. A prior typo on a sibling endpoint (this file's commit) showed
// how easy it is to silently break this scoping when there's no
// regression test.
describe("GET /api/payroll/missing-wage-decisions — org scoping", () => {
  let foreignProjectId: string;
  const FOREIGN_DECISION = "WD-FOREIGN-1388";

  beforeAll(async () => {
    // Seed a project owned by the *other* org with a wage decision so
    // we can assert that calling the endpoint as the main org admin
    // never returns the foreign project.
    const r = await db.execute(sql`
      INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision)
      VALUES (
        ${TEST_PREFIX + "pForeign"},
        ${TEST_PREFIX + "foreign-1388"},
        ${TEST_PREFIX + "client"},
        ${fx.otherOrgId},
        'ACTIVE',
        ${FOREIGN_DECISION}
      )
      RETURNING id
    `);
    foreignProjectId = (r.rows[0] as { id: string }).id;
  });

  it("returns only projects scoped to the caller's org via gcOrganizationId", async () => {
    // Mark project D's decision (uncached) and the foreign project's
    // decision (uncached) — both should be candidates, but only D
    // belongs to the caller's org.
    isWageDeterminationCachedMock.mockImplementation(
      async (_orgId: string, decision: string) => {
        if (decision === "WD-D") return false;
        if (decision === FOREIGN_DECISION) return false;
        return true;
      },
    );

    const res = await request(app).get("/api/payroll/missing-wage-decisions");
    expect(res.status).toBe(200);

    const items = res.body.items as Array<{
      projectId: string;
      projectName: string;
      wageDecision: string;
    }>;
    const decisions = items.map((i) => i.wageDecision);
    expect(decisions).toContain("WD-D");
    // Foreign-org project must never leak into this org admin's list,
    // regardless of whether its wage decision is cached.
    expect(decisions).not.toContain(FOREIGN_DECISION);
    for (const item of items) {
      expect(item.projectId).not.toBe(foreignProjectId);
    }

    // Cache helper must only be asked about decisions that belong to
    // the caller's org. Foreign decision must never be probed.
    const probedDecisions = isWageDeterminationCachedMock.mock.calls.map(
      (c) => c[1],
    );
    expect(probedDecisions).not.toContain(FOREIGN_DECISION);
    for (const call of isWageDeterminationCachedMock.mock.calls) {
      expect(call[0]).toBe(fx.orgId);
    }
  });

  it("returns the sibling org's project (and nothing else) when called as the other-org admin", async () => {
    testUser = {
      id: fx.otherAdminId,
      role: "ADMIN",
      organizationId: fx.otherOrgId,
    };
    isWageDeterminationCachedMock.mockResolvedValue(false);

    const res = await request(app).get("/api/payroll/missing-wage-decisions");
    expect(res.status).toBe(200);

    const items = res.body.items as Array<{
      projectId: string;
      projectName: string;
      wageDecision: string;
    }>;
    expect(items).toEqual([
      {
        projectId: foreignProjectId,
        projectName: TEST_PREFIX + "pForeign",
        wageDecision: FOREIGN_DECISION,
      },
    ]);
  });

  it("rejects unauthenticated callers with 401", async () => {
    testUser = null;
    const res = await request(app).get("/api/payroll/missing-wage-decisions");
    expect(res.status).toBe(401);
  });
});
