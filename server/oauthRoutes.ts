import { logError, logInfo, logWarn } from "./utils/logger";
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db } from "./db";
import { pool as oauthPool } from "./db";
import { users, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateToken, setAuthCookie } from "./auth";
import express from "express";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";
import jwt from "jsonwebtoken";
import {
  createOAuthState,
  consumeOAuthState,
  inspectOAuthState,
  hashOAuthStatePrefix,
} from "./oauthStateStore";
import { authLimiter } from "./rateLimiter";
import { logAuthEvent } from "./auditLogger";

const router = Router();

router.use(express.urlencoded({ extended: true }));

function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─── State parameter encoding ─────────────────────────────────────────────
//
// The OAuth `state` parameter serves two purposes:
//   1. CSRF protection: a random nonce bound to the user's session.
//   2. Mobile redirect transport: carry the smartmanageai:// deep-link
//      redirect URL that must survive the round-trip through the provider.
//
// We embed the redirect (when present) directly into the state parameter
// sent to the provider, which the provider echoes back verbatim.  This
// binds the redirect to the specific nonce — concurrent auth attempts
// each carry their own nonce so their redirects cannot interfere.
//
// Format:
//   Without redirect:  <64-char hex nonce>
//   With redirect:     <64-char hex nonce>~<base64url(redirect)>
//
// The tilde (`~`) separator is URL-safe and never appears in base64url
// output or in hex strings, making splitting unambiguous.

function buildStateParam(nonce: string, redirect?: string): string {
  if (!redirect) return nonce;
  const encodedRedirect = Buffer.from(redirect).toString("base64url");
  return `${nonce}~${encodedRedirect}`;
}

function parseStateParam(stateParam: string): { nonce: string; redirect: string | null } {
  const sep = stateParam.indexOf("~");
  if (sep === -1) return { nonce: stateParam, redirect: null };
  const nonce = stateParam.slice(0, sep);
  const encodedRedirect = stateParam.slice(sep + 1);
  try {
    const redirect = Buffer.from(encodedRedirect, "base64url").toString("utf8");
    return { nonce, redirect: isValidMobileRedirect(redirect) ? redirect : null };
  } catch {
    return { nonce, redirect: null };
  }
}

