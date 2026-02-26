import { Router } from "express";
import { db } from "./db";
import { 
  emailAccounts, 
  insertEmailAccountSchema,
  type EmailAccount,
  emailProviderEnum
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { sanitizeEmail, sanitizeText, sanitizeShortText } from "./sanitization";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const router = Router();

// Validation schema for creating email accounts
const createEmailAccountSchema = z.object({
  provider: z.enum(emailProviderEnum.enumValues),
  emailAddress: z.string().email().transform(s => sanitizeEmail(s)),
  displayName: z.string().max(100).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  // IMAP/SMTP fields (for IMAP provider)
  imapHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapUsername: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPassword: z.string().max(500).optional(), // Sensitive - not sanitized to preserve special chars
  // OAuth fields (for Gmail/Outlook - typically set via OAuth flow)
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  oauthProviderId: z.string().optional(),
});

const updateEmailAccountSchema = z.object({
  displayName: z.string().max(100).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  isActive: z.boolean().optional(),
  imapHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  imapUsername: z.string().max(255).optional().transform(s => s ? sanitizeShortText(s) : undefined),
  imapPassword: z.string().max(500).optional(),
});

// Helper to sanitize account for response (remove sensitive fields)
function sanitizeAccountForResponse(account: EmailAccount): Omit<EmailAccount, 'accessToken' | 'refreshToken' | 'imapPassword'> {
  const { accessToken, refreshToken, imapPassword, ...safe } = account;
  return safe;
}

// GET /api/email/accounts - List linked accounts for current user
router.get("/accounts", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id)
        )
      )
      .orderBy(desc(emailAccounts.createdAt));

    // Remove sensitive fields from response
    const sanitizedAccounts = accounts.map(sanitizeAccountForResponse);

    return res.json(sanitizedAccounts);
  } catch (error) {
    console.error("Error fetching email accounts:", error);
    return res.status(500).json({ error: "Failed to fetch email accounts" });
  }
});

// GET /api/email/accounts/:id - Get single account
router.get("/accounts/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id)
        )
      )
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: "Email account not found" });
    }

    return res.json(sanitizeAccountForResponse(account));
  } catch (error) {
    console.error("Error fetching email account:", error);
    return res.status(500).json({ error: "Failed to fetch email account" });
  }
});

// POST /api/email/accounts - Create/link a new email account
router.post("/accounts", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Validate input
    const parseResult = createEmailAccountSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    // Check for duplicate email
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id),
          eq(emailAccounts.emailAddress, data.emailAddress ?? '')
        )
      )
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Email account already linked" });
    }

    // Validate IMAP provider has required fields
    if (data.provider === "IMAP") {
      if (!data.imapHost || !data.imapPort) {
        return res.status(400).json({ error: "IMAP host and port are required for IMAP accounts" });
      }
    }

    // Create the account
    const [newAccount] = await db
      .insert(emailAccounts)
      .values({
        organizationId: orgId,
        userId: req.user.id,
        provider: data.provider,
        emailAddress: data.emailAddress ?? '',
        displayName: data.displayName,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        imapSecure: data.imapSecure,
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort,
        smtpSecure: data.smtpSecure,
        imapUsername: data.imapUsername,
        imapPassword: data.imapPassword,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        oauthProviderId: data.oauthProviderId,
        isActive: true,
      })
      .returning();

    // Audit log
    await logCreate(
      req.user.id,
      "EMAIL_ACCOUNT",
      newAccount.id,
      { provider: newAccount.provider, emailAddress: newAccount.emailAddress },
      req
    );

    return res.status(201).json(sanitizeAccountForResponse(newAccount));
  } catch (error) {
    console.error("Error creating email account:", error);
    return res.status(500).json({ error: "Failed to create email account" });
  }
});

// PATCH /api/email/accounts/:id - Update an email account
router.patch("/accounts/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Find existing account
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Email account not found" });
    }

    // Validate input
    const parseResult = updateEmailAccountSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    // Update the account
    const [updated] = await db
      .update(emailAccounts)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, req.params.id))
      .returning();

    // Audit log
    await logUpdate(
      req.user.id,
      "EMAIL_ACCOUNT",
      updated.id,
      { isActive: existing.isActive },
      { isActive: updated.isActive },
      req
    );

    return res.json(sanitizeAccountForResponse(updated));
  } catch (error) {
    console.error("Error updating email account:", error);
    return res.status(500).json({ error: "Failed to update email account" });
  }
});

