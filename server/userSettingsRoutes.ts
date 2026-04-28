import { Router, type Response } from "express";
import { db } from "./db";
import { userSettings, activityLog, users, timeEntries, userCertifications, userApiKeys, userTotpSecrets, userSessions, integrationConnections } from "@shared/schema";
import { eq, desc, and, isNull, ne } from "drizzle-orm";
import { requireAuth, revokeUserTokens, generateToken, setAuthCookie, type AuthRequest } from "./auth";
import { z } from "zod";
import crypto from "crypto";
import { TOTP, generateSecret as otpGenerateSecret, generateURI } from "otplib";
import QRCode from "qrcode";
import type { TimeEntry, UserCertification } from "@shared/schema";
import { logError, logWarn } from "./utils/logger";
import { parseOrRespond } from "./utils/validation";
import { sendCrmContactBirthdayDigestForUser } from "./jobs/jobRunner";
import {
  DEFAULT_ALLOW_TWO_FINGER_ROTATE,
  DEFAULT_PALM_REJECTION_BAND_PX,
  DEFAULT_SKIP_BULK_SCALE_PROPAGATION_CONFIRM,
  DEFAULT_STYLUS_LONG_PRESS_MS,
  PALM_REJECTION_BAND_MAX_PX,
  PALM_REJECTION_BAND_MIN_PX,
  STYLUS_LONG_PRESS_MAX_MS,
  STYLUS_LONG_PRESS_MIN_MS,
} from "@shared/schema";

const router = Router();

// Task #706: per-user cooldown for the "Send a test now" digest button so the
// endpoint can't be hammered. In-memory map keyed by userId is sufficient
// since the test trigger is best-effort and a process restart simply resets
// the cooldown — no need for a durable store.
const BIRTHDAY_DIGEST_TEST_COOLDOWN_MS = 5 * 60 * 1000;
const lastBirthdayDigestTestAt = new Map<string, number>();

function requireAdminRole(req: AuthRequest, res: Response): boolean {
  const role = req.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

router.get("/api/user-settings", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    if (!settings) {
      return res.json({
        themePreference: "system",
        defaultLandingPage: "/dashboard",
        dateFormat: "MM/DD/YYYY",
        timeFormat: "12h",
        timezone: req.user!.timezone || null,
        tableDensity: "COZY",
        crmBirthdayDigestOptOut: false,
        birthdayDigestWeekday: 1,
        birthdayDigestHour: 8,
        allowTwoFingerRotate: DEFAULT_ALLOW_TWO_FINGER_ROTATE,
        palmRejectionBandPx: DEFAULT_PALM_REJECTION_BAND_PX,
        stylusLongPressMs: DEFAULT_STYLUS_LONG_PRESS_MS,
        skipBulkScalePropagationConfirm: DEFAULT_SKIP_BULK_SCALE_PROPAGATION_CONFIRM,
      });
    }
    return res.json(settings);
  } catch (error) {
    return next(error);
  }
});

router.patch("/api/user-settings", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const schema = z.object({
      themePreference: z.enum(["light", "dark", "system"]).optional(),
      defaultLandingPage: z.enum(["/dashboard", "/projects", "/calendar", "/tasks", "/bids", "/communications"]).optional(),
      dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]).optional(),
      timeFormat: z.enum(["12h", "24h"]).optional(),
      timezone: z.string().nullable().optional(),
      tableDensity: z.enum(["COMPACT", "COZY", "COMFORTABLE"]).optional(),
      crmBirthdayDigestOptOut: z.boolean().optional(),
      birthdayDigestWeekday: z.number().int().min(0).max(6).optional(),
      birthdayDigestHour: z.number().int().min(0).max(23).optional(),
      // Task #2142 — takeoff stylus prefs
      allowTwoFingerRotate: z.boolean().optional(),
      palmRejectionBandPx: z.number().int().min(PALM_REJECTION_BAND_MIN_PX).max(PALM_REJECTION_BAND_MAX_PX).optional(),
      stylusLongPressMs: z.number().int().min(STYLUS_LONG_PRESS_MIN_MS).max(STYLUS_LONG_PRESS_MAX_MS).optional(),
      // Task #2228 — "Don't ask again" remembered choice for the
      // bulk-scale propagation confirmation dialog.
      skipBulkScalePropagationConfirm: z.boolean().optional(),
    });

    const parsed = parseOrRespond(schema, req.body, res);
    if (!parsed) return;
    const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);

    if (existing) {
      const [updated] = await db
        .update(userSettings)
        .set({ ...parsed, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId))
        .returning();
      return res.json(updated);
    } else {
      const [created] = await db
        .insert(userSettings)
        .values({
          userId,
          organizationId: req.user!.organizationId || undefined,
          ...parsed,
        })
        .returning();
      return res.json(created);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid settings data", details: error.errors });
    }
    return next(error);
  }
});

