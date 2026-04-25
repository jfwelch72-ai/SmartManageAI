/**
 * Task #1952 — Verifies the server-side fail-fast behaviour added in
 * Task #1949 to `POST /api/website/republish`. The handler wraps every
 * pg call in `withDbTimeout(..., 20000)`; when the pool is starved and
 * `db.query.organizationWebsites.findFirst` never settles, the route
 * MUST return `503` with `{ code: "REPUBLISH_DB_TIMEOUT" }` instead of
 * holding the socket open until the client gives up.
 *
 * To exercise that path deterministically we mock `../db` so that
 * `findFirst` returns a Promise that never resolves and use vitest's
 * fake timers to advance past the 20 s budget. The test asserts the
 * response shape that the client UI keys off of (Task #1949 also
 * surfaces a destructive toast on this status / code combination).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

type TestUser = {
  id: string;
  organizationId: string | null;
  role: string;
  firstName?: string;
  lastName?: string;
  email?: string;
} | null;

let testUser: TestUser = {
  id: "user-republish-timeout",
  organizationId: "org-republish-timeout",
  role: "ADMIN",
  firstName: "Test",
  lastName: "Admin",
  email: "test@example.com",
};

vi.mock("../auth", () => ({
  requireAuth: (
    req: Request & { user?: TestUser },
    res: Response,
    next: NextFunction,
  ) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
    next();
  },
  requireFeaturePermission: () =>
    (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Stub the heavy infra dependencies that the (large) websiteRoutes
// module pulls in at import time. None of them are reached by the
// republish path under test.
vi.mock("../objectStorage", () => ({
  ObjectStorageService: class {
    getPublicObjectSearchPaths() {
      return [];
    }
  },
  ObjectNotFoundError: class extends Error {},
  objectStorageClient: {},
}));

vi.mock("../ai/openaiClient", () => ({
  openai: {},
  AI_MODEL_GPT5: "gpt-5",
}));

vi.mock("../email", () => ({
  sendEmail: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../services/aiGovernance", () => ({
  governedAiCall: vi.fn(),
  estimateCost: vi.fn(() => 0),
}));

vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
}));

vi.mock("../rateLimiter", () => ({
  sensitiveLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const auditCalls: unknown[][] = [];
vi.mock("../auditLogger", () => ({
  logCreate: vi.fn(async (...args: unknown[]) => {
    auditCalls.push(args);
  }),
  logUpdate: vi.fn(async (...args: unknown[]) => {
    auditCalls.push(args);
  }),
  logDelete: vi.fn(async (...args: unknown[]) => {
    auditCalls.push(args);
  }),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// `findFirst` returns a Promise that never resolves so that
// `withDbTimeout` is forced to fire its 20 s safety net. The other
// `db` methods are stubbed to avoid module-level crashes.
let findFirstShouldHang = true;
const neverResolves = () => new Promise(() => {});
vi.mock("../db", () => {
  const dbStub: any = {
    query: {
      organizationWebsites: {
        findFirst: vi.fn(() => {
          if (findFirstShouldHang) return neverResolves();
          return Promise.resolve(null);
        }),
      },
    },
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
  return { db: dbStub, pool: {} };
});

let app: Express;

beforeAll(async () => {
  const { default: router } = await import("../websiteRoutes");
  app = express();
  app.use(express.json());
  app.use("/api/website", router);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err?.message ?? "internal" });
  });
});

beforeEach(() => {
  findFirstShouldHang = true;
  auditCalls.length = 0;
  testUser = {
    id: "user-republish-timeout",
    organizationId: "org-republish-timeout",
    role: "ADMIN",
    firstName: "Test",
    lastName: "Admin",
    email: "test@example.com",
  };
});

describe("POST /api/website/republish — DB timeout fail-fast (Task #1952)", () => {
  it(
    "returns 503 + REPUBLISH_DB_TIMEOUT when findFirst hangs past the 20s budget",
    async () => {
      // The mocked `db.query.organizationWebsites.findFirst` returns a
      // promise that never settles, so the only thing that can complete the
      // request is the `withDbTimeout` safety net (20 s). We let real time
      // elapse rather than fake timers because supertest's HTTP roundtrip
      // races with vitest's fake timer machinery and the result is flaky.
      // 20 s of wall-clock per CI run is the price of provably exercising
      // the production failure path end-to-end.
      const start = Date.now();
      const res = await request(app).post("/api/website/republish").send({});
      const elapsedMs = Date.now() - start;

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: "REPUBLISH_DB_TIMEOUT" });
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error).toMatch(/database/i);
      // The 20 s budget is the contract. Allow a small slack on either
      // side: the timer should fire AFTER ~20 s (proving the wrapper
      // is actually doing the timing) and BEFORE 25 s (proving it
      // doesn't hold the socket past the user-facing 30 s budget).
      expect(elapsedMs).toBeGreaterThanOrEqual(19_500);
      expect(elapsedMs).toBeLessThan(25_000);
    },
    30_000,
  );

  it("returns 401 when unauthenticated (regression guard for the auth gate)", async () => {
    testUser = null;
    const res = await request(app).post("/api/website/republish").send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not ADMIN/SUPER_ADMIN", async () => {
    testUser = {
      id: "non-admin",
      organizationId: "org-republish-timeout",
      role: "USER",
    };
    const res = await request(app).post("/api/website/republish").send({});
    expect(res.status).toBe(403);
  });
});
