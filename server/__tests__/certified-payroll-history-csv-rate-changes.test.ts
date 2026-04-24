/**
 * Task #1517 — verifies the org-wide certified payroll history CSV
 * (`GET /api/payroll/certified-reports?format=csv`) carries an
 * "Unacknowledged Rate Changes" column flagging reports whose pay-run
 * currently references a (project, classification) pair with an
 * unacknowledged Davis-Bacon rate-change record.
 *
 * Two pay-runs are seeded on the same org:
 *   - payRunFlagged: line item maps to Project P1 (wageDecision="WD-1")
 *     and a worker classified as "Carpenter". A matching unacknowledged
 *     `wage_decision_rate_changes` row exists → flag column = "Yes".
 *   - payRunUnflagged: line item maps to Project P2 (wageDecision="WD-2")
 *     where no matching rate-change row exists → flag column = "No".
 *
 * Also asserts the column is populated for archived rows (the task's
 * acceptance criteria), by archiving the flagged report and re-running
 * the request with `?includeArchived=true`.
 *
 * Auth and unrelated transitive deps are mocked the same way the other
 * `payrollCertifiedReports*` integration tests do, so the real route
 * runs against the real test DB.
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

vi.mock("../events", () => ({ eventBus: { emit: vi.fn(), on: vi.fn() } }));
vi.mock("../rateLimiter", () => ({
  exportLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  apiLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  authLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  sensitiveLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../integrations/providers/dol_davis_bacon/sync", () => ({
  lookupCachedWageRate: vi.fn(),
  lookupCachedRateByLocale: vi.fn(),
  isWageDeterminationCached: vi.fn(),
  fetchWageDetermination: vi.fn(),
  importWageDetermination: vi.fn(),
  listCachedDecisionClassifications: vi.fn(),
  queueWageDecisionSync: vi.fn(),
  getWageDecisionSyncStatus: vi.fn(),
}));
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    deleteObjectByKey = vi.fn(async () => undefined);
  },
  objectStorageClient: {},
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

const TEST_PREFIX = "__cpr_history_csv_rc__";

let app: Express;
let db: typeof import("../db").db;

let orgId: string;
let adminId: string;
let workerFlagId: string;
let workerUnflagId: string;
let classCarpId: string;
let classElecId: string;
let projectFlaggedId: string;
let projectUnflaggedId: string;
let payRunFlaggedId: string;
let payRunUnflaggedId: string;
let reportFlaggedId: string;
let reportUnflaggedId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM "certified_payroll_reports" WHERE object_key LIKE ${TEST_PREFIX + "%"}
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
  await db.execute(sql`DELETE FROM "job_classifications" WHERE name LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}`);
}

async function seedFixtures(): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 8);

  const orgRow = await db.execute(sql`
    INSERT INTO "organizations" (name, slug)
    VALUES (${TEST_PREFIX + "org"}, ${TEST_PREFIX + suffix})
    RETURNING id
  `);
  orgId = (orgRow.rows[0] as { id: string }).id;

  const adminRow = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Admin', 'A', ${TEST_PREFIX + suffix + "-admin@example.com"}, 'ADMIN')
    RETURNING id
  `);
  adminId = (adminRow.rows[0] as { id: string }).id;

  const workerFlagRow = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Carp', 'F', ${TEST_PREFIX + suffix + "-carp@example.com"}, 'FIELD_WORKER')
    RETURNING id
  `);
  workerFlagId = (workerFlagRow.rows[0] as { id: string }).id;

  const workerUnflagRow = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Elec', 'U', ${TEST_PREFIX + suffix + "-elec@example.com"}, 'FIELD_WORKER')
    RETURNING id
  `);
  workerUnflagId = (workerUnflagRow.rows[0] as { id: string }).id;

  const classCarpRow = await db.execute(sql`
    INSERT INTO "job_classifications" (organization_id, name)
    VALUES (${orgId}, ${TEST_PREFIX + "Carpenter"})
    RETURNING id
  `);
  classCarpId = (classCarpRow.rows[0] as { id: string }).id;

  const classElecRow = await db.execute(sql`
    INSERT INTO "job_classifications" (organization_id, name)
    VALUES (${orgId}, ${TEST_PREFIX + "Electrician"})
    RETURNING id
  `);
  classElecId = (classElecRow.rows[0] as { id: string }).id;

  await db.execute(sql`
    INSERT INTO "employee_classifications"
      (organization_id, user_id, classification_id, regular_rate, overtime_rate, is_primary, effective_date)
    VALUES (${orgId}, ${workerFlagId}, ${classCarpId}, '20.00', '30.00', true, '2026-01-01')
  `);
  await db.execute(sql`
    INSERT INTO "employee_classifications"
      (organization_id, user_id, classification_id, regular_rate, overtime_rate, is_primary, effective_date)
    VALUES (${orgId}, ${workerUnflagId}, ${classElecId}, '20.00', '30.00', true, '2026-01-01')
  `);

  const projectFlaggedRow = await db.execute(sql`
    INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision, payroll_form_variant, state)
    VALUES (
      ${TEST_PREFIX + "P1"},
      ${TEST_PREFIX + suffix + "-p1"},
      ${TEST_PREFIX + "client"},
      ${orgId},
      'ACTIVE',
      'WD-1',
      'WH_347',
      'CA'
    )
    RETURNING id
  `);
  projectFlaggedId = (projectFlaggedRow.rows[0] as { id: string }).id;

  const projectUnflaggedRow = await db.execute(sql`
    INSERT INTO "projects" (name, code, client_name, gc_organization_id, status, wage_decision, payroll_form_variant, state)
    VALUES (
      ${TEST_PREFIX + "P2"},
      ${TEST_PREFIX + suffix + "-p2"},
      ${TEST_PREFIX + "client"},
      ${orgId},
      'ACTIVE',
      'WD-2',
      'WH_347',
      'CA'
    )
    RETURNING id
  `);
  projectUnflaggedId = (projectUnflaggedRow.rows[0] as { id: string }).id;

  const payRunFlaggedRow = await db.execute(sql`
    INSERT INTO "pay_runs" (organization_id, pay_period_start, pay_period_end, run_number, created_by_id, notes)
    VALUES (${orgId}, '2026-04-13', '2026-04-19', '1', ${adminId}, ${TEST_PREFIX})
    RETURNING id
  `);
  payRunFlaggedId = (payRunFlaggedRow.rows[0] as { id: string }).id;

  const payRunUnflaggedRow = await db.execute(sql`
    INSERT INTO "pay_runs" (organization_id, pay_period_start, pay_period_end, run_number, created_by_id, notes)
    VALUES (${orgId}, '2026-04-06', '2026-04-12', '2', ${adminId}, ${TEST_PREFIX})
    RETURNING id
  `);
  payRunUnflaggedId = (payRunUnflaggedRow.rows[0] as { id: string }).id;

  await db.execute(sql`
    INSERT INTO "pay_run_line_items"
      (pay_run_id, user_id, project_id, regular_hours, overtime_hours, regular_rate, overtime_rate, total_amount, gross_amount, total_deductions, net_amount)
    VALUES
      (${payRunFlaggedId}, ${workerFlagId}, ${projectFlaggedId}, '40', '0', '10.00', '15.00', '400.00', '400.00', '0', '400.00')
  `);
  await db.execute(sql`
    INSERT INTO "pay_run_line_items"
      (pay_run_id, user_id, project_id, regular_hours, overtime_hours, regular_rate, overtime_rate, total_amount, gross_amount, total_deductions, net_amount)
    VALUES
      (${payRunUnflaggedId}, ${workerUnflagId}, ${projectUnflaggedId}, '40', '0', '10.00', '15.00', '400.00', '400.00', '0', '400.00')
  `);

  // Seed an unacknowledged rate-change row for (org, WD-1, Carpenter) —
  // matches the flagged pay-run. Note classification name uses the test
  // prefix to mirror the seeded job_classifications row, since the join
  // keys off lower(trim(classification)) on both sides.
  await db.execute(sql`
    INSERT INTO "wage_decision_rate_changes"
      (organization_id, decision_number, classification, change_kind, new_base_rate, detected_at, acknowledged_at)
    VALUES
      (${orgId}, 'WD-1', ${TEST_PREFIX + "Carpenter"}, 'modified', '52.00', NOW(), NULL)
  `);
  // Also seed an *acknowledged* WD-2 row to confirm acknowledged records
  // do NOT cause the unflagged run to be flagged.
  await db.execute(sql`
    INSERT INTO "wage_decision_rate_changes"
      (organization_id, decision_number, classification, change_kind, new_base_rate, detected_at, acknowledged_at, acknowledged_by_user_id)
    VALUES
      (${orgId}, 'WD-2', ${TEST_PREFIX + "Electrician"}, 'modified', '62.00', NOW(), NOW(), ${adminId})
  `);

  // Insert one certified report per pay run.
  const flaggedReportRow = await db.execute(sql`
    INSERT INTO "certified_payroll_reports"
      (organization_id, pay_run_id, project_id, variant, object_key, file_size, generated_by_id)
    VALUES
      (${orgId}, ${payRunFlaggedId}, ${projectFlaggedId}, 'WH_347',
       ${TEST_PREFIX + "flagged.pdf"}, 1024, ${adminId})
    RETURNING id
  `);
  reportFlaggedId = (flaggedReportRow.rows[0] as { id: string }).id;

  const unflaggedReportRow = await db.execute(sql`
    INSERT INTO "certified_payroll_reports"
      (organization_id, pay_run_id, project_id, variant, object_key, file_size, generated_by_id)
    VALUES
      (${orgId}, ${payRunUnflaggedId}, ${projectUnflaggedId}, 'WH_347',
       ${TEST_PREFIX + "unflagged.pdf"}, 1024, ${adminId})
    RETURNING id
  `);
  reportUnflaggedId = (unflaggedReportRow.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  ({ db } = await import("../db"));
  const { default: payrollRoutes } = await import("../payrollRoutes");

  app = express();
  app.use(express.json());
  app.use(payrollRoutes);

  await cleanup();
  await seedFixtures();
}, 60_000);

beforeEach(() => {
  testUser = { id: adminId, role: "ADMIN", organizationId: orgId };
});

afterAll(async () => {
  await cleanup();
});

/**
 * Parse a CSV body into rows + the index of a known column header. Keeps
 * the test resilient to future column re-orderings.
 */
