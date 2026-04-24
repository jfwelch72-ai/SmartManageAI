/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, email, password]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *               phone: { type: string }
 *               role: { type: string }
 *               organizationName: { type: string }
 *               tradeType: { type: string }
 *     responses:
 *       201: { description: User created successfully }
 *       400: { description: Invalid input or email already exists }
 *       429: { description: Rate limit exceeded }
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login with email and password
 *     description: Authenticates the user and sets an httpOnly JWT cookie (auth_token) valid for 7 days.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful, auth_token cookie is set
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401: { description: Invalid credentials }
 *       429: { description: Rate limit exceeded }
 * /api/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Logout and clear auth cookie
 *     responses:
 *       200: { description: Logged out successfully }
 * /api/auth/verify-email:
 *   get:
 *     tags: [Authentication]
 *     summary: Verify email address
 *     security: []
 *     parameters:
 *       - name: token
 *         in: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Email verified }
 *       400: { description: Invalid or expired token }
 * /api/auth/resend-verification:
 *   post:
 *     tags: [Authentication]
 *     summary: Resend email verification
 *     responses:
 *       200: { description: Verification email resent }
 * /api/auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current authenticated user
 *     responses:
 *       200:
 *         description: Current user data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401: { description: Not authenticated }
 * /api/auth/profile:
 *   patch:
 *     tags: [Authentication]
 *     summary: Update user profile
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               phone: { type: string }
 *               timezone: { type: string }
 *               profileDescription: { type: string }
 *     responses:
 *       200: { description: Profile updated }
 * /api/auth/change-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Change password for authenticated user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200: { description: Password changed successfully }
 *       400: { description: Current password incorrect }
 * /api/auth/upload-avatar:
 *   post:
 *     tags: [Authentication]
 *     summary: Upload user avatar
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200: { description: Avatar uploaded }
 * /api/auth/my-photos:
 *   get:
 *     tags: [Authentication]
 *     summary: Get user photos
 *     responses:
 *       200: { description: List of user photos }
 * /api/auth/upload-photos:
 *   post:
 *     tags: [Authentication]
 *     summary: Upload user photos
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201: { description: Photos uploaded }
 * /api/auth/my-photos/{photoId}:
 *   delete:
 *     tags: [Authentication]
 *     summary: Delete a user photo
 *     parameters:
 *       - name: photoId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Photo deleted }
 * /api/auth/my-skills:
 *   get:
 *     tags: [Authentication]
 *     summary: Get user skills
 *     responses:
 *       200: { description: List of user skills with ratings }
 *   post:
 *     tags: [Authentication]
 *     summary: Add a skill to user profile
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skillId]
 *             properties:
 *               skillId: { type: string, format: uuid }
 *               selfRating: { type: integer }
 *     responses:
 *       201: { description: Skill added }
 * /api/auth/my-skills/{userSkillId}:
 *   delete:
 *     tags: [Authentication]
 *     summary: Remove a skill from user profile
 *     parameters:
 *       - name: userSkillId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Skill removed }
 * /api/auth/my-skills/{userSkillId}/rating:
 *   patch:
 *     tags: [Authentication]
 *     summary: Update skill self-rating
 *     parameters:
 *       - name: userSkillId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [selfRating]
 *             properties:
 *               selfRating: { type: integer }
 *     responses:
 *       200: { description: Rating updated }
 * /api/auth/my-skills/{userSkillId}/request-verification:
 *   post:
 *     tags: [Authentication]
 *     summary: Request skill verification
 *     parameters:
 *       - name: userSkillId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201: { description: Verification request created }
 * /api/auth/skill-verification-requests:
 *   get:
 *     tags: [Authentication]
 *     summary: Get skill verification requests
 *     responses:
 *       200: { description: List of verification requests }
 * /api/auth/skill-verification-requests/{requestId}:
 *   patch:
 *     tags: [Authentication]
 *     summary: Approve or reject skill verification
 *     parameters:
 *       - name: requestId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *     responses:
 *       200: { description: Verification request updated }
 * /api/auth/my-certifications:
 *   get:
 *     tags: [Authentication]
 *     summary: Get user certifications
 *     responses:
 *       200: { description: List of certifications }
 *   post:
 *     tags: [Authentication]
 *     summary: Add a certification
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               issuingBody: { type: string }
 *               issueDate: { type: string, format: date }
 *               expirationDate: { type: string, format: date }
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201: { description: Certification added }
 * /api/auth/my-certifications/{certId}:
 *   patch:
 *     tags: [Authentication]
 *     summary: Update a certification
 *     parameters:
 *       - name: certId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Certification updated }
 *   delete:
 *     tags: [Authentication]
 *     summary: Delete a certification
 *     parameters:
 *       - name: certId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Certification deleted }
 * /api/auth/my-certifications/{certId}/upload:
 *   post:
 *     tags: [Authentication]
 *     summary: Upload certification file
 *     parameters:
 *       - name: certId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200: { description: File uploaded }
 * /api/auth/my-performance-profile:
 *   get:
 *     tags: [Authentication]
 *     summary: Get performance profile
 *     responses:
 *       200: { description: Performance profile data }
 *   put:
 *     tags: [Authentication]
 *     summary: Update performance profile
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Performance profile updated }
 * /api/auth/my-attendance-logs:
 *   get:
 *     tags: [Authentication]
 *     summary: Get my attendance logs
 *     responses:
 *       200: { description: Attendance log history }
 * /api/auth/attendance-logs:
 *   post:
 *     tags: [Authentication]
 *     summary: Create attendance log entry
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Attendance log created }
 * /api/auth/my-safety-incidents:
 *   get:
 *     tags: [Authentication]
 *     summary: Get my safety incidents
 *     responses:
 *       200: { description: Safety incident history }
 * /api/auth/safety-incidents:
 *   post:
 *     tags: [Authentication]
 *     summary: Report a safety incident
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Safety incident reported }
 * /api/auth/my-quality-issues:
 *   get:
 *     tags: [Authentication]
 *     summary: Get my quality issues
 *     responses:
 *       200: { description: Quality issue history }
 * /api/auth/quality-issues:
 *   post:
 *     tags: [Authentication]
 *     summary: Report a quality issue
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Quality issue reported }
 * /api/auth/my-performance-reviews:
 *   get:
 *     tags: [Authentication]
 *     summary: Get my performance reviews
 *     responses:
 *       200: { description: Performance review history }
 * /api/auth/performance-reviews:
 *   post:
 *     tags: [Authentication]
 *     summary: Create performance review
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Performance review created }
 * /api/auth/my-supervisor-notes:
 *   get:
 *     tags: [Authentication]
 *     summary: Get supervisor notes about me
 *     responses:
 *       200: { description: Supervisor notes }
 * /api/auth/supervisor-notes:
 *   post:
 *     tags: [Authentication]
 *     summary: Create supervisor note
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201: { description: Supervisor note created }
 */
