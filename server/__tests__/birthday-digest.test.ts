/**
 * Task #697: regression tests for the timezone-aware CRM contact
 * birthday digest job in `server/jobs/jobRunner.ts`.
 *
 * The function under test:
 *   - Gates each recipient by their *local* Monday 8am wall clock (so
 *     a UTC server can still send to a Tokyo user on their local Monday).
 *   - Falls back to the server default timezone when the user's saved
 *     timezone is missing or invalid.
 *   - Performs a 7-day per-user dedupe against the `notifications` table
 *     so hourly cron drift / DST transitions / manual re-runs don't
 *     trigger duplicate digests.
 *   - Supports a `{ ignoreTimeOfDay: true }` manual-trigger path that
 *     bypasses the time gate but still respects the dedupe.
 *
 * The job talks to Postgres via Drizzle and to the notification service
 * for inserts. Both are mocked in-process here so the tests are
 * hermetic and can manipulate the system clock to assert behaviour at
 * specific UTC instants.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory db mock. We route results based on the table passed to .from().
// Each test seeds:
//   executeQueue   — results for db.execute(sql`...`)  (org id list)
//   selectByTable  — keyed by drizzle table name, FIFO arrays of result rows
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const executeQueue: Array<{ rows: Row[] }> = [];
const selectByTable: Record<string, Row[][]> = {};

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
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.limit = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
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
  execute: async () =>
    executeQueue.length ? executeQueue.shift()! : { rows: [] },
  select: (_cols?: unknown) => makeSelectChain(),
  insert: () => ({ values: async () => undefined }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  delete: () => ({ where: async () => undefined }),
};

vi.mock("../db", () => ({ db: dbMock, pool: {} }));

// Capture insertNotifications calls so we can assert which users got a
// digest on each tick. The real notificationService writes to the db /
// dispatches email; both are out of scope here.
const insertedNotifications: unknown[][] = [];
vi.mock("../services/notificationService", () => ({
  insertNotification: vi.fn(async () => undefined),
  insertNotifications: vi.fn(async (rows: unknown[]) => {
    insertedNotifications.push(rows);
  }),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// ---------------------------------------------------------------------------

let processCrmContactBirthdayDigest: typeof import("../jobs/jobRunner")["processCrmContactBirthdayDigest"];
let getLocalDateParts: typeof import("../jobs/jobRunner")["getLocalDateParts"];

beforeEach(async () => {
  executeQueue.length = 0;
  for (const k of Object.keys(selectByTable)) delete selectByTable[k];
  insertedNotifications.length = 0;
  ({ processCrmContactBirthdayDigest, getLocalDateParts } = await import(
    "../jobs/jobRunner"
  ));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

// Convenience: queue a "one org with birthdays" execute() result.
function queueOrg(orgId = "org-1") {
  executeQueue.push({ rows: [{ id: orgId }] });
}

function queueUsers(rows: Row[]) {
  (selectByTable["users"] ??= []).push(rows);
}
function queueRecentlyNotified(rows: Row[]) {
  (selectByTable["notifications"] ??= []).push(rows);
}
function queueContacts(rows: Row[]) {
  (selectByTable["crm_contacts"] ??= []).push(rows);
}

// Build a contact row with a birthday today (server-local) so that
// every test produces a non-empty digest body (otherwise the job skips
// the bucket as "no birthdays this week").
function contactToday(now: Date, tz: string, orgName: string | null = null) {
  const parts = getLocalDateParts(now, tz);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return {
    firstName: "Birthday",
    lastName: "Person",
    birthday: `1990-${month}-${day}`,
    orgName,
  };
}

// ---------------------------------------------------------------------------

describe("getLocalDateParts (timezone gating helper)", () => {
  it("returns local Monday 8am for an Asia/Tokyo user when UTC is Sunday 23:00", () => {
    // 2026-04-19 23:00 UTC === 2026-04-20 08:00 Tokyo (Mon)
    const now = new Date("2026-04-19T23:00:00Z");
    const tokyo = getLocalDateParts(now, "Asia/Tokyo");
    expect(tokyo.weekday).toBe(1);
    expect(tokyo.hour).toBe(8);

    // The same instant is 2026-04-19 19:00 NY (EDT, Sunday) — not eligible.
    const ny = getLocalDateParts(now, "America/New_York");
    expect(ny.weekday).toBe(0);
    expect(ny.hour).toBe(19);
  });

  it("falls back to the server default when given an invalid timezone", () => {
    process.env.TZ = "America/New_York";
    const now = new Date("2026-04-20T12:00:00Z"); // 08:00 EDT, Mon
    const parts = getLocalDateParts(now, "Not/A/Real_Zone");
    expect(parts.tz).toBe("America/New_York");
    expect(parts.weekday).toBe(1);
    expect(parts.hour).toBe(8);
  });
});

describe("processCrmContactBirthdayDigest — per-user timezone gating", () => {
  it("sends to the Tokyo user but not the New York user when UTC is Sun 23:00", async () => {
    const now = new Date("2026-04-19T23:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrg();
    queueUsers([
      { id: "user-tokyo", timezone: "Asia/Tokyo" },
      { id: "user-ny", timezone: "America/New_York" },
    ]);
    queueRecentlyNotified([]);
    // Build a contact that's "today" in Tokyo so the digest has content.
    queueContacts([contactToday(now, "Asia/Tokyo")]);

    await processCrmContactBirthdayDigest();

    expect(insertedNotifications).toHaveLength(1);
    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    expect(flat.map((n) => n.userId)).toEqual(["user-tokyo"]);
  });

  it("sends to the New York user (not Tokyo) when UTC is Mon 12:00", async () => {
    // 2026-04-20 12:00 UTC === 2026-04-20 08:00 NY (EDT, Mon).
    // Same instant is 2026-04-20 21:00 Tokyo (Mon evening) — not eligible.
    const now = new Date("2026-04-20T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrg();
    queueUsers([
      { id: "user-ny", timezone: "America/New_York" },
      { id: "user-tokyo", timezone: "Asia/Tokyo" },
    ]);
    queueRecentlyNotified([]);
    queueContacts([contactToday(now, "America/New_York")]);

    await processCrmContactBirthdayDigest();

    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    expect(flat.map((n) => n.userId)).toEqual(["user-ny"]);
  });

  it("uses the server default timezone when the user's tz is missing or invalid", async () => {
    process.env.TZ = "America/New_York";
    const now = new Date("2026-04-20T12:00:00Z"); // Mon 08:00 NY
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrg();
    queueUsers([
      { id: "user-null-tz", timezone: null },
      { id: "user-bad-tz", timezone: "Not/A/Real_Zone" },
    ]);
    queueRecentlyNotified([]);
    queueContacts([contactToday(now, "America/New_York")]);

    await processCrmContactBirthdayDigest();

    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    // Both users fall through to the server default (NY) and so are
    // both eligible at 08:00 NY on a Monday.
    expect(new Set(flat.map((n) => n.userId))).toEqual(
      new Set(["user-null-tz", "user-bad-tz"]),
    );
  });
});

describe("processCrmContactBirthdayDigest — 7-day dedupe", () => {
  it("does not insert a second notification for a user already notified within 7 days", async () => {
    process.env.TZ = "America/New_York";
    const now = new Date("2026-04-20T12:00:00Z"); // Mon 08:00 NY
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrg();
    queueUsers([
      { id: "user-fresh", timezone: "America/New_York" },
      { id: "user-recent", timezone: "America/New_York" },
    ]);
    // Simulate that user-recent already received a digest two days ago.
    queueRecentlyNotified([{ userId: "user-recent" }]);
    queueContacts([contactToday(now, "America/New_York")]);

    await processCrmContactBirthdayDigest();

    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    expect(flat.map((n) => n.userId)).toEqual(["user-fresh"]);
  });

  it("a second cron tick within the same week does not double-send", async () => {
    process.env.TZ = "America/New_York";
    const firstTick = new Date("2026-04-20T12:00:00Z"); // Mon 08:00 NY
    vi.useFakeTimers();
    vi.setSystemTime(firstTick);

    // First tick: fresh send.
    queueOrg();
    queueUsers([{ id: "user-1", timezone: "America/New_York" }]);
    queueRecentlyNotified([]);
    queueContacts([contactToday(firstTick, "America/New_York")]);
    await processCrmContactBirthdayDigest();
    expect(insertedNotifications.flat()).toHaveLength(1);

    // Second tick still inside the 7-day dedupe window. The
    // notifications table now reports the prior send for user-1, so
    // even though the time gate matches again the job should insert
    // nothing.
    insertedNotifications.length = 0;
    queueOrg();
    queueUsers([{ id: "user-1", timezone: "America/New_York" }]);
    // Now the notifications table reports the first send.
    queueRecentlyNotified([{ userId: "user-1" }]);
    queueContacts([contactToday(firstTick, "America/New_York")]);

    await processCrmContactBirthdayDigest();
    expect(insertedNotifications).toHaveLength(0);
  });
});

describe("processCrmContactBirthdayDigest — manual trigger", () => {
  it("ignoreTimeOfDay sends regardless of wall clock", async () => {
    process.env.TZ = "America/New_York";
    // Wednesday afternoon — would never pass the Monday 8am gate.
    const now = new Date("2026-04-22T18:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrg();
    queueUsers([{ id: "user-1", timezone: "America/New_York" }]);
    queueRecentlyNotified([]);
    queueContacts([contactToday(now, "America/New_York")]);

    await processCrmContactBirthdayDigest({ ignoreTimeOfDay: true });

    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    expect(flat.map((n) => n.userId)).toEqual(["user-1"]);
  });

  it("ignoreTimeOfDay still respects the 7-day dedupe", async () => {
    process.env.TZ = "America/New_York";
    const now = new Date("2026-04-22T18:00:00Z"); // Wed afternoon
    vi.useFakeTimers();
    vi.setSystemTime(now);

    queueOrg();
    queueUsers([
      { id: "user-fresh", timezone: "America/New_York" },
      { id: "user-recent", timezone: "America/New_York" },
    ]);
    queueRecentlyNotified([{ userId: "user-recent" }]);
    queueContacts([contactToday(now, "America/New_York")]);

    await processCrmContactBirthdayDigest({ ignoreTimeOfDay: true });

    const flat = insertedNotifications.flat() as Array<{ userId: string }>;
    expect(flat.map((n) => n.userId)).toEqual(["user-fresh"]);
  });
});
