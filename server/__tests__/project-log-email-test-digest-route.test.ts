/**
 * Task #1750 — tests for the admin "Send test digest now" endpoint:
 *
 *   POST /api/organizations/project-log-email-settings/test-digest
 *
 * The endpoint is a thin wrapper around `processProjectLogEmailFailuresDigest`
 * with three opt-in escape hatches (`organizationIds`, `bypassScheduleGate`,
 * `dedupeKeyOverride`) so admins can trigger an immediate test send
 * without waiting for the cron tick or stomping on the same day's real
 * digest. The tests below mock the worker so we can assert the request
 * shape (especially the `bypassScheduleGate: true` flag and the unique
 * `dedupeKeyOverride`) and the outward-facing behavior:
 *
 *   - Auth / role gating (ADMIN + SUPER_ADMIN only; MANAGER /
 *     SUPERINTENDENT / FIELD_WORKER all 403).
 *   - Worker-result mapping for the success, NO_FAILURES, NO_ADMINS,
 *     and ITERATION_FAILED skip paths (note: CADENCE_OFF cannot reach
 *     the route — the worker is invoked with `bypassScheduleGate: true`
 *     which short-circuits the OFF check on this code path).
 *   - Per-org 30s rate limit (second click within the window comes back
 *     as 429 with a Retry-After hint).
 *
 * The mock for `processProjectLogEmailFailuresDigest` lives next to the
 * `vi.mock("../db", …)` shim already used by the sibling routes tests
 * so the test stays hermetic — no Postgres bootstrap needed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

type Row = Record<string, unknown>;

// Capture every call made to the worker so the assertions can verify
// the request shape (especially `bypassScheduleGate: true` and the
// `dedupeKeyOverride` we generate per-click).
type WorkerCall = {
  organizationIds?: string[];
  bypassScheduleGate?: boolean;
  dedupeKeyOverride?: string;
};
const workerCalls: WorkerCall[] = [];

// Each test sets `nextWorkerResult` to control what the mocked worker
// returns. The default is the "happy path" — one notification fanned
// out for one failing schedule.
type PerOrgEntry = {
  notificationCount: number;
  failingScheduleCount: number;
  skipped?: boolean;
  reason?: string;
};
let nextWorkerResult: { perOrg: Map<string, PerOrgEntry> } = {
  perOrg: new Map([[
    "22222222-2222-2222-2222-222222222222",
    { notificationCount: 2, failingScheduleCount: 3, skipped: false },
  ]]),
};

vi.mock("../jobs/jobRunner", () => ({
  // The route only calls processProjectLogEmailFailuresDigest. Re-export
  // the bare set of names the route imports so the import resolver is
  // satisfied without dragging the rest of the cron in.
  processProjectLogEmailFailuresDigest: vi.fn(async (opts: WorkerCall) => {
    workerCalls.push(opts);
    return nextWorkerResult;
  }),
}));

// Minimal db mock — the route only hits the worker, but the routes
// module wires up unrelated handlers that probe the db at import-time.
const dbMock = {
  execute: async () => ({ rows: [] }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([] as Row[]),
        orderBy: () => Promise.resolve([] as Row[]),
        then: (resolve: (v: Row[]) => unknown) => Promise.resolve([]).then(resolve),
      }),
      then: (resolve: (v: Row[]) => unknown) => Promise.resolve([]).then(resolve),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: async () => [],
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        returning: async () => [],
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      }),
    }),
  }),
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
let resetDebounce: () => void;

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const URL = "/api/organizations/project-log-email-settings/test-digest";

beforeEach(async () => {
  workerCalls.length = 0;
  // Reset to the happy path each test — individual cases override.
  nextWorkerResult = {
    perOrg: new Map([[
      ORG_ID,
      { notificationCount: 2, failingScheduleCount: 3, skipped: false },
    ]]),
  };
  vi.resetModules();
  // Task #1831 — install an in-memory rate-limit store before the
  // routes module loads so the new `consumeRateLimit` helper doesn't
  // try to issue real `INSERT ... ON CONFLICT` statements through
  // the dbMock above (which only knows how to return `{ rows: [] }`
  // and would therefore make every claim succeed, breaking the 429
  // rate-limit test below). Importing the rate-limit module here
  // primes the cache; the routes module then reuses the same module
  // instance and so picks up the in-memory store automatically.
  const rateLimitStore = await import("../utils/rateLimitStore");
  rateLimitStore.__setRateLimitStoreForTests(
    rateLimitStore.createInMemoryRateLimitStore(),
  );
  const mod = await import("../projectLogEmailScheduleRoutes");
  app = makeApp(mod.default);
  // Wipe the rate-limit store so each test starts from a clean
  // slate. Without this the second test in a row would see the first
  // test's clock and 429 unexpectedly.
  resetDebounce = (mod as any).__resetTestDigestDebounceForTests;
  await resetDebounce?.();
});

function authedHeaders(role = "ADMIN") {
  return {
    "x-test-user-id": ME,
    "x-test-org-id": ORG_ID,
    "x-test-role": role,
  };
}

describe("POST /api/organizations/project-log-email-settings/test-digest", () => {
  it("requires auth", async () => {
    const res = await request(app).post(URL);
    expect(res.status).toBe(401);
    expect(workerCalls).toHaveLength(0);
  });

  it("rejects MANAGER with 403 (ADMIN/SUPER_ADMIN only)", async () => {
    const res = await request(app).post(URL).set(authedHeaders("MANAGER"));
    expect(res.status).toBe(403);
    expect(workerCalls).toHaveLength(0);
  });

  it("rejects SUPERINTENDENT with 403", async () => {
    const res = await request(app).post(URL).set(authedHeaders("SUPERINTENDENT"));
    expect(res.status).toBe(403);
    expect(workerCalls).toHaveLength(0);
  });

  it("rejects FIELD_WORKER with 403", async () => {
    const res = await request(app).post(URL).set(authedHeaders("FIELD_WORKER"));
    expect(res.status).toBe(403);
    expect(workerCalls).toHaveLength(0);
  });

  it("allows SUPER_ADMIN to trigger the test send", async () => {
    const res = await request(app).post(URL).set(authedHeaders("SUPER_ADMIN"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      recipientCount: 2,
      failingScheduleCount: 3,
      skipped: false,
    });
    expect(workerCalls).toHaveLength(1);
  });

  it("invokes the worker with bypassScheduleGate=true and a unique dedupeKeyOverride", async () => {
    const res = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(res.status).toBe(200);
    expect(workerCalls).toHaveLength(1);
    expect(workerCalls[0].organizationIds).toEqual([ORG_ID]);
    expect(workerCalls[0].bypassScheduleGate).toBe(true);
    // The dedupe key must be unique-per-click and identifiable as a
    // test send so it can't collide with the real cron's key.
    expect(typeof workerCalls[0].dedupeKeyOverride).toBe("string");
    expect(workerCalls[0].dedupeKeyOverride!.startsWith("test-")).toBe(true);
    expect(workerCalls[0].dedupeKeyOverride!.includes(ME)).toBe(true);
  });

  it("returns recipientCount and failingScheduleCount on the success path", async () => {
    nextWorkerResult = {
      perOrg: new Map([[
        ORG_ID,
        { notificationCount: 5, failingScheduleCount: 7, skipped: false },
      ]]),
    };
    const res = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      recipientCount: 5,
      failingScheduleCount: 7,
      skipped: false,
    });
  });

  it("returns 200 with skipped=true / NO_FAILURES when nothing is failing", async () => {
    nextWorkerResult = {
      perOrg: new Map([[
        ORG_ID,
        { notificationCount: 0, failingScheduleCount: 0, skipped: true, reason: "NO_FAILURES" },
      ]]),
    };
    const res = await request(app).post(URL).set(authedHeaders("ADMIN"));
    // Healthy state isn't an error — surface as 200 so the toast can
    // celebrate rather than alarm.
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(res.body.reason).toBe("NO_FAILURES");
    expect(res.body.recipientCount).toBe(0);
    expect(typeof res.body.message).toBe("string");
  });

  it("succeeds even when the digest cadence is OFF (worker bypasses OFF on test sends)", async () => {
    // Task #1750 deliberately routes test sends through the worker
    // with `bypassScheduleGate: true`, which short-circuits the
    // cadence === "OFF" check. So a paused org can still verify the
    // recipient list via the button. The route therefore should
    // never see a CADENCE_OFF skip on this path; instead it just
    // sees a normal fan-out summary.
    nextWorkerResult = {
      perOrg: new Map([[
        ORG_ID,
        { notificationCount: 2, failingScheduleCount: 1, skipped: false, reason: undefined },
      ]]),
    };
    const res = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(false);
    expect(res.body.recipientCount).toBe(2);
    // Confirm we're actually asking the worker to bypass OFF.
    expect(workerCalls[0]?.bypassScheduleGate).toBe(true);
  });

  it("returns 409 / NO_ADMINS when no admin is configured", async () => {
    nextWorkerResult = {
      perOrg: new Map([[
        ORG_ID,
        { notificationCount: 0, failingScheduleCount: 4, skipped: true, reason: "NO_ADMINS" },
      ]]),
    };
    const res = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("NO_ADMINS");
  });

  it("returns 500 when the worker reports ITERATION_FAILED", async () => {
    nextWorkerResult = {
      perOrg: new Map([[
        ORG_ID,
        { notificationCount: 0, failingScheduleCount: 0, skipped: true, reason: "ITERATION_FAILED" },
      ]]),
    };
    const res = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(res.status).toBe(500);
    expect(res.body.reason).toBe("ITERATION_FAILED");
  });

  it("rate-limits a second click within 30s with 429 + Retry-After", async () => {
    const first = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(first.status).toBe(200);
    const second = await request(app).post(URL).set(authedHeaders("ADMIN"));
    expect(second.status).toBe(429);
    // Retry-After should be a positive integer string per RFC 7231.
    const retry = second.header["retry-after"];
    expect(retry).toBeDefined();
    expect(Number(retry)).toBeGreaterThan(0);
    expect(Number(retry)).toBeLessThanOrEqual(30);
    expect(second.body.retryAfterSeconds).toBeGreaterThan(0);
    // The worker must NOT have been called a second time — that's the
    // whole point of the rate limit (don't spam admins on a misclick).
    expect(workerCalls).toHaveLength(1);
  });

  it("rate-limit applies across two ADMIN actors in the same org", async () => {
    // Two different admins clicking back-to-back still share the same
    // org-keyed bucket so the org's admins don't get hit twice.
    const first = await request(app).post(URL).set({
      "x-test-user-id": "44444444-4444-4444-4444-444444444444",
      "x-test-org-id": ORG_ID,
      "x-test-role": "ADMIN",
    });
    expect(first.status).toBe(200);
    const second = await request(app).post(URL).set({
      "x-test-user-id": "55555555-5555-5555-5555-555555555555",
      "x-test-org-id": ORG_ID,
      "x-test-role": "ADMIN",
    });
    expect(second.status).toBe(429);
  });
});
