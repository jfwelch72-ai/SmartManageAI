import { Router, Response } from "express";
import { db } from "./db";
import { eq, and, asc } from "drizzle-orm";
import { socialAccounts } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import crypto from "crypto";
import { validateToken, refreshToken } from "./social/publishService";

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

function decrypt(text: string): string {
  try {
    const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
    const parts = text.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return "";
  }
}

function getOrgId(req: AuthRequest): string | null {
  return req.user?.organizationId || null;
}

function isAdmin(req: AuthRequest): boolean {
  return ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(req.user?.role || "");
}

function getPlatformCredentials(platform: string): { clientId: string; clientSecret: string } {
  switch (platform) {
    case "FACEBOOK":
    case "INSTAGRAM":
      return { clientId: process.env.FB_APP_ID || "", clientSecret: process.env.FB_APP_SECRET || "" };
    case "LINKEDIN":
      return { clientId: process.env.LINKEDIN_CLIENT_ID || "", clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "" };
    case "TWITTER":
      return { clientId: process.env.TWITTER_CLIENT_ID || "", clientSecret: process.env.TWITTER_CLIENT_SECRET || "" };
    default:
      return { clientId: "", clientSecret: "" };
  }
}

router.get("/accounts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const accounts = await db.query.socialAccounts.findMany({
      where: eq(socialAccounts.organizationId, orgId),
      orderBy: [asc(socialAccounts.platform)],
    });

    const sanitized = accounts.map(a => ({
      ...a,
      accessTokenEncrypted: a.accessTokenEncrypted ? "***" : null,
      refreshTokenEncrypted: a.refreshTokenEncrypted ? "***" : null,
    }));

    res.json(sanitized);
  } catch (error) {
    console.error("Error fetching social accounts:", error);
    res.status(500).json({ error: "Failed to fetch social accounts" });
  }
});

router.post("/accounts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { platform, accountName, accountId, accessToken, refreshToken, permissionScopes } = req.body;
    if (!platform) return res.status(400).json({ error: "Platform is required" });

    const [account] = await db.insert(socialAccounts).values({
      organizationId: orgId,
      platform,
      accountName: accountName || null,
      accountId: accountId || null,
      status: accessToken ? "CONNECTED" : "DISCONNECTED",
      accessTokenEncrypted: accessToken ? encrypt(accessToken) : null,
      refreshTokenEncrypted: refreshToken ? encrypt(refreshToken) : null,
      permissionScopes: permissionScopes || null,
      connectedById: req.user!.id,
    }).returning();

    res.json({ ...account, accessTokenEncrypted: "***", refreshTokenEncrypted: "***" });
  } catch (error) {
    console.error("Error creating social account:", error);
    res.status(500).json({ error: "Failed to create social account" });
  }
});

router.patch("/accounts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const { accountName, accessToken, refreshToken, status } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (accountName !== undefined) updates.accountName = accountName;
    if (status) updates.status = status;
    if (accessToken) {
      updates.accessTokenEncrypted = encrypt(accessToken);
      updates.status = "CONNECTED";
    }
    if (refreshToken) {
      updates.refreshTokenEncrypted = encrypt(refreshToken);
    }

    const [updated] = await db.update(socialAccounts)
      .set(updates)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json({ ...updated, accessTokenEncrypted: "***", refreshTokenEncrypted: "***" });
  } catch (error) {
    console.error("Error updating social account:", error);
    res.status(500).json({ error: "Failed to update social account" });
  }
});

router.delete("/accounts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const [deleted] = await db.delete(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Account not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting social account:", error);
    res.status(500).json({ error: "Failed to delete social account" });
  }
});

router.get("/accounts/:id/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const account = await db.query.socialAccounts.findFirst({
      where: and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    if (!account.accessTokenEncrypted) {
      return res.json({ valid: false, error: "No access token configured", expiresAt: null });
    }

    const token = decrypt(account.accessTokenEncrypted);
    if (!token) {
      return res.json({ valid: false, error: "Token decryption failed", expiresAt: null });
    }

    const result = await validateToken(account.platform, token, account.accountId || undefined);
    res.json({
      valid: result.valid,
      error: result.error || null,
      expiresAt: account.tokenExpiresAt || null,
    });
  } catch (error) {
    console.error("Error checking account status:", error);
    res.status(500).json({ error: "Failed to check account status" });
  }
});

router.post("/accounts/:id/refresh", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const account = await db.query.socialAccounts.findFirst({
      where: and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    if (!account.refreshTokenEncrypted) {
      return res.status(400).json({ error: "No refresh token available. Please reconnect the account." });
    }

    const platformCreds = getPlatformCredentials(account.platform);
    const result = await refreshToken(account.platform, account.refreshTokenEncrypted, platformCreds.clientId, platformCreds.clientSecret);
    if (!result) {
      await db.update(socialAccounts)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(socialAccounts.id, id));
      return res.status(400).json({ error: "Token refresh failed. Please reconnect the account." });
    }

    const expiresAt = result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000) : null;
    const [updated] = await db.update(socialAccounts)
      .set({
        accessTokenEncrypted: encrypt(result.accessToken),
        tokenExpiresAt: expiresAt,
        status: "CONNECTED",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, id))
      .returning();

    res.json({
      success: true,
      status: "CONNECTED",
      expiresAt,
      account: { ...updated, accessTokenEncrypted: "***", refreshTokenEncrypted: "***" },
    });
  } catch (error) {
    console.error("Error refreshing token:", error);
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

export default router;
