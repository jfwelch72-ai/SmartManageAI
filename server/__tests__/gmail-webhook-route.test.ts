/**
 * HTTP-level integration tests for the Gmail Pub/Sub webhook route
 * (Task #547).
 *
 * The unit tests in `gmail-pubsub-auth.test.ts` already cover the JWT
 * verifier in isolation. These tests mount `emailWebhookRoutes` in a real
 * Express app and exercise the route-level wiring in
 * `server/emailWebhookRoutes.ts` — `isGmailPushAuthorized`, the interaction
 * with the shared-secret query token, and the 401 vs 204 status codes.
 *
 * The DB and the heavy `emailRoutes` module are mocked so the test only
 * exercises the security checks.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import express, { type Express } from "express";
import request from "supertest";

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
  pool: {},
}));

vi.mock("../emailRoutes", () => ({
  syncGmailAccount: vi.fn(async () => ({ messagesImported: 0 })),
  syncOutlookAccount: vi.fn(async () => ({ messagesImported: 0 })),
  gmailApiFetch: vi.fn(),
  outlookApiFetch: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const KID = "test-kid-1";
const AUDIENCE = "https://example.com/api/webhooks/email/gmail";
const SHARED_SECRET = "shared-secret-value";
const PUSH_BODY = {
  message: {
    data: Buffer.from(
      JSON.stringify({ emailAddress: "user@example.com", historyId: 1 }),
      "utf-8",
    ).toString("base64"),
    messageId: "abc",
    publishTime: new Date().toISOString(),
  },
  subscription: "projects/p/subscriptions/s",
};

let publicPem: string;
let privatePem: string;
let originalFetch: typeof fetch;
let app: Express;

function signGoogleToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    {
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      email: "gmail-pubsub@my-project.iam.gserviceaccount.com",
      email_verified: true,
      ...overrides,
    },
    privatePem,
    { algorithm: "RS256", keyid: KID },
  );
}

beforeAll(async () => {
  const { default: emailWebhookRoutes } = await import("../emailWebhookRoutes");
  app = express();
  app.use(express.json());
  app.use("/api/webhooks/email", emailWebhookRoutes);
});

beforeEach(async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicPem = publicKey;
  privatePem = privateKey;

  const { __resetGmailPubsubCertCacheForTests } = await import("../gmailPubsubAuth");
  __resetGmailPubsubCertCacheForTests();

  originalFetch = global.fetch;
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("googleapis.com/oauth2/v1/certs")) {
      return new Response(JSON.stringify({ [KID]: publicPem }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
    throw new Error(`Unexpected fetch in test: ${u}`);
  }) as unknown as typeof fetch;

  process.env.EMAIL_WEBHOOK_SECRET = SHARED_SECRET;
  delete process.env.GMAIL_PUBSUB_AUDIENCE;
  delete process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
});

afterEach(async () => {
  global.fetch = originalFetch;
  delete process.env.EMAIL_WEBHOOK_SECRET;
  delete process.env.GMAIL_PUBSUB_AUDIENCE;
  delete process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
  const { __resetGmailPubsubCertCacheForTests } = await import("../gmailPubsubAuth");
  __resetGmailPubsubCertCacheForTests();
});

describe("Gmail webhook route security", () => {
  describe("with GMAIL_PUBSUB_AUDIENCE configured (JWT verification on)", () => {
    beforeEach(() => {
      process.env.GMAIL_PUBSUB_AUDIENCE = AUDIENCE;
    });

    it("returns 401 when the Authorization header is missing", async () => {
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=${SHARED_SECRET}`)
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "unauthorized" });
    });

    it("returns 401 when the Authorization header is malformed", async () => {
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=${SHARED_SECRET}`)
        .set("Authorization", "Token nope")
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the JWT is signed by an attacker key", async () => {
      const { privateKey: attackerKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      const token = jwt.sign(
        {
          iss: "https://accounts.google.com",
          aud: AUDIENCE,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 600,
        },
        attackerKey,
        { algorithm: "RS256", keyid: KID },
      );
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=${SHARED_SECRET}`)
        .set("Authorization", `Bearer ${token}`)
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
    });

    it("returns 204 when a valid signed JWT and shared secret are provided", async () => {
      const token = signGoogleToken();
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=${SHARED_SECRET}`)
        .set("Authorization", `Bearer ${token}`)
        .send(PUSH_BODY);
      expect(res.status).toBe(204);
    });

    it("returns 401 when the JWT is valid but the shared-secret query token is missing", async () => {
      const token = signGoogleToken();
      const res = await request(app)
        .post(`/api/webhooks/email/gmail`)
        .set("Authorization", `Bearer ${token}`)
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the JWT is valid but the shared-secret query token is wrong", async () => {
      const token = signGoogleToken();
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=wrong-secret`)
        .set("Authorization", `Bearer ${token}`)
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
    });
  });

  describe("with GMAIL_PUBSUB_AUDIENCE unset (shared-secret-only fallback)", () => {
    it("returns 204 when only the shared secret is provided", async () => {
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=${SHARED_SECRET}`)
        .send(PUSH_BODY);
      expect(res.status).toBe(204);
    });

    it("returns 401 when the shared secret is missing", async () => {
      const res = await request(app)
        .post(`/api/webhooks/email/gmail`)
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
    });

    it("returns 401 when the shared secret is wrong", async () => {
      const res = await request(app)
        .post(`/api/webhooks/email/gmail?token=wrong`)
        .send(PUSH_BODY);
      expect(res.status).toBe(401);
    });

    it("accepts the shared secret via the x-webhook-secret header", async () => {
      const res = await request(app)
        .post(`/api/webhooks/email/gmail`)
        .set("x-webhook-secret", SHARED_SECRET)
        .send(PUSH_BODY);
      expect(res.status).toBe(204);
    });
  });
});