import {logError, logInfo, logWarn } from "./utils/logger";
import { Router } from "express";
import multer from "multer";
import { db } from "./db";
import {
  users, organizations, userPhotos, userSkills, skills,
  skillVerificationRequests, userCertifications, notifications,
  employeePerformanceProfiles, attendanceLogs, safetyIncidents,
  qualityIssues, performanceReviews, supervisorNotes,
  ssoConfigurations, userSessions, activityLog
} from "@shared/schema";
import {
  requireAuth, hashPassword, verifyPassword, generateToken, invalidateAuthCache,
  setAuthCookie, clearAuthCookie, type AuthRequest
} from "./auth";
import { authLimiter, sensitiveLimiter } from "./rateLimiter";
import { eq, desc, sql, and, or, inArray, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { logUpdate, logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { emailVerificationTokens } from "@shared/schema";
import { sendEmail, getEmailVerificationHtml, getEmailVerificationText } from "./email";
import {
  sendEmail as sendEmailViaService,
  getTestEmailOutbox,
  clearTestEmailOutbox,
  isEmailTransportNoop,
} from "./services/emailService";
import { buildQuietHoursDigestPreview, type QuietHoursDigestFormat } from "./utils/jobMetricAlerts";
import { insertNotification } from "./services/notificationService";
import { notifyOrgAdminsOfFallbackCoverageGap } from "./services/transcriptBackfillNotifications";
import { setAllFeatureFlags } from "./services/featureFlagService";
import { FEATURE_FLAG_KEYS } from "@shared/schema";
import { requireDevSeed } from "./utils/devSeedFlag";
import { passwordSchema } from "@shared/utils/passwordPolicy";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

  // ====================
  // Auth Routes
  // ====================

  const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  });

  const registerSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    phone: z.string().optional(),
    password: passwordSchema,
  });

  // Register new user
  router.post("/api/auth/register", authLimiter, async (req: AuthRequest, res, next) => {
    try {
      // SECURITY: Sanitize inputs before validation for data integrity
      const sanitizedBody = {
        firstName: sanitizeShortText(req.body.firstName),
        lastName: sanitizeShortText(req.body.lastName),
        email: sanitizeEmail(req.body.email),
        phone: sanitizePhone(req.body.phone),
        password: req.body.password, // Don't sanitize passwords - preserve exact input
      };

      const validationResult = registerSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { firstName, lastName, email, phone, password } = validationResult.data;

      // Check if user already exists
      const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existingUser) {
        res.status(400).json({ error: "User with this email already exists" });
        return;
      }

      const passwordHashVal = await hashPassword(password);
      
      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone,
        role: "ADMIN",
        isActive: true,
        emailVerified: false,
        passwordHash: passwordHashVal,
      }).returning();

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
      await db.insert(emailVerificationTokens).values({
        userId: newUser.id,
        tokenHash: verificationHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const verifyLink = `${appUrl}/api/auth/verify-email?token=${verificationToken}&userId=${newUser.id}`;
      sendEmail({
        to: email,
        subject: "Verify your email - SmartManageAI",
        html: getEmailVerificationHtml(verifyLink, firstName),
        text: getEmailVerificationText(verifyLink, firstName),
      }).catch(err => logError("Failed to send verification email:", {}, err instanceof Error ? err : new Error(String(err))));

      const token = generateToken(newUser.id, newUser.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = newUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Registration successful! Please check your email to verify your account.",
        needsOnboarding: true,
      });
    } catch (error) {
      next(error);
    }
  });

  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  router.post("/api/auth/login", authLimiter, async (req: AuthRequest, res, next) => {
    try {
      const sanitizedBody = {
        email: sanitizeEmail(req.body.email),
        password: req.body.password,
      };

      const validationResult = loginSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { email, password } = validationResult.data;

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (!user || !user.isActive) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        res.status(423).json({ error: "Account temporarily locked due to too many failed attempts. Please try again later." });
        return;
      }

      if (!user.passwordHash) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      if (user.organizationId) {
        const [ssoConfig] = await db
          .select()
          .from(ssoConfigurations)
          .where(eq(ssoConfigurations.organizationId, user.organizationId))
          .limit(1);

        if (ssoConfig && ssoConfig.enabled && ssoConfig.enforceSSO) {
          // Include the org slug so clients (esp. the native mobile app)
          // can immediately pivot to /api/sso/:slug/login without an extra
          // round-trip to look it up.
          const [org] = await db
            .select({ slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.id, user.organizationId))
            .limit(1);
          res.status(403).json({
            error: "SSO is required for your organization. Please sign in via SSO.",
            ssoEnforced: true,
            ssoSlug: org?.slug ?? null,
          });
          return;
        }
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      
      if (!isValid) {
        const newAttempts = (user.failedLoginAttempts ?? 0) + 1;
        const updateData: any = { failedLoginAttempts: newAttempts, updatedAt: new Date() };
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        }
        await db.update(users).set(updateData).where(eq(users.id, user.id));
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      if (user.failedLoginAttempts > 0 || user.lockedUntil) {
        await db.update(users).set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, user.id));
      }

      if (user.role !== "SUPER_ADMIN" && user.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
        if (org && !org.isActive) {
          res.status(403).json({ error: "Your organization has been suspended. Please contact support.", suspended: true });
          return;
        }
      }

      const token = generateToken(user.id, user.tokenVersion);
      setAuthCookie(res, token);

      const loginIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null;
      const loginUa = req.headers["user-agent"] || null;

      try {
        await db.insert(userSessions).values({
          userId: user.id,
          userAgent: loginUa,
          ipAddress: loginIp,
        });
        await db.insert(activityLog).values({
          userId: user.id,
          organizationId: user.organizationId || undefined,
          action: "LOGIN",
          details: "User logged in",
          ipAddress: loginIp,
          userAgent: loginUa,
        });
      } catch (err) {
        logWarn("Failed to log login session/activity", { userId: user.id, error: err instanceof Error ? err.message : String(err) });
      }

      const { passwordHash, tokenVersion, ...userWithoutPassword } = user;
      // Mobile clients (which cannot reliably read Set-Cookie headers from
      // fetch() in React Native) opt in to a JSON-token response by sending
      // the X-Mobile-Client header. Web clients keep cookie-only behavior.
      const wantsToken = String(req.headers["x-mobile-client"] ?? "").trim() !== "";
      res.json(wantsToken ? { user: userWithoutPassword, token } : { user: userWithoutPassword });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/logout", requireAuth, (req: AuthRequest, res) => {
    const userId = req.user?.id;
    const logoutIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null;
    const logoutUa = req.headers["user-agent"] || null;

    if (userId) {
      db.insert(activityLog).values({
        userId,
        organizationId: req.user?.organizationId || undefined,
        action: "LOGOUT",
        details: "User logged out",
        ipAddress: logoutIp,
        userAgent: logoutUa,
      }).catch((err) => logWarn("Failed to log logout activity", { userId, error: err instanceof Error ? err.message : String(err) }));

      db.update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          eq(userSessions.ipAddress, logoutIp || ""),
          eq(userSessions.userAgent, logoutUa || ""),
        ))
        .catch((err) => logWarn("Failed to revoke session on logout", { userId, error: err instanceof Error ? err.message : String(err) }));
    }

    clearAuthCookie(res);
    res.json({ success: true });
  });

  router.get("/api/auth/verify-email", async (req: AuthRequest, res, next) => {
    try {
      const { token, userId } = req.query;
      if (!token || !userId || typeof token !== "string" || typeof userId !== "string") {
        res.status(400).json({ error: "Invalid verification link" });
        return;
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const [record] = await db.select().from(emailVerificationTokens)
        .where(and(
          eq(emailVerificationTokens.userId, userId),
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, new Date()),
        ))
        .limit(1);

      if (!record) {
        res.status(400).json({ error: "Invalid or expired verification link" });
        return;
      }

      await db.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, record.id));
      await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, userId));

      res.redirect("/?emailVerified=true");
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/resend-verification", requireAuth, authLimiter, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      if (user.emailVerified) { res.json({ message: "Email already verified" }); return; }

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verificationHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
      await db.insert(emailVerificationTokens).values({
        userId,
        tokenHash: verificationHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const verifyLink = `${appUrl}/api/auth/verify-email?token=${verificationToken}&userId=${userId}`;
      await sendEmail({
        to: user.email,
        subject: "Verify your email - SmartManageAI",
        html: getEmailVerificationHtml(verifyLink, user.firstName),
        text: getEmailVerificationText(verifyLink, user.firstName),
      });

      res.json({ message: "Verification email sent" });
    } catch (error) {
      next(error);
    }
  });

  // DEV ONLY: Quick test login for development (gated by ENABLE_DEV_SEED / NODE_ENV)
  router.post("/api/dev/test-login", requireDevSeed, async (req: AuthRequest, res, next) => {

    try {
      const { role } = req.body;
      const validRoles = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "VENDOR"];
      
      if (!role || !validRoles.includes(role)) {
        res.status(400).json({ error: "Invalid role", validRoles });
        return;
      }

      // Find or create dev sandbox organization. SUPER_ADMIN can opt in to
      // being linked to the sandbox via `linkOrg: true` so they can exercise
      // org-scoped UIs (e.g. /settings/* — Task #762 quiet-hours digest test
      // for the Notification Preferences page) that would otherwise redirect
      // an org-less SUPER_ADMIN to /onboarding.
      const linkOrg = req.body?.linkOrg === true;
      let devOrg = null;
      if (role !== "SUPER_ADMIN" || linkOrg) {
        [devOrg] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.name, "Dev Sandbox Organization"))
          .limit(1);

        if (!devOrg) {
          [devOrg] = await db.insert(organizations).values({
            name: "Dev Sandbox Organization",
            slug: "dev-sandbox-org",
            email: "dev@sandbox.test",
            tradeType: "GENERAL_CONTRACTOR",
            isActive: true,
            onboardingStatus: "COMPLETED",
          }).returning();
          logInfo("[DEV] Created sandbox organization: " + devOrg.id);
        }

        // Always ensure all feature flags are enabled for the dev sandbox org
        const allFlagsOn = Object.fromEntries(FEATURE_FLAG_KEYS.map(k => [k, true]));
        await setAllFeatureFlags(devOrg.id, allFlagsOn);
      }

      // Create test user email based on role
      const testEmail = `test-${role.toLowerCase()}@dev.test`;
      
      // Find or create test user for this role
      let [testUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, testEmail))
        .limit(1);

      if (!testUser) {
        const passwordHash = await hashPassword("test123");
        [testUser] = await db.insert(users).values({
          firstName: "Test",
          lastName: role.replace(/_/g, " "),
          email: testEmail,
          role: role as any,
          isActive: true,
          passwordHash,
          organizationId: role === "SUPER_ADMIN" && !linkOrg ? null : devOrg?.id,
        }).returning();
        logInfo(`[DEV] Created test user: ${testEmail} (${role})`);
      } else if (role === "SUPER_ADMIN" && linkOrg && !testUser.organizationId && devOrg) {
        // Existing dev SUPER_ADMIN was created without an org; backfill so
        // /settings (and other org-scoped UIs) don't redirect to /onboarding.
        await db.update(users).set({ organizationId: devOrg.id }).where(eq(users.id, testUser.id));
        testUser.organizationId = devOrg.id;
      }

      const token = generateToken(testUser.id, testUser.tokenVersion);
      setAuthCookie(res, token);

      const devIp = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null;
      const devUa = req.headers["user-agent"] || null;
      try {
        await db.insert(userSessions).values({ userId: testUser.id, userAgent: devUa, ipAddress: devIp });
        await db.insert(activityLog).values({
          userId: testUser.id,
          organizationId: testUser.organizationId || undefined,
          action: "LOGIN",
          details: "Dev quick login",
          ipAddress: devIp,
          userAgent: devUa,
        });
      } catch (err) {
        logWarn("Failed to log dev login session/activity", { userId: testUser.id, error: err instanceof Error ? err.message : String(err) });
      }

      const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = testUser;
      res.json({ 
        user: userWithoutPassword,
        message: `Logged in as ${role} test account`,
        isDevAccount: true
      });
    } catch (error) {
      next(error);
    }
  });

  // DEV ONLY: Create fresh admin for full onboarding experience (gated by ENABLE_DEV_SEED / NODE_ENV)
  router.post("/api/dev/fresh-admin-login", requireDevSeed, async (req: AuthRequest, res, next) => {

    try {
      const timestamp = Date.now();
      const uniqueSlug = `fresh-org-${timestamp}`;
      const uniqueEmail = `fresh-admin-${timestamp}@dev.test`;

      // Create a brand new organization with onboarding NOT complete
      const [newOrg] = await db.insert(organizations).values({
        name: `Fresh Test Org ${timestamp}`,
        slug: uniqueSlug,
        email: `org-${timestamp}@dev.test`,
        tradeType: "GENERAL_CONTRACTOR",
        isActive: true,
        onboardingStatus: "NOT_STARTED", // Force AI wizard onboarding
      }).returning();
      logInfo("[DEV] Created fresh organization for onboarding: " + newOrg.id);

      // Create fresh admin user with walkthrough NOT complete
      const passwordHash = await hashPassword("test123");
      const [freshAdmin] = await db.insert(users).values({
        firstName: "Fresh",
        lastName: "Admin",
        email: uniqueEmail,
        role: "ADMIN",
        isActive: true,
        passwordHash,
        organizationId: newOrg.id,
        walkthroughCompleted: false,
        walkthroughStep: 0,
        walkthroughStartedAt: null,
      }).returning();
      logInfo(`[DEV] Created fresh admin: ${uniqueEmail}`);

      // Generate token and set cookie
      const token = generateToken(freshAdmin.id, freshAdmin.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = freshAdmin;
      res.json({ 
        user: userWithoutPassword,
        organization: newOrg,
        message: "Fresh admin created - ready for full onboarding experience",
        isDevAccount: true,
        redirectTo: "/onboarding"
      });
    } catch (error) {
      next(error);
    }
  });

  // Get current user (with organization name and onboarding status)
  router.get("/api/auth/me", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      let organizationName = null;
      let organizationOnboardingStatus = null;
      if (req.user?.organizationId) {
        const [org] = await db
          .select({ name: organizations.name, onboardingStatus: organizations.onboardingStatus })
          .from(organizations)
          .where(eq(organizations.id, req.user.organizationId))
          .limit(1);
        organizationName = org?.name || null;
        organizationOnboardingStatus = org?.onboardingStatus || null;
      }
      res.json({ user: req.user, organizationName, organizationOnboardingStatus });
    } catch (error) {
      logError("Error fetching user org:", {}, error instanceof Error ? error : new Error(String(error)));
      res.json({ user: req.user, organizationName: null, organizationOnboardingStatus: null });
    }
  });

  router.patch("/api/auth/profile", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const profileSchema = z.object({
        firstName: z.string().min(1).max(100).optional(),
        lastName: z.string().min(1).max(100).optional(),
        phone: z.string().max(30).optional().nullable().refine(
          (v) => !v || /^\+[1-9]\d{1,14}$/.test(v),
          { message: "Phone number must be in E.164 format (e.g. +15551234567)" }
        ),
        birthdate: z.string().max(20).optional().nullable(),
        timezone: z.string().max(100).optional().nullable(),
        profileDescription: z.string().max(2000).optional().nullable(),
        tradeSpecialization: z.string().max(200).optional().nullable(),
        employmentType: z.string().max(100).optional().nullable(),
        emergencyContactName: z.string().max(200).optional().nullable(),
        emergencyContactPhone: z.string().max(30).optional().nullable(),
        emergencyContactAddress: z.string().max(500).optional().nullable(),
        emergencyContactEmail: z.string().max(200).optional().nullable(),
        receivesJobMetricAlertEmails: z.boolean().optional(),
        // Task #748: optional quiet-hours window for job-metric alert
        // emails (Super-Admin-only feature, but harmless on other roles).
        jobMetricAlertQuietHoursEnabled: z.boolean().optional(),
        jobMetricAlertQuietHoursStart: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: "Use HH:MM (24h) format" })
          .optional()
          .nullable(),
        jobMetricAlertQuietHoursEnd: z
          .string()
          .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: "Use HH:MM (24h) format" })
          .optional()
          .nullable(),
        jobMetricAlertQuietHoursTimezone: z.string().max(100).optional().nullable(),
        jobMetricAlertQuietHoursWeekdays: z
          .array(z.number().int().min(0).max(6))
          .max(7)
          .optional()
          .nullable(),
        // Task #754: opt-in digest of alerts that fired during quiet hours.
        jobMetricAlertQuietHoursDigestEnabled: z.boolean().optional(),
        // Task #761: per-recipient detail level for the digest body.
        jobMetricAlertQuietHoursDigestFormat: z
          .enum(["summary", "full", "grouped"])
          .optional(),
        // Task #764: opt-in CSV attachment for the quiet-hours digest.
        jobMetricAlertQuietHoursDigestCsvEnabled: z.boolean().optional(),
        // Task #776: per-recipient cap on how many recent alerts the
        // quiet-hours digest body and the in-app preview surface.
        jobMetricAlertQuietHoursDigestMaxEvents: z
          .number()
          .int()
          .refine((v) => [25, 50, 100, 250].includes(v), {
            message: "Must be one of 25, 50, 100, or 250",
          })
          .optional(),
        // Task #797: per-recipient locale & format preferences for the
        // quiet-hours digest timestamps. Locale is a BCP-47 tag (or
        // null to fall back to "en-US"); time format toggles 12h/24h;
        // showWeekday prepends a short weekday like "Wed Jan 14".
        jobMetricAlertQuietHoursDigestLocale: z
          .string()
          .max(35)
          // BCP-47 language tag — e.g. "en", "en-US", "zh-Hant-TW".
          // We keep the regex permissive (Intl will reject invalid
          // tags) while still rejecting obviously bad input.
          .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
            message: "Must be a BCP-47 language tag (e.g. en-GB)",
          })
          .optional()
          .nullable(),
        jobMetricAlertQuietHoursDigestTimeFormat: z
          .enum(["12h", "24h"])
          .optional(),
        jobMetricAlertQuietHoursDigestShowWeekday: z.boolean().optional(),
        // Task #1021: per-admin delivery preferences for the CRM transcript
        // backfill completion summary.
        crmBackfillSummaryChannel: z
          .enum(["email", "slack", "teams", "none"])
          .optional(),
        crmBackfillSummaryOnFailureOnly: z.boolean().optional(),
        // Task #1066: per-admin mute for the Task #1051 alert delivery
        // failure fallback emails. `Enabled = false` mutes all fallback
        // emails for this admin; `MutedChannels` mutes specific failing
        // channels (e.g. ["slack"]) while still alerting on others.
        crmAlertFailureFallbackEnabled: z.boolean().optional(),
        crmAlertFailureFallbackMutedChannels: z
          .array(z.enum(["slack", "email"]))
          .max(2)
          .optional(),
        // Task #1076: per-admin opt-in for the two streams of CRM
        // transcript-backfill alert delivery failure emails.
        alertFailureEmailMode: z
          .enum(["both", "realtime", "digest", "none"])
          .optional(),
        // Task #1414 — per-admin opt-out for the
        // INTEGRATION_SYNC_RETRIES_EXHAUSTED transactional email. Default
        // is `false` (admin receives the email); flipping to `true`
        // silences it while leaving the in-app bell intact.
        integrationSyncExhaustedEmailOptOut: z.boolean().optional(),
        // Task #1695 — per-user preferences for the Plans surface.
        // Replace per-user-id localStorage keys (`plan-toolbar-labeled-<uid>`
        // and `plans-tour-completed-<uid>`) with server-side flags so the
        // settings sync across devices.
        plansToolbarLabeled: z.boolean().optional(),
        plansTourCompleted: z.boolean().optional(),
      });
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

      const { firstName, lastName, phone, birthdate, timezone, profileDescription,
        tradeSpecialization, employmentType, emergencyContactName, emergencyContactPhone,
        emergencyContactAddress, emergencyContactEmail, receivesJobMetricAlertEmails,
        jobMetricAlertQuietHoursEnabled, jobMetricAlertQuietHoursStart,
        jobMetricAlertQuietHoursEnd, jobMetricAlertQuietHoursTimezone,
        jobMetricAlertQuietHoursWeekdays, jobMetricAlertQuietHoursDigestEnabled,
        jobMetricAlertQuietHoursDigestFormat,
        jobMetricAlertQuietHoursDigestCsvEnabled,
        jobMetricAlertQuietHoursDigestMaxEvents,
        jobMetricAlertQuietHoursDigestLocale,
        jobMetricAlertQuietHoursDigestTimeFormat,
        jobMetricAlertQuietHoursDigestShowWeekday,
        crmBackfillSummaryChannel,
        crmBackfillSummaryOnFailureOnly,
        crmAlertFailureFallbackEnabled,
        crmAlertFailureFallbackMutedChannels,
        alertFailureEmailMode,
        integrationSyncExhaustedEmailOptOut,
        plansToolbarLabeled,
        plansTourCompleted } = parsed.data;
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (phone !== undefined) updateData.phone = phone || null;
      if (birthdate !== undefined) updateData.birthdate = birthdate || null;
      if (timezone !== undefined) updateData.timezone = timezone || null;
      if (profileDescription !== undefined) updateData.profileDescription = profileDescription || null;
      if (tradeSpecialization !== undefined) updateData.tradeSpecialization = tradeSpecialization || null;
      if (employmentType !== undefined) updateData.employmentType = employmentType || null;
      if (emergencyContactName !== undefined) updateData.emergencyContactName = emergencyContactName || null;
      if (emergencyContactPhone !== undefined) updateData.emergencyContactPhone = emergencyContactPhone || null;
      if (emergencyContactAddress !== undefined) updateData.emergencyContactAddress = emergencyContactAddress || null;
      if (emergencyContactEmail !== undefined) updateData.emergencyContactEmail = emergencyContactEmail || null;
      if (receivesJobMetricAlertEmails !== undefined) updateData.receivesJobMetricAlertEmails = receivesJobMetricAlertEmails;
      if (jobMetricAlertQuietHoursEnabled !== undefined) updateData.jobMetricAlertQuietHoursEnabled = jobMetricAlertQuietHoursEnabled;
      if (jobMetricAlertQuietHoursStart !== undefined) updateData.jobMetricAlertQuietHoursStart = jobMetricAlertQuietHoursStart || null;
      if (jobMetricAlertQuietHoursEnd !== undefined) updateData.jobMetricAlertQuietHoursEnd = jobMetricAlertQuietHoursEnd || null;
      if (jobMetricAlertQuietHoursTimezone !== undefined) updateData.jobMetricAlertQuietHoursTimezone = jobMetricAlertQuietHoursTimezone || null;
      if (jobMetricAlertQuietHoursWeekdays !== undefined) updateData.jobMetricAlertQuietHoursWeekdays = jobMetricAlertQuietHoursWeekdays;
      if (jobMetricAlertQuietHoursDigestEnabled !== undefined) updateData.jobMetricAlertQuietHoursDigestEnabled = jobMetricAlertQuietHoursDigestEnabled;
      if (jobMetricAlertQuietHoursDigestFormat !== undefined) updateData.jobMetricAlertQuietHoursDigestFormat = jobMetricAlertQuietHoursDigestFormat;
      if (jobMetricAlertQuietHoursDigestCsvEnabled !== undefined) updateData.jobMetricAlertQuietHoursDigestCsvEnabled = jobMetricAlertQuietHoursDigestCsvEnabled;
      if (jobMetricAlertQuietHoursDigestMaxEvents !== undefined) updateData.jobMetricAlertQuietHoursDigestMaxEvents = jobMetricAlertQuietHoursDigestMaxEvents;
      if (jobMetricAlertQuietHoursDigestLocale !== undefined) updateData.jobMetricAlertQuietHoursDigestLocale = jobMetricAlertQuietHoursDigestLocale || null;
      if (jobMetricAlertQuietHoursDigestTimeFormat !== undefined) updateData.jobMetricAlertQuietHoursDigestTimeFormat = jobMetricAlertQuietHoursDigestTimeFormat;
      if (jobMetricAlertQuietHoursDigestShowWeekday !== undefined) updateData.jobMetricAlertQuietHoursDigestShowWeekday = jobMetricAlertQuietHoursDigestShowWeekday;
      if (crmBackfillSummaryChannel !== undefined) updateData.crmBackfillSummaryChannel = crmBackfillSummaryChannel;
      if (crmBackfillSummaryOnFailureOnly !== undefined) updateData.crmBackfillSummaryOnFailureOnly = crmBackfillSummaryOnFailureOnly;
      if (crmAlertFailureFallbackEnabled !== undefined) updateData.crmAlertFailureFallbackEnabled = crmAlertFailureFallbackEnabled;
      if (crmAlertFailureFallbackMutedChannels !== undefined) {
        // De-dupe to keep the stored array small; order doesn't matter
        // since the lookup uses Array.includes.
        updateData.crmAlertFailureFallbackMutedChannels = Array.from(
          new Set(crmAlertFailureFallbackMutedChannels),
        );
      }
      if (alertFailureEmailMode !== undefined) updateData.alertFailureEmailMode = alertFailureEmailMode;
      if (integrationSyncExhaustedEmailOptOut !== undefined) {
        updateData.integrationSyncExhaustedEmailOptOut = integrationSyncExhaustedEmailOptOut;
      }
      // Task #1695 — Plans-surface preferences (labeled toolbar + plans-tour
      // dismissal). Persisted under the user profile so the settings sync
      // across devices instead of being trapped in per-user-id localStorage.
      if (plansToolbarLabeled !== undefined) updateData.plansToolbarLabeled = plansToolbarLabeled;
      if (plansTourCompleted !== undefined) updateData.plansTourCompleted = plansTourCompleted;

      const [updated] = await db.update(users).set(updateData).where(eq(users.id, userId)).returning();
      if (!updated) { res.status(404).json({ error: "User not found" }); return; }

      // Bust the requireAuth user cache so the very next /api/auth/me reflects
      // the change (Task #762: the e2e quiet-hours digest test patches the
      // user then immediately reloads the page; without this an 8s-stale
      // cached user would be served).
      invalidateAuthCache(userId);

      await logUpdate(userId, "users", userId, req.user, updateData, req as any);

      // Task #1152 — fire-and-forget heads-up if this preference change
      // just dropped a per-channel realtime alert-failure recipient count
      // to zero for the user's org. Only triggers for fields that actually
      // affect the per-channel realtime fan-out; the helper itself is
      // internally debounced so toggling preferences won't spam the org.
      const touchedFallbackPrefs =
        crmAlertFailureFallbackEnabled !== undefined ||
        crmAlertFailureFallbackMutedChannels !== undefined ||
        alertFailureEmailMode !== undefined ||
        crmBackfillSummaryChannel !== undefined;
      if (touchedFallbackPrefs && updated.role === "ADMIN" && updated.organizationId) {
        void notifyOrgAdminsOfFallbackCoverageGap(updated.organizationId);
      }

      const { passwordHash, tokenVersion, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      next(error);
    }
  });

  // Task #765 — Render or send a sample quiet-hours digest so a recipient
  // can preview how their selected detail level will look without waiting
  // for the next quiet window to close. Works regardless of whether the
  // user is currently inside their quiet window.
  router.post("/api/auth/profile/quiet-hours/preview-digest", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const previewSchema = z.object({
        format: z.enum(["summary", "full", "grouped"]).optional(),
        mode: z.enum(["render", "send"]).default("render"),
      });
      const parsed = previewSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
        return;
      }

      const userFormat = (req.user?.jobMetricAlertQuietHoursDigestFormat ?? "full") as QuietHoursDigestFormat;
      const format: QuietHoursDigestFormat = parsed.data.format ?? userFormat;
      const mode = parsed.data.mode;

      // Task #776 — honor the recipient's per-user max-events cap so the
      // preview matches what the next live digest will surface.
      const userMaxEventsRaw = req.user?.jobMetricAlertQuietHoursDigestMaxEvents;
      const userMaxEvents =
        typeof userMaxEventsRaw === "number" && Number.isFinite(userMaxEventsRaw)
          ? userMaxEventsRaw
          : 100;
      // Task #795 — Pass the user's quiet-hours timezone so the preview
      // mirrors the live digest's localized timestamps.
      const userTimezone =
        (req.user as { jobMetricAlertQuietHoursTimezone?: string | null } | undefined)
          ?.jobMetricAlertQuietHoursTimezone ?? null;
      // Task #797 — Also forward the user's locale + 12h/24h + weekday
      // preferences so the in-app preview matches what the next live
      // digest will render.
      const userPrefs = req.user as
        | {
            jobMetricAlertQuietHoursDigestLocale?: string | null;
            jobMetricAlertQuietHoursDigestTimeFormat?: "12h" | "24h" | null;
            jobMetricAlertQuietHoursDigestShowWeekday?: boolean | null;
          }
        | undefined;
      const preview = await buildQuietHoursDigestPreview(format, {
        maxEvents: userMaxEvents,
        timezone: userTimezone,
        timestampOptions: {
          locale: userPrefs?.jobMetricAlertQuietHoursDigestLocale ?? null,
          timeFormat:
            (userPrefs?.jobMetricAlertQuietHoursDigestTimeFormat ?? "12h") === "24h"
              ? "24h"
              : "12h",
          showWeekday: Boolean(userPrefs?.jobMetricAlertQuietHoursDigestShowWeekday),
        },
      });

      if (mode === "send") {
        const to = req.user?.email;
        if (!to) {
          res.status(400).json({ error: "No email address on file for the current user" });
          return;
        }
        const ok = await sendEmailViaService({
          to,
          subject: preview.subject,
          html: preview.html,
          text: preview.text,
        });
        if (!ok) {
          res.status(502).json({ error: "Failed to send sample digest email" });
          return;
        }
        res.json({
          ok: true,
          mode,
          format,
          isSynthetic: preview.isSynthetic,
          eventCount: preview.eventCount,
          maxEvents: preview.maxEvents,
          sentTo: to,
        });
        return;
      }

      res.json({
        ok: true,
        mode,
        format,
        isSynthetic: preview.isSynthetic,
        eventCount: preview.eventCount,
        maxEvents: preview.maxEvents,
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
      });
    } catch (error) {
      next(error);
    }
  });

  // DEV ONLY (Task #781): expose the in-memory test email outbox so
  // end-to-end browser tests can assert what the noop transport captured
  // during a "Send me a sample" flow. Gated by both `requireDevSeed`
  // (NODE_ENV=development) AND `isEmailTransportNoop()`
  // (EMAIL_TRANSPORT=noop) so production deploys can never observe
  // outbound mail through this surface.
  router.get("/api/dev/email-outbox", requireDevSeed, (_req, res) => {
    if (!isEmailTransportNoop()) {
      res.status(409).json({ error: "EMAIL_TRANSPORT is not 'noop'" });
      return;
    }
    res.json({ outbox: getTestEmailOutbox() });
  });

  router.delete("/api/dev/email-outbox", requireDevSeed, (_req, res) => {
    if (!isEmailTransportNoop()) {
      res.status(409).json({ error: "EMAIL_TRANSPORT is not 'noop'" });
      return;
    }
    clearTestEmailOutbox();
    res.status(204).end();
  });

  router.post("/api/auth/change-password", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const changePasswordSchema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: passwordSchema,
      });
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" }); return; }

      const { currentPassword, newPassword } = parsed.data;

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) { res.status(404).json({ error: "User not found" }); return; }

      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) { res.status(400).json({ error: "Current password is incorrect" }); return; }

      const newHash = await hashPassword(newPassword);
      await db.update(users).set({ passwordHash: newHash, tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() }).where(eq(users.id, userId));

      const newTokenVersion = (user.tokenVersion ?? 0) + 1;
      const token = generateToken(userId, newTokenVersion);
      setAuthCookie(res, token);

      await logAudit({ userId, action: "password_change", entityType: "users", entityId: userId, oldValue: null, newValue: null }, req as any);

      try {
        await db.insert(activityLog).values({
          userId,
          organizationId: req.user?.organizationId || undefined,
          action: "PASSWORD_CHANGE",
          details: "Password changed successfully",
          ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || null,
          userAgent: req.headers["user-agent"] || null,
        });
      } catch (err) {
        logWarn("Failed to log password change activity", { userId, error: err instanceof Error ? err.message : String(err) });
      }

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/upload-avatar", requireAuth, sensitiveLimiter, upload.single("avatar"), async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }

      const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.mimetype)) {
        res.status(400).json({ error: "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed." }); return;
      }
      if (file.size > 5 * 1024 * 1024) {
        res.status(400).json({ error: "File too large. Maximum size is 5MB." }); return;
      }

      const { ObjectStorageService, objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const objectId = `avatars/${userId}/${Date.now()}-${file.originalname}`;
      const fullPath = `${privateDir}/${objectId}`;

      const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      await objectFile.save(file.buffer, { contentType: file.mimetype, metadata: { contentType: file.mimetype } });

      const avatarUrl = `/api/auth/profile-files/${objectId}`;
      const [updated] = await db.update(users).set({ avatarUrl, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
      if (!updated) { res.status(404).json({ error: "User not found" }); return; }

      const { passwordHash, tokenVersion, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-photos", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const photos = await db.select().from(userPhotos).where(eq(userPhotos.userId, userId)).orderBy(desc(userPhotos.uploadedAt));
      res.json(photos);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/upload-photos", requireAuth, sensitiveLimiter, upload.array("photos", 10), async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) { res.status(400).json({ error: "No files uploaded" }); return; }

      const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      for (const file of files) {
        if (!allowedTypes.includes(file.mimetype)) {
          res.status(400).json({ error: `Invalid file type: ${file.originalname}. Only JPEG, PNG, GIF, and WebP are allowed.` }); return;
        }
        if (file.size > 10 * 1024 * 1024) {
          res.status(400).json({ error: `File too large: ${file.originalname}. Maximum size is 10MB.` }); return;
        }
      }

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const uploadedPhotos = [];

      for (const file of files) {
        const objectId = `user-photos/${userId}/${Date.now()}-${file.originalname}`;
        const fullPath = `${privateDir}/${objectId}`;
        const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
        const bucketName = parts[0];
        const objectName = parts.slice(1).join("/");

        const bucket = objectStorageClient.bucket(bucketName);
        const objectFile = bucket.file(objectName);
        await objectFile.save(file.buffer, { contentType: file.mimetype, metadata: { contentType: file.mimetype } });

        const fileUrl = `/api/auth/profile-files/${objectId}`;
        const [photo] = await db.insert(userPhotos).values({
          userId,
          fileName: file.originalname,
          fileUrl,
          objectKey: objectId,
        }).returning();
        uploadedPhotos.push(photo);
      }

      res.status(201).json(uploadedPhotos);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/auth/my-photos/:photoId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { photoId } = req.params;
      const [photo] = await db.select().from(userPhotos)
        .where(and(eq(userPhotos.id, photoId), eq(userPhotos.userId, userId))).limit(1);
      if (!photo) { res.status(404).json({ error: "Photo not found" }); return; }

      if (photo.objectKey) {
        try {
          const { objectStorageClient } = await import("./objectStorage");
          const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
          const fullPath = `${privateDir}/${photo.objectKey}`;
          const pathStr = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
          const parts = pathStr.split("/");
          const bucketName = parts[0];
          const objectName = parts.slice(1).join("/");
          const bucket = objectStorageClient.bucket(bucketName);
          const objectFile = bucket.file(objectName);
          await objectFile.delete().catch(() => {});
        } catch (e) {
          logError("Error deleting user photo from storage:", {}, e instanceof Error ? e : new Error(String(e)));
        }
      }

      await db.delete(userPhotos).where(eq(userPhotos.id, photoId));
      res.json({ message: "Photo deleted" });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/profile-files/*", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const filePath = req.params[0];
      if (!filePath) { res.status(400).json({ error: "File path required" }); return; }

      const allowedPrefixes = ["avatars/", "user-photos/"];
      if (!allowedPrefixes.some(p => filePath.startsWith(p))) {
        res.status(403).json({ error: "Access denied" }); return;
      }

      const pathParts = filePath.split("/");
      if (pathParts.length < 3) { res.status(400).json({ error: "Invalid file path" }); return; }
      const fileOwnerId = pathParts[1];

      if (filePath.startsWith("user-photos/") && fileOwnerId !== req.user!.id) {
        res.status(403).json({ error: "Access denied" }); return;
      }

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const fullPath = `${privateDir}/${filePath}`;
      const pathStr = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
      const parts = pathStr.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      const [exists] = await objectFile.exists();
      if (!exists) { res.status(404).json({ error: "File not found" }); return; }

      const [metadata] = await objectFile.getMetadata();
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.size),
        "Cache-Control": "private, max-age=3600",
      });
      objectFile.createReadStream().pipe(res);
    } catch (error) {
      logError("Error serving profile file:", {}, error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) next(error);
    }
  });

  router.get("/api/auth/my-skills", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const results = await db
        .select({
          id: userSkills.id,
          skillId: userSkills.skillId,
          skillName: skills.name,
          category: skills.category,
          starRating: userSkills.starRating,
          verificationStatus: userSkills.verificationStatus,
          verifiedByUserId: userSkills.verifiedByUserId,
          verifiedAt: userSkills.verifiedAt,
        })
        .from(userSkills)
        .innerJoin(skills, eq(userSkills.skillId, skills.id))
        .where(eq(userSkills.userId, userId))
        .orderBy(skills.name);

      const enrichedResults = await Promise.all(results.map(async (r) => {
        let verifiedByName: string | null = null;
        let verifiedByRole: string | null = null;
        if (r.verifiedByUserId) {
          const [verifier] = await db.select({ firstName: users.firstName, lastName: users.lastName, role: users.role })
            .from(users).where(eq(users.id, r.verifiedByUserId)).limit(1);
          if (verifier) {
            verifiedByName = `${verifier.firstName || ""} ${verifier.lastName || ""}`.trim();
            verifiedByRole = verifier.role;
          }
        }
        return { ...r, verifiedByName, verifiedByRole };
      }));

      res.json(enrichedResults);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/my-skills", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const skillSchema = z.object({ skillName: z.string().min(1).max(200).transform(v => v.trim()) });
      const parsed = skillSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Skill name is required" }); return; }
      const { skillName } = parsed.data;
      if (!skillName) { res.status(400).json({ error: "Skill name is required" }); return; }

      let [existingSkill] = await db.select().from(skills).where(eq(skills.name, skillName.trim())).limit(1);
      if (!existingSkill) {
        [existingSkill] = await db.insert(skills).values({ name: skillName.trim() }).returning();
      }

      const [existingLink] = await db.select().from(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, existingSkill.id))).limit(1);
      if (existingLink) { res.status(409).json({ error: "Skill already added" }); return; }

      const [newUserSkill] = await db.insert(userSkills).values({ userId, skillId: existingSkill.id }).returning();
      res.status(201).json({ id: newUserSkill.id, skillId: existingSkill.id, skillName: existingSkill.name, category: existingSkill.category });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/auth/my-skills/:userSkillId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { userSkillId } = req.params;
      const [existing] = await db.select().from(userSkills)
        .where(and(eq(userSkills.id, userSkillId), eq(userSkills.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }

      await db.delete(userSkills).where(eq(userSkills.id, userSkillId));
      res.json({ message: "Skill removed" });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/auth/my-skills/:userSkillId/rating", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { userSkillId } = req.params;
      const ratingSchema = z.object({ starRating: z.number().int().min(0).max(5) });
      const parsed = ratingSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid rating", details: parsed.error.errors }); return; }

      const [existing] = await db.select().from(userSkills)
        .where(and(eq(userSkills.id, userSkillId), eq(userSkills.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }

      const [updated] = await db.update(userSkills)
        .set({ starRating: parsed.data.starRating })
        .where(eq(userSkills.id, userSkillId))
        .returning();
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/my-skills/:userSkillId/request-verification", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      if (!orgId) { res.status(400).json({ error: "No organization associated" }); return; }

      const { userSkillId } = req.params;
      const [existing] = await db.select().from(userSkills)
        .where(and(eq(userSkills.id, userSkillId), eq(userSkills.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }

      if (existing.verificationStatus === "verified") {
        res.status(400).json({ error: "Skill is already verified" }); return;
      }

      const [existingRequest] = await db.select().from(skillVerificationRequests)
        .where(and(
          eq(skillVerificationRequests.userSkillId, userSkillId),
          eq(skillVerificationRequests.status, "pending")
        )).limit(1);
      if (existingRequest) {
        res.status(409).json({ error: "A verification request is already pending" }); return;
      }

      const managers = await db.select({ id: users.id }).from(users)
        .where(and(
          eq(users.organizationId, orgId),
          eq(users.isActive, true),
          inArray(users.role, ["SUPERINTENDENT", "MANAGER", "ADMIN"])
        ));

      if (managers.length === 0) {
        res.status(400).json({ error: "No managers available to verify skills" }); return;
      }

      const [skillInfo] = await db.select({ name: skills.name }).from(skills)
        .where(eq(skills.id, existing.skillId)).limit(1);
      const skillName = skillInfo?.name || "Unknown Skill";
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim();

      const createdRequests = [];
      for (const manager of managers) {
        const [request] = await db.insert(skillVerificationRequests).values({
          userSkillId,
          requestedByUserId: userId,
          requestedToUserId: manager.id,
          organizationId: orgId,
          status: "pending",
        }).returning();
        createdRequests.push(request);

        await insertNotification({
          userId: manager.id,
          organizationId: orgId,
          type: "GENERAL",
          title: "Skill Verification Request",
          message: `${userName} has requested verification for skill: ${skillName}`,
        });
      }

      await db.update(userSkills)
        .set({ verificationStatus: "pending" })
        .where(eq(userSkills.id, userSkillId));

      res.status(201).json({ message: "Verification request sent", requests: createdRequests });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/skill-verification-requests", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      if (!orgId) { res.status(400).json({ error: "No organization associated" }); return; }

      const requests = await db
        .select({
          id: skillVerificationRequests.id,
          userSkillId: skillVerificationRequests.userSkillId,
          requestedByUserId: skillVerificationRequests.requestedByUserId,
          requestedToUserId: skillVerificationRequests.requestedToUserId,
          organizationId: skillVerificationRequests.organizationId,
          status: skillVerificationRequests.status,
          createdAt: skillVerificationRequests.createdAt,
          resolvedAt: skillVerificationRequests.resolvedAt,
          skillName: skills.name,
          skillCategory: skills.category,
        })
        .from(skillVerificationRequests)
        .innerJoin(userSkills, eq(skillVerificationRequests.userSkillId, userSkills.id))
        .innerJoin(skills, eq(userSkills.skillId, skills.id))
        .where(and(
          eq(skillVerificationRequests.requestedToUserId, userId),
          eq(skillVerificationRequests.organizationId, orgId),
          eq(skillVerificationRequests.status, "pending")
        ))
        .orderBy(desc(skillVerificationRequests.createdAt));

      const enrichedRequests = await Promise.all(requests.map(async (r) => {
        const [requester] = await db.select({ firstName: users.firstName, lastName: users.lastName })
          .from(users).where(eq(users.id, r.requestedByUserId)).limit(1);
        return {
          ...r,
          requesterName: requester ? `${requester.firstName} ${requester.lastName}` : "Unknown",
        };
      }));

      res.json(enrichedRequests);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/auth/skill-verification-requests/:requestId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const allowedRoles = ["ADMIN", "MANAGER", "SUPERINTENDENT"];
      if (!userRole || !allowedRoles.includes(userRole)) {
        res.status(403).json({ error: "Only managers, superintendents, office managers, and admins can approve verifications" });
        return;
      }

      const { requestId } = req.params;
      const actionSchema = z.object({ action: z.enum(["approve", "reject"]) });
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid action", details: parsed.error.errors }); return; }

      const [request] = await db.select().from(skillVerificationRequests)
        .where(and(eq(skillVerificationRequests.id, requestId), eq(skillVerificationRequests.requestedToUserId, userId))).limit(1);
      if (!request) { res.status(404).json({ error: "Verification request not found" }); return; }
      if (request.status !== "pending") { res.status(400).json({ error: "Request already resolved" }); return; }

      const newStatus = parsed.data.action === "approve" ? "approved" : "rejected";
      await db.update(skillVerificationRequests)
        .set({ status: newStatus, resolvedAt: new Date() })
        .where(eq(skillVerificationRequests.id, requestId));

      if (parsed.data.action === "approve") {
        await db.update(userSkills)
          .set({ verificationStatus: "verified", verifiedByUserId: userId, verifiedAt: new Date() })
          .where(eq(userSkills.id, request.userSkillId));
      } else {
        await db.update(userSkills)
          .set({ verificationStatus: "unverified" })
          .where(eq(userSkills.id, request.userSkillId));
      }

      await db.update(skillVerificationRequests)
        .set({ status: newStatus, resolvedAt: new Date() })
        .where(and(
          eq(skillVerificationRequests.userSkillId, request.userSkillId),
          eq(skillVerificationRequests.status, "pending")
        ));

      const [skillInfo] = await db.select({ name: skills.name }).from(skills)
        .innerJoin(userSkills, eq(userSkills.skillId, skills.id))
        .where(eq(userSkills.id, request.userSkillId)).limit(1);

      const verifierName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim();
      await insertNotification({
        userId: request.requestedByUserId,
        organizationId: orgId,
        type: "GENERAL",
        title: `Skill Verification ${parsed.data.action === "approve" ? "Approved" : "Rejected"}`,
        message: `Your skill "${skillInfo?.name || "Unknown"}" has been ${parsed.data.action === "approve" ? "approved" : "rejected"} by ${verifierName}`,
      });

      res.json({ message: `Verification request ${newStatus}` });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-certifications", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const certs = await db.select().from(userCertifications)
        .where(eq(userCertifications.userId, userId))
        .orderBy(desc(userCertifications.createdAt));
      res.json(certs);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/my-certifications", requireAuth, sensitiveLimiter, upload.single("file"), async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      if (!orgId) { res.status(400).json({ error: "No organization associated" }); return; }

      const certSchema = z.object({
        certificationName: z.string().min(1).max(500),
        issuedDate: z.string().optional().nullable(),
        expiryDate: z.string().optional().nullable(),
      });
      const parsed = certSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

      let fileUrl: string | null = null;
      let fileObjectKey: string | null = null;
      let fileName: string | null = null;
      const file = req.file;

      if (file) {
        const certAllowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
        if (!certAllowedTypes.includes(file.mimetype)) {
          res.status(400).json({ error: "Invalid file type. Only images (JPEG, PNG, GIF, WebP) and PDFs are allowed." }); return;
        }
        const { objectStorageClient } = await import("./objectStorage");
        const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
        const objectId = `certifications/${userId}/${Date.now()}-${file.originalname}`;
        const fullPath = `${privateDir}/${objectId}`;
        const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
        const bucketName = parts[0];
        const objectName = parts.slice(1).join("/");
        const bucket = objectStorageClient.bucket(bucketName);
        const objectFile = bucket.file(objectName);
        await objectFile.save(file.buffer, { contentType: file.mimetype });
        fileUrl = `/api/auth/certification-files/${objectId}`;
        fileObjectKey = objectId;
        fileName = file.originalname;
      }

      const [cert] = await db.insert(userCertifications).values({
        userId,
        organizationId: orgId,
        certificationName: parsed.data.certificationName,
        issuedDate: parsed.data.issuedDate ? new Date(parsed.data.issuedDate) : null,
        expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
        fileUrl,
        fileObjectKey,
        fileName,
      }).returning();

      res.status(201).json(cert);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/auth/my-certifications/:certId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { certId } = req.params;
      const [existing] = await db.select().from(userCertifications)
        .where(and(eq(userCertifications.id, certId), eq(userCertifications.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Certification not found" }); return; }

      const updateSchema = z.object({
        certificationName: z.string().min(1).max(500).optional(),
        issuedDate: z.string().optional().nullable(),
        expiryDate: z.string().optional().nullable(),
        status: z.enum(["active", "expired", "revoked"]).optional(),
      });
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.certificationName !== undefined) updateData.certificationName = parsed.data.certificationName;
      if (parsed.data.issuedDate !== undefined) updateData.issuedDate = parsed.data.issuedDate ? new Date(parsed.data.issuedDate) : null;
      if (parsed.data.expiryDate !== undefined) updateData.expiryDate = parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null;
      if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

      const [updated] = await db.update(userCertifications)
        .set(updateData)
        .where(eq(userCertifications.id, certId))
        .returning();
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/auth/my-certifications/:certId", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { certId } = req.params;
      const [existing] = await db.select().from(userCertifications)
        .where(and(eq(userCertifications.id, certId), eq(userCertifications.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Certification not found" }); return; }

      if (existing.fileObjectKey) {
        try {
          const { objectStorageClient } = await import("./objectStorage");
          const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
          const fullPath = `${privateDir}/${existing.fileObjectKey}`;
          const pathStr = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
          const parts = pathStr.split("/");
          const bucketName = parts[0];
          const objectName = parts.slice(1).join("/");
          const bucket = objectStorageClient.bucket(bucketName);
          const objectFile = bucket.file(objectName);
          await objectFile.delete().catch(() => {});
        } catch (e) {
          logError("Error deleting certification file from storage:", {}, e instanceof Error ? e : new Error(String(e)));
        }
      }

      await db.delete(userCertifications).where(eq(userCertifications.id, certId));
      res.json({ message: "Certification deleted" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/my-certifications/:certId/upload", requireAuth, sensitiveLimiter, upload.single("file"), async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { certId } = req.params;
      const [existing] = await db.select().from(userCertifications)
        .where(and(eq(userCertifications.id, certId), eq(userCertifications.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Certification not found" }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ error: "No file provided" }); return; }

      const certUploadAllowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
      if (!certUploadAllowedTypes.includes(file.mimetype)) {
        res.status(400).json({ error: "Invalid file type. Only images (JPEG, PNG, GIF, WebP) and PDFs are allowed." }); return;
      }

      if (existing.fileObjectKey) {
        try {
          const { objectStorageClient } = await import("./objectStorage");
          const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
          const fullPath = `${privateDir}/${existing.fileObjectKey}`;
          const pathStr = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
          const parts = pathStr.split("/");
          const bucketName = parts[0];
          const objectName = parts.slice(1).join("/");
          const bucket = objectStorageClient.bucket(bucketName);
          const objectFile = bucket.file(objectName);
          await objectFile.delete().catch(() => {});
        } catch (e) {
          logError("Error deleting old certification file:", {}, e instanceof Error ? e : new Error(String(e)));
        }
      }

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const objectId = `certifications/${userId}/${Date.now()}-${file.originalname}`;
      const fullPath = `${privateDir}/${objectId}`;
      const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");
      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      await objectFile.save(file.buffer, { contentType: file.mimetype });

      const fileUrl = `/api/auth/certification-files/${objectId}`;
      const [updated] = await db.update(userCertifications)
        .set({ fileUrl, fileObjectKey: objectId, fileName: file.originalname, updatedAt: new Date() })
        .where(eq(userCertifications.id, certId))
        .returning();

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/certification-files/*", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const filePath = req.params[0];
      if (!filePath) { res.status(400).json({ error: "File path required" }); return; }

      const pathParts = filePath.split("/");
      if (pathParts.length < 2) { res.status(400).json({ error: "Invalid file path" }); return; }
      const fileOwnerId = pathParts[1];

      if (fileOwnerId !== userId) {
        res.status(403).json({ error: "Access denied" }); return;
      }

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const fullPath = `${privateDir}/${filePath}`;
      const pathStr = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
      const parts = pathStr.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      const [exists] = await objectFile.exists();
      if (!exists) { res.status(404).json({ error: "File not found" }); return; }

      const [metadata] = await objectFile.getMetadata();
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": String(metadata.size),
        "Cache-Control": "private, max-age=3600",
      });
      objectFile.createReadStream().pipe(res);
    } catch (error) {
      logError("Error serving certification file:", {}, error instanceof Error ? error : new Error(String(error)));
      if (!res.headersSent) next(error);
    }
  });

  // ==================== Performance & History Routes ====================

  router.get("/api/auth/my-performance-profile", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const [profile] = await db.select().from(employeePerformanceProfiles).where(eq(employeePerformanceProfiles.userId, userId));
      res.json(profile || null);
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/auth/my-performance-profile", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const schema = z.object({
        experienceLevel: z.string().max(50).optional().nullable(),
        productivityTendencies: z.string().max(1000).optional().nullable(),
        pastProjects: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.errors }); return; }
      const [existing] = await db.select().from(employeePerformanceProfiles).where(eq(employeePerformanceProfiles.userId, userId));
      if (existing) {
        const [updated] = await db.update(employeePerformanceProfiles)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(eq(employeePerformanceProfiles.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db.insert(employeePerformanceProfiles)
          .values({ userId, organizationId: orgId || null, ...parsed.data })
          .returning();
        res.json(created);
      }
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-attendance-logs", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const logs = await db.select().from(attendanceLogs).where(eq(attendanceLogs.userId, userId)).orderBy(desc(attendanceLogs.date));
      res.json(logs);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/attendance-logs", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "ADMIN"];
      if (!managerRoles.includes(req.user?.role || "")) { res.status(403).json({ error: "Only managers can log attendance" }); return; }
      const schema = z.object({
        userId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED", "HALF_DAY"]),
        notes: z.string().max(500).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.errors }); return; }
      if (orgId) {
        const [targetUser] = await db.select().from(users).where(and(eq(users.id, parsed.data.userId), eq(users.organizationId, orgId)));
        if (!targetUser) { res.status(403).json({ error: "User not in your organization" }); return; }
      }
      const [log] = await db.insert(attendanceLogs).values({ ...parsed.data, organizationId: orgId || null, recordedBy: userId }).returning();
      res.json(log);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-safety-incidents", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const incidents = await db.select().from(safetyIncidents).where(eq(safetyIncidents.userId, userId)).orderBy(desc(safetyIncidents.date));
      res.json(incidents);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/safety-incidents", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "ADMIN"];
      if (!managerRoles.includes(req.user?.role || "")) { res.status(403).json({ error: "Only managers can log safety incidents" }); return; }
      const schema = z.object({
        userId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        description: z.string().max(2000),
        actionTaken: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.errors }); return; }
      if (orgId) {
        const [targetUser] = await db.select().from(users).where(and(eq(users.id, parsed.data.userId), eq(users.organizationId, orgId)));
        if (!targetUser) { res.status(403).json({ error: "User not in your organization" }); return; }
      }
      const [incident] = await db.insert(safetyIncidents).values({ ...parsed.data, organizationId: orgId || null, recordedBy: userId }).returning();
      try {
        const { eventBus } = await import("./events");
        await eventBus.emit({
          type: "safety.incident_created",
          version: 1,
          orgId: orgId || "",
          actorId: userId,
          timestamp: new Date(),
          payload: {
            incidentId: incident.id,
            severity: parsed.data.severity,
          },
        });
      } catch { logWarn("Non-critical operation failed"); }
      res.json(incident);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-quality-issues", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const issues = await db.select().from(qualityIssues).where(eq(qualityIssues.userId, userId)).orderBy(desc(qualityIssues.date));
      res.json(issues);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/quality-issues", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "ADMIN"];
      if (!managerRoles.includes(req.user?.role || "")) { res.status(403).json({ error: "Only managers can log quality issues" }); return; }
      const schema = z.object({
        userId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        category: z.enum(["REWORK", "DEFECT", "MATERIAL_WASTE", "SPECIFICATION_DEVIATION", "OTHER"]),
        description: z.string().max(2000),
        resolution: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.errors }); return; }
      if (orgId) {
        const [targetUser] = await db.select().from(users).where(and(eq(users.id, parsed.data.userId), eq(users.organizationId, orgId)));
        if (!targetUser) { res.status(403).json({ error: "User not in your organization" }); return; }
      }
      const [issue] = await db.insert(qualityIssues).values({ ...parsed.data, organizationId: orgId || null, recordedBy: userId }).returning();
      res.json(issue);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-performance-reviews", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const reviews = await db.select().from(performanceReviews).where(eq(performanceReviews.userId, userId)).orderBy(desc(performanceReviews.reviewDate));
      res.json(reviews);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/performance-reviews", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "ADMIN"];
      if (!managerRoles.includes(req.user?.role || "")) { res.status(403).json({ error: "Only managers can create reviews" }); return; }
      const schema = z.object({
        userId: z.string(),
        reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reviewerName: z.string().max(200),
        overallRating: z.number().min(1).max(5),
        productivityRating: z.number().min(1).max(5).optional().nullable(),
        qualityRating: z.number().min(1).max(5).optional().nullable(),
        safetyRating: z.number().min(1).max(5).optional().nullable(),
        communicationRating: z.number().min(1).max(5).optional().nullable(),
        leadershipRating: z.number().min(1).max(5).optional().nullable(),
        notes: z.string().max(5000).optional().nullable(),
        scheduleAdherence: z.string().max(1000).optional().nullable(),
        costControl: z.string().max(1000).optional().nullable(),
        subcontractorCoordination: z.string().max(1000).optional().nullable(),
        clientInspectionOutcomes: z.string().max(1000).optional().nullable(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.errors }); return; }
      if (orgId) {
        const [targetUser] = await db.select().from(users).where(and(eq(users.id, parsed.data.userId), eq(users.organizationId, orgId)));
        if (!targetUser) { res.status(403).json({ error: "User not in your organization" }); return; }
      }
      const [review] = await db.insert(performanceReviews).values({ ...parsed.data, organizationId: orgId || null, recordedBy: userId }).returning();
      res.json(review);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/auth/my-supervisor-notes", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const notes = await db.select().from(supervisorNotes).where(eq(supervisorNotes.userId, userId)).orderBy(desc(supervisorNotes.createdAt));
      res.json(notes);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/auth/supervisor-notes", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "ADMIN"];
      if (!userRole || !managerRoles.includes(userRole)) { res.status(403).json({ error: "Only managers can add supervisor notes" }); return; }
      const schema = z.object({
        userId: z.string().min(1),
        note: z.string().min(1).max(2000),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid data", details: parsed.error.errors }); return; }
      if (orgId) {
        const [targetUser] = await db.select().from(users).where(and(eq(users.id, parsed.data.userId), eq(users.organizationId, orgId)));
        if (!targetUser) { res.status(403).json({ error: "User not in your organization" }); return; }
      }
      const creatorName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || "Manager";
      const [note] = await db.insert(supervisorNotes).values({
        userId: parsed.data.userId,
        organizationId: orgId || null,
        note: parsed.data.note,
        createdBy: userId,
        createdByName: creatorName,
      }).returning();
      res.json(note);
    } catch (error) {
      next(error);
    }
  });

// Task #798 — Mobile SSO handoff. The native field app cannot share cookies
// with the system browser, so when an org enforces SSO the mobile app opens
// /api/sso/:slug/login (with a redirect=/api/auth/mobile-exchange?...
// RelayState) in a system browser tab. Once the cookie session is
// established the browser hits this exchange endpoint, which mints a
// short-lived (60 s) one-time code and 302s back to the registered
// smartmanageai:// deep link carrying the *code* — never a raw JWT.
//
// The mobile app catches the deep link and POSTs the code to
// /api/auth/mobile-exchange/redeem to atomically swap it for the JWT. This
// avoids logging the JWT in the system browser history / OS deep-link logs
// and tightly binds the token to a single redeeming caller (the app).
// Exchange codes are persisted to mobile_exchange_codes (see
// utils/ensureMobileExchangeCodes.ts). Postgres is the source of truth so
// redemption succeeds across multi-instance deployments and survives
// restarts within the 60 s TTL window.
import { pool as exchangePool } from "./db";
function newExchangeCode(): string {
  return crypto.randomBytes(32).toString("base64url");
}
async function pruneExchangeCodes(): Promise<void> {
  await exchangePool.query("DELETE FROM mobile_exchange_codes WHERE expires_at <= NOW()");
}

router.get("/api/auth/mobile-exchange", async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) {
      const fallback = `/login?redirect=${encodeURIComponent(req.originalUrl)}`;
      res.redirect(302, fallback);
      return;
    }
    const redirect = String(req.query.redirect || "");
    if (!/^smartmanageai:\/\//i.test(redirect)) {
      res.status(400).json({ error: "redirect must be a smartmanageai:// deep link" });
      return;
    }
    const [u] = await db
      .select({ id: users.id, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);
    if (!u) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    await pruneExchangeCodes();
    const code = newExchangeCode();
    await exchangePool.query(
      `INSERT INTO mobile_exchange_codes (code, user_id, token_version, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '60 seconds')`,
      [code, u.id, u.tokenVersion ?? 0]
    );
    const sep = redirect.includes("?") ? "&" : "?";
    res.redirect(302, `${redirect}${sep}code=${encodeURIComponent(code)}`);
  } catch (err) {
    next(err);
  }
});

router.post("/api/auth/mobile-exchange/redeem", async (req, res, next) => {
  try {
    const code = String(req.body?.code || "");
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }
    // Atomic single-use redemption: DELETE … RETURNING in a single statement
    // means a replayed code can never mint two JWTs even under concurrent
    // requests, and the row only matches if it has not yet expired.
    const { rows } = await exchangePool.query<{ user_id: string; token_version: number }>(
      `DELETE FROM mobile_exchange_codes
       WHERE code = $1 AND expires_at > NOW()
       RETURNING user_id, token_version`,
      [code]
    );
    if (rows.length === 0) {
      res.status(401).json({ error: "Code is invalid or expired" });
      return;
    }
    const token = generateToken(rows[0].user_id, rows[0].token_version);
    res.json({ token });
  } catch (err) {
    next(err);
  }
});

export default router;
