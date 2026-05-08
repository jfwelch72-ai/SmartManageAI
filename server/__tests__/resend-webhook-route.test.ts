/**
 * HTTP-level integration tests for the Resend bounce/complaint webhook
 * route (Task #858).
 *
 * Mounts `emailWebhookRoutes` in a real Express app — including the
 * `verify` callback that captures `req.rawBody` as a Buffer, exactly the
 * way `server/index.ts` configures it — so the tests cover the real
 * signature-verification path.
 *
 * The DB and the heavy `emailRoutes` module are mocked: we don't care
 * what gets persisted, only that authentication accepts/rejects the
 * right requests.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import crypto from "crypto";
import express, { type Express } from "express";
import request from "supertest";

const dbExecute = vi.fn(async () => ({ rows: [] }));

vi.mock("../db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    execute: dbExecute,
  },
  pool: {},
}));

vi.mock("../emailRoutes", () => ({
  syncGmailAccount: vi.fn(),
  syncOutlookAccount: vi.fn(),
  gmailApiFetch: vi.fn(),
  outlookApiFetch: vi.fn(),
}));

const logInfoMock = vi.fn();
const logWarnMock = vi.fn();
const logErrorMock = vi.fn();
vi.mock("../utils/logger", () => ({
  logInfo: logInfoMock,
  logWarn: logWarnMock,
  logError: logErrorMock,
}));

const SHARED_SECRET = "shared-token-value";
// Svix-style secret is base64; "whsec_" prefix is optional.
const RAW_SIGNING_SECRET_B64 = Buffer.from("super-secret-key").toString("base64");
const SIGNING_SECRET_ENV = `whsec_${RAW_SIGNING_SECRET_B64}`;

let app: Express;

function buildSvixHeaders(rawBody: string, secretB64: string) {
  const id = "msg_test_1";
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

beforeAll(async () => {
  const { default: emailWebhookRoutes } = await import("../emailWebhookRoutes");
  app = express();
  // Replicates the production setup in server/index.ts so req.rawBody is a Buffer.
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use("/api/webhooks/email", emailWebhookRoutes);
});

beforeEach(() => {
  dbExecute.mockClear();
  logInfoMock.mockClear();
  logWarnMock.mockClear();
  logErrorMock.mockClear();
  process.env.RESEND_WEBHOOK_SECRET = SHARED_SECRET;
});

afterEach(() => {
  delete process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
  delete process.env.EMAIL_WEBHOOK_SECRET;
});

const SAMPLE_EVENT = {
  type: "email.bounced",
  created_at: "2026-04-22T10:00:00Z",
  data: {
    email_id: "abc",
    to: ["bouncing@example.com"],
    from: "noreply@example.com",
    subject: "Test",
    bounce: { type: "hard", message: "Mailbox does not exist" },
  },
};

describe("Resend webhook route", () => {
  it("accepts an event with a valid shared-secret token", async () => {
    const res = await request(app)
      .post(`/api/webhooks/email/resend?token=${SHARED_SECRET}`)
      .set("Content-Type", "application/json")
      .send(SAMPLE_EVENT);
    expect(res.status).toBe(202);
    // Allow the async per-event insert loop to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(dbExecute).toHaveBeenCalled();
  });

  it("rejects a request with an invalid shared-secret token", async () => {
    const res = await request(app)
      .post("/api/webhooks/email/resend?token=wrong")
      .set("Content-Type", "application/json")
      .send(SAMPLE_EVENT);
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 20));
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it("accepts a Svix-signed delivery using the exact raw body bytes", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET_ENV;

    // Use a non-minified payload to prove the verifier signs the raw bytes,
    // not a re-serialised version of req.body.
    const rawBody = JSON.stringify(SAMPLE_EVENT, null, 2);
    const headers = buildSvixHeaders(rawBody, RAW_SIGNING_SECRET_B64);

    const res = await request(app)
      .post("/api/webhooks/email/resend")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody);
    expect(res.status).toBe(202);
  });

  it("logs a per-request WARN when an svix-signed delivery arrives but the signing secret is unset (Task #879)", async () => {
    delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    // Shared secret stays configured so the request still authenticates.
    const rawBody = JSON.stringify(SAMPLE_EVENT);
    const headers = buildSvixHeaders(rawBody, RAW_SIGNING_SECRET_B64);

    const res = await request(app)
      .post(`/api/webhooks/email/resend?token=${SHARED_SECRET}`)
      .set("Content-Type", "application/json")
      .set(headers)
      .send(rawBody);
    expect(res.status).toBe(202);
    const sawSigningWarn = logWarnMock.mock.calls.some((c) =>
      String(c[0] ?? "").includes("RESEND_WEBHOOK_SIGNING_SECRET"),
    );
    expect(sawSigningWarn).toBe(true);
  });

  it("emits a boot-time ERROR when neither secret is configured (Task #879)", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    delete process.env.EMAIL_WEBHOOK_SECRET;
    const { warnIfResendWebhookSigningSecretMissing, __resetResendBootWarningForTests } =
      await import("../emailWebhookRoutes");
    // The boot-warning is idempotent across the process; reset its internal
    // latch via the test-only reset hook so this assertion is deterministic.
    __resetResendBootWarningForTests();
    warnIfResendWebhookSigningSecretMissing();
    expect(logErrorMock).toHaveBeenCalled();
    const sawError = logErrorMock.mock.calls.some((c) =>
      String(c[0] ?? "").includes("RESEND_WEBHOOK_SIGNING_SECRET"),
    );
    expect(sawError).toBe(true);
  });

  it("emits a boot-time WARN when only the shared-secret fallback is configured (Task #879)", async () => {
    process.env.RESEND_WEBHOOK_SECRET = SHARED_SECRET;
    delete process.env.RESEND_WEBHOOK_SIGNING_SECRET;
    const { warnIfResendWebhookSigningSecretMissing, __resetResendBootWarningForTests } =
      await import("../emailWebhookRoutes");
    __resetResendBootWarningForTests();
    warnIfResendWebhookSigningSecretMissing();
    const sawWarn = logWarnMock.mock.calls.some((c) =>
      String(c[0] ?? "").includes("RESEND_WEBHOOK_SIGNING_SECRET"),
    );
    expect(sawWarn).toBe(true);
  });

  it("stays silent at boot when the signing secret is configured (Task #879)", async () => {
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET_ENV;
    const { warnIfResendWebhookSigningSecretMissing, __resetResendBootWarningForTests } =
      await import("../emailWebhookRoutes");
    __resetResendBootWarningForTests();
    warnIfResendWebhookSigningSecretMissing();
    const sawSecretLog = [...logWarnMock.mock.calls, ...logErrorMock.mock.calls]
      .some((c) => String(c[0] ?? "").includes("RESEND_WEBHOOK_SIGNING_SECRET"));
    expect(sawSecretLog).toBe(false);
  });

  it("rejects a Svix delivery whose body has been tampered with after signing", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    process.env.RESEND_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET_ENV;

    const original = JSON.stringify(SAMPLE_EVENT);
    const headers = buildSvixHeaders(original, RAW_SIGNING_SECRET_B64);
    const tampered = JSON.stringify({
      ...SAMPLE_EVENT,
      data: { ...SAMPLE_EVENT.data, to: ["attacker@example.com"] },
    });

    const res = await request(app)
      .post("/api/webhooks/email/resend")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(tampered);
    expect(res.status).toBe(401);
  });
});