// DELETE /api/email/accounts/:id - Unlink/delete an email account
router.delete("/accounts/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Find existing account
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Email account not found" });
    }

    // Soft delete by deactivating (keeps history)
    const [deleted] = await db
      .update(emailAccounts)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(emailAccounts.id, req.params.id))
      .returning();

    // Audit log
    await logDelete(
      req.user.id,
      "EMAIL_ACCOUNT",
      deleted.id,
      { provider: deleted.provider, emailAddress: deleted.emailAddress },
      req
    );

    return res.json({ success: true, message: "Email account unlinked" });
  } catch (error) {
    console.error("Error deleting email account:", error);
    return res.status(500).json({ error: "Failed to delete email account" });
  }
});

// POST /api/email/accounts/:id/test - Test connection to an email account
router.post("/accounts/:id/test", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, req.params.id),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id)
        )
      )
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: "Email account not found" });
    }

    // For now, return a mock success - actual connection testing would be implemented
    // based on the provider type (IMAP, Gmail API, MS Graph)
    return res.json({ 
      success: true, 
      message: "Connection test placeholder - implement based on provider",
      provider: account.provider
    });
  } catch (error) {
    console.error("Error testing email account:", error);
    return res.status(500).json({ error: "Failed to test email account" });
  }
});

// ============================================================================
// OAuth Routes for Gmail and Outlook
// ============================================================================

function getBaseUrl(req: import("express").Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

const GMAIL_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
};

const OUTLOOK_CONFIG = {
  clientId: process.env.MICROSOFT_CLIENT_ID || "",
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
  scopes: [
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
    "offline_access",
  ],
};

function getGmailRedirectUri(req: import("express").Request): string {
  return process.env.GOOGLE_REDIRECT_URI || `${getBaseUrl(req)}/api/email/oauth/gmail/callback`;
}

function getOutlookRedirectUri(req: import("express").Request): string {
  return process.env.MICROSOFT_REDIRECT_URI || `${getBaseUrl(req)}/api/email/oauth/outlook/callback`;
}

// GET /api/email/oauth/gmail/initiate - Start Gmail OAuth flow
router.get("/oauth/gmail/initiate", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!GMAIL_CONFIG.clientId || !GMAIL_CONFIG.clientSecret) {
      return res.status(503).json({ 
        error: "Gmail integration not configured",
        message: "Please contact your administrator to set up Google OAuth credentials"
      });
    }

    // Store user info in session for callback
    const state = Buffer.from(JSON.stringify({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      timestamp: Date.now()
    })).toString("base64url");

    const gmailRedirectUri = getGmailRedirectUri(req);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GMAIL_CONFIG.clientId);
    authUrl.searchParams.set("redirect_uri", gmailRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GMAIL_CONFIG.scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    return res.redirect(authUrl.toString());
  } catch (error) {
    console.error("Error initiating Gmail OAuth:", error);
    return res.redirect("/email?error=oauth_init_failed");
  }
});

// GET /api/email/oauth/gmail/callback - Handle Gmail OAuth callback
router.get("/oauth/gmail/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error("Gmail OAuth error:", oauthError);
      return res.redirect("/email?error=oauth_denied");
    }

    if (!code || !state) {
      return res.redirect("/email?error=missing_params");
    }

    // Decode state to get user info
    let userInfo: { userId: string; organizationId: string; timestamp: number };
    try {
      userInfo = JSON.parse(Buffer.from(state as string, "base64url").toString());
    } catch {
      return res.redirect("/email?error=invalid_state");
    }

    // Check timestamp (15 minute expiry)
    if (Date.now() - userInfo.timestamp > 15 * 60 * 1000) {
      return res.redirect("/email?error=state_expired");
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: GMAIL_CONFIG.clientId,
        client_secret: GMAIL_CONFIG.clientSecret,
        redirect_uri: getGmailRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Failed to exchange Gmail code:", await tokenResponse.text());
      return res.redirect("/email?error=token_exchange_failed");
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    // Get user email from Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
      return res.redirect("/email?error=user_info_failed");
    }

    const googleUser = await userResponse.json() as { email: string; name?: string };

    // Check if account already exists
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.emailAddress, googleUser.email),
          eq(emailAccounts.organizationId, userInfo.organizationId),
          eq(emailAccounts.userId, userInfo.userId)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing account with new tokens
      await db
        .update(emailAccounts)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing.refreshToken,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
    } else {
      // Create new account
      await db.insert(emailAccounts).values({
        id: crypto.randomUUID(),
        organizationId: userInfo.organizationId,
        userId: userInfo.userId,
        provider: "GMAIL",
        emailAddress: googleUser.email,
        displayName: googleUser.name || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        oauthProviderId: googleUser.email,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return res.redirect("/email?success=gmail_connected");
  } catch (error) {
    console.error("Error in Gmail OAuth callback:", error);
    return res.redirect("/email?error=callback_failed");
  }
});

