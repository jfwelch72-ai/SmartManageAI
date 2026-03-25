import { Router } from "express";
import { db } from "./db";
import { emailAccounts, insertEmailAccountSchema, type EmailAccount, emailProviderEnum, emailThreads, emailMessages, emailAttachments, tasks, emailThreadStatusEnum, emailClassificationEnum, emailSummaries, type Task } from "@shared/schema";
import { eq, and, desc, gte, or, isNotNull, sql, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logUpdate, logDelete, logAudit } from "./auditLogger";
import { sanitizeEmail, sanitizeText, sanitizeShortText } from "./sanitization";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getCanonicalBaseUrl, isRedirectUriValid } from "./utils/routeHelpers";
import { ObjectStorageService } from "./objectStorage";
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
import { testFullConnection, fetchImapMessages, sendSmtpEmail } from "./services/imapService";

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

// DELETE /api/email/accounts/:id - Remove an email account
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

    // Clean up attachment files from object storage before cascade deletes the records
    try {
      const threads = await db
        .select({ id: emailThreads.id })
        .from(emailThreads)
        .where(eq(emailThreads.emailAccountId, existing.id));

      if (threads.length > 0) {
        const threadIds = threads.map((t) => t.id);
        const attachments = await db
          .select({ storageKey: emailAttachments.storageKey })
          .from(emailAttachments)
          .innerJoin(emailMessages, eq(emailAttachments.emailMessageId, emailMessages.id))
          .where(inArray(emailMessages.threadId, threadIds));

        if (attachments.length > 0) {
          const objectStorageService = new ObjectStorageService();
          const deleteResults = await Promise.allSettled(
            attachments.map((a) => objectStorageService.deleteObjectByKey(a.storageKey))
          );
          const failures = deleteResults.filter((r) => r.status === "rejected");
          if (failures.length > 0) {
            console.error(`Failed to delete ${failures.length}/${attachments.length} attachment files for account ${existing.id}`);
          }
        }
      }
    } catch (storageError) {
      console.error("Error cleaning up attachment files from object storage:", storageError);
    }

    // Clean up email summaries for this user/org
    try {
      await db
        .delete(emailSummaries)
        .where(
          and(
            eq(emailSummaries.userId, existing.userId),
            eq(emailSummaries.organizationId, existing.organizationId)
          )
        );
    } catch (summaryError) {
      console.error("Error cleaning up email summaries:", summaryError);
    }

    // Hard delete (cascades to emailThreads and emailMessages)
    const [deleted] = await db
      .delete(emailAccounts)
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

    return res.json({ success: true, message: "Email account removed" });
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

    if (account.provider === "IMAP") {
      const result = await testFullConnection(account);
      if (!result.success) {
        const errors: string[] = [];
        if (!result.imap.success) errors.push(result.imap.error || "IMAP connection failed");
        if (!result.smtp.success && result.smtp.message !== "SMTP not configured (skipped)") {
          errors.push(result.smtp.error || "SMTP connection failed");
        }
        return res.status(400).json({
          success: false,
          message: errors.join("; "),
          imap: result.imap,
          smtp: result.smtp,
        });
      }
      return res.json({
        success: true,
        message: "Connection test successful",
        imap: result.imap,
        smtp: result.smtp,
      });
    }

    return res.json({ 
      success: true, 
      message: "Connection test successful",
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

async function refreshGmailAccessToken(account: typeof emailAccounts.$inferSelect): Promise<string> {
  if (!account.refreshToken) {
    throw new Error("No refresh token available for account " + account.emailAddress);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CONFIG.clientId,
      client_secret: GMAIL_CONFIG.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gmail token refresh failed:", errText);
    throw new Error("Failed to refresh Gmail access token");
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  await db
    .update(emailAccounts)
    .set({
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(emailAccounts.id, account.id));

  return data.access_token;
}

async function getValidGmailToken(account: typeof emailAccounts.$inferSelect): Promise<string> {
  if (account.accessToken && account.expiresAt && account.expiresAt.getTime() > Date.now() + 60000) {
    return account.accessToken;
  }
  return refreshGmailAccessToken(account);
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
  headers?: { name: string; value: string }[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailMessagePart & {
    headers?: { name: string; value: string }[];
  };
  internalDate?: string;
}

function getGmailHeader(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBodyFromParts(parts: GmailMessagePart[] | undefined, mimeType: string): string {
  if (!parts) return "";
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts, mimeType);
      if (nested) return nested;
    }
  }
  return "";
}

function parseGmailMessage(msg: GmailMessage, accountEmail: string): {
  externalId: string;
  threadId: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string;
  ccAddresses: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  snippet: string;
  receivedAt: Date;
  isIncoming: boolean;
  hasAttachments: boolean;
  isRead: boolean;
} {
  const headers = msg.payload?.headers || [];
  const fromRaw = getGmailHeader(headers, "From");
  const fromMatch = fromRaw.match(/^(?:"?(.+?)"?\s+)?<?([^>]+@[^>]+)>?$/);
  const fromName = fromMatch?.[1] || "";
  const fromAddress = fromMatch?.[2] || fromRaw;
  const toRaw = getGmailHeader(headers, "To");
  const ccRaw = getGmailHeader(headers, "Cc");
  const subject = getGmailHeader(headers, "Subject") || "(No Subject)";

  let bodyText = "";
  let bodyHtml = "";
  if (msg.payload?.body?.data) {
    if (msg.payload.mimeType === "text/html") {
      bodyHtml = decodeBase64Url(msg.payload.body.data);
    } else {
      bodyText = decodeBase64Url(msg.payload.body.data);
    }
  }
  if (msg.payload?.parts) {
    bodyText = bodyText || extractBodyFromParts(msg.payload.parts, "text/plain");
    bodyHtml = bodyHtml || extractBodyFromParts(msg.payload.parts, "text/html");
  }

  const hasAttachments = !!(msg.payload?.parts?.some(p =>
    p.body && p.body.size && p.body.size > 0 && p.mimeType && !p.mimeType.startsWith("text/") && !p.mimeType.startsWith("multipart/")
  ));

  const isRead = !(msg.labelIds?.includes("UNREAD"));
  const isIncoming = !fromAddress.toLowerCase().includes(accountEmail.toLowerCase());

  return {
    externalId: msg.id,
    threadId: msg.threadId,
    fromAddress,
    fromName,
    toAddresses: JSON.stringify(toRaw ? toRaw.split(",").map(s => s.trim()) : []),
    ccAddresses: JSON.stringify(ccRaw ? ccRaw.split(",").map(s => s.trim()) : []),
    subject,
    bodyText: bodyText.substring(0, 50000),
    bodyHtml: bodyHtml.substring(0, 100000),
    snippet: msg.snippet || "",
    receivedAt: new Date(parseInt(msg.internalDate || "0")),
    isIncoming,
    hasAttachments,
    isRead,
  };
}

async function gmailApiFetch(url: string, account: typeof emailAccounts.$inferSelect): Promise<Response> {
  let token = await getValidGmailToken(account);
  let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (response.status === 401) {
    token = await refreshGmailAccessToken(account);
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  return response;
}

async function syncGmailAccount(
  account: typeof emailAccounts.$inferSelect,
  userId: string,
): Promise<{ messagesImported: number; threadsCreated: number; errors: string[] }> {
  const result = { messagesImported: 0, threadsCreated: 0, errors: [] as string[] };
  const MAX_PAGES = 5;
  const PAGE_SIZE = 50;

  const query = account.lastSyncedAt
    ? `after:${Math.floor(account.lastSyncedAt.getTime() / 1000)}`
    : "newer_than:7d";

  const allMessageRefs: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${PAGE_SIZE}`;
    if (pageToken) {
      listUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const listResponse = await gmailApiFetch(listUrl, account);

    if (!listResponse.ok) {
      const errText = await listResponse.text();
      console.error("Gmail list messages failed:", errText);
      throw new Error(`Gmail API error: ${listResponse.status}`);
    }

    const listData = await listResponse.json() as {
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    };

    if (listData.messages) {
      allMessageRefs.push(...listData.messages);
    }

    if (!listData.nextPageToken) break;
    pageToken = listData.nextPageToken;
  }

  if (allMessageRefs.length === 0) {
    return result;
  }

  const candidateIds = allMessageRefs.map(m => m.id);
  const existingMessages = await db
    .select({ externalId: emailMessages.externalId })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.emailAccountId, account.id),
        inArray(emailMessages.externalId, candidateIds)
      )
    );
  const existingIds = new Set(existingMessages.map(m => m.externalId));

  const newMessageRefs = allMessageRefs.filter(m => !existingIds.has(m.id));
  if (newMessageRefs.length === 0) {
    return result;
  }

  const threadMap = new Map<string, string>();
  const messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[] = [];

  for (const msgRef of newMessageRefs) {
    try {
      const msgResponse = await gmailApiFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=full`,
        account
      );

      if (!msgResponse.ok) {
        result.errors.push(`Failed to fetch message ${msgRef.id}: ${msgResponse.status}`);
        continue;
      }

      const gmailMsg = await msgResponse.json() as GmailMessage;
      const parsed = parseGmailMessage(gmailMsg, account.emailAddress);

      let dbThreadId = threadMap.get(parsed.threadId);

      if (!dbThreadId) {
        const [existingThread] = await db
          .select({ id: emailThreads.id })
          .from(emailThreads)
          .where(
            and(
              eq(emailThreads.emailAccountId, account.id),
              eq(emailThreads.externalThreadId, parsed.threadId)
            )
          )
          .limit(1);

        if (existingThread) {
          dbThreadId = existingThread.id;
        } else {
          const newThreadId = crypto.randomUUID();
          await db.insert(emailThreads).values({
            id: newThreadId,
            organizationId: account.organizationId,
            emailAccountId: account.id,
            subject: parsed.subject,
            externalThreadId: parsed.threadId,
            status: "OPEN",
            messageCount: 0,
            unreadCount: 0,
            lastMessageAt: parsed.receivedAt,
          });
          dbThreadId = newThreadId;
          result.threadsCreated++;
        }
        threadMap.set(parsed.threadId, dbThreadId);
      }

      const newMessageId = crypto.randomUUID();
      await db.insert(emailMessages).values({
        id: newMessageId,
        organizationId: account.organizationId,
        emailAccountId: account.id,
        threadId: dbThreadId,
        externalId: parsed.externalId,
        fromAddress: parsed.fromAddress,
        fromName: parsed.fromName || null,
        toAddresses: parsed.toAddresses,
        ccAddresses: parsed.ccAddresses,
        subject: parsed.subject,
        bodyText: parsed.bodyText || null,
        bodyHtml: parsed.bodyHtml || null,
        snippet: parsed.snippet || null,
        receivedAt: parsed.receivedAt,
        isRead: parsed.isRead,
        isIncoming: parsed.isIncoming,
        hasAttachments: parsed.hasAttachments,
      });
      result.messagesImported++;

      const [msgCounts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
          maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
        })
        .from(emailMessages)
        .where(eq(emailMessages.threadId, dbThreadId));

      await db
        .update(emailThreads)
        .set({
          messageCount: msgCounts?.total ?? 1,
          unreadCount: msgCounts?.unread ?? 1,
          lastMessageAt: msgCounts?.maxReceivedAt ?? parsed.receivedAt,
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, dbThreadId));

      messagesToClassify.push({
        messageId: newMessageId,
        threadId: dbThreadId,
        subject: parsed.subject,
        bodyText: parsed.bodyText,
        fromAddress: parsed.fromAddress,
      });
    } catch (err) {
      result.errors.push(`Error processing message ${msgRef.id}: ${String(err)}`);
    }
  }

  for (const msg of messagesToClassify) {
    try {
      const analysis = await analyzeEmail(msg.subject, msg.bodyText, msg.fromAddress, account.organizationId);

      await db
        .update(emailMessages)
        .set({
          classification: analysis.classification,
          aiMetadata: JSON.stringify(analysis),
          aiAnalyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailMessages.id, msg.messageId));

      await db
        .update(emailThreads)
        .set({
          primaryClassification: analysis.classification,
          aiSummary: analysis.summary,
          aiMetadata: JSON.stringify(analysis.extractedEntities),
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, msg.threadId));

      const matchedEntities = await matchEmailToEntities(analysis, account.organizationId);
      if (matchedEntities.projectId || matchedEntities.bidId || matchedEntities.vendorId) {
        await db
          .update(emailThreads)
          .set({
            projectId: matchedEntities.projectId || undefined,
            bidId: matchedEntities.bidId || undefined,
            vendorId: matchedEntities.vendorId || undefined,
          })
          .where(eq(emailThreads.id, msg.threadId));
      }

      await createTaskFromEmail(
        analysis,
        msg.messageId,
        msg.threadId,
        account.organizationId,
        userId,
        matchedEntities,
      );
    } catch (err) {
      console.error(`AI classification failed for message ${msg.messageId}:`, err);
    }
  }

  if (result.errors.length === 0 || result.messagesImported > 0) {
    await db
      .update(emailAccounts)
      .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailAccounts.id, account.id));
  }

  return result;
}

