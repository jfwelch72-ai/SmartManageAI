/**
 * Task #1495 — API tests for the Job Metrics dashboard's wage-refresh
 * alert threshold editor.
 *
 * The editor (WageRefreshAlertThresholdsCard in
 * client/src/pages/JobMetricsHealth.tsx) upserts rows into
 * `job_metric_alert_rules` via POST /api/admin/metrics/jobs/alerts/rules
 * and reverts to the built-in default via
 * DELETE /api/admin/metrics/jobs/alerts/rules/:id. These rows directly
 * drive Super Admin paging behavior, so silent regressions in the
 * route's payload validation, the upsert wiring, or the delete-flow
 * are exactly what this suite is designed to catch.
 *
 * Task #1540 — the production routes were extracted into
 * `server/jobMetricAlertRulesRoutes.ts`, so this suite now imports the
 * real router (with its real Zod schema) and mounts it behind a tiny
 * auth shim. No more copy/pasted schema literal.
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

vi.mock("../auth", async () => {
  const actual = await vi.importActual<typeof import("../auth")>("../auth");
  const passthrough = (
    req: Request & { user?: any },
    _res: Response,
    next: NextFunction,
  ) => {
    req.user = { id: "test-super-admin", role: "SUPER_ADMIN" };
    next();
  };
  return {
    ...actual,
    requireAuth: passthrough,
    requireRole: () => passthrough,
  };
});

vi.mock("../auditLogger", async () => {
  const actual = await vi.importActual<typeof import("../auditLogger")>(
    "../auditLogger",
  );
  return {
    ...actual,
    logAudit: vi.fn(async () => {}),
  };
});

import {
  upsertJobMetricAlertRule,
  DEFAULT_SPIKE_MIN_ABSOLUTE,
  DEFAULT_DEDUPE_MINUTES,
} from "../utils/jobMetricAlerts";
import jobMetricAlertRulesRoutes, {
  upsertJobMetricAlertRuleSchema,
} from "../jobMetricAlertRulesRoutes";

// Constants the WageRefreshAlertThresholdsCard sends with every payload.
// Mirrors client/src/pages/JobMetricsHealth.tsx.
const WAGE_REFRESH_JOB = "wage_decision_stale_refresh";
const WAGE_REFRESH_SPIKE_COUNTER = "failed";

let app: Express;
let db: typeof import("../db").db;

function buildApp(): Express {
  const a = express();
  a.use(express.json());
  a.use("/api", jobMetricAlertRulesRoutes);
  return a;
}

async function cleanup() {
  await db.execute(sql`
    DELETE FROM "job_metric_alert_rules"
    WHERE job = ${WAGE_REFRESH_JOB}
  `);
}

beforeAll(async () => {
  ({ db } = await import("../db"));
  app = buildApp();
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("upsertJobMetricAlertRuleSchema — exported contract (Task #1540)", () => {
  it("accepts a minimal wage-refresh stall payload", () => {
    const parsed = upsertJobMetricAlertRuleSchema.parse({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: 36,
    });
    expect(parsed.job).toBe(WAGE_REFRESH_JOB);
    expect(parsed.kind).toBe("stall");
    expect(parsed.threshold).toBe(36);
  });

  it("rejects an unknown kind at the schema level", () => {
    expect(() =>
      upsertJobMetricAlertRuleSchema.parse({
        job: WAGE_REFRESH_JOB,
        counter: null,
        kind: "blowup",
        threshold: 4,
      }),
    ).toThrow();
  });
});

describe("POST /api/admin/metrics/jobs/alerts/rules — wage refresh stall (Task #1495)", () => {
  it("inserts a stall override with the editor's payload shape", async () => {
    const res = await request(app)
      .post("/api/admin/metrics/jobs/alerts/rules")
      .send({
        job: WAGE_REFRESH_JOB,
        counter: null,
        kind: "stall",
        threshold: 48,
        emailWhenAbove: 60,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.job).toBe(WAGE_REFRESH_JOB);
    expect(res.body.kind).toBe("stall");
    // counter is forced to null for stall by upsertJobMetricAlertRule.
    expect(res.body.counter).toBeNull();
    expect(Number(res.body.threshold)).toBe(48);
    expect(Number(res.body.emailWhenAbove)).toBe(60);
    expect(res.body.minAbsolute).toBe(0);
    expect(res.body.dedupeMinutes).toBe(DEFAULT_DEDUPE_MINUTES);
    expect(res.body.enabled).toBe(true);

    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS c FROM "job_metric_alert_rules"
      WHERE job = ${WAGE_REFRESH_JOB} AND kind = 'stall'
    `);
    expect((rows[0] as { c: number }).c).toBe(1);
  });

  it("updates an existing stall override when an id is provided", async () => {
    const created = await upsertJobMetricAlertRule({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: 36,
    });

    const res = await request(app)
      .post("/api/admin/metrics/jobs/alerts/rules")
      .send({
        id: created.id,
        job: WAGE_REFRESH_JOB,
        counter: null,
        kind: "stall",
        threshold: 12,
        emailWhenAbove: null,
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
    expect(Number(res.body.threshold)).toBe(12);
    expect(res.body.emailWhenAbove).toBeNull();

    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS c FROM "job_metric_alert_rules"
      WHERE job = ${WAGE_REFRESH_JOB} AND kind = 'stall'
    `);
    expect((rows[0] as { c: number }).c).toBe(1);
  });
});

describe("POST /api/admin/metrics/jobs/alerts/rules — wage refresh spike (Task #1495)", () => {
  it("inserts a spike override on the `failed` counter with editor payload", async () => {
    const res = await request(app)
      .post("/api/admin/metrics/jobs/alerts/rules")
      .send({
        job: WAGE_REFRESH_JOB,
        counter: WAGE_REFRESH_SPIKE_COUNTER,
        kind: "spike",
        threshold: 5,
        minAbsolute: 7,
        emailWhenAbove: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body.job).toBe(WAGE_REFRESH_JOB);
    expect(res.body.counter).toBe(WAGE_REFRESH_SPIKE_COUNTER);
    expect(res.body.kind).toBe("spike");
    expect(Number(res.body.threshold)).toBe(5);
    expect(res.body.minAbsolute).toBe(7);
    expect(Number(res.body.emailWhenAbove)).toBe(10);
  });

  it("falls back to the engine default minAbsolute when omitted", async () => {
    const res = await request(app)
      .post("/api/admin/metrics/jobs/alerts/rules")
      .send({
        job: WAGE_REFRESH_JOB,
        counter: WAGE_REFRESH_SPIKE_COUNTER,
        kind: "spike",
        threshold: 3.5,
      });

    expect(res.status).toBe(200);
    expect(res.body.minAbsolute).toBe(DEFAULT_SPIKE_MIN_ABSOLUTE);
    expect(res.body.emailWhenAbove).toBeNull();
  });
});

describe("POST /api/admin/metrics/jobs/alerts/rules — validation (Task #1495)", () => {
  async function expectRejected(payload: Record<string, unknown>) {
    const res = await request(app)
      .post("/api/admin/metrics/jobs/alerts/rules")
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
    expect(Array.isArray(res.body.details)).toBe(true);

    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS c FROM "job_metric_alert_rules"
      WHERE job = ${WAGE_REFRESH_JOB}
    `);
    expect((rows[0] as { c: number }).c).toBe(0);
  }

  it("rejects a non-positive threshold", async () => {
    await expectRejected({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: 0,
    });
    await expectRejected({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: -4,
    });
  });

  it("rejects a non-numeric threshold", async () => {
    await expectRejected({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: "ten",
    });
  });

  it("rejects an unknown kind (only spike/stall allowed)", async () => {
    await expectRejected({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "blowup",
      threshold: 4,
    });
  });

  it("rejects a missing job name", async () => {
    await expectRejected({
      counter: null,
      kind: "stall",
      threshold: 4,
    });
    await expectRejected({
      job: "",
      counter: null,
      kind: "stall",
      threshold: 4,
    });
  });

  it("rejects an oversized threshold", async () => {
    await expectRejected({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: 100_001,
    });
  });

  it("rejects a non-positive emailWhenAbove (UI guards but API must too)", async () => {
    await expectRejected({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: 36,
      emailWhenAbove: 0,
    });
  });
});

describe("DELETE /api/admin/metrics/jobs/alerts/rules/:id — reset to default (Task #1495)", () => {
  it("removes the wage refresh stall override and reports the deleted id", async () => {
    const created = await upsertJobMetricAlertRule({
      job: WAGE_REFRESH_JOB,
      counter: null,
      kind: "stall",
      threshold: 48,
    });

    const res = await request(app).delete(
      `/api/admin/metrics/jobs/alerts/rules/${created.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: created.id });

    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS c FROM "job_metric_alert_rules"
      WHERE id = ${created.id}
    `);
    expect((rows[0] as { c: number }).c).toBe(0);
  });

  it("removes the wage refresh spike override on the failed counter", async () => {
    const created = await upsertJobMetricAlertRule({
      job: WAGE_REFRESH_JOB,
      counter: WAGE_REFRESH_SPIKE_COUNTER,
      kind: "spike",
      threshold: 5,
      minAbsolute: 7,
    });

    const res = await request(app).delete(
      `/api/admin/metrics/jobs/alerts/rules/${created.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(created.id);

    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS c FROM "job_metric_alert_rules"
      WHERE job = ${WAGE_REFRESH_JOB}
    `);
    expect((rows[0] as { c: number }).c).toBe(0);
  });

  it("returns 404 when the rule does not exist", async () => {
    const res = await request(app).delete(
      "/api/admin/metrics/jobs/alerts/rules/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
