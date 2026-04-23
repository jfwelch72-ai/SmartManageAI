/**
 * Task #1180: integration tests for the admin-only certified payroll
 * archive / unarchive / hard-delete endpoints in `server/payrollRoutes.ts`.
 *
 * Covers the security and bookkeeping invariants the routes are responsible
 * for, end-to-end, against the real test database:
 *   - Admin-only role gate (non-admin in-org callers get 403, admins succeed).
 *   - Org scoping (a caller in another org sees a 404 — never a leak).
 *   - Required `reason` body (missing/short reason is rejected with 400).
 *   - Double-archive is rejected with 400.
 *   - Audit log is recorded with the supplied reason.
 *   - Hard delete invokes ObjectStorageService.deleteObjectByKey for the
 *     report's stored PDF before the DB row is removed.
 *
 * Auth (`requireAuth`, `requireRole`, `requireFeaturePermission`) is mocked
 * so we can flip between SUPER_ADMIN / ADMIN / FIELD_WORKER callers without
 * standing up a real session. ObjectStorageService is mocked so we can spy
 * on `deleteObjectByKey` without hitting GCS. `logAudit` is spied on so we
 * can prove the route called it with the right payload (the route's actual
 * `logAudit` call also runs against the real audit_log table — we assert
 * both the spy AND a row in the DB so a future swap of `logAudit` for a
 * different sink would still fail this test).
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
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { sql } from "drizzle-orm";

type TestUser = {
  id: string;
  role: string;
  organizationId: string | null;
  effectiveRole?: string;
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
  // The certified-report routes are mounted under
  // `router.use("/api/payroll", requireAuth, requireFeaturePermission('canManagePayroll'))`
  // — for the purposes of these tests every authenticated user passes the
  // feature gate, so the role gate (`requireRole("ADMIN", "SUPER_ADMIN")`)
  // is the one being exercised.
  requireFeaturePermission: () =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      next();
    },
  requireRole: (...roles: string[]) =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      if (req.user.role === "SUPER_ADMIN") {
        next();
        return;
      }
      const role = req.user.effectiveRole || req.user.role;
      if (!roles.includes(role)) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
      next();
    },
}));

// Spy on logAudit so we can assert the route handed it the right payload.
// We still let the real implementation run so a row actually lands in
// `audit_log` and we can verify the persisted record below.
type LogAuditArgs = Parameters<typeof import("../auditLogger")["logAudit"]>;
const logAuditSpy = vi.fn<(...args: LogAuditArgs) => void>();
vi.mock("../auditLogger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auditLogger")>();
  return {
    ...actual,
    logAudit: vi.fn(async (...args: LogAuditArgs) => {
      logAuditSpy(...args);
      await actual.logAudit(...args);
    }),
  };
});

// ObjectStorageService is dynamically imported by the DELETE handler. Mock
// the module so we don't talk to GCS during tests; expose the spy so we
// can assert it was (or wasn't) invoked.
const deleteObjectByKeySpy = vi.fn(async (_key: string) => undefined);
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    deleteObjectByKey = deleteObjectByKeySpy;
  },
  objectStorageClient: {},
}));

// Heavy / unrelated transitive dependencies — stub to keep the import graph
// quiet. We never hit any of these from the routes under test.
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
  fetchWageDetermination: vi.fn(),
  importWageDetermination: vi.fn(),
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

const TEST_PREFIX = "__cpr_admin_test__";

let app: Express;
let db: typeof import("../db").db;

let orgA: string;
let orgB: string;
let adminA: string;
let fieldA: string;
let adminB: string;
let payRunA: string;

async function cleanup() {
  // Delete in dependency order. Test prefix isolates rows even when the
  // suite is interrupted halfway through.
  await db.execute(sql`
    DELETE FROM "certified_payroll_reports" WHERE "object_key" LIKE ${TEST_PREFIX + "%"}
  `);
  await db.execute(sql`DELETE FROM "pay_runs" WHERE "notes" = ${TEST_PREFIX}`);
  // audit_log rows reference users(id), so must be cleared before users.
  await db.execute(sql`
    DELETE FROM "audit_log" WHERE "user_id" IN (
      SELECT id FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}
    )
  `);
  await db.execute(sql`DELETE FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}`);
}

async function seedFixtures() {
  const orgAResult = await db.execute(sql`
    INSERT INTO "organizations" (name, slug) VALUES (${TEST_PREFIX + "A"}, ${TEST_PREFIX + "a"}) RETURNING id
  `);
  orgA = (orgAResult.rows[0] as { id: string }).id;

  const orgBResult = await db.execute(sql`
    INSERT INTO "organizations" (name, slug) VALUES (${TEST_PREFIX + "B"}, ${TEST_PREFIX + "b"}) RETURNING id
  `);
  orgB = (orgBResult.rows[0] as { id: string }).id;

  const adminAResult = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgA}, 'Admin', 'A', ${TEST_PREFIX + "admin-a@example.com"}, 'ADMIN')
    RETURNING id
  `);
  adminA = (adminAResult.rows[0] as { id: string }).id;

  const fieldAResult = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgA}, 'Field', 'A', ${TEST_PREFIX + "field-a@example.com"}, 'FIELD_WORKER')
    RETURNING id
  `);
  fieldA = (fieldAResult.rows[0] as { id: string }).id;

  const adminBResult = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgB}, 'Admin', 'B', ${TEST_PREFIX + "admin-b@example.com"}, 'ADMIN')
    RETURNING id
  `);
  adminB = (adminBResult.rows[0] as { id: string }).id;

  const payRunResult = await db.execute(sql`
    INSERT INTO "pay_runs" (organization_id, pay_period_start, pay_period_end, created_by_id, notes)
    VALUES (${orgA}, '2026-04-13', '2026-04-19', ${adminA}, ${TEST_PREFIX})
    RETURNING id
  `);
  payRunA = (payRunResult.rows[0] as { id: string }).id;
}

async function insertReport(opts: {
  orgId?: string;
  payRunId?: string;
  archived?: boolean;
  objectKey?: string;
}): Promise<string> {
  const orgId = opts.orgId ?? orgA;
  const payRunId = opts.payRunId ?? payRunA;
  const objectKey = opts.objectKey ?? `${TEST_PREFIX}${Math.random().toString(36).slice(2, 10)}.pdf`;
  const archivedAt: Date | null = opts.archived ? new Date() : null;
  const archivedById: string | null = opts.archived ? adminA : null;
  const archiveReason: string | null = opts.archived ? "previously archived" : null;

  const r = await db.execute(sql`
    INSERT INTO "certified_payroll_reports"
      (organization_id, pay_run_id, variant, object_key, file_size, generated_by_id, archived_at, archived_by_id, archive_reason)
    VALUES
      (${orgId}, ${payRunId}, 'WH_347', ${objectKey}, 1024, ${adminA},
       ${archivedAt}, ${archivedById}, ${archiveReason})
    RETURNING id
  `);
  return (r.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  ({ db } = await import("../db"));
  const { default: payrollRoutes } = await import("../payrollRoutes");

  app = express();
  app.use(express.json());
  app.use(payrollRoutes);

  await cleanup();
  await seedFixtures();
});

beforeEach(() => {
  testUser = null;
  logAuditSpy.mockClear();
  deleteObjectByKeySpy.mockClear();
});

afterAll(async () => {
  await cleanup();
});

describe("POST /api/payroll/certified-reports/:id/archive", () => {
  it("returns 401 when unauthenticated", async () => {
    const id = await insertReport({});
    const res = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({ reason: "draft pay run" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for an in-org non-admin caller", async () => {
    const id = await insertReport({});
    testUser = { id: fieldA, role: "FIELD_WORKER", organizationId: orgA };
    const res = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({ reason: "draft pay run" });
    expect(res.status).toBe(403);

    // Row stays active and no audit row recorded.
    const after = await db.execute(sql`
      SELECT archived_at FROM "certified_payroll_reports" WHERE id = ${id}
    `);
    expect((after.rows[0] as { archived_at: unknown }).archived_at).toBeNull();
    expect(logAuditSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when an admin from a different org targets the report (cross-org safety)", async () => {
    const id = await insertReport({});
    testUser = { id: adminB, role: "ADMIN", organizationId: orgB };
    const res = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({ reason: "draft pay run" });
    expect(res.status).toBe(404);

    const after = await db.execute(sql`
      SELECT archived_at FROM "certified_payroll_reports" WHERE id = ${id}
    `);
    expect((after.rows[0] as { archived_at: unknown }).archived_at).toBeNull();
  });

  it("returns 400 when the reason is missing or too short", async () => {
    const id = await insertReport({});
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };

    const noBody = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({});
    expect(noBody.status).toBe(400);

    const tooShort = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({ reason: "x" });
    expect(tooShort.status).toBe(400);
  });

  it("archives on the admin happy path and logs an audit row carrying the reason", async () => {
    const id = await insertReport({});
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };
    const reason = "wrong variant — regenerating";

    const res = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({ reason });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.archivedAt).toBe("string");

    // DB updated.
    const after = await db.execute(sql`
      SELECT archived_at, archived_by_id, archive_reason
      FROM "certified_payroll_reports" WHERE id = ${id}
    `);
    const row = after.rows[0] as {
      archived_at: unknown;
      archived_by_id: string;
      archive_reason: string;
    };
    expect(row.archived_at).not.toBeNull();
    expect(row.archived_by_id).toBe(adminA);
    expect(row.archive_reason).toBe(reason);

    // Audit logged with the supplied reason — assert both the spy AND
    // that a row was actually persisted in `audit_log`.
    expect(logAuditSpy).toHaveBeenCalledTimes(1);
    const auditCall = logAuditSpy.mock.calls[0][0];
    expect(auditCall.userId).toBe(adminA);
    expect(auditCall.action).toBe("ARCHIVE");
    expect(auditCall.entityType).toBe("certified_payroll_reports");
    expect(auditCall.entityId).toBe(id);
    expect(String(auditCall.newValue)).toContain(reason);

    const auditRows = await db.execute(sql`
      SELECT user_id, action, entity_type, entity_id, new_value
      FROM "audit_log"
      WHERE entity_type = 'certified_payroll_reports' AND entity_id = ${id}
    `);
    expect(auditRows.rows.length).toBe(1);
    const auditRow = auditRows.rows[0] as {
      user_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      new_value: string;
    };
    expect(auditRow.user_id).toBe(adminA);
    expect(auditRow.action).toBe("ARCHIVE");
    expect(auditRow.entity_id).toBe(id);
    expect(auditRow.new_value).toContain(reason);
  });

  it("returns 400 when the report is already archived (no double-archive)", async () => {
    const id = await insertReport({ archived: true });
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };

    const res = await request(app)
      .post(`/api/payroll/certified-reports/${id}/archive`)
      .send({ reason: "trying again" });
    expect(res.status).toBe(400);
    expect(logAuditSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/payroll/certified-reports/:id/unarchive", () => {
  it("returns 403 for non-admin in-org callers", async () => {
    const id = await insertReport({ archived: true });
    testUser = { id: fieldA, role: "FIELD_WORKER", organizationId: orgA };
    const res = await request(app).post(`/api/payroll/certified-reports/${id}/unarchive`).send({});
    expect(res.status).toBe(403);
  });

  it("returns 404 for an admin in a different org", async () => {
    const id = await insertReport({ archived: true });
    testUser = { id: adminB, role: "ADMIN", organizationId: orgB };
    const res = await request(app).post(`/api/payroll/certified-reports/${id}/unarchive`).send({});
    expect(res.status).toBe(404);
  });

  it("returns 400 when the report is not archived", async () => {
    const id = await insertReport({ archived: false });
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };
    const res = await request(app).post(`/api/payroll/certified-reports/${id}/unarchive`).send({});
    expect(res.status).toBe(400);
  });

  it("restores an archived report on the admin happy path and logs an UNARCHIVE audit row", async () => {
    const id = await insertReport({ archived: true });
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };
    const res = await request(app).post(`/api/payroll/certified-reports/${id}/unarchive`).send({});
    expect(res.status).toBe(200);

    const after = await db.execute(sql`
      SELECT archived_at, archived_by_id, archive_reason
      FROM "certified_payroll_reports" WHERE id = ${id}
    `);
    const row = after.rows[0] as Record<string, unknown>;
    expect(row.archived_at).toBeNull();
    expect(row.archived_by_id).toBeNull();
    expect(row.archive_reason).toBeNull();

    expect(logAuditSpy).toHaveBeenCalledTimes(1);
    const auditCall = logAuditSpy.mock.calls[0][0];
    expect(auditCall.action).toBe("UNARCHIVE");
    expect(auditCall.entityId).toBe(id);

    const auditRows = await db.execute(sql`
      SELECT action, entity_id, user_id FROM "audit_log"
      WHERE entity_type = 'certified_payroll_reports' AND entity_id = ${id}
    `);
    expect(auditRows.rows.length).toBe(1);
    const auditRow = auditRows.rows[0] as { action: string; entity_id: string; user_id: string };
    expect(auditRow.action).toBe("UNARCHIVE");
    expect(auditRow.user_id).toBe(adminA);
  });
});

describe("DELETE /api/payroll/certified-reports/:id", () => {
  it("returns 403 for non-admin in-org callers and does not touch object storage", async () => {
    const id = await insertReport({});
    testUser = { id: fieldA, role: "FIELD_WORKER", organizationId: orgA };
    const res = await request(app)
      .delete(`/api/payroll/certified-reports/${id}`)
      .send({ reason: "draft pay run" });
    expect(res.status).toBe(403);
    expect(deleteObjectByKeySpy).not.toHaveBeenCalled();

    // Row still present.
    const r = await db.execute(sql`SELECT id FROM "certified_payroll_reports" WHERE id = ${id}`);
    expect(r.rows.length).toBe(1);
  });

  it("returns 404 for cross-org admin callers and does not touch object storage", async () => {
    const id = await insertReport({});
    testUser = { id: adminB, role: "ADMIN", organizationId: orgB };
    const res = await request(app)
      .delete(`/api/payroll/certified-reports/${id}`)
      .send({ reason: "draft pay run" });
    expect(res.status).toBe(404);
    expect(deleteObjectByKeySpy).not.toHaveBeenCalled();
  });

  it("returns 400 when the reason is missing or too short", async () => {
    const id = await insertReport({});
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };

    const noBody = await request(app).delete(`/api/payroll/certified-reports/${id}`).send({});
    expect(noBody.status).toBe(400);

    const tooShort = await request(app)
      .delete(`/api/payroll/certified-reports/${id}`)
      .send({ reason: "x" });
    expect(tooShort.status).toBe(400);

    expect(deleteObjectByKeySpy).not.toHaveBeenCalled();
  });

  it("hard-deletes on the admin happy path: removes the row, deletes the storage object, and logs an audit row", async () => {
    const objectKey = `${TEST_PREFIX}delete-happy-${Date.now()}.pdf`;
    const id = await insertReport({ objectKey });
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };
    const reason = "test data — drop it";

    const res = await request(app)
      .delete(`/api/payroll/certified-reports/${id}`)
      .send({ reason });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, storageDeleted: true });

    // Storage delete invoked with the report's object key — proving the
    // route doesn't skip the cleanup step (Task #1180 acceptance).
    expect(deleteObjectByKeySpy).toHaveBeenCalledTimes(1);
    expect(deleteObjectByKeySpy).toHaveBeenCalledWith(objectKey);

    // Row gone.
    const r = await db.execute(sql`SELECT id FROM "certified_payroll_reports" WHERE id = ${id}`);
    expect(r.rows.length).toBe(0);

    // Audit row recorded with the supplied reason — assert both the spy
    // AND that a row was actually persisted in `audit_log`.
    expect(logAuditSpy).toHaveBeenCalledTimes(1);
    const auditCall = logAuditSpy.mock.calls[0][0];
    expect(auditCall.action).toBe("DELETE");
    expect(auditCall.entityType).toBe("certified_payroll_reports");
    expect(auditCall.entityId).toBe(id);
    expect(String(auditCall.newValue)).toContain(reason);

    const auditRows = await db.execute(sql`
      SELECT user_id, action, entity_type, entity_id, new_value, old_value
      FROM "audit_log"
      WHERE entity_type = 'certified_payroll_reports' AND entity_id = ${id}
    `);
    expect(auditRows.rows.length).toBe(1);
    const auditRow = auditRows.rows[0] as {
      user_id: string;
      action: string;
      entity_id: string;
      new_value: string;
      old_value: string;
    };
    expect(auditRow.user_id).toBe(adminA);
    expect(auditRow.action).toBe("DELETE");
    expect(auditRow.entity_id).toBe(id);
    expect(auditRow.new_value).toContain(reason);
    expect(auditRow.old_value).toContain(objectKey);
  });

  it("aborts with 502 and keeps the row when object storage fails (no orphaned DB pointer)", async () => {
    const id = await insertReport({});
    testUser = { id: adminA, role: "ADMIN", organizationId: orgA };

    deleteObjectByKeySpy.mockImplementationOnce(async () => {
      throw new Error("simulated GCS failure");
    });

    const res = await request(app)
      .delete(`/api/payroll/certified-reports/${id}`)
      .send({ reason: "going to fail" });
    expect(res.status).toBe(502);

    // DB row is still present — no orphan.
    const r = await db.execute(sql`SELECT id FROM "certified_payroll_reports" WHERE id = ${id}`);
    expect(r.rows.length).toBe(1);

    // No audit row recorded for the aborted delete.
    expect(logAuditSpy).not.toHaveBeenCalled();
  });
});
