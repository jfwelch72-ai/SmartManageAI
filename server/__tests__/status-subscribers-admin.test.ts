/**
 * End-to-end tests for the bounce/complaint pipeline (Tasks #858, #868).
 *
 * Covers the full path from a Resend webhook delivery landing on
 * POST /api/webhooks/email/resend, through the row that gets persisted
 * in `status_subscriber_email_events`, to the aggregate query exposed
 * at GET /api/admin/status/subscribers.
 *
 * Uses the real test database (provisioned by globalSetup) so the
 * insert path in `server/emailWebhookRoutes.ts` and the LATERAL
 * aggregate in `server/statusPageRoutes.ts` are exercised end-to-end.
 * Auth is mocked so we can act as SUPER_ADMIN / ADMIN / unauthenticated
 * without standing up the full session/cookie stack.
 *
 * Acceptance criteria from Task #868 covered here:
 *   1. POST with a valid shared secret → 202 + row inserted into
 *      status_subscriber_email_events.
 *   2. POST with an invalid token → 401 + no row inserted.
 *   3. POST with a valid Svix signature → accepted; same event with a
 *      tampered body → rejected (no row inserted).
 *   4. GET /api/admin/status/subscribers as SUPER_ADMIN populates
 *      bounce_count / complaint_count / last_event_at / last_event_type
 *      after webhook events have been persisted.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import crypto from "crypto";
import { sql } from "drizzle-orm";

type TestUser = { id: string; role: string; effectiveRole?: string } | null;
let testUser: TestUser = null;

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

// Heavy modules pulled in by the routers we mount that aren't relevant here.
vi.mock("../statusProbeScheduler", () => ({ runProbeSweep: vi.fn() }));
vi.mock("../statusAlertService", () => ({
  getAlertOverview: vi.fn(),
  sendTestAlert: vi.fn(),
}));
vi.mock("../services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../emailRoutes", () => ({
  syncGmailAccount: vi.fn(),
  syncOutlookAccount: vi.fn(),
  gmailApiFetch: vi.fn(),
  outlookApiFetch: vi.fn(),
}));
vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

const TEST_EMAIL_PREFIX = "__bounce_e2e_test__";
const SHARED_SECRET = "shared-token-e2e";
// Svix signing secrets are base64; the `whsec_` prefix is optional.
const RAW_SIGNING_SECRET_B64 = Buffer.from("e2e-signing-key").toString("base64");
const SIGNING_SECRET_ENV = `whsec_${RAW_SIGNING_SECRET_B64}`;

let app: Express;
let db: typeof import("../db").db;

function buildSvixHeaders(rawBody: string, secretB64: string) {
  const id = `msg_${Math.random().toString(36).slice(2, 10)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(secretB64, "base64");
  const signed = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac("sha256", key).update(signed).digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sig}`,
  };
}

async function cleanup() {
  await db.execute(sql`
    DELETE FROM "status_subscriber_email_events" WHERE lower(email) LIKE ${`${TEST_EMAIL_PREFIX}%`}
  `);
  await db.execute(sql`
    DELETE FROM "status_subscribers" WHERE lower(email) LIKE ${`${TEST_EMAIL_PREFIX}%`}
  `);
}

async function countEventsFor(email: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM "status_subscriber_email_events"
    WHERE lower(email) = lower(${email})
  `);
  return (r.rows[0] as { c: number }).c;
}

beforeAll(async () => {
  ({ db } = await import("../db"));
  const { ensureStatusPageTables } = await import("../utils/ensureStatusPageTables");
  await ensureStatusPageTables();

  const { default: statusPageRoutes } = await import("../statusPageRoutes");
  const { default: emailWebhookRoutes } = await import("../emailWebhookRoutes");

  app = express();
  // Replicates server/index.ts so req.rawBody is a Buffer for Svix signing.
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(statusPageRoutes);
  app.use("/api/webhooks/email", emailWebhookRoutes);

  await cleanup();
});

beforeEach(async () => {
  testUser = null;
  process.env.RESEND_WEBHOOK_SECRET = SHARED_SECRET;
  delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  delete process.env.EMAIL_WEBHOOK_SECRET;
  await cleanup();
});

afterAll(async () => {
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  delete process.env.EMAIL_WEBHOOK_SECRET;
  await cleanup();
});

function bounceEvent(email: string, when = "2026-04-22T10:00:00Z") {
  return {
    type: "email.bounced",
    created_at: when,
    data: {
      email_id: "evt-" + Math.random().toString(36).slice(2, 8),
      to: [email],
      from: "noreply@example.com",
      subject: "Test",
      bounce: { type: "hard", message: "Mailbox does not exist" },
    },
  };
}

// Webhook handler ACKs synchronously and processes events in a fire-and-forget
// loop. Wait briefly so the asynchronous insert(s) settle before asserting.
async function waitForEvents(email: string, expected: number, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = await countEventsFor(email);
    if (last >= expected) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  return last;
}

describe("Resend webhook → DB persistence (Task #868 acceptance #1-3)", () => {
  it("inserts a status_subscriber_email_events row for a valid shared-secret delivery", async () => {
    const email = `${TEST_EMAIL_PREFIX}sharedok@example.com`;
    const evt = bounceEvent(email);

    const res = await request(app)
      .post(`/api/webhooks/email/resend?token=${SHARED_SECRET}`)
      .set("Content-Type", "application/json")
      .send(evt);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true, accepted: 1 });

    const count = await waitForEvents(email, 1);
    expect(count).toBe(1);

    const r = await db.execute(sql`
      SELECT event_type, provider, reason FROM "status_subscriber_email_events"
      WHERE lower(email) = lower(${email})
    `);
    const row = r.rows[0] as { event_type: string; provider: string; reason: string };
    expect(row.event_type).toBe("bounce");
    expect(row.provider).toBe("resend");
    expect(row.reason).toContain("hard");
  });

  it("returns 401 and inserts no row when the shared-secret token is invalid", async () => {
    const email = `${TEST_EMAIL_PREFIX}sharedbad@example.com`;
    const evt = bounceEvent(email);

    const res = await request(app)
      .post("/api/webhooks/email/resend?token=wrong")
      .set("Content-Type", "application/json")
      .send(evt);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });

    // Give the (non-existent) async work a tick anyway, then assert nothing landed.
    await new Promise((r) => setTimeout(r, 50));
    expect(await countEventsFor(email)).toBe(0);
  });

  it("accepts a Svix-signed delivery (raw-body HMAC) and persists the event", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET_ENV;

    const email = `${TEST_EMAIL_PREFIX}svixok@example.com`;
    // Use a non-minified body to prove the verifier signs the raw bytes,
    // not a re-serialised version of req.body.
    const rawBody = JSON.stringify(bounceEvent(email), null, 2);
    const headers = buildSvixHeaders(rawBody, RAW_SIGNING_SECRET_B64);

    const res = await request(app)
      .post("/api/webhooks/email/resend")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody);
    expect(res.status).toBe(202);

    const count = await waitForEvents(email, 1);
    expect(count).toBe(1);
  });

  it("rejects a Svix delivery whose body has been tampered with after signing", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET_ENV;

    const original = JSON.stringify(bounceEvent(`${TEST_EMAIL_PREFIX}victim@example.com`));
    const headers = buildSvixHeaders(original, RAW_SIGNING_SECRET_B64);

    const tamperedEmail = `${TEST_EMAIL_PREFIX}attacker@example.com`;
    const tampered = JSON.stringify(bounceEvent(tamperedEmail));

    const res = await request(app)
      .post("/api/webhooks/email/resend")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(tampered);
    expect(res.status).toBe(401);

    await new Promise((r) => setTimeout(r, 50));
    expect(await countEventsFor(tamperedEmail)).toBe(0);
  });
});

describe("GET /api/admin/status/subscribers (Task #868 acceptance #4)", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/admin/status/subscribers");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-SUPER_ADMIN authenticated users", async () => {
    testUser = { id: "user-1", role: "ADMIN" };
    const res = await request(app).get("/api/admin/status/subscribers");
    expect(res.status).toBe(403);
  });

  it("aggregates bounce_count, complaint_count, last_event_at and last_event_type after webhook deliveries", async () => {
    const email = `${TEST_EMAIL_PREFIX}aggregate@example.com`;

    // Seed a confirmed subscriber so it shows up in the LEFT JOIN.
    await db.execute(sql`
      INSERT INTO "status_subscribers" (email, confirmed, confirm_token, unsubscribe_token, confirmed_at)
      VALUES (${email}, true, ${"ct"}, ${"ut"}, now())
    `);

    // Drive the counts via real webhook deliveries — true end-to-end.
    // Two bounces with earlier created_at, then a complaint with the latest
    // created_at. Use the upper-cased recipient to also exercise the
    // case-insensitive lower(email) match in the LATERAL join.
    const t1 = "2026-04-20T10:00:00Z";
    const t2 = "2026-04-21T10:00:00Z";
    const t3 = "2026-04-22T10:00:00Z";
    const upper = email.toUpperCase();

    const post = (body: unknown) =>
      request(app)
        .post(`/api/webhooks/email/resend?token=${SHARED_SECRET}`)
        .set("Content-Type", "application/json")
        .send(body as object);

    expect((await post({ ...bounceEvent(upper, t1) })).status).toBe(202);
    expect((await post({ ...bounceEvent(upper, t2) })).status).toBe(202);
    expect(
      (
        await post({
          type: "email.complained",
          created_at: t3,
          data: {
            email_id: "evt-comp",
            to: [upper],
            complaint: { feedbackType: "abuse" },
          },
        })
      ).status,
    ).toBe(202);

    const total = await waitForEvents(email, 3);
    expect(total).toBe(3);

    testUser = { id: "super-1", role: "SUPER_ADMIN" };
    const res = await request(app).get("/api/admin/status/subscribers");
    expect(res.status).toBe(200);

    const row = (res.body as Array<Record<string, any>>).find((r) => r.email === email);
    expect(row).toBeDefined();
    expect(row!.bounce_count).toBe(2);
    expect(row!.complaint_count).toBe(1);
    expect(row!.last_event_type).toBe("complaint");
    expect(new Date(row!.last_event_at).toISOString()).toBe(new Date(t3).toISOString());
  });

  it("returns zero counts and null last_event_at for subscribers with no events", async () => {
    testUser = { id: "super-1", role: "SUPER_ADMIN" };
    const email = `${TEST_EMAIL_PREFIX}clean@example.com`;
    await db.execute(sql`
      INSERT INTO "status_subscribers" (email, confirmed, confirm_token, unsubscribe_token)
      VALUES (${email}, false, ${"ct2"}, ${"ut2"})
    `);

    const res = await request(app).get("/api/admin/status/subscribers");
    expect(res.status).toBe(200);
    const row = (res.body as Array<Record<string, any>>).find((r) => r.email === email);
    expect(row).toBeDefined();
    expect(row!.bounce_count).toBe(0);
    expect(row!.complaint_count).toBe(0);
    expect(row!.last_event_at).toBeNull();
    expect(row!.last_event_type).toBeNull();
  });
});
