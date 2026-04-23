/**
 * Task #1260 — verify the per-type in-app mute is decoupled from
 * outbound channel delivery and that the in-app feed endpoints
 * correctly hide muted types at read time.
 *
 * Invariants exercised here:
 *   1. `insertNotifications` always inserts the row regardless of
 *      `notification_type_prefs.in_app_enabled`. This keeps email,
 *      push, SMS, Teams, and Slack routing free to follow their own
 *      per-type prefs through `deliverNotification`.
 *   2. `GET /api/notifications` filters out rows whose type the user
 *      has explicitly muted via `in_app_enabled = false`, so a user
 *      who turned the SWPPP overdue feed off does not see those
 *      entries even though they still get the email if their email
 *      pref is on.
 *   3. `GET /api/notifications/unread-count` uses the same filter so
 *      the badge matches the visible feed.
 *   4. NULL `in_app_enabled` (the legacy default) is treated as
 *      "not configured" and preserves the original behavior.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { inspect } from "node:util";

/**
 * Drizzle SQL/Operator objects are deeply recursive (table -> columns ->
 * table). Walk them defensively and stringify via `node:util.inspect`,
 * which handles the cycles and emits a flat searchable representation.
 */
function describeWhere(w: unknown): string {
  return inspect(w, { depth: 20, breakLength: Infinity, maxStringLength: Infinity }).toLowerCase();
}

type Row = Record<string, unknown>;

const selectQueue: Array<{ table: string; rows: Row[] }> = [];
const insertedByTable: Record<string, unknown[]> = {};
const lastWhereByTable: Record<string, unknown> = {};

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
  chain.where = (w: unknown) => {
    lastWhereByTable[resolvedTable] = w;
    return chain;
  };
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  const settle = (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) => {
    try {
      // Find the next queued result whose table matches; fall back to [].
      const idx = selectQueue.findIndex((q) => q.table === resolvedTable);
      const rows = idx >= 0 ? selectQueue.splice(idx, 1)[0].rows : [];
      return Promise.resolve(rows).then(resolve, reject);
    } catch (err) {
      return reject ? reject(err) : Promise.reject(err);
    }
  };
  chain.then = settle;
  chain.catch = (reject: (e: unknown) => unknown) => settle((v) => v, reject);
  return chain;
}

function makeInsertChain(t: unknown) {
  const tName = tableName(t);
  const chain: Record<string, unknown> = {};
  chain.values = (vals: unknown) => {
    (insertedByTable[tName] ??= []).push(vals);
    chain.returning = async () => {
      const arr = Array.isArray(vals) ? vals : [vals];
      return arr.map((v, i) => ({
        ...(v as object),
        id: `gen-${tName}-${i}`,
      }));
    };
    return chain;
  };
  return chain;
}

const dbMock = {
  select: () => makeSelectChain(),
  insert: (t: unknown) => makeInsertChain(t),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

const deliveredRecords: unknown[] = [];
vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async (rec: unknown) => {
    deliveredRecords.push(rec);
  }),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn(),
}));

vi.mock("../auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => next(),
}));

let insertNotifications: typeof import("../services/notificationService")["insertNotifications"];
let notifRouter: any;

beforeEach(async () => {
  selectQueue.length = 0;
  for (const k of Object.keys(insertedByTable)) delete insertedByTable[k];
  for (const k of Object.keys(lastWhereByTable)) delete lastWhereByTable[k];
  deliveredRecords.length = 0;
  vi.useFakeTimers();
  vi.resetModules();
  ({ insertNotifications } = await import("../services/notificationService"));
  notifRouter = (await import("../notificationRoutes2")).default;
});

/**
 * Drive an Express router by extracting the handler stack and invoking
 * the matching layer for `method + path`. Avoids spinning up a full
 * supertest stack and keeps the test hermetic.
 */
async function callRoute(method: string, path: string, user: { id: string; organizationId?: string | null }) {
  const layer = notifRouter.stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method.toLowerCase()],
  );
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  const handlers = layer.route.stack.map((s: any) => s.handle);

  const req: any = { user, params: {}, query: {}, headers: {} };
  let statusCode = 200;
  let body: unknown = undefined;
  const res: any = {
    status(c: number) { statusCode = c; return res; },
    json(b: unknown) { body = b; return res; },
  };
  for (const h of handlers) {
    await new Promise<void>((resolve, reject) => {
      let called = false;
      const next = (err?: unknown) => { called = true; err ? reject(err) : resolve(); };
      const ret = h(req, res, next);
      if (ret && typeof ret.then === "function") ret.then(() => { if (!called) resolve(); }, reject);
      else if (!called) resolve();
    });
  }
  return { statusCode, body };
}

