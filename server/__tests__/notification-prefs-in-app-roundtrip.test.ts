/**
 * Task #1289 — Route-level coverage for the per-type `inAppEnabled`
 * field added in Task #1260 to GET / PUT `/api/notifications/preferences`.
 *
 * The companion suite (notification-in-app-mute.test.ts) covers the
 * delivery / feed-filter side of the same field. This suite locks in
 * the *transport*: that the request schema accepts the field, the
 * upsert persists it, and the GET response surfaces it back.
 *
 * Verified invariants:
 *   1. Round-trip — PUT { inAppEnabled: false } for
 *      SWPPP_OVERDUE_CORRECTIVE_ACTION followed by GET returns
 *      `inAppEnabled: false` on that override.
 *   2. NULL passthrough — omitting `inAppEnabled` (the legacy default
 *      from older clients) is stored as NULL and returned as NULL,
 *      so the read-time mute filter treats it as "not configured".
 *   3. Tri-state transitions — false → true → null all round-trip
 *      through successive PUTs without leaking the prior value.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

type TestUser = { id: string; role: string; organizationId?: string | null } | null;
type Row = Record<string, unknown>;

let testUser: TestUser = null;

// In-memory store keyed by underlying table name. The route only ever
// reads/writes its own user's rows (filtered by `eq(table.userId, …)`),
// so we partition reads by `testUser.id` rather than parsing the
// drizzle WHERE expression.
const store: Record<string, Row[]> = {
  notification_channel_prefs: [],
  notification_type_prefs: [],
};

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

function makeSelect() {
  let table = "<unknown>";
  const chain: Record<string, unknown> = {};
  chain.from = (t: unknown) => { table = tableName(t); return chain; };
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
    const userId = testUser?.id;
    const rows = (store[table] ?? []).filter((r) => r.userId === userId);
    return Promise.resolve(rows).then(resolve, reject);
  };
  chain.then = settle;
  chain.catch = (rj: (e: unknown) => unknown) => settle((v) => v, rj);
  return chain;
}

function applyUpsert(table: string, insertVals: Row, updateVals: Row) {
  const list = (store[table] ??= []);
  let matches: (r: Row) => boolean;
  if (table === "notification_channel_prefs") {
    matches = (r) => r.userId === insertVals.userId;
  } else if (table === "notification_type_prefs") {
    matches = (r) =>
      r.userId === insertVals.userId &&
      r.notificationType === insertVals.notificationType;
  } else {
    matches = () => false;
  }
  const idx = list.findIndex(matches);
  if (idx >= 0) list[idx] = { ...list[idx], ...updateVals };
  else list.push({ ...insertVals });
}

function makeInsert(t: unknown) {
  const table = tableName(t);
  const chain: Record<string, unknown> = {};
  let valuesPayload: Row | null = null;
  chain.values = (vals: Row) => {
    valuesPayload = vals;
    return chain;
  };
  chain.onConflictDoUpdate = (opts: { target?: unknown; set?: Row }) => {
    const settle = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        // Mirror real `ON CONFLICT DO UPDATE` semantics: when the row
        // already exists, ONLY the columns in `opts.set` are written.
        // Merging the insert payload here would mask a regression where
        // a column gets dropped from the update set but still exists in
        // the insert values.
        applyUpsert(table, valuesPayload as Row, opts.set ?? {});
        return Promise.resolve(undefined).then(resolve, reject);
      } catch (e) {
        return reject ? reject(e) : Promise.reject(e);
      }
    };
    (chain as { then: unknown }).then = settle;
    return chain;
  };
  return chain;
}

vi.mock("../db", () => ({
  db: {
    select: () => makeSelect(),
    insert: (t: unknown) => makeInsert(t),
  },
  pool: {},
}));

vi.mock("../auth", () => ({
  requireAuth: (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
    if (!testUser) { res.status(401).json({ error: "Authentication required" }); return; }
    req.user = testUser;
    next();
  },
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../services/featureAccess", () => ({
  hasFeature: vi.fn(async () => true),
}));

vi.mock("../services/smsService", () => ({
  isTwilioConfigured: () => true,
  isValidE164: () => true,
}));

vi.mock("../services/teamsService", () => ({ isValidTeamsWebhookUrl: () => true }));
vi.mock("../services/slackService", () => ({ isValidSlackWebhookUrl: () => true }));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

let app: Express;

beforeAll(async () => {
  const { default: router } = await import("../notificationPreferencesRoutes");
  app = express();
  app.use(express.json());
  app.use(router);
});

beforeEach(() => {
  testUser = { id: "user-test", role: "ADMIN", organizationId: "org-1" };
  store.notification_channel_prefs = [];
  store.notification_type_prefs = [];
});

const BASE_CHANNEL = {
  emailEnabled: true,
  smsEnabled: false,
  pushEnabled: true,
  teamsEnabled: false,
  slackEnabled: false,
} as const;

function findOverride(body: { typeOverrides?: Array<Row> }, type: string): Row | undefined {
  return (body.typeOverrides ?? []).find((o) => o.notificationType === type);
}

describe("Task #1289 — inAppEnabled round-trips through PUT/GET preferences", () => {
  it("persists inAppEnabled=false and surfaces it on the next GET", async () => {
    const put = await request(app)
      .put("/api/notifications/preferences")
      .send({
        channel: BASE_CHANNEL,
        typeOverrides: {
          SWPPP_OVERDUE_CORRECTIVE_ACTION: { inAppEnabled: false },
        },
      });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ success: true });

    const get = await request(app).get("/api/notifications/preferences");
    expect(get.status).toBe(200);
    const row = findOverride(get.body, "SWPPP_OVERDUE_CORRECTIVE_ACTION");
    expect(row, "expected an override row to be returned").toBeDefined();
    expect(row!.inAppEnabled).toBe(false);
  });

  it("treats an omitted inAppEnabled as NULL (legacy 'not configured' default)", async () => {
    // Older clients don't send the field at all. The route must default
    // to NULL so the feed filter (inAppEnabled === false) doesn't match.
    const put = await request(app)
      .put("/api/notifications/preferences")
      .send({
        channel: BASE_CHANNEL,
        typeOverrides: {
          SWPPP_OVERDUE_CORRECTIVE_ACTION: { emailEnabled: true },
        },
      });
    expect(put.status).toBe(200);

    const get = await request(app).get("/api/notifications/preferences");
    const row = findOverride(get.body, "SWPPP_OVERDUE_CORRECTIVE_ACTION");
    expect(row).toBeDefined();
    expect(row!.inAppEnabled).toBeNull();
  });

  it("accepts an explicit null and returns null (not undefined or false)", async () => {
    await request(app)
      .put("/api/notifications/preferences")
      .send({
        channel: BASE_CHANNEL,
        typeOverrides: {
          SWPPP_OVERDUE_CORRECTIVE_ACTION: { inAppEnabled: null },
        },
      })
      .expect(200);

    const get = await request(app).get("/api/notifications/preferences");
    const row = findOverride(get.body, "SWPPP_OVERDUE_CORRECTIVE_ACTION");
    expect(row).toBeDefined();
    expect(row!.inAppEnabled).toBeNull();
  });

  it("round-trips false → true → null without leaking the prior value", async () => {
    const put = (inApp: boolean | null) =>
      request(app)
        .put("/api/notifications/preferences")
        .send({
          channel: BASE_CHANNEL,
          typeOverrides: {
            SWPPP_OVERDUE_CORRECTIVE_ACTION: { inAppEnabled: inApp },
          },
        })
        .expect(200);

    const fetchInApp = async () => {
      const r = await request(app).get("/api/notifications/preferences");
      return findOverride(r.body, "SWPPP_OVERDUE_CORRECTIVE_ACTION")?.inAppEnabled;
    };

    await put(false);
    expect(await fetchInApp()).toBe(false);

    await put(true);
    expect(await fetchInApp()).toBe(true);

    await put(null);
    expect(await fetchInApp()).toBeNull();
  });

  it("updates an existing override row strictly via the conflict-update set clause", async () => {
    // Seed the row with inAppEnabled=false.
    await request(app)
      .put("/api/notifications/preferences")
      .send({
        channel: BASE_CHANNEL,
        typeOverrides: {
          SWPPP_OVERDUE_CORRECTIVE_ACTION: {
            inAppEnabled: false,
            emailEnabled: false,
          },
        },
      })
      .expect(200);

    // A second PUT must overwrite via the ON CONFLICT DO UPDATE branch.
    // Our mock now applies ONLY the columns in `opts.set` on conflict
    // (matching real Postgres semantics), so this test would fail if a
    // future refactor accidentally dropped `inAppEnabled` from the set
    // clause while leaving it in the insert values.
    await request(app)
      .put("/api/notifications/preferences")
      .send({
        channel: BASE_CHANNEL,
        typeOverrides: {
          SWPPP_OVERDUE_CORRECTIVE_ACTION: {
            inAppEnabled: true,
            emailEnabled: true,
          },
        },
      })
      .expect(200);

    const get = await request(app).get("/api/notifications/preferences");
    const row = findOverride(get.body, "SWPPP_OVERDUE_CORRECTIVE_ACTION");
    expect(row).toBeDefined();
    expect(row!.inAppEnabled).toBe(true);
    expect(row!.emailEnabled).toBe(true);
  });
});
