import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import type { Express } from "express";
import request from "supertest";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// End-to-end coverage for the Apple Sign-In routes in `server/oauthRoutes.ts`.
// Mounts the router on a bare Express app, mocks the Apple JWKS + token
// endpoints via a stubbed global fetch, and exercises both the happy path
// (valid state + valid id_token → user created/logged in + auth cookie set)
// and every documented failure branch — apple_state_mismatch (missing +
// replayed state), apple_token_exchange_failed, apple_token_invalid,
// apple_no_email, and apple_not_configured.

const APPLE_CLIENT_ID = "com.example.testapp";
const APPLE_TEAM_ID = "TEAMID12345";
const APPLE_KEY_ID = "KEYID12345";
const RSA_KID = "test-rsa-kid-1";

let app: Express;
let appleEcPrivateKey: string;
let rsaPrivateKeyPem: string;
let rsaPublicJwk: Record<string, unknown>;
let dbModule: typeof import("../db");
let schemaModule: typeof import("@shared/schema");
let stateStoreModule: typeof import("../oauthStateStore");

const TEST_EMAIL_PREFIX = "apple-oauth-test-";
const suffix = Date.now();

interface FetchHandler {
  match: (url: string, init?: RequestInit) => boolean;
  respond: (url: string, init?: RequestInit) =>
    | Response
    | Promise<Response>;
}

let fetchHandlers: FetchHandler[] = [];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const stubbedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  for (const handler of fetchHandlers) {
    if (handler.match(url, init)) {
      return handler.respond(url, init);
    }
  }
  throw new Error(`Unhandled fetch in test: ${init?.method ?? "GET"} ${url}`);
});

function setHandlers(...handlers: FetchHandler[]): void {
  fetchHandlers = handlers;
}

function appleTokenHandler(idToken: string, status = 200): FetchHandler {
  return {
    match: (url) => url.startsWith("https://appleid.apple.com/auth/token"),
    respond: () =>
      status === 200
        ? jsonResponse({ id_token: idToken, access_token: "x", token_type: "Bearer" })
        : new Response("simulated upstream failure", { status }),
  };
}

function appleJwksHandler(jwk: Record<string, unknown>): FetchHandler {
  return {
    match: (url) => url.startsWith("https://appleid.apple.com/auth/keys"),
    respond: () => jsonResponse({ keys: [jwk] }),
  };
}

function makeIdToken(
  claims: Record<string, unknown>,
  opts: { kid?: string; key?: string; algorithm?: jwt.Algorithm } = {},
): string {
  return jwt.sign(claims, opts.key ?? rsaPrivateKeyPem, {
    algorithm: opts.algorithm ?? "RS256",
    keyid: opts.kid ?? RSA_KID,
  });
}

function defaultClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://appleid.apple.com",
    aud: APPLE_CLIENT_ID,
    sub: `apple-sub-${suffix}-${Math.random().toString(36).slice(2, 10)}`,
    email: `${TEST_EMAIL_PREFIX}${suffix}-${Math.random().toString(36).slice(2, 8)}@test.local`,
    email_verified: "true",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

