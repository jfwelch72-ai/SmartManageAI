/**
 * Task #1516 — automated tests for the Task #1481 wage acknowledgement
 * export endpoints:
 *
 *   GET /api/payroll/wage-decisions/:decisionNumber/acknowledgement-export
 *   GET /api/payroll/acknowledgement-export
 *
 * The handlers gate on `canManagePayroll` and on a resolved org id (cross
 * tenancy is enforced via `getOrgIdForFilter` returning mustDenyAccess for
 * a non-SUPER_ADMIN user without an organization). The per-decision route
 * supports CSV / JSON / PDF; the org-wide route supports CSV / JSON. Both
 * stamp affected projects on the rows so the auditor can see the blast
 * radius without a second lookup, and both *must* only consider data in
 * the caller's org.
 *
 * The DOL Davis-Bacon cache is mocked so the canonical classification
 * list for a decision is deterministic without seeding
 * `integration_sync_state`.
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
  permissions?: Record<string, boolean>;
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
  // Real `requireFeaturePermission` looks up effective permissions from
  // role defaults + per-user overrides; the mock collapses that to an
  // explicit `permissions` map on the test user so each scenario can
  // grant or deny `canManagePayroll` deterministically.
  requireFeaturePermission: (permKey: string) =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (req.user.role === "SUPER_ADMIN") {
        next();
        return;
      }
      if (req.user.permissions?.[permKey]) {
        next();
        return;
      }
      res.status(403).json({ error: "Feature permission required: " + permKey });
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

// DOL Davis-Bacon cache helpers — pin the canonical classification list
// per decision so we don't have to seed integration_sync_state.
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

const TEST_PREFIX = "__ackexp__";
const WD1 = "WD-ACK-1";
const WD2 = "WD-ACK-2";

let app: Express;
let db: typeof import("../db").db;

interface Fixtures {
  orgAId: string;
  orgBId: string;
  payrollAdminId: string; // orgA, canManagePayroll=true
  fieldUserId: string; // orgA, canManagePayroll=false
  orphanUserId: string; // no org
  orgBAdminId: string; // orgB, canManagePayroll=true
  projectA1Id: string; // orgA, WD1
  projectA2Id: string; // orgA, WD2
  projectBId: string; // orgB, WD1 — must NOT bleed into orgA exports
}

let fx: Fixtures;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "wage_decision_rate_changes" WHERE organization_id IN (
      SELECT id FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`
    DELETE FROM "audit_log" WHERE user_id IN (
      SELECT id FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`DELETE FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM "projects" WHERE code LIKE ${TEST_PREFIX + "%"}`);
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
  const orgAId = await insertOrg("orgA");
  const orgBId = await insertOrg("orgB");

  const insertUser = async (organizationId: string | null, label: string, role = "ADMIN") => {
    const r = await db.execute(sql`
      INSERT INTO "users" (organization_id, first_name, last_name, email, role)
      VALUES (
        ${organizationId},
        ${"First-" + label},
        ${"Last-" + label},
        ${TEST_PREFIX + suffix + "-" + label + "@example.com"},
        ${role}
      )
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };
  const payrollAdminId = await insertUser(orgAId, "padmin");
  const fieldUserId = await insertUser(orgAId, "field", "FIELD_WORKER");
  const orphanUserId = await insertUser(null, "orphan");
  const orgBAdminId = await insertUser(orgBId, "bpadmin");

  const insertProject = async (
    organizationId: string,
    label: string,
    wageDecision: string,
  ) => {
    const r = await db.execute(sql`
      INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision)
      VALUES (
        ${"Project " + label},
        ${TEST_PREFIX + suffix + "-" + label},
        ${TEST_PREFIX + "client"},
        ${organizationId},
        'ACTIVE',
        ${wageDecision}
      )
      RETURNING id
    `);
    return (r.rows[0] as { id: string }).id;
  };
  const projectA1Id = await insertProject(orgAId, "A1", WD1);
  const projectA2Id = await insertProject(orgAId, "A2", WD2);
  const projectBId = await insertProject(orgBId, "B1", WD1);

  // Seed rate-change records on orgA for both decisions:
  //   WD1 / Carpenter — acknowledged by payrollAdminId
  //   WD1 / Electrician — never acknowledged
  //   WD2 / Plumber — acknowledged by payrollAdminId
  // And one row on orgB / WD1 to prove tenancy scoping cuts it from
  // orgA's export.
  await db.execute(sql`
    INSERT INTO "wage_decision_rate_changes"
      (organization_id, decision_number, classification, change_kind,
       old_base_rate, new_base_rate, old_fringe_rate, new_fringe_rate,
       old_total_rate, new_total_rate, detected_at, acknowledged_at, acknowledged_by_user_id)
    VALUES
      (${orgAId}, ${WD1}, ${TEST_PREFIX + "Carpenter"}, 'changed',
       '40.00', '41.50', '7.00', '7.25', '47.00', '48.75',
       '2026-04-01T00:00:00Z', '2026-04-02T12:00:00Z', ${payrollAdminId}),
      (${orgAId}, ${WD1}, ${TEST_PREFIX + "Electrician"}, 'changed',
       '64.00', '65.10', '9.00', '9.10', '73.00', '74.20',
       '2026-04-01T00:00:00Z', NULL, NULL),
      (${orgAId}, ${WD2}, ${TEST_PREFIX + "Plumber"}, 'changed',
       '50.00', '52.00', '8.00', '8.50', '58.00', '60.50',
       '2026-04-05T00:00:00Z', '2026-04-06T09:00:00Z', ${payrollAdminId}),
      (${orgBId}, ${WD1}, ${TEST_PREFIX + "Carpenter"}, 'changed',
       '40.00', '42.00', '7.00', '7.50', '47.00', '49.50',
       '2026-04-01T00:00:00Z', NULL, NULL)
  `);

  return {
    orgAId,
    orgBId,
    payrollAdminId,
    fieldUserId,
    orphanUserId,
    orgBAdminId,
    projectA1Id,
    projectA2Id,
    projectBId,
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

  lookupCachedWageRateMock.mockResolvedValue(null);
  lookupCachedRateByLocaleMock.mockResolvedValue(null);
  isWageDeterminationCachedMock.mockResolvedValue(true);
  // Canonical classification list per decision. The export route uses
  // this to enumerate every classification on the wage decision (even
  // ones with no recorded change), so it must be deterministic.
  listCachedDecisionClassificationsMock.mockImplementation(
    async (_orgId: string, decision: string) => {
      if (decision === WD1) {
        return [
          { classification: TEST_PREFIX + "Carpenter", baseRate: 41.5, fringeRate: 7.25, totalRate: 48.75 },
          { classification: TEST_PREFIX + "Electrician", baseRate: 65.1, fringeRate: 9.1, totalRate: 74.2 },
        ];
      }
      if (decision === WD2) {
        return [
          { classification: TEST_PREFIX + "Plumber", baseRate: 52, fringeRate: 8.5, totalRate: 60.5 },
        ];
      }
      return [];
    },
  );
  queueWageDecisionSyncMock.mockResolvedValue({
    status: "completed",
    result: { success: true, created: 0, errors: [] },
  });
  getWageDecisionSyncStatusMock.mockResolvedValue(null);
});

afterAll(async () => {
  await cleanup();
});

function asPayrollAdmin(): TestUser {
  return {
    id: fx.payrollAdminId,
    role: "ADMIN",
    organizationId: fx.orgAId,
    permissions: { canManagePayroll: true },
  };
}

describe("GET /api/payroll/wage-decisions/:decisionNumber/acknowledgement-export", () => {
  it("returns 403 when the caller lacks canManagePayroll", async () => {
    testUser = {
      id: fx.fieldUserId,
      role: "FIELD_WORKER",
      organizationId: fx.orgAId,
      permissions: { canManagePayroll: false },
    };
    const res = await request(app).get(
      `/api/payroll/wage-decisions/${WD1}/acknowledgement-export`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/canManagePayroll/);
  });

  it("returns 403 when the caller has no resolved org (cross-tenant safety)", async () => {
    testUser = {
      id: fx.orphanUserId,
      role: "ADMIN",
      organizationId: null,
      // Permission gate is satisfied so we exercise the org-resolution
      // gate specifically — without this the test would 403 at the
      // permission check and never prove the orgId guard.
      permissions: { canManagePayroll: true },
    };
    const res = await request(app).get(
      `/api/payroll/wage-decisions/${WD1}/acknowledgement-export`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Access denied");
  });

  it("CSV output carries the documented header row plus an acknowledged + unacknowledged row", async () => {
    testUser = asPayrollAdmin();
    const res = await request(app).get(
      `/api/payroll/wage-decisions/${WD1}/acknowledgement-export?format=csv`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/wage-decision-acknowledgements-/);

    const lines = res.text.split("\n");
    expect(lines[0]).toBe(
      [
        "Wage Decision",
        "Classification",
        "Source",
        "Change Kind",
        "Old Base Rate",
        "New Base Rate",
        "Old Fringe Rate",
        "New Fringe Rate",
        "Old Total Rate",
        "New Total Rate",
        "Detected At",
        "Acknowledged At",
        "Acknowledged By",
        "Acknowledgement Status",
        "Affected Projects",
      ].join(","),
    );

    // Locate Carpenter (acked) and Electrician (unacked) rows in the body.
    const carpLine = lines.find((l) => l.includes(TEST_PREFIX + "Carpenter"));
    const elecLine = lines.find((l) => l.includes(TEST_PREFIX + "Electrician"));
    expect(carpLine).toBeTruthy();
    expect(elecLine).toBeTruthy();

    // Acked row carries acknowledger name + "Acknowledged" status + the
    // detected/acknowledged timestamps + filled rate columns.
    expect(carpLine).toMatch(/changed/);
    expect(carpLine).toMatch(/40\.00,41\.50,7\.00,7\.25,47\.00,48\.75/);
    expect(carpLine).toMatch(/2026-04-01T00:00:00.000Z/);
    expect(carpLine).toMatch(/2026-04-02T12:00:00.000Z/);
    expect(carpLine).toMatch(/First-padmin Last-padmin/);
    expect(carpLine).toMatch(/Acknowledged(?!\sby)/);

    // Unacked row has empty acknowledged_at + ack name and an
    // explicit "Unacknowledged" status.
    expect(elecLine).toMatch(/64\.00,65\.10,9\.00,9\.10,73\.00,74\.20/);
    // Pattern: detectedAt, then empty ackAt, empty ackName, then status.
    expect(elecLine).toMatch(/2026-04-01T00:00:00\.000Z,,,Unacknowledged/);
  });

  it("Affected Projects column lists only projects in the caller's org (cross-tenant scoping)", async () => {
    testUser = asPayrollAdmin();
    const res = await request(app).get(
      `/api/payroll/wage-decisions/${WD1}/acknowledgement-export?format=json`,
    );
    expect(res.status).toBe(200);
    const projectIds = (res.body.projects as Array<{ id: string }>).map((p) => p.id);
    expect(projectIds).toContain(fx.projectA1Id);
    // Project in orgB references the same wage decision but must NOT
    // appear in orgA's export.
    expect(projectIds).not.toContain(fx.projectBId);
    expect(projectIds).not.toContain(fx.projectA2Id);
  });

  it("format=pdf returns application/pdf with a non-empty PDF body", async () => {
    testUser = asPayrollAdmin();
    const res = await request(app)
      .get(`/api/payroll/wage-decisions/${WD1}/acknowledgement-export?format=pdf`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/\.pdf"$/);
    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(200);
    // PDF magic header.
    expect(body.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});

describe("GET /api/payroll/acknowledgement-export (org-wide)", () => {
  it("returns 403 when the caller lacks canManagePayroll", async () => {
    testUser = {
      id: fx.fieldUserId,
      role: "FIELD_WORKER",
      organizationId: fx.orgAId,
      permissions: { canManagePayroll: false },
    };
    const res = await request(app).get("/api/payroll/acknowledgement-export");
    expect(res.status).toBe(403);
  });

  it("returns 403 when the caller has no resolved org", async () => {
    testUser = {
      id: fx.orphanUserId,
      role: "ADMIN",
      organizationId: null,
      permissions: { canManagePayroll: true },
    };
    const res = await request(app).get("/api/payroll/acknowledgement-export");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Access denied");
  });

  it("groups rows across multiple wage decisions and pairs each row with its decision's affected projects (org-scoped)", async () => {
    testUser = asPayrollAdmin();
    const res = await request(app).get(
      "/api/payroll/acknowledgement-export?format=json",
    );
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(fx.orgAId);

    const rows = res.body.rows as Array<{
      decisionNumber: string;
      classification: string;
      acknowledgedAt: string | null;
      acknowledgedByName: string | null;
      affectedProjects: string[];
    }>;
    // Three orgA rate-change rows: WD1/Carpenter, WD1/Electrician,
    // WD2/Plumber. The orgB row must not appear.
    expect(rows).toHaveLength(3);

    // Rows are ordered by (decisionNumber, classification) so the
    // grouping is deterministic and auditor-friendly.
    expect(rows.map((r) => `${r.decisionNumber}|${r.classification}`)).toEqual([
      `${WD1}|${TEST_PREFIX}Carpenter`,
      `${WD1}|${TEST_PREFIX}Electrician`,
      `${WD2}|${TEST_PREFIX}Plumber`,
    ]);

    const wd1Carp = rows[0];
    const wd1Elec = rows[1];
    const wd2Plumb = rows[2];

    // Acknowledger name resolves on acked rows; unacked row stays null.
    expect(wd1Carp.acknowledgedByName).toBe("First-padmin Last-padmin");
    expect(wd1Carp.acknowledgedAt).not.toBeNull();
    expect(wd1Elec.acknowledgedByName).toBeNull();
    expect(wd1Elec.acknowledgedAt).toBeNull();
    expect(wd2Plumb.acknowledgedByName).toBe("First-padmin Last-padmin");

    // affectedProjects on each row reflects the caller's org's projects
    // for that row's decision number — and never bleeds across orgs.
    const wd1Affected = wd1Carp.affectedProjects;
    expect(wd1Affected.length).toBe(1);
    expect(wd1Affected[0]).toContain("Project A1");
    expect(wd1Elec.affectedProjects).toEqual(wd1Affected);

    const wd2Affected = wd2Plumb.affectedProjects;
    expect(wd2Affected.length).toBe(1);
    expect(wd2Affected[0]).toContain("Project A2");

    // Cross-check: no orgB project label leaks into any row.
    for (const r of rows) {
      for (const label of r.affectedProjects) {
        expect(label).not.toContain("Project B1");
      }
    }
  });

  it("CSV variant has the documented header and one body row per (decision, classification) within the caller's org", async () => {
    testUser = asPayrollAdmin();
    const res = await request(app).get(
      "/api/payroll/acknowledgement-export?format=csv",
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);

    const lines = res.text.split("\n");
    expect(lines[0]).toBe(
      [
        "Wage Decision",
        "Classification",
        "Change Kind",
        "Old Base Rate",
        "New Base Rate",
        "Old Fringe Rate",
        "New Fringe Rate",
        "Old Total Rate",
        "New Total Rate",
        "Detected At",
        "Acknowledged At",
        "Acknowledged By",
        "Acknowledgement Status",
        "Affected Projects",
      ].join(","),
    );
    // 1 header + 3 orgA rows.
    expect(lines).toHaveLength(4);
    // OrgB project label must not appear anywhere in the CSV body.
    expect(res.text).not.toContain("Project B1");
  });
});
