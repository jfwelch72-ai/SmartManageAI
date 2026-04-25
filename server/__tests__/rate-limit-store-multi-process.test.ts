/**
 * Task #1831 — multi-replica rate-limit regression test.
 *
 * The motivating bug: the old `sendNowLastInvocation` /
 * `testDigestLastInvocation` Maps lived at module scope inside
 * `server/projectLogEmailScheduleRoutes.ts`, so each Node replica had
 * its own private copy of the debounce state. A frantic admin clicking
 * "Send now" against a load balancer that round-robined to N pods
 * could fan out N sends — one per pod — instead of one. The fix
 * (Task #1831) moved the timestamp into a shared store that every
 * replica writes against.
 *
 * This test simulates two replicas WITHOUT spinning up a real Postgres:
 *   - We import the routes module twice, with `vi.resetModules()` in
 *     between, so the second import is a fresh module-level state
 *     (mimicking a second Node process). Each "replica" has its own
 *     Express app object.
 *   - We swap in the SAME `RateLimitStore` instance for both replicas
 *     before each import. That single store is the analogue of the
 *     production Postgres table that all pods share.
 *
 * The test then asserts that:
 *   1. A claim issued against replica A is observed by replica B
 *      (replica B returns 429 for a follow-up click within the
 *      window). With the old per-process Map this would have allowed
 *      both clicks through.
 *   2. The 429 carries a `Retry-After` header with a positive integer
 *      and the JSON body's `retryAfterSeconds` matches it — preserves
 *      the public 429 + Retry-After contract the front-end debouncer
 *      depends on.
 *   3. A different schedule id (different rate-limit key) is NOT
 *      blocked by the first claim — the shared store is correctly
 *      keyed.
 *   4. The same flow holds for the `/test-digest` route (per-org
 *      keying instead of per-schedule).
 *
 * Hermetic — db / email / pdf / notification-delivery are mocked the
 * same way the sibling per-route tests mock them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// db / email / helpers — mocked so the routes can run without Postgres.
// Both "replicas" share the same mocks because vi.mock is hoisted across
// module resets, so any later import of `../db` returns the same object.
// ---------------------------------------------------------------------------

const selectByTable: Record<string, Row[][]> = {};

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
  const settle = (
    resolve: (v: Row[]) => unknown,
    reject?: (e: unknown) => unknown,
  ) => {
    try {
      const queue = selectByTable[resolvedTable] ?? [];
      const next = queue.length ? queue.shift()! : [];
      return Promise.resolve(next).then(resolve, reject);
    } catch (err) {
      return reject ? reject(err) : Promise.reject(err);
    }
  };
  chain.then = settle;
  chain.catch = (reject: (e: unknown) => unknown) =>
    settle((v) => v, reject);
  return chain;
}

const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => makeSelectChain(),
  insert: (t: unknown) => {
    const table = tableName(t);
    return {
      values: (vals: Row | Row[]) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        const stamped = arr.map((v, i) => ({
          id: `${table}-insert-${i}`,
          ...v,
        }));
        const thenable: PromiseLike<unknown> & {
          returning: () => Promise<Row[]>;
        } = {
          returning: async () => stamped,
          then: (resolve, reject) =>
            Promise.resolve(undefined).then(resolve, reject),
        };
        return thenable;
      },
    };
  },
  update: (t: unknown) => {
    void tableName(t);
    return {
      set: () => ({
        where: async () => undefined,
      }),
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

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
}));

vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async () => true),
  sendEmailWithResult: vi.fn(async () => ({
    ok: true,
    recipientCount: 1,
  })),
}));

vi.mock("../services/projectLogService", () => ({
  buildProjectLogPdfBuffer: vi.fn(async () => Buffer.from("pdf")),
}));

// `processProjectLogEmailFailuresDigest` is the worker the test-digest
// route invokes. We stub it to a no-op success so the route reaches
// the rate-limit check without doing any real work.
vi.mock("../jobs/jobRunner", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../jobs/jobRunner",
  );
  return {
    ...actual,
    executeProjectLogEmailScheduleSend: vi.fn(async () => ({
      status: "SUCCESS",
      error: null,
      recipientCount: 1,
    })),
    processProjectLogEmailFailuresDigest: vi.fn(async () => ({
      perOrg: new Map([
        [
          "22222222-2222-2222-2222-222222222222",
          { notificationCount: 0, failingScheduleCount: 0, skipped: false },
        ],
      ]),
    })),
  };
});

function makeApp(routes: any): Express {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use(
    (req: Request & { user?: any }, _res: Response, next: NextFunction) => {
      const userId = req.header("x-test-user-id");
      const orgId = req.header("x-test-org-id");
      const role = req.header("x-test-role");
      if (userId && orgId && role) {
        req.user = { id: userId, organizationId: orgId, role };
      }
      next();
    },
  );
  app.use("/api", routes);
  return app;
}

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const SCHEDULE_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_SCHEDULE_ID = "44444444-4444-4444-4444-444444444444";

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": "user-1",
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

function queueProject(rows: Row[]) {
  (selectByTable["projects"] ??= []).push(rows);
}
function queueSchedules(rows: Row[]) {
  (selectByTable["project_log_email_schedules"] ??= []).push(rows);
}
function queueDistLists(rows: Row[]) {
  (selectByTable["project_email_distribution_lists"] ??= []).push(rows);
}

/**
 * Loads the routes module fresh (simulating a brand-new Node process)
 * AND wires it up to the supplied shared in-memory store. Returns an
 * Express app whose `/api/...` routes share state with any other app
 * created from the same `sharedStore`.
 */
