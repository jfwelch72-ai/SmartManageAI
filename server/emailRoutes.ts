import { Router } from "express";
import { db } from "./db";
import { emailAccounts, insertEmailAccountSchema, type EmailAccount, emailProviderEnum, emailThreads, emailMessages, emailAttachments, tasks, emailThreadStatusEnum, emailClassificationEnum, emailSummaries, type Task } from "@shared/schema";
import { eq, and, desc, gte, or, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logUpdate, logDelete, logAudit } from "./auditLogger";
import { sanitizeEmail, sanitizeText, sanitizeShortText } from "./sanitization";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getCanonicalBaseUrl, isRedirectUriValid } from "./utils/routeHelpers";
import {
  analyzeEmail,
  summarizeThread,
  suggestReplies,
  generateEmailSummary,
  matchEmailToEntities,
  createTaskFromEmail,
  type EmailAnalysisResult,
} from "./ai/emailAi";
import { governedAiCall } from "./services/aiGovernance";

const router = Router();

// ========================================
// Routes from emailAccountRoutes.ts
// ========================================

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
  return process.env.GOOGLE_REDIRECT_URI || `${getCanonicalBaseUrl(req)}/api/email/oauth/gmail/callback`;
}

function getOutlookRedirectUri(req: import("express").Request): string {
  return process.env.MICROSOFT_REDIRECT_URI || `${getCanonicalBaseUrl(req)}/api/email/oauth/outlook/callback`;
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

    if (!isRedirectUriValid(gmailRedirectUri)) {
      console.error("[OAuth] Gmail redirect URI is invalid:", gmailRedirectUri);
      return res.status(400).json({
        error: "OAuth redirect URI misconfigured",
        message: `The Gmail redirect URI resolved to "${gmailRedirectUri}" which points to localhost or is empty. Set the APP_BASE_URL or GOOGLE_REDIRECT_URI environment variable to your public domain.`,
      });
    }

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
    return res.redirect("/email-assistant?error=oauth_init_failed");
  }
});

// GET /api/email/oauth/gmail/callback - Handle Gmail OAuth callback
router.get("/oauth/gmail/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error("Gmail OAuth error:", oauthError);
      return res.redirect("/email-assistant?error=oauth_denied");
    }

    if (!code || !state) {
      return res.redirect("/email-assistant?error=missing_params");
    }

    // Decode state to get user info
    let userInfo: { userId: string; organizationId: string; timestamp: number };
    try {
      userInfo = JSON.parse(Buffer.from(state as string, "base64url").toString());
    } catch {
      return res.redirect("/email-assistant?error=invalid_state");
    }

    // Check timestamp (15 minute expiry)
    if (Date.now() - userInfo.timestamp > 15 * 60 * 1000) {
      return res.redirect("/email-assistant?error=state_expired");
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
      return res.redirect("/email-assistant?error=token_exchange_failed");
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
      return res.redirect("/email-assistant?error=user_info_failed");
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

    return res.redirect("/email-assistant?success=gmail_connected");
  } catch (error) {
    console.error("Error in Gmail OAuth callback:", error);
    return res.redirect("/email-assistant?error=callback_failed");
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

    if (!isRedirectUriValid(outlookRedirectUri)) {
      console.error("[OAuth] Outlook redirect URI is invalid:", outlookRedirectUri);
      return res.status(400).json({
        error: "OAuth redirect URI misconfigured",
        message: `The Outlook redirect URI resolved to "${outlookRedirectUri}" which points to localhost or is empty. Set the APP_BASE_URL or MICROSOFT_REDIRECT_URI environment variable to your public domain.`,
      });
    }

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
    return res.redirect("/email-assistant?error=oauth_init_failed");
  }
});