// Used for GET-redirect OAuth providers (Google, Microsoft). Apple uses a
// cross-site form_post callback which drops SameSite cookies in modern
// browsers, so it stores its state server-side via oauthStateStore instead.
//
// The cookie stores only the nonce. The full state param (nonce~redirect)
// is sent to the provider and echoed back; callbacks extract the nonce from
// it and compare to the cookie value.
function setNonceCookie(res: Response, nonce: string, provider: string) {
  res.cookie(`oauth_state_${provider}`, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function clearNonceCookie(res: Response, provider: string) {
  res.clearCookie(`oauth_state_${provider}`, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

// Validate the CSRF nonce for GET-redirect providers (Google, Microsoft).
// The state param may carry a redirect suffix; we parse out the nonce before
// comparing to the cookie so the comparison is always nonce vs. nonce.
function validateNonceCookie(req: Request, provider: string): { valid: boolean; nonce: string } {
  const cookieNonce = req.cookies?.[`oauth_state_${provider}`];
  const returnedStateParam = req.query?.state as string | undefined;
  if (!cookieNonce || !returnedStateParam) return { valid: false, nonce: "" };
  const { nonce } = parseStateParam(returnedStateParam);
  return { valid: cookieNonce === nonce, nonce };
}

function isValidMobileRedirect(redirect: string): boolean {
  return /^smartmanageai:\/\//i.test(redirect);
}

// Mint a short-lived (60 s) one-time mobile exchange code and store it in
// Postgres. The caller redirects the browser to the deep link appending
// ?code=<code>. The native app catches the link and redeems the code at
// POST /api/auth/mobile-exchange/redeem.
async function createMobileExchangeCode(userId: string, tokenVersion: number): Promise<string> {
  const code = crypto.randomBytes(32).toString("base64url");
  await oauthPool.query(
    `INSERT INTO mobile_exchange_codes (code, user_id, token_version, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '60 seconds')`,
    [code, userId, tokenVersion]
  );
  return code;
}

async function redirectToMobileDeepLink(
  res: Response,
  redirect: string,
  user: { id: string; tokenVersion?: number | null }
): Promise<void> {
  const code = await createMobileExchangeCode(user.id, user.tokenVersion ?? 0);
  const sep = redirect.includes("?") ? "&" : "?";
  res.redirect(302, `${redirect}${sep}code=${encodeURIComponent(code)}`);
}

async function findOrCreateOAuthUser(
  provider: string,
  providerId: string,
  email: string,
  firstName: string,
  lastName: string,
  emailVerified: boolean,
  avatarUrl?: string
) {
  const [existingByProvider] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.oauthProvider, provider),
        eq(users.oauthProviderId, providerId)
      )
    )
    .limit(1);

  if (existingByProvider) {
    return existingByProvider;
  }

  if (!emailVerified) {
    return null;
  }

  const [existingByEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingByEmail) {
    await db
      .update(users)
      .set({
        oauthProvider: provider,
        oauthProviderId: providerId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingByEmail.id));
    return {
      ...existingByEmail,
      oauthProvider: provider,
      oauthProviderId: providerId,
    };
  }

  const [newUser] = await db
    .insert(users)
    .values({
      firstName,
      lastName,
      email,
      role: "ADMIN",
      isActive: true,
      oauthProvider: provider,
      oauthProviderId: providerId,
      avatarUrl: avatarUrl || null,
    })
    .returning();

  return newUser;
}

function getRedirectPath(user: {
  organizationId?: string | null;
  role?: string;
}): string {
  if (user.role === "SUPER_ADMIN") return "/admin";
  if (user.role === "HUSTLER") return "/hustler";
  if (!user.organizationId) return "/onboarding";
  return "/dashboard";
}

// ─── Provider discovery ────────────────────────────────────────────────────
// GET /api/auth/providers
// Public, unauthenticated endpoint. Returns available login methods with the
// information a mobile client needs to initiate each flow.
// Rate-limited by the shared authLimiter (same bucket as /api/auth/login).
router.get("/api/auth/providers", authLimiter, (req: Request, res: Response) => {
  const base = getCanonicalBaseUrl(req);

  const googleConfigured =
    !!process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_ID !== "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID";

  const appleConfigured = isAppleConfigured();

  const microsoftConfigured =
    !!process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_ID !== "REPLACE_WITH_YOUR_MICROSOFT_CLIENT_ID";

  const providers: Array<{
    id: string;
    name: string;
    iconHint: string;
    available: boolean;
    flow: "oauth_mobile_exchange" | "passkey";
    initiateUrl?: string;
    mobileExchangeRedeemUrl?: string;
    deepLinkScheme?: string;
    notes?: string;
  }> = [
    {
      id: "google",
      name: "Google",
      iconHint: "google",
      available: googleConfigured,
      flow: "oauth_mobile_exchange",
      initiateUrl: `${base}/api/auth/google?redirect=smartmanageai://auth/callback`,
      mobileExchangeRedeemUrl: `${base}/api/auth/mobile-exchange/redeem`,
      deepLinkScheme: "smartmanageai://auth/callback",
      notes: "Open initiateUrl in a system browser. Append &redirect=<your-deep-link> to override the callback deep link.",
    },
    {
      id: "apple",
      name: "Apple",
      iconHint: "apple",
      available: appleConfigured,
      flow: "oauth_mobile_exchange",
      initiateUrl: `${base}/api/auth/apple?redirect=smartmanageai://auth/callback`,
      mobileExchangeRedeemUrl: `${base}/api/auth/mobile-exchange/redeem`,
      deepLinkScheme: "smartmanageai://auth/callback",
      notes: "The redirect is embedded in the OAuth state parameter echoed back by Apple — no separate cookie needed.",
    },
    {
      id: "microsoft",
      name: "Microsoft",
      iconHint: "microsoft",
      available: microsoftConfigured,
      flow: "oauth_mobile_exchange",
      initiateUrl: `${base}/api/auth/microsoft?redirect=smartmanageai://auth/callback`,
      mobileExchangeRedeemUrl: `${base}/api/auth/mobile-exchange/redeem`,
      deepLinkScheme: "smartmanageai://auth/callback",
      notes: "Open initiateUrl in a system browser. Append &redirect=<your-deep-link> to override the callback deep link.",
    },
    {
      id: "passkey",
      name: "Passkey",
      iconHint: "passkey",
      available: true,
      flow: "passkey",
      notes: "Two-step JSON flow: POST /api/auth/passkey/auth-options then POST /api/auth/passkey/auth-verify. Send X-Mobile-Client: 1 to receive the JWT in the response body.",
    },
  ];

  res.json({
    providers,
    mobileExchangeRedeemUrl: `${base}/api/auth/mobile-exchange/redeem`,
    passkeyAuthOptionsUrl: `${base}/api/auth/passkey/auth-options`,
    passkeyAuthVerifyUrl: `${base}/api/auth/passkey/auth-verify`,
  });
});

// ─── Google OAuth ──────────────────────────────────────────────────────────

router.get("/api/auth/google", (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID") {
    res.status(503).json({
      error:
        "Google Sign-In is not configured yet. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
    });
    return;
  }

  // Validate the optional mobile deep-link redirect before embedding it in state.
  const redirectParam = String(req.query.redirect || "");
  if (redirectParam && !isValidMobileRedirect(redirectParam)) {
    res.status(400).json({ error: "redirect must be a smartmanageai:// deep link" });
    return;
  }

  const nonce = generateNonce();
  // Store only the nonce in the cookie for CSRF validation.
  setNonceCookie(res, nonce, "google");

  // Embed the redirect in the state parameter so it is bound to this specific
  // nonce and survives the round-trip through Google's servers. Concurrent
  // auth attempts each get their own nonce (and thus their own redirect).
  const stateParam = buildStateParam(nonce, redirectParam || undefined);

  const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/google/callback`;
  const scope = encodeURIComponent("openid email profile");
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&access_type=offline` +
    `&prompt=select_account` +
    `&state=${encodeURIComponent(stateParam)}`;

  res.redirect(authUrl);
});