// GET /api/email/oauth/outlook/initiate - Start Outlook/Microsoft OAuth flow
router.get("/oauth/outlook/initiate", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!OUTLOOK_CONFIG.clientId || !OUTLOOK_CONFIG.clientSecret) {
      return res.status(503).json({ 
        error: "Outlook integration not configured",
        message: "Please contact your administrator to set up Microsoft OAuth credentials"
      });
    }

    // Store user info in state for callback
    const state = Buffer.from(JSON.stringify({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      timestamp: Date.now()
    })).toString("base64url");

    const outlookRedirectUri = getOutlookRedirectUri(req);
    const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    authUrl.searchParams.set("client_id", OUTLOOK_CONFIG.clientId);
    authUrl.searchParams.set("redirect_uri", outlookRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", OUTLOOK_CONFIG.scopes.join(" "));
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("state", state);

    return res.redirect(authUrl.toString());
  } catch (error) {
    console.error("Error initiating Outlook OAuth:", error);
    return res.redirect("/email?error=oauth_init_failed");
  }
});

// GET /api/email/oauth/outlook/callback - Handle Outlook OAuth callback
router.get("/oauth/outlook/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error("Outlook OAuth error:", oauthError, error_description);
      return res.redirect("/email?error=oauth_denied");
    }

    if (!code || !state) {
      return res.redirect("/email?error=missing_params");
    }

    // Decode state to get user info
    let userInfo: { userId: string; organizationId: string; timestamp: number };
    try {
      userInfo = JSON.parse(Buffer.from(state as string, "base64url").toString());
    } catch {
      return res.redirect("/email?error=invalid_state");
    }

    // Check timestamp (15 minute expiry)
    if (Date.now() - userInfo.timestamp > 15 * 60 * 1000) {
      return res.redirect("/email?error=state_expired");
    }

    // Exchange code for tokens
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: OUTLOOK_CONFIG.clientId,
        client_secret: OUTLOOK_CONFIG.clientSecret,
        redirect_uri: getOutlookRedirectUri(req),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Failed to exchange Outlook code:", await tokenResponse.text());
      return res.redirect("/email?error=token_exchange_failed");
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Get user info from Microsoft Graph
    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
      return res.redirect("/email?error=user_info_failed");
    }

    const msUser = await userResponse.json() as { 
      mail?: string; 
      userPrincipalName: string; 
      displayName?: string;
      id: string;
    };

    const emailAddress = msUser.mail || msUser.userPrincipalName;

    // Check if account already exists
    const [existing] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.emailAddress, emailAddress),
          eq(emailAccounts.organizationId, userInfo.organizationId),
          eq(emailAccounts.userId, userInfo.userId)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing account with new tokens
      await db
        .update(emailAccounts)
        .set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existing.refreshToken,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(emailAccounts.id, existing.id));
    } else {
      // Create new account
      await db.insert(emailAccounts).values({
        id: crypto.randomUUID(),
        organizationId: userInfo.organizationId,
        userId: userInfo.userId,
        provider: "OUTLOOK",
        emailAddress: emailAddress,
        displayName: msUser.displayName || null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        oauthProviderId: msUser.id,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return res.redirect("/email?success=outlook_connected");
  } catch (error) {
    console.error("Error in Outlook OAuth callback:", error);
    return res.redirect("/email?error=callback_failed");
  }
});

// GET /api/email/oauth/status - Check if OAuth providers are configured
router.get("/oauth/status", requireAuth, async (req: AuthRequest, res) => {
  return res.json({
    gmail: {
      configured: !!(GMAIL_CONFIG.clientId && GMAIL_CONFIG.clientSecret),
    },
    outlook: {
      configured: !!(OUTLOOK_CONFIG.clientId && OUTLOOK_CONFIG.clientSecret),
    },
  });
});

export default router;