// GET /api/email/oauth/outlook/callback - Handle Outlook OAuth callback
router.get("/oauth/outlook/callback", async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error("Outlook OAuth error:", oauthError, error_description);
      return res.redirect("/email-assistant?error=oauth_denied");
    }

    if (!code || !state) {
      return res.redirect("/email-assistant?error=missing_params");
    }

    // Decode state to get user info
    let userInfo: { userId: string; organizationId: string; timestamp: number };
    try {
      userInfo = JSON.parse(Buffer.from(state as string, "base64url").toString());
    } catch {
      return res.redirect("/email-assistant?error=invalid_state");
    }

    // Check timestamp (15 minute expiry)
    if (Date.now() - userInfo.timestamp > 15 * 60 * 1000) {
      return res.redirect("/email-assistant?error=state_expired");
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
      return res.redirect("/email-assistant?error=token_exchange_failed");
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
      return res.redirect("/email-assistant?error=user_info_failed");
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

    return res.redirect("/email-assistant?success=outlook_connected");
  } catch (error) {
    console.error("Error in Outlook OAuth callback:", error);
    return res.redirect("/email-assistant?error=callback_failed");
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

// ========================================
// Routes from emailAiRoutes.ts
// ========================================

router.get("/threads", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { status, classification, projectId, limit = '50', offset = '0' } = req.query;

    const conditions = [eq(emailThreads.organizationId, orgId)];
    
    if (status && emailThreadStatusEnum.enumValues.includes(status as any)) {
      conditions.push(eq(emailThreads.status, status as any));
    }
    
    if (classification && emailClassificationEnum.enumValues.includes(classification as any)) {
      conditions.push(eq(emailThreads.primaryClassification, classification as any));
    }
    
    if (projectId && typeof projectId === 'string') {
      conditions.push(eq(emailThreads.projectId, projectId));
    }

    const threads = await db
      .select()
      .from(emailThreads)
      .where(and(...conditions))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(threads);
  } catch (error) {
    console.error("Error fetching email threads:", error);
    return res.status(500).json({ error: "Failed to fetch email threads" });
  }
});

router.get("/threads/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(emailMessages.receivedAt);

    const linkedTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.emailThreadId, thread.id),
          eq(tasks.organizationId, orgId)
        )
      )
      .orderBy(desc(tasks.createdAt));

    return res.json({
      thread,
      messages,
      tasks: linkedTasks,
    });
  } catch (error) {
    console.error("Error fetching email thread:", error);
    return res.status(500).json({ error: "Failed to fetch email thread" });
  }
});

router.patch("/threads/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      status: z.enum(emailThreadStatusEnum.enumValues).optional(),
      projectId: z.string().uuid().nullable().optional(),
      bidId: z.string().uuid().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
    });

    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const [existing] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const data = parseResult.data;

    if (data.projectId) {
      const { projects } = await import("@shared/schema");
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, data.projectId))
        .limit(1);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      if (project.gcOrganizationId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Project belongs to another organization" });
      }
    }

    if (data.bidId) {
      const { bids } = await import("@shared/schema");
      const [bid] = await db
        .select({ gcOrganizationId: bids.gcOrganizationId })
        .from(bids)
        .where(eq(bids.id, data.bidId))
        .limit(1);
      
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }
      if (bid.gcOrganizationId && bid.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Bid belongs to another organization" });
      }
    }

    if (data.vendorId) {
      const { crmOrganisations } = await import("@shared/schema");
      const [vendor] = await db
        .select({ organizationId: crmOrganisations.organizationId })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, data.vendorId))
        .limit(1);
      
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (vendor.organizationId && vendor.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Vendor belongs to another organization" });
      }
    }

    const [updated] = await db
      .update(emailThreads)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, req.params.id))
      .returning();

    await logUpdate(
      req.user.id,
      "EMAIL_THREAD",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json(updated);
  } catch (error) {
    console.error("Error updating email thread:", error);
    return res.status(500).json({ error: "Failed to update email thread" });
  }
});

router.get("/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { threadId, limit = '50', offset = '0' } = req.query;

    const conditions = [eq(emailMessages.organizationId, orgId)];
    
    if (threadId && typeof threadId === 'string') {
      conditions.push(eq(emailMessages.threadId, threadId));
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(and(...conditions))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(messages);
  } catch (error) {
    console.error("Error fetching email messages:", error);
    return res.status(500).json({ error: "Failed to fetch email messages" });
  }
});

router.get("/messages/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.id, req.params.id),
          eq(emailMessages.organizationId, orgId)
        )
      )
      .limit(1);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const attachments = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.emailMessageId, message.id));

    return res.json({
      message,
      attachments,
    });
  } catch (error) {
    console.error("Error fetching email message:", error);
    return res.status(500).json({ error: "Failed to fetch email message" });
  }
});