router.post("/api/user-settings/birthday-digest/test", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "User is not associated with an organization." });
    }

    const now = Date.now();
    const last = lastBirthdayDigestTestAt.get(userId);
    if (last && now - last < BIRTHDAY_DIGEST_TEST_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((BIRTHDAY_DIGEST_TEST_COOLDOWN_MS - (now - last)) / 1000);
      return res.status(429).json({
        error: `Please wait ${waitSeconds} seconds before sending another test digest.`,
        retryAfterSeconds: waitSeconds,
      });
    }
    lastBirthdayDigestTestAt.set(userId, now);

    try {
      const result = await sendCrmContactBirthdayDigestForUser(userId, orgId);
      if (result.sent) {
        const count = result.upcomingCount ?? 0;
        const base = `Test digest sent (${count} upcoming birthday${count === 1 ? "" : "s"}).`;
        let emailSuffix: string;
        if (result.emailAttempted && result.emailSent) {
          emailSuffix = ` Emailed to ${result.emailRecipient}. Also added to your in-app notifications.`;
        } else if (result.emailAttempted && !result.emailSent) {
          emailSuffix = ` In-app notification was created, but the email to ${result.emailRecipient} could not be delivered — check email service configuration.`;
        } else {
          emailSuffix = " Added to your in-app notifications. (No email on file, so nothing was emailed.)";
        }
        return res.json({
          success: true,
          sent: true,
          emailAttempted: !!result.emailAttempted,
          emailSent: !!result.emailSent,
          emailRecipient: result.emailRecipient ?? null,
          message: base + emailSuffix,
        });
      }
      if (result.reason === "no_upcoming_birthdays") {
        return res.json({
          success: true,
          sent: false,
          message: "No contact birthdays in the next 7 days — nothing to send.",
        });
      }
      return res.status(400).json({ error: result.reason || "Unable to send test digest." });
    } catch (err) {
      // Allow a retry sooner than the cooldown if the send itself blew up.
      lastBirthdayDigestTestAt.delete(userId);
      throw err;
    }
  } catch (error) {
    logError("Birthday digest test send failed", { error: String(error) });
    return next(error);
  }
});

router.get("/api/activity-log", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const logs = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.userId, userId))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json(logs);
  } catch (error) {
    return next(error);
  }
});

const deactivationRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});

router.post("/api/account/deactivation-request", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const parsed = deactivationRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request data", details: parsed.error.errors });
    }
    const reason = parsed.data.reason;

    await db.insert(activityLog).values({
      userId,
      organizationId: req.user!.organizationId || undefined,
      action: "ACCOUNT_DEACTIVATION_REQUEST",
      details: reason || "User requested account deactivation",
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.json({ success: true, message: "Deactivation request submitted. An administrator will review your request." });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/account/export", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    const [user] = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      role: users.role,
      timezone: users.timezone,
      profileDescription: users.profileDescription,
      birthdate: users.birthdate,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, userId)).limit(1);

    const settings = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const logs = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.userId, userId))
      .orderBy(desc(activityLog.createdAt))
      .limit(500);

    let timeEntryData: TimeEntry[] = [];
    try {
      timeEntryData = await db.select().from(timeEntries).where(eq(timeEntries.userId, userId)).orderBy(desc(timeEntries.date)).limit(1000);
    } catch (err) {
      logWarn("Failed to fetch time entries for user data export", { userId });
    }

    let certificationData: UserCertification[] = [];
    try {
      certificationData = await db.select().from(userCertifications).where(eq(userCertifications.userId, userId));
    } catch (err) {
      logWarn("Failed to fetch certifications for user data export", { userId });
    }

    const profileJson = JSON.stringify({ exportDate: new Date().toISOString(), profile: user, settings: settings[0] || null }, null, 2);
    const activityJson = JSON.stringify(logs, null, 2);
    const timeEntriesJson = JSON.stringify(timeEntryData, null, 2);
    const certificationsJson = JSON.stringify(certificationData, null, 2);

    const files: Record<string, string> = {
      "profile.json": profileJson,
      "activity-log.json": activityJson,
      "time-entries.json": timeEntriesJson,
      "certifications.json": certificationsJson,
    };

    const { Readable } = require("stream");
    const archiver = require("archiver");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="account-data-${new Date().toISOString().split("T")[0]}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) {
      return next(error);
    }
  }
});

