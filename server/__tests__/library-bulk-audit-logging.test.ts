/**
 * Task #2135 — verify the destructive library bulk routes write audit log
 * entries.
 *
 * Covers:
 *   - DELETE /api/library-items/bulk emits one logDelete per affected row
 *   - POST /api/library-items/bulk-duplicate emits one logCreate per copy
 *   - DELETE /api/library-items/:id (single) emits one logDelete (so the
 *     single and bulk paths produce a consistent forensic trail)
 */

import {
  describe,
  it,
  expect,
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
  organizationId: string;
  role: string;
  effectiveRole?: string;
} | null;
let testUser: TestUser = null;

vi.mock("../auth", () => ({
  requireAuth: (
    req: Request & { user?: TestUser },
    _res: Response,
    next: NextFunction,
  ) => {
    if (testUser) req.user = testUser;
    next();
  },
  requireRole: (..._roles: string[]) =>
    (req: Request & { user?: TestUser }, _res: Response, next: NextFunction) => {
      if (testUser) req.user = testUser;
      next();
    },
}));

const logDeleteCalls: any[] = [];
const logCreateCalls: any[] = [];
vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(),
  logCreate: vi.fn(async (...args: any[]) => {
    logCreateCalls.push(args);
  }),
  logUpdate: vi.fn(),
  logDelete: vi.fn(async (...args: any[]) => {
    logDeleteCalls.push(args);
  }),
}));

// Drive the mocked db chain from these per-test fixtures.
let libraryRows: any[] = [];

vi.mock("../db", () => {
  const makeDeleteChain = () => {
    let _whereCalled = false;
    const chain: any = {};
    chain.where = () => {
      _whereCalled = true;
      return chain;
    };
    chain.returning = () => {
      const out = [...libraryRows];
      libraryRows = [];
      return Promise.resolve(out);
    };
    chain.then = (resolve: any, reject: any) => {
      try {
        const out = [...libraryRows];
        libraryRows = [];
        resolve(out);
      } catch (e) { reject(e); }
    };
    return chain;
  };
  const makeInsertChain = () => {
    let _captured: any[] = [];
    const chain: any = {};
    chain.values = (rows: any) => {
      _captured = Array.isArray(rows) ? rows : [rows];
      return chain;
    };
    chain.returning = () => {
      const out = _captured.map((r, i) => ({ id: `new-${i}`, ...r }));
      return Promise.resolve(out);
    };
    return chain;
  };
  const makeSelectChain = () => {
    const chain: any = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.then = (resolve: any) => resolve(libraryRows);
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      delete: vi.fn(() => makeDeleteChain()),
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      })),
    },
  };
});

let app: Express;

beforeEach(async () => {
  vi.resetModules();
  logDeleteCalls.length = 0;
  logCreateCalls.length = 0;
  libraryRows = [];
  testUser = {
    id: "user-est",
    organizationId: "org-1",
    role: "ESTIMATOR",
    effectiveRole: "ESTIMATOR",
  };
  const router = (await import("../libraryRoutes")).default;
  app = express();
  app.use(express.json());
  app.use((req: Request & { user?: TestUser }, _res, next) => {
    if (testUser) req.user = testUser;
    next();
  });
  app.use(router);
});

describe("Task #2135 — destructive library bulk audit logging", () => {
  it("DELETE /api/library-items/bulk writes one logDelete per deleted row", async () => {
    libraryRows = [
      { id: "li-1", name: "Concrete", itemNumber: "C-1", tradeType: "CONCRETE", libraryId: null, categoryId: "cat-a", isPrebuilt: false },
      { id: "li-2", name: "Rebar", itemNumber: "R-1", tradeType: "CONCRETE", libraryId: null, categoryId: "cat-a", isPrebuilt: false },
      { id: "li-3", name: "Forms", itemNumber: "F-1", tradeType: "CONCRETE", libraryId: null, categoryId: null, isPrebuilt: true },
    ];

    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["li-1", "li-2", "li-3"] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(res.body.ids).toEqual(["li-1", "li-2", "li-3"]);

    expect(logDeleteCalls).toHaveLength(3);
    const ids = logDeleteCalls.map((c) => c[2]).sort();
    expect(ids).toEqual(["li-1", "li-2", "li-3"]);
    // Each call: (userId, entityType, entityId, oldValue, req)
    for (const call of logDeleteCalls) {
      expect(call[0]).toBe("user-est");
      expect(call[1]).toBe("libraryItem");
      expect(typeof call[2]).toBe("string");
      expect(call[3]).toMatchObject({ name: expect.any(String), tradeType: "CONCRETE" });
    }
  });

  it("POST /api/library-items/bulk-duplicate writes one logCreate per copy", async () => {
    libraryRows = [
      { id: "src-1", organizationId: "org-1", name: "Concrete", itemNumber: "C-1", tradeType: "CONCRETE", libraryId: null, categoryId: "cat-a", isPrebuilt: true, isActive: true },
      { id: "src-2", organizationId: "org-1", name: "Rebar", itemNumber: "R-1", tradeType: "CONCRETE", libraryId: null, categoryId: "cat-a", isPrebuilt: true, isActive: true },
    ];

    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["src-1", "src-2"] });

    expect(res.status).toBe(200);
    expect(res.body.duplicated).toBe(2);
    expect(logCreateCalls).toHaveLength(2);
    for (const call of logCreateCalls) {
      expect(call[0]).toBe("user-est");
      expect(call[1]).toBe("libraryItem");
      // duplicatedFrom should reference the source id
      expect(["src-1", "src-2"]).toContain(call[3].duplicatedFrom);
      expect(call[3].name).toContain("(copy)");
    }
  });

  it("DELETE /api/library-items/:id writes a single logDelete (single/bulk consistency)", async () => {
    libraryRows = [
      { id: "li-9", name: "One Item", itemNumber: "O-9", tradeType: "OTHER", libraryId: null, categoryId: null, isPrebuilt: false },
    ];

    const res = await request(app).delete("/api/library-items/li-9");

    expect(res.status).toBe(200);
    expect(logDeleteCalls).toHaveLength(1);
    expect(logDeleteCalls[0][1]).toBe("libraryItem");
    expect(logDeleteCalls[0][2]).toBe("li-9");
    expect(logDeleteCalls[0][3]).toMatchObject({ name: "One Item" });
  });

  it("DELETE /api/library-items/bulk rejects requests with no auth", async () => {
    testUser = null;
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["x"] });
    expect(res.status).toBe(401);
    expect(logDeleteCalls).toHaveLength(0);
  });
});