router.post("/sync", requireAuth, async (req: AuthRequest, res) => {
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
          eq(emailAccounts.userId, req.user.id),
          eq(emailAccounts.isActive, true)
        )
      );

    if (accounts.length === 0) {
      return res.json({ 
        success: true, 
        message: "No active email accounts to sync",
        accountsProcessed: 0
      });
    }

    for (const account of accounts) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    }

    return res.json({
      success: true,
      message: `Email sync triggered for ${accounts.length} account(s)`,
      accountsProcessed: accounts.length,
      note: "Full email ingestion requires provider-specific implementation (Gmail API, MS Graph, IMAP)"
    });
  } catch (error) {
    console.error("Error syncing emails:", error);
    return res.status(500).json({ error: "Failed to sync emails" });
  }
});

// ========================================
// Routes from emailAnalysisRoutes.ts
// ========================================

router.post("/messages/:id/analyze", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.id, req.params.id),
          eq(emailMessages.organizationId, orgId)
        )
      )
      .limit(1);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const governedAnalysis = await governedAiCall<EmailAnalysisResult>({
      orgId,
      userId: req.user.id,
      actionType: "email_message_analysis",
      inputRefs: { messageId: message.id },
      fn: async () => {
        const result = await analyzeEmail(
          message.subject,
          message.bodyText || message.bodyHtml || '',
          message.fromAddress,
          orgId
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedAnalysis.blocked) {
      return res.status(429).json({ error: governedAnalysis.reason || "AI rate limit reached" });
    }

    const analysis = governedAnalysis.result;

    const matchedEntities = await matchEmailToEntities(analysis, orgId);

    await db
      .update(emailMessages)
      .set({
        classification: analysis.classification as any,
        aiMetadata: JSON.stringify(analysis),
        aiAnalyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, message.id));

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.id, message.threadId))
      .limit(1);

    if (thread && !thread.primaryClassification) {
      await db
        .update(emailThreads)
        .set({
          primaryClassification: analysis.classification as any,
          projectId: matchedEntities.projectId || thread.projectId,
          bidId: matchedEntities.bidId || thread.bidId,
          vendorId: matchedEntities.vendorId || thread.vendorId,
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, thread.id));
    }

    let taskId: string | null = null;
    if (analysis.requiresResponse && analysis.suggestedTaskTitle) {
      taskId = await createTaskFromEmail(
        analysis,
        message.id,
        message.threadId,
        orgId,
        req.user.id,
        matchedEntities
      );

      if (taskId) {
        await logCreate(req.user.id, "EMAIL_TASK", taskId, {
          source: "AI_ANALYSIS",
          messageId: message.id,
        }, req);
      }
    }

    await logAudit({
      userId: req.user.id,
      entityType: "EMAIL_MESSAGE",
      entityId: message.id,
      action: "UPDATE",
      oldValue: null,
      newValue: JSON.stringify({ classification: analysis.classification }),
    }, req);

    return res.json({
      analysis,
      matchedEntities,
      taskCreated: taskId ? true : false,
      taskId,
    });
  } catch (error) {
    console.error("Error analyzing email:", error);
    return res.status(500).json({ error: "Failed to analyze email" });
  }
});

router.post("/messages/:id/suggest-reply", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const toneSchema = z.object({
      tones: z.array(z.enum(['professional', 'casual', 'firm'])).default(['professional']),
    });

    const parseResult = toneSchema.safeParse(req.body);
    const tones = parseResult.success ? parseResult.data.tones : ['professional'] as const;

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.id, req.params.id),
          eq(emailMessages.organizationId, orgId)
        )
      )
      .limit(1);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const governedReplies = await governedAiCall<import("./ai/emailAi").ReplyDraft[]>({
      orgId,
      userId: req.user.id,
      actionType: "email_suggest_reply",
      inputRefs: { messageId: message.id },
      fn: async () => {
        const result = await suggestReplies(
          {
            subject: message.subject,
            body: message.bodyText || message.bodyHtml || '',
            fromAddress: message.fromAddress,
          },
          tones as Array<'professional' | 'casual' | 'firm'>
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedReplies.blocked) {
      return res.status(429).json({ error: governedReplies.reason || "AI rate limit reached" });
    }

    const drafts = governedReplies.result;

    return res.json({ drafts });
  } catch (error) {
    console.error("Error generating reply suggestions:", error);
    return res.status(500).json({ error: "Failed to generate reply suggestions" });
  }
});

