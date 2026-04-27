/**
 * Task #2079 — tests for the per-user Takeoff "Recent" sync routes:
 *
 *   - GET    /api/takeoff/recents   — returns the rail in opened-at desc order
 *   - POST   /api/takeoff/recents   — upserts an entry (dedupes per sheet)
 *   - DELETE /api/takeoff/recents   — drops a single entry
 *
 * Hermetic — uses the same in-process db mock pattern as the sibling
 * routes tests so the suite doesn't need a real Postgres bootstrap.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

type Row = Record<string, unknown>;

interface CapturedInsert {
  table: string;
  values?: Row;
  conflict?: { target?: unknown; set?: Row };
}

interface CapturedDelete {
  table: string;
}

const selectByTable: Record<string, Row[][]> = {};
const inserts: CapturedInsert[] = [];
const deletes: CapturedDelete[] = [];
const executeCalls: unknown[] = [];

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
  chain.orderBy = () => chain;
  chain.limit = () => chain;
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

const dbMock = {
  execute: async (q: unknown) => {
    executeCalls.push(q);
    return { rows: [] };
  },
  select: () => makeSelectChain(),
  insert: (t: unknown) => {
    const table = tableName(t);
    return {
      values: (values: Row) => {
        const captured: CapturedInsert = { table, values };
        const onConflictDoUpdate = (cfg: { target?: unknown; set?: Row }) => {
          captured.conflict = cfg;
          inserts.push(captured);
          return Promise.resolve(undefined);
        };
        const thenable = {
          onConflictDoUpdate,
          then: (resolve: (v: unknown) => unknown) => {
            inserts.push(captured);
            return Promise.resolve(undefined).then(resolve);
          },
        };
        return thenable;
      },
    };
  },
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  delete: (t: unknown) => {
    const table = tableName(t);
    return {
      where: async () => {
        deletes.push({ table });
        return undefined;
      },
    };
  },
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

function makeApp(routes: any): Express {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: any }, _res: Response, next: NextFunction) => {
    const userId = req.header("x-test-user-id");
    const role = req.header("x-test-role");
    // Allow tests to attach a user without an organization by passing the
    // explicit "x-test-no-org" header — needed to exercise the
    // "user without organization" guard in the POST handler.
    const noOrg = req.header("x-test-no-org") === "1";
    const orgId = noOrg ? undefined : req.header("x-test-org-id");
    if (userId && role && (orgId || noOrg)) {
      req.user = { id: userId, organizationId: orgId, role };
    }
    next();
  });
  app.use(routes);
  return app;
}

const ME = "user-aaa";
const ORG_ID = "org-aaa";

let app: Express;

beforeEach(async () => {
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  inserts.length = 0;
  deletes.length = 0;
  executeCalls.length = 0;
  vi.resetModules();
  const mod = await import("../takeoffRecentsRoutes");
  app = makeApp(mod.default);
});

function authedHeaders() {
  return {
    "x-test-user-id": ME,
    "x-test-org-id": ORG_ID,
    "x-test-role": "ESTIMATOR",
  };
}

describe("GET /api/takeoff/recents", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/takeoff/recents");
    expect(res.status).toBe(401);
  });

  it("returns recents shaped for the client (opened_at as ms, '' sheetId becomes null)", async () => {
    (selectByTable["takeoff_recents"] ??= []).push([
      {
        id: "r-1",
        userId: ME,
        organizationId: ORG_ID,
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        entityName: "First Bid",
        sheetId: "",
        sheetName: null,
        openedAt: new Date(5000),
      },
      {
        id: "r-2",
        userId: ME,
        organizationId: ORG_ID,
        kind: "project",
        entityId: "proj-9",
        entityCode: "P-9",
        entityName: "Other Device Project",
        sheetId: "sheet-x",
        sheetName: "Sheet X",
        openedAt: new Date(2000),
      },
    ]);

    const res = await request(app).get("/api/takeoff/recents").set(authedHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        entityName: "First Bid",
        sheetId: null,
        sheetName: null,
        openedAt: 5000,
      },
      {
        kind: "project",
        entityId: "proj-9",
        entityCode: "P-9",
        entityName: "Other Device Project",
        sheetId: "sheet-x",
        sheetName: "Sheet X",
        openedAt: 2000,
      },
    ]);
  });
});

describe("POST /api/takeoff/recents", () => {
  it("requires auth", async () => {
    const res = await request(app)
      .post("/api/takeoff/recents")
      .send({ kind: "bid", entityId: "x", entityCode: "y" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid payloads with 400", async () => {
    const res = await request(app)
      .post("/api/takeoff/recents")
      .set(authedHeaders())
      .send({ kind: "marketplace", entityId: "x", entityCode: "y" });
    expect(res.status).toBe(400);
  });

  it("requires the user to belong to an organization", async () => {
    const res = await request(app)
      .post("/api/takeoff/recents")
      .set({
        "x-test-user-id": ME,
        "x-test-role": "ESTIMATOR",
        "x-test-no-org": "1",
      })
      .send({ kind: "bid", entityId: "bid-1", entityCode: "B-1" });
    expect(res.status).toBe(400);
  });

  it("upserts the entry, normalizing missing sheetId to '' and pruning the cap", async () => {
    const res = await request(app)
      .post("/api/takeoff/recents")
      .set(authedHeaders())
      .send({
        kind: "bid",
        entityId: "bid-1",
        entityCode: "B-1",
        entityName: "First Bid",
        sheetId: null,
        sheetName: null,
        openedAt: 1700000000000,
      });

    expect(res.status).toBe(204);
    expect(inserts).toHaveLength(1);
    const captured = inserts[0];
    expect(captured.table).toBe("takeoff_recents");
    expect(captured.values).toMatchObject({
      userId: ME,
      organizationId: ORG_ID,
      kind: "bid",
      entityId: "bid-1",
      entityCode: "B-1",
      entityName: "First Bid",
      sheetId: "",
      sheetName: null,
    });
    // openedAt should be a Date built from the supplied unix-ms timestamp.
    expect(captured.values?.openedAt).toBeInstanceOf(Date);
    expect((captured.values?.openedAt as Date).getTime()).toBe(1700000000000);
    expect(captured.conflict).toBeDefined();
    // Pruning is performed via a raw db.execute SQL statement after the upsert.
    expect(executeCalls.length).toBeGreaterThan(0);
  });

  it("clamps wildly future openedAt timestamps to roughly now (clock skew defense)", async () => {
    const res = await request(app)
      .post("/api/takeoff/recents")
      .set(authedHeaders())
      .send({
        kind: "bid",
        entityId: "bid-2",
        entityCode: "B-2",
        openedAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // +1 year
      });

    expect(res.status).toBe(204);
    const stamped = (inserts[0].values?.openedAt as Date).getTime();
    // Should be no further than ~1h ahead of "now".
    expect(stamped).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60 * 1000);
  });

  it("preserves a non-null sheetId on round trip", async () => {
    await request(app)
      .post("/api/takeoff/recents")
      .set(authedHeaders())
      .send({
        kind: "project",
        entityId: "proj-1",
        entityCode: "P-1",
        sheetId: "sheet-zzz",
        sheetName: "Sheet ZZZ",
      });
    expect(inserts[0].values?.sheetId).toBe("sheet-zzz");
    expect(inserts[0].values?.sheetName).toBe("Sheet ZZZ");
  });
});

describe("DELETE /api/takeoff/recents", () => {
  it("requires auth", async () => {
    const res = await request(app)
      .delete("/api/takeoff/recents")
      .send({ kind: "bid", entityId: "bid-1" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid payloads", async () => {
    const res = await request(app)
      .delete("/api/takeoff/recents")
      .set(authedHeaders())
      .send({ kind: "bogus" });
    expect(res.status).toBe(400);
  });

  it("issues a delete against takeoff_recents on success", async () => {
    const res = await request(app)
      .delete("/api/takeoff/recents")
      .set(authedHeaders())
      .send({ kind: "bid", entityId: "bid-1", sheetId: null });
    expect(res.status).toBe(204);
    expect(deletes).toEqual([{ table: "takeoff_recents" }]);
  });
});

// Task #2104 — "Clear all" wipes every recents row for the calling user.
describe("DELETE /api/takeoff/recents/all", () => {
  it("requires auth", async () => {
    const res = await request(app).delete("/api/takeoff/recents/all");
    expect(res.status).toBe(401);
  });

  it("issues a single delete against takeoff_recents for the caller", async () => {
    const res = await request(app)
      .delete("/api/takeoff/recents/all")
      .set(authedHeaders());
    expect(res.status).toBe(204);
    expect(deletes).toEqual([{ table: "takeoff_recents" }]);
  });
});
