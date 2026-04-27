/**
 * Task #2083 — tests for POST /api/library-items/reset-prebuilt-catalog.
 *
 * The route is admin-only (SUPER_ADMIN / ADMIN / HUSTLER) and re-seeds the
 * prebuilt catalog after wiping the existing prebuilt rows. These tests
 * cover role gating and the basic happy-path delete-then-reseed flow with
 * the database, organization lookup, and onboarding helpers mocked.
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

const auditCalls: any[] = [];
vi.mock("../auditLogger", () => ({
  logAudit: vi.fn(async (data: any) => {
    auditCalls.push(data);
  }),
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

let prebuiltItemsForOrg: any[] = [];
let prebuiltAssembliesForOrg: any[] = [];
let prebuiltCategoriesForOrg: any[] = [];
let orgRow: any = { id: "org-1", tradeType: "CONCRETE" };
let insertedItems: any[] = [];
let insertedCategories: any[] = [];
let insertedAssemblies: any[] = [];

function makeSelectChain(rows: any[]) {
  // Mimics: db.select(...).from(...).where(...).limit(...) and variants. The
  // test code below stores the chain target via a final `await` so we just
  // resolve to `rows` whenever any of these terminal calls is reached.
  const result: any = Promise.resolve(rows);
  result.from = () => result;
  result.where = () => result;
  result.limit = () => result;
  result.orderBy = () => result;
  return result;
}

function makeInsertChain(target: any[]) {
  const ret = (rows: any) => {
    const arr = Array.isArray(rows) ? rows : [rows];
    const created = arr.map((r, i) => ({ id: `gen-${target.length + i}`, ...r }));
    target.push(...created);
    const chain: any = {
      returning: () => Promise.resolve(created),
    };
    return chain;
  };
  return { values: ret };
}

function makeDeleteChain(source: any[]) {
  const chain: any = {
    where: () => chain,
    returning: () => {
      const copy = source.map((r) => ({ id: r.id }));
      source.length = 0;
      return Promise.resolve(copy);
    },
  };
  // Even when the route doesn't call `.returning()` (the .where chain is
  // awaited directly), drizzle returns an awaitable. Support both.
  chain.then = (resolve: any) => {
    const copy = source.map((r) => ({ id: r.id }));
    source.length = 0;
    resolve(copy);
  };
  return chain;
}

vi.mock("../db", () => ({
  db: {
    select: vi.fn((..._args: any[]) => {
      // We can't easily distinguish which table is being read inside `from()`
      // because drizzle expressions are opaque here. Instead, the chained
      // `.from(table)` call sets the desired result. We use a lightweight
      // dispatcher keyed on first .from() argument identity.
      let _table: any = null;
      const chain: any = {};
      chain.from = (t: any) => {
        _table = t;
        return chain;
      };
      chain.where = () => chain;
      chain.limit = () => chain;
      chain.orderBy = () => chain;
      chain.then = (resolve: any, reject: any) => {
        try {
          const tableName = _table?.[Symbol.for("drizzle:Name")] || _table?._?.name || _table?.name || "";
          if (tableName === "library_items" || _table === LIBRARY_ITEMS) return resolve(prebuiltItemsForOrg);
          if (tableName === "library_categories" || _table === LIBRARY_CATEGORIES) return resolve(prebuiltCategoriesForOrg);
          if (tableName === "library_assemblies" || _table === LIBRARY_ASSEMBLIES) return resolve(prebuiltAssembliesForOrg);
          if (tableName === "organizations" || _table === ORGANIZATIONS) return resolve(orgRow ? [orgRow] : []);
          return resolve([]);
        } catch (e) {
          reject(e);
        }
      };
      return chain;
    }),
    insert: vi.fn((table: any) => {
      if (table === LIBRARY_ITEMS) return makeInsertChain(insertedItems);
      if (table === LIBRARY_CATEGORIES) return makeInsertChain(insertedCategories);
      if (table === LIBRARY_ASSEMBLIES) return makeInsertChain(insertedAssemblies);
      // assembly items / group members / etc. — accept and discard
      return makeInsertChain([]);
    }),
    delete: vi.fn((table: any) => {
      if (table === LIBRARY_ITEMS) return makeDeleteChain(prebuiltItemsForOrg);
      if (table === LIBRARY_CATEGORIES) return makeDeleteChain(prebuiltCategoriesForOrg);
      if (table === LIBRARY_ASSEMBLIES) return makeDeleteChain(prebuiltAssembliesForOrg);
      return makeDeleteChain([]);
    }),
  },
}));

// Stub onboarding data so the seed helper produces a small, predictable set.
vi.mock("../data/onboarding/index", () => ({
  getMaterials: () => ([
    { material_family_id: "mat-a", display_name: "Ready Mix", canonical_uom: "CY", group: "concrete" },
    { material_family_id: "mat-b", display_name: "Rebar #4", canonical_uom: "LF", group: "reinforcing" },
  ]),
  getComponentsByTradeId: () => ([
    { component_id: "comp-1", display_name: "Formwork", description: "Form panels" },
  ]),
  getScopesByTradeId: () => ([
    { material_families: ["mat-a", "mat-b"] },
  ]),
  getFormulas: () => ([]),
}));

vi.mock("../data/onboarding/categoryMappings", () => ({
  categoryForMaterial: (_t: string, group?: string) => `Category-${group ?? "default"}`,
  categoryForComponent: (_t: string, name: string) => `Category-${name}`,
  isLaborComponent: () => false,
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

let LIBRARY_ITEMS: any;
let LIBRARY_CATEGORIES: any;
let LIBRARY_ASSEMBLIES: any;
let ORGANIZATIONS: any;
let app: Express;

beforeAll(async () => {
  const schema = await import("@shared/schema");
  LIBRARY_ITEMS = (schema as any).libraryItems;
  LIBRARY_CATEGORIES = (schema as any).libraryCategories;
  LIBRARY_ASSEMBLIES = (schema as any).libraryAssemblies;
  ORGANIZATIONS = (schema as any).organizations;

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
  auditCalls.length = 0;
  prebuiltItemsForOrg = [
    { id: "old-item-1", organizationId: "org-1", isPrebuilt: true },
    { id: "old-item-2", organizationId: "org-1", isPrebuilt: true },
  ];
  prebuiltAssembliesForOrg = [
    { id: "old-asm-1", organizationId: "org-1", isPrebuilt: true },
  ];
  prebuiltCategoriesForOrg = [
    { id: "old-cat-1", organizationId: "org-1", isPrebuilt: true, sourceId: "onboarding:category:CONCRETE:Concrete Misc" },
  ];
  orgRow = { id: "org-1", tradeType: "CONCRETE" };
  insertedItems = [];
  insertedCategories = [];
  insertedAssemblies = [];
});

describe("POST /api/library-items/reset-prebuilt-catalog — auth", () => {
  it("returns 401 when unauthenticated (no orgId)", async () => {
    const res = await request(app).post("/api/library-items/reset-prebuilt-catalog");
    expect(res.status).toBe(401);
  });

  it("returns 403 when an authenticated user is not an admin", async () => {
    testUser = { id: "u1", organizationId: "org-1", role: "ESTIMATOR" };
    const res = await request(app).post("/api/library-items/reset-prebuilt-catalog");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it("returns 403 for HUSTLER whose effectiveRole is below ADMIN", async () => {
    testUser = { id: "u2", organizationId: "org-1", role: "HUSTLER", effectiveRole: "MANAGER" };
    const res = await request(app).post("/api/library-items/reset-prebuilt-catalog");
    expect(res.status).toBe(403);
  });

  it("allows HUSTLER (default effectiveRole = ADMIN-equivalent) to call the route", async () => {
    testUser = { id: "u3", organizationId: "org-1", role: "HUSTLER" };
    const res = await request(app).post("/api/library-items/reset-prebuilt-catalog");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/library-items/reset-prebuilt-catalog — happy path", () => {
  beforeEach(() => {
    testUser = { id: "admin-1", organizationId: "org-1", role: "ADMIN" };
  });

  it("deletes prebuilt rows, re-seeds, and writes an audit log entry", async () => {
    const res = await request(app).post("/api/library-items/reset-prebuilt-catalog");
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(true);
    expect(res.body.tradeType).toBe("CONCRETE");
    // Old prebuilt rows were deleted
    expect(res.body.deleted).toEqual({ items: 2, assemblies: 1, categories: 1 });
    // Re-seed populated fresh rows from the onboarding data fixtures
    expect(res.body.created.items).toBeGreaterThan(0);
    expect(res.body.created.categories).toBeGreaterThan(0);
    // Audit row written for the reset operation
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0]).toMatchObject({
      userId: "admin-1",
      action: "RESET",
      entityType: "libraryPrebuiltCatalog",
      entityId: "org-1",
    });
    const newValue = JSON.parse(auditCalls[0].newValue);
    expect(newValue.tradeType).toBe("CONCRETE");
    expect(newValue.itemsCreated).toBeGreaterThan(0);
  });

  it("returns 404 when the organization is missing", async () => {
    orgRow = null;
    const res = await request(app).post("/api/library-items/reset-prebuilt-catalog");
    expect(res.status).toBe(404);
  });
});