router.post("/threads/:id/summarize", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(emailMessages.receivedAt);

    if (messages.length === 0) {
      return res.json({ summary: "No messages in this thread." });
    }

    const governedSummary = await governedAiCall<import("./ai/emailAi").ThreadSummaryResult>({
      orgId,
      userId: req.user.id,
      actionType: "email_thread_summary",
      inputRefs: { threadId: thread.id },
      fn: async () => {
        const result = await summarizeThread(
          messages.map(m => ({
            fromAddress: m.fromAddress,
            fromName: m.fromName ?? undefined,
            subject: m.subject,
            bodyText: m.bodyText ?? undefined,
            receivedAt: m.receivedAt,
          }))
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedSummary.blocked) {
      return res.status(429).json({ error: governedSummary.reason || "AI rate limit reached" });
    }

    const summary = governedSummary.result;

    await db
      .update(emailThreads)
      .set({
        aiSummary: summary.summary,
        aiMetadata: JSON.stringify(summary),
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, thread.id));

    return res.json(summary);
  } catch (error) {
    console.error("Error summarizing thread:", error);
    return res.status(500).json({ error: "Failed to summarize thread" });
  }
});

router.post("/summary/daily", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentMessages = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        subject: emailMessages.subject,
        fromAddress: emailMessages.fromAddress,
        snippet: emailMessages.snippet,
        classification: emailMessages.classification,
        receivedAt: emailMessages.receivedAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.organizationId, orgId),
          gte(emailMessages.receivedAt, oneDayAgo)
        )
      )
      .orderBy(desc(emailMessages.receivedAt))
      .limit(100);

    if (recentMessages.length === 0) {
      return res.json({
        periodDescription: "Last 24 hours",
        totalEmails: 0,
        byClassification: {},
        highlights: [],
        actionNeeded: [],
        summaryNarrative: "No new emails in the last 24 hours.",
      });
    }

    const governedDaily = await governedAiCall<import("./ai/emailAi").EmailSummaryDigest>({
      orgId,
      userId: req.user.id,
      actionType: "email_daily_summary",
      inputRefs: { messageCount: recentMessages.length },
      fn: async () => {
        const result = await generateEmailSummary(
          recentMessages.map(m => ({
            classification: m.classification ?? undefined,
            subject: m.subject,
            fromAddress: m.fromAddress,
            snippet: m.snippet ?? undefined,
            threadId: m.threadId,
            receivedAt: m.receivedAt,
          })),
          'DAILY'
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedDaily.blocked) {
      return res.status(429).json({ error: governedDaily.reason || "AI rate limit reached" });
    }

    const summary = governedDaily.result;

    await db.insert(emailSummaries).values({
      organizationId: orgId,
      userId: req.user.id,
      summaryType: 'DAILY',
      periodStart: oneDayAgo,
      periodEnd: new Date(),
      summaryContent: summary.summaryNarrative,
      highlightsJson: JSON.stringify(summary.highlights),
      emailCount: summary.totalEmails,
      tasksCreated: 0,
    });

    return res.json(summary);
  } catch (error) {
    console.error("Error generating daily summary:", error);
    return res.status(500).json({ error: "Failed to generate daily summary" });
  }
});

router.post("/summary/weekly", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const recentMessages = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        subject: emailMessages.subject,
        fromAddress: emailMessages.fromAddress,
        snippet: emailMessages.snippet,
        classification: emailMessages.classification,
        receivedAt: emailMessages.receivedAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.organizationId, orgId),
          gte(emailMessages.receivedAt, oneWeekAgo)
        )
      )
      .orderBy(desc(emailMessages.receivedAt))
      .limit(200);

    if (recentMessages.length === 0) {
      return res.json({
        periodDescription: "Last 7 days",
        totalEmails: 0,
        byClassification: {},
        highlights: [],
        actionNeeded: [],
        summaryNarrative: "No new emails in the last 7 days.",
      });
    }

    const governedWeekly = await governedAiCall<import("./ai/emailAi").EmailSummaryDigest>({
      orgId,
      userId: req.user.id,
      actionType: "email_weekly_summary",
      inputRefs: { messageCount: recentMessages.length },
      fn: async () => {
        const result = await generateEmailSummary(
          recentMessages.map(m => ({
            classification: m.classification ?? undefined,
            subject: m.subject,
            fromAddress: m.fromAddress,
            snippet: m.snippet ?? undefined,
            threadId: m.threadId,
            receivedAt: m.receivedAt,
          })),
          'WEEKLY'
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedWeekly.blocked) {
      return res.status(429).json({ error: governedWeekly.reason || "AI rate limit reached" });
    }

    const summary = governedWeekly.result;

    await db.insert(emailSummaries).values({
      organizationId: orgId,
      userId: req.user.id,
      summaryType: 'WEEKLY',
      periodStart: oneWeekAgo,
      periodEnd: new Date(),
      summaryContent: summary.summaryNarrative,
      highlightsJson: JSON.stringify(summary.highlights),
      emailCount: summary.totalEmails,
      tasksCreated: 0,
    });

    return res.json(summary);
  } catch (error) {
    console.error("Error generating weekly summary:", error);
    return res.status(500).json({ error: "Failed to generate weekly summary" });
  }
});

