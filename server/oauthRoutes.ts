import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { generateToken, setAuthCookie } from "./auth";
import express from "express";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";

const router = Router();

router.use(express.urlencoded({ extended: true }));

function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

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
  const returnedState =
    provider === "apple" ? req.body?.state : (req.query?.state as string);
  if (!cookieState || !returnedState || cookieState !== returnedState) {
    return false;
  }
  return true;
}

function clearStateCookie(res: Response, provider: string) {
  res.clearCookie(`oauth_state_${provider}`, { path: "/" });
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
        console.error("Google OAuth state mismatch — possible CSRF");
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
        console.error("Google token exchange failed:", tokenData);
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

      const token = generateToken(user.id, user.tokenVersion ?? 0);
      setAuthCookie(res, token);
      res.redirect(getRedirectPath(user));
    } catch (error) {
      console.error("Google OAuth error:", error);
      res.redirect("/login?error=google_failed");
    }
  }
);

router.get("/api/auth/apple", (req: Request, res: Response) => {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId || clientId === "REPLACE_WITH_YOUR_APPLE_CLIENT_ID") {
    res.status(503).json({
      error:
        "Apple Sign-In is not configured yet. Please set APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_PRIVATE_KEY environment variables.",
    });
    return;
  }

  const state = generateState();
  setStateCookie(res, state, "apple");

  const redirectUri = `${getCanonicalBaseUrl(req)}/api/auth/apple/callback`;
  const scope = encodeURIComponent("name email");
  const authUrl =
    `https://appleid.apple.com/auth/authorize?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code id_token` +
    `&scope=${scope}` +
    `&response_mode=form_post` +
    `&state=${state}`;

  res.redirect(authUrl);
});

router.post(
  "/api/auth/apple/callback",
  async (req: Request, res: Response) => {
    try {
      if (!validateState(req, "apple")) {
        console.error("Apple OAuth state mismatch — possible CSRF");
        res.redirect("/login?error=apple_failed");
        return;
      }
      clearStateCookie(res, "apple");

      const { id_token, user: appleUserData } = req.body;

      if (!id_token) {
        res.redirect("/login?error=apple_failed");
        return;
      }

      const parts = id_token.split(".");
      if (parts.length !== 3) {
        res.redirect("/login?error=apple_failed");
        return;
      }

      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString()
      );

      const clientId = process.env.APPLE_CLIENT_ID;
      if (payload.iss !== "https://appleid.apple.com") {
        console.error("Apple id_token issuer mismatch:", payload.iss);
        res.redirect("/login?error=apple_failed");
        return;
      }
      if (payload.aud !== clientId) {
        console.error("Apple id_token audience mismatch:", payload.aud);
        res.redirect("/login?error=apple_failed");
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.error("Apple id_token expired");
        res.redirect("/login?error=apple_failed");
        return;
      }

      const jwksRes = await fetch(
        "https://appleid.apple.com/auth/keys"
      );
      const jwks = await jwksRes.json();
      const matchingKey = jwks.keys?.find(
        (k: { kid: string }) => k.kid === header.kid
      );
      if (!matchingKey) {
        console.error(
          "Apple id_token kid not found in JWKS:",
          header.kid
        );
        res.redirect("/login?error=apple_failed");
        return;
      }

      const email = payload.email;
      const sub = payload.sub;
      const emailVerified =
        payload.email_verified === true ||
        payload.email_verified === "true";

      if (!email) {
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
        } catch {}
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
        res.redirect("/login?error=apple_no_email");
        return;
      }

      const token = generateToken(user.id, user.tokenVersion ?? 0);
      setAuthCookie(res, token);
      res.redirect(getRedirectPath(user));
    } catch (error) {
      console.error("Apple OAuth error:", error);
      res.redirect("/login?error=apple_failed");
    }
  }
);

export default router;
