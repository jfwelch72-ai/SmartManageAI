/**
 * Task #775 — Lock in the GET /api/notifications/digest-csv-sample endpoint.
 *
 * Verifies:
 *   1. 401 for unauthenticated requests.
 *   2. 403 for authenticated non-Super-Admins.
 *   3. 200 + Content-Type: text/csv for Super Admins.
 *   4. The body always begins with the canonical header line
 *      `job,counter,kind,triggeredAt,message`.
 *   5. Falls back to the synthetic sample (and reports
 *      `X-Digest-Csv-Sample-Source: synthetic`) when the DB has no
 *      recent events; reports `live` when rows are returned.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

type TestUser = { id: string; role: string; effectiveRole?: string } | null;

let testUser: TestUser = null;
let dbRows: Array<Record<string, unknown>> = [];

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => dbRows,
          }),
        }),
      }),
    }),
  },
  pool: {},
}));

vi.mock("../auth", () => ({
  requireAuth: (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
    if (!testUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = testUser;
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

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  const { default: router } = await import("../notificationPreferencesRoutes");
  app = express();
  app.use(express.json());
  app.use(router);
});

beforeEach(() => {
  testUser = null;
  dbRows = [];
});

const HEADER_LINE = "job,counter,kind,triggeredAt,message";

describe("GET /api/notifications/digest-csv-sample (Task #775)", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    const res = await request(app).get("/api/notifications/digest-csv-sample");
    expect(res.status).toBe(401);
  });

  it("returns 403 for authenticated non-Super-Admins", async () => {
    testUser = { id: "user-1", role: "ADMIN" };
    const res = await request(app).get("/api/notifications/digest-csv-sample");
    expect(res.status).toBe(403);
  });

  it("returns 200 + text/csv with the canonical header line for Super Admins (synthetic fallback)", async () => {
    testUser = { id: "super-1", role: "SUPER_ADMIN" };
    dbRows = []; // no live events → synthetic sample

    const res = await request(app).get("/api/notifications/digest-csv-sample");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["x-digest-csv-sample-source"]).toBe("synthetic");

    const body = res.text;
    const firstLine = body.split(/\r?\n/)[0];
    expect(firstLine).toBe(HEADER_LINE);
    // Synthetic sample carries known fixture rows.
    expect(body).toContain("JOB-104");
    expect(body).toContain("labor_hours");
  });

  it("reports source=live when the DB returns recent events", async () => {
    testUser = { id: "super-1", role: "SUPER_ADMIN" };
    dbRows = [
      {
        job: "live-job-1",
        counter: "errors",
        kind: "spike",
        message: "live event message",
        triggeredAt: new Date(Date.UTC(2026, 0, 15, 2, 0, 0)),
        emailed: true,
      },
    ];

    const res = await request(app).get("/api/notifications/digest-csv-sample");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["x-digest-csv-sample-source"]).toBe("live");

    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(HEADER_LINE);
    expect(lines[1]).toContain("live-job-1");
    expect(lines[1]).toContain("errors");
    expect(lines[1]).toContain("spike");
    expect(lines[1]).toContain("live event message");
  });
});