router.get("/summary/latest", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const summaries = await db
      .select()
      .from(emailSummaries)
      .where(
        and(
          eq(emailSummaries.organizationId, orgId),
          eq(emailSummaries.userId, req.user.id)
        )
      )
      .orderBy(desc(emailSummaries.createdAt))
      .limit(5);

    return res.json(summaries);
  } catch (error) {
    console.error("Error fetching summaries:", error);
    return res.status(500).json({ error: "Failed to fetch summaries" });
  }
});

// ========================================
// Routes from emailTaskRoutes.ts
// ========================================

router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { status, projectId, limit = '50', offset = '0' } = req.query;

    const conditions = [
      eq(tasks.organizationId, orgId),
      or(
        eq(tasks.sourceType, 'EMAIL'),
        eq(tasks.sourceType, 'AI_GENERATED'),
        eq(tasks.sourceType, 'SYSTEM'),
        isNotNull(tasks.emailThreadId)
      )
    ];
    
    if (status && ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status as string)) {
      conditions.push(eq(tasks.status, status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED"));
    }
    
    if (projectId && typeof projectId === 'string') {
      conditions.push(eq(tasks.projectId, projectId));
    }

    const taskResults = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(taskResults);
  } catch (error) {
    console.error("Error fetching email tasks:", error);
    return res.status(500).json({ error: "Failed to fetch email tasks" });
  }
});

router.post("/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const taskSchema = z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
      dueDate: z.string().datetime().optional(),
      emailThreadId: z.string().uuid().optional(),
      emailMessageId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      bidId: z.string().uuid().optional(),
      vendorId: z.string().uuid().optional(),
      assignedToId: z.string().uuid().optional(),
      sourceType: z.enum(['MANUAL', 'EMAIL', 'AI_GENERATED', 'SYSTEM']).default('EMAIL'),
    });

    const parseResult = taskSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: orgId,
        createdById: req.user.id,
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        emailThreadId: data.emailThreadId,
        emailMessageId: data.emailMessageId,
        projectId: data.projectId,
        bidId: data.bidId,
        vendorId: data.vendorId,
        assignedToId: data.assignedToId,
        status: 'PENDING',
        sourceType: data.sourceType,
      })
      .returning();

    await logCreate(req.user.id, "TASK", task.id, { title: task.title, sourceType: task.sourceType }, req);

    return res.status(201).json(task);
  } catch (error) {
    console.error("Error creating email task:", error);
    return res.status(500).json({ error: "Failed to create email task" });
  }
});

router.patch("/tasks/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      assignedToId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      bidId: z.string().uuid().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
    });

    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const [existing] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, req.params.id),
          eq(tasks.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Task not found" });
    }

    const data = parseResult.data;
    const updateData: Partial<Task> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.projectId !== undefined) updateData.projectId = data.projectId;
    if (data.bidId !== undefined) updateData.bidId = data.bidId;
    if (data.vendorId !== undefined) updateData.vendorId = data.vendorId;

    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    if (data.status === 'COMPLETED') {
      updateData.completedAt = new Date();
      updateData.completedById = req.user.id;
    }

    if (data.status === 'DISMISSED') {
      updateData.dismissedAt = new Date();
      updateData.dismissedById = req.user.id;
    }

    const [updated] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, req.params.id))
      .returning();

    await logUpdate(
      req.user.id,
      "TASK",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json(updated);
  } catch (error) {
    console.error("Error updating email task:", error);
    return res.status(500).json({ error: "Failed to update email task" });
  }
});

export default router;