async function loadReplica(sharedStore: any): Promise<Express> {
  vi.resetModules();
  const rateLimitStore = await import("../utils/rateLimitStore");
  // The store is the per-test object; both replicas point at the
  // same instance, mirroring how every production pod points at the
  // same Postgres `rate_limit_state` row.
  rateLimitStore.__setRateLimitStoreForTests(sharedStore);
  const mod = await import("../projectLogEmailScheduleRoutes");
  return makeApp(mod.default);
}

let sharedStore: any;
let replicaA: Express;
let replicaB: Express;

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];

  // Build the shared store once per test, then load two distinct
  // route module instances that both write into it. The first import
  // primes the rate-limit module cache; the second import reuses
  // that cache (vi.resetModules between them throws away the cached
  // *routes* module but we re-prime the rate-limit module each time
  // so both replicas end up bound to the same store object).
  const rateLimitStoreModule = await import("../utils/rateLimitStore");
  sharedStore = rateLimitStoreModule.createInMemoryRateLimitStore();
  await sharedStore.reset();

  replicaA = await loadReplica(sharedStore);
  replicaB = await loadReplica(sharedStore);
});

describe("rate-limit store — cross-replica behaviour (Task #1831)", () => {
  it("send-now: claim on replica A causes replica B to 429 within the window", async () => {
    // ---------- Replica A: full successful send ----------
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([
      {
        id: SCHEDULE_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastSentAt: null,
      },
    ]);
    // The mocked executeProjectLogEmailScheduleSend resolves immediately
    // so we don't need to queue the inner project / dist-list rows.
    queueSchedules([
      {
        id: SCHEDULE_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
        lastAttemptStatus: "SUCCESS",
      },
    ]);

    const aRes = await request(replicaA)
      .post(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/send-now`)
      .set(authedHeaders())
      .send({});
    expect(aRes.status).toBe(200);

    // ---------- Replica B: same schedule, immediate retry ----------
    // Replica B resolves the same project/schedule rows, so we have
    // to queue them again (selects come from the local in-process
    // dbMock, not from the shared store under test).
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([
      {
        id: SCHEDULE_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
      },
    ]);

    const bRes = await request(replicaB)
      .post(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/send-now`)
      .set(authedHeaders())
      .send({});

    // The whole point of Task #1831: replica B is a different Node
    // process and would have allowed the click through under the old
    // module-level Map. With the shared store it must 429.
    expect(bRes.status).toBe(429);
    // Retry-After contract is preserved: positive integer header AND
    // a matching numeric `retryAfterSeconds` field in the body.
    const retryAfterHeader = bRes.headers["retry-after"];
    expect(retryAfterHeader).toBeDefined();
    const headerSeconds = Number.parseInt(retryAfterHeader as string, 10);
    expect(Number.isFinite(headerSeconds)).toBe(true);
    expect(headerSeconds).toBeGreaterThan(0);
    expect(bRes.body.retryAfterSeconds).toBe(headerSeconds);
  });

  it("send-now: a different schedule id on replica B is NOT blocked by replica A's claim", async () => {
    // Confirms the shared-store key prefix correctly scopes the
    // limiter per-schedule. Otherwise we'd be regressing into a
    // global "one send per 30s across the whole org" limit, which
    // would block legitimate concurrent sends across different
    // projects on a busy GC.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([
      {
        id: SCHEDULE_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "RFI",
        cadence: "WEEKLY",
      },
    ]);
    queueSchedules([{ id: SCHEDULE_ID, lastAttemptStatus: "SUCCESS" }]);

    const aRes = await request(replicaA)
      .post(`/api/projects/${PROJECT_ID}/log-email-schedules/RFI/send-now`)
      .set(authedHeaders())
      .send({});
    expect(aRes.status).toBe(200);

    // Replica B clicks for a *different* schedule (different id +
    // different log type). This must succeed.
    queueProject([{ id: PROJECT_ID, gcOrganizationId: ORG_ID }]);
    queueSchedules([
      {
        id: OTHER_SCHEDULE_ID,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        logType: "SUBMITTAL",
        cadence: "WEEKLY",
      },
    ]);
    queueSchedules([
      { id: OTHER_SCHEDULE_ID, lastAttemptStatus: "SUCCESS" },
    ]);

    const bRes = await request(replicaB)
      .post(
        `/api/projects/${PROJECT_ID}/log-email-schedules/SUBMITTAL/send-now`,
      )
      .set(authedHeaders())
      .send({});
    expect(bRes.status).toBe(200);
  });

  it("test-digest: claim on replica A causes replica B to 429 within the window", async () => {
    // Same regression coverage for the per-org test-digest debounce.
    // Two SUPER_ADMINs in the same org clicking against different
    // pods used to fan out two duplicate test digests; with the
    // shared store the second one bounces.
    const aRes = await request(replicaA)
      .post("/api/organizations/project-log-email-settings/test-digest")
      .set(authedHeaders("SUPER_ADMIN"))
      .send({});
    expect(aRes.status).toBe(200);

    const bRes = await request(replicaB)
      .post("/api/organizations/project-log-email-settings/test-digest")
      .set(authedHeaders("SUPER_ADMIN"))
      .send({});
    expect(bRes.status).toBe(429);
    expect(bRes.headers["retry-after"]).toBeDefined();
    expect(bRes.body.retryAfterSeconds).toBeGreaterThan(0);
  });
});