async function initiateAndExtractState(): Promise<string> {
  const res = await request(app).get("/api/auth/apple");
  expect(res.status).toBe(302);
  const location = res.headers.location as string;
  expect(location).toMatch(/^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
  const url = new URL(location);
  const state = url.searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}

function extractAuthCookie(res: request.Response): string | null {
  const cookies = res.headers["set-cookie"] as string | string[] | undefined;
  if (!cookies) return null;
  const arr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of arr) {
    const m = c.match(/auth_token=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

beforeAll(async () => {
  // Real ES256 (P-256) private key for Apple client_secret JWT generation.
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  appleEcPrivateKey = ec.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();

  // Real RSA key pair used to sign the simulated Apple id_token, plus its
  // matching JWK that we return from the mocked /auth/keys endpoint.
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  rsaPrivateKeyPem = rsa.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  rsaPublicJwk = rsa.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  rsaPublicJwk.kid = RSA_KID;
  rsaPublicJwk.alg = "RS256";
  rsaPublicJwk.use = "sig";

  process.env.APPLE_CLIENT_ID = APPLE_CLIENT_ID;
  process.env.APPLE_TEAM_ID = APPLE_TEAM_ID;
  process.env.APPLE_KEY_ID = APPLE_KEY_ID;
  process.env.APPLE_PRIVATE_KEY = appleEcPrivateKey;
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = "test-session-secret-for-apple-oauth-routes";
  }

  vi.stubGlobal("fetch", stubbedFetch);

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const oauthRoutes = (await import("../oauthRoutes")).default;
  stateStoreModule = await import("../oauthStateStore");
  dbModule = await import("../db");
  schemaModule = await import("@shared/schema");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(oauthRoutes);
}, 60_000);

afterAll(async () => {
  // Clean up users created by happy-path tests.
  try {
    const { sql } = await import("drizzle-orm");
    await dbModule.db.execute(
      sql`DELETE FROM users WHERE email LIKE ${`${TEST_EMAIL_PREFIX}%`}`,
    );
  } catch {
    // best-effort
  }
  vi.unstubAllGlobals();
}, 30_000);

beforeEach(() => {
  fetchHandlers = [];
  stubbedFetch.mockClear();
  stateStoreModule._testClearOAuthStateStore();
});

afterEach(() => {
  // Re-establish Apple env vars in case a test cleared them to exercise the
  // apple_not_configured branch.
  process.env.APPLE_CLIENT_ID = APPLE_CLIENT_ID;
  process.env.APPLE_TEAM_ID = APPLE_TEAM_ID;
  process.env.APPLE_KEY_ID = APPLE_KEY_ID;
  process.env.APPLE_PRIVATE_KEY = appleEcPrivateKey;
});

describe("Apple OAuth routes (e2e)", () => {
  it("happy path: valid state + valid id_token creates the user, sets the auth cookie, and redirects in-app", async () => {
    const state = await initiateAndExtractState();
    const claims = defaultClaims();

    setHandlers(
      appleTokenHandler(makeIdToken(claims)),
      appleJwksHandler(rsaPublicJwk),
    );

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({
        state,
        code: "fake-apple-authcode",
        user: JSON.stringify({ name: { firstName: "Tim", lastName: "Apple" } }),
      });

    expect(res.status).toBe(302);
    // New users have no organization yet → onboarding redirect.
    expect(res.headers.location).toBe("/onboarding");
    const cookie = extractAuthCookie(res);
    expect(cookie).toBeTruthy();

    // Verify the persisted user matches what the id_token / appleUserData said.
    const { eq, and } = await import("drizzle-orm");
    const [persisted] = await dbModule.db
      .select()
      .from(schemaModule.users)
      .where(
        and(
          eq(schemaModule.users.oauthProvider, "apple"),
          eq(schemaModule.users.oauthProviderId, claims.sub as string),
        ),
      )
      .limit(1);
    expect(persisted).toBeDefined();
    expect(persisted.email).toBe(claims.email);
    expect(persisted.firstName).toBe("Tim");
    expect(persisted.lastName).toBe("Apple");
    expect(persisted.oauthProvider).toBe("apple");

    // The cookie must be a valid JWT for the same user.
    const decoded = jwt.verify(cookie!, process.env.SESSION_SECRET!) as {
      userId: string;
    };
    expect(decoded.userId).toBe(persisted.id);
  });

  it("happy path: returning user with same Apple sub re-uses the existing account", async () => {
    const state1 = await initiateAndExtractState();
    const sub = `apple-sub-returning-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `${TEST_EMAIL_PREFIX}returning-${suffix}@test.local`;
    const claims = defaultClaims({ sub, email });

    setHandlers(
      appleTokenHandler(makeIdToken(claims)),
      appleJwksHandler(rsaPublicJwk),
    );

    const first = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state: state1, code: "code-1" });
    expect(first.status).toBe(302);
    expect(extractAuthCookie(first)).toBeTruthy();

    // Second login with the same Apple sub must NOT create a duplicate user.
    const state2 = await initiateAndExtractState();
    setHandlers(
      appleTokenHandler(makeIdToken(claims)),
      appleJwksHandler(rsaPublicJwk),
    );

    const second = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state: state2, code: "code-2" });
    expect(second.status).toBe(302);
    expect(extractAuthCookie(second)).toBeTruthy();

    const { eq, and } = await import("drizzle-orm");
    const rows = await dbModule.db
      .select()
      .from(schemaModule.users)
      .where(
        and(
          eq(schemaModule.users.oauthProvider, "apple"),
          eq(schemaModule.users.oauthProviderId, sub),
        ),
      );
    expect(rows.length).toBe(1);
  });

  it("apple_state_mismatch: callback POSTed without a state parameter is rejected", async () => {
    // Even setting up token/JWKS handlers — the request should bail out
    // before reaching them.
    setHandlers(
      appleTokenHandler(makeIdToken(defaultClaims())),
      appleJwksHandler(rsaPublicJwk),
    );

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ code: "ignored" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_state_mismatch");
    expect(extractAuthCookie(res)).toBeNull();
    // Token + JWKS endpoints must NOT have been hit.
    expect(stubbedFetch).not.toHaveBeenCalled();
  });

  it("apple_state_mismatch: replaying a previously consumed state is rejected", async () => {
    const state = await initiateAndExtractState();
    setHandlers(
      appleTokenHandler(makeIdToken(defaultClaims())),
      appleJwksHandler(rsaPublicJwk),
    );

    const first = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code-1" });
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe("/onboarding");

    // Replay the same state — server must reject without exchanging tokens.
    stubbedFetch.mockClear();
    setHandlers(
      appleTokenHandler(makeIdToken(defaultClaims())),
      appleJwksHandler(rsaPublicJwk),
    );

    const replay = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code-2" });

    expect(replay.status).toBe(302);
    expect(replay.headers.location).toBe("/login?error=apple_state_mismatch");
    expect(extractAuthCookie(replay)).toBeNull();
    expect(stubbedFetch).not.toHaveBeenCalled();
  });

  it("apple_state_mismatch: an unknown / never-issued state is rejected", async () => {
    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state: "f".repeat(64), code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_state_mismatch");
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_token_exchange_failed: Apple /auth/token returning 400 yields the right error redirect", async () => {
    const state = await initiateAndExtractState();
    setHandlers(appleTokenHandler("ignored", 400));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "/login?error=apple_token_exchange_failed",
    );
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_token_exchange_failed: missing authorization code in the callback body", async () => {
    const state = await initiateAndExtractState();

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "/login?error=apple_token_exchange_failed",
    );
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_token_invalid: id_token signed with a different RSA key fails verification", async () => {
    const state = await initiateAndExtractState();
    // Sign the id_token with a brand-new RSA key whose JWK we never publish.
    const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const otherKeyPem = otherKey.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const idToken = jwt.sign(defaultClaims(), otherKeyPem, {
      algorithm: "RS256",
      keyid: RSA_KID, // matching kid in JWKS but wrong key material
    });

    setHandlers(
      appleTokenHandler(idToken),
      appleJwksHandler(rsaPublicJwk),
    );

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_token_invalid");
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_token_invalid: id_token whose kid is missing from JWKS", async () => {
    const state = await initiateAndExtractState();
    const idToken = jwt.sign(defaultClaims(), rsaPrivateKeyPem, {
      algorithm: "RS256",
      keyid: "unknown-kid",
    });

    setHandlers(
      appleTokenHandler(idToken),
      appleJwksHandler(rsaPublicJwk), // only publishes RSA_KID
    );

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_token_invalid");
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_token_invalid: malformed id_token (not three dot-separated segments)", async () => {
    const state = await initiateAndExtractState();
    setHandlers(appleTokenHandler("not-a-real-jwt"));

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_token_invalid");
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_no_email: id_token without an email claim is rejected", async () => {
    const state = await initiateAndExtractState();
    const claims = defaultClaims();
    delete (claims as Record<string, unknown>).email;
    setHandlers(
      appleTokenHandler(makeIdToken(claims)),
      appleJwksHandler(rsaPublicJwk),
    );

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state, code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_no_email");
    expect(extractAuthCookie(res)).toBeNull();
  });

  it("apple_not_configured: GET initiator redirects when APPLE_* env vars are missing", async () => {
    delete process.env.APPLE_CLIENT_ID;

    const res = await request(app).get("/api/auth/apple");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_not_configured");
  });

  it("apple_not_configured: POST callback also redirects when APPLE_* env vars are missing", async () => {
    delete process.env.APPLE_CLIENT_ID;

    const res = await request(app)
      .post("/api/auth/apple/callback")
      .type("form")
      .send({ state: "anything", code: "code" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=apple_not_configured");
  });
});
