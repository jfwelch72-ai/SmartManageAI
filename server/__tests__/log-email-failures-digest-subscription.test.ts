/**
 * Task #1731 — Coverage for the dashboard-side digest subscription
 * endpoints exposed at:
 *
 *   GET  /api/notifications/preferences/log-email-failures-digest
 *   PUT  /api/notifications/preferences/log-email-failures-digest
 *
 * These back the inline mute card on `/admin/log-email-failures` so an
 * admin can mute / unmute the daily failures digest without leaving
 * the dashboard. The card writes the same `notification_type_prefs`
 * row the standard settings page upserts, so the channel resolver in
 * `notificationDelivery.ts` (and the in-app feed filter) honor the
 * mute identically.
 *
 * Verified invariants:
 *   1. Auth gate — anonymous → 401; MANAGER/SUPERINTENDENT → 403; the
 *      digest job only delivers to ADMIN/SUPER_ADMIN, so a switch for
 *      lower roles would write a pref row that does nothing.
 *   2. GET defaults — with no override row, `emailEnabled` mirrors the
 *      channel-level setting and `inAppEnabled` defaults to true (the
 *      "not configured" Task #1260 default).
 *   3. PUT round-trips — `{ emailEnabled: false }` upserts the row and
 *      the next GET sees `emailEnabled: false` while leaving the
 *      `inAppEnabled` default intact (and vice versa).
 *   4. Partial update preserves the other channel — toggling email
 *      doesn't clobber a previously-set `inAppEnabled` value, because
 *      the SET clause only writes the columns the caller specified.
 *   5. Validation — empty body is rejected with 400 (no fields to
 *      update).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

type TestUser = { id: string; role: string; organizationId?: string | null } | null;
type Row = Record<string, unknown>;

let testUser: TestUser = null;

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
  requireRole: (...allowed: string[]) =>
    (req: Request & { user?: TestUser }, res: Response, next: NextFunction) => {
      if (!testUser || !allowed.includes(testUser.role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    },
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
  testUser = { id: "user-admin-1", role: "ADMIN", organizationId: "org-1" };
  store.notification_channel_prefs = [];
  store.notification_type_prefs = [];
});

const URL = "/api/notifications/preferences/log-email-failures-digest";

describe("Task #1731 — failures digest subscription endpoints", () => {
  describe("auth gating", () => {
    it("rejects anonymous GET with 401", async () => {
      testUser = null;
      const res = await request(app).get(URL);
      expect(res.status).toBe(401);
    });

    it("rejects anonymous PUT with 401", async () => {
      testUser = null;
      const res = await request(app).put(URL).send({ emailEnabled: false });
      expect(res.status).toBe(401);
    });

    it("rejects MANAGER GET with 403 (digest only delivers to ADMIN/SUPER_ADMIN)", async () => {
      testUser = { id: "user-mgr-1", role: "MANAGER", organizationId: "org-1" };
      const res = await request(app).get(URL);
      expect(res.status).toBe(403);
    });

    it("rejects MANAGER PUT with 403", async () => {
      testUser = { id: "user-mgr-1", role: "MANAGER", organizationId: "org-1" };
      const res = await request(app).put(URL).send({ emailEnabled: false });
      expect(res.status).toBe(403);
    });

    it("rejects SUPERINTENDENT GET with 403", async () => {
      testUser = { id: "user-super-1", role: "SUPERINTENDENT", organizationId: "org-1" };
      const res = await request(app).get(URL);
      expect(res.status).toBe(403);
    });

    it("allows SUPER_ADMIN", async () => {
      testUser = { id: "user-superadmin-1", role: "SUPER_ADMIN", organizationId: "org-1" };
      const res = await request(app).get(URL);
      expect(res.status).toBe(200);
    });
  });

  describe("GET defaults", () => {
    it("returns email-off and in-app-on when no rows exist", async () => {
      const res = await request(app).get(URL);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        notificationType: "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
        emailEnabled: false,
        inAppEnabled: true,
        channelEmailEnabled: false,
        emailOverride: null,
        inAppOverride: null,
      });
    });

    it("mirrors channel email when no override row exists", async () => {
      // Seed a channel row with email opted in.
      store.notification_channel_prefs.push({
        userId: testUser!.id,
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
      });
      const res = await request(app).get(URL);
      expect(res.status).toBe(200);
      expect(res.body.emailEnabled).toBe(true);
      expect(res.body.channelEmailEnabled).toBe(true);
      expect(res.body.inAppEnabled).toBe(true);
      expect(res.body.emailOverride).toBeNull();
    });

    it("treats inAppEnabled=null on an existing override as 'in-app on' (Task #1260 default)", async () => {
      store.notification_type_prefs.push({
        userId: testUser!.id,
        notificationType: "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
        inAppEnabled: null,
      });
      const res = await request(app).get(URL);
      expect(res.body.inAppEnabled).toBe(true);
      expect(res.body.inAppOverride).toBeNull();
    });

    it("returns inAppEnabled=false when the override row explicitly mutes the in-app feed", async () => {
      store.notification_type_prefs.push({
        userId: testUser!.id,
        notificationType: "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
        inAppEnabled: false,
      });
      const res = await request(app).get(URL);
      expect(res.body.inAppEnabled).toBe(false);
      expect(res.body.inAppOverride).toBe(false);
    });
  });

  describe("PUT round-trips", () => {
    it("persists emailEnabled=false and the GET picks it up", async () => {
      // Seed channel email so we can verify the override beats the
      // channel default.
      store.notification_channel_prefs.push({
        userId: testUser!.id,
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
      });
      const put = await request(app).put(URL).send({ emailEnabled: false });
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ success: true });

      const get = await request(app).get(URL);
      expect(get.body.emailEnabled).toBe(false);
      expect(get.body.emailOverride).toBe(false);
      // In-app default carries through (no override stored for it).
      expect(get.body.inAppEnabled).toBe(true);
      expect(get.body.inAppOverride).toBeNull();
    });

    it("persists inAppEnabled=false without affecting email", async () => {
      store.notification_channel_prefs.push({
        userId: testUser!.id,
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
      });
      const put = await request(app).put(URL).send({ inAppEnabled: false });
      expect(put.status).toBe(200);

      const get = await request(app).get(URL);
      expect(get.body.inAppEnabled).toBe(false);
      expect(get.body.inAppOverride).toBe(false);
      // Email seeds from channel-level (true) on the first insert.
      expect(get.body.emailEnabled).toBe(true);
    });

    it("partial update preserves the other channel's previously-stored value", async () => {
      // First call sets in-app to false.
      await request(app).put(URL).send({ inAppEnabled: false }).expect(200);
      // Second call only toggles email — the in-app value must
      // survive the conflict-update because the SET clause should not
      // include `inAppEnabled` when the caller didn't specify it.
      await request(app).put(URL).send({ emailEnabled: true }).expect(200);

      const get = await request(app).get(URL);
      expect(get.body.inAppEnabled).toBe(false);
      expect(get.body.emailEnabled).toBe(true);
    });

    it("toggles back on after a mute", async () => {
      await request(app).put(URL).send({ emailEnabled: false }).expect(200);
      await request(app).put(URL).send({ emailEnabled: true }).expect(200);
      const get = await request(app).get(URL);
      expect(get.body.emailEnabled).toBe(true);
      expect(get.body.emailOverride).toBe(true);
    });
  });

  describe("validation", () => {
    it("rejects an empty body with 400", async () => {
      const res = await request(app).put(URL).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid digest subscription payload/i);
    });

    it("rejects non-boolean fields with 400", async () => {
      const res = await request(app).put(URL).send({ emailEnabled: "no" });
      expect(res.status).toBe(400);
    });
  });
});
