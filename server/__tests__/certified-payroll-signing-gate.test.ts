/**
 * Task #1485 — automated tests for the certified-payroll signing gate.
 *
 * The gate sits on `/api/payroll/pay-runs/:id/certified-payroll-pdf` and
 * refuses to generate the PDF when one or more classifications on the
 * pay run have an unacknowledged Davis-Bacon rate-change record AND the
 * effective per-org / per-project policy is not OFF:
 *
 *   - BLOCK → 409, even with no acknowledged flag
 *   - WARN  → 412 unless `?acknowledged=true` is passed (soft-confirm)
 *   - OFF   → never blocks
 *
 * The strictest policy across affected projects wins, and per-project
 * overrides on `projects.rateChangeSigningPolicy` take precedence over
 * the org default in `organization_payroll_settings`. These tests pin
 * each permutation against the real route handlers + a real DB while
 * mocking auth, ObjectStorage, the WH-347 PDF generator, and the DOL
 * Davis-Bacon helpers exactly the way the existing
 * `certified-payroll-davis-bacon-fallback.test.ts` does.
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

vi.mock("../services/featureFlagService", () => ({
  getFeatureFlags: vi.fn(async () => ({ WH_347_PAYROLL: true })),
}));

const generateWH347PdfMock = vi.fn(async (_payload: unknown, _variant: string) => {
  return Buffer.from("%PDF-1.4 stub");
});
vi.mock("../services/wh347Generator", () => ({
  generateWH347Pdf: (...args: unknown[]) => generateWH347PdfMock(...(args as [unknown, string])),
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

const TEST_PREFIX = "__cpr_signing_gate__";

let app: Express;
let db: typeof import("../db").db;

interface Fixtures {
  orgId: string;
  adminId: string;
  payRunId: string;
  projectId: string;
  classificationId: string;
  userId: string;
}

let fx: Fixtures;

async function cleanup(): Promise<void> {
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
    DELETE FROM "wage_decision_rate_changes" WHERE organization_id IN (
      SELECT id FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}
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
  await db.execute(sql`
    DELETE FROM "organization_payroll_settings" WHERE organization_id IN (
      SELECT id FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}
    )
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

  const projectRow = await db.execute(sql`
    INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision, payroll_form_variant, state)
    VALUES (
      ${TEST_PREFIX + "proj"},
      ${TEST_PREFIX + suffix + "-proj"},
      ${TEST_PREFIX + "client"},
      ${orgId},
      'ACTIVE',
      'WD-GATE',
      'WH_347',
      'CA'
    )
    RETURNING id
  `);
  const projectId = (projectRow.rows[0] as { id: string }).id;

  const classRow = await db.execute(sql`
    INSERT INTO "job_classifications" (organization_id, name)
    VALUES (${orgId}, ${TEST_PREFIX + "Carpenter"})
    RETURNING id
  `);
  const classificationId = (classRow.rows[0] as { id: string }).id;

  const userRow = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Emp', 'One', ${TEST_PREFIX + suffix + "-emp@example.com"}, 'FIELD_WORKER')
    RETURNING id
  `);
  const userId = (userRow.rows[0] as { id: string }).id;

  await db.execute(sql`
    INSERT INTO "employee_classifications"
      (organization_id, user_id, classification_id, regular_rate, overtime_rate, is_primary, effective_date)
    VALUES
      (${orgId}, ${userId}, ${classificationId}, '20.00', '30.00', true, '2026-01-01')
  `);

  const payRunRow = await db.execute(sql`
    INSERT INTO "pay_runs" (organization_id, pay_period_start, pay_period_end, run_number, created_by_id, notes)
    VALUES (${orgId}, '2026-04-13', '2026-04-19', '1', ${adminId}, ${TEST_PREFIX})
    RETURNING id
  `);
  const payRunId = (payRunRow.rows[0] as { id: string }).id;

  await db.execute(sql`
    INSERT INTO "pay_run_line_items"
      (pay_run_id, user_id, project_id, regular_hours, overtime_hours, regular_rate, overtime_rate, total_amount, gross_amount, total_deductions, net_amount)
    VALUES
      (${payRunId}, ${userId}, ${projectId}, '40', '0', '20.00', '30.00', '800.00', '800.00', '0', '800.00')
  `);

  return { orgId, adminId, payRunId, projectId, classificationId, userId };
}

async function setOrgPolicy(orgId: string, policy: string | null): Promise<void> {
  // Upsert the row with the requested policy. NULL → fall back to default WARN.
  if (policy === null) {
    await db.execute(sql`
      DELETE FROM "organization_payroll_settings" WHERE organization_id = ${orgId}
    `);
    return;
  }
  await db.execute(sql`
    INSERT INTO "organization_payroll_settings" (organization_id, rate_change_signing_policy)
    VALUES (${orgId}, ${policy})
    ON CONFLICT (organization_id) DO UPDATE SET rate_change_signing_policy = EXCLUDED.rate_change_signing_policy
  `);
}

async function setProjectPolicy(projectId: string, policy: string | null): Promise<void> {
  await db.execute(sql`
    UPDATE "projects" SET rate_change_signing_policy = ${policy} WHERE id = ${projectId}
  `);
}

async function seedRateChangeFlag(orgId: string, classificationName: string, kind: "added" | "changed" | "removed" = "changed"): Promise<void> {
  await db.execute(sql`
    DELETE FROM "wage_decision_rate_changes"
    WHERE organization_id = ${orgId} AND decision_number = 'WD-GATE'
  `);
  await db.execute(sql`
    INSERT INTO "wage_decision_rate_changes"
      (organization_id, decision_number, classification, change_kind, detected_at)
    VALUES
      (${orgId}, 'WD-GATE', ${classificationName}, ${kind}, NOW())
  `);
}

async function clearRateChangeFlags(orgId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM "wage_decision_rate_changes" WHERE organization_id = ${orgId}
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
  generateWH347PdfMock.mockClear();

  lookupCachedWageRateMock.mockResolvedValue(null);
  lookupCachedRateByLocaleMock.mockResolvedValue(null);
  isWageDeterminationCachedMock.mockResolvedValue(true);

  testUser = { id: fx.adminId, role: "ADMIN", organizationId: fx.orgId };

  await clearRateChangeFlags(fx.orgId);
  await setOrgPolicy(fx.orgId, null);
  await setProjectPolicy(fx.projectId, null);
});

afterAll(async () => {
  await cleanup();
});

describe("certified-payroll signing gate (Task #1485)", () => {
  it("WARN policy returns 412 with the affected classifications and lets the PDF download once acknowledged", async () => {
    await setOrgPolicy(fx.orgId, "WARN");
    await seedRateChangeFlag(fx.orgId, TEST_PREFIX + "Carpenter");

    const blocked = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`,
    );
    expect(blocked.status).toBe(412);
    expect(blocked.body.code).toBe("RATE_CHANGE_CONFIRM_REQUIRED");
    expect(blocked.body.policy).toBe("WARN");
    expect(Array.isArray(blocked.body.recentRateChanges)).toBe(true);
    expect(blocked.body.recentRateChanges.length).toBeGreaterThan(0);
    expect(blocked.body.recentRateChanges[0]).toMatchObject({
      projectId: fx.projectId,
    });
    expect(generateWH347PdfMock).not.toHaveBeenCalled();

    const allowed = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf?acknowledged=true`,
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers["content-type"]).toMatch(/application\/pdf/);
    expect(generateWH347PdfMock).toHaveBeenCalledTimes(1);
  });

  it("BLOCK policy returns 409 even with acknowledged=true (PM must clear the flag from the prevailing-wage panel)", async () => {
    await setOrgPolicy(fx.orgId, "BLOCK");
    await seedRateChangeFlag(fx.orgId, TEST_PREFIX + "Carpenter");

    const res = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RATE_CHANGE_BLOCKED");
    expect(res.body.policy).toBe("BLOCK");
    expect(generateWH347PdfMock).not.toHaveBeenCalled();

    // BLOCK is a hard gate: even if the client passes the soft-confirm
    // bypass flag, the server still refuses. Only clearing the
    // underlying rate-change record (typically via the acknowledge
    // workflow on the prevailing-wage panel) lets the PDF generate.
    const stillBlocked = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf?acknowledged=true`,
    );
    expect(stillBlocked.status).toBe(409);
    expect(stillBlocked.body.code).toBe("RATE_CHANGE_BLOCKED");
    expect(stillBlocked.body.policy).toBe("BLOCK");
    expect(generateWH347PdfMock).not.toHaveBeenCalled();

    await clearRateChangeFlags(fx.orgId);
    const cleared = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`,
    );
    expect(cleared.status).toBe(200);
    expect(generateWH347PdfMock).toHaveBeenCalledTimes(1);
  });

  it("OFF policy never blocks even with unacknowledged rate changes", async () => {
    await setOrgPolicy(fx.orgId, "OFF");
    await seedRateChangeFlag(fx.orgId, TEST_PREFIX + "Carpenter");

    const res = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`,
    );
    expect(res.status).toBe(200);
    expect(generateWH347PdfMock).toHaveBeenCalledTimes(1);
  });

  it("project override beats the org default", async () => {
    await setOrgPolicy(fx.orgId, "OFF");
    await setProjectPolicy(fx.projectId, "BLOCK");
    await seedRateChangeFlag(fx.orgId, TEST_PREFIX + "Carpenter");

    const res = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`,
    );
    expect(res.status).toBe(409);
    expect(res.body.policy).toBe("BLOCK");
    expect(generateWH347PdfMock).not.toHaveBeenCalled();
  });

  it("no unacknowledged rate change → gate stays out of the way regardless of policy", async () => {
    await setOrgPolicy(fx.orgId, "BLOCK");
    // No flag seeded — pdfRateChangeRowMap is empty so the gate never fires.

    const res = await request(app).get(
      `/api/payroll/pay-runs/${fx.payRunId}/certified-payroll-pdf`,
    );
    expect(res.status).toBe(200);
    expect(generateWH347PdfMock).toHaveBeenCalledTimes(1);
  });
});
