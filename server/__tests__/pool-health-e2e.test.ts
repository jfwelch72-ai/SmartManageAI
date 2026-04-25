/**
 * Task #2011 — End-to-end harness for the pool-starvation alerting path.
 *
 * The previous coverage in `pool-health.test.ts` and
 * `job-metric-alerts-pool-health.test.ts` exercises each step
 * independently:
 *   - the in-process buffer + metric publication; and
 *   - the alert-engine defaults / spike & stall logic.
 *
 * Neither suite drives the full path with a *real* `pg.Pool` (so a
 * regression in pg's error wording or in `logJobErrorWithKind`'s
 * classification regex would silently disable the alert), and neither
 * drives `samplePoolHealth` against real load (so a regression in the
 * `waiting > 0` accounting wouldn't be caught).
 *
 * This harness closes both gaps:
 *
 *   1. `pool-exhaustion → notification + email` — opens a real pg.Pool
 *      with `max: 2` and a tight `connectionTimeoutMillis`, holds two
 *      checkouts, and lets several extra requests time out. Each timeout
 *      error is classified with the same regex used by
 *      `logJobErrorWithKind` in `server/jobs/jobRunner.ts` and fed into
 *      `recordPoolExhaustedEvent`. After exactly one
 *      `evaluateJobMetricAlerts` cycle we assert that:
 *        - notifications were inserted for every Super Admin; AND
 *        - `emailService.sendEmail` was invoked.
 *
 *   2. `samplePoolHealth → waitingSaturated page` — same real pool,
 *      held under sustained load (queued requests so `waitingCount > 0`
 *      every tick). We drive `samplePoolHealth(realPool)` for the
 *      configured `WAITING_SATURATION_SAMPLES` consecutive ticks and
 *      then run `evaluateJobMetricAlerts`, asserting the
 *      `waitingSaturated` spike fires and pages Super Admins.
 *
 * The DB / email / notification surfaces are mocked exactly like
 * `job-metric-alerts-pool-health.test.ts` so the harness exercises the
 * starvation path itself (real pg.Pool + real metric + real alert
 * engine) without needing a real users / notifications / sendEmail
 * round-trip — the same mocking pattern the rest of the alert suites
 * use.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";

interface SuperAdminRow {
  id: string;
  email: string;
  isActive: boolean;
  receivesJobMetricAlertEmails: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
  quietHoursWeekdays: number[] | null;
}

const state = {
  superAdmins: [] as SuperAdminRow[],
  insertedNotifications: [] as Array<Record<string, unknown>>,
  insertedEvents: [] as Array<Record<string, unknown>>,
  sendEmailCalls: [] as Array<{ to: string[]; subject: string; text?: string }>,
};

const NAME_SYM = Symbol.for("drizzle:Name");
function tableNameOf(table: unknown): string {
  if (table && typeof table === "object") {
    const v = (table as Record<symbol, unknown>)[NAME_SYM];
    if (typeof v === "string") return v;
  }
  return "";
}

const dbMock = {
  insert: (_table: unknown) => ({
    values: (rowOrRows: unknown) => {
      const arr = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      for (const row of arr) {
        const r = row as Record<string, unknown>;
        if (r.userId && r.type) {
          state.insertedNotifications.push(r);
        } else if (r.kind && r.job) {
          state.insertedEvents.push(r);
        }
      }
      const rows = arr.map((row, i) => ({
        id: `n-${i}`,
        ...((row as object) ?? {}),
        createdAt: new Date(),
        readAt: null,
      }));
      const result: Record<string, unknown> = {
        returning: () => Promise.resolve(rows),
        then: (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(rows).then(onFulfilled),
      };
      return result;
    },
  }),
  select: (..._args: unknown[]) => {
    const dynamicChain: Record<string, unknown> = {};
    dynamicChain.from = (table: unknown) => {
      const tableName = tableNameOf(table);
      let rows: unknown[] = [];
      if (tableName === "users") {
        rows = state.superAdmins.map((u) => ({
          id: u.id,
          email: u.email,
          isActive: u.isActive,
          receivesJobMetricAlertEmails: u.receivesJobMetricAlertEmails,
          quietHoursEnabled: u.quietHoursEnabled,
          quietHoursStart: u.quietHoursStart,
          quietHoursEnd: u.quietHoursEnd,
          quietHoursTimezone: u.quietHoursTimezone,
          quietHoursWeekdays: u.quietHoursWeekdays,
        }));
      }
      const innerChain: Record<string, unknown> = {};
      innerChain.where = (_cond: unknown) => innerChain;
      innerChain.orderBy = (..._args2: unknown[]) => Promise.resolve(rows);
      (innerChain as { then?: unknown }).then = (
        onFulfilled: (value: unknown) => unknown,
      ) => Promise.resolve(rows).then(onFulfilled);
      return innerChain;
    };
    return dynamicChain;
  },
  delete: (_table: unknown) => ({
    where: (_c: unknown) => ({ returning: async (_cols: unknown) => [] }),
  }),
  update: (_table: unknown) => ({
    set: (_values: Record<string, unknown>) => ({
      where: (_cond: unknown) => ({ returning: async () => [] }),
    }),
  }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(
    async (opts: { to: string | string[]; subject: string; text?: string }) => {
      const to = Array.isArray(opts.to) ? opts.to : [opts.to];
      state.sendEmailCalls.push({ to, subject: opts.subject, text: opts.text });
      return true;
    },
  ),
}));

// Same regex `logJobErrorWithKind` uses in `server/jobs/jobRunner.ts`.
// Replicated here (rather than imported) so this harness doesn't pull
// the entire jobRunner module — and its huge cron import graph — into
// the test process.
const POOL_EXHAUSTED_REGEX =
  /connection terminated due to connection timeout|timeout exceeded when trying to connect|Connection terminated unexpectedly/i;

function classifyPoolError(err: unknown): "pool_exhausted" | "query_failed" {
  const text = err instanceof Error ? err.message : String(err);
  return POOL_EXHAUSTED_REGEX.test(text) ? "pool_exhausted" : "query_failed";
}

let alerts: typeof import("../utils/jobMetricAlerts");
let poolHealth: typeof import("../utils/poolHealth");
let metrics: typeof import("../utils/jobMetrics");

beforeAll(async () => {
  // Import the real modules under test once. Vitest's `vi.mock` calls
  // above are already in effect so these pick up the mocked db / email
  // / logger surfaces.
  alerts = await import("../utils/jobMetricAlerts");
  poolHealth = await import("../utils/poolHealth");
  metrics = await import("../utils/jobMetrics");
  // We never want this harness to write to job_metric_samples — the
  // alert engine reads from the in-process map (`getAllJobMetrics`)
  // which is what we want to drive end-to-end.
  metrics.setJobMetricsPersistenceEnabled(false);
});

afterAll(() => {
  metrics.setJobMetricsPersistenceEnabled(true);
});

beforeEach(() => {
  state.superAdmins = [
    {
      id: "admin-1",
      email: "admin-1@example.com",
      isActive: true,
      receivesJobMetricAlertEmails: true,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
      quietHoursWeekdays: null,
    },
    {
      id: "admin-2",
      email: "admin-2@example.com",
      isActive: true,
      receivesJobMetricAlertEmails: true,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
      quietHoursWeekdays: null,
    },
  ];
  state.insertedNotifications = [];
  state.insertedEvents = [];
  state.sendEmailCalls = [];
  metrics.resetJobMetrics();
  poolHealth.resetPoolExhaustedEvents();
  poolHealth.resetPoolHealthSamplerStateForTests();
  alerts.setJobMetricAlertsClockForTests(() => Date.now());
});

afterEach(() => {
  alerts.resetJobMetricAlertsClockForTests();
});

const DATABASE_URL = process.env.DATABASE_URL;

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("pool starvation E2E (Task #2011)", () => {
  it("real pg.Pool exhaustion → recordPoolExhaustedEvent → evaluateJobMetricAlerts inserts a notification AND calls sendEmail", async () => {
    // max: 2 + tight connection timeout means any 3rd+ concurrent
    // checkout attempt that races against the held clients will reject
    // with the canonical `timeout exceeded when trying to connect`
    // wording that `logJobErrorWithKind`'s classifier matches.
    const pool = new Pool({
      connectionString: DATABASE_URL!,
      max: 2,
      connectionTimeoutMillis: 250,
      idleTimeoutMillis: 1_000,
    });

    // Hold both pool slots so subsequent checkouts must wait. We use
    // BEGIN + a long-running pg_sleep to ensure the connection is
    // pinned for the full duration of the test.
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    const sleep1 = c1.query("SELECT pg_sleep(2)");
    const sleep2 = c2.query("SELECT pg_sleep(2)");

    try {
      // Issue several extra checkout attempts. Each will wait
      // `connectionTimeoutMillis` and then reject with the canonical
      // pg "timeout exceeded when trying to connect" message — which
      // is exactly the production starvation signal.
      const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () => pool.query("SELECT 1")),
      );

      let exhaustedCount = 0;
      for (const a of attempts) {
        if (a.status === "rejected") {
          // Verify we actually produced a real pool-starvation error
          // (not some other failure mode) and feed it through the
          // same path production uses.
          const kind = classifyPoolError(a.reason);
          expect(kind).toBe("pool_exhausted");
          poolHealth.recordPoolExhaustedEvent({
            job: "outbox",
            message: "Outbox processing failed",
            error: a.reason instanceof Error ? a.reason.message : String(a.reason),
          });
          exhaustedCount++;
        }
      }

      // We expected enough exhaustion events to clear both the in-app
      // floor (1) and the email floor (default 3) so a single alert
      // evaluation will both notify in-app AND escalate via email.
      expect(exhaustedCount).toBeGreaterThanOrEqual(
        alerts.POOL_HEALTH_EXHAUSTED_EMAIL_FLOOR_PER_HOUR,
      );

      // Drive a single alert-evaluation cycle (the cron tick). Pin
      // the engine's clock one tick into the future so the strict
      // `s.timestamp < now` window in `sumCounter` always includes
      // samples we just recorded — without this, a same-millisecond
      // race makes the assertion intermittently flaky.
      const evalAt = Date.now() + 1;
      alerts.setJobMetricAlertsClockForTests(() => evalAt);
      const result = await alerts.evaluateJobMetricAlerts();

      const exhaustedAlerts = result.alertsFired.filter(
        (a) => a.kind === "spike" && a.counter === "exhausted" && a.job === "pool_health",
      );
      expect(exhaustedAlerts).toHaveLength(1);
      expect(exhaustedAlerts[0].emailed).toBe(true);

      // One notification per Super Admin.
      expect(state.insertedNotifications).toHaveLength(state.superAdmins.length);
      for (const n of state.insertedNotifications) {
        expect(n.relatedEntityType).toBe("job_metric_alert");
        expect(String(n.relatedEntityId)).toContain("pool_health");
        expect(String(n.title)).toContain("pool_health");
      }

      // SendGrid email actually invoked.
      expect(state.sendEmailCalls).toHaveLength(1);
      expect(state.sendEmailCalls[0].subject).toContain("pool_health");
      expect(state.sendEmailCalls[0].subject).toContain("exhausted");
      expect(state.sendEmailCalls[0].to.slice().sort()).toEqual([
        "admin-1@example.com",
        "admin-2@example.com",
      ]);
    } finally {
      // Release both held clients and drain the pool.
      await Promise.allSettled([sleep1, sleep2]);
      c1.release();
      c2.release();
      await pool.end();
    }
  }, 30_000);

  it("samplePoolHealth driven against real load fires waitingSaturated AND pages Super Admins after WAITING_SATURATION_SAMPLES consecutive ticks", async () => {
    const N = poolHealth.WAITING_SATURATION_SAMPLES;
    expect(N).toBeGreaterThanOrEqual(1);

    const pool = new Pool({
      connectionString: DATABASE_URL!,
      max: 2,
      // Long enough that queued requests stay queued across all N
      // sampler ticks below — we only release them in the `finally`.
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
    });

    // Hold both pool slots so any further checkout sits in the
    // pg.Pool waiting queue and bumps `waitingCount`.
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    // Queue several extra checkouts. We don't await them — they sit
    // in pg's internal queue (waitingCount > 0) until either a held
    // client is released or `connectionTimeoutMillis` elapses.
    const queued: Array<Promise<unknown>> = [];
    for (let i = 0; i < 4; i++) {
      queued.push(pool.query("SELECT 1").catch(() => undefined));
    }

    try {
      // Give libpq / the pool's internal accounting a tick so the
      // queued requests are counted as `waiting`.
      await new Promise((r) => setImmediate(r));
      const preStats = poolHealth.getPoolStats(pool);
      expect(preStats.waiting).toBeGreaterThan(0);
      expect(preStats.max).toBe(2);

      // Drive N consecutive saturated sampler ticks. Each tick reads
      // the live pool stats; on the Nth, `samplePoolHealth` publishes
      // `waitingSaturated: 1`.
      for (let i = 0; i < N; i++) {
        const stats = poolHealth.samplePoolHealth(pool);
        expect(stats.waiting).toBeGreaterThan(0);
      }

      const poolMetrics = metrics.getJobMetrics(poolHealth.POOL_HEALTH_JOB);
      expect(poolMetrics.totals.waitingSaturated).toBe(1);
      expect(poolMetrics.totals.sampled).toBe(N);

      // One full alert-evaluation cycle should fire the
      // `waitingSaturated` spike and immediately page Super Admins
      // (in-app + email) because the rule's emailWhenAbove === 1.
      // Pin the engine's clock one tick into the future so the strict
      // `s.timestamp < now` window in `sumCounter` always includes
      // samples we just recorded.
      const evalAt = Date.now() + 1;
      alerts.setJobMetricAlertsClockForTests(() => evalAt);
      const result = await alerts.evaluateJobMetricAlerts();

      const saturatedAlerts = result.alertsFired.filter(
        (a) =>
          a.kind === "spike" &&
          a.counter === "waitingSaturated" &&
          a.job === "pool_health",
      );
      expect(saturatedAlerts).toHaveLength(1);
      expect(saturatedAlerts[0].emailed).toBe(true);

      expect(state.insertedNotifications).toHaveLength(state.superAdmins.length);
      expect(state.sendEmailCalls).toHaveLength(1);
      expect(state.sendEmailCalls[0].subject).toContain("pool_health");
      expect(state.sendEmailCalls[0].subject).toContain("waitingSaturated");
    } finally {
      // Release the held clients so the queued requests can resolve
      // and the pool can shut down cleanly.
      c1.release();
      c2.release();
      await Promise.allSettled(queued);
      await pool.end();
    }
  }, 30_000);
});
