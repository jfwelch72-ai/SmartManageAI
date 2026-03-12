import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { db } from "./db";
import { socialAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";

const router = Router();

const ENCRYPTION_KEY = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || "";

function encrypt(text: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

function setCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
}

function validateAndClearState(req: Request, res: Response, name: string, returned: string | undefined): boolean {
  const stored = req.cookies?.[name];
  res.clearCookie(name, { path: "/" });
  if (!stored || !returned || stored !== returned) return false;
  return true;
}

async function upsertSocialAccount(
  orgId: string,
  userId: string,
  platform: string,
  accountName: string,
  accountId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number
) {
  const accessTokenEncrypted = encrypt(accessToken);
  const refreshTokenEncrypted = refreshToken ? encrypt(refreshToken) : null;
  const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  const [existing] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.organizationId, orgId), eq(socialAccounts.platform, platform)))
    .limit(1);

  if (existing) {
    await db
      .update(socialAccounts)
      .set({
        accountName,
        accountId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt,
        status: "CONNECTED",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, existing.id));
  } else {
    await db.insert(socialAccounts).values({
      organizationId: orgId,
      platform,
      accountName,
      accountId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      status: "CONNECTED",
      lastSyncAt: new Date(),
      connectedById: userId,
    });
  }
}

// ─── FACEBOOK ────────────────────────────────────────────────────────────────

router.get("/api/social/auth/facebook", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.FB_APP_ID;
  if (!clientId) {
    return res.redirect("/social-media?error=facebook_not_configured");
  }
  const state = generateState();
  setCookie(res, "social_oauth_state_facebook", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/facebook/callback`;
  const scope = "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_insights";
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&response_type=code`;
  res.redirect(url);
});

router.get("/api/social/auth/facebook/callback", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=facebook_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_facebook", state)) {
      return res.redirect("/social-media?error=facebook_failed");
    }

    const clientId = process.env.FB_APP_ID;
    const clientSecret = process.env.FB_APP_SECRET;
    if (!clientId || !clientSecret) return res.redirect("/social-media?error=facebook_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/facebook/callback`;

    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`, {
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Facebook token exchange failed:", tokenData);
      return res.redirect("/social-media?error=facebook_failed");
    }

    // Get long-lived token
    const longTokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${tokenData.access_token}`, {
      signal: AbortSignal.timeout(15000),
    });
    const longTokenData = await longTokenRes.json();
    const finalToken = longTokenData.access_token || tokenData.access_token;
    const expiresIn = longTokenData.expires_in || tokenData.expires_in;

    // Get user info
    const userRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${finalToken}`, {
      signal: AbortSignal.timeout(10000),
    });
    const userData = await userRes.json();

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "FACEBOOK", userData.name || "Facebook Page", userData.id || "", finalToken, undefined, expiresIn);

    // Also check for Instagram business account linked to this FB account
    try {
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${finalToken}`, {
        signal: AbortSignal.timeout(10000),
      });
      const pagesData = await pagesRes.json();
      if (pagesData.data && pagesData.data.length > 0) {
        const page = pagesData.data[0];
        const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`, {
          signal: AbortSignal.timeout(10000),
        });
        const igData = await igRes.json();
        if (igData.instagram_business_account?.id) {
          const igInfoRes = await fetch(`https://graph.facebook.com/v19.0/${igData.instagram_business_account.id}?fields=id,username&access_token=${page.access_token}`, {
            signal: AbortSignal.timeout(10000),
          });
          const igInfo = await igInfoRes.json();
          await upsertSocialAccount(orgId, userId, "INSTAGRAM", `@${igInfo.username || "instagram"}`, igData.instagram_business_account.id, page.access_token, undefined, expiresIn);
        }
      }
    } catch (igErr) {
      console.warn("Instagram auto-link skipped:", igErr);
    }

    res.redirect("/social-media?connected=FACEBOOK");
  } catch (err) {
    console.error("Facebook OAuth callback error:", err);
    res.redirect("/social-media?error=facebook_failed");
  }
});

// ─── LINKEDIN ─────────────────────────────────────────────────────────────────

router.get("/api/social/auth/linkedin", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return res.redirect("/social-media?error=linkedin_not_configured");

  const state = generateState();
  setCookie(res, "social_oauth_state_linkedin", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/linkedin/callback`;
  const scope = "r_liteprofile r_emailaddress w_member_social";
  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  res.redirect(url);
});

router.get("/api/social/auth/linkedin/callback", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=linkedin_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_linkedin", state)) {
      return res.redirect("/social-media?error=linkedin_failed");
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.redirect("/social-media?error=linkedin_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/linkedin/callback`;

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("LinkedIn token exchange failed:", tokenData);
      return res.redirect("/social-media?error=linkedin_failed");
    }

    const profileRes = await fetch("https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const profile = await profileRes.json();
    const name = `${profile.localizedFirstName || ""} ${profile.localizedLastName || ""}`.trim() || "LinkedIn User";

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "LINKEDIN", name, profile.id || "", tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=LINKEDIN");
  } catch (err) {
    console.error("LinkedIn OAuth callback error:", err);
    res.redirect("/social-media?error=linkedin_failed");
  }
});

// ─── TWITTER / X ──────────────────────────────────────────────────────────────

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

router.get("/api/social/auth/twitter", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) return res.redirect("/social-media?error=twitter_not_configured");

  const state = generateState();
  const { verifier, challenge } = generatePKCE();
  setCookie(res, "social_oauth_state_twitter", state);
  setCookie(res, "social_oauth_pkce_twitter", verifier);

  const redirectUri = `${getBaseUrl(req)}/api/social/auth/twitter/callback`;
  const scope = "tweet.read tweet.write users.read offline.access";
  const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
  res.redirect(url);
});

router.get("/api/social/auth/twitter/callback", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=twitter_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_twitter", state)) {
      return res.redirect("/social-media?error=twitter_failed");
    }

    const verifier = req.cookies?.["social_oauth_pkce_twitter"];
    res.clearCookie("social_oauth_pkce_twitter", { path: "/" });
    if (!verifier) return res.redirect("/social-media?error=twitter_failed");

    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    if (!clientId) return res.redirect("/social-media?error=twitter_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/twitter/callback`;
    const credentials = clientSecret
      ? "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
      : undefined;

    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(credentials ? { Authorization: credentials } : {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        ...(credentials ? {} : { client_id: clientId }),
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Twitter token exchange failed:", tokenData);
      return res.redirect("/social-media?error=twitter_failed");
    }

    const userRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const userData = await userRes.json();
    const twitterUser = userData.data || {};

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "TWITTER", `@${twitterUser.username || "twitter"}`, twitterUser.id || "", tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=TWITTER");
  } catch (err) {
    console.error("Twitter OAuth callback error:", err);
    res.redirect("/social-media?error=twitter_failed");
  }
});

// ─── STATUS ENDPOINT ──────────────────────────────────────────────────────────
// Returns which platforms have OAuth credentials configured server-side

router.get("/api/social/auth/platform-status", requireAuth, (_req: Request, res: Response) => {
  res.json({
    FACEBOOK: !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET),
    INSTAGRAM: !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET),
    LINKEDIN: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
    TWITTER: !!process.env.TWITTER_CLIENT_ID,
    TIKTOK: false,
    YOUTUBE: false,
    PINTEREST: false,
  });
});

export default router;