async function syncImapAccount(
  account: typeof emailAccounts.$inferSelect,
  userId: string,
): Promise<{ messagesImported: number; threadsCreated: number; errors: string[] }> {
  const result = { messagesImported: 0, threadsCreated: 0, errors: [] as string[] };

  try {
    const since = account.lastSyncedAt || undefined;
    const fetched = await fetchImapMessages(account, since, 100);

    if (fetched.length === 0) {
      return result;
    }

    const candidateIds = fetched.map(m => m.externalId);
    const existingMessages = await db
      .select({ externalId: emailMessages.externalId })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.emailAccountId, account.id),
          inArray(emailMessages.externalId, candidateIds)
        )
      );
    const existingIds = new Set(existingMessages.map(m => m.externalId));

    const newMessages = fetched.filter(m => !existingIds.has(m.externalId));
    if (newMessages.length === 0) {
      return result;
    }

    const threadMap = new Map<string, string>();
    const messagesToClassify: { messageId: string; threadId: string; subject: string; bodyText: string; fromAddress: string }[] = [];

    for (const msg of newMessages) {
      try {
        const threadKey = msg.subject
          .replace(/^(Re|Fwd|Fw):\s*/gi, "")
          .trim()
          .toLowerCase();

        let dbThreadId = threadMap.get(threadKey);

        if (!dbThreadId) {
          const normalizedSubject = msg.subject.replace(/^(Re|Fwd|Fw):\s*/gi, "").trim();
          const [existingThread] = await db
            .select({ id: emailThreads.id })
            .from(emailThreads)
            .where(
              and(
                eq(emailThreads.emailAccountId, account.id),
                eq(emailThreads.subject, normalizedSubject)
              )
            )
            .limit(1);

          if (existingThread) {
            dbThreadId = existingThread.id;
          } else {
            const newThreadId = crypto.randomUUID();
            await db.insert(emailThreads).values({
              id: newThreadId,
              organizationId: account.organizationId,
              emailAccountId: account.id,
              subject: normalizedSubject || msg.subject,
              externalThreadId: msg.messageId,
              status: "OPEN",
              messageCount: 0,
              unreadCount: 0,
              lastMessageAt: msg.receivedAt,
            });
            dbThreadId = newThreadId;
            result.threadsCreated++;
          }
          threadMap.set(threadKey, dbThreadId);
        }

        const isIncoming = msg.fromAddress.toLowerCase() !== account.emailAddress.toLowerCase();

        const newMessageId = crypto.randomUUID();
        await db.insert(emailMessages).values({
          id: newMessageId,
          organizationId: account.organizationId,
          emailAccountId: account.id,
          threadId: dbThreadId,
          externalId: msg.externalId,
          fromAddress: msg.fromAddress,
          fromName: msg.fromName || null,
          toAddresses: msg.toAddresses,
          ccAddresses: msg.ccAddresses,
          subject: msg.subject,
          bodyText: msg.bodyText || null,
          bodyHtml: msg.bodyHtml || null,
          snippet: msg.snippet || null,
          receivedAt: msg.receivedAt,
          isRead: msg.isRead,
          isIncoming: isIncoming,
          hasAttachments: msg.hasAttachments,
        });
        result.messagesImported++;

        const [msgCounts] = await db
          .select({
            total: sql<number>`count(*)::int`,
            unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
            maxReceivedAt: sql<Date>`max(${emailMessages.receivedAt})`,
          })
          .from(emailMessages)
          .where(eq(emailMessages.threadId, dbThreadId));

        await db
          .update(emailThreads)
          .set({
            messageCount: msgCounts?.total ?? 1,
            unreadCount: msgCounts?.unread ?? 1,
            lastMessageAt: msgCounts?.maxReceivedAt ?? msg.receivedAt,
            updatedAt: new Date(),
          })
          .where(eq(emailThreads.id, dbThreadId));

        messagesToClassify.push({
          messageId: newMessageId,
          threadId: dbThreadId,
          subject: msg.subject,
          bodyText: msg.bodyText,
          fromAddress: msg.fromAddress,
        });
      } catch (err) {
        result.errors.push(`Error processing IMAP message ${msg.externalId}: ${String(err)}`);
      }
    }

    for (const msg of messagesToClassify) {
      try {
        const analysis = await analyzeEmail(msg.subject, msg.bodyText, msg.fromAddress, account.organizationId);

        await db
          .update(emailMessages)
          .set({
            classification: analysis.classification,
            aiMetadata: JSON.stringify(analysis),
            aiAnalyzedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(emailMessages.id, msg.messageId));

        await db
          .update(emailThreads)
          .set({
            primaryClassification: analysis.classification,
            aiSummary: analysis.summary,
            aiMetadata: JSON.stringify(analysis.extractedEntities),
            updatedAt: new Date(),
          })
          .where(eq(emailThreads.id, msg.threadId));

        const matchedEntities = await matchEmailToEntities(analysis, account.organizationId);
        if (matchedEntities.projectId || matchedEntities.bidId || matchedEntities.vendorId) {
          await db
            .update(emailThreads)
            .set({
              projectId: matchedEntities.projectId || undefined,
              bidId: matchedEntities.bidId || undefined,
              vendorId: matchedEntities.vendorId || undefined,
            })
            .where(eq(emailThreads.id, msg.threadId));
        }

        await createTaskFromEmail(
          analysis,
          msg.messageId,
          msg.threadId,
          account.organizationId,
          userId,
          matchedEntities,
        );
      } catch (err) {
        console.error(`AI classification failed for IMAP message ${msg.messageId}:`, err);
      }
    }

    if (result.errors.length === 0 || result.messagesImported > 0) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    }
  } catch (err) {
    result.errors.push(`IMAP sync failed: ${String(err)}`);
  }

  return result;
}

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

    const syncResults: { account: string; messagesImported: number; threadsCreated: number; errors: string[] }[] = [];

    for (const account of accounts) {
      try {
        if (account.provider === "GMAIL") {
          const accountResult = await syncGmailAccount(account, req.user.id);
          syncResults.push({
            account: account.emailAddress,
            ...accountResult,
          });
        } else if (account.provider === "IMAP") {
          const accountResult = await syncImapAccount(account, req.user.id);
          syncResults.push({
            account: account.emailAddress,
            ...accountResult,
          });
        } else {
          syncResults.push({
            account: account.emailAddress,
            messagesImported: 0,
            threadsCreated: 0,
            errors: [`Provider ${account.provider} sync not yet implemented`],
          });
        }
      } catch (err) {
        console.error(`Sync failed for account ${account.emailAddress}:`, err);
        syncResults.push({
          account: account.emailAddress,
          messagesImported: 0,
          threadsCreated: 0,
          errors: [String(err)],
        });
      }
    }

    const totalMessages = syncResults.reduce((sum, r) => sum + r.messagesImported, 0);
    const totalThreads = syncResults.reduce((sum, r) => sum + r.threadsCreated, 0);

    return res.json({
      success: true,
      message: `Synced ${totalMessages} message(s) across ${accounts.length} account(s)`,
      accountsProcessed: accounts.length,
      totalMessagesImported: totalMessages,
      totalThreadsCreated: totalThreads,
      details: syncResults,
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

const sendEmailSchema = z.object({
  accountId: z.string().min(1),
  to: z.string().email(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1).max(500),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  replyToMessageId: z.string().optional(),
});

router.post("/send", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const parseResult = sendEmailSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    const [account] = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.id, data.accountId),
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id),
          eq(emailAccounts.isActive, true)
        )
      )
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: "Email account not found or inactive" });
    }

    if (account.provider === "IMAP") {
      if (!account.smtpHost) {
        return res.status(400).json({ error: "SMTP not configured for this account. Please add SMTP settings to send emails." });
      }

      const sendResult = await sendSmtpEmail(account, {
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        text: data.text,
        html: data.html,
        inReplyTo: data.inReplyTo,
        references: data.references,
      });

      if (!sendResult.success) {
        return res.status(500).json({ error: sendResult.error || "Failed to send email" });
      }

      let targetThreadId: string | null = null;

      if (data.replyToMessageId) {
        const [originalMessage] = await db
          .select()
          .from(emailMessages)
          .where(
            and(
              eq(emailMessages.id, data.replyToMessageId),
              eq(emailMessages.organizationId, orgId)
            )
          )
          .limit(1);

        if (originalMessage) {
          targetThreadId = originalMessage.threadId;
        }
      }

      if (!targetThreadId) {
        const newThreadId = crypto.randomUUID();
        await db.insert(emailThreads).values({
          id: newThreadId,
          organizationId: orgId,
          emailAccountId: account.id,
          subject: data.subject,
          externalThreadId: sendResult.messageId || `sent-thread-${newThreadId}`,
          status: "OPEN",
          messageCount: 0,
          unreadCount: 0,
          lastMessageAt: new Date(),
        });
        targetThreadId = newThreadId;
      }

      const sentMessageId = crypto.randomUUID();
      await db.insert(emailMessages).values({
        id: sentMessageId,
        organizationId: orgId,
        emailAccountId: account.id,
        threadId: targetThreadId,
        externalId: sendResult.messageId || `sent-${sentMessageId}`,
        fromAddress: account.emailAddress,
        fromName: account.displayName || null,
        toAddresses: JSON.stringify([data.to]),
        ccAddresses: data.cc ? JSON.stringify([data.cc]) : null,
        subject: data.subject,
        bodyText: data.text || null,
        bodyHtml: data.html || null,
        snippet: (data.text || "").substring(0, 200),
        receivedAt: new Date(),
        isRead: true,
        isIncoming: false,
        hasAttachments: false,
      });

      const [msgCounts] = await db
        .select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${emailMessages.isRead} = false)::int`,
        })
        .from(emailMessages)
        .where(eq(emailMessages.threadId, targetThreadId));

      await db
        .update(emailThreads)
        .set({
          messageCount: msgCounts?.total ?? 1,
          unreadCount: msgCounts?.unread ?? 0,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, targetThreadId));

      await logAudit({
        userId: req.user.id,
        entityType: "EMAIL_MESSAGE",
        entityId: data.accountId,
        action: "CREATE",
        oldValue: null,
        newValue: JSON.stringify({ to: data.to, subject: data.subject }),
      }, req);

      return res.json({ success: true, messageId: sendResult.messageId });
    }

    return res.status(400).json({ error: `Sending via ${account.provider} is not yet supported from this endpoint` });
  } catch (error) {
    console.error("Error sending email:", error);
    return res.status(500).json({ error: "Failed to send email" });
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