router.get(
  "/api/auth/google/callback",
  async (req: Request, res: Response) => {
    try {
      const returnedStateParam = req.query?.state as string | undefined;
      const { valid, nonce: _ } = validateNonceCookie(req, "google");
      void _;
      if (!valid) {
        logError("Google OAuth state mismatch — possible CSRF");
        res.redirect("/login?error=google_failed");
        return;
      }
      clearNonceCookie(res, "google");

      // Extract the mobile redirect from the state param (bound to this nonce).
      const { redirect: mobileRedirect } = parseStateParam(returnedStateParam || "");

      const { code } = req.query;
      if (!code || typeof code !== "string") {
        res.redirect("/login?error=google_failed");
        return;
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.redirect("/login?error=google_not_configured");
        return;
      }

      const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/google/callback`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        logError("Google token exchange failed:", {}, tokenData instanceof Error ? tokenData : new Error(String(tokenData)));
        res.redirect("/login?error=google_failed");
        return;
      }

      const profileRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }
      );
      const profile = await profileRes.json();

      if (!profile.email) {
        res.redirect("/login?error=google_no_email");
        return;
      }

      const emailVerified = profile.verified_email === true;

      const user = await findOrCreateOAuthUser(
        "google",
        profile.id,
        profile.email,
        profile.given_name || profile.name?.split(" ")[0] || "User",
        profile.family_name ||
          profile.name?.split(" ").slice(1).join(" ") ||
          "",
        emailVerified,
        profile.picture
      );

      if (!user) {
        res.redirect("/login?error=google_no_email");
        return;
      }

      if (user.role !== "SUPER_ADMIN" && user.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
        if (org && !org.isActive) {
          res.redirect("/login?error=org_suspended");
          return;
        }
      }

      const token = generateToken(user.id, user.tokenVersion ?? 0);
      setAuthCookie(res, token);

      logAuthEvent(user.id, "LOGIN", { method: "OAUTH_GOOGLE" }, req).catch(() => {});

      if (mobileRedirect) {
        await redirectToMobileDeepLink(res, mobileRedirect, user);
      } else {
        res.redirect(getRedirectPath(user));
      }
    } catch (error) {
      logError("Google OAuth error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.redirect("/login?error=google_failed");
    }
  }
);

// ─── Apple OAuth ───────────────────────────────────────────────────────────

function isAppleConfigured(): boolean {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  return !!(
    clientId && clientId !== "REPLACE_WITH_YOUR_APPLE_CLIENT_ID" &&
    teamId && teamId !== "REPLACE_WITH_YOUR_APPLE_TEAM_ID" &&
    keyId && keyId !== "REPLACE_WITH_YOUR_APPLE_KEY_ID" &&
    privateKey && privateKey !== "REPLACE_WITH_YOUR_APPLE_PRIVATE_KEY"
  );
}

function generateAppleClientSecret(): string {
  const clientId = process.env.APPLE_CLIENT_ID!;
  const teamId = process.env.APPLE_TEAM_ID!;
  const keyId = process.env.APPLE_KEY_ID!;
  let privateKey = process.env.APPLE_PRIVATE_KEY!;
  if (!privateKey.includes("\n") && privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  if (!privateKey.startsWith("-----BEGIN")) {
    privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
  }
  privateKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, "-----BEGIN PRIVATE KEY-----\n")
    .replace(/-----END PRIVATE KEY-----/, "\n-----END PRIVATE KEY-----")
    .replace(/\n{2,}/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 15777000,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    keyid: keyId,
  });
}

router.get("/api/auth/apple", async (req: Request, res: Response) => {
  if (!isAppleConfigured()) {
    logWarn("Apple Sign-In requested but APPLE_* env vars are missing or placeholders");
    res.redirect("/login?error=apple_not_configured");
    return;
  }

  // Validate the optional mobile deep-link redirect before embedding in state.
  const redirectParam = String(req.query.redirect || "");
  if (redirectParam && !isValidMobileRedirect(redirectParam)) {
    res.status(400).json({ error: "redirect must be a smartmanageai:// deep link" });
    return;
  }

  // Verify the client-secret JWT can be generated before the round-trip.
  try {
    generateAppleClientSecret();
  } catch (err) {
    logError(
      "Apple client_secret JWT generation failed at /api/auth/apple",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    res.redirect("/login?error=apple_not_configured");
    return;
  }

  const clientId = process.env.APPLE_CLIENT_ID!;
  let nonce: string;
  try {
    // Task #2056 — createOAuthState persists the nonce to Postgres so any
    // replica can consume it in the callback.
    nonce = await createOAuthState("apple");
  } catch (err) {
    logError(
      "Apple OAuth state persistence failed at /api/auth/apple",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    res.redirect("/login?error=apple_failed");
    return;
  }

  // Embed the redirect in the state parameter sent to Apple. Apple echoes
  // the state back verbatim in the form_post callback, so we can extract
  // both the nonce (for server-side validation) and the redirect from it.
  // This binds the redirect to the specific auth attempt's nonce — concurrent
  // attempts each have their own nonce and therefore their own redirect value.
  const stateParam = buildStateParam(nonce, redirectParam || undefined);

  const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/apple/callback`;

  logInfo("Apple OAuth state issued", {
    provider: "apple",
    statePrefix: hashOAuthStatePrefix(nonce),
    stateLength: nonce.length,
    redirectUri,
    issuedAt: new Date().toISOString(),
  });
  const scope = encodeURIComponent("name email");
  const authUrl =
    `https://appleid.apple.com/auth/authorize?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&response_mode=form_post` +
    `&state=${encodeURIComponent(stateParam)}`;

  res.redirect(authUrl);
});

router.post(
  "/api/auth/apple/callback",
  async (req: Request, res: Response) => {
    try {
      if (!isAppleConfigured()) {
        logWarn("Apple OAuth callback hit but APPLE_* env vars not configured");
        res.redirect("/login?error=apple_not_configured");
        return;
      }

      // Defense-in-depth against login-CSRF via cross-origin form_post.
      const originHeader = (req.headers.origin || "") as string;
      if (originHeader && originHeader !== "null" && originHeader !== "https://appleid.apple.com") {
        logError("Apple OAuth callback rejected — Origin is not Apple", { origin: originHeader });
        res.redirect("/login?error=apple_state_mismatch");
        return;
      }

      const returnedStateParam = req.body?.state;
      if (!returnedStateParam || typeof returnedStateParam !== "string") {
        logError("Apple OAuth callback missing state parameter");
        res.redirect("/login?error=apple_state_mismatch");
        return;
      }

      // Parse the state param to extract the nonce and (optionally) the redirect.
      // The nonce is what we persisted to Postgres; the redirect is the mobile
      // deep-link URL embedded in the state at initiation time.
      const { nonce, redirect: mobileRedirect } = parseStateParam(returnedStateParam);

      const returnedNoncePrefix = hashOAuthStatePrefix(nonce);
      let stateConsumed = false;
      try {
        // Task #2056 — consumeOAuthState does an atomic DELETE ... RETURNING
        // on the nonce so only one replica can ever redeem a given state.
        stateConsumed = await consumeOAuthState("apple", nonce);
      } catch (stateErr) {
        logError(
          "Apple OAuth state consume threw — DB error, not a true mismatch",
          { provider: "apple", statePrefix: returnedNoncePrefix, stateLength: nonce.length },
          stateErr instanceof Error ? stateErr : new Error(String(stateErr)),
        );
        res.redirect("/login?error=apple_state_consume_error");
        return;
      }
      if (!stateConsumed) {
        const serverNow = new Date();
        let inspected: { provider: string; expiresAt: Date } | null = null;
        let inspectError: Error | null = null;
        try {
          inspected = await inspectOAuthState(nonce);
        } catch (inspectErr) {
          inspectError = inspectErr instanceof Error ? inspectErr : new Error(String(inspectErr));
        }

        if (inspected) {
          const isExpired = inspected.expiresAt.getTime() <= serverNow.getTime();
          const providerMismatch = inspected.provider !== "apple";
          logError(
            "Apple OAuth state mismatch — row found in oauth_state but consume rejected it",
            {
              provider: "apple",
              statePrefix: returnedNoncePrefix,
              stateLength: nonce.length,
              rowProvider: inspected.provider,
              rowExpiresAt: inspected.expiresAt.toISOString(),
              serverNow: serverNow.toISOString(),
              msUntilExpiry: inspected.expiresAt.getTime() - serverNow.getTime(),
              providerMismatch,
              isExpired,
              shouldHaveMatched: !providerMismatch && !isExpired,
            },
          );
        } else {
          logError(
            "Apple OAuth state mismatch — no row found for returned nonce",
            {
              provider: "apple",
              statePrefix: returnedNoncePrefix,
              stateLength: nonce.length,
              serverNow: serverNow.toISOString(),
              inspectErrorMessage: inspectError?.message ?? null,
            },
          );
        }
        res.redirect("/login?error=apple_state_mismatch");
        return;
      }

      const { code, user: appleUserData } = req.body;

      if (!code) {
        logError("Apple OAuth callback missing authorization code");
        res.redirect("/login?error=apple_token_exchange_failed");
        return;
      }

      const clientId = process.env.APPLE_CLIENT_ID!;
      let clientSecret: string;
      try {
        clientSecret = generateAppleClientSecret();
      } catch (secretErr) {
        logError(
          "Apple client_secret JWT generation failed in callback",
          {},
          secretErr instanceof Error ? secretErr : new Error(String(secretErr)),
        );
        res.redirect("/login?error=apple_not_configured");
        return;
      }
      const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/apple/callback`;

      const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }).toString(),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        logError("Apple token exchange failed", { status: tokenRes.status, body: errBody });
        res.redirect("/login?error=apple_token_exchange_failed");
        return;
      }

      const tokenData = await tokenRes.json();
      const idToken = tokenData.id_token;

      if (!idToken) {
        logError("Apple token response missing id_token");
        res.redirect("/login?error=apple_token_exchange_failed");
        return;
      }

      const parts = idToken.split(".");
      if (parts.length !== 3) {
        logError("Apple id_token malformed");
        res.redirect("/login?error=apple_token_invalid");
        return;
      }

      let header: { kid?: string; alg?: string };
      try {
        header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      } catch {
        logError("Apple id_token header could not be parsed");
        res.redirect("/login?error=apple_token_invalid");
        return;
      }
      if (!header.kid) {
        logError("Apple id_token header missing kid");
        res.redirect("/login?error=apple_token_invalid");
        return;
      }

      const jwksRes = await fetch("https://appleid.apple.com/auth/keys");
      if (!jwksRes.ok) {
        logError("Apple JWKS fetch failed", { status: jwksRes.status });
        res.redirect("/login?error=apple_token_invalid");
        return;
      }
      const jwks = await jwksRes.json();
      const matchingKey = jwks.keys?.find(
        (k: { kid: string }) => k.kid === header.kid
      );
      if (!matchingKey) {
        logError("Apple id_token kid not found in JWKS", { kid: header.kid });
        res.redirect("/login?error=apple_token_invalid");
        return;
      }

      let publicKeyPem: string;
      try {
        publicKeyPem = crypto
          .createPublicKey({ key: matchingKey, format: "jwk" })
          .export({ type: "spki", format: "pem" }) as string;
      } catch (keyErr) {
        logError(
          "Apple JWK to PEM conversion failed",
          {},
          keyErr instanceof Error ? keyErr : new Error(String(keyErr))
        );
        res.redirect("/login?error=apple_token_invalid");
        return;
      }

      let payload: {
        sub?: string;
        email?: string;
        email_verified?: boolean | string;
        iss?: string;
        aud?: string | string[];
      };
      try {
        payload = jwt.verify(idToken, publicKeyPem, {
          algorithms: ["RS256"],
          issuer: "https://appleid.apple.com",
          audience: clientId,
        }) as typeof payload;
      } catch (verifyErr) {
        logError(
          "Apple id_token signature verification failed",
          {},
          verifyErr instanceof Error ? verifyErr : new Error(String(verifyErr))
        );
        res.redirect("/login?error=apple_token_invalid");
        return;
      }

      const email = payload.email;
      const sub = payload.sub;
      const emailVerified =
        payload.email_verified === true ||
        payload.email_verified === "true";

      if (!sub) {
        logError("Apple id_token missing sub");
        res.redirect("/login?error=apple_token_invalid");
        return;
      }

      if (!email) {
        logWarn("Apple id_token missing email — user likely chose 'Hide My Email' on first consent without sharing");
        res.redirect("/login?error=apple_no_email");
        return;
      }

      let firstName = "User";
      let lastName = "";
      if (appleUserData) {
        try {
          const parsed =
            typeof appleUserData === "string"
              ? JSON.parse(appleUserData)
              : appleUserData;
          if (parsed.name) {
            firstName = parsed.name.firstName || "User";
            lastName = parsed.name.lastName || "";
          }
        } catch { logWarn("Apple user payload could not be parsed (non-critical)"); }
      }

      const user = await findOrCreateOAuthUser(
        "apple",
        sub,
        email,
        firstName,
        lastName,
        emailVerified
      );

      if (!user) {
        logWarn("Apple sign-in: could not find or create user (email_verified=false and no existing account)", { emailVerified });
        res.redirect("/login?error=apple_no_email");
        return;
      }

      if (user.role !== "SUPER_ADMIN" && user.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
        if (org && !org.isActive) {
          res.redirect("/login?error=org_suspended");
          return;
        }
      }

      const token = generateToken(user.id, user.tokenVersion ?? 0);
      setAuthCookie(res, token);

      logAuthEvent(user.id, "LOGIN", { method: "OAUTH_APPLE" }, req).catch(() => {});

      if (mobileRedirect) {
        await redirectToMobileDeepLink(res, mobileRedirect, user);
      } else {
        res.redirect(getRedirectPath(user));
      }
    } catch (error) {
      logError("Apple OAuth error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.redirect("/login?error=apple_failed");
    }
  }
);

// ─── Microsoft OAuth ───────────────────────────────────────────────────────

router.get("/api/auth/microsoft", (req: Request, res: Response) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId || clientId === "REPLACE_WITH_YOUR_MICROSOFT_CLIENT_ID") {
    res.redirect("/login?error=microsoft_not_configured");
    return;
  }

  // Validate the optional mobile deep-link redirect before embedding in state.
  const redirectParam = String(req.query.redirect || "");
  if (redirectParam && !isValidMobileRedirect(redirectParam)) {
    res.status(400).json({ error: "redirect must be a smartmanageai:// deep link" });
    return;
  }

  const nonce = generateNonce();
  setNonceCookie(res, nonce, "microsoft");

  // Embed the redirect in the state parameter — bound to this nonce.
  const stateParam = buildStateParam(nonce, redirectParam || undefined);

  const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/microsoft/callback`;
  const scope = encodeURIComponent("openid email profile");
  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&response_mode=query` +
    `&state=${encodeURIComponent(stateParam)}`;

  res.redirect(authUrl);
});

router.get(
  "/api/auth/microsoft/callback",
  async (req: Request, res: Response) => {
    try {
      const returnedStateParam = req.query?.state as string | undefined;
      const { valid } = validateNonceCookie(req, "microsoft");
      if (!valid) {
        logError("Microsoft OAuth state mismatch — possible CSRF");
        res.redirect("/login?error=microsoft_failed");
        return;
      }
      clearNonceCookie(res, "microsoft");

      // Extract the mobile redirect from the state param.
      const { redirect: mobileRedirect } = parseStateParam(returnedStateParam || "");

      const { code } = req.query;
      if (!code || typeof code !== "string") {
        res.redirect("/login?error=microsoft_failed");
        return;
      }

      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.redirect("/login?error=microsoft_not_configured");
        return;
      }

      const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/microsoft/callback`;

      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.id_token) {
        logError("Microsoft token exchange failed:", {}, tokenData instanceof Error ? tokenData : new Error(String(JSON.stringify(tokenData))));
        res.redirect("/login?error=microsoft_failed");
        return;
      }

      const parts = tokenData.id_token.split(".");
      if (parts.length !== 3) {
        res.redirect("/login?error=microsoft_failed");
        return;
      }

      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

      const email = payload.email || payload.preferred_username;
      const sub = payload.sub || payload.oid;

      if (!email) {
        res.redirect("/login?error=microsoft_no_email");
        return;
      }

      const emailVerified = true;

      const nameParts = (payload.name || "User").split(" ");
      const firstName = payload.given_name || nameParts[0] || "User";
      const lastName = payload.family_name || nameParts.slice(1).join(" ") || "";

      const user = await findOrCreateOAuthUser(
        "microsoft",
        sub,
        email,
        firstName,
        lastName,
        emailVerified
      );

      if (!user) {
        res.redirect("/login?error=microsoft_no_email");
        return;
      }

      if (user.role !== "SUPER_ADMIN" && user.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
        if (org && !org.isActive) {
          res.redirect("/login?error=org_suspended");
          return;
        }
      }

      const token = generateToken(user.id, user.tokenVersion ?? 0);
      setAuthCookie(res, token);

      logAuthEvent(user.id, "LOGIN", { method: "OAUTH_MICROSOFT" }, req).catch(() => {});

      if (mobileRedirect) {
        await redirectToMobileDeepLink(res, mobileRedirect, user);
      } else {
        res.redirect(getRedirectPath(user));
      }
    } catch (error) {
      logError("Microsoft OAuth error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.redirect("/login?error=microsoft_failed");
    }
  }
);

export default router;
