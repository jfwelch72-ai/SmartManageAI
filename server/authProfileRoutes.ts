import { Router } from "express";
import multer from "multer";
import { db } from "./db";
import {
  users, organizations, userPhotos, userSkills, skills,
  skillVerificationRequests, userCertifications, notifications,
  employeePerformanceProfiles, attendanceLogs, safetyIncidents,
  qualityIssues, performanceReviews, supervisorNotes,
  ssoConfigurations
} from "@shared/schema";
import {
  requireAuth, hashPassword, verifyPassword, generateToken,
  setAuthCookie, clearAuthCookie, type AuthRequest
} from "./auth";
import { authLimiter } from "./rateLimiter";
import { eq, desc, sql, and, or, inArray, isNull, gt } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { logUpdate, logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { emailVerificationTokens } from "@shared/schema";
import { sendEmail, getEmailVerificationHtml, getEmailVerificationText } from "./email";
import { insertNotification } from "./services/notificationService";
import { setAllFeatureFlags } from "./services/featureFlagService";
import { FEATURE_FLAG_KEYS } from "@shared/schema";

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

  const passwordSchema = z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number");

  const registerSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    phone: z.string().optional(),
    password: passwordSchema,
  });

  // Register new user
  router.post("/api/auth/register", authLimiter, async (req: AuthRequest, res) => {
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
      }).catch(err => console.error("Failed to send verification email:", err));

      const token = generateToken(newUser.id, newUser.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = newUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Registration successful! Please check your email to verify your account.",
        needsOnboarding: true,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const MAX_FAILED_ATTEMPTS = 5;
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  router.post("/api/auth/login", authLimiter, async (req: AuthRequest, res) => {
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
          res.status(403).json({
            error: "SSO is required for your organization. Please sign in via SSO.",
            ssoEnforced: true,
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

      const token = generateToken(user.id, user.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash, tokenVersion, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Logout
  router.post("/api/auth/logout", (req: AuthRequest, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
  });

  router.get("/api/auth/verify-email", async (req: AuthRequest, res) => {
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
      console.error("Email verification error:", error);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  router.post("/api/auth/resend-verification", requireAuth, authLimiter, async (req: AuthRequest, res) => {
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
      console.error("Resend verification error:", error);
      res.status(500).json({ error: "Failed to send verification email" });
    }
  });

  // DEV ONLY: Quick test login for development
  router.post("/api/dev/test-login", async (req: AuthRequest, res) => {
    // SECURITY: Only available in development mode
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const { role } = req.body;
      const validRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER", "VENDOR", "HUSTLER", "SALES", "MARKETING", "SAFETY_MANAGER", "HR_MANAGER", "EQUIPMENT_MANAGER", "PROJECT_ENGINEER", "PROCUREMENT_MANAGER", "DISPATCHER"];
      
      if (!role || !validRoles.includes(role)) {
        res.status(400).json({ error: "Invalid role", validRoles });
        return;
      }

      // Find or create dev sandbox organization (for non-SUPER_ADMIN roles)
      let devOrg = null;
      if (role !== "SUPER_ADMIN") {
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
          console.log("[DEV] Created sandbox organization:", devOrg.id);
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
          organizationId: role === "SUPER_ADMIN" ? null : devOrg?.id,
        }).returning();
        console.log(`[DEV] Created test user: ${testEmail} (${role})`);
      }

      // Generate token and set cookie
      const token = generateToken(testUser.id, testUser.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = testUser;
      res.json({ 
        user: userWithoutPassword,
        message: `Logged in as ${role} test account`,
        isDevAccount: true
      });
    } catch (error) {
      console.error("[DEV] Test login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // DEV ONLY: Create fresh admin for full onboarding experience
  router.post("/api/dev/fresh-admin-login", async (req: AuthRequest, res) => {
    // SECURITY: Only available in development mode
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: "Not found" });
      return;
    }

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
      console.log("[DEV] Created fresh organization for onboarding:", newOrg.id);

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
      console.log(`[DEV] Created fresh admin: ${uniqueEmail}`);

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
      console.error("[DEV] Fresh admin login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get current user (with organization name and onboarding status)
  router.get("/api/auth/me", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error fetching user org:", error);
      res.json({ user: req.user, organizationName: null, organizationOnboardingStatus: null });
    }
  });

  router.patch("/api/auth/profile", requireAuth, async (req: AuthRequest, res) => {
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
      });
      const parsed = profileSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid input", details: parsed.error.errors }); return; }

      const { firstName, lastName, phone, birthdate, timezone, profileDescription,
        tradeSpecialization, employmentType, emergencyContactName, emergencyContactPhone,
        emergencyContactAddress, emergencyContactEmail } = parsed.data;
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

      const [updated] = await db.update(users).set(updateData).where(eq(users.id, userId)).returning();
      if (!updated) { res.status(404).json({ error: "User not found" }); return; }

      await logUpdate(userId, "users", userId, req.user, updateData, req as any);

      const { passwordHash, tokenVersion, ...sanitized } = updated;
      res.json(sanitized);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/change-password", requireAuth, async (req: AuthRequest, res) => {
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

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/upload-avatar", requireAuth, upload.single("avatar"), async (req: AuthRequest, res) => {
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
      console.error("Error uploading avatar:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-photos", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const photos = await db.select().from(userPhotos).where(eq(userPhotos.userId, userId)).orderBy(desc(userPhotos.uploadedAt));
      res.json(photos);
    } catch (error) {
      console.error("Error fetching user photos:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/upload-photos", requireAuth, upload.array("photos", 10), async (req: AuthRequest, res) => {
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
      console.error("Error uploading photos:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/auth/my-photos/:photoId", requireAuth, async (req: AuthRequest, res) => {
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
          console.error("Error deleting user photo from storage:", e);
        }
      }

      await db.delete(userPhotos).where(eq(userPhotos.id, photoId));
      res.json({ message: "Photo deleted" });
    } catch (error) {
      console.error("Error deleting photo:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/profile-files/*", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error serving profile file:", error);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-skills", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error fetching user skills:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/my-skills", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error adding skill:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/auth/my-skills/:userSkillId", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error removing skill:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/api/auth/my-skills/:userSkillId/rating", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error updating skill rating:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/my-skills/:userSkillId/request-verification", requireAuth, async (req: AuthRequest, res) => {
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
          inArray(users.role, ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"])
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
      console.error("Error requesting skill verification:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/skill-verification-requests", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error fetching verification requests:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/api/auth/skill-verification-requests/:requestId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const allowedRoles = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"];
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
        type: "GENERAL",
        title: `Skill Verification ${parsed.data.action === "approve" ? "Approved" : "Rejected"}`,
        message: `Your skill "${skillInfo?.name || "Unknown"}" has been ${parsed.data.action === "approve" ? "approved" : "rejected"} by ${verifierName}`,
      });

      res.json({ message: `Verification request ${newStatus}` });
    } catch (error) {
      console.error("Error resolving verification request:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-certifications", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const certs = await db.select().from(userCertifications)
        .where(eq(userCertifications.userId, userId))
        .orderBy(desc(userCertifications.createdAt));
      res.json(certs);
    } catch (error) {
      console.error("Error fetching certifications:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/my-certifications", requireAuth, upload.single("file"), async (req: AuthRequest, res) => {
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
      console.error("Error adding certification:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/api/auth/my-certifications/:certId", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error updating certification:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/api/auth/my-certifications/:certId", requireAuth, async (req: AuthRequest, res) => {
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
          console.error("Error deleting certification file from storage:", e);
        }
      }

      await db.delete(userCertifications).where(eq(userCertifications.id, certId));
      res.json({ message: "Certification deleted" });
    } catch (error) {
      console.error("Error deleting certification:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/my-certifications/:certId/upload", requireAuth, upload.single("file"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { certId } = req.params;
      const [existing] = await db.select().from(userCertifications)
        .where(and(eq(userCertifications.id, certId), eq(userCertifications.userId, userId))).limit(1);
      if (!existing) { res.status(404).json({ error: "Certification not found" }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ error: "No file provided" }); return; }

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
          console.error("Error deleting old certification file:", e);
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
      console.error("Error uploading certification file:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/certification-files/*", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error serving certification file:", error);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  // ==================== Performance & History Routes ====================

  router.get("/api/auth/my-performance-profile", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const [profile] = await db.select().from(employeePerformanceProfiles).where(eq(employeePerformanceProfiles.userId, userId));
      res.json(profile || null);
    } catch (error) {
      console.error("Error fetching performance profile:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/api/auth/my-performance-profile", requireAuth, async (req: AuthRequest, res) => {
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
      console.error("Error updating performance profile:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-attendance-logs", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const logs = await db.select().from(attendanceLogs).where(eq(attendanceLogs.userId, userId)).orderBy(desc(attendanceLogs.date));
      res.json(logs);
    } catch (error) {
      console.error("Error fetching attendance logs:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/attendance-logs", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"];
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
      console.error("Error creating attendance log:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-safety-incidents", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const incidents = await db.select().from(safetyIncidents).where(eq(safetyIncidents.userId, userId)).orderBy(desc(safetyIncidents.date));
      res.json(incidents);
    } catch (error) {
      console.error("Error fetching safety incidents:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/safety-incidents", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"];
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
      res.json(incident);
    } catch (error) {
      console.error("Error creating safety incident:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-quality-issues", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const issues = await db.select().from(qualityIssues).where(eq(qualityIssues.userId, userId)).orderBy(desc(qualityIssues.date));
      res.json(issues);
    } catch (error) {
      console.error("Error fetching quality issues:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/quality-issues", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"];
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
      console.error("Error creating quality issue:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-performance-reviews", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const reviews = await db.select().from(performanceReviews).where(eq(performanceReviews.userId, userId)).orderBy(desc(performanceReviews.reviewDate));
      res.json(reviews);
    } catch (error) {
      console.error("Error fetching performance reviews:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/performance-reviews", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"];
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
      console.error("Error creating performance review:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/auth/my-supervisor-notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const notes = await db.select().from(supervisorNotes).where(eq(supervisorNotes.userId, userId)).orderBy(desc(supervisorNotes.createdAt));
      res.json(notes);
    } catch (error) {
      console.error("Error fetching supervisor notes:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/api/auth/supervisor-notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;
      const orgId = req.user?.organizationId;
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
      const managerRoles = ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"];
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
      console.error("Error creating supervisor note:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

export default router;