router.get("/api/account/sessions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const currentIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";
    const currentUa = req.headers["user-agent"] || "";

    await db.update(userSessions)
      .set({ lastActiveAt: new Date() })
      .where(and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        eq(userSessions.ipAddress, currentIp),
        eq(userSessions.userAgent, currentUa),
      ))
      .catch((err: Error) => logWarn("Failed to update session heartbeat", { userId, error: err.message }));

    const sessions = await db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.lastActiveAt))
      .limit(20);

    if (sessions.length === 0) {
      const [newSession] = await db.insert(userSessions).values({
        userId,
        userAgent: currentUa,
        ipAddress: currentIp,
      }).returning();

      return res.json([{
        id: newSession.id,
        browser: newSession.userAgent || "Unknown",
        ipAddress: newSession.ipAddress || "Unknown",
        lastActive: newSession.lastActiveAt.toISOString(),
        isCurrent: true,
      }]);
    }

    return res.json(sessions.map(s => ({
      id: s.id,
      browser: s.userAgent || "Unknown",
      ipAddress: s.ipAddress || "Unknown",
      lastActive: s.lastActiveAt.toISOString(),
      isCurrent: s.ipAddress === currentIp && s.userAgent === currentUa,
    })));
  } catch (error) {
    return next(error);
  }
});

router.post("/api/account/sessions/revoke-all", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const currentIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";
    const currentUa = req.headers["user-agent"] || "";

    const activeSessions = await db.select({ id: userSessions.id })
      .from(userSessions)
      .where(and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        eq(userSessions.ipAddress, currentIp),
        eq(userSessions.userAgent, currentUa),
      ))
      .limit(1);

    const currentSessionId = activeSessions[0]?.id;

    if (currentSessionId) {
      await db.update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          ne(userSessions.id, currentSessionId),
        ));
    } else {
      await db.update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
    }

    await revokeUserTokens(userId);

    const [updatedUser] = await db.select({ tokenVersion: users.tokenVersion })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (updatedUser) {
      const newToken = generateToken(userId, updatedUser.tokenVersion);
      setAuthCookie(res, newToken);
    }

    await db.insert(activityLog).values({
      userId,
      organizationId: req.user!.organizationId || undefined,
      action: "SESSIONS_REVOKED",
      details: "All other sessions revoked by user",
      ipAddress: currentIp || null,
      userAgent: currentUa || null,
    }).catch((err: Error) => logWarn("Failed to log session revocation activity", { userId, error: err.message }));

    return res.json({ success: true, message: "All other sessions have been revoked." });
  } catch (error) {
    return next(error);
  }
});

const pendingTotpSetups = new Map<string, { secret: string; backupCodes: string[] }>();

router.post("/api/account/2fa/setup", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    const [existing] = await db.select().from(userTotpSecrets)
      .where(and(eq(userTotpSecrets.userId, userId), eq(userTotpSecrets.enabled, true)))
      .limit(1);

    if (existing) {
      return res.status(400).json({ error: "Two-factor authentication is already enabled." });
    }

    const secret = otpGenerateSecret();
    const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString("hex"));

    pendingTotpSetups.set(userId, { secret, backupCodes });

    const userEmail = req.user!.email;
    const otpauthUrl = generateURI({ issuer: "SmartManageAI", label: userEmail, secret, type: "totp" });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return res.json({
      secret,
      qrCode: qrCodeDataUrl,
      backupCodes,
      otpauthUrl,
    });
  } catch (error) {
    return next(error);
  }
});

const totpVerifySchema = z.object({
  token: z.string().min(1).max(10),
});

