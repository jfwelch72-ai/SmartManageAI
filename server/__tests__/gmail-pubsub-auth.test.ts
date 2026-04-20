/**
 * Tests for the Gmail Pub/Sub JWT verifier (Task #542).
 *
 * Generates an RSA key pair locally, mocks Google's certs endpoint, and
 * exercises the success / expired / wrong-audience / wrong-issuer / wrong
 * service-account paths through `verifyGmailPubsubJwt`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  verifyGmailPubsubJwt,
  __resetGmailPubsubCertCacheForTests,
} from "../gmailPubsubAuth";

const KID = "test-kid-1";
const AUDIENCE = "https://example.com/api/webhooks/email/gmail";
const SERVICE_ACCOUNT = "gmail-pubsub@my-project.iam.gserviceaccount.com";

let publicPem: string;
let privatePem: string;
let originalFetch: typeof fetch;

function signToken(payload: Record<string, unknown>, opts: { kid?: string } = {}): string {
  return jwt.sign(payload, privatePem, {
    algorithm: "RS256",
    keyid: opts.kid ?? KID,
  });
}

function buildAuthHeader(token: string): string {
  return `Bearer ${token}`;
}

beforeEach(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  publicPem = publicKey;
  privatePem = privateKey;

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
});

afterEach(() => {
  global.fetch = originalFetch;
  __resetGmailPubsubCertCacheForTests();
});

describe("verifyGmailPubsubJwt", () => {
  it("accepts a valid Google-signed token with matching audience", async () => {
    const token = signToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      email: SERVICE_ACCOUNT,
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(true);
    expect(result.email).toBe(SERVICE_ACCOUNT);
  });

  it("rejects tokens with a wrong audience", async () => {
    const token = signToken({
      iss: "https://accounts.google.com",
      aud: "https://attacker.example.com/",
      email: SERVICE_ACCOUNT,
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verify-failed/);
  });

  it("rejects expired tokens", async () => {
    const token = signToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      email: SERVICE_ACCOUNT,
      email_verified: true,
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verify-failed/);
  });

  it("rejects tokens with the wrong issuer", async () => {
    const token = signToken({
      iss: "https://attacker.example.com",
      aud: AUDIENCE,
      email: SERVICE_ACCOUNT,
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unexpected-issuer/);
  });

  it("rejects tokens whose email does not match the configured service account", async () => {
    const token = signToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      email: "someone-else@example.com",
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unexpected-email/);
  });

  it("accepts tokens regardless of email when no service account is configured", async () => {
    const token = signToken({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      email: "anything@example.com",
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, undefined);
    expect(result.ok).toBe(true);
  });

  it("rejects tokens whose kid is not in Google's published keys", async () => {
    const token = signToken(
      {
        iss: "https://accounts.google.com",
        aud: AUDIENCE,
        email: SERVICE_ACCOUNT,
        email_verified: true,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      { kid: "unknown-kid" },
    );
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown-kid");
  });

  it("rejects tokens signed by an attacker key", async () => {
    const { privateKey: attackerKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const token = jwt.sign(
      {
        iss: "https://accounts.google.com",
        aud: AUDIENCE,
        email: SERVICE_ACCOUNT,
        email_verified: true,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      attackerKey,
      { algorithm: "RS256", keyid: KID },
    );
    const result = await verifyGmailPubsubJwt(buildAuthHeader(token), AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verify-failed/);
  });

  it("rejects when the Authorization header is missing", async () => {
    const result = await verifyGmailPubsubJwt(undefined, AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-authorization-header");
  });

  it("rejects when the Authorization header is malformed", async () => {
    const result = await verifyGmailPubsubJwt("Token abc", AUDIENCE, SERVICE_ACCOUNT);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed-authorization-header");
  });

  it("returns audience-not-configured when audience env is empty", async () => {
    const result = await verifyGmailPubsubJwt("Bearer x", "", undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("audience-not-configured");
  });
});
