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

    // Task #1747 — Snooze duration must be a positive integer below
    // the configured ceiling (defense-in-depth against typos / scripts
    // setting a mute that effectively never auto-clears).
    it("rejects a non-integer snooze duration with 400", async () => {
      const res = await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: 1.5 });
      expect(res.status).toBe(400);
    });

    it("rejects a zero or negative snooze duration with 400", async () => {
      const r1 = await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: 0 });
      expect(r1.status).toBe(400);
      const r2 = await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: -7 });
      expect(r2.status).toBe(400);
    });

    it("rejects a snooze duration above the 365-day ceiling with 400", async () => {
      const res = await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: 366 });
      expect(res.status).toBe(400);
    });
  });

  // Task #1747 — Snooze (auto-clear) coverage. The dashboard mute card
  // now surfaces "muted N days ago" + "auto-clears in M days" copy
  // sourced from these fields, and the digest delivery / in-app feed
  // both treat an expired snooze as if the override row didn't exist.
  describe("snooze (Task #1747)", () => {
    it("returns mutedAt + null mutedUntil for an indefinite mute (no mutedUntilDays)", async () => {
      const beforeMs = Date.now();
      await request(app).put(URL).send({ emailEnabled: false }).expect(200);
      const get = await request(app).get(URL);
      expect(get.body.emailEnabled).toBe(false);
      expect(get.body.mutedAt).toBeTruthy();
      expect(new Date(get.body.mutedAt).getTime()).toBeGreaterThanOrEqual(beforeMs);
      expect(get.body.mutedUntil).toBeNull();
      expect(get.body.snoozeExpired).toBe(false);
    });

    it("persists a 7-day snooze and returns the future deadline", async () => {
      const beforeMs = Date.now();
      await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: 7 })
        .expect(200);
      const get = await request(app).get(URL);
      expect(get.body.mutedUntil).toBeTruthy();
      const deadline = new Date(get.body.mutedUntil).getTime();
      // Deadline should be ~7 days out (allow 1-second slack for the
      // round-trip).
      const expected = beforeMs + 7 * 24 * 60 * 60 * 1000;
      expect(deadline).toBeGreaterThanOrEqual(expected - 1000);
      expect(deadline).toBeLessThanOrEqual(expected + 5000);
      expect(get.body.snoozeExpired).toBe(false);
    });

    it("treats an expired snooze as no override (effective email falls back to channel default)", async () => {
      // Channel email = true so we can confirm the fallback is real.
      store.notification_channel_prefs.push({
        userId: testUser!.id,
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
      });
      // Seed a stored override row that's already expired (yesterday).
      const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      store.notification_type_prefs.push({
        userId: testUser!.id,
        notificationType: "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
        emailEnabled: false,
        smsEnabled: false,
        pushEnabled: false,
        teamsEnabled: false,
        slackEnabled: false,
        inAppEnabled: false,
        mutedUntil: expiredAt,
        updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      });
      const get = await request(app).get(URL);
      // Expired snooze ⇒ overrides ignored, channel default wins.
      expect(get.body.emailEnabled).toBe(true);
      expect(get.body.inAppEnabled).toBe(true);
      expect(get.body.emailOverride).toBeNull();
      expect(get.body.inAppOverride).toBeNull();
      expect(get.body.snoozeExpired).toBe(true);
      // mutedAt should NOT be reported when the row is logically gone.
      expect(get.body.mutedAt).toBeNull();
      // mutedUntil is still the raw stored value so the UI can label
      // it "expired" if it wants to.
      expect(get.body.mutedUntil).toBeTruthy();
    });

    it("re-enabling clears mutedUntil even if the request omits the field", async () => {
      // Set a 30-day snooze first.
      await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: 30 })
        .expect(200);
      let get = await request(app).get(URL);
      expect(get.body.mutedUntil).toBeTruthy();
      // Now flip email back on without mentioning mutedUntilDays.
      await request(app).put(URL).send({ emailEnabled: true }).expect(200);
      get = await request(app).get(URL);
      expect(get.body.emailEnabled).toBe(true);
      expect(get.body.mutedUntil).toBeNull();
    });

    it("ignores mutedUntilDays when the request unmutes (no snooze on a re-enable)", async () => {
      await request(app)
        .put(URL)
        .send({ emailEnabled: true, mutedUntilDays: 7 })
        .expect(200);
      const get = await request(app).get(URL);
      // No mute = no snooze, regardless of what the caller sent.
      expect(get.body.mutedUntil).toBeNull();
    });

    it("explicit mutedUntilDays=null = indefinite mute (no snooze)", async () => {
      await request(app)
        .put(URL)
        .send({ emailEnabled: false, mutedUntilDays: null })
        .expect(200);
      const get = await request(app).get(URL);
      expect(get.body.emailEnabled).toBe(false);
      expect(get.body.mutedUntil).toBeNull();
    });

    // Regression: a partial-unmute (one channel goes back on while
    // another stays muted) MUST NOT silently promote the surviving
    // channel mute to an indefinite one by clearing the snooze
    // deadline. The snooze should keep ticking on the channel that
    // remains muted.
    it("preserves a future mutedUntil when partially unmuting (other channel still muted)", async () => {
      // Mute BOTH channels with a 30-day snooze.
      await request(app)
        .put(URL)
        .send({ emailEnabled: false, inAppEnabled: false, mutedUntilDays: 30 })
        .expect(200);
      const seeded = await request(app).get(URL);
      const seededDeadline = new Date(seeded.body.mutedUntil).getTime();
      expect(seededDeadline).toBeGreaterThan(Date.now());

      // Now unmute ONLY email (in-app stays muted) without specifying
      // a new snooze duration.
      await request(app).put(URL).send({ emailEnabled: true }).expect(200);
      const after = await request(app).get(URL);
      expect(after.body.emailEnabled).toBe(true);
      expect(after.body.inAppEnabled).toBe(false);
      // Critical: the snooze must survive verbatim — clearing it would
      // silently turn the in-app mute into an indefinite mute.
      expect(after.body.mutedUntil).toBeTruthy();
      expect(new Date(after.body.mutedUntil).getTime()).toBe(seededDeadline);
    });

    it("clears mutedUntil only when the partial update fully unmutes everything", async () => {
      // Mute both with a snooze.
      await request(app)
        .put(URL)
        .send({ emailEnabled: false, inAppEnabled: false, mutedUntilDays: 30 })
        .expect(200);
      // Unmute the in-app channel; email still muted ⇒ snooze preserved.
      await request(app).put(URL).send({ inAppEnabled: true }).expect(200);
      let get = await request(app).get(URL);
      expect(get.body.mutedUntil).toBeTruthy();
      // Now unmute email too ⇒ nothing is muted ⇒ snooze cleared.
      await request(app).put(URL).send({ emailEnabled: true }).expect(200);
      get = await request(app).get(URL);
      expect(get.body.emailEnabled).toBe(true);
      expect(get.body.inAppEnabled).toBe(true);
      expect(get.body.mutedUntil).toBeNull();
    });
  });
});
