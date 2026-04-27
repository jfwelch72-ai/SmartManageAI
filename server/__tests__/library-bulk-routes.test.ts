/**
 * Task #2134 — regression coverage for the bulk routes added in Task #2113:
 *
 *   DELETE /api/library-items/bulk
 *   POST   /api/library-items/bulk-duplicate
 *
 * Task #2154 extends the same mock harness to cover the sibling re-bucket
 * route added in Task #2086:
 *
 *   PATCH  /api/library-items/bulk
 *
 * All three routes were previously verified only by hand with curl. The cases
 * below assert the contract that future schema/auth refactors must keep:
 *   - org-scoped where clause (cross-tenant ids never get touched)
 *   - role gating to ESTIMATOR-or-above
 *   - 401 when there is no authenticated org
 *   - 400 on non-array / empty / oversized id lists (MAX_BULK = 500)
 *   - duplicate copies are saved as `isPrebuilt=false` with a "(copy)" suffix
 *   - re-bucket rejects destination categories owned by a different tenant
 *     (returns 404) and accepts `categoryId: null` to move back to
 *     "Uncategorized"
 *
 * Mocking pattern follows server/__tests__/library-reset-prebuilt-route.test.ts:
 * vitest + supertest with the auth middleware, audit logger, and `db` stubbed.
 * Drizzle's `eq`/`and`/`inArray` operators are wrapped with capture objects so
 * the in-memory db can evaluate the route's where clause and reproduce the
 * cross-tenant filter exactly.
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

type TestUser = { id: string; organizationId: string; role: string; effectiveRole?: string } | null;
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

// Task #2153 — capture every logAudit call so the bulk routes can be asserted
// to write a paper trail (mirrors the pattern in
// server/__tests__/library-reset-prebuilt-route.test.ts).
const auditCalls: any[] = [];
vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(async (data: any) => {
    auditCalls.push(data);
  }),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// Wrap the drizzle operators the bulk routes use so we can evaluate the
// where clause inside the in-memory db mock. Other operators are passed
// through untouched in case shared imports rely on them.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
    and: (...args: unknown[]) => ({ __op: "and", args }),
    inArray: (col: unknown, vals: unknown[]) => ({ __op: "inArray", col, vals }),
  };
});

// In-memory rows. Includes rows owned by other organizations to prove the
// org-scoped where clause does not leak across tenants.
let rows: any[] = [];
let categories: any[] = [];
let nextGenId = 1;
const insertedRows: any[] = [];

let LIBRARY_ITEMS: any;
let LIBRARY_CATEGORIES: any;

function evalExpr(expr: any, row: any): boolean {
  if (!expr) return true;
  if (expr.__op === "and") {
    return expr.args.every((a: any) => evalExpr(a, row));
  }
  if (expr.__op === "eq") {
    if (expr.col === LIBRARY_ITEMS.organizationId) return row.organizationId === expr.val;
    if (expr.col === LIBRARY_ITEMS.id) return row.id === expr.val;
    if (LIBRARY_CATEGORIES && expr.col === LIBRARY_CATEGORIES.organizationId) return row.organizationId === expr.val;
    if (LIBRARY_CATEGORIES && expr.col === LIBRARY_CATEGORIES.id) return row.id === expr.val;
    return true;
  }
  if (expr.__op === "inArray") {
    if (expr.col === LIBRARY_ITEMS.id) return (expr.vals as unknown[]).includes(row.id);
    return true;
  }
  return true;
}

vi.mock("../db", () => ({
  db: {
    select: vi.fn((..._args: unknown[]) => {
      let _table: any = null;
      let _where: any = null;
      const chain: any = {};
      chain.from = (t: any) => {
        _table = t;
        return chain;
      };
      chain.where = (expr: any) => {
        _where = expr;
        return chain;
      };
      chain.limit = () => chain;
      chain.orderBy = () => chain;
      chain.then = (resolve: any, reject: any) => {
        try {
          if (_table === LIBRARY_ITEMS) {
            return resolve(rows.filter((r) => evalExpr(_where, r)));
          }
          // The PATCH bulk route reads library_categories to verify the
          // destination category belongs to the caller's org.
          if (_table === LIBRARY_CATEGORIES) {
            return resolve(categories.filter((c) => evalExpr(_where, c)));
          }
          return resolve([]);
        } catch (e) {
          reject(e);
        }
      };
      return chain;
    }),
    insert: vi.fn((table: any) => {
      let _values: any[] = [];
      const chain: any = {};
      chain.values = (vals: any) => {
        _values = Array.isArray(vals) ? vals : [vals];
        return chain;
      };
      chain.returning = () => {
        if (table === LIBRARY_ITEMS) {
          const created = _values.map((v) => ({ id: `gen-${nextGenId++}`, ...v }));
          rows.push(...created);
          insertedRows.push(...created);
          return Promise.resolve(created);
        }
        return Promise.resolve([]);
      };
      return chain;
    }),
    delete: vi.fn((table: any) => {
      let _where: any = null;
      const chain: any = {};
      chain.where = (expr: any) => {
        _where = expr;
        return chain;
      };
      chain.returning = () => {
        if (table === LIBRARY_ITEMS) {
          const matched = rows.filter((r) => evalExpr(_where, r));
          rows = rows.filter((r) => !matched.includes(r));
          return Promise.resolve(matched.map((r) => ({ id: r.id })));
        }
        return Promise.resolve([]);
      };
      return chain;
    }),
    update: vi.fn((table: any) => {
      // Used by the PATCH bulk re-bucket route. Applies the `set` payload to
      // every row matching the where clause and returns the matched ids so
      // the route can report `updated`.
      let _set: any = null;
      let _where: any = null;
      const chain: any = {};
      chain.set = (vals: any) => {
        _set = vals;
        return chain;
      };
      chain.where = (expr: any) => {
        _where = expr;
        return chain;
      };
      chain.returning = () => {
        if (table === LIBRARY_ITEMS) {
          const matched = rows.filter((r) => evalExpr(_where, r));
          for (const m of matched) Object.assign(m, _set);
          return Promise.resolve(matched.map((r) => ({ id: r.id })));
        }
        return Promise.resolve([]);
      };
      return chain;
    }),
  },
}));

let app: Express;

beforeAll(async () => {
  const schema = await import("@shared/schema");
  LIBRARY_ITEMS = (schema as any).libraryItems;
  LIBRARY_CATEGORIES = (schema as any).libraryCategories;

  const { default: libraryRoutes } = await import("../libraryRoutes");
  app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    if (testUser) req.user = testUser;
    next();
  });
  app.use(libraryRoutes);
});

beforeEach(() => {
  testUser = null;
  nextGenId = 1;
  insertedRows.length = 0;
  auditCalls.length = 0;
  // Categories used by the PATCH bulk re-bucket route. `cat-1`/`cat-2` are
  // owned by org-1; `cat-foreign` belongs to org-2 so we can prove the
  // 404-on-cross-tenant-destination guard.
  categories = [
    { id: "cat-1", organizationId: "org-1", name: "Concrete" },
    { id: "cat-2", organizationId: "org-1", name: "Steel" },
    { id: "cat-foreign", organizationId: "org-2", name: "Foreign Org Category" },
  ];
  // Two rows in the caller's org plus one foreign-org row that must never
  // be touched regardless of whether its id is included in the request.
  rows = [
    {
      id: "item-a",
      organizationId: "org-1",
      name: "Concrete Slab",
      itemNumber: "100",
      measuredCoverage: 1,
      unitOfMeasure: "CY",
      purchaseCoverage: 1,
      purchaseUnit: "CY",
      description: "desc-a",
      costTypes: ["material"],
      accountingCodes: null,
      unitCosts: { material: 100 },
      notes: null,
      libraryId: null,
      tradeType: "CONCRETE",
      categoryId: "cat-1",
      sourceId: null,
      isPrebuilt: true,
      isActive: true,
    },
    {
      id: "item-b",
      organizationId: "org-1",
      name: "Rebar #4",
      itemNumber: "200",
      measuredCoverage: 1,
      unitOfMeasure: "LF",
      purchaseCoverage: 1,
      purchaseUnit: "LF",
      description: "desc-b",
      costTypes: ["material"],
      accountingCodes: null,
      unitCosts: { material: 2.5 },
      notes: null,
      libraryId: null,
      tradeType: "CONCRETE",
      categoryId: "cat-1",
      sourceId: null,
      isPrebuilt: false,
      isActive: true,
    },
    {
      id: "item-foreign",
      organizationId: "org-2",
      name: "Foreign Tenant Item",
      itemNumber: "999",
      measuredCoverage: 1,
      unitOfMeasure: "EA",
      purchaseCoverage: 1,
      purchaseUnit: "EA",
      description: "should never be touched",
      costTypes: ["material"],
      accountingCodes: null,
      unitCosts: { material: 9 },
      notes: null,
      libraryId: null,
      tradeType: "CONCRETE",
      categoryId: null,
      sourceId: null,
      isPrebuilt: false,
      isActive: true,
    },
  ];
});

describe("DELETE /api/library-items/bulk", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["item-a"] });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller's role is below ESTIMATOR", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "FIELD_WORKER" };
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["item-a"] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
    // No rows were removed.
    expect(rows.find((r) => r.id === "item-a")).toBeTruthy();
  });

  it("returns 400 when ids is missing or not an array", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    for (const body of [undefined, {}, { ids: "item-a" }, { ids: null }, { ids: 42 }]) {
      const res = await request(app)
        .delete("/api/library-items/bulk")
        .send(body as any);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty array/i);
    }
  });

  it("returns 400 when ids is an empty array", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/i);
  });

  it("returns 400 when an id entry is not a non-empty string", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["item-a", ""] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/i);
  });

  it("returns 400 when ids exceeds the MAX_BULK cap of 500", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const tooMany = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than 500/i);
  });

  it("accepts exactly 500 ids (cap is inclusive)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const ids = Array.from({ length: 500 }, (_, i) => `nope-${i}`);
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids });
    expect(res.status).toBe(200);
    // None of those ids exist in the seed, so nothing is removed.
    expect(res.body.deleted).toBe(0);
    expect(res.body.ids).toEqual([]);
  });

  it("deletes only rows in the caller's org (happy path)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["item-a", "item-b"] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    expect(res.body.ids.sort()).toEqual(["item-a", "item-b"]);
    // Caller's rows are gone, foreign-org row is intact.
    expect(rows.find((r) => r.id === "item-a")).toBeUndefined();
    expect(rows.find((r) => r.id === "item-b")).toBeUndefined();
    expect(rows.find((r) => r.id === "item-foreign")).toBeTruthy();

    // Task #2153 — audit row was written with the affected ids and counts.
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0]).toMatchObject({
      userId: "u1",
      action: "BULK_DELETE",
      entityType: "libraryItem",
      entityId: "org-1",
    });
    const newValue = JSON.parse(auditCalls[0].newValue);
    expect(newValue.deletedCount).toBe(2);
    expect(newValue.deletedIds.sort()).toEqual(["item-a", "item-b"]);
    const oldValue = JSON.parse(auditCalls[0].oldValue);
    expect(oldValue.requestedCount).toBe(2);
    expect(oldValue.requestedIds.sort()).toEqual(["item-a", "item-b"]);
  });

  it("ignores ids that belong to a different organization (cross-tenant isolation)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["item-a", "item-foreign"] });
    expect(res.status).toBe(200);
    // Only item-a was actually removed; the foreign id is silently filtered.
    expect(res.body.deleted).toBe(1);
    expect(res.body.ids).toEqual(["item-a"]);
    expect(rows.find((r) => r.id === "item-foreign")).toBeTruthy();

    // Task #2153 — partial-success path still produces an audit row that
    // names exactly the rows that were deleted (not the foreign id).
    expect(auditCalls.length).toBe(1);
    const newValue = JSON.parse(auditCalls[0].newValue);
    expect(newValue.deletedCount).toBe(1);
    expect(newValue.deletedIds).toEqual(["item-a"]);
  });

  it("returns 0 when none of the supplied ids belong to the caller", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids: ["item-foreign", "ghost-id"] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(res.body.ids).toEqual([]);
    expect(rows.find((r) => r.id === "item-foreign")).toBeTruthy();

    // Task #2153 — no rows touched means no audit noise.
    expect(auditCalls.length).toBe(0);
  });

  it("does not write an audit row when the cap-but-empty path matches nothing (Task #2153)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const ids = Array.from({ length: 500 }, (_, i) => `nope-${i}`);
    const res = await request(app)
      .delete("/api/library-items/bulk")
      .send({ ids });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(auditCalls.length).toBe(0);
  });
});

describe("POST /api/library-items/bulk-duplicate", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["item-a"] });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller's role is below ESTIMATOR", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "FIELD_WORKER" };
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["item-a"] });
    expect(res.status).toBe(403);
    expect(insertedRows).toEqual([]);
  });

  it("returns 400 when ids is missing, not an array, or empty", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    for (const body of [undefined, {}, { ids: null }, { ids: "x" }, { ids: [] }]) {
      const res = await request(app)
        .post("/api/library-items/bulk-duplicate")
        .send(body as any);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty array/i);
    }
  });

  it("returns 400 when ids exceeds the MAX_BULK cap of 500", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const tooMany = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than 500/i);
  });

  it("duplicates rows with a (copy) suffix and isPrebuilt=false", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["item-a", "item-b"] });
    expect(res.status).toBe(200);
    expect(res.body.duplicated).toBe(2);
    expect(res.body.items).toHaveLength(2);

    const byName = (n: string) => res.body.items.find((i: any) => i.name === n);
    const copyA = byName("Concrete Slab (copy)");
    const copyB = byName("Rebar #4 (copy)");
    expect(copyA).toBeTruthy();
    expect(copyB).toBeTruthy();

    // Duplicates always become editable user copies.
    expect(copyA.isPrebuilt).toBe(false);
    expect(copyB.isPrebuilt).toBe(false);
    // The copy points back at its source via sourceId.
    expect(copyA.sourceId).toBe("item-a");
    expect(copyB.sourceId).toBe("item-b");
    // Other identifying fields are preserved.
    expect(copyA.tradeType).toBe("CONCRETE");
    expect(copyA.categoryId).toBe("cat-1");
    expect(copyA.unitOfMeasure).toBe("CY");
    expect(copyA.unitCosts).toEqual({ material: 100 });
    // New rows belong to the caller's org and got fresh ids.
    expect(copyA.id).not.toBe("item-a");
    expect(copyA.organizationId).toBe("org-1");
    expect(insertedRows).toHaveLength(2);

    // Task #2153 — audit row was written naming the source ids and the
    // freshly inserted ids.
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0]).toMatchObject({
      userId: "u1",
      action: "BULK_DUPLICATE",
      entityType: "libraryItem",
      entityId: "org-1",
    });
    const oldValue = JSON.parse(auditCalls[0].oldValue);
    expect(oldValue.requestedCount).toBe(2);
    expect(oldValue.requestedIds.sort()).toEqual(["item-a", "item-b"]);
    expect(oldValue.sourceIds.sort()).toEqual(["item-a", "item-b"]);
    const newValue = JSON.parse(auditCalls[0].newValue);
    expect(newValue.duplicatedCount).toBe(2);
    expect(newValue.duplicatedIds.sort()).toEqual([copyA.id, copyB.id].sort());
  });

  it("clamps the (copy) name to 120 characters", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const longName = "x".repeat(120);
    rows.push({
      ...rows[0],
      id: "item-long",
      name: longName,
    });
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["item-long"] });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name.length).toBe(120);
    // Should be the leading slice of the original name + " (copy)" trimmed.
    expect(res.body.items[0].name.startsWith("x")).toBe(true);
  });

  it("does not duplicate ids belonging to a different organization", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["item-foreign"] });
    expect(res.status).toBe(200);
    // The foreign id matched zero source rows so the route returns 0/[] and
    // never inserts anything. This is the cross-tenant isolation guarantee.
    expect(res.body.duplicated).toBe(0);
    expect(res.body.items).toEqual([]);
    expect(insertedRows).toEqual([]);
    // The foreign row itself is untouched.
    expect(rows.find((r) => r.id === "item-foreign")).toBeTruthy();

    // Task #2153 — nothing was duplicated, so no audit noise either.
    expect(auditCalls.length).toBe(0);
  });

  it("only duplicates the in-org subset when the request mixes own and foreign ids", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .post("/api/library-items/bulk-duplicate")
      .send({ ids: ["item-a", "item-foreign", "ghost-id"] });
    expect(res.status).toBe(200);
    expect(res.body.duplicated).toBe(1);
    expect(res.body.items[0].name).toBe("Concrete Slab (copy)");
    expect(res.body.items[0].sourceId).toBe("item-a");
    expect(res.body.items[0].organizationId).toBe("org-1");

    // Task #2153 — partial-success path still records exactly the in-org
    // sources that ended up duplicated.
    expect(auditCalls.length).toBe(1);
    const oldValue = JSON.parse(auditCalls[0].oldValue);
    expect(oldValue.sourceIds).toEqual(["item-a"]);
    const newValue = JSON.parse(auditCalls[0].newValue);
    expect(newValue.duplicatedCount).toBe(1);
    expect(newValue.duplicatedIds).toEqual([res.body.items[0].id]);
  });
});

// Task #2154 — coverage for the bulk re-bucket endpoint added in Task #2086.
// Same MAX_BULK = 500 cap and same org-scoped where clause as the other two
// bulk routes, plus an extra cross-tenant guard on the destination categoryId.
describe("PATCH /api/library-items/bulk", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a"], categoryId: "cat-2" });
    expect(res.status).toBe(401);
    // No row was mutated.
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBe("cat-1");
  });

  it("returns 403 when the caller's role is below ESTIMATOR", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "FIELD_WORKER" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a"], categoryId: "cat-2" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permission/i);
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBe("cat-1");
  });

  it("returns 400 when ids is missing, not an array, or empty", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    for (const body of [
      undefined,
      {},
      { categoryId: "cat-2" },
      { ids: null, categoryId: "cat-2" },
      { ids: "item-a", categoryId: "cat-2" },
      { ids: 42, categoryId: "cat-2" },
      { ids: [], categoryId: "cat-2" },
    ]) {
      const res = await request(app)
        .patch("/api/library-items/bulk")
        .send(body as any);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty array/i);
    }
  });

  it("returns 400 when an id entry is not a non-empty string", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a", ""], categoryId: "cat-2" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty array/i);
  });

  it("returns 400 when categoryId is neither a string nor null", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    for (const categoryId of [42, true, { id: "cat-2" }, ["cat-2"], undefined]) {
      const res = await request(app)
        .patch("/api/library-items/bulk")
        .send({ ids: ["item-a"], categoryId } as any);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/categoryId must be a string or null/i);
    }
    // Nothing was mutated by any of the rejected payloads.
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBe("cat-1");
  });

  it("returns 400 when ids exceeds the MAX_BULK cap of 500", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const tooMany = Array.from({ length: 501 }, (_, i) => `id-${i}`);
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: tooMany, categoryId: "cat-2" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than 500/i);
  });

  it("accepts exactly 500 ids (cap is inclusive)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const ids = Array.from({ length: 500 }, (_, i) => `nope-${i}`);
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids, categoryId: "cat-2" });
    expect(res.status).toBe(200);
    // None of those ids exist in the seed, so nothing is updated.
    expect(res.body.updated).toBe(0);
    expect(res.body.ids).toEqual([]);
  });

  it("returns 404 when the destination category belongs to a different organization", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a", "item-b"], categoryId: "cat-foreign" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/destination category not found/i);
    // Items in the caller's org were not re-bucketed.
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBe("cat-1");
    expect(rows.find((r) => r.id === "item-b")?.categoryId).toBe("cat-1");
  });

  it("returns 404 when the destination category does not exist at all", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a"], categoryId: "cat-does-not-exist" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/destination category not found/i);
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBe("cat-1");
  });

  it("re-points ids at a valid destination categoryId and bumps updatedAt (happy path)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const before = Date.now();
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a", "item-b"], categoryId: "cat-2" });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.ids.sort()).toEqual(["item-a", "item-b"]);

    const a = rows.find((r) => r.id === "item-a");
    const b = rows.find((r) => r.id === "item-b");
    expect(a.categoryId).toBe("cat-2");
    expect(b.categoryId).toBe("cat-2");
    // updatedAt was bumped to a Date at-or-after the request started.
    expect(a.updatedAt).toBeInstanceOf(Date);
    expect(b.updatedAt).toBeInstanceOf(Date);
    expect(a.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("accepts categoryId: null to move items back to Uncategorized", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a", "item-b"], categoryId: null });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBeNull();
    expect(rows.find((r) => r.id === "item-b")?.categoryId).toBeNull();
  });

  it("does not update ids that belong to a different organization (cross-tenant isolation)", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-a", "item-foreign"], categoryId: "cat-2" });
    expect(res.status).toBe(200);
    // Only the in-org id was actually updated; the foreign id is silently
    // filtered out by the org-scoped where clause.
    expect(res.body.updated).toBe(1);
    expect(res.body.ids).toEqual(["item-a"]);
    expect(rows.find((r) => r.id === "item-a")?.categoryId).toBe("cat-2");
    // The foreign row keeps its original categoryId (null in the seed).
    expect(rows.find((r) => r.id === "item-foreign")?.categoryId).toBeNull();
  });

  it("returns 0 when none of the supplied ids belong to the caller", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app)
      .patch("/api/library-items/bulk")
      .send({ ids: ["item-foreign", "ghost-id"], categoryId: "cat-2" });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.ids).toEqual([]);
    // Foreign row is intact.
    expect(rows.find((r) => r.id === "item-foreign")?.categoryId).toBeNull();
  });
});
