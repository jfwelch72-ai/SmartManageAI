/**
 * Task #1689 — tests for the per-org failure-threshold override
 * routes added in Task #1668:
 *
 *   - GET  /api/organizations/project-log-email-settings
 *   - PUT  /api/organizations/project-log-email-settings
 *
 * The worker reads `organizations.project_log_email_failure_threshold`
 * via `loadOrgProjectLogEmailFailureThreshold` and resolves the
 * effective threshold through `getProjectLogEmailFailureThreshold`
 * (per-org → env → hard-coded). These two endpoints are the admin
 * surface for that override and were previously only covered by
 * manual e2e checks. The tests below pin down:
 *
 *   - GET returns the platform default + `defaults`/`bounds` payload
 *     when no override is set.
 *   - GET returns the override (and a matching `effectiveThreshold`)
 *     when one is set.
 *   - PUT validates the body — out-of-bounds (0 / 51) and non-numeric
 *     ("abc") payloads are rejected with 400, while `null` (clear the
 *     override) and a valid value both succeed with 200.
 *   - Role gating mirrors the rest of the project-log-email routes:
 *     SUPERINTENDENT can read but not write; FIELD_WORKER can do
 *     neither.
 *
 * Hermetic — mirrors the in-process db mocks used by the sibling
 * routes tests (`project-log-email-schedule-send-now.test.ts`,
 * `project-log-email-schedule-failure-alert-routes.test.ts`) so the
 * tests don't need a real Postgres bootstrap.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import {
  PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
  PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
} from "@shared/schema";

type Row = Record<string, unknown>;

const selectByTable: Record<string, Row[][]> = {};
const updates: Array<{ table: string; values?: Row }> = [];

function tableName(t: unknown): string {
  if (!t || typeof t !== "object") return "<unknown>";
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("Name")) {
      const v = (t as Record<symbol, unknown>)[sym];
      if (typeof v === "string") return v;
    }
  }
  return "<unknown>";
}

function makeSelectChain() {
  let resolvedTable = "<unknown>";
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => {
    resolvedTable = tableName(t);
    return chain;
  };
  chain.where = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
    try {
      const queue = selectByTable[resolvedTable] ?? [];
      const next = queue.length ? queue.shift()! : [];
      return Promise.resolve(next).then(resolve, reject);
    } catch (err) {
      return reject ? reject(err) : Promise.reject(err);
    }
  };
  chain.then = settle;
  chain.catch = (reject: (e: unknown) => unknown) => settle((v) => v, reject);
  return chain;
}

// Per-table queue of `.returning()` payloads for `db.update()`. The
// PUT route does `db.update(organizations).set(...).where(...).returning(...)`
// so the mock has to surface a configurable returned row instead of
// the no-op shape used by the other routes tests.
const updateReturningByTable: Record<string, Row[][]> = {};

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: () => ({
    values: () => ({
      returning: async () => [],
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    }),
  }),
  update: (t: unknown) => {
    const table = tableName(t);
    return {
      set: (values: Row) => {
        const where = (..._args: unknown[]) => {
          const result = {
            returning: async () => {
              updates.push({ table, values });
              const queue = updateReturningByTable[table] ?? [];
              return queue.length ? queue.shift()! : [];
            },
            then: (resolve: (v: unknown) => unknown) => {
              updates.push({ table, values });
              return Promise.resolve(undefined).then(resolve);
            },
          };
          return result;
        };
        return { where };
      },
    };
  },
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => true),
  sendEmailWithResult: vi.fn(async () => ({ ok: true, recipientCount: 0 })),
}));

vi.mock("../services/projectLogService", () => ({
  buildProjectLogPdfBuffer: vi.fn(async () => Buffer.from("pdf")),
}));

function makeApp(routes: any): Express {
  // Lazy-require express so the vi.mock above lands first.
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: any }, _res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user-id");
    const orgId = req.header("x-test-org-id");
    const role = req.header("x-test-role");
    if (userId && orgId && role) {
      req.user = { id: userId, organizationId: orgId, role };
    }
    next();
  });
  app.use("/api", routes);
  return app;
}

let app: Express;

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  for (const k of Object.keys(updateReturningByTable)) delete updateReturningByTable[k];
  updates.length = 0;
  // Make sure no env override leaks in from another test file in the
  // suite — these tests only intend to assert the per-org column path.
  delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
  vi.resetModules();
  const mod = await import("../projectLogEmailScheduleRoutes");
  app = makeApp(mod.default);
});

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": ME,
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

function queueOrganizations(rows: Row[]) {
  (selectByTable["organizations"] ??= []).push(rows);
}

function queueOrganizationUpdateReturning(rows: Row[]) {
  (updateReturningByTable["organizations"] ??= []).push(rows);
}

describe("GET /api/organizations/project-log-email-settings", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/organizations/project-log-email-settings");
    expect(res.status).toBe(401);
  });

  it("returns the platform default when no override is set", async () => {
    queueOrganizations([{ id: ORG_ID, failureThreshold: null }]);
    const res = await request(app)
      .get("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      organizationId: ORG_ID,
      failureThreshold: null,
      // No org override + no env var = the hard-coded default.
      effectiveThreshold: PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
      defaults: {
        envThreshold: null,
        hardcodedDefault: PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
        globalDefault: PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
      },
      bounds: {
        min: PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
        max: PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
      },
    });
  });

  it("returns the override when one is set and reflects it in effectiveThreshold", async () => {
    queueOrganizations([{ id: ORG_ID, failureThreshold: 7 }]);
    const res = await request(app)
      .get("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"));
    expect(res.status).toBe(200);
    expect(res.body.failureThreshold).toBe(7);
    expect(res.body.effectiveThreshold).toBe(7);
    // The defaults / bounds payload should still be present so the
    // UI can render the "platform default: N" hint and clamp its
    // input control without re-implementing the constants.
    expect(res.body.defaults).toEqual({
      envThreshold: null,
      hardcodedDefault: PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
      globalDefault: PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
    });
    expect(res.body.bounds).toEqual({
      min: PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
      max: PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
    });
  });

  it("includes the env-driven default when PROJECT_LOG_EMAIL_FAILURE_THRESHOLD is set", async () => {
    process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD = "9";
    try {
      queueOrganizations([{ id: ORG_ID, failureThreshold: null }]);
      const res = await request(app)
        .get("/api/organizations/project-log-email-settings")
        .set(authedHeaders("ADMIN"));
      expect(res.status).toBe(200);
      expect(res.body.failureThreshold).toBeNull();
      // No org override → effective should fall through to the env.
      expect(res.body.effectiveThreshold).toBe(9);
      expect(res.body.defaults.envThreshold).toBe(9);
      expect(res.body.defaults.globalDefault).toBe(9);
      expect(res.body.defaults.hardcodedDefault).toBe(
        PROJECT_LOG_EMAIL_FAILURE_DEFAULT_THRESHOLD,
      );
    } finally {
      delete process.env.PROJECT_LOG_EMAIL_FAILURE_THRESHOLD;
    }
  });

  it("returns 404 when the organization row is missing", async () => {
    queueOrganizations([]);
    const res = await request(app)
      .get("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"));
    expect(res.status).toBe(404);
  });

  // ----------------------------------------------------------
  // Role gating
  // ----------------------------------------------------------
  it("allows SUPERINTENDENT to GET the settings", async () => {
    queueOrganizations([{ id: ORG_ID, failureThreshold: null }]);
    const res = await request(app)
      .get("/api/organizations/project-log-email-settings")
      .set(authedHeaders("SUPERINTENDENT"));
    expect(res.status).toBe(200);
  });

  it("rejects FIELD_WORKER from GET with 403", async () => {
    const res = await request(app)
      .get("/api/organizations/project-log-email-settings")
      .set(authedHeaders("FIELD_WORKER"));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/organizations/project-log-email-settings", () => {
  it("requires auth", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .send({ threshold: 5 });
    expect(res.status).toBe(401);
  });

  it("rejects threshold = 0 with 400 (below MIN)", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: 0 });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("rejects threshold = 51 with 400 (above MAX)", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: 51 });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("rejects non-numeric threshold (\"abc\") with 400", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: "abc" });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("rejects fractional threshold (1.5) with 400", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: 1.5 });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("accepts threshold = null and writes the cleared override (200)", async () => {
    queueOrganizationUpdateReturning([
      { id: ORG_ID, failureThreshold: null },
    ]);
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: null });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      organizationId: ORG_ID,
      failureThreshold: null,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("organizations");
    expect((updates[0].values as Row).projectLogEmailFailureThreshold).toBeNull();
  });

  it("accepts a valid threshold and writes it (200)", async () => {
    queueOrganizationUpdateReturning([
      { id: ORG_ID, failureThreshold: 5 },
    ]);
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      organizationId: ORG_ID,
      failureThreshold: 5,
    });
    expect(updates).toHaveLength(1);
    expect((updates[0].values as Row).projectLogEmailFailureThreshold).toBe(5);
  });

  it("accepts MIN and MAX boundary values", async () => {
    for (const value of [
      PROJECT_LOG_EMAIL_FAILURE_MIN_THRESHOLD,
      PROJECT_LOG_EMAIL_FAILURE_MAX_THRESHOLD,
    ]) {
      updates.length = 0;
      queueOrganizationUpdateReturning([{ id: ORG_ID, failureThreshold: value }]);
      const res = await request(app)
        .put("/api/organizations/project-log-email-settings")
        .set(authedHeaders("ADMIN"))
        .send({ threshold: value });
      expect(res.status, `threshold=${value} should be accepted`).toBe(200);
      expect(res.body.failureThreshold).toBe(value);
      expect((updates[0].values as Row).projectLogEmailFailureThreshold).toBe(value);
    }
  });

  it("returns 404 when the organization row is missing", async () => {
    queueOrganizationUpdateReturning([]);
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("ADMIN"))
      .send({ threshold: 5 });
    expect(res.status).toBe(404);
  });

  // ----------------------------------------------------------
  // Role gating
  // ----------------------------------------------------------
  it("rejects SUPERINTENDENT PUT with 403 (read-only role for the threshold)", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("SUPERINTENDENT"))
      .send({ threshold: 5 });
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("rejects FIELD_WORKER PUT with 403", async () => {
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("FIELD_WORKER"))
      .send({ threshold: 5 });
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("allows MANAGER to PUT", async () => {
    queueOrganizationUpdateReturning([{ id: ORG_ID, failureThreshold: 4 }]);
    const res = await request(app)
      .put("/api/organizations/project-log-email-settings")
      .set(authedHeaders("MANAGER"))
      .send({ threshold: 4 });
    expect(res.status).toBe(200);
    expect(res.body.failureThreshold).toBe(4);
  });
});
