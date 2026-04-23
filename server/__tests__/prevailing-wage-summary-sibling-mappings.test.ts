/**
 * Task #1467 — server-side coverage for the cross-project DOL mapping
 * lookup that powers `rememberedClassificationId` on the prevailing
 * wage summary endpoint.
 *
 *   GET /api/projects/:id/prevailing-wage-summary
 *
 * Task #1437 added a sibling-project lookup so that a "Carpenter
 * (Group 1) -> Carpenter" mapping made on one project pre-selects the
 * remembered classification on every other project in the same org
 * that pulls the same wage decision. The route only surfaces this hint
 * for synthetic `dol-feed:<name>` rows on a brand-new project (no time
 * entries, no project-local mapping, no name-based match). This file
 * pins the four behaviours called out in the task brief:
 *
 *   1. set when a sibling mapping exists for the same wage decision
 *   2. null when the sibling mapping points at a different wage decision
 *   3. null when the row already resolved (project-local mapping or
 *      name-based match) — the dialog already targets the right id
 *   4. most-recently-updated sibling mapping wins on conflict
 *
 * Plus a defensive case: orphaned mapping classification ids (pointing
 * at a classification that does not belong to the requesting org) are
 * filtered out so the hint is never a cross-org pointer.
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
import supertest from "supertest";
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

const lookupCachedWageRateMock = vi.fn();
const lookupCachedRateByLocaleMock = vi.fn();
const isWageDeterminationCachedMock = vi.fn();
const listCachedDecisionClassificationsMock = vi.fn();
const queueWageDecisionSyncMock = vi.fn();
const getWageDecisionSyncStatusMock = vi.fn();
vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  lookupCachedWageRate: (...args: unknown[]) => lookupCachedWageRateMock(...args),
  lookupCachedRateByLocale: (...args: unknown[]) => lookupCachedRateByLocaleMock(...args),
  isWageDeterminationCached: (...args: unknown[]) => isWageDeterminationCachedMock(...args),
  listCachedDecisionClassifications: (...args: unknown[]) =>
    listCachedDecisionClassificationsMock(...args),
  queueWageDecisionSync: (...args: unknown[]) => queueWageDecisionSyncMock(...args),
  getWageDecisionSyncStatus: (...args: unknown[]) => getWageDecisionSyncStatusMock(...args),
  fetchWageDetermination: vi.fn(),
  importWageDetermination: vi.fn(),
}));

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

const TEST_PREFIX = "__pwsib__";
const WD_SUBJECT = "WD-SIB-1467";
const WD_OTHER = "WD-OTH-1467";

let app: Express;
let db: typeof import("../db").db;

interface Fixtures {
  orgId: string;
  otherOrgId: string;
  adminId: string;
  // Subject project (no time entries, wage decision = WD_SUBJECT). This
  // is the project we GET the summary for in every test.
  subjectProjectId: string;
  // Sibling in the same org with the same wage decision — sibling
  // mappings on this project should pre-select on the subject.
  siblingSameDecisionId: string;
  // A second sibling in the same org with the same wage decision — used
  // to verify "most-recent wins" when two siblings map the same feed
  // name to different classifications.
  siblingSameDecisionTwoId: string;
  // Sibling in the same org with a DIFFERENT wage decision — its
  // mappings must never leak into the subject's remembered hints.
  siblingOtherDecisionId: string;
  // Classifications in the subject org.
  carpenterClsId: string; // also matches a cached feed name by name
  electricianClsId: string;
  // A classification owned by a foreign org — used to seed an
  // "orphaned" mapping (the FK only checks classifications.id, not org)
  // so we can confirm the route filters it out.
  foreignClsId: string;
}

let fx: Fixtures;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "dol_classification_mappings" WHERE project_id IN (
      SELECT id FROM "projects" WHERE code LIKE ${TEST_PREFIX + "%"}
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

  const adminRow = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (
      ${orgId},
      'Admin',
      'PWSibling',
      ${TEST_PREFIX + suffix + "-admin@example.com"},
      'ADMIN'
    )
    RETURNING id
  `);
  const adminId = (adminRow.rows[0] as { id: string }).id;

  const insertProject = async (label: string, wageDecision: string) => {
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
  const subjectProjectId = await insertProject("subject", WD_SUBJECT);
  const siblingSameDecisionId = await insertProject("sibSameA", WD_SUBJECT);
  const siblingSameDecisionTwoId = await insertProject("sibSameB", WD_SUBJECT);
  const siblingOtherDecisionId = await insertProject("sibOther", WD_OTHER);

  const insertClass = async (organizationId: string, name: string) => {
    const r = await db.execute(sql`
      INSERT INTO "job_classifications" (organization_id, name)
      VALUES (${organizationId}, ${TEST_PREFIX + name})
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };
  // Note: "Carpenter" intentionally matches one of the cached feed
  // names below (case-insensitively) so the resolved-by-name branch
  // can be exercised.
  const carpenterClsId = await insertClass(orgId, "Carpenter");
  const electricianClsId = await insertClass(orgId, "Electrician");
  const foreignClsId = await insertClass(otherOrgId, "ForeignCarpenter");

  return {
    orgId,
    otherOrgId,
    adminId,
    subjectProjectId,
    siblingSameDecisionId,
    siblingSameDecisionTwoId,
    siblingOtherDecisionId,
    carpenterClsId,
    electricianClsId,
    foreignClsId,
  };
}

async function clearMappings(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "dol_classification_mappings" WHERE organization_id = ${fx.orgId}
  `);
}

async function insertMapping(args: {
  projectId: string;
  dolFeedName: string; // already lowercased — matches what the route stores
  classificationId: string;
  updatedAt?: Date;
}): Promise<void> {
  const updatedAt = args.updatedAt ?? new Date();
  await db.execute(sql`
    INSERT INTO "dol_classification_mappings"
      (organization_id, project_id, dol_feed_name, classification_id, created_at, updated_at)
    VALUES (
      ${fx.orgId},
      ${args.projectId},
      ${args.dolFeedName},
      ${args.classificationId},
      ${updatedAt.toISOString()},
      ${updatedAt.toISOString()}
    )
  `);
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

beforeEach(async () => {
  testUser = null;
  lookupCachedWageRateMock.mockReset();
  lookupCachedRateByLocaleMock.mockReset();
  isWageDeterminationCachedMock.mockReset();
  listCachedDecisionClassificationsMock.mockReset();
  queueWageDecisionSyncMock.mockReset();
  getWageDecisionSyncStatusMock.mockReset();

  lookupCachedWageRateMock.mockResolvedValue(null);
  lookupCachedRateByLocaleMock.mockResolvedValue(null);
  isWageDeterminationCachedMock.mockResolvedValue(true);
  listCachedDecisionClassificationsMock.mockResolvedValue(null);
  queueWageDecisionSyncMock.mockResolvedValue({ status: "completed" });
  getWageDecisionSyncStatusMock.mockResolvedValue(null);

  await clearMappings();

  testUser = { id: fx.adminId, role: "ADMIN", organizationId: fx.orgId };
});

afterAll(async () => {
  await cleanup();
});

describe("GET /api/projects/:id/prevailing-wage-summary — sibling DOL mapping hints (Task #1437/#1467)", () => {
  // The cached determination always carries the same feed names so each
  // test only needs to seed mappings; the route's response gives us one
  // row per feed name to assert on.
  const CACHED = [
    // Synthetic on subject (no jobClassifications match by name).
    { classification: TEST_PREFIX + "Carpenter (Group 1)", baseRate: 45, fringeRate: 8, totalRate: 53 },
    // Same prefix as a real classification — resolves by name to
    // carpenterClsId, so rememberedClassificationId must stay null
    // even if a sibling mapping exists for "carpenter".
    { classification: TEST_PREFIX + "Carpenter", baseRate: 50, fringeRate: 9, totalRate: 59 },
    // Synthetic on subject — used to test "different wage decision".
    { classification: TEST_PREFIX + "Drywaller", baseRate: 38, fringeRate: 6, totalRate: 44 },
    // Synthetic on subject — used to test "most recent wins".
    { classification: TEST_PREFIX + "Pipefitter", baseRate: 60, fringeRate: 11, totalRate: 71 },
    // Synthetic on subject — used to test orphaned (cross-org) ids.
    { classification: TEST_PREFIX + "Plumber", baseRate: 55, fringeRate: 10, totalRate: 65 },
  ];

  function pinCache(): void {
    listCachedDecisionClassificationsMock.mockImplementation(
      async (_orgId: string, decision: string) => (decision === WD_SUBJECT ? CACHED : null),
    );
  }

  function findRow(body: { classifications: Array<{ classificationName: string }> }, name: string) {
    return body.classifications.find(
      (c) => c.classificationName === name,
    ) as
      | undefined
      | {
          classificationId: string;
          classificationName: string;
          source: string;
          dolFeedName: string | null;
          rememberedClassificationId?: string | null;
        };
  }

  it("populates rememberedClassificationId from a sibling mapping in the same wage decision and leaves resolved rows alone", async () => {
    pinCache();

    // Sibling project (same WD) maps the synthetic feed name onto the
    // subject org's Carpenter classification — this is the hint we
    // want the dialog to pre-select on the subject.
    await insertMapping({
      projectId: fx.siblingSameDecisionId,
      dolFeedName: (TEST_PREFIX + "Carpenter (Group 1)").toLowerCase(),
      classificationId: fx.carpenterClsId,
    });
    // Even though a sibling mapping exists for the bare "carpenter"
    // feed name, the subject's row resolves by name to carpenterClsId
    // already, so rememberedClassificationId must stay null — the
    // dialog already targets the right row by id.
    await insertMapping({
      projectId: fx.siblingSameDecisionId,
      dolFeedName: (TEST_PREFIX + "Carpenter").toLowerCase(),
      classificationId: fx.electricianClsId,
    });

    const res = await supertest(app).get(
      `/api/projects/${fx.subjectProjectId}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);
    expect(res.body.wageDecision).toBe(WD_SUBJECT);

    const groupOne = findRow(res.body, TEST_PREFIX + "Carpenter (Group 1)");
    expect(groupOne).toBeTruthy();
    // Synthetic id stays synthetic for the unresolved row.
    expect(groupOne!.classificationId).toMatch(/^dol-feed:/);
    expect(groupOne!.rememberedClassificationId).toBe(fx.carpenterClsId);

    const carpenter = findRow(res.body, TEST_PREFIX + "Carpenter");
    expect(carpenter).toBeTruthy();
    // Resolved by name → real classification id, no remembered hint.
    expect(carpenter!.classificationId).toBe(fx.carpenterClsId);
    expect(carpenter!.rememberedClassificationId ?? null).toBeNull();
  });

  it("does not surface a sibling mapping that belongs to a different wage decision", async () => {
    pinCache();

    // Sibling with a *different* wage decision maps Drywaller — must
    // not bleed into the subject's hints.
    await insertMapping({
      projectId: fx.siblingOtherDecisionId,
      dolFeedName: (TEST_PREFIX + "Drywaller").toLowerCase(),
      classificationId: fx.electricianClsId,
    });

    const res = await supertest(app).get(
      `/api/projects/${fx.subjectProjectId}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);

    const drywaller = findRow(res.body, TEST_PREFIX + "Drywaller");
    expect(drywaller).toBeTruthy();
    expect(drywaller!.classificationId).toMatch(/^dol-feed:/);
    expect(drywaller!.rememberedClassificationId ?? null).toBeNull();
  });

  it("uses the most-recently-updated sibling mapping when two siblings disagree on the same feed name", async () => {
    pinCache();

    // Older mapping → ElectricianCls.
    await insertMapping({
      projectId: fx.siblingSameDecisionId,
      dolFeedName: (TEST_PREFIX + "Pipefitter").toLowerCase(),
      classificationId: fx.electricianClsId,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    // Newer mapping → CarpenterCls (this one must win).
    await insertMapping({
      projectId: fx.siblingSameDecisionTwoId,
      dolFeedName: (TEST_PREFIX + "Pipefitter").toLowerCase(),
      classificationId: fx.carpenterClsId,
      updatedAt: new Date("2026-04-01T00:00:00Z"),
    });

    const res = await supertest(app).get(
      `/api/projects/${fx.subjectProjectId}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);

    const pipefitter = findRow(res.body, TEST_PREFIX + "Pipefitter");
    expect(pipefitter).toBeTruthy();
    expect(pipefitter!.classificationId).toMatch(/^dol-feed:/);
    expect(pipefitter!.rememberedClassificationId).toBe(fx.carpenterClsId);
  });

  it("ignores sibling mappings whose classification id does not belong to the requesting org", async () => {
    pinCache();

    // Sibling on the subject's org maps Plumber onto a classification
    // that belongs to a *different* org — the orgClassById guard in
    // the route must drop it instead of leaking a cross-org id.
    await insertMapping({
      projectId: fx.siblingSameDecisionId,
      dolFeedName: (TEST_PREFIX + "Plumber").toLowerCase(),
      classificationId: fx.foreignClsId,
    });

    const res = await supertest(app).get(
      `/api/projects/${fx.subjectProjectId}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);

    const plumber = findRow(res.body, TEST_PREFIX + "Plumber");
    expect(plumber).toBeTruthy();
    expect(plumber!.classificationId).toMatch(/^dol-feed:/);
    expect(plumber!.rememberedClassificationId ?? null).toBeNull();
  });

  it("leaves rememberedClassificationId null when a project-local mapping resolves the synthetic id directly", async () => {
    pinCache();

    // Project-local mapping on the subject project resolves the
    // synthetic feed name onto Electrician → the row's id is now real,
    // so the route must not also dangle a sibling hint on it.
    await insertMapping({
      projectId: fx.subjectProjectId,
      dolFeedName: (TEST_PREFIX + "Carpenter (Group 1)").toLowerCase(),
      classificationId: fx.electricianClsId,
    });
    // Sibling mapping for the same feed name → would otherwise win.
    await insertMapping({
      projectId: fx.siblingSameDecisionId,
      dolFeedName: (TEST_PREFIX + "Carpenter (Group 1)").toLowerCase(),
      classificationId: fx.carpenterClsId,
    });

    const res = await supertest(app).get(
      `/api/projects/${fx.subjectProjectId}/prevailing-wage-summary`,
    );
    expect(res.status).toBe(200);

    // The route surfaces the *resolved* classification name, not the
    // raw feed name, so look up the row by its dol feed identity.
    const groupOne = (res.body.classifications as Array<{
      classificationId: string;
      dolFeedName: string | null;
      rememberedClassificationId?: string | null;
    }>).find(
      (c) => c.dolFeedName === TEST_PREFIX + "Carpenter (Group 1)",
    );
    expect(groupOne).toBeTruthy();
    expect(groupOne!.classificationId).toBe(fx.electricianClsId);
    expect(groupOne!.rememberedClassificationId ?? null).toBeNull();
  });
});