describe("insertNotifications keeps in-app and outbound channels decoupled", () => {
  it("inserts and dispatches delivery for every recipient regardless of in-app pref", async () => {
    // The service no longer reads `notification_type_prefs` before insert.
    // Mute is applied at read time on the feed endpoints, so delivery
    // (email/push/SMS/etc.) flows through normal channels even when a
    // user has explicitly muted the in-app feed for that type.
    await insertNotifications([
      {
        userId: "user-muted",
        organizationId: "org-1",
        type: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
        title: "SWPPP overdue",
        message: "Repair silt fence",
      },
      {
        userId: "user-keeps",
        organizationId: "org-1",
        type: "SWPPP_OVERDUE_CORRECTIVE_ACTION",
        title: "SWPPP overdue",
        message: "Repair silt fence",
      },
    ]);

    const inserted = (insertedByTable["notifications"] ?? []).flat() as Array<{ userId: string }>;
    expect(inserted.map((n) => n.userId).sort()).toEqual(["user-keeps", "user-muted"]);

    await vi.runAllTimersAsync();
    expect(
      (deliveredRecords as Array<{ userId: string }>).map((r) => r.userId).sort(),
    ).toEqual(["user-keeps", "user-muted"]);
  });
});

describe("GET /api/notifications hides in-app-muted types", () => {
  it("omits SWPPP-muted rows from the feed when the user has inAppEnabled=false", async () => {
    // 1st DB read: prefs lookup → user muted SWPPP, REMINDER null, BILLING true.
    // 2nd DB read: feed lookup → returns whatever the route asks for; we
    //   capture the WHERE clause to confirm it includes a NOT IN filter.
    selectQueue.push({
      table: "notification_type_prefs",
      rows: [
        { notificationType: "SWPPP_OVERDUE_CORRECTIVE_ACTION", inAppEnabled: false },
        { notificationType: "REMINDER", inAppEnabled: null },
        { notificationType: "BILLING_READY", inAppEnabled: true },
      ],
    });
    selectQueue.push({
      table: "notifications",
      rows: [
        { id: "n1", userId: "u1", type: "REMINDER", title: "r" },
        { id: "n2", userId: "u1", type: "BILLING_READY", title: "b" },
      ],
    });

    const { body, statusCode } = await callRoute("get", "/api/notifications", {
      id: "u1", organizationId: "org-1",
    });
    expect(statusCode).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // The handler stitched a NOT IN(...) sub-clause onto the feed query.
    const where = lastWhereByTable["notifications"];
    expect(describeWhere(where)).toContain("not in");
  });

  it("does NOT add a mute filter when the user has no muted types", async () => {
    selectQueue.push({
      table: "notification_type_prefs",
      rows: [
        { notificationType: "SWPPP_OVERDUE_CORRECTIVE_ACTION", inAppEnabled: true },
        { notificationType: "REMINDER", inAppEnabled: null },
      ],
    });
    selectQueue.push({ table: "notifications", rows: [] });

    await callRoute("get", "/api/notifications", { id: "u2", organizationId: "org-1" });
    const where = lastWhereByTable["notifications"];
    expect(describeWhere(where)).not.toContain("not in");
  });
});

describe("GET /api/notifications/unread-count honors the same mute set", () => {
  it("appends a NOT IN filter to the count query when the user has muted types", async () => {
    selectQueue.push({
      table: "notification_type_prefs",
      rows: [
        { notificationType: "SWPPP_OVERDUE_CORRECTIVE_ACTION", inAppEnabled: false },
      ],
    });
    selectQueue.push({ table: "notifications", rows: [{ count: 0 }] });

    const { body } = await callRoute("get", "/api/notifications/unread-count", {
      id: "u3", organizationId: "org-1",
    });
    expect(body).toEqual({ count: 0 });
    const where = lastWhereByTable["notifications"];
    expect(describeWhere(where)).toContain("not in");
  });
});