router.post("/api/account/2fa/verify", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const validation = totpVerifySchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "A valid verification token is required" });
    }
    const { token } = validation.data;

    const setup = pendingTotpSetups.get(userId);
    if (!setup) {
      return res.status(400).json({ error: "No 2FA setup in progress. Please start setup first." });
    }

    const totp = new TOTP();
    const isValid = totp.verify({ token, secret: setup.secret });
    if (!isValid) {
      return res.status(400).json({ error: "Invalid verification code. Please try again." });
    }

    const secretHash = hashValue(setup.secret);
    const backupCodesHash = hashValue(JSON.stringify(setup.backupCodes));

    const [existingRecord] = await db.select().from(userTotpSecrets)
      .where(eq(userTotpSecrets.userId, userId))
      .limit(1);

    if (existingRecord) {
      await db.update(userTotpSecrets)
        .set({ secretHash, backupCodesHash, enabled: true, verifiedAt: new Date() })
        .where(eq(userTotpSecrets.userId, userId));
    } else {
      await db.insert(userTotpSecrets).values({
        userId,
        secretHash,
        backupCodesHash,
        enabled: true,
      });
    }

    await db.insert(activityLog).values({
      userId,
      organizationId: req.user!.organizationId || undefined,
      action: "2FA_ENABLED",
      details: "Two-factor authentication enabled",
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });

    pendingTotpSetups.delete(userId);

    return res.json({ success: true, message: "Two-factor authentication has been enabled." });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/account/2fa/status", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [record] = await db.select().from(userTotpSecrets)
      .where(and(eq(userTotpSecrets.userId, userId), eq(userTotpSecrets.enabled, true)))
      .limit(1);

    return res.json({ enabled: !!record, verifiedAt: record?.verifiedAt?.toISOString() || null });
  } catch (error) {
    return next(error);
  }
});

router.post("/api/account/2fa/disable", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;

    await db.update(userTotpSecrets)
      .set({ enabled: false })
      .where(eq(userTotpSecrets.userId, userId));

    await db.insert(activityLog).values({
      userId,
      organizationId: req.user!.organizationId || undefined,
      action: "2FA_DISABLED",
      details: "Two-factor authentication disabled",
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.json({ success: true, message: "Two-factor authentication has been disabled." });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/account/api-keys", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!requireAdminRole(req, res)) return;
    const userId = req.user!.id;
    const keys = await db.select().from(userApiKeys)
      .where(eq(userApiKeys.userId, userId))
      .orderBy(desc(userApiKeys.createdAt));

    return res.json(keys.map(k => ({
      id: k.id,
      name: k.name,
      key: k.keyPrefix + "..." + k.keySuffix,
      createdAt: k.createdAt.toISOString(),
      lastUsed: k.lastUsedAt?.toISOString() || null,
    })));
  } catch (error) {
    return next(error);
  }
});

const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
});

router.post("/api/account/api-keys", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!requireAdminRole(req, res)) return;
    const userId = req.user!.id;
    const validation = apiKeyCreateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "A valid key name is required (max 100 characters)" });
    }
    const { name } = validation.data;

    const rawKey = `smak_${crypto.randomBytes(32).toString("hex")}`;
    const keyHashVal = hashValue(rawKey);
    const keyPrefix = rawKey.substring(0, 12);
    const keySuffix = rawKey.substring(rawKey.length - 4);

    await db.insert(userApiKeys).values({
      userId,
      name: name.trim(),
      keyHash: keyHashVal,
      keyPrefix,
      keySuffix,
    });

    await db.insert(activityLog).values({
      userId,
      organizationId: req.user!.organizationId || undefined,
      action: "API_KEY_CREATED",
      details: `API key "${name}" created`,
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.json({ key: rawKey, name: name.trim(), message: "Copy this key now. It will not be shown again." });
  } catch (error) {
    return next(error);
  }
});

router.delete("/api/account/api-keys/:keyId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!requireAdminRole(req, res)) return;
    const userId = req.user!.id;
    const keyId = req.params.keyId;

    const [deleted] = await db.delete(userApiKeys)
      .where(and(eq(userApiKeys.id, keyId), eq(userApiKeys.userId, userId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "API key not found" });
    }

    await db.insert(activityLog).values({
      userId,
      organizationId: req.user!.organizationId || undefined,
      action: "API_KEY_DELETED",
      details: `API key "${deleted.name}" deleted`,
      ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/api/account/integrations-status", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!requireAdminRole(req, res)) return;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.json([]);
    }

    const connections = await db.select({
      provider: integrationConnections.provider,
      status: integrationConnections.status,
      displayName: integrationConnections.displayName,
    }).from(integrationConnections)
      .where(eq(integrationConnections.organizationId, orgId));

    return res.json(connections);
  } catch (error) {
    return res.json([]);
  }
});

export default router;