function parseCsv(body: string): { header: string[]; rows: string[][] } {
  const lines = body.split("\n").filter((l) => l.length > 0);
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { cur += ch; }
      } else {
        if (ch === ",") { out.push(cur); cur = ""; }
        else if (ch === '"') { inQ = true; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { header, rows };
}

describe("GET /api/payroll/certified-reports?format=csv — Unacknowledged Rate Changes column (Task #1517)", () => {
  it("flags reports whose pay-run currently has unacknowledged Davis-Bacon rate-change records", async () => {
    const res = await request(app).get("/api/payroll/certified-reports?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);

    const { header, rows } = parseCsv(res.text);
    expect(header).toContain("Unacknowledged Rate Changes");
    expect(header).toContain("Report ID");

    const flagIdx = header.indexOf("Unacknowledged Rate Changes");
    const idIdx = header.indexOf("Report ID");

    const seeded = rows.filter((r) => r[idIdx] === reportFlaggedId || r[idIdx] === reportUnflaggedId);
    expect(seeded.length).toBe(2);

    const byId = new Map(seeded.map((r) => [r[idIdx], r[flagIdx]]));
    expect(byId.get(reportFlaggedId)).toBe("Yes");
    expect(byId.get(reportUnflaggedId)).toBe("No");
  });

  it("ignores acknowledged rate-change records when computing the flag", async () => {
    // Acknowledge the WD-1 row → the flag should clear.
    await db.execute(sql`
      UPDATE "wage_decision_rate_changes"
      SET acknowledged_at = NOW(), acknowledged_by_user_id = ${adminId}
      WHERE organization_id = ${orgId} AND decision_number = 'WD-1'
    `);

    const res = await request(app).get("/api/payroll/certified-reports?format=csv");
    expect(res.status).toBe(200);
    const { header, rows } = parseCsv(res.text);
    const flagIdx = header.indexOf("Unacknowledged Rate Changes");
    const idIdx = header.indexOf("Report ID");
    const flaggedRow = rows.find((r) => r[idIdx] === reportFlaggedId);
    expect(flaggedRow).toBeDefined();
    expect(flaggedRow![flagIdx]).toBe("No");

    // Restore the unacknowledged state for the rest of the suite.
    await db.execute(sql`
      UPDATE "wage_decision_rate_changes"
      SET acknowledged_at = NULL, acknowledged_by_user_id = NULL
      WHERE organization_id = ${orgId} AND decision_number = 'WD-1'
    `);
  });

  it("populates the column for archived rows when includeArchived=true", async () => {
    // Archive the flagged report.
    await db.execute(sql`
      UPDATE "certified_payroll_reports"
      SET archived_at = NOW(), archived_by_id = ${adminId}, archive_reason = 'test archive'
      WHERE id = ${reportFlaggedId}
    `);
    try {
      const res = await request(app).get(
        "/api/payroll/certified-reports?format=csv&includeArchived=true",
      );
      expect(res.status).toBe(200);
      const { header, rows } = parseCsv(res.text);
      const flagIdx = header.indexOf("Unacknowledged Rate Changes");
      const idIdx = header.indexOf("Report ID");
      const archivedRow = rows.find((r) => r[idIdx] === reportFlaggedId);
      expect(archivedRow).toBeDefined();
      expect(archivedRow![flagIdx]).toBe("Yes");
    } finally {
      await db.execute(sql`
        UPDATE "certified_payroll_reports"
        SET archived_at = NULL, archived_by_id = NULL, archive_reason = NULL
        WHERE id = ${reportFlaggedId}
      `);
    }
  });
});
