import {logError, logWarn } from "./utils/logger";
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db } from "./db";
import { users, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateToken, setAuthCookie } from "./auth";
import express from "express";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";
import jwt from "jsonwebtoken";
import { createOAuthState, consumeOAuthState } from "./oauthStateStore";

const router = Router();

router.use(express.urlencoded({ extended: true }));

function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Used for GET-redirect OAuth providers (Google, Microsoft). Apple uses a
// cross-site form_post callback which drops SameSite cookies in modern
// browsers, so it stores its state server-side via oauthStateStore instead.
function setStateCookie(res: Response, state: string, provider: string) {
  res.cookie(`oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function validateState(req: Request, provider: string): boolean {
  const cookieState = req.cookies?.[`oauth_state_${provider}`];
  const returnedState = req.query?.state as string | undefined;
  if (!cookieState || !returnedState || cookieState !== returnedState) {
    return false;
  }
  return true;
}

function clearStateCookie(res: Response, provider: string) {
  res.clearCookie(`oauth_state_${provider}`, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
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

router.get("/api/auth/google", (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || clientId === "REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID") {
    res.status(503).json({
      error:
        "Google Sign-In is not configured yet. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
    });
    return;
  }

  const state = generateState();
  setStateCookie(res, state, "google");

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
    `&state=${state}`;

  res.redirect(authUrl);
});

router.get(
  "/api/auth/google/callback",
  async (req: Request, res: Response) => {
    try {
      if (!validateState(req, "google")) {
        logError("Google OAuth state mismatch — possible CSRF");
        res.redirect("/login?error=google_failed");
        return;
      }
      clearStateCookie(res, "google");

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
      res.redirect(getRedirectPath(user));
    } catch (error) {
      logError("Google OAuth error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.redirect("/login?error=google_failed");
    }
  }
);

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

  // Verify the client-secret JWT can actually be generated up-front so users
  // are not bounced through the Apple consent screen only to fail on the
  // callback. A failure here usually means APPLE_PRIVATE_KEY is malformed.
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
  let state: string;
  try {
    // Task #2056 — `createOAuthState` is now async because the state is
    // persisted to Postgres so the callback (which may land on a sibling
    // replica or after a deploy-driven restart) can still find it. A DB
    // failure here means we cannot guarantee the callback will validate,
    // so abort the redirect rather than send the user to Apple with a
    // state we never managed to store.
    state = await createOAuthState("apple");
  } catch (err) {
    logError(
      "Apple OAuth state persistence failed at /api/auth/apple",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    res.redirect("/login?error=apple_failed");
    return;
  }

  const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/apple/callback`;
  const scope = encodeURIComponent("name email");
  const authUrl =
    `https://appleid.apple.com/auth/authorize?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&response_mode=form_post` +
    `&state=${state}`;

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

      // Defense-in-depth against login-CSRF: because the state lives
      // server-side and is keyed only by its random value, an attacker who
      // obtains a valid state (e.g. by initiating their own Apple flow)
      // could try to POST it from a malicious page in a victim's browser to
      // log the victim into the attacker's Apple account. Browsers populate
      // the Origin header on cross-site form POSTs to the source origin, so
      // we reject any callback whose Origin is not Apple. Some browsers
      // strip Origin to "null" on cross-origin redirects — accept that, but
      // reject any concrete non-Apple origin.
      const originHeader = (req.headers.origin || "") as string;
      if (originHeader && originHeader !== "null" && originHeader !== "https://appleid.apple.com") {
        logError("Apple OAuth callback rejected — Origin is not Apple", { origin: originHeader });
        res.redirect("/login?error=apple_state_mismatch");
        return;
      }

      const returnedState = req.body?.state;
      if (!returnedState || typeof returnedState !== "string") {
        logError("Apple OAuth callback missing state parameter");
        res.redirect("/login?error=apple_state_mismatch");
        return;
      }
      let stateConsumed = false;
      try {
        // Task #2056 — `consumeOAuthState` now reads from a shared Postgres
        // table so a state issued by any replica can be consumed by any
        // replica. A DB error is rare but treated as a hard fail rather
        // than a silent allow, since the alternative would be to bypass
        // CSRF protection on a transient outage.
        stateConsumed = await consumeOAuthState("apple", returnedState);
      } catch (stateErr) {
        logError(
          "Apple OAuth state consume failed",
          {},
          stateErr instanceof Error ? stateErr : new Error(String(stateErr)),
        );
        res.redirect("/login?error=apple_state_mismatch");
        return;
      }
      if (!stateConsumed) {
        // Either the state was never issued by us, was already consumed, or
        // expired (>10 min). All point to a stale/replayed/forged callback.
        logError("Apple OAuth state mismatch — possible CSRF, replay, or expired state");
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

      const jwksRes = await fetch(
        "https://appleid.apple.com/auth/keys"
      );
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

      // Convert the JWK to a PEM-encoded SPKI public key using Node's
      // built-in crypto (no extra dependency needed) and verify the
      // id_token signature with RS256, the issuer and the audience.
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
      res.redirect(getRedirectPath(user));
    } catch (error) {
      logError("Apple OAuth error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.redirect("/login?error=apple_failed");
    }
  }
);

router.get("/api/auth/microsoft", (req: Request, res: Response) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId || clientId === "REPLACE_WITH_YOUR_MICROSOFT_CLIENT_ID") {
    res.redirect("/login?error=microsoft_not_configured");
    return;
  }

  const state = generateState();
  setStateCookie(res, state, "microsoft");

  const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/microsoft/callback`;
  const scope = encodeURIComponent("openid email profile");
  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scope}` +
    `&response_mode=query` +
    `&state=${state}`;

  res.redirect(authUrl);
});

router.get(
  "/api/auth/microsoft/callback",
  async (req: Request, res: Response) => {
    try {
      if (!validateState(req, "microsoft")) {
        logError("Microsoft OAuth state mismatch — possible CSRF");
        res.redirect("/login?error=microsoft_failed");
        return;
      }
      clearStateCookie(res, "microsoft");

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
      res.redirect(getRedirectPath(user));
    } catch (error) {
      logError("Microsoft OAuth error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.redirect("/login?error=microsoft_failed");
    }
  }
);

export default router;
