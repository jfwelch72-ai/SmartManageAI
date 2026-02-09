import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import multer from "multer";
import { db } from "./db";

// Configure multer for memory storage (for file uploads)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});
import { users, insertUserSchema, type InsertUser, type SelectUser, auditLog, billingEvents, timeClockShifts, passwordResetTokens, tradeTypeEnum } from "@shared/schema";
import { sendEmail, getPasswordResetEmailHtml, getPasswordResetEmailText } from "./email";
import { 
  projects, bids, estimates, estimateLineItems, procurementItems, planDocuments,
  timeEntries, tmDailySheets, receipts, projectNotes, scopeItems, media,
  changeOrders, changeOrderLaborEntries, changeOrderEquipmentEntries, changeOrderMaterialEntries,
  calendarEvents, notifications, filePermissions, projectDelays,
  insertProjectSchema, insertBidSchema, insertEstimateSchema,
  insertProcurementItemSchema, insertPlanDocumentSchema, insertTimeEntrySchema,
  insertTMDailySheetSchema, insertReceiptSchema, insertProjectNoteSchema,
  insertScopeItemSchema, insertMediaSchema, insertChangeOrderSchema,
  insertCalendarEventSchema, insertNotificationSchema, insertFilePermissionSchema,
  crews, crewMembers, skills, userSkills, equipment,
  insertCrewSchema, insertCrewMemberSchema, insertSkillSchema, insertUserSkillSchema,
  subcontractors, subcontractorContracts, subcontractorPayments,
  projectLaborRates, projectEmployeeRates,
  insertProjectLaborRateSchema, insertProjectEmployeeRateSchema,
  aiNoteInsights, aiTasks, projectPlans, takeoffMeasurements, takeoffSheets, 
  quantityCategories, tasks, dailyScopeProgress, tmTickets,
  scopeWorkTypeCategories, scopeWorkTypes, scopeModifierCategories, scopeModifiers,
  insertScopeWorkTypeCategorySchema, insertScopeWorkTypeSchema,
  insertScopeModifierCategorySchema, insertScopeModifierSchema,
  equipmentAssignments, equipmentRepairs, equipmentMaintenanceSchedules,
  equipmentMaintenanceHistory, equipmentHourLogs, equipmentHourReminders,
  equipmentRateProfiles, insertEquipmentRateProfileSchema, validatedEquipmentSchema,
  rentalVendors, insertRentalVendorSchema,
  rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema,
  bidEquipmentSelections, insertBidEquipmentSelectionSchema,
  projectEquipmentPlans, insertProjectEquipmentPlanSchema,
  rentalEquipmentUsages, insertRentalEquipmentUsageSchema,
  tradeFeatures, organizations, organizationSowItems, masterSowItems,
  masterModifierCategories, masterModifiers,
  scheduleOfValues, sovLineItems
} from "@shared/schema";
import { 
  authMiddleware, 
  requireAuth, 
  requireRole, 
  hashPassword, 
  verifyPassword, 
  generateToken, 
  setAuthCookie, 
  clearAuthCookie,
  revokeUserTokens,
  type AuthRequest 
} from "./auth";
import { eq, ne, desc, asc, sql, and, or, isNull, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { authLimiter, sensitiveLimiter, apiLimiter } from "./rateLimiter";
import { logCreate, logUpdate, logDelete, logApprove, logReject, logAudit } from "./auditLogger";
import { validateFileExists, validateMimeType, validateFileSize } from "./fileValidation";
import { sanitizeShortText, sanitizeText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { registerTimeClockRoutes } from "./timeClockRoutes";
import { registerPayrollSettingsRoutes } from "./payrollSettingsRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import delayRoutes from "./delayRoutes";
import inspectionRoutes from "./inspectionRoutes";
import aiRoutes from "./aiRoutes";
import notesRoutes from "./notesRoutes";
import aiNotesRoutes from "./aiNotesRoutes";
import taskRoutes from "./taskRoutes";
import registerEstimateRoutes from "./estimateRoutes";
import { registerTMTicketRoutes } from "./tmTicketRoutes";
import platformAdminRoutes from "./platformAdminRoutes";
import calculatorRoutes from "./calculatorRoutes";
import aiAssistantRoutes from "./aiAssistantRoutes";
import aiFeatureRoutes from "./aiFeatureRoutes";
import organizationDocumentRoutes from "./organizationDocumentRoutes";
import aiBidDocumentRoutes from "./aiBidDocumentRoutes";
import aiContractDocumentRoutes from "./aiContractDocumentRoutes";
import sovRoutes from "./sovRoutes";
import subcontractRoutes from "./subcontractRoutes";
import subcontractorPayablesRoutes from "./subcontractorPayablesRoutes";
import websiteBuilderRoutes from "./websiteBuilderRoutes";
import laborRateRoutes from "./laborRateRoutes";
import emailAccountRoutes from "./emailAccountRoutes";
import billingRoutes from "./billingRoutes";
import emailAiRoutes from "./emailAiRoutes";
import dashboardCustomizationRoutes from "./dashboardCustomizationRoutes";
import opsRoutes from "./opsRoutes";
import hustlerRoutes from "./hustlerRoutes";
import bidNetworkRoutes from "./bidNetworkRoutes";
import weatherRoutes from "./weatherRoutes";
import vendorPricebookRoutes from "./vendorPricebookRoutes";
import delayClaimsRoutes from "./delayClaimsRoutes";
import fieldProductivityRoutes from "./fieldProductivityRoutes";
import marketplaceRoutes from "./marketplaceRoutes";
import aiScheduleRoutes from "./aiScheduleRoutes";
import { createArcSegment } from "@shared/utils/geometry";
import { seedCoreTradeModifierCategories } from "./seedTradeExpansion";
import { generateInternalBidSummaryPDF, generateCustomerQuotePDF } from "./pdf-service";
import { getOrgIdForFilter, verifyOrgAccess, verifyUserOrgAccess, isSuperAdmin } from "./orgFilter";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register operational routes BEFORE auth middleware (health checks should be public)
  app.use(opsRoutes);

  // Apply auth middleware to all routes
  app.use(authMiddleware);

  // Apply general API rate limiter to all API routes BEFORE registering any routes
  app.use("/api", apiLimiter);

  // Register time-clock routes (now protected by rate limiter)
  registerTimeClockRoutes(app);
  
  // Register payroll settings routes (work week config, weekly reports)
  registerPayrollSettingsRoutes(app);

  // Register change order state machine routes
  app.use("/api/change-orders", changeOrderRoutes);

  // Register delay tracking routes
  app.use("/api", delayRoutes);

  // Register delay claims routes
  app.use("/api/delay-claims", delayClaimsRoutes);
  app.use("/api/field-productivity", fieldProductivityRoutes);

  // Register marketplace routes (vendor scores, material prices, crew marketplace)
  app.use("/api/marketplace", marketplaceRoutes);
  app.use(aiScheduleRoutes);

  // Register inspection scheduling routes
  app.use("/api", inspectionRoutes);

  // Register AI PM + CFO routes
  app.use("/api", aiRoutes);

  // Register daily notes routes
  app.use("/api", notesRoutes);

  // Register AI notes analysis routes
  app.use("/api/ai-notes", aiNotesRoutes);

  // Register task management routes
  app.use(taskRoutes);

  // Register estimate routes
  registerEstimateRoutes(app);

  // Register T&M ticket routes
  registerTMTicketRoutes(app);

  // Register platform admin routes (SUPER_ADMIN only)
  app.use("/api", platformAdminRoutes);

  // Register material calculator routes
  app.use("/api/calculators", calculatorRoutes);

  // Register AI Assistant routes (SOW and UOM management)
  app.use("/api/ai-assistant", aiAssistantRoutes);

  // Register AI Feature routes (7 major AI-enhanced features)
  app.use("/api/ai-features", aiFeatureRoutes);

  // Register organization document routes
  app.use("/api", organizationDocumentRoutes);

  // Register AI bid document analysis routes
  app.use("/api", aiBidDocumentRoutes);

  // Register AI contract/award document analysis routes
  app.use("/api", aiContractDocumentRoutes);

  // Register Schedule of Values (SOV) routes
  app.use("/api", sovRoutes);

  // Register Subcontract Agreement routes
  app.use("/api", subcontractRoutes);

  // Register Subcontractor Payables routes
  app.use("/api", subcontractorPayablesRoutes);

  // Register Website Builder routes
  app.use("/api/website", websiteBuilderRoutes);

  // Register Labor Rate routes
  app.use("/api/labor-rates", laborRateRoutes);

  // Register Email Account routes
  app.use("/api/email", emailAccountRoutes);

  // Register Email AI routes (threads, messages, tasks, summaries)
  app.use("/api/email", emailAiRoutes);

  // Register Dashboard Customization routes
  app.use("/api/dashboard", dashboardCustomizationRoutes);

  // Register Hustler Multi-Organization routes
  app.use("/api", hustlerRoutes);

  // Register Subcontractor Bid Network routes
  app.use("/api/bid-network", bidNetworkRoutes);

  // Register Billing routes
  app.use("/api/billing", billingRoutes);

  // Register Weather routes (forecast and history for delay documentation)
  app.use("/api/weather", weatherRoutes);

  // Register Vendor Pricebook routes (PDF upload and AI extraction)
  app.use("/api/vendor", vendorPricebookRoutes);

  // ====================
  // Auth Routes
  // ====================

  // Login schema
  const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
  });

  // Registration schema
  const registerSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    phone: z.string().optional(),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  // Register new user
  app.post("/api/auth/register", authLimiter, async (req: AuthRequest, res) => {
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

      // Create new user - auto-approved and ready for onboarding
      const passwordHash = await hashPassword(password);
      
      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone,
        role: "ADMIN", // New registrants become org admins after onboarding
        isActive: true, // Auto-approved - no admin activation required
        passwordHash,
        // organizationId is null - user needs to complete onboarding
      }).returning();

      // Auto-login the user by setting the auth cookie
      const token = generateToken(newUser.id, newUser.tokenVersion);
      setAuthCookie(res, token);

      const { passwordHash: _, tokenVersion: __, ...userWithoutPassword } = newUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Registration successful! Let's set up your business.",
        needsOnboarding: true // Flag to redirect to onboarding
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Login
  app.post("/api/auth/login", authLimiter, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize email before validation
      const sanitizedBody = {
        email: sanitizeEmail(req.body.email),
        password: req.body.password, // Don't sanitize passwords - preserve exact input
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

      const isValid = await verifyPassword(password, user.passwordHash);
      
      if (!isValid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
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
  app.post("/api/auth/logout", (req: AuthRequest, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
  });

  // DEV ONLY: Quick test login for development
  app.post("/api/dev/test-login", async (req: AuthRequest, res) => {
    // SECURITY: Only available in development mode
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const { role } = req.body;
      const validRoles = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "OFFICE_MANAGER", "HOURLY_EMPLOYEE", "MAINTENANCE_MANAGER", "VENDOR", "HUSTLER"];
      
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
  app.post("/api/dev/fresh-admin-login", async (req: AuthRequest, res) => {
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
  app.get("/api/auth/me", requireAuth, async (req: AuthRequest, res) => {
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

  // Get trade features for current user's organization
  app.get("/api/trade-features", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const [user] = await db
        .select({ organizationId: users.organizationId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user?.organizationId) {
        res.json({ features: [], tradeType: null });
        return;
      }

      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, user.organizationId))
        .limit(1);

      if (!org?.tradeType) {
        res.json({ features: [], tradeType: null });
        return;
      }

      let features;
      
      if (org.tradeType === "GENERAL_CONTRACTOR") {
        // GC mode: Return all unique features across all trades (deduplicated by featureKey)
        // Get all enabled features and deduplicate by featureKey, keeping first occurrence
        const allFeatures = await db
          .select()
          .from(tradeFeatures)
          .where(eq(tradeFeatures.isEnabled, true))
          .orderBy(tradeFeatures.sortOrder, tradeFeatures.tradeType);

        // Deduplicate by featureKey (keep first occurrence which has lowest sortOrder)
        const seenKeys = new Set<string>();
        features = allFeatures.filter(f => {
          if (seenKeys.has(f.featureKey)) return false;
          seenKeys.add(f.featureKey);
          return true;
        });
      } else {
        // Single trade mode: Return features for the specific trade only
        features = await db
          .select()
          .from(tradeFeatures)
          .where(
            and(
              eq(tradeFeatures.tradeType, org.tradeType),
              eq(tradeFeatures.isEnabled, true)
            )
          )
          .orderBy(tradeFeatures.sortOrder);
      }

      res.json({ features, tradeType: org.tradeType });
    } catch (error) {
      console.error("Error fetching trade features:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Initialize admin user (one-time setup)
  app.post("/api/auth/init", async (req: AuthRequest, res) => {
    try {
      // Check if any users exist
      const existingUsers = await db.select().from(users).limit(1);
      
      if (existingUsers.length > 0) {
        res.status(400).json({ error: "System already initialized" });
        return;
      }

      // Create admin user
      const passwordHash = await hashPassword("admin123");
      
      const [adminUser] = await db.insert(users).values({
        firstName: "Admin",
        lastName: "User",
        email: "admin@tfrllc.com",
        role: "ADMIN",
        isActive: true,
        passwordHash,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = adminUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Admin user created. Email: admin@tfrllc.com, Password: admin123. Please change this password!"
      });
    } catch (error) {
      console.error("Init error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Forgot Password - Request password reset email
  app.post("/api/auth/forgot-password", authLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
      });

      const validationResult = schema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      const { email } = validationResult.data;
      const sanitizedEmail = sanitizeEmail(email);
      if (!sanitizedEmail) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }

      const [user] = await db.select().from(users).where(eq(users.email, sanitizedEmail)).limit(1);

      if (user && user.isActive) {
        await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash,
          expiresAt,
        });

        const baseUrl = process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
        const resetLink = `${baseUrl}/reset-password?token=${token}`;

        const emailSent = await sendEmail({
          to: user.email,
          subject: 'Password Reset Request - SmartManageAI',
          html: getPasswordResetEmailHtml(resetLink, user.firstName),
          text: getPasswordResetEmailText(resetLink, user.firstName),
        });

        if (emailSent) {
          console.log(`Password reset email sent successfully for: ${sanitizedEmail}`);
        } else {
          // Log failure but don't expose to user (security: prevents email enumeration)
          console.error(`CRITICAL: Password reset email FAILED to send for: ${sanitizedEmail}`);
        }
      }

      // Always return success message to prevent email enumeration attacks
      res.json({ message: "If an account with that email exists, a password reset link has been sent." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reset Password - Set new password using token
  app.post("/api/auth/reset-password", authLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        token: z.string().min(1),
        password: z.string().min(8, "Password must be at least 8 characters"),
      });

      const validationResult = schema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { token, password } = validationResult.data;
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt)
          )
        )
        .limit(1);

      if (!resetToken) {
        res.status(400).json({ error: "Invalid or expired reset token" });
        return;
      }

      if (new Date() > resetToken.expiresAt) {
        res.status(400).json({ error: "Reset token has expired" });
        return;
      }

      const newPasswordHash = await hashPassword(password);

      await db.update(users).set({
        passwordHash: newPasswordHash,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, resetToken.userId));

      await db.update(passwordResetTokens).set({
        usedAt: new Date(),
      }).where(eq(passwordResetTokens.id, resetToken.id));

      await logAudit({
        action: "UPDATE",
        entityType: "users",
        entityId: resetToken.userId,
        userId: resetToken.userId,
        newValue: JSON.stringify({ passwordReset: true }),
      });

      console.log(`Password reset completed for user: ${resetToken.userId}`);
      res.json({ message: "Password has been reset successfully. Please login with your new password." });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Validate Reset Token - Check if token is valid without using it
  app.get("/api/auth/validate-reset-token", async (req: AuthRequest, res) => {
    try {
      const token = req.query.token as string;
      
      if (!token) {
        res.status(400).json({ valid: false, error: "No token provided" });
        return;
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const [resetToken] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt)
          )
        )
        .limit(1);

      if (!resetToken) {
        res.json({ valid: false, error: "Invalid or expired reset token" });
        return;
      }

      if (new Date() > resetToken.expiresAt) {
        res.json({ valid: false, error: "Reset token has expired" });
        return;
      }

      res.json({ valid: true });
    } catch (error) {
      console.error("Validate token error:", error);
      res.status(500).json({ valid: false, error: "Internal server error" });
    }
  });

  // ====================
  // Dashboard Routes
  // ====================

  // Get dashboard statistics
  app.get("/api/dashboard/stats", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      // Organization filtering: SUPER_ADMIN sees all, others see only their org's data
      const { shouldFilter, orgId, isSuperAdmin: isSuperAdminUser, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any dashboard stats
      if (mustDenyAccess) {
        return res.json({
          activeProjectsCount: 0,
          pendingChangeOrdersCount: 0,
          pendingTimeOffCount: 0,
          activeDelaysCount: 0,
          delaysNeedingAckCount: 0,
          pendingInspectionsCount: 0,
          scheduledInspectionsCount: 0,
          aiTasksCount: 0,
          openBidsCount: 0,
          estimatedBidValue: 0
        });
      }
      
      // Build organization filter condition for projects
      const orgCondition = shouldFilter && orgId 
        ? eq(projects.gcOrganizationId, orgId) 
        : sql`true`;

      // Count active projects (filtered by org)
      const activeProjectsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.status, "ACTIVE"), orgCondition));
      const activeProjectsCount = activeProjectsResult[0]?.count || 0;

      // Count submitted change orders awaiting client response (filtered by org via project join)
      let pendingChangeOrdersCount = 0;
      if (shouldFilter && orgId) {
        const pendingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(changeOrders)
          .innerJoin(projects, eq(changeOrders.projectId, projects.id))
          .where(and(
            eq(changeOrders.status, "SUBMITTED"),
            eq(projects.gcOrganizationId, orgId)
          ));
        pendingChangeOrdersCount = pendingCOResult[0]?.count || 0;
      } else {
        const pendingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(changeOrders)
          .where(eq(changeOrders.status, "SUBMITTED"));
        pendingChangeOrdersCount = pendingCOResult[0]?.count || 0;
      }

      // Count pending time-off requests (filtered by user's org)
      let pendingTimeOffCount = 0;
      if (shouldFilter && orgId) {
        const pendingTimeOffResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(calendarEvents)
          .innerJoin(users, eq(calendarEvents.userId, users.id))
          .where(sql`${calendarEvents.eventType} = 'TIME_OFF_REQUEST' AND ${calendarEvents.approvedById} IS NULL AND ${users.organizationId} = ${orgId}`);
        pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;
      } else {
        const pendingTimeOffResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(calendarEvents)
          .where(sql`${calendarEvents.eventType} = 'TIME_OFF_REQUEST' AND ${calendarEvents.approvedById} IS NULL`);
        pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;
      }

      // Count active delays (filtered by org via project join)
      let activeDelaysCount = 0;
      if (shouldFilter && orgId) {
        const activeDelaysResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .innerJoin(projects, eq(projectDelays.projectId, projects.id))
          .where(sql`${projectDelays.status} IN ('DRAFT', 'SUBMITTED') AND ${projects.gcOrganizationId} = ${orgId}`);
        activeDelaysCount = activeDelaysResult[0]?.count || 0;
      } else {
        const activeDelaysResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .where(sql`${projectDelays.status} IN ('DRAFT', 'SUBMITTED')`);
        activeDelaysCount = activeDelaysResult[0]?.count || 0;
      }

      // Count delays requiring acknowledgment (filtered by org via project join)
      let delaysNeedingAckCount = 0;
      if (shouldFilter && orgId) {
        const delaysNeedingAckResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .innerJoin(projects, eq(projectDelays.projectId, projects.id))
          .where(and(
            eq(projectDelays.status, "SUBMITTED"),
            eq(projects.gcOrganizationId, orgId)
          ));
        delaysNeedingAckCount = delaysNeedingAckResult[0]?.count || 0;
      } else {
        const delaysNeedingAckResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .where(eq(projectDelays.status, "SUBMITTED"));
        delaysNeedingAckCount = delaysNeedingAckResult[0]?.count || 0;
      }

      // Count delays requiring change orders (filtered by org via project join)
      let delaysNeedingChangeOrderCount = 0;
      if (shouldFilter && orgId) {
        const delaysNeedingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .innerJoin(projects, eq(projectDelays.projectId, projects.id))
          .where(sql`${projectDelays.changeOrderRequired} = true AND ${projectDelays.linkedChangeOrderId} IS NULL AND ${projects.gcOrganizationId} = ${orgId}`);
        delaysNeedingChangeOrderCount = delaysNeedingCOResult[0]?.count || 0;
      } else {
        const delaysNeedingCOResult = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projectDelays)
          .where(sql`${projectDelays.changeOrderRequired} = true AND ${projectDelays.linkedChangeOrderId} IS NULL`);
        delaysNeedingChangeOrderCount = delaysNeedingCOResult[0]?.count || 0;
      }

      res.json({
        activeProjectsCount,
        pendingChangeOrdersCount,
        pendingTimeOffCount,
        activeDelaysCount,
        delaysNeedingAckCount,
        delaysNeedingChangeOrderCount,
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get comprehensive dashboard snapshot for AI analysis
  app.get("/api/dashboard/snapshot", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Organization required for dashboard snapshot" });
      }

      const { buildDashboardSnapshot, buildAISnapshotData } = await import("./dataPipelineService");
      
      const snapshot = await buildDashboardSnapshot(orgId);
      const aiData = await buildAISnapshotData(orgId);
      
      res.json({ snapshot, aiData });
    } catch (error) {
      console.error("Dashboard snapshot error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Aggregate time tracking data for production rate calculations
  app.post("/api/dashboard/aggregate-time-tracking", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Organization required" });
      }

      const { startDate, endDate } = req.body;
      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const { aggregateTimeTrackingToProductionRates } = await import("./dataPipelineService");
      
      const result = await aggregateTimeTrackingToProductionRates(orgId, start, end);
      
      res.json(result);
    } catch (error) {
      console.error("Time tracking aggregation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // User Management Routes
  // ====================

  // Get all users (Admin/Manager/Office Manager)
  app.get("/api/users", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Organization filtering: SUPER_ADMIN sees all users, others see only their org's users
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any users
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      let allUsers;
      if (shouldFilter && orgId) {
        allUsers = await db.select().from(users).where(eq(users.organizationId, orgId));
      } else {
        allUsers = await db.select().from(users);
      }
      const usersWithoutPasswords = allUsers.map(({ passwordHash, ...user }) => user);
      res.json(usersWithoutPasswords);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get user by ID (Admin/Manager only)
  app.get("/api/users/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (!verifyUserOrgAccess(req, res, user)) return;

      const { passwordHash, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create user schema (omit passwordHash, add password)
  const createUserSchema = insertUserSchema.omit({ passwordHash: true }).extend({
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  // Update user schema
  const updateUserSchema = insertUserSchema.omit({ passwordHash: true }).partial().extend({
    password: z.string().min(8, "Password must be at least 8 characters").optional(),
  });

  // Create user (Admin only)
  app.post("/api/users", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        firstName: sanitizeShortText(req.body.firstName),
        lastName: sanitizeShortText(req.body.lastName),
        email: sanitizeEmail(req.body.email),
        phone: sanitizePhone(req.body.phone),
        password: req.body.password, // Don't sanitize passwords - preserve exact input
      };

      const validationResult = createUserSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { firstName, lastName, email, phone, role, password } = validationResult.data;

      const passwordHash = await hashPassword(password);

      // Auto-assign to requesting admin's organization
      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone: phone || null,
        role: role || "HOURLY_EMPLOYEE",
        isActive: true,
        passwordHash,
        organizationId: req.user!.organizationId,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = newUser;
      res.status(201).json(userWithoutPassword);
    } catch (error: any) {
      console.error("Create user error:", error);
      if (error.code === '23505') { // Unique violation
        res.status(409).json({ error: "Email already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update user (Admin only)
  app.patch("/api/users/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const [targetUser] = await db.select({ organizationId: users.organizationId }).from(users).where(eq(users.id, req.params.id)).limit(1);
      if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }
      if (!verifyUserOrgAccess(req, res, targetUser)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        firstName: req.body.firstName ? sanitizeShortText(req.body.firstName) : undefined,
        lastName: req.body.lastName ? sanitizeShortText(req.body.lastName) : undefined,
        email: req.body.email ? sanitizeEmail(req.body.email) : undefined,
        phone: req.body.phone ? sanitizePhone(req.body.phone) : undefined,
        password: req.body.password, // Don't sanitize passwords - preserve exact input
      };

      const validationResult = updateUserSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { firstName, lastName, email, phone, role, isActive, password } = validationResult.data;
      
      const updateData: any = {};
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (email !== undefined) updateData.email = email;
      if (phone !== undefined) updateData.phone = phone;
      if (role !== undefined) updateData.role = role;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password !== undefined) updateData.passwordHash = await hashPassword(password);
      
      updateData.updatedAt = new Date();

      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, req.params.id))
        .returning();

      if (!updatedUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const { passwordHash, tokenVersion, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
    } catch (error: any) {
      console.error("Update user error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Email already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update user cost rates (Admin only)
  app.patch("/api/users/:id/cost-rates", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { costRateRegular, costRateOvertime } = req.body;

      if (costRateRegular === undefined || costRateRegular === null || costRateRegular === "") {
        res.status(400).json({ error: "Regular cost rate is required" });
        return;
      }

      if (costRateOvertime === undefined || costRateOvertime === null || costRateOvertime === "") {
        res.status(400).json({ error: "Overtime cost rate is required" });
        return;
      }

      const regularRate = Number(costRateRegular);
      const overtimeRate = Number(costRateOvertime);

      if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
        res.status(400).json({ error: "Cost rates must be valid non-negative numbers" });
        return;
      }

      const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (!verifyUserOrgAccess(req, res, user)) return;

      const [updated] = await db
        .update(users)
        .set({ 
          costRateRegular: regularRate.toFixed(2), 
          costRateOvertime: overtimeRate.toFixed(2),
          updatedAt: new Date() 
        })
        .where(eq(users.id, req.params.id))
        .returning();

      const { passwordHash, tokenVersion, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Update cost rates error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Revoke all user tokens (logout all devices) - Admin only
  app.post("/api/users/:id/revoke-tokens", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (!verifyUserOrgAccess(req, res, user)) return;

      await revokeUserTokens(req.params.id);

      // Audit log
      await logAudit({
        userId: req.user!.id,
        entityType: "USER",
        entityId: req.params.id,
        action: "REVOKE_TOKENS",
        oldValue: null,
        newValue: JSON.stringify({ revokedBy: req.user!.email }),
      }, req);

      res.json({ success: true, message: "All tokens revoked. User will need to log in again." });
    } catch (error) {
      console.error("Revoke tokens error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Change own password
  app.post("/api/auth/change-password", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Password must be at least 8 characters"),
      });

      const data = schema.parse(req.body);

      const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
      
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const isValid = await verifyPassword(data.currentPassword, user.passwordHash);
      
      if (!isValid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const newPasswordHash = await hashPassword(data.newPassword);

      await db
        .update(users)
        .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
        .where(eq(users.id, req.user!.id));

      res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Validation Helpers
  // ====================
  
  // Validate monetary amount is positive and within reasonable limits
  function validateMonetaryAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
    if (amount === null || amount === undefined) {
      return { valid: true }; // Optional fields are allowed to be null/undefined
    }
    
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(numAmount)) {
      return { valid: false, error: `${fieldName} must be a valid number` };
    }
    
    if (numAmount <= 0) {
      return { valid: false, error: `${fieldName} must be a positive value (greater than zero)` };
    }
    
    // Reasonable upper limit: $100 million per field
    if (numAmount > 100000000) {
      return { valid: false, error: `${fieldName} exceeds maximum allowed value ($100,000,000)` };
    }
    
    return { valid: true };
  }

  // Validate change order amount (can be positive or negative for additions/deductions)
  function validateChangeOrderAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
    if (amount === null || amount === undefined) {
      return { valid: false, error: `${fieldName} is required` };
    }
    
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(numAmount)) {
      return { valid: false, error: `${fieldName} must be a valid number` };
    }
    
    if (numAmount === 0) {
      return { valid: false, error: `${fieldName} cannot be zero (use positive for additions, negative for deductions)` };
    }
    
    // Reasonable limits: -$100 million to +$100 million
    if (Math.abs(numAmount) > 100000000) {
      return { valid: false, error: `${fieldName} exceeds maximum allowed value (±$100,000,000)` };
    }
    
    return { valid: true };
  }

  // Validate JSON string is parseable
  function validateJSONField(jsonString: string | null | undefined, fieldName: string): { valid: boolean; error?: string; parsed?: any } {
    if (jsonString === null || jsonString === undefined) {
      return { valid: true }; // Optional fields are allowed to be null/undefined
    }

    // Empty strings should default to null
    if (jsonString === "") {
      return { valid: true, parsed: null };
    }

    try {
      const parsed = JSON.parse(jsonString);
      return { valid: true, parsed };
    } catch (error) {
      return { 
        valid: false, 
        error: `${fieldName} contains invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}` 
      };
    }
  }

  // Validate project status transitions (state machine)
  type ProjectStatus = "BID" | "PLANNING" | "ACTIVE" | "COMPLETE" | "CLOSED";
  function validateProjectStatusTransition(currentStatus: ProjectStatus, newStatus: ProjectStatus): { valid: boolean; error?: string } {
    // Valid transitions map
    const validTransitions: Record<ProjectStatus, ProjectStatus[]> = {
      "BID": ["PLANNING"],
      "PLANNING": ["ACTIVE", "BID"],  // Can revert to BID if not started
      "ACTIVE": ["COMPLETE", "PLANNING"],  // Can revert to PLANNING if needed
      "COMPLETE": ["CLOSED", "ACTIVE"],  // Can revert to ACTIVE if more work needed
      "CLOSED": [],  // Terminal state - no transitions allowed
    };

    if (currentStatus === newStatus) {
      return { valid: true }; // Same status is always allowed
    }

    const allowedTransitions = validTransitions[currentStatus];
    if (!allowedTransitions.includes(newStatus)) {
      return { 
        valid: false, 
        error: `Invalid status transition from ${currentStatus} to ${newStatus}. Allowed transitions: ${allowedTransitions.join(", ") || "none (terminal state)"}` 
      };
    }

    return { valid: true };
  }

  // ====================
  // Bid Routes
  // ====================

  const { bids, insertBidSchema, projects } = await import("@shared/schema");

  // Get all bids with estimate summaries
  app.get("/api/bids", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Organization filtering: SUPER_ADMIN sees all, others see only their org's bids
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any bids
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      let allBids;
      if (shouldFilter && orgId) {
        allBids = await db
          .select({
            bid: bids,
            estimatorName: sql<string | null>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('estimator_name'),
          })
          .from(bids)
          .leftJoin(users, eq(bids.estimatorId, users.id))
          .where(eq(bids.gcOrganizationId, orgId))
          .orderBy(bids.createdAt);
      } else {
        allBids = await db
          .select({
            bid: bids,
            estimatorName: sql<string | null>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('estimator_name'),
          })
          .from(bids)
          .leftJoin(users, eq(bids.estimatorId, users.id))
          .orderBy(bids.createdAt);
      }
      
      // Flatten the result to include estimatorName in the bid object
      const bidsWithEstimatorNames = allBids.map(({ bid, estimatorName }) => ({
        ...bid,
        estimatorName: estimatorName || null,
      }));
      
      // Short-circuit if no bids exist
      if (bidsWithEstimatorNames.length === 0) {
        res.json([]);
        return;
      }

      // Fetch estimate summaries for all bids
      const bidIds = bidsWithEstimatorNames.map(bid => bid.id);
      
      // Get estimates for each bid using Drizzle's query builder
      const estimateResults = await db
        .select({
          bidId: estimates.bidId,
          estimateId: estimates.id,
          status: estimates.status,
          createdAt: estimates.createdAt,
        })
        .from(estimates)
        .where(inArray(estimates.bidId, bidIds))
        .orderBy(desc(estimates.createdAt));
      
      // Get the most recent estimate per bid
      const latestEstimatesByBid = new Map<string, { estimateId: string; status: string }>();
      for (const est of estimateResults) {
        if (est.bidId && !latestEstimatesByBid.has(est.bidId)) {
          latestEstimatesByBid.set(est.bidId, { estimateId: est.estimateId, status: est.status });
        }
      }
      
      // Get line item summaries for the latest estimates
      const latestEstimateIds = Array.from(latestEstimatesByBid.values()).map(e => e.estimateId);
      
      let lineItemSummaries: Array<{ estimateId: string; totalCost: number; lineItemCount: number }> = [];
      if (latestEstimateIds.length > 0) {
        lineItemSummaries = await db
          .select({
            estimateId: estimateLineItems.estimateId,
            totalCost: sql<number>`
              SUM(
                COALESCE(CAST(${estimateLineItems.materialCost} AS NUMERIC), 0) +
                COALESCE(CAST(${estimateLineItems.laborCost} AS NUMERIC), 0) +
                COALESCE(CAST(${estimateLineItems.equipmentCost} AS NUMERIC), 0) +
                COALESCE(CAST(${estimateLineItems.consumablesCost} AS NUMERIC), 0) +
                COALESCE(CAST(${estimateLineItems.subcontractCost} AS NUMERIC), 0) +
                COALESCE(CAST(${estimateLineItems.overheadAllocation} AS NUMERIC), 0) +
                COALESCE(CAST(${estimateLineItems.profitAllocation} AS NUMERIC), 0)
              )
            `.as('total_cost'),
            lineItemCount: sql<number>`COUNT(*)`.as('line_item_count'),
          })
          .from(estimateLineItems)
          .where(inArray(estimateLineItems.estimateId, latestEstimateIds))
          .groupBy(estimateLineItems.estimateId);
      }
      
      // Create a map of estimateId to line item summary
      const lineItemMap = new Map(
        lineItemSummaries.map(s => [s.estimateId, { totalCost: Number(s.totalCost) || 0, lineItemCount: Number(s.lineItemCount) || 0 }])
      );
      
      // Create map of bidId to estimate summary
      const estimateMap = new Map<string, { totalCost: number; lineItemCount: number; status: string }>();
      latestEstimatesByBid.forEach((est, bidId) => {
        const lineItemData = lineItemMap.get(est.estimateId) || { totalCost: 0, lineItemCount: 0 };
        estimateMap.set(bidId, {
          totalCost: lineItemData.totalCost,
          lineItemCount: lineItemData.lineItemCount,
          status: est.status,
        });
      });

      // Enrich bids with estimate summaries
      const bidsWithEstimates = bidsWithEstimatorNames.map(bid => ({
        ...bid,
        estimateSummary: estimateMap.get(bid.id) || null,
      }));

      res.json(bidsWithEstimates);
    } catch (error) {
      console.error("Get bids error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get bid by code
  app.get("/api/bids/:code", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      res.json(bid);
    } catch (error) {
      console.error("Get bid error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create bid schema with date preprocessing - code is now optional (auto-generated)
  const createBidSchema = insertBidSchema.omit({ code: true }).extend({
    dueDate: z.preprocess(
      (val) => {
        if (!val) return undefined;
        return typeof val === "string" ? new Date(val) : val;
      },
      z.date().nullish()
    ),
  });

  // Helper function to generate next bid/project code starting at 260001
  // Uses SQL aggregation for efficiency - O(1) instead of O(n) table scans
  const BID_CODE_START = 260001;
  async function getNextBidCode(): Promise<string> {
    // Use SQL to find max numeric codes efficiently using GREATEST and regex filtering
    // This query casts codes to integers only if they are purely numeric, avoiding errors
    const result = await db.execute(sql`
      SELECT GREATEST(
        COALESCE((
          SELECT MAX(CAST(code AS INTEGER))
          FROM bids 
          WHERE code ~ '^[0-9]+$' 
          AND CAST(code AS INTEGER) >= ${BID_CODE_START}
        ), ${BID_CODE_START - 1}),
        COALESCE((
          SELECT MAX(CAST(code AS INTEGER))
          FROM projects 
          WHERE code ~ '^[0-9]+$' 
          AND CAST(code AS INTEGER) >= ${BID_CODE_START}
        ), ${BID_CODE_START - 1})
      ) as max_code
    `);
    
    const maxCode = Number(result.rows[0]?.max_code) || BID_CODE_START - 1;
    return String(maxCode + 1);
  }

  // Create bid (Admin/Manager/Estimator) - code is auto-generated with retry logic
  app.post("/api/bids", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      console.log("[Create Bid] Received body:", JSON.stringify(req.body, null, 2));

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        clientName: sanitizeShortText(req.body.clientName),
        description: sanitizeText(req.body.description),
      };

      console.log("[Create Bid] Sanitized body:", JSON.stringify(sanitizedBody, null, 2));

      const validationResult = createBidSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        console.log("[Create Bid] Validation failed:", JSON.stringify(validationResult.error.errors, null, 2));
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Validate monetary amounts
      if (validationResult.data.bidAmount !== undefined) {
        const amountCheck = validateMonetaryAmount(validationResult.data.bidAmount, "Bid amount");
        if (!amountCheck.valid) {
          res.status(400).json({ error: amountCheck.error });
          return;
        }
      }

      // Auto-generate the next bid code with retry logic for concurrent creates
      const MAX_RETRIES = 3;
      let lastError: any = null;
      
      // Get the user's organization ID to assign to the bid
      const userOrgId = req.user?.organizationId;
      
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const nextCode = await getNextBidCode();
          console.log(`[Create Bid] Auto-assigned code: ${nextCode} (attempt ${attempt + 1})`);

          const [newBid] = await db.insert(bids).values({
            ...validationResult.data,
            code: nextCode,
            // Always use user's organization for filtering - gcOrganizationId from form is the CRM client
            gcOrganizationId: userOrgId || validationResult.data.gcOrganizationId,
          }).returning();
          res.status(201).json(newBid);
          return;
        } catch (insertError: any) {
          if (insertError.code === '23505' && attempt < MAX_RETRIES - 1) {
            // Unique constraint violation - retry with a new code
            console.log(`[Create Bid] Code conflict, retrying... (attempt ${attempt + 1})`);
            lastError = insertError;
            continue;
          }
          throw insertError;
        }
      }
      
      // If we get here, all retries failed
      throw lastError;
    } catch (error: any) {
      console.error("Create bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Unable to generate unique bid code - please try again" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update bid schema with date preprocessing to handle JSON-serialized dates
  const updateBidSchema = insertBidSchema.extend({
    // Preprocess dueDate to accept ISO strings from JSON and convert to Date
    dueDate: z.preprocess(
      (val) => typeof val === "string" ? new Date(val) : val,
      z.date().nullish()
    ),
  }).partial();

  // Update bid (Admin/Manager/Estimator)
  app.patch("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      // Get existing bid for audit logging
      const [existingBid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!existingBid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, existingBid.gcOrganizationId)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
        clientName: req.body.clientName ? sanitizeShortText(req.body.clientName) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = updateBidSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Validate monetary amounts
      if (validationResult.data.bidAmount !== undefined) {
        const amountCheck = validateMonetaryAmount(validationResult.data.bidAmount, "Bid amount");
        if (!amountCheck.valid) {
          res.status(400).json({ error: amountCheck.error });
          return;
        }
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedBid] = await db
        .update(bids)
        .set(updateData)
        .where(eq(bids.code, req.params.code))
        .returning();

      if (!updatedBid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      // Audit log (pass raw objects, not JSON.stringify)
      await logUpdate(req.user!.id, "BID", updatedBid.id, existingBid, updateData, req);

      res.json(updatedBid);
    } catch (error: any) {
      console.error("Update bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Bid code already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete bid (Admin/Manager only) - with dependency checks
  app.delete("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // First, find the bid
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // Check if bid has been converted to a project
      const [existingProject] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, bid.code))
        .limit(1);
      
      if (existingProject) {
        res.status(409).json({ 
          error: "Cannot delete converted bid",
          newValue: `This bid has been converted to project ${bid.code}. Delete the project first if needed.`
        });
        return;
      }

      // Delete related records first (cascade manually for proper cleanup)
      // Delete handoff packets
      await db.delete(handoffPackets).where(eq(handoffPackets.bidId, bid.id));
      
      // Delete subcontractor quotes
      await db.delete(bidSubcontractorQuotes).where(eq(bidSubcontractorQuotes.bidId, bid.id));
      
      // Delete material quotes
      await db.delete(bidMaterialQuotes).where(eq(bidMaterialQuotes.bidId, bid.id));
      
      // Delete estimate line items first, then estimates
      const bidEstimates = await db.select().from(estimates).where(eq(estimates.bidId, bid.id));
      for (const estimate of bidEstimates) {
        await db.delete(estimateLineItems).where(eq(estimateLineItems.estimateId, estimate.id));
      }
      await db.delete(estimates).where(eq(estimates.bidId, bid.id));

      // Now delete the bid
      const [deletedBid] = await db
        .delete(bids)
        .where(eq(bids.code, req.params.code))
        .returning();

      // Audit log
      await logDelete(req.user!.id, "bids", bid.id, { code: bid.code, name: bid.name }, req);

      res.json({ success: true, message: `Bid ${bid.code} deleted successfully` });
    } catch (error) {
      console.error("Delete bid error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get estimate for a bid (by bid ID)
  app.get("/api/bids/:id/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      const bidId = req.params.id;
      console.log(`[GET /api/bids/:id/estimate] Fetching estimate for bid ID: ${bidId}`);
      
      // Verify bid exists
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // Find active estimate (APPROVED or latest DRAFT)
      const bidEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.bidId, bidId))
        .orderBy(desc(estimates.versionNumber));
      
      if (bidEstimates.length === 0) {
        res.json({ estimate: null });
        return;
      }
      
      // Use approved estimate if available, otherwise most recent
      const activeEstimate = bidEstimates.find(e => e.status === "APPROVED") || bidEstimates[0];
      
      // Get line items for the active estimate
      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, activeEstimate.id));
      
      // Calculate totals from line items
      const totals = lineItems.reduce((acc, item) => ({
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        laborHours: acc.laborHours + Number(item.laborHours || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      }), {
        materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
        consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
        profitAllocation: 0, totalCost: 0,
      });
      
      res.json({
        estimate: {
          ...activeEstimate,
          lineItems,
          totals,
        }
      });
    } catch (error) {
      console.error("Get bid estimate error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create estimate for a bid (by bid ID)
  app.post("/api/bids/:id/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const bidId = req.params.id;
      console.log(`[POST /api/bids/:id/estimate] Creating estimate for bid ID: ${bidId}`);
      
      // Verify bid exists
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // Check if estimate already exists for this bid
      const existingEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.bidId, bidId))
        .limit(1);
      
      if (existingEstimates.length > 0) {
        // Return existing estimate
        const estimate = existingEstimates[0];
        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, estimate.id));
        
        const totals = lineItems.reduce((acc, item) => ({
          materialCost: acc.materialCost + Number(item.materialCost || 0),
          laborCost: acc.laborCost + Number(item.laborCost || 0),
          laborHours: acc.laborHours + Number(item.laborHours || 0),
          equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
          consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
          subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
          overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
          profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
          totalCost: acc.totalCost + Number(item.totalCost || 0),
        }), {
          materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
          consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
          profitAllocation: 0, totalCost: 0,
        });
        
        res.json({ estimate: { ...estimate, lineItems, totals } });
        return;
      }
      
      // Create new estimate with bidId properly set
      const [newEstimate] = await db.insert(estimates).values({
        bidId: bidId,  // CRITICAL: Set the bidId so estimate transfers during bid-to-project conversion
        createdById: req.user!.id,
        status: "DRAFT",
        versionNumber: 1,
      }).returning();
      
      console.log(`[Estimate Created] New estimate ${newEstimate.id} created for bid ${bidId}`);
      
      res.status(201).json({
        estimate: {
          ...newEstimate,
          lineItems: [],
          totals: {
            materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
            consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
            profitAllocation: 0, totalCost: 0,
          }
        }
      });
    } catch (error) {
      console.error("Create bid estimate error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Convert bid to project (Admin/Manager/Estimator)
  app.post("/api/bids/:code/convert", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // Check if bid has already been awarded/converted
      if (bid.status === "AWARDED") {
        res.status(409).json({ 
          error: "Bid already awarded",
          newValue: `This bid has already been converted to a project.`
        });
        return;
      }

      // BUSINESS VALIDATION: Check if project with same code already exists
      const [existingProject] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, bid.code))
        .limit(1);

      if (existingProject) {
        res.status(409).json({ 
          error: "Project with this code already exists",
          newValue: `A project with code ${bid.code} already exists. Cannot convert bid.`
        });
        return;
      }

      // NOTE: Neon HTTP driver doesn't support transactions in serverless environments
      // Sequential operations with error handling (not atomic)
      
      // Get bid estimates FIRST to calculate budget if needed
      const bidEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.bidId, bid.id));

      console.log(`[Bid Conversion] Found ${bidEstimates.length} estimates to transfer`);

      // Calculate budget (direct costs) and contract amount (with overhead+profit) from estimate
      // Default markup percentages
      const OVERHEAD_PERCENT = 10;
      const PROFIT_MARGIN_PERCENT = 15;
      
      let directCostBudget = "0";
      let contractAmount = bid.bidAmount || "0";
      
      if (bidEstimates.length > 0) {
        // Find approved estimate or most recent one
        const activeEstimate = bidEstimates.find(e => e.status === "APPROVED") || bidEstimates[0];
        
        if (activeEstimate) {
          // Get line items and calculate DIRECT COSTS (cost to do the job)
          const lineItems = await db
            .select()
            .from(estimateLineItems)
            .where(eq(estimateLineItems.estimateId, activeEstimate.id));
          
          // Budget = sum of direct costs (material + labor + equipment + consumables + subcontract)
          const totalDirectCost = lineItems.reduce((sum, item) => {
            const materialCost = Number(item.materialCost || 0);
            const laborCost = Number(item.laborCost || 0);
            const equipmentCost = Number(item.equipmentCost || 0);
            const consumablesCost = Number(item.consumablesCost || 0);
            const subcontractCost = Number(item.subcontractCost || 0);
            return sum + materialCost + laborCost + equipmentCost + consumablesCost + subcontractCost;
          }, 0);
          
          if (totalDirectCost > 0) {
            directCostBudget = totalDirectCost.toFixed(2);
            
            // Contract Amount = Direct Cost + Overhead + Profit
            // Overhead = Direct Cost × overhead%
            // Profit = (Direct Cost + Overhead) × profit%
            const overhead = totalDirectCost * (OVERHEAD_PERCENT / 100);
            const profit = (totalDirectCost + overhead) * (PROFIT_MARGIN_PERCENT / 100);
            const totalContract = totalDirectCost + overhead + profit;
            
            // Only override bid.bidAmount if it wasn't set
            if (!bid.bidAmount) {
              contractAmount = totalContract.toFixed(2);
            }
            
            console.log(`[Bid Conversion] Budget (direct costs): $${directCostBudget}`);
            console.log(`[Bid Conversion] Contract amount (with ${OVERHEAD_PERCENT}% overhead + ${PROFIT_MARGIN_PERCENT}% profit): $${contractAmount}`);
          }
        }
      }
      
      // Get superintendent and project manager from request body (optional)
      const { superintendentId, projectManagerId } = req.body || {};
      
      // Create project from bid data - set to ACTIVE since bid was awarded
      const [newProject] = await db.insert(projects).values({
        name: bid.name,
        code: bid.code,
        clientName: bid.clientName,
        clientContactName: bid.clientContactName,
        clientContactEmail: bid.clientContactEmail,
        clientContactPhone: bid.clientContactPhone,
        status: "ACTIVE",
        locationAddress: bid.locationAddress,
        city: bid.city,
        state: bid.state,
        description: bid.description,
        estimatorId: bid.estimatorId,
        superintendentId: superintendentId || null,
        projectManagerId: projectManagerId || null,
        contractAmount: contractAmount,
        budget: directCostBudget,
        gcOrganizationId: bid.gcOrganizationId, // Copy organization from bid
      }).returning();

      for (const estimate of bidEstimates) {
        // Update estimate to reference project (keep bidId for traceability)
        await db
          .update(estimates)
          .set({ projectId: newProject.id })
          .where(eq(estimates.id, estimate.id));

        // Get estimate line items for scope of work sync
        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, estimate.id));

        console.log(`[Bid Conversion] Syncing ${lineItems.length} line items to scope of work`);

        // Create scope items from estimate line items
        const { projectMaterialBudgets } = await import("@shared/schema");
        
        for (const lineItem of lineItems) {
          // Check if scope item already exists for this line item
          const existingScopeItem = await db.query.scopeItems.findFirst({
            where: eq(scopeItems.estimateLineItemId, lineItem.id),
          });

          if (!existingScopeItem) {
            // Create new scope item linked to estimate line item
            // Copy estimated material quantities from estimate for variance tracking
            const lineItemAny = lineItem as any;
            const [newScopeItem] = await db.insert(scopeItems).values({
              projectId: newProject.id,
              estimateLineItemId: lineItem.id,
              // Unified SOW Tracking: propagate organizationSowItemId for production rate tracking
              organizationSowItemId: lineItemAny.organizationSowItemId || null,
              subcontractorQuoteId: lineItemAny.subcontractorQuoteId || null,
              description: lineItem.description,
              unit: lineItem.unit,
              totalQuantity: lineItem.quantity,
              unitPrice: lineItem.totalCost ? 
                (Number(lineItem.totalCost) / Number(lineItem.quantity)).toFixed(2) : 
                null,
              // Copy estimated material quantities for variance tracking
              estimatedConcreteYards: lineItemAny.calculatedConcreteYards || null,
              estimatedStoneTons: lineItemAny.calculatedStoneTons || null,
              estimatedExcavationYards: lineItemAny.calculatedExcavationYards || null,
              // Set initial material responsibility based on subcontractor assignment
              materialResponsibility: lineItemAny.subcontractorQuoteId ? "SUBCONTRACTOR" : "TFR",
            }).returning();

            // Create material budget snapshot from estimate line item
            // This captures the "bid material quantities" for variance tracking
            const materialCost = Number(lineItem.materialCost || 0);
            const quantity = Number(lineItem.quantity || 0);
            
            if (materialCost > 0 && quantity > 0) {
              const unitCost = materialCost / quantity;
              await db.insert(projectMaterialBudgets).values({
                projectId: newProject.id,
                scopeItemId: newScopeItem.id,
                estimateLineItemId: lineItem.id,
                description: lineItem.description,
                unit: lineItem.unit,
                budgetedQuantity: lineItem.quantity,
                budgetedUnitCost: unitCost.toFixed(2),
                budgetedTotalCost: materialCost.toFixed(2),
              });
            }
          }
        }
        
        console.log(`[Bid Conversion] Created material budgets for project ${newProject.code}`);
      }

      // Transfer ALL subcontractor quotes to project (preserving for later selection)
      const { bidSubcontractorQuotes: subQuotesTable } = await import("@shared/schema");
      const { subcontractors, subcontractorContracts } = await import("@shared/schema");
      const { and } = await import("drizzle-orm");
      
      // Get all quotes for this bid
      const allSubQuotes = await db
        .select()
        .from(subQuotesTable)
        .where(eq(subQuotesTable.bidId, bid.id));
      
      // Update ALL quotes with projectId (preserving them for later selection on project page)
      if (allSubQuotes.length > 0) {
        await db
          .update(subQuotesTable)
          .set({ projectId: newProject.id })
          .where(eq(subQuotesTable.bidId, bid.id));
      }
      
      // Filter to get only selected quotes for contract creation
      const subQuotes = allSubQuotes.filter(q => q.isSelected);
      const pendingSubQuotes = allSubQuotes.filter(q => !q.isSelected);

      console.log(`[Bid Conversion] Transferred ${allSubQuotes.length} subcontractor quotes to project (${subQuotes.length} selected, ${pendingSubQuotes.length} pending)`);

      for (const quote of subQuotes) {
        // Find or create subcontractor record with improved matching
        // Match by company name AND (email OR phone) to avoid duplicates
        let subcontractor;
        if (quote.contactEmail || quote.contactPhone) {
          // Try to find by name + contact info
          const { or, and } = await import("drizzle-orm");
          const contactConditions = [];
          if (quote.contactEmail) {
            contactConditions.push(eq(subcontractors.email, quote.contactEmail));
          }
          if (quote.contactPhone) {
            contactConditions.push(eq(subcontractors.phone, quote.contactPhone));
          }
          
          subcontractor = await db.query.subcontractors.findFirst({
            where: and(
              eq(subcontractors.companyName, quote.subcontractorName),
              or(...contactConditions)
            ),
          });
        }
        
        if (!subcontractor) {
          // Fallback: try matching by name only
          subcontractor = await db.query.subcontractors.findFirst({
            where: eq(subcontractors.companyName, quote.subcontractorName),
          });
        }

        if (!subcontractor) {
          // Create new subcontractor record
          [subcontractor] = await db.insert(subcontractors).values({
            companyName: quote.subcontractorName,
            contactName: quote.contactName || null,
            email: quote.contactEmail || null,
            phone: quote.contactPhone || null,
            notes: quote.notes || null,
            isActive: true,
          }).returning();
        }

        // Create subcontractor contract from quote with validated field lengths
        const contractNumber = `SC-${newProject.code}-${String(subQuotes.indexOf(quote) + 1).padStart(3, '0')}`;
        const paymentTerms = quote.leadTime ? `Lead Time: ${quote.leadTime}`.substring(0, 500) : null;
        
        // Build comprehensive notes with all quote details
        const notesParts: string[] = [];
        if (quote.estimatedCompletionTime) notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
        if (quote.notes) notesParts.push(quote.notes);
        if (quote.fileUrl) {
          // Sanitize file name to prevent newline injection
          const sanitizedFileName = (quote.fileName || 'Document').replace(/[\r\n]/g, ' ').trim();
          notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
        }
        
        const notes = notesParts.length > 0 ? notesParts.join('\n').substring(0, 1000) : null;
        
        await db.insert(subcontractorContracts).values({
          subcontractorId: subcontractor.id,
          projectId: newProject.id,
          contractNumber,
          scopeOfWork: quote.scopeOfWork,
          contractAmount: quote.quoteAmount,
          status: "PENDING",
          paymentTerms,
          notes,
          createdById: req.user!.id,
        });
      }

      // Transfer ALL material quotes to project (preserving for later selection)
      const { bidMaterialQuotes: matQuotesTable } = await import("@shared/schema");
      const { procurementItems } = await import("@shared/schema");
      
      // Get all material quotes for this bid
      const allMatQuotes = await db
        .select()
        .from(matQuotesTable)
        .where(eq(matQuotesTable.bidId, bid.id));
      
      // Update ALL material quotes with projectId (preserving them for later selection on project page)
      if (allMatQuotes.length > 0) {
        await db
          .update(matQuotesTable)
          .set({ projectId: newProject.id })
          .where(eq(matQuotesTable.bidId, bid.id));
      }
      
      // Filter to get only selected quotes for procurement creation
      const matQuotes = allMatQuotes.filter(q => q.isSelected);
      const pendingMatQuotes = allMatQuotes.filter(q => !q.isSelected);

      console.log(`[Bid Conversion] Transferred ${allMatQuotes.length} material quotes to project (${matQuotes.length} selected, ${pendingMatQuotes.length} pending)`);

      for (const quote of matQuotes) {
        // Build comprehensive description with all quote details
        let fullDescription = quote.materialName;
        if (quote.specs) fullDescription += ` - ${quote.specs}`;
        if (quote.description) fullDescription += `\n${quote.description}`;
        
        // Preserve lead time and supplier contact in description for visibility
        const additionalInfo: string[] = [];
        if (quote.leadTime) additionalInfo.push(`Lead Time: ${quote.leadTime}`);
        if (quote.supplierContact) additionalInfo.push(`Supplier Contact: ${quote.supplierContact}`);
        
        if (additionalInfo.length > 0) {
          fullDescription += `\n\n[Quote Details]\n${additionalInfo.join('\n')}`;
        }
        
        // Create procurement item from material quote
        await db.insert(procurementItems).values({
          projectId: newProject.id,
          description: fullDescription,
          vendor: quote.supplierName || null,
          quantity: "1", // Material quotes typically represent a full order
          unit: "LOT",
          unitCost: quote.cost,
          status: "PLANNED",
          neededByDate: null,
        });
      }

      // Transfer handoff packet to project if it exists
      const { handoffPackets: handoffTable } = await import("@shared/schema");
      const [existingPacket] = await db
        .select()
        .from(handoffTable)
        .where(eq(handoffTable.bidId, bid.id))
        .limit(1);
      
      if (existingPacket) {
        // Update handoff packet to reference project (keep bidId for traceability)
        await db
          .update(handoffTable)
          .set({ 
            projectId: newProject.id,
            awardDate: new Date().toISOString().split('T')[0], // Set award date to today
            updatedAt: new Date()
          })
          .where(eq(handoffTable.id, existingPacket.id));
        
        console.log(`[Bid Conversion] Transferred handoff packet to project`);
      }

      // Transfer equipment selections to project equipment plans
      const { bidEquipmentSelections: equipSelectionsTable, projectEquipmentPlans: equipPlansTable } = await import("@shared/schema");
      
      const bidEquipmentSelections = await db
        .select()
        .from(equipSelectionsTable)
        .where(eq(equipSelectionsTable.bidId, bid.id));
      
      if (bidEquipmentSelections.length > 0) {
        for (const selection of bidEquipmentSelections) {
          await db.insert(equipPlansTable).values({
            projectId: newProject.id,
            bidEquipmentSelectionId: selection.id,
            source: selection.source,
            status: "PLANNED",
            equipmentId: selection.equipmentId,
            rentalCatalogId: selection.rentalCatalogId,
            rentalVendorId: selection.rentalVendorId,
            equipmentName: selection.equipmentName,
            equipmentType: selection.equipmentType,
            plannedHours: selection.plannedHours,
            plannedDays: selection.plannedDays,
            plannedStartDate: selection.startDate,
            plannedEndDate: selection.endDate,
            plannedCost: selection.estimatedCost,
            hourlyRate: selection.hourlyRate,
            dailyRate: selection.dailyRate,
            notes: selection.notes,
            createdById: req.user!.id,
          });
        }
        console.log(`[Bid Conversion] Transferred ${bidEquipmentSelections.length} equipment selections to project equipment plans`);
      }

      // Mark bid as AWARDED and link to the converted project (instead of deleting)
      await db.update(bids)
        .set({
          status: "AWARDED",
          convertedToProjectId: newProject.id,
          awardedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bids.code, req.params.code));

      // Create PROJECT_ASSIGNMENT notifications for superintendent and project manager
      const { notifications: notificationsTable } = await import("@shared/schema");
      
      if (superintendentId) {
        await db.insert(notificationsTable).values({
          userId: superintendentId,
          type: "PROJECT_ASSIGNMENT",
          title: "New Project Assignment",
          message: `You have been assigned as Superintendent for project "${newProject.name}" (${newProject.code})`,
          relatedEntityId: newProject.id,
          relatedEntityType: "project",
        });
        console.log(`[Bid Conversion] Created PROJECT_ASSIGNMENT notification for superintendent ${superintendentId}`);
      }
      
      if (projectManagerId) {
        await db.insert(notificationsTable).values({
          userId: projectManagerId,
          type: "PROJECT_ASSIGNMENT",
          title: "New Project Assignment",
          message: `You have been assigned as Project Manager for project "${newProject.name}" (${newProject.code})`,
          relatedEntityId: newProject.id,
          relatedEntityType: "project",
        });
        console.log(`[Bid Conversion] Created PROJECT_ASSIGNMENT notification for project manager ${projectManagerId}`);
      }

      // Log audit (best effort)
      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "project",
        entityId: newProject.id,
        newValue: `Converted bid ${bid.code} to project with ${bidEstimates.length} estimates, ${subQuotes.length} selected subcontractor quotes, ${matQuotes.length} selected material quotes, and ${bidEquipmentSelections.length} equipment plans`,
      }, req);

      res.status(201).json(newProject);
    } catch (error: any) {
      console.error("Convert bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Project with this code already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // ====================
  // Bid Subcontractor Quotes Routes
  // ====================

  const { bidSubcontractorQuotes, insertBidSubcontractorQuoteSchema } = await import("@shared/schema");

  // Get all quotes for a bid
  app.get("/api/bids/:code/quotes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      const quotes = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.bidId, bid.id))
        .orderBy(desc(bidSubcontractorQuotes.createdAt));

      res.json(quotes);
    } catch (error) {
      console.error("Get bid quotes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new quote for a bid
  app.post("/api/bids/:code/quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        subcontractorName: sanitizeShortText(req.body.subcontractorName),
        scopeOfWork: sanitizeText(req.body.scopeOfWork),
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
        contactName: req.body.contactName ? sanitizeShortText(req.body.contactName) : undefined,
        contactEmail: req.body.contactEmail ? sanitizeEmail(req.body.contactEmail) : undefined,
        contactPhone: req.body.contactPhone ? sanitizePhone(req.body.contactPhone) : undefined,
      };

      const validated = insertBidSubcontractorQuoteSchema.parse({
        ...sanitizedBody,
        bidId: bid.id,
      });

      const [newQuote] = await db.insert(bidSubcontractorQuotes).values(validated).returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "CREATE_BID_QUOTE",
        entityType: "bid_quote",
        entityId: newQuote.id,
        newValue: `Created quote from ${validated.subcontractorName} for bid ${bid.code}`,
      }, req);

      res.status(201).json(newQuote);
    } catch (error: any) {
      console.error("Create bid quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update a bid quote
  app.patch("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody: any = {
        subcontractorName: req.body.subcontractorName ? sanitizeShortText(req.body.subcontractorName) : undefined,
        scopeOfWork: req.body.scopeOfWork ? sanitizeText(req.body.scopeOfWork) : undefined,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
        contactName: req.body.contactName ? sanitizeShortText(req.body.contactName) : undefined,
        contactEmail: req.body.contactEmail ? sanitizeEmail(req.body.contactEmail) : undefined,
        contactPhone: req.body.contactPhone ? sanitizePhone(req.body.contactPhone) : undefined,
        leadTime: req.body.leadTime !== undefined ? req.body.leadTime : undefined,
        estimatedCompletionTime: req.body.estimatedCompletionTime !== undefined ? req.body.estimatedCompletionTime : undefined,
        quoteAmount: req.body.quoteAmount !== undefined ? req.body.quoteAmount : undefined,
        fileUrl: req.body.fileUrl !== undefined ? req.body.fileUrl : undefined,
        fileName: req.body.fileName !== undefined ? req.body.fileName : undefined,
      };
      
      // Handle isSelected field directly (boolean, doesn't need sanitization)
      if (typeof req.body.isSelected === 'boolean') {
        sanitizedBody.isSelected = req.body.isSelected;
      }
      
      // Remove undefined keys
      Object.keys(sanitizedBody).forEach(key => {
        if (sanitizedBody[key] === undefined) {
          delete sanitizedBody[key];
        }
      });

      const validated = sanitizedBody;

      // SECURITY: Verify quote belongs to this bid (prevent parameter spoofing)
      const [existing] = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

      if (existing.bidId !== bid.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const [updated] = await db
        .update(bidSubcontractorQuotes)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE_BID_QUOTE",
        entityType: "bid_quote",
        entityId: updated.id,
        newValue: `Updated quote from ${updated.subcontractorName} for bid ${bid.code}`,
      }, req);

      res.json(updated);
    } catch (error: any) {
      console.error("Update bid quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete a bid quote
  app.delete("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // SECURITY: Verify quote belongs to this bid (prevent parameter spoofing)
      const [existing] = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

      if (existing.bidId !== bid.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const [deleted] = await db
        .delete(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "DELETE_BID_QUOTE",
        entityType: "bid_quote",
        entityId: deleted.id,
        oldValue: `Deleted quote from ${deleted.subcontractorName} for bid ${bid.code}`,
      }, req);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete bid quote error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Bid Material Quotes Routes
  // ====================

  const { bidMaterialQuotes, insertBidMaterialQuoteSchema } = await import("@shared/schema");

  // Get all material quotes for a bid
  app.get("/api/bids/:code/material-quotes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      const materialQuotes = await db
        .select()
        .from(bidMaterialQuotes)
        .where(eq(bidMaterialQuotes.bidId, bid.id))
        .orderBy(desc(bidMaterialQuotes.createdAt));

      res.json(materialQuotes);
    } catch (error) {
      console.error("Get bid material quotes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new material quote for a bid
  app.post("/api/bids/:code/material-quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        materialName: sanitizeShortText(req.body.materialName),
        description: req.body.description ? sanitizeText(req.body.description) : "",
        specs: req.body.specs ? sanitizeText(req.body.specs) : undefined,
        leadTime: req.body.leadTime ? sanitizeShortText(req.body.leadTime) : undefined,
        supplierName: req.body.supplierName ? sanitizeShortText(req.body.supplierName) : undefined,
        supplierContact: req.body.supplierContact ? sanitizeText(req.body.supplierContact) : undefined,
      };

      const validated = insertBidMaterialQuoteSchema.parse({
        ...sanitizedBody,
        bidId: bid.id,
      });

      const [newMaterialQuote] = await db.insert(bidMaterialQuotes).values(validated).returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "CREATE_BID_MATERIAL_QUOTE",
        entityType: "bid_material_quote",
        entityId: newMaterialQuote.id,
        newValue: `Created material quote for ${validated.materialName} for bid ${bid.code}`,
      }, req);

      res.status(201).json(newMaterialQuote);
    } catch (error: any) {
      console.error("Create bid material quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid material quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update a bid material quote
  app.patch("/api/bids/:code/material-quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody: any = {
        materialName: req.body.materialName ? sanitizeShortText(req.body.materialName) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
        specs: req.body.specs ? sanitizeText(req.body.specs) : undefined,
        leadTime: req.body.leadTime ? sanitizeShortText(req.body.leadTime) : undefined,
        supplierName: req.body.supplierName ? sanitizeShortText(req.body.supplierName) : undefined,
        supplierContact: req.body.supplierContact ? sanitizeText(req.body.supplierContact) : undefined,
        cost: req.body.cost !== undefined ? req.body.cost : undefined,
        fileUrl: req.body.fileUrl !== undefined ? req.body.fileUrl : undefined,
        fileName: req.body.fileName !== undefined ? req.body.fileName : undefined,
      };
      
      // Handle isSelected field directly (boolean, doesn't need sanitization)
      if (typeof req.body.isSelected === 'boolean') {
        sanitizedBody.isSelected = req.body.isSelected;
      }
      
      // Remove undefined keys
      Object.keys(sanitizedBody).forEach(key => {
        if (sanitizedBody[key] === undefined) {
          delete sanitizedBody[key];
        }
      });

      const validated = sanitizedBody;

      // SECURITY: Verify quote belongs to this bid (prevent parameter spoofing)
      const [existingMQ] = await db
        .select()
        .from(bidMaterialQuotes)
        .where(eq(bidMaterialQuotes.id, req.params.quoteId))
        .limit(1);

      if (!existingMQ) {
        res.status(404).json({ error: "Material quote not found" });
        return;
      }

      if (existingMQ.bidId !== bid.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const [updated] = await db
        .update(bidMaterialQuotes)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(bidMaterialQuotes.id, req.params.quoteId))
        .returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "UPDATE_BID_MATERIAL_QUOTE",
        entityType: "bid_material_quote",
        entityId: updated.id,
        newValue: `Updated material quote for ${updated.materialName} for bid ${bid.code}`,
      }, req);

      res.json(updated);
    } catch (error: any) {
      console.error("Update bid material quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid material quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete a bid material quote
  app.delete("/api/bids/:code/material-quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // SECURITY: Verify quote belongs to this bid (prevent parameter spoofing)
      const [existingMQ] = await db
        .select()
        .from(bidMaterialQuotes)
        .where(eq(bidMaterialQuotes.id, req.params.quoteId))
        .limit(1);

      if (!existingMQ) {
        res.status(404).json({ error: "Material quote not found" });
        return;
      }

      if (existingMQ.bidId !== bid.id) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const [deleted] = await db
        .delete(bidMaterialQuotes)
        .where(eq(bidMaterialQuotes.id, req.params.quoteId))
        .returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "DELETE_BID_MATERIAL_QUOTE",
        entityType: "bid_material_quote",
        entityId: deleted.id,
        oldValue: `Deleted material quote for ${deleted.materialName} for bid ${bid.code}`,
      }, req);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete bid material quote error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Handoff Packet Routes (Job Information for QuickBooks)
  // ====================
  const { handoffPackets, insertHandoffPacketSchema } = await import("@shared/schema");

  // Get handoff packet for a bid (restricted to management roles)
  app.get("/api/bids/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "OFFICE_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      const [packet] = await db
        .select()
        .from(handoffPackets)
        .where(eq(handoffPackets.bidId, bid.id))
        .limit(1);

      res.json(packet || null);
    } catch (error) {
      console.error("Get handoff packet error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create or update handoff packet for a bid
  app.put("/api/bids/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // Check if packet already exists
      const [existing] = await db
        .select()
        .from(handoffPackets)
        .where(eq(handoffPackets.bidId, bid.id))
        .limit(1);

      const packetData = {
        bidId: bid.id,
        gcName: req.body.gcName || null,
        gcContactName: req.body.gcContactName || null,
        gcPhone: req.body.gcPhone || null,
        gcEmail: req.body.gcEmail || null,
        accessDetails: req.body.accessDetails || null,
        scopeOfWorkSummary: req.body.scopeOfWorkSummary || null,
        contractValue: req.body.contractValue || null,
        bidDate: req.body.bidDate || null,
        awardDate: req.body.awardDate || null,
        markupPercent: req.body.markupPercent || null,
        duration: req.body.duration || null,
        projectStartDate: req.body.projectStartDate || null,
        projectCompletionDate: req.body.projectCompletionDate || null,
        manpower: req.body.manpower || null,
        alternates: req.body.alternates || null,
        subcontractExecuted: req.body.subcontractExecuted ?? null,
        insuranceCerts: req.body.insuranceCerts || null,
        bondRequired: req.body.bondRequired ?? null,
        permits: req.body.permits || null,
        retentionPercent: req.body.retentionPercent || null,
        paymentTerms: req.body.paymentTerms || null,
        scheduleOfValuesReady: req.body.scheduleOfValuesReady ?? null,
        drawSchedule: req.body.drawSchedule || null,
        prevailingWage: req.body.prevailingWage ?? null,
        concreteSupplier: req.body.concreteSupplier || null,
        mixInfo: req.body.mixInfo || null,
        rebarVendor: req.body.rebarVendor || null,
        formingMaterialPlan: req.body.formingMaterialPlan || null,
        curingSpecs: req.body.curingSpecs || null,
        specialItems: req.body.specialItems || null,
        leadTimeRisks: req.body.leadTimeRisks || null,
        submittalStatus: req.body.submittalStatus || null,
        layoutSurveyBy: req.body.layoutSurveyBy || null,
        benchmarkInfo: req.body.benchmarkInfo || null,
        accessZones: req.body.accessZones || null,
        workHours: req.body.workHours || null,
        safetyOrientation: req.body.safetyOrientation || null,
        inspectionNeeds: req.body.inspectionNeeds || null,
        coordinationIssues: req.body.coordinationIssues || null,
        weatherRisks: req.body.weatherRisks || null,
        soilConditions: req.body.soilConditions || null,
        estimatorNotes: req.body.estimatorNotes || null,
        gcContactMethod: req.body.gcContactMethod || null,
        projectManager: req.body.projectManager || null,
        superintendent: req.body.superintendent || null,
        officeAdmin: req.body.officeAdmin || null,
        safetyContact: req.body.safetyContact || null,
        createdById: req.user!.id,
        updatedAt: new Date(),
      };

      let result;
      if (existing) {
        [result] = await db
          .update(handoffPackets)
          .set(packetData)
          .where(eq(handoffPackets.id, existing.id))
          .returning();
      } else {
        [result] = await db
          .insert(handoffPackets)
          .values(packetData)
          .returning();
      }

      res.json(result);
    } catch (error) {
      console.error("Save handoff packet error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get handoff packet for a project (restricted to management roles)
  app.get("/api/projects/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "OFFICE_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const [packet] = await db
        .select()
        .from(handoffPackets)
        .where(eq(handoffPackets.projectId, project.id))
        .limit(1);

      res.json(packet || null);
    } catch (error) {
      console.error("Get project handoff packet error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update handoff packet for a project (Admin/Manager/Office Manager, or SUPERINTENDENT if assigned)
  app.put("/api/projects/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // OWNERSHIP CHECK: SUPERINTENDENT can only edit handoff for projects they are assigned to
      const userRole = req.user!.effectiveRole || req.user!.role;
      if (userRole === "SUPERINTENDENT" && project.superintendentId !== req.user!.id) {
        res.status(403).json({ error: "You can only edit handoff packets for projects where you are the assigned superintendent" });
        return;
      }

      const [existing] = await db
        .select()
        .from(handoffPackets)
        .where(eq(handoffPackets.projectId, project.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Handoff packet not found for this project" });
        return;
      }

      // Build update data - only allow editable fields (protect id, bidId, projectId, createdById, createdAt)
      const updateData = {
        gcName: req.body.gcName ?? existing.gcName,
        gcContactName: req.body.gcContactName ?? existing.gcContactName,
        gcPhone: req.body.gcPhone ?? existing.gcPhone,
        gcEmail: req.body.gcEmail ?? existing.gcEmail,
        accessDetails: req.body.accessDetails ?? existing.accessDetails,
        scopeOfWorkSummary: req.body.scopeOfWorkSummary ?? existing.scopeOfWorkSummary,
        contractValue: req.body.contractValue ?? existing.contractValue,
        bidDate: req.body.bidDate ?? existing.bidDate,
        awardDate: req.body.awardDate ?? existing.awardDate,
        markupPercent: req.body.markupPercent ?? existing.markupPercent,
        duration: req.body.duration ?? existing.duration,
        projectStartDate: req.body.projectStartDate ?? existing.projectStartDate,
        projectCompletionDate: req.body.projectCompletionDate ?? existing.projectCompletionDate,
        manpower: req.body.manpower ?? existing.manpower,
        alternates: req.body.alternates ?? existing.alternates,
        subcontractExecuted: req.body.subcontractExecuted ?? existing.subcontractExecuted,
        insuranceCerts: req.body.insuranceCerts ?? existing.insuranceCerts,
        bondRequired: req.body.bondRequired ?? existing.bondRequired,
        permits: req.body.permits ?? existing.permits,
        retentionPercent: req.body.retentionPercent ?? existing.retentionPercent,
        paymentTerms: req.body.paymentTerms ?? existing.paymentTerms,
        scheduleOfValuesReady: req.body.scheduleOfValuesReady ?? existing.scheduleOfValuesReady,
        drawSchedule: req.body.drawSchedule ?? existing.drawSchedule,
        prevailingWage: req.body.prevailingWage ?? existing.prevailingWage,
        concreteSupplier: req.body.concreteSupplier ?? existing.concreteSupplier,
        mixInfo: req.body.mixInfo ?? existing.mixInfo,
        rebarVendor: req.body.rebarVendor ?? existing.rebarVendor,
        formingMaterialPlan: req.body.formingMaterialPlan ?? existing.formingMaterialPlan,
        curingSpecs: req.body.curingSpecs ?? existing.curingSpecs,
        specialItems: req.body.specialItems ?? existing.specialItems,
        leadTimeRisks: req.body.leadTimeRisks ?? existing.leadTimeRisks,
        submittalStatus: req.body.submittalStatus ?? existing.submittalStatus,
        layoutSurveyBy: req.body.layoutSurveyBy ?? existing.layoutSurveyBy,
        benchmarkInfo: req.body.benchmarkInfo ?? existing.benchmarkInfo,
        accessZones: req.body.accessZones ?? existing.accessZones,
        workHours: req.body.workHours ?? existing.workHours,
        safetyOrientation: req.body.safetyOrientation ?? existing.safetyOrientation,
        inspectionNeeds: req.body.inspectionNeeds ?? existing.inspectionNeeds,
        coordinationIssues: req.body.coordinationIssues ?? existing.coordinationIssues,
        weatherRisks: req.body.weatherRisks ?? existing.weatherRisks,
        soilConditions: req.body.soilConditions ?? existing.soilConditions,
        estimatorNotes: req.body.estimatorNotes ?? existing.estimatorNotes,
        gcContactMethod: req.body.gcContactMethod ?? existing.gcContactMethod,
        projectManager: req.body.projectManager ?? existing.projectManager,
        superintendent: req.body.superintendent ?? existing.superintendent,
        officeAdmin: req.body.officeAdmin ?? existing.officeAdmin,
        safetyContact: req.body.safetyContact ?? existing.safetyContact,
        updatedAt: new Date(),
      };

      const [result] = await db
        .update(handoffPackets)
        .set(updateData)
        .where(eq(handoffPackets.id, existing.id))
        .returning();

      res.json(result);
    } catch (error) {
      console.error("Update project handoff packet error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Bid PDF Generation Routes
  // ====================

  // Generate Internal Bid Summary PDF
  app.get("/api/bids/:code/pdf/internal-summary", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // Get estimate and line items
      const [estimate] = await db
        .select()
        .from(estimates)
        .where(eq(estimates.bidId, bid.id))
        .limit(1);

      let lineItems: any[] = [];
      if (estimate) {
        lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, estimate.id));
      }

      // Get quotes
      const subQuotes = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.bidId, bid.id));

      const materialQuotes = await db
        .select()
        .from(bidMaterialQuotes)
        .where(eq(bidMaterialQuotes.bidId, bid.id));

      const equipmentSelections = await db
        .select()
        .from(bidEquipmentSelections)
        .where(eq(bidEquipmentSelections.bidId, bid.id));

      // Transform data for PDF
      const scopeItems = lineItems.map(item => ({
        description: item.description,
        category: item.category,
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit,
        totalCost: parseFloat(item.totalCost) || 0,
        laborCost: parseFloat(item.laborCost) || 0,
        materialCost: parseFloat(item.materialCost) || 0,
        equipmentCost: parseFloat(item.equipmentCost) || 0,
        subcontractCost: parseFloat(item.subcontractCost) || 0,
      }));

      // Calculate totals
      const totalDirectCost = scopeItems.reduce((sum, item) => sum + item.totalCost, 0);
      const selectedMaterialCost = materialQuotes
        .filter(q => q.isSelected)
        .reduce((sum, q) => sum + parseFloat(q.cost as any), 0);
      const selectedSubCost = subQuotes
        .filter(q => q.isSelected)
        .reduce((sum, q) => sum + parseFloat(q.quoteAmount as any), 0);
      const equipmentCost = equipmentSelections.reduce((sum, eq) => sum + (parseFloat(eq.estimatedCost as any) || 0), 0);

      const baseCost = totalDirectCost + selectedMaterialCost + selectedSubCost + equipmentCost;
      const overheadPercent = 15;
      const profitPercent = 10;
      const overheadAmount = baseCost * (overheadPercent / 100);
      const profitAmount = baseCost * (profitPercent / 100);
      const finalBidAmount = baseCost + overheadAmount + profitAmount;

      const pdfData = {
        bid: {
          id: bid.id,
          name: bid.name,
          code: bid.code,
          clientName: bid.clientName,
          clientContactName: bid.clientContactName,
          clientContactEmail: bid.clientContactEmail,
          clientContactPhone: bid.clientContactPhone,
          locationAddress: bid.locationAddress,
          city: bid.city,
          state: bid.state,
          description: bid.description,
          bidAmount: parseFloat(bid.bidAmount as any) || null,
          dueDate: bid.dueDate,
        },
        scopeItems,
        subQuotes: subQuotes.map(q => ({
          subcontractorName: q.subcontractorName,
          scopeOfWork: q.scopeOfWork,
          quoteAmount: parseFloat(q.quoteAmount as any),
          isSelected: q.isSelected,
        })),
        materialQuotes: materialQuotes.map(q => ({
          materialName: q.materialName,
          description: q.description,
          cost: parseFloat(q.cost as any),
          supplierName: q.supplierName,
          isSelected: q.isSelected,
        })),
        equipmentSelections: equipmentSelections.map(eq => ({
          equipmentName: eq.equipmentName,
          equipmentType: eq.equipmentType,
          source: eq.source,
          plannedDays: eq.plannedDays,
          plannedHours: parseFloat(eq.plannedHours as any) || null,
          estimatedCost: parseFloat(eq.estimatedCost as any) || null,
        })),
        summary: {
          totalDirectCost: baseCost,
          overheadPercent,
          overheadAmount,
          profitPercent,
          profitAmount,
          finalBidAmount,
        },
      };

      const pdfStream = generateInternalBidSummaryPDF(pdfData);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="SmartManageAI-Internal-Summary-${bid.code}.pdf"`);

      pdfStream.pipe(res);
    } catch (error) {
      console.error("Generate internal bid summary PDF error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Generate Customer Quote PDF
  app.get("/api/bids/:code/pdf/customer-quote", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

      // Get estimate and line items
      const [estimate] = await db
        .select()
        .from(estimates)
        .where(eq(estimates.bidId, bid.id))
        .limit(1);

      let lineItems: any[] = [];
      if (estimate) {
        lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, estimate.id));
      }

      // Transform scope items for customer quote (simplified view)
      const scopeItems = lineItems.map(item => ({
        description: item.description,
        category: item.category,
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit,
        totalCost: parseFloat(item.totalCost) || 0,
        laborCost: parseFloat(item.laborCost) || 0,
        materialCost: parseFloat(item.materialCost) || 0,
        equipmentCost: parseFloat(item.equipmentCost) || 0,
        subcontractCost: parseFloat(item.subcontractCost) || 0,
      }));

      // Calculate totals
      const totalDirectCost = scopeItems.reduce((sum, item) => sum + item.totalCost, 0);
      const overheadPercent = 15;
      const profitPercent = 10;
      const overheadAmount = totalDirectCost * (overheadPercent / 100);
      const profitAmount = totalDirectCost * (profitPercent / 100);
      const finalBidAmount = parseFloat(bid.bidAmount as any) || (totalDirectCost + overheadAmount + profitAmount);

      const pdfData = {
        bid: {
          id: bid.id,
          name: bid.name,
          code: bid.code,
          clientName: bid.clientName,
          clientContactName: bid.clientContactName,
          clientContactEmail: bid.clientContactEmail,
          clientContactPhone: bid.clientContactPhone,
          locationAddress: bid.locationAddress,
          city: bid.city,
          state: bid.state,
          description: bid.description,
          bidAmount: parseFloat(bid.bidAmount as any) || null,
          dueDate: bid.dueDate,
        },
        scopeItems,
        subQuotes: [],
        materialQuotes: [],
        equipmentSelections: [],
        summary: {
          totalDirectCost,
          overheadPercent,
          overheadAmount,
          profitPercent,
          profitAmount,
          finalBidAmount,
          taxRate: 0,
          taxAmount: 0,
        },
      };

      const pdfStream = generateCustomerQuotePDF(pdfData);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="SmartManageAI-Quote-${bid.code}.pdf"`);

      pdfStream.pipe(res);
    } catch (error) {
      console.error("Generate customer quote PDF error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Project Routes
  // ====================

  const { insertProjectSchema, scopeItems, insertScopeItemSchema } = await import("@shared/schema");
  const { desc, inArray, sql } = await import("drizzle-orm");

  // Get all projects with pagination
  app.get("/api/projects", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { page = "1", limit = "50", status } = req.query;
      
      // Organization filtering: SUPER_ADMIN sees all, others see only their org's projects
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any projects
      if (mustDenyAccess) {
        return res.json({
          data: [],
          pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 0 }
        });
      }
      
      // Validate and sanitize pagination parameters
      const parsedPage = Number(page);
      const parsedLimit = Number(limit);

      let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
      let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
      
      if (limitNum > 1000) {
        limitNum = 1000; // Max limit to prevent abuse
      }

      const offset = (pageNum - 1) * limitNum;

      // SECURITY: Validate status parameter against enum values
      const validStatuses = ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"];
      if (status && !validStatuses.includes(status as string)) {
        res.status(400).json({ error: "Invalid status parameter. Must be one of: BID, PLANNING, ACTIVE, COMPLETE, CLOSED" });
        return;
      }

      // Build filter conditions
      const conditions: SQL[] = [];
      
      // SECURITY: HOURLY_EMPLOYEE can only see ACTIVE projects
      const userRole = req.user!.effectiveRole || req.user!.role;
      if (userRole === "HOURLY_EMPLOYEE") {
        if (status && status !== "ACTIVE") {
          return res.json({
            data: [],
            pagination: { page: 1, limit: 50, totalCount: 0, totalPages: 0 }
          });
        }
        conditions.push(eq(projects.status, "ACTIVE" as any));
      } else if (status) {
        conditions.push(eq(projects.status, status as any));
      }
      
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const whereCondition = conditions.length > 0 
        ? (conditions.length === 1 ? conditions[0] : and(...conditions))
        : undefined;

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(whereCondition);
      const totalCount = totalResult[0]?.count || 0;

      // Get paginated projects
      let query = db.select().from(projects);
      if (whereCondition) {
        query = query.where(whereCondition) as any;
      }
      const allProjects = await query
        .orderBy(desc(projects.createdAt))
        .limit(limitNum)
        .offset(offset);
      
      // Get all unique user IDs
      const userIds = new Set<string>();
      allProjects.forEach(p => {
        if (p.estimatorId) userIds.add(p.estimatorId);
        if (p.superintendentId) userIds.add(p.superintendentId);
      });
      
      // Fetch all relevant users (only if there are any)
      let userMap = new Map<string, string>();
      if (userIds.size > 0) {
        const relevantUsers = await db.select().from(users).where(inArray(users.id, Array.from(userIds)));
        userMap = new Map(relevantUsers.map(u => [u.id, `${u.firstName} ${u.lastName}`]));
      }
      
      // Add estimator and superintendent names to projects
      const projectsWithNames = allProjects.map(project => ({
        ...project,
        estimator: project.estimatorId ? userMap.get(project.estimatorId) || undefined : undefined,
        superintendent: project.superintendentId ? userMap.get(project.superintendentId) || undefined : undefined,
      }));
        
      res.json({
        data: projectsWithNames,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
        },
      });
    } catch (error) {
      console.error("Get projects error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get list of project IDs with pending (SUBMITTED) change orders
  app.get("/api/projects/with-pending-change-orders", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json([]);

      const conditions: SQL[] = [eq(changeOrders.status, "SUBMITTED")];
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }

      const result = await db
        .selectDistinct({ projectId: changeOrders.projectId })
        .from(changeOrders)
        .innerJoin(projects, eq(changeOrders.projectId, projects.id))
        .where(and(...conditions));
      
      const projectIds = result.map(r => r.projectId);
      res.json(projectIds);
    } catch (error) {
      console.error("Get projects with pending COs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get project by code with scope items
  app.get("/api/projects/:code", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Get scope items for this project
      const projectScopeItems = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.projectId, project.id));

      res.json({ ...project, scopeItems: projectScopeItems });
    } catch (error) {
      console.error("Get project error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Project Labor Rates Routes
  // ====================

  // Get project labor rates (default rates + burden multiplier)
  app.get("/api/projects/:code/labor-rates", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const [laborRates] = await db
        .select()
        .from(projectLaborRates)
        .where(eq(projectLaborRates.projectId, project.id))
        .limit(1);

      res.json(laborRates || null);
    } catch (error) {
      console.error("Get project labor rates error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create or update project labor rates
  app.post("/api/projects/:code/labor-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const laborRateSchema = z.object({
        defaultRegularRate: z.string().or(z.number()).transform(v => String(v)),
        defaultOvertimeRate: z.string().or(z.number()).transform(v => String(v)),
        burdenMultiplier: z.string().or(z.number()).transform(v => String(v)),
        notes: z.string().optional(),
      });

      const validationResult = laborRateSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Check if labor rates already exist for this project
      const [existing] = await db
        .select()
        .from(projectLaborRates)
        .where(eq(projectLaborRates.projectId, project.id))
        .limit(1);

      let result;
      if (existing) {
        // Update existing
        [result] = await db
          .update(projectLaborRates)
          .set({
            ...validationResult.data,
            updatedAt: new Date(),
          })
          .where(eq(projectLaborRates.id, existing.id))
          .returning();
      } else {
        // Create new
        [result] = await db
          .insert(projectLaborRates)
          .values({
            projectId: project.id,
            ...validationResult.data,
          })
          .returning();
      }

      await logAudit({
        userId: req.user!.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "projectLaborRates",
        entityId: result.id,
        newValue: JSON.stringify({ projectCode: req.params.code, ...validationResult.data }),
      }, req);

      res.json(result);
    } catch (error) {
      console.error("Create/update project labor rates error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get employee rate overrides for a project
  app.get("/api/projects/:code/employee-rates", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const employeeRates = await db
        .select({
          id: projectEmployeeRates.id,
          projectId: projectEmployeeRates.projectId,
          userId: projectEmployeeRates.userId,
          regularRate: projectEmployeeRates.regularRate,
          overtimeRate: projectEmployeeRates.overtimeRate,
          notes: projectEmployeeRates.notes,
          createdAt: projectEmployeeRates.createdAt,
          updatedAt: projectEmployeeRates.updatedAt,
          employee: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
          },
        })
        .from(projectEmployeeRates)
        .innerJoin(users, eq(projectEmployeeRates.userId, users.id))
        .where(eq(projectEmployeeRates.projectId, project.id));

      res.json(employeeRates);
    } catch (error) {
      console.error("Get employee rate overrides error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create or update employee rate override for a project
  app.post("/api/projects/:code/employee-rates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const employeeRateSchema = z.object({
        userId: z.string().min(1, "Employee ID is required"),
        regularRate: z.string().or(z.number()).transform(v => String(v)),
        overtimeRate: z.string().or(z.number()).transform(v => String(v)),
        notes: z.string().optional(),
      });

      const validationResult = employeeRateSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Verify the user exists
      const [employee] = await db.select().from(users).where(eq(users.id, validationResult.data.userId)).limit(1);
      if (!employee) {
        res.status(404).json({ error: "Employee not found" });
        return;
      }

      // Check if rate override already exists for this employee on this project
      const [existing] = await db
        .select()
        .from(projectEmployeeRates)
        .where(and(
          eq(projectEmployeeRates.projectId, project.id),
          eq(projectEmployeeRates.userId, validationResult.data.userId)
        ))
        .limit(1);

      let result;
      if (existing) {
        // Update existing
        [result] = await db
          .update(projectEmployeeRates)
          .set({
            regularRate: validationResult.data.regularRate,
            overtimeRate: validationResult.data.overtimeRate,
            notes: validationResult.data.notes,
            updatedAt: new Date(),
          })
          .where(eq(projectEmployeeRates.id, existing.id))
          .returning();
      } else {
        // Create new
        [result] = await db
          .insert(projectEmployeeRates)
          .values({
            projectId: project.id,
            userId: validationResult.data.userId,
            regularRate: validationResult.data.regularRate,
            overtimeRate: validationResult.data.overtimeRate,
            notes: validationResult.data.notes,
          })
          .returning();
      }

      await logAudit({
        userId: req.user!.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "projectEmployeeRates",
        entityId: result.id,
        newValue: JSON.stringify({ projectCode: req.params.code, employeeId: validationResult.data.userId }),
      }, req);

      res.json(result);
    } catch (error) {
      console.error("Create/update employee rate override error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete employee rate override
  app.delete("/api/projects/:code/employee-rates/:rateId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const [rateOverride] = await db
        .select()
        .from(projectEmployeeRates)
        .where(and(
          eq(projectEmployeeRates.id, req.params.rateId),
          eq(projectEmployeeRates.projectId, project.id)
        ))
        .limit(1);

      if (!rateOverride) {
        res.status(404).json({ error: "Rate override not found" });
        return;
      }

      await db.delete(projectEmployeeRates).where(eq(projectEmployeeRates.id, req.params.rateId));

      await logAudit({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "projectEmployeeRates",
        entityId: req.params.rateId,
        oldValue: JSON.stringify({ projectCode: req.params.code }),
      }, req);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete employee rate override error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get project financials with actual costs (Admin/Manager/Superintendent only)
  app.get("/api/projects/:code/financials", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { timeClockShifts, procurementItems, receipts, subcontractorContracts, subcontractorPayments, timeEntries } = await import("@shared/schema");
      const { sum, gte, lte, desc } = await import("drizzle-orm");
      
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Get change orders for adjusted contract calculation
      const projectChangeOrders = await db
        .select({
          amount: changeOrders.amount,
          status: changeOrders.status,
        })
        .from(changeOrders)
        .where(eq(changeOrders.projectId, project.id));

      const approvedCOs = projectChangeOrders.filter(co => co.status === 'APPROVED');
      const approvedCOValue = approvedCOs.reduce((sum, co) => sum + Number(co.amount || 0), 0);

      // Get T&M daily sheets for billing totals (legacy)
      const { tmDailySheets, tmTickets } = await import("@shared/schema");
      const projectTMSheets = await db
        .select()
        .from(tmDailySheets)
        .where(eq(tmDailySheets.projectId, project.id));

      // Get T&M work tickets (new system)
      const projectTMTickets = await db
        .select()
        .from(tmTickets)
        .where(eq(tmTickets.projectId, project.id));

      // Calculate T&M ticket totals (new system)
      const approvedTMTickets = projectTMTickets.filter(t => t.status === "APPROVED");
      const pendingTMTickets = projectTMTickets.filter(t => t.status === "SUBMITTED");
      const draftTMTickets = projectTMTickets.filter(t => t.status === "DRAFT");
      
      const tmTicketApprovedTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
      const tmTicketPendingTotal = pendingTMTickets.reduce((sum, t) => sum + Number(t.grandTotal || 0), 0);
      const tmTicketLaborTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.totalLaborCost || 0), 0);
      const tmTicketEquipmentTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.totalEquipmentCost || 0), 0);
      const tmTicketMaterialTotal = approvedTMTickets.reduce((sum, t) => sum + Number(t.totalMaterialCost || 0), 0);

      // Calculate T&M totals from sheets (parse JSON fields) - legacy
      let tmLaborTotal = 0;
      let tmEquipmentTotal = 0;
      let tmMaterialsTotal = 0;
      
      for (const sheet of projectTMSheets) {
        // Parse labor summary
        if (sheet.laborSummaryJson) {
          try {
            const laborData = JSON.parse(sheet.laborSummaryJson);
            if (Array.isArray(laborData)) {
              laborData.forEach((item: any) => {
                tmLaborTotal += Number(item.total || item.amount || 0);
              });
            } else if (laborData.total) {
              tmLaborTotal += Number(laborData.total);
            }
          } catch (e) { /* ignore invalid JSON */ }
        }
        // Parse equipment used
        if (sheet.equipmentUsedJson) {
          try {
            const equipData = JSON.parse(sheet.equipmentUsedJson);
            if (Array.isArray(equipData)) {
              equipData.forEach((item: any) => {
                tmEquipmentTotal += Number(item.total || item.amount || item.cost || 0);
              });
            } else if (equipData.total) {
              tmEquipmentTotal += Number(equipData.total);
            }
          } catch (e) { /* ignore invalid JSON */ }
        }
        // Parse materials used
        if (sheet.materialsUsedJson) {
          try {
            const matData = JSON.parse(sheet.materialsUsedJson);
            if (Array.isArray(matData)) {
              matData.forEach((item: any) => {
                tmMaterialsTotal += Number(item.total || item.amount || item.cost || 0);
              });
            } else if (matData.total) {
              tmMaterialsTotal += Number(matData.total);
            }
          } catch (e) { /* ignore invalid JSON */ }
        }
      }
      
      const tmChargesTotal = tmLaborTotal + tmEquipmentTotal + tmMaterialsTotal;

      // Get project labor rates configuration (default rates + burden multiplier)
      const [projectRates] = await db
        .select()
        .from(projectLaborRates)
        .where(eq(projectLaborRates.projectId, project.id))
        .limit(1);

      // Get employee-specific rate overrides for this project
      const employeeRateOverrides = await db
        .select()
        .from(projectEmployeeRates)
        .where(eq(projectEmployeeRates.projectId, project.id));

      const employeeRatesMap: Record<string, { regular: number; overtime: number }> = {};
      employeeRateOverrides.forEach(r => {
        employeeRatesMap[r.userId] = {
          regular: Number(r.regularRate),
          overtime: Number(r.overtimeRate),
        };
      });

      // Calculate labor costs from time clock shifts
      const laborShifts = await db
        .select({
          totalHours: timeClockShifts.totalHours,
          userId: timeClockShifts.userId,
          approvalStatus: timeClockShifts.approvalStatus,
        })
        .from(timeClockShifts)
        .where(eq(timeClockShifts.projectId, project.id));

      // Get user cost rates for labor calculation (fallback if no project rates)
      const userIds = Array.from(new Set(laborShifts.map(s => s.userId)));
      const userDefaultRates: Record<string, { regular: number; overtime: number }> = {};
      
      if (userIds.length > 0) {
        const usersData = await db
          .select({
            id: users.id,
            costRateRegular: users.costRateRegular,
            costRateOvertime: users.costRateOvertime,
          })
          .from(users)
          .where(inArray(users.id, userIds));
        
        usersData.forEach(u => {
          userDefaultRates[u.id] = {
            regular: Number(u.costRateRegular || 50),
            overtime: Number(u.costRateOvertime || 75),
          };
        });
      }

      // Rate resolution priority: 1) Employee-specific project rate, 2) Project default, 3) User default, 4) System default ($50)
      const getEffectiveRate = (userId: string): { regular: number; overtime: number } => {
        // 1. Employee-specific rate for this project (highest priority)
        if (employeeRatesMap[userId]) {
          return employeeRatesMap[userId];
        }
        // 2. Project default rate
        if (projectRates) {
          return {
            regular: Number(projectRates.defaultRegularRate),
            overtime: Number(projectRates.defaultOvertimeRate),
          };
        }
        // 3. User's default rate
        if (userDefaultRates[userId]) {
          return userDefaultRates[userId];
        }
        // 4. System default
        return { regular: 50, overtime: 75 };
      };

      // Get burden multiplier (default to 1.0 if not configured)
      const burdenMultiplier = projectRates ? Number(projectRates.burdenMultiplier) : 1.0;

      // Calculate labor cost based on approved shifts with burden multiplier
      const approvedShifts = laborShifts.filter(s => s.approvalStatus === 'APPROVED');
      const totalLaborHours = approvedShifts.reduce((sum, s) => sum + Number(s.totalHours || 0), 0);
      const baseLaborCost = approvedShifts.reduce((sum, s) => {
        const rate = getEffectiveRate(s.userId);
        return sum + (Number(s.totalHours || 0) * rate.regular);
      }, 0);
      // Apply burden multiplier to get true labor cost
      const totalLaborCost = baseLaborCost * burdenMultiplier;

      // Calculate material costs from procurement items
      const materials = await db
        .select({
          unitCost: procurementItems.unitCost,
          quantity: procurementItems.quantity,
          status: procurementItems.status,
        })
        .from(procurementItems)
        .where(eq(procurementItems.projectId, project.id));

      const totalMaterialCost = materials.reduce((sum, item) => {
        const cost = Number(item.unitCost || 0) * Number(item.quantity || 0);
        return sum + cost;
      }, 0);

      // Calculate subcontractor costs from payments
      const subPayments = await db
        .select({
          amount: subcontractorPayments.amount,
        })
        .from(subcontractorPayments)
        .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
        .where(eq(subcontractorContracts.projectId, project.id));

      const totalSubcontractorCost = subPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // Calculate other expenses from receipts
      const expenseReceipts = await db
        .select({
          amount: receipts.amount,
        })
        .from(receipts)
        .where(eq(receipts.projectId, project.id));

      const totalOtherExpenses = expenseReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);

      // Calculate totals
      const budget = Number(project.budget || 0); // Direct cost to do the job
      const originalContract = Number(project.contractAmount || 0); // What client pays (budget + overhead + profit)
      const contractAdditions = approvedCOValue + tmChargesTotal + tmTicketApprovedTotal; // Total additions from COs and T&M
      const adjustedContract = originalContract + contractAdditions; // With change orders and T&M
      
      // Total actual costs incurred
      const totalActualCost = totalLaborCost + totalMaterialCost + totalSubcontractorCost + totalOtherExpenses;
      
      // Profit calculations
      const projectedProfit = originalContract - budget; // Expected profit (contract - budget)
      const actualProfit = adjustedContract - totalActualCost; // Real-time profit (adjusted contract - actual costs)

      res.json({
        budget,
        originalContract,
        adjustedContract,
        contractAdditions,
        approvedChangeOrdersTotal: approvedCOValue,
        approvedChangeOrdersCount: approvedCOs.length,
        tmCharges: {
          labor: tmLaborTotal,
          equipment: tmEquipmentTotal,
          materials: tmMaterialsTotal,
          total: tmChargesTotal,
          sheetsCount: projectTMSheets.length,
        },
        tmTickets: {
          total: projectTMTickets.length,
          approved: approvedTMTickets.length,
          pending: pendingTMTickets.length,
          draft: draftTMTickets.length,
          approvedTotal: tmTicketApprovedTotal,
          pendingTotal: tmTicketPendingTotal,
          labor: tmTicketLaborTotal,
          equipment: tmTicketEquipmentTotal,
          materials: tmTicketMaterialTotal,
        },
        projectedProfit,
        actualProfit,
        actualCosts: {
          labor: totalLaborCost,
          laborHours: totalLaborHours,
          laborBaseCost: baseLaborCost,
          materials: totalMaterialCost,
          subcontractors: totalSubcontractorCost,
          otherExpenses: totalOtherExpenses,
          total: totalActualCost,
        },
        laborRates: {
          configured: !!projectRates,
          defaultRegularRate: projectRates ? Number(projectRates.defaultRegularRate) : null,
          defaultOvertimeRate: projectRates ? Number(projectRates.defaultOvertimeRate) : null,
          burdenMultiplier: burdenMultiplier,
          employeeOverrideCount: employeeRateOverrides.length,
        },
        profitVariance: actualProfit - projectedProfit,
        profitVariancePercent: projectedProfit !== 0 ? ((actualProfit - projectedProfit) / projectedProfit) * 100 : 0,
      });
    } catch (error) {
      console.error("Get project financials error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create project schema without code - code is auto-generated
  const createProjectSchema = insertProjectSchema.omit({ code: true });

  // Create project (Admin/Manager/Estimator) - code is auto-generated with retry logic
  app.post("/api/projects", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        description: sanitizeText(req.body.description),
        clientName: sanitizeShortText(req.body.clientName),
        location: sanitizeText(req.body.location),
      };

      const validationResult = createProjectSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Auto-generate the next project code with retry logic for concurrent creates
      const MAX_RETRIES = 3;
      let lastError: any = null;
      
      // Get the user's organization ID to assign to the project for proper multi-tenant filtering
      const userOrgId = req.user?.organizationId;
      
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const nextCode = await getNextBidCode();
          console.log(`[Create Project] Auto-assigned code: ${nextCode} (attempt ${attempt + 1})`);

          const [newProject] = await db.insert(projects).values({
            ...validationResult.data,
            code: nextCode,
            // Automatically assign the user's organization to the project for proper filtering
            gcOrganizationId: validationResult.data.gcOrganizationId || userOrgId,
          }).returning();
          res.status(201).json(newProject);
          return;
        } catch (insertError: any) {
          if (insertError.code === '23505' && attempt < MAX_RETRIES - 1) {
            // Unique constraint violation - retry with a new code
            console.log(`[Create Project] Code conflict, retrying... (attempt ${attempt + 1})`);
            lastError = insertError;
            continue;
          }
          throw insertError;
        }
      }
      
      // If we get here, all retries failed
      throw lastError;
    } catch (error: any) {
      console.error("Create project error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Unable to generate unique project code - please try again" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update project schema
  const updateProjectSchema = insertProjectSchema.partial();

  // Update project (Admin/Manager, or ESTIMATOR if they are the assigned estimator)
  app.patch("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      // Fetch project first to check permissions and status transitions
      const [existingProject] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, req.params.code))
        .limit(1);

      if (!existingProject) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, existingProject.gcOrganizationId)) return;

      // OWNERSHIP CHECK: ESTIMATOR can only edit projects they are assigned to
      const userRole = req.user!.effectiveRole || req.user!.role;
      if (userRole === "ESTIMATOR" && existingProject.estimatorId !== req.user!.id) {
        res.status(403).json({ error: "You can only edit projects where you are the assigned estimator" });
        return;
      }

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
        clientName: req.body.clientName ? sanitizeShortText(req.body.clientName) : undefined,
        location: req.body.location ? sanitizeText(req.body.location) : undefined,
      };

      const validationResult = updateProjectSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Check status transitions if status is being updated
      if (validationResult.data.status !== undefined) {
        const currentProject = existingProject;

        const transitionCheck = validateProjectStatusTransition(
          currentProject.status as ProjectStatus,
          validationResult.data.status as ProjectStatus
        );

        if (!transitionCheck.valid) {
          res.status(400).json({ error: transitionCheck.error });
          return;
        }
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedProject] = await db
        .update(projects)
        .set(updateData)
        .where(eq(projects.code, req.params.code))
        .returning();

      if (!updatedProject) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      res.json(updatedProject);
    } catch (error: any) {
      console.error("Update project error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete project (Admin/Manager only) - with cascade deletion of related data
  app.delete("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // First, find the project
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Delete related records in dependency order (most dependent first)
      // Note: Most tables have ON DELETE CASCADE, but we explicitly delete for audit clarity
      
      // Delete AI-related data
      await db.delete(aiNoteInsights).where(eq(aiNoteInsights.projectId, project.id));
      await db.delete(aiTasks).where(eq(aiTasks.projectId, project.id));
      
      // Delete time clock and labor data
      await db.delete(timeClockShifts).where(eq(timeClockShifts.projectId, project.id));
      await db.delete(projectEmployeeRates).where(eq(projectEmployeeRates.projectId, project.id));
      await db.delete(projectLaborRates).where(eq(projectLaborRates.projectId, project.id));
      
      // Delete scope and progress data
      await db.delete(dailyScopeProgress).where(eq(dailyScopeProgress.projectId, project.id));
      await db.delete(scopeItems).where(eq(scopeItems.projectId, project.id));
      
      // Delete financial data
      await db.delete(changeOrders).where(eq(changeOrders.projectId, project.id));
      await db.delete(receipts).where(eq(receipts.projectId, project.id));
      await db.delete(procurementItems).where(eq(procurementItems.projectId, project.id));
      
      // Delete takeoff and plans data
      const plansToDelete = await db.select().from(projectPlans).where(eq(projectPlans.projectId, project.id));
      for (const plan of plansToDelete) {
        await db.delete(takeoffMeasurements).where(eq(takeoffMeasurements.sheetId, plan.id));
      }
      await db.delete(projectPlans).where(eq(projectPlans.projectId, project.id));
      await db.delete(takeoffSheets).where(eq(takeoffSheets.projectId, project.id));
      await db.delete(quantityCategories).where(eq(quantityCategories.projectId, project.id));
      await db.delete(planDocuments).where(eq(planDocuments.projectId, project.id));
      
      // Delete notes and communications
      await db.delete(projectNotes).where(eq(projectNotes.projectId, project.id));
      
      // Delete calendar and events
      await db.delete(calendarEvents).where(eq(calendarEvents.projectId, project.id));
      
      // Delete media
      await db.delete(media).where(eq(media.projectId, project.id));
      
      // Delete tasks
      await db.delete(tasks).where(eq(tasks.projectId, project.id));
      
      // Delete handoff packets
      await db.delete(handoffPackets).where(eq(handoffPackets.projectId, project.id));
      
      // Delete estimates and line items
      const projectEstimates = await db.select().from(estimates).where(eq(estimates.projectId, project.id));
      for (const estimate of projectEstimates) {
        await db.delete(estimateLineItems).where(eq(estimateLineItems.estimateId, estimate.id));
      }
      await db.delete(estimates).where(eq(estimates.projectId, project.id));
      
      // Delete T&M daily sheets
      await db.delete(tmDailySheets).where(eq(tmDailySheets.projectId, project.id));
      
      // Delete time entries
      await db.delete(timeEntries).where(eq(timeEntries.projectId, project.id));

      // Finally, delete the project
      const [deletedProject] = await db
        .delete(projects)
        .where(eq(projects.code, req.params.code))
        .returning();

      // Audit log
      await logDelete(req.user!.id, "projects", project.id, { code: project.code, name: project.name }, req);

      res.json({ success: true, message: `Project ${project.code} deleted successfully` });
    } catch (error) {
      console.error("Delete project error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update project financials (Admin only)
  app.patch("/api/projects/:code/financials", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { budget, contractAmount, texturaDrawDate, drawDayOfMonth } = req.body;

      // BUSINESS VALIDATION: Validate monetary amounts
      if (budget !== undefined) {
        const budgetCheck = validateMonetaryAmount(budget, "Budget");
        if (!budgetCheck.valid) {
          res.status(400).json({ error: budgetCheck.error });
          return;
        }
      }

      if (contractAmount !== undefined) {
        const contractCheck = validateMonetaryAmount(contractAmount, "Contract amount");
        if (!contractCheck.valid) {
          res.status(400).json({ error: contractCheck.error });
          return;
        }
      }

      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Build update object with only provided fields
      const updateData: any = { updatedAt: new Date() };
      if (budget !== undefined) updateData.budget = budget;
      if (contractAmount !== undefined) updateData.contractAmount = contractAmount;
      if (texturaDrawDate !== undefined) updateData.texturaDrawDate = texturaDrawDate;
      if (drawDayOfMonth !== undefined) updateData.drawDayOfMonth = drawDayOfMonth;

      // Audit log the change
      await logUpdate(
        req.user!.id,
        "PROJECT",
        project.id,
        JSON.stringify({
          budget: project.budget,
          contractAmount: project.contractAmount,
          texturaDrawDate: project.texturaDrawDate,
          drawDayOfMonth: project.drawDayOfMonth,
        }),
        JSON.stringify({
          budget,
          contractAmount,
          texturaDrawDate,
          drawDayOfMonth,
        }),
        req
      );

      const [updated] = await db
        .update(projects)
        .set(updateData)
        .where(eq(projects.code, req.params.code))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update project financials error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Scope of Work Routes
  // ====================

  // Get scope items for a project with estimate traceability
  app.get("/api/projects/:code/scope", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Get scope items - simple query without nested objects to avoid Drizzle null handling issues
      const items = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.projectId, project.id));

      // Fetch estimate info separately for traceability (if line item linked)
      const enrichedItems = await Promise.all(items.map(async (item) => {
        let sourceEstimate = null;
        
        if (item.estimateLineItemId) {
          const [lineItem] = await db
            .select({ estimateId: estimateLineItems.estimateId })
            .from(estimateLineItems)
            .where(eq(estimateLineItems.id, item.estimateLineItemId))
            .limit(1);
          
          if (lineItem?.estimateId) {
            const [estimate] = await db
              .select({ id: estimates.id, status: estimates.status, versionNumber: estimates.versionNumber })
              .from(estimates)
              .where(eq(estimates.id, lineItem.estimateId))
              .limit(1);
            
            if (estimate) {
              sourceEstimate = {
                id: estimate.id,
                status: estimate.status,
                versionNumber: estimate.versionNumber,
              };
            }
          }
        }
        
        return {
          ...item,
          sourceEstimate,
        };
      }));

      res.json(enrichedItems);
    } catch (error) {
      console.error("Get scope items error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create scope item (Admin/Manager/Superintendent only)
  app.post("/api/projects/:code/scope", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        description: sanitizeText(req.body.description),
      };

      const validationResult = insertScopeItemSchema.extend({
        projectId: z.string().optional(),
      }).safeParse({ ...sanitizedBody, projectId: project.id });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Ensure projectId is set (TypeScript safety)
      const insertData = { ...validationResult.data, projectId: project.id };
      const [newScopeItem] = await db.insert(scopeItems).values([insertData]).returning();
      res.status(201).json(newScopeItem);
    } catch (error: any) {
      console.error("Create scope item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update scope item schema
  const updateScopeItemSchema = insertScopeItemSchema.omit({ projectId: true }).partial();

  // Update scope item (Admin/Manager/Superintendent only)
  app.patch("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = updateScopeItemSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Get the old item to check if billing status is changing
      const [oldItem] = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.id, req.params.id));

      if (!oldItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      // SECURITY: Verify org access via the parent project
      const [parentProject] = await db.select().from(projects).where(eq(projects.id, oldItem.projectId)).limit(1);
      if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedItem] = await db
        .update(scopeItems)
        .set(updateData)
        .where(eq(scopeItems.id, req.params.id))
        .returning();

      if (!updatedItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      // Create notification for office administrators if billing status changed to READY_TO_BILL
      if (updatedItem.billingStatus === "READY_TO_BILL" && oldItem.billingStatus !== "READY_TO_BILL") {
        const orgConditions: SQL[] = [eq(users.role, "ADMIN")];
        if (parentProject.gcOrganizationId) {
          orgConditions.push(eq(users.organizationId, parentProject.gcOrganizationId));
        }
        const admins = await db
          .select()
          .from(users)
          .where(and(...orgConditions));
        
        const notificationsToCreate = admins.map(admin => ({
          userId: admin.id,
          type: "BILLING_READY" as const,
          title: "Scope Item Ready to Bill",
          message: `Scope item "${updatedItem.description}" is ready for billing`,
          relatedEntityId: updatedItem.id,
          relatedEntityType: "scopeItem",
        }));

        if (notificationsToCreate.length > 0) {
          await db.insert(notifications).values(notificationsToCreate);
        }
      }

      res.json(updatedItem);
    } catch (error: any) {
      console.error("Update scope item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete scope item (Admin/Manager, or SUPERINTENDENT if they are assigned to the project)
  app.delete("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      // Fetch scope item first to check project ownership for SUPERINTENDENT
      const [scopeItem] = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.id, req.params.id))
        .limit(1);

      if (!scopeItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      // SECURITY: Verify org access via the parent project
      const [parentProject] = await db.select().from(projects).where(eq(projects.id, scopeItem.projectId)).limit(1);
      if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

      // OWNERSHIP CHECK: SUPERINTENDENT can only delete scope items from projects they are assigned to
      const userRole = req.user!.effectiveRole || req.user!.role;
      if (userRole === "SUPERINTENDENT" && parentProject.superintendentId !== req.user!.id) {
        res.status(403).json({ error: "You can only delete scope items from projects where you are the assigned superintendent" });
        return;
      }

      const [deletedItem] = await db
        .delete(scopeItems)
        .where(eq(scopeItems.id, req.params.id))
        .returning();

      res.json({ success: true });
    } catch (error) {
      console.error("Delete scope item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update actual materials for a scope item (with overage detection)
  app.patch("/api/scope-items/:id/materials", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const materialsSchema = z.object({
        actualConcreteYards: z.string().nullable().optional(),
        actualStoneTons: z.string().nullable().optional(),
        actualExcavationYards: z.string().nullable().optional(),
        materialResponsibility: z.enum(["TFR", "SUBCONTRACTOR", "CUSTOMER", "PENDING"]).optional(),
        overageActionStatus: z.enum(["NONE", "PENDING", "BILLED", "DEDUCTED", "ABSORBED", "RESOLVED"]).optional(),
        overageNotes: z.string().optional(),
      });

      const validationResult = materialsSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Get existing scope item
      const [scopeItem] = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.id, req.params.id));

      if (!scopeItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      // SECURITY: Verify org access via the parent project
      const [parentProject] = await db.select().from(projects).where(eq(projects.id, scopeItem.projectId)).limit(1);
      if (!parentProject || !verifyOrgAccess(req, res, parentProject.gcOrganizationId)) return;

      // Calculate if there's an overage
      const data = validationResult.data;
      const actualConcrete = Number(data.actualConcreteYards) || 0;
      const actualStone = Number(data.actualStoneTons) || 0;
      const actualExcavation = Number(data.actualExcavationYards) || 0;
      
      const estConcrete = Number(scopeItem.estimatedConcreteYards) || 0;
      const estStone = Number(scopeItem.estimatedStoneTons) || 0;
      const estExcavation = Number(scopeItem.estimatedExcavationYards) || 0;

      const hasConcreteOverage = estConcrete > 0 && actualConcrete > estConcrete;
      const hasStoneOverage = estStone > 0 && actualStone > estStone;
      const hasExcavationOverage = estExcavation > 0 && actualExcavation > estExcavation;
      const hasAnyOverage = hasConcreteOverage || hasStoneOverage || hasExcavationOverage;

      // Auto-set overage action status to PENDING if there's a new overage
      let overageActionStatus = data.overageActionStatus;
      if (hasAnyOverage && scopeItem.overageActionStatus === "NONE" && !overageActionStatus) {
        overageActionStatus = "PENDING";
      }

      const updateData: any = {
        actualConcreteYards: data.actualConcreteYards,
        actualStoneTons: data.actualStoneTons,
        actualExcavationYards: data.actualExcavationYards,
        materialResponsibility: data.materialResponsibility,
        overageActionStatus: overageActionStatus,
        overageNotes: data.overageNotes,
        updatedAt: new Date(),
      };

      // Set resolved info if action is being completed
      if (overageActionStatus && overageActionStatus !== "NONE" && overageActionStatus !== "PENDING" && 
          scopeItem.overageActionStatus !== overageActionStatus) {
        updateData.overageResolvedById = req.user!.id;
        updateData.overageResolvedAt = new Date();
      }

      const [updatedItem] = await db
        .update(scopeItems)
        .set(updateData)
        .where(eq(scopeItems.id, req.params.id))
        .returning();

      // Create notification for managers if a new overage is detected
      if (hasAnyOverage && scopeItem.overageActionStatus === "NONE") {
        const managerConditions: SQL[] = [sql`${users.role} IN ('ADMIN', 'MANAGER')`];
        if (parentProject.gcOrganizationId) {
          managerConditions.push(eq(users.organizationId, parentProject.gcOrganizationId));
        }
        const managers = await db
          .select()
          .from(users)
          .where(and(...managerConditions));
        
        const overageDetails: string[] = [];
        if (hasConcreteOverage) {
          overageDetails.push(`Concrete: +${(actualConcrete - estConcrete).toFixed(2)} CY`);
        }
        if (hasStoneOverage) {
          overageDetails.push(`Stone: +${(actualStone - estStone).toFixed(2)} Tons`);
        }
        if (hasExcavationOverage) {
          overageDetails.push(`Excavation: +${(actualExcavation - estExcavation).toFixed(2)} CY`);
        }

        const notificationsToCreate = managers.map(manager => ({
          userId: manager.id,
          type: "MATERIAL_OVERAGE" as const,
          title: "Material Overage Detected",
          message: `Overage on "${scopeItem.description}": ${overageDetails.join(", ")}`,
          relatedEntityId: scopeItem.id,
          relatedEntityType: "scopeItem",
        }));

        if (notificationsToCreate.length > 0) {
          await db.insert(notifications).values(notificationsToCreate);
        }
      }

      // Log the action
      console.log(`Material update for scope item ${req.params.id} by user ${req.user!.id}:`, {
        actualMaterials: { actualConcrete, actualStone, actualExcavation },
        overages: { hasConcreteOverage, hasStoneOverage, hasExcavationOverage },
        actionStatus: overageActionStatus,
      });

      res.json(updatedItem);
    } catch (error: any) {
      console.error("Update scope item materials error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get scope items with material overages for a project
  app.get("/api/projects/:projectId/material-overages", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const projectId = req.params.projectId;
      
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Get all scope items for the project that have material estimates
      const items = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.projectId, projectId));

      // Filter to items with overages
      const overageItems = items.filter(item => {
        const estConcrete = Number(item.estimatedConcreteYards) || 0;
        const estStone = Number(item.estimatedStoneTons) || 0;
        const estExcavation = Number(item.estimatedExcavationYards) || 0;
        const actualConcrete = Number(item.actualConcreteYards) || 0;
        const actualStone = Number(item.actualStoneTons) || 0;
        const actualExcavation = Number(item.actualExcavationYards) || 0;

        return (
          (estConcrete > 0 && actualConcrete > estConcrete) ||
          (estStone > 0 && actualStone > estStone) ||
          (estExcavation > 0 && actualExcavation > estExcavation)
        );
      }).map(item => {
        const estConcrete = Number(item.estimatedConcreteYards) || 0;
        const estStone = Number(item.estimatedStoneTons) || 0;
        const estExcavation = Number(item.estimatedExcavationYards) || 0;
        const actualConcrete = Number(item.actualConcreteYards) || 0;
        const actualStone = Number(item.actualStoneTons) || 0;
        const actualExcavation = Number(item.actualExcavationYards) || 0;

        return {
          ...item,
          concreteVariance: actualConcrete - estConcrete,
          stoneVariance: actualStone - estStone,
          excavationVariance: actualExcavation - estExcavation,
          hasConcreteOverage: estConcrete > 0 && actualConcrete > estConcrete,
          hasStoneOverage: estStone > 0 && actualStone > estStone,
          hasExcavationOverage: estExcavation > 0 && actualExcavation > estExcavation,
        };
      });

      res.json({ overages: overageItems, count: overageItems.length });
    } catch (error) {
      console.error("Get material overages error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============================
  // Daily Scope Progress Routes
  // =============================

  const { dailyScopeProgress, insertDailyScopeProgressSchema, projectMaterialBudgets } = await import("@shared/schema");

  // Helper function to sync all material budgets linked to a scope item
  // Uses the scope item's completed quantity to update material budget tracking
  // Only syncs if units match (e.g., both are EA, SF, etc.) to avoid incorrect conversions
  // This ensures Materials data matches Scope & Progress data
  async function syncMaterialBudgetsFromScopeItem(scopeItemId: string, completedQuantity: number) {
    try {
      // Get the scope item to know its unit
      const [scopeItem] = await db
        .select({ unit: scopeItems.unit })
        .from(scopeItems)
        .where(eq(scopeItems.id, scopeItemId))
        .limit(1);

      if (!scopeItem) return;

      const scopeUnit = (scopeItem.unit || "").toLowerCase().trim();

      // Find ALL material budgets linked to this scope item (there can be multiple)
      const materialBudgets = await db
        .select()
        .from(projectMaterialBudgets)
        .where(eq(projectMaterialBudgets.scopeItemId, scopeItemId));

      for (const materialBudget of materialBudgets) {
        const materialUnit = (materialBudget.unit || "").toLowerCase().trim();
        
        // Only sync if units match to avoid incorrect quantity mappings
        if (scopeUnit !== materialUnit) {
          continue;
        }

        const budgetedQty = Number(materialBudget.budgetedQuantity || 0);
        const budgetedUnitCost = Number(materialBudget.budgetedUnitCost || 0);
        
        // Calculate actual values based on completed quantity
        const actualQtyUsed = completedQuantity;
        const actualTotalCost = actualQtyUsed * budgetedUnitCost;
        
        const varianceQty = actualQtyUsed - budgetedQty;
        const variancePercent = budgetedQty > 0 ? (actualQtyUsed / budgetedQty) * 100 : 0;
        const shouldAlert = variancePercent >= Number(materialBudget.alertThresholdPercent || 90);
        const alertJustTriggered = shouldAlert && !materialBudget.alertTriggered;

        await db
          .update(projectMaterialBudgets)
          .set({
            actualQuantityUsed: actualQtyUsed.toString(),
            actualTotalCost: actualTotalCost.toFixed(2),
            varianceQuantity: varianceQty.toString(),
            variancePercent: variancePercent.toFixed(2),
            alertTriggered: shouldAlert,
            alertTriggeredAt: alertJustTriggered ? new Date() : materialBudget.alertTriggeredAt,
            updatedAt: new Date(),
          })
          .where(eq(projectMaterialBudgets.id, materialBudget.id));
      }
    } catch (error) {
      console.error("Error syncing material budgets:", error);
      // Don't throw - this is a non-critical update
    }
  }

  // Helper function to calculate billing status based on progress entries' billing statuses
  // Uses the "lowest" status: if any entry is NOT_READY → NOT_READY, 
  // if any entry is READY_TO_BILL → READY_TO_BILL, only if all are BILLED → BILLED
  function calculateBillingStatus(progressEntries: { billingStatus: string }[]): "NOT_READY" | "READY_TO_BILL" | "BILLED" {
    if (progressEntries.length === 0) {
      return "NOT_READY";
    }
    
    const hasNotReady = progressEntries.some(p => p.billingStatus === "NOT_READY");
    const hasReadyToBill = progressEntries.some(p => p.billingStatus === "READY_TO_BILL");
    const allBilled = progressEntries.every(p => p.billingStatus === "BILLED");
    
    if (allBilled) {
      return "BILLED";
    } else if (hasNotReady) {
      return "NOT_READY";
    } else if (hasReadyToBill) {
      return "READY_TO_BILL";
    } else {
      return "NOT_READY";
    }
  }

  // Get all daily progress entries for a scope item
  app.get("/api/scope-items/:scopeItemId/progress", requireAuth, async (req: AuthRequest, res) => {
    try {
      const progressEntries = await db
        .select({
          progress: dailyScopeProgress,
          creator: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(dailyScopeProgress)
        .leftJoin(users, eq(dailyScopeProgress.createdById, users.id))
        .where(eq(dailyScopeProgress.scopeItemId, req.params.scopeItemId))
        .orderBy(desc(dailyScopeProgress.workDate), desc(dailyScopeProgress.createdAt));

      res.json(progressEntries);
    } catch (error) {
      console.error("Get daily progress error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create daily progress entry (All authenticated users)
  app.post("/api/scope-items/:scopeItemId/progress", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [scopeItem] = await db
        .select()
        .from(scopeItems)
        .where(eq(scopeItems.id, req.params.scopeItemId))
        .limit(1);

      if (!scopeItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const validationResult = insertDailyScopeProgressSchema.safeParse({
        ...sanitizedBody,
        scopeItemId: req.params.scopeItemId,
        projectId: scopeItem.projectId,
        // Unified SOW Tracking: propagate organizationSowItemId for cross-project production rate aggregation
        organizationSowItemId: scopeItem.organizationSowItemId || null,
        createdById: req.user!.id,
      });

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newProgress] = await db.insert(dailyScopeProgress).values([validationResult.data]).returning();

      // Update the scope item's completed and billed quantities
      const allProgress = await db
        .select()
        .from(dailyScopeProgress)
        .where(eq(dailyScopeProgress.scopeItemId, req.params.scopeItemId));

      const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
      const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
      const billingStatus = calculateBillingStatus(allProgress);

      await db
        .update(scopeItems)
        .set({
          completedQuantity: totalCompleted.toString(),
          billedQuantity: totalBilled.toString(),
          billingStatus,
          updatedAt: new Date(),
        })
        .where(eq(scopeItems.id, req.params.scopeItemId));

      // Sync material budgets with updated completed quantity
      await syncMaterialBudgetsFromScopeItem(req.params.scopeItemId, totalCompleted);

      res.status(201).json(newProgress);
    } catch (error: any) {
      console.error("Create daily progress error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update daily progress entry (Creator, Admin, Manager, Superintendent)
  app.patch("/api/scope-items/:scopeItemId/progress/:progressId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [existingProgress] = await db
        .select()
        .from(dailyScopeProgress)
        .where(eq(dailyScopeProgress.id, req.params.progressId))
        .limit(1);

      if (!existingProgress) {
        res.status(404).json({ error: "Progress entry not found" });
        return;
      }

      // Check permissions: creator or admin/manager/superintendent/office_manager
      const isCreator = existingProgress.createdById === req.user!.id;
      const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
      
      if (!isCreator && !isAuthorized) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      // SECURITY: Strict validation for billing status enum
      if (sanitizedBody.billingStatus) {
        const validStatuses = ["NOT_READY", "READY_TO_BILL", "BILLED"];
        if (!validStatuses.includes(sanitizedBody.billingStatus)) {
          res.status(400).json({ error: "Invalid billing status. Must be one of: NOT_READY, READY_TO_BILL, BILLED" });
          return;
        }
      }

      const updateSchema = insertDailyScopeProgressSchema.omit({
        scopeItemId: true,
        projectId: true,
        createdById: true,
      }).partial();

      const validationResult = updateSchema.safeParse(sanitizedBody);

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Prepare update data with automatic billing fields
      const updateData: any = {
        ...validationResult.data,
        updatedAt: new Date(),
      };

      // If billing status changed to BILLED, record who and when
      if (validationResult.data.billingStatus === "BILLED" && existingProgress.billingStatus !== "BILLED") {
        updateData.billedDate = new Date();
        updateData.billedById = req.user!.id;
      }

      // Update the progress entry
      const [updatedProgress] = await db
        .update(dailyScopeProgress)
        .set(updateData)
        .where(eq(dailyScopeProgress.id, req.params.progressId))
        .returning();

      // Create notification for office manager when status changes to READY_TO_BILL
      if (validationResult.data.billingStatus === "READY_TO_BILL" && existingProgress.billingStatus !== "READY_TO_BILL") {
        try {
          // Get scope item details for notification
          const [scopeItem] = await db
            .select()
            .from(scopeItems)
            .where(eq(scopeItems.id, existingProgress.scopeItemId))
            .limit(1);

          if (scopeItem) {
            // Get project details
            const [project] = await db
              .select()
              .from(projects)
              .where(eq(projects.id, existingProgress.projectId))
              .limit(1);

            // Find all office managers
            const officeManagers = await db
              .select()
              .from(users)
              .where(eq(users.role, "OFFICE_MANAGER"));

            // Batch insert notifications for all office managers
            if (officeManagers.length > 0) {
              const notificationValues = officeManagers.map(manager => ({
                userId: manager.id,
                type: "BILLING_READY" as const,
                title: "Quantities Ready to Bill",
                message: `${scopeItem.description} (${updatedProgress.billedQuantity} ${scopeItem.unit}) is ready to bill on project ${project?.code || 'Unknown'}`,
                relatedEntityId: updatedProgress.id,
                relatedEntityType: "daily_scope_progress" as const,
              }));
              
              await db.insert(notifications).values(notificationValues);
            }
          }
        } catch (notificationError) {
          console.error("Failed to create notifications:", notificationError);
          // Continue execution - notification failure shouldn't block the update
        }
      }

      // Recalculate scope item totals
      const allProgress = await db
        .select()
        .from(dailyScopeProgress)
        .where(eq(dailyScopeProgress.scopeItemId, existingProgress.scopeItemId));

      const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
      const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
      const billingStatus = calculateBillingStatus(allProgress);

      await db
        .update(scopeItems)
        .set({
          completedQuantity: totalCompleted.toString(),
          billedQuantity: totalBilled.toString(),
          billingStatus,
          updatedAt: new Date(),
        })
        .where(eq(scopeItems.id, existingProgress.scopeItemId));

      // Sync material budgets with updated completed quantity
      await syncMaterialBudgetsFromScopeItem(existingProgress.scopeItemId, totalCompleted);

      res.json(updatedProgress);
    } catch (error: any) {
      console.error("Update daily progress error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete daily progress entry (Creator, Admin, Manager, Superintendent)
  app.delete("/api/scope-items/:scopeItemId/progress/:progressId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [existingProgress] = await db
        .select()
        .from(dailyScopeProgress)
        .where(eq(dailyScopeProgress.id, req.params.progressId))
        .limit(1);

      if (!existingProgress) {
        res.status(404).json({ error: "Progress entry not found" });
        return;
      }

      // Check permissions: creator or admin/manager/superintendent/office_manager
      const isCreator = existingProgress.createdById === req.user!.id;
      const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
      
      if (!isCreator && !isAuthorized) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      await db.delete(dailyScopeProgress).where(eq(dailyScopeProgress.id, req.params.progressId));

      // Recalculate scope item totals
      const allProgress = await db
        .select()
        .from(dailyScopeProgress)
        .where(eq(dailyScopeProgress.scopeItemId, existingProgress.scopeItemId));

      const totalCompleted = allProgress.reduce((sum, p) => sum + parseFloat(p.quantityCompleted), 0);
      const totalBilled = allProgress.reduce((sum, p) => sum + parseFloat(p.billedQuantity), 0);
      const billingStatus = calculateBillingStatus(allProgress);

      await db
        .update(scopeItems)
        .set({
          completedQuantity: totalCompleted.toString(),
          billedQuantity: totalBilled.toString(),
          billingStatus,
          updatedAt: new Date(),
        })
        .where(eq(scopeItems.id, existingProgress.scopeItemId));

      // Sync material budgets with updated completed quantity
      await syncMaterialBudgetsFromScopeItem(existingProgress.scopeItemId, totalCompleted);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete daily progress error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============================
  // Project Material Budget & Usage Routes
  // =============================
  // Tracks bid material quantities vs actual usage for variance analysis and alerts

  // Get material budgets for a project (with usage summaries)
  app.get("/api/projects/:projectId/material-budgets", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const { projectMaterialBudgets, projectMaterialUsage, scopeItems: scopeItemsTable } = await import("@shared/schema");
      
      const budgets = await db
        .select({
          budget: projectMaterialBudgets,
          scopeItem: {
            id: scopeItemsTable.id,
            description: scopeItemsTable.description,
            unit: scopeItemsTable.unit,
            totalQuantity: scopeItemsTable.totalQuantity,
            completedQuantity: scopeItemsTable.completedQuantity,
          }
        })
        .from(projectMaterialBudgets)
        .leftJoin(scopeItemsTable, eq(projectMaterialBudgets.scopeItemId, scopeItemsTable.id))
        .where(eq(projectMaterialBudgets.projectId, req.params.projectId))
        .orderBy(projectMaterialBudgets.description);

      res.json(budgets);
    } catch (error) {
      console.error("Get material budgets error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get material budget summary for a project (aggregated stats)
  app.get("/api/projects/:projectId/material-budgets/summary", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const { projectMaterialBudgets } = await import("@shared/schema");
      
      const budgets = await db
        .select()
        .from(projectMaterialBudgets)
        .where(eq(projectMaterialBudgets.projectId, req.params.projectId));

      const totalBudgetedCost = budgets.reduce((sum, b) => sum + Number(b.budgetedTotalCost || 0), 0);
      const totalActualCost = budgets.reduce((sum, b) => sum + Number(b.actualTotalCost || 0), 0);
      const itemsAtRisk = budgets.filter(b => Number(b.variancePercent || 0) >= 90).length;
      const alertsTriggered = budgets.filter(b => b.alertTriggered).length;

      res.json({
        totalItems: budgets.length,
        totalBudgetedCost,
        totalActualCost,
        variance: totalActualCost - totalBudgetedCost,
        variancePercent: totalBudgetedCost > 0 ? ((totalActualCost / totalBudgetedCost) * 100).toFixed(2) : 0,
        itemsAtRisk,
        alertsTriggered,
      });
    } catch (error) {
      console.error("Get material budget summary error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get material usage entries for a project
  app.get("/api/projects/:projectId/material-usage", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const { projectMaterialUsage, scopeItems: scopeItemsTable } = await import("@shared/schema");
      
      const usage = await db
        .select({
          usage: projectMaterialUsage,
          scopeItem: {
            id: scopeItemsTable.id,
            description: scopeItemsTable.description,
            unit: scopeItemsTable.unit,
          },
          createdBy: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
          }
        })
        .from(projectMaterialUsage)
        .leftJoin(scopeItemsTable, eq(projectMaterialUsage.scopeItemId, scopeItemsTable.id))
        .leftJoin(users, eq(projectMaterialUsage.createdById, users.id))
        .where(eq(projectMaterialUsage.projectId, req.params.projectId))
        .orderBy(desc(projectMaterialUsage.usageDate), desc(projectMaterialUsage.createdAt));

      res.json(usage);
    } catch (error) {
      console.error("Get material usage error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create material usage entry (and update budget tracking)
  app.post("/api/projects/:projectId/material-usage", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const { projectMaterialUsage, projectMaterialBudgets, insertProjectMaterialUsageSchema } = await import("@shared/schema");
      
      // Validate input
      const validationResult = insertProjectMaterialUsageSchema.safeParse({
        ...req.body,
        projectId: req.params.projectId,
        createdById: req.user!.id,
      });

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Calculate total cost if not provided
      const data = validationResult.data;
      if (!data.totalCost && data.quantityUsed && data.unitCost) {
        data.totalCost = (Number(data.quantityUsed) * Number(data.unitCost)).toFixed(2);
      }

      // Insert usage entry
      const [newUsage] = await db.insert(projectMaterialUsage).values(data).returning();

      // Update material budget if linked
      if (data.materialBudgetId) {
        // Get all usage for this budget to recalculate
        const allUsage = await db
          .select()
          .from(projectMaterialUsage)
          .where(eq(projectMaterialUsage.materialBudgetId, data.materialBudgetId));

        const totalQuantityUsed = allUsage.reduce((sum, u) => sum + Number(u.quantityUsed || 0), 0);
        const totalCostUsed = allUsage.reduce((sum, u) => sum + Number(u.totalCost || 0), 0);

        // Get budget to calculate variance
        const [budget] = await db
          .select()
          .from(projectMaterialBudgets)
          .where(eq(projectMaterialBudgets.id, data.materialBudgetId));

        if (budget) {
          const budgetedQty = Number(budget.budgetedQuantity || 0);
          const varianceQty = totalQuantityUsed - budgetedQty;
          const variancePercent = budgetedQty > 0 ? (totalQuantityUsed / budgetedQty) * 100 : 0;
          const shouldAlert = variancePercent >= Number(budget.alertThresholdPercent || 90);
          const alertJustTriggered = shouldAlert && !budget.alertTriggered;

          await db
            .update(projectMaterialBudgets)
            .set({
              actualQuantityUsed: totalQuantityUsed.toString(),
              actualTotalCost: totalCostUsed.toString(),
              varianceQuantity: varianceQty.toString(),
              variancePercent: variancePercent.toFixed(2),
              alertTriggered: shouldAlert,
              alertTriggeredAt: alertJustTriggered ? new Date() : budget.alertTriggeredAt,
              updatedAt: new Date(),
            })
            .where(eq(projectMaterialBudgets.id, data.materialBudgetId));

          // Create notification if alert just triggered
          if (alertJustTriggered) {
            try {
              // Get project details
              const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId));
              if (project) {
                // Notify admins and managers about material overage
                const mgrConditions: SQL[] = [sql`${users.role} IN ('ADMIN', 'MANAGER', 'OFFICE_MANAGER')`];
                if (project.gcOrganizationId) {
                  mgrConditions.push(eq(users.organizationId, project.gcOrganizationId));
                }
                const managers = await db.select().from(users).where(and(...mgrConditions));
                
                for (const manager of managers) {
                  await db.insert(notifications).values({
                    userId: manager.id,
                    type: "MATERIAL_OVERAGE",
                    title: "Material Budget Alert",
                    message: `${budget.description} on project ${project.name} (${project.code}) has reached ${variancePercent.toFixed(1)}% of budgeted quantity. Consider a change order.`,
                    relatedEntityType: "PROJECT",
                    relatedEntityId: req.params.projectId,
                  });
                }
              }
            } catch (notifError) {
              console.error("Failed to create material alert notification:", notifError);
            }
          }
        }
      }

      res.status(201).json(newUsage);
    } catch (error) {
      console.error("Create material usage error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update material usage entry
  app.patch("/api/projects/:projectId/material-usage/:usageId", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const { projectMaterialUsage, projectMaterialBudgets } = await import("@shared/schema");
      
      const [existing] = await db
        .select()
        .from(projectMaterialUsage)
        .where(eq(projectMaterialUsage.id, req.params.usageId));

      if (!existing) {
        res.status(404).json({ error: "Usage entry not found" });
        return;
      }

      // SECURITY: Verify usage entry belongs to the project in the URL (prevent parameter spoofing)
      if (existing.projectId !== req.params.projectId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Check permissions
      const isCreator = existing.createdById === req.user!.id;
      const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
      if (!isCreator && !isAuthorized) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      // Update the entry
      const updateData = {
        ...req.body,
        updatedAt: new Date(),
      };

      // Recalculate total cost if quantity or unit cost changed
      if (updateData.quantityUsed || updateData.unitCost) {
        const qty = updateData.quantityUsed || existing.quantityUsed;
        const cost = updateData.unitCost || existing.unitCost;
        updateData.totalCost = (Number(qty) * Number(cost)).toFixed(2);
      }

      const [updated] = await db
        .update(projectMaterialUsage)
        .set(updateData)
        .where(eq(projectMaterialUsage.id, req.params.usageId))
        .returning();

      // Recalculate budget totals if linked
      const budgetId = updated.materialBudgetId || existing.materialBudgetId;
      if (budgetId) {
        const allUsage = await db
          .select()
          .from(projectMaterialUsage)
          .where(eq(projectMaterialUsage.materialBudgetId, budgetId));

        const totalQuantityUsed = allUsage.reduce((sum, u) => sum + Number(u.quantityUsed || 0), 0);
        const totalCostUsed = allUsage.reduce((sum, u) => sum + Number(u.totalCost || 0), 0);

        const [budget] = await db.select().from(projectMaterialBudgets).where(eq(projectMaterialBudgets.id, budgetId));
        if (budget) {
          const budgetedQty = Number(budget.budgetedQuantity || 0);
          const variancePercent = budgetedQty > 0 ? (totalQuantityUsed / budgetedQty) * 100 : 0;

          await db.update(projectMaterialBudgets).set({
            actualQuantityUsed: totalQuantityUsed.toString(),
            actualTotalCost: totalCostUsed.toString(),
            varianceQuantity: (totalQuantityUsed - budgetedQty).toString(),
            variancePercent: variancePercent.toFixed(2),
            alertTriggered: variancePercent >= Number(budget.alertThresholdPercent || 90),
            updatedAt: new Date(),
          }).where(eq(projectMaterialBudgets.id, budgetId));
        }
      }

      res.json(updated);
    } catch (error) {
      console.error("Update material usage error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete material usage entry
  app.delete("/api/projects/:projectId/material-usage/:usageId", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Verify org access
      const [project] = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).limit(1);
      if (!project) { res.status(404).json({ error: "Project not found" }); return; }
      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const { projectMaterialUsage, projectMaterialBudgets } = await import("@shared/schema");
      
      const [existing] = await db
        .select()
        .from(projectMaterialUsage)
        .where(eq(projectMaterialUsage.id, req.params.usageId));

      if (!existing) {
        res.status(404).json({ error: "Usage entry not found" });
        return;
      }

      // SECURITY: Verify usage entry belongs to the project in the URL (prevent parameter spoofing)
      if (existing.projectId !== req.params.projectId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      const isCreator = existing.createdById === req.user!.id;
      const isAuthorized = ["ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(req.user!.role);
      if (!isCreator && !isAuthorized) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }

      const budgetId = existing.materialBudgetId;

      await db.delete(projectMaterialUsage).where(eq(projectMaterialUsage.id, req.params.usageId));

      // Recalculate budget totals if linked
      if (budgetId) {
        const allUsage = await db
          .select()
          .from(projectMaterialUsage)
          .where(eq(projectMaterialUsage.materialBudgetId, budgetId));

        const totalQuantityUsed = allUsage.reduce((sum, u) => sum + Number(u.quantityUsed || 0), 0);
        const totalCostUsed = allUsage.reduce((sum, u) => sum + Number(u.totalCost || 0), 0);

        const [budget] = await db.select().from(projectMaterialBudgets).where(eq(projectMaterialBudgets.id, budgetId));
        if (budget) {
          const budgetedQty = Number(budget.budgetedQuantity || 0);
          const variancePercent = budgetedQty > 0 ? (totalQuantityUsed / budgetedQty) * 100 : 0;

          await db.update(projectMaterialBudgets).set({
            actualQuantityUsed: totalQuantityUsed.toString(),
            actualTotalCost: totalCostUsed.toString(),
            varianceQuantity: (totalQuantityUsed - budgetedQty).toString(),
            variancePercent: variancePercent.toFixed(2),
            alertTriggered: variancePercent >= Number(budget.alertThresholdPercent || 90),
            updatedAt: new Date(),
          }).where(eq(projectMaterialBudgets.id, budgetId));
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete material usage error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============================
  // Production Rate Tracking Routes
  // =============================
  // Aggregates daily scope progress to calculate average production rates by SOW type
  // Used for bidding and estimating based on historical performance

  // Get production rates for all SOW types (ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT)
  app.get("/api/production-rates", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, projectCode, unit } = req.query;
      
      // SECURITY: Multi-tenant isolation - get user's organization filter
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.json({ rates: [], summary: { totalSOWTypes: 0, totalWorkDays: 0, totalProjects: 0, totalEntries: 0 }, availableUnits: [] });
      }
      
      // Build base query joining dailyScopeProgress with scopeItems
      let query = db
        .select({
          description: scopeItems.description,
          unit: scopeItems.unit,
          projectId: dailyScopeProgress.projectId,
          projectCode: projects.code,
          projectName: projects.name,
          workDate: dailyScopeProgress.workDate,
          quantityCompleted: dailyScopeProgress.quantityCompleted,
        })
        .from(dailyScopeProgress)
        .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
        .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id));
      
      // Apply filters - always include organization filter for multi-tenant security
      const conditions: any[] = [];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      if (startDate) {
        conditions.push(sql`${dailyScopeProgress.workDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${dailyScopeProgress.workDate} <= ${endDate}`);
      }
      if (projectCode) {
        conditions.push(eq(projects.code, projectCode as string));
      }
      if (unit) {
        conditions.push(eq(scopeItems.unit, unit as string));
      }
      
      let results;
      if (conditions.length > 0) {
        results = await query.where(and(...conditions));
      } else {
        results = await query;
      }
      
      // Group by description + unit, then aggregate daily totals for accurate statistics
      const ratesBySOW = new Map<string, {
        description: string;
        unit: string;
        totalQuantity: number;
        projectCodes: Set<string>;
        dailyTotals: Map<string, number>; // date -> total qty for that day
        entryCount: number;
      }>();
      
      for (const entry of results) {
        const key = `${entry.description}|||${entry.unit}`;
        const qty = parseFloat(entry.quantityCompleted);
        const dateKey = entry.workDate;
        
        if (!ratesBySOW.has(key)) {
          ratesBySOW.set(key, {
            description: entry.description,
            unit: entry.unit,
            totalQuantity: 0,
            projectCodes: new Set(),
            dailyTotals: new Map(),
            entryCount: 0,
          });
        }
        
        const sow = ratesBySOW.get(key)!;
        sow.totalQuantity += qty;
        sow.projectCodes.add(entry.projectCode);
        sow.entryCount += 1;
        
        // Aggregate daily totals (sum all entries for the same day)
        const currentDayTotal = sow.dailyTotals.get(dateKey) || 0;
        sow.dailyTotals.set(dateKey, currentDayTotal + qty);
      }
      
      // Calculate final statistics using daily totals (not per-entry)
      const productionRates = Array.from(ratesBySOW.values()).map(sow => {
        // Get array of daily totals for statistics
        const dailyTotalsArray = Array.from(sow.dailyTotals.values());
        const sortedDailyTotals = [...dailyTotalsArray].sort((a, b) => a - b);
        const totalDays = sow.dailyTotals.size;
        const avgPerDay = totalDays > 0 ? sow.totalQuantity / totalDays : 0;
        const minPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[0] : 0;
        const maxPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[sortedDailyTotals.length - 1] : 0;
        
        // Calculate median from daily totals
        let medianPerDay = 0;
        if (sortedDailyTotals.length > 0) {
          const mid = Math.floor(sortedDailyTotals.length / 2);
          medianPerDay = sortedDailyTotals.length % 2 !== 0 
            ? sortedDailyTotals[mid] 
            : (sortedDailyTotals[mid - 1] + sortedDailyTotals[mid]) / 2;
        }
        
        // Calculate standard deviation from daily totals
        let stdDev = 0;
        if (sortedDailyTotals.length > 1) {
          const variance = sortedDailyTotals.reduce((sum, dayTotal) => sum + Math.pow(dayTotal - avgPerDay, 2), 0) / sortedDailyTotals.length;
          stdDev = Math.sqrt(variance);
        }
        
        return {
          description: sow.description,
          unit: sow.unit,
          totalQuantity: Math.round(sow.totalQuantity * 100) / 100,
          totalDays,
          totalProjects: sow.projectCodes.size,
          avgPerDay: Math.round(avgPerDay * 100) / 100,
          minPerDay: Math.round(minPerDay * 100) / 100,
          maxPerDay: Math.round(maxPerDay * 100) / 100,
          medianPerDay: Math.round(medianPerDay * 100) / 100,
          stdDev: Math.round(stdDev * 100) / 100,
          entryCount: sow.entryCount,
        };
      });
      
      // Sort by total quantity descending (most common work types first)
      productionRates.sort((a, b) => b.totalQuantity - a.totalQuantity);
      
      // Calculate summary stats
      const summary = {
        totalSOWTypes: productionRates.length,
        totalWorkDays: new Set(results.map(r => r.workDate)).size,
        totalProjects: new Set(results.map(r => r.projectCode)).size,
        totalEntries: results.length,
      };
      
      // Get distinct units for filtering
      const availableUnits = Array.from(new Set(productionRates.map(r => r.unit))).sort();
      
      res.json({
        rates: productionRates,
        summary,
        availableUnits,
      });
    } catch (error) {
      console.error("Get production rates error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get production rate details for a specific SOW type
  app.get("/api/production-rates/detail", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { description, unit, startDate, endDate } = req.query;
      
      if (!description || !unit) {
        res.status(400).json({ error: "Description and unit are required" });
        return;
      }
      
      // SECURITY: Multi-tenant isolation - get user's organization filter
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.json({ entries: [], dailySummary: [], projectStats: [], aggregates: { totalQuantity: 0, totalDays: 0, totalProjects: 0, avgPerDay: 0 } });
      }
      
      // Build conditions array including org filter
      const conditions: any[] = [
        eq(scopeItems.description, description as string),
        eq(scopeItems.unit, unit as string)
      ];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      // Get all entries for this SOW type
      let query = db
        .select({
          id: dailyScopeProgress.id,
          workDate: dailyScopeProgress.workDate,
          quantityCompleted: dailyScopeProgress.quantityCompleted,
          notes: dailyScopeProgress.notes,
          projectCode: projects.code,
          projectName: projects.name,
          creatorFirstName: users.firstName,
          creatorLastName: users.lastName,
        })
        .from(dailyScopeProgress)
        .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
        .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
        .leftJoin(users, eq(dailyScopeProgress.createdById, users.id))
        .where(and(...conditions))
        .orderBy(desc(dailyScopeProgress.workDate));
      
      let results = await query;
      
      // Apply date filters if provided
      if (startDate) {
        results = results.filter(r => r.workDate >= (startDate as string));
      }
      if (endDate) {
        results = results.filter(r => r.workDate <= (endDate as string));
      }
      
      // Group by date for daily totals
      const dailyTotals = new Map<string, { total: number; projects: Set<string> }>();
      for (const entry of results) {
        const dateKey = entry.workDate;
        if (!dailyTotals.has(dateKey)) {
          dailyTotals.set(dateKey, { total: 0, projects: new Set() });
        }
        const day = dailyTotals.get(dateKey)!;
        day.total += parseFloat(entry.quantityCompleted);
        day.projects.add(entry.projectCode);
      }
      
      // Group by project for project-level stats - track days during single loop
      const projectStats = new Map<string, { 
        code: string; 
        name: string; 
        totalQuantity: number; 
        workDates: Set<string>;
        entries: number 
      }>();
      
      for (const entry of results) {
        if (!projectStats.has(entry.projectCode)) {
          projectStats.set(entry.projectCode, {
            code: entry.projectCode,
            name: entry.projectName,
            totalQuantity: 0,
            workDates: new Set(),
            entries: 0,
          });
        }
        const proj = projectStats.get(entry.projectCode)!;
        proj.totalQuantity += parseFloat(entry.quantityCompleted);
        proj.workDates.add(entry.workDate);
        proj.entries += 1;
      }
      
      const dailyTotalsArray = Array.from(dailyTotals.entries())
        .map(([date, data]) => ({
          date,
          total: Math.round(data.total * 100) / 100,
          projectCount: data.projects.size,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
      
      res.json({
        description,
        unit,
        entries: results.map(r => ({
          id: r.id,
          workDate: r.workDate,
          quantity: parseFloat(r.quantityCompleted),
          notes: r.notes,
          projectCode: r.projectCode,
          projectName: r.projectName,
          createdBy: r.creatorFirstName && r.creatorLastName 
            ? `${r.creatorFirstName} ${r.creatorLastName}` 
            : 'Unknown',
        })),
        dailyTotals: dailyTotalsArray,
        projectStats: Array.from(projectStats.values()).map(p => {
          const days = p.workDates.size;
          return {
            code: p.code,
            name: p.name,
            totalQuantity: Math.round(p.totalQuantity * 100) / 100,
            days,
            entries: p.entries,
            avgPerDay: days > 0 ? Math.round((p.totalQuantity / days) * 100) / 100 : 0,
          };
        }),
      });
    } catch (error) {
      console.error("Get production rate detail error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Extended production rates including T&M and Change Order scope data
  // Aggregates workTypeCode data from all sources for unified production tracking
  app.get("/api/production-rates/unified", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, projectCode, source } = req.query;
      
      // SECURITY: Multi-tenant isolation - get user's organization filter
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.json({ rates: [], ratesByWorkType: [], summary: { totalWorkTypes: 0, totalEntries: 0, totalProjects: 0 } });
      }
      
      // Results from all sources
      const unifiedRates: {
        workTypeCode: string;
        workTypeName: string;
        categoryName: string;
        unit: string;
        source: 'SCOPE_PROGRESS' | 'TM_TICKET' | 'CHANGE_ORDER';
        quantity: number;
        projectCode: string;
        projectName: string;
        workDate: string | null;
        entryId: string;
      }[] = [];

      // 1. Get scope progress data (existing system)
      if (!source || source === 'SCOPE_PROGRESS' || source === 'ALL') {
        // Build conditions with org filter
        const scopeConditions: any[] = [];
        if (shouldFilter && orgId) {
          scopeConditions.push(eq(projects.gcOrganizationId, orgId));
        }
        
        const scopeQuery = scopeConditions.length > 0 
          ? db
              .select({
                id: dailyScopeProgress.id,
                description: scopeItems.description,
                unit: scopeItems.unit,
                projectCode: projects.code,
                projectName: projects.name,
                workDate: dailyScopeProgress.workDate,
                quantityCompleted: dailyScopeProgress.quantityCompleted,
              })
              .from(dailyScopeProgress)
              .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
              .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
              .where(and(...scopeConditions))
              .limit(2000)
          : db
              .select({
                id: dailyScopeProgress.id,
                description: scopeItems.description,
                unit: scopeItems.unit,
                projectCode: projects.code,
                projectName: projects.name,
                workDate: dailyScopeProgress.workDate,
                quantityCompleted: dailyScopeProgress.quantityCompleted,
              })
              .from(dailyScopeProgress)
              .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
              .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
              .limit(2000);
        
        const scopeResults = await scopeQuery;

        for (const r of scopeResults) {
          if (startDate && r.workDate < startDate) continue;
          if (endDate && r.workDate > endDate) continue;
          if (projectCode && r.projectCode !== projectCode) continue;

          unifiedRates.push({
            workTypeCode: r.description, // Use description as code for scope items
            workTypeName: r.description,
            categoryName: 'Scope Progress',
            unit: r.unit,
            source: 'SCOPE_PROGRESS',
            quantity: parseFloat(r.quantityCompleted),
            projectCode: r.projectCode,
            projectName: r.projectName,
            workDate: r.workDate,
            entryId: r.id,
          });
        }
      }

      // 2. Get T&M ticket scope data (using workTypeCode)
      if (!source || source === 'TM_TICKET' || source === 'ALL') {
        // Build conditions with org filter
        const tmConditions: any[] = [sql`${tmTickets.workTypeCode} IS NOT NULL`];
        if (shouldFilter && orgId) {
          tmConditions.push(eq(projects.gcOrganizationId, orgId));
        }
        
        const tmResults = await db
          .select({
            id: tmTickets.id,
            workTypeCode: tmTickets.workTypeCode,
            workTypeName: tmTickets.workTypeName,
            categoryName: tmTickets.categoryName,
            scopeUnit: tmTickets.scopeUnit,
            scopeQuantity: tmTickets.scopeQuantity,
            projectCode: projects.code,
            projectName: projects.name,
            workDate: tmTickets.workDate,
            status: tmTickets.status,
          })
          .from(tmTickets)
          .innerJoin(projects, eq(tmTickets.projectId, projects.id))
          .where(and(...tmConditions))
          .limit(2000);

        for (const r of tmResults) {
          if (startDate && r.workDate < startDate) continue;
          if (endDate && r.workDate > endDate) continue;
          if (projectCode && r.projectCode !== projectCode) continue;
          if (!r.scopeQuantity) continue;

          unifiedRates.push({
            workTypeCode: r.workTypeCode!,
            workTypeName: r.workTypeName || r.workTypeCode!,
            categoryName: r.categoryName || 'T&M Work',
            unit: r.scopeUnit || 'EA',
            source: 'TM_TICKET',
            quantity: parseFloat(r.scopeQuantity),
            projectCode: r.projectCode,
            projectName: r.projectName,
            workDate: r.workDate,
            entryId: r.id,
          });
        }
      }

      // 3. Get Change Order scope data (using workTypeCode)
      if (!source || source === 'CHANGE_ORDER' || source === 'ALL') {
        // Build conditions with org filter
        const coConditions: any[] = [sql`${changeOrders.workTypeCode} IS NOT NULL`];
        if (shouldFilter && orgId) {
          coConditions.push(eq(projects.gcOrganizationId, orgId));
        }
        
        const coResults = await db
          .select({
            id: changeOrders.id,
            workTypeCode: changeOrders.workTypeCode,
            workTypeName: changeOrders.workTypeName,
            categoryName: changeOrders.categoryName,
            scopeUnit: changeOrders.scopeUnit,
            scopeQuantity: changeOrders.scopeQuantity,
            projectCode: projects.code,
            projectName: projects.name,
            createdAt: changeOrders.createdAt,
            status: changeOrders.status,
          })
          .from(changeOrders)
          .innerJoin(projects, eq(changeOrders.projectId, projects.id))
          .where(and(...coConditions))
          .limit(2000);

        for (const r of coResults) {
          const workDate = r.createdAt ? r.createdAt.toISOString().split('T')[0] : null;
          if (startDate && workDate && workDate < startDate) continue;
          if (endDate && workDate && workDate > endDate) continue;
          if (projectCode && r.projectCode !== projectCode) continue;
          if (!r.scopeQuantity) continue;

          unifiedRates.push({
            workTypeCode: r.workTypeCode!,
            workTypeName: r.workTypeName || r.workTypeCode!,
            categoryName: r.categoryName || 'Change Order',
            unit: r.scopeUnit || 'EA',
            source: 'CHANGE_ORDER',
            quantity: parseFloat(r.scopeQuantity),
            projectCode: r.projectCode,
            projectName: r.projectName,
            workDate,
            entryId: r.id,
          });
        }
      }

      // Aggregate by workTypeCode and unit
      const aggregated = new Map<string, {
        workTypeCode: string;
        workTypeName: string;
        categoryName: string;
        unit: string;
        totalQuantity: number;
        sources: { SCOPE_PROGRESS: number; TM_TICKET: number; CHANGE_ORDER: number };
        projectCodes: Set<string>;
        dailyTotals: Map<string, number>;
        entryCount: number;
      }>();

      for (const entry of unifiedRates) {
        const key = `${entry.workTypeCode}|||${entry.unit}`;
        
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            workTypeCode: entry.workTypeCode,
            workTypeName: entry.workTypeName,
            categoryName: entry.categoryName,
            unit: entry.unit,
            totalQuantity: 0,
            sources: { SCOPE_PROGRESS: 0, TM_TICKET: 0, CHANGE_ORDER: 0 },
            projectCodes: new Set(),
            dailyTotals: new Map(),
            entryCount: 0,
          });
        }

        const agg = aggregated.get(key)!;
        agg.totalQuantity += entry.quantity;
        agg.sources[entry.source] += entry.quantity;
        agg.projectCodes.add(entry.projectCode);
        agg.entryCount += 1;

        if (entry.workDate) {
          const currentDayTotal = agg.dailyTotals.get(entry.workDate) || 0;
          agg.dailyTotals.set(entry.workDate, currentDayTotal + entry.quantity);
        }
      }

      // Calculate statistics
      const rates = Array.from(aggregated.values()).map(agg => {
        const dailyTotalsArray = Array.from(agg.dailyTotals.values());
        const sortedDailyTotals = [...dailyTotalsArray].sort((a, b) => a - b);
        const totalDays = agg.dailyTotals.size;
        const avgPerDay = totalDays > 0 ? agg.totalQuantity / totalDays : 0;
        const minPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[0] : 0;
        const maxPerDay = sortedDailyTotals.length > 0 ? sortedDailyTotals[sortedDailyTotals.length - 1] : 0;

        let medianPerDay = 0;
        if (sortedDailyTotals.length > 0) {
          const mid = Math.floor(sortedDailyTotals.length / 2);
          medianPerDay = sortedDailyTotals.length % 2 !== 0 
            ? sortedDailyTotals[mid] 
            : (sortedDailyTotals[mid - 1] + sortedDailyTotals[mid]) / 2;
        }

        return {
          workTypeCode: agg.workTypeCode,
          workTypeName: agg.workTypeName,
          categoryName: agg.categoryName,
          unit: agg.unit,
          totalQuantity: Math.round(agg.totalQuantity * 100) / 100,
          totalDays,
          totalProjects: agg.projectCodes.size,
          avgPerDay: Math.round(avgPerDay * 100) / 100,
          minPerDay: Math.round(minPerDay * 100) / 100,
          maxPerDay: Math.round(maxPerDay * 100) / 100,
          medianPerDay: Math.round(medianPerDay * 100) / 100,
          entryCount: agg.entryCount,
          sourceBreakdown: {
            scopeProgress: Math.round(agg.sources.SCOPE_PROGRESS * 100) / 100,
            tmTickets: Math.round(agg.sources.TM_TICKET * 100) / 100,
            changeOrders: Math.round(agg.sources.CHANGE_ORDER * 100) / 100,
          },
        };
      });

      // Sort by total quantity descending
      rates.sort((a, b) => b.totalQuantity - a.totalQuantity);

      // Summary stats
      const summary = {
        totalWorkTypes: rates.length,
        totalEntries: unifiedRates.length,
        totalProjects: new Set(unifiedRates.map(r => r.projectCode)).size,
        bySource: {
          scopeProgress: unifiedRates.filter(r => r.source === 'SCOPE_PROGRESS').length,
          tmTickets: unifiedRates.filter(r => r.source === 'TM_TICKET').length,
          changeOrders: unifiedRates.filter(r => r.source === 'CHANGE_ORDER').length,
        },
      };

      const availableUnits = Array.from(new Set(rates.map(r => r.unit))).sort();
      const availableCategories = Array.from(new Set(rates.map(r => r.categoryName))).sort();

      res.json({
        rates,
        summary,
        availableUnits,
        availableCategories,
      });
    } catch (error) {
      console.error("Get unified production rates error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Enhanced production rates with full cost and profitability metrics
  // Returns labor hours/cost, material cost, total cost, profit per unit
  app.get("/api/production-rates/metrics", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { description, unit, startDate, endDate, projectCode, minQuantity, maxQuantity } = req.query;
      
      // SECURITY: Multi-tenant isolation
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.json({ 
          rates: [], 
          summary: { 
            totalSOWTypes: 0, 
            totalQuantity: 0,
            totalLaborHours: 0, 
            totalLaborCost: 0, 
            totalMaterialCost: 0,
            totalCost: 0 
          } 
        });
      }

      // Build query for daily scope progress with cost metrics
      const conditions: any[] = [];
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      if (description) {
        conditions.push(sql`LOWER(${scopeItems.description}) LIKE LOWER(${'%' + description + '%'})`);
      }
      if (unit) {
        conditions.push(eq(scopeItems.unit, unit as string));
      }
      if (startDate) {
        conditions.push(sql`${dailyScopeProgress.workDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${dailyScopeProgress.workDate} <= ${endDate}`);
      }
      if (projectCode) {
        conditions.push(eq(projects.code, projectCode as string));
      }

      const results = await db
        .select({
          description: scopeItems.description,
          unit: scopeItems.unit,
          unitPrice: scopeItems.unitPrice,
          projectCode: projects.code,
          projectName: projects.name,
          workDate: dailyScopeProgress.workDate,
          quantityCompleted: dailyScopeProgress.quantityCompleted,
          laborHours: dailyScopeProgress.laborHours,
          laborCost: dailyScopeProgress.laborCost,
          materialCost: dailyScopeProgress.materialCost,
          equipmentCost: dailyScopeProgress.equipmentCost,
          crewSize: dailyScopeProgress.crewSize,
          laborHoursPerUnit: dailyScopeProgress.laborHoursPerUnit,
          laborCostPerUnit: dailyScopeProgress.laborCostPerUnit,
          materialCostPerUnit: dailyScopeProgress.materialCostPerUnit,
          totalCostPerUnit: dailyScopeProgress.totalCostPerUnit,
        })
        .from(dailyScopeProgress)
        .innerJoin(scopeItems, eq(dailyScopeProgress.scopeItemId, scopeItems.id))
        .innerJoin(projects, eq(dailyScopeProgress.projectId, projects.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(5000);

      // Filter by quantity range if specified
      let filteredResults = results;
      if (minQuantity || maxQuantity) {
        filteredResults = results.filter(r => {
          const qty = parseFloat(r.quantityCompleted);
          if (minQuantity && qty < parseFloat(minQuantity as string)) return false;
          if (maxQuantity && qty > parseFloat(maxQuantity as string)) return false;
          return true;
        });
      }

      // Aggregate by description + unit
      const aggregated = new Map<string, {
        description: string;
        unit: string;
        avgUnitPrice: number;
        unitPriceCount: number;
        totalQuantity: number;
        totalLaborHours: number;
        totalLaborCost: number;
        totalMaterialCost: number;
        totalEquipmentCost: number;
        crewSizes: number[];
        projectCodes: Set<string>;
        workDates: Set<string>;
        laborHoursPerUnit: number[];
        laborCostPerUnit: number[];
        materialCostPerUnit: number[];
        totalCostPerUnit: number[];
      }>();

      for (const entry of filteredResults) {
        const key = `${entry.description}|||${entry.unit}`;
        
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            description: entry.description,
            unit: entry.unit,
            avgUnitPrice: 0,
            unitPriceCount: 0,
            totalQuantity: 0,
            totalLaborHours: 0,
            totalLaborCost: 0,
            totalMaterialCost: 0,
            totalEquipmentCost: 0,
            crewSizes: [],
            projectCodes: new Set(),
            workDates: new Set(),
            laborHoursPerUnit: [],
            laborCostPerUnit: [],
            materialCostPerUnit: [],
            totalCostPerUnit: [],
          });
        }

        const agg = aggregated.get(key)!;
        const qty = parseFloat(entry.quantityCompleted) || 0;
        agg.totalQuantity += qty;
        
        if (entry.laborHours) agg.totalLaborHours += parseFloat(entry.laborHours);
        if (entry.laborCost) agg.totalLaborCost += parseFloat(entry.laborCost);
        if (entry.materialCost) agg.totalMaterialCost += parseFloat(entry.materialCost);
        if (entry.equipmentCost) agg.totalEquipmentCost += parseFloat(entry.equipmentCost);
        if (entry.crewSize) agg.crewSizes.push(entry.crewSize);
        if (entry.unitPrice) {
          agg.avgUnitPrice += parseFloat(entry.unitPrice);
          agg.unitPriceCount += 1;
        }
        if (entry.laborHoursPerUnit) agg.laborHoursPerUnit.push(parseFloat(entry.laborHoursPerUnit));
        if (entry.laborCostPerUnit) agg.laborCostPerUnit.push(parseFloat(entry.laborCostPerUnit));
        if (entry.materialCostPerUnit) agg.materialCostPerUnit.push(parseFloat(entry.materialCostPerUnit));
        if (entry.totalCostPerUnit) agg.totalCostPerUnit.push(parseFloat(entry.totalCostPerUnit));
        
        agg.projectCodes.add(entry.projectCode);
        agg.workDates.add(entry.workDate);
      }

      // Calculate final metrics
      const rates = Array.from(aggregated.values()).map(agg => {
        const totalCost = agg.totalLaborCost + agg.totalMaterialCost + agg.totalEquipmentCost;
        const avgUnitPrice = agg.unitPriceCount > 0 ? agg.avgUnitPrice / agg.unitPriceCount : 0;
        
        // Calculate per-unit averages from stored values or compute from totals
        const avgLaborHoursPerUnit = agg.laborHoursPerUnit.length > 0
          ? agg.laborHoursPerUnit.reduce((a, b) => a + b, 0) / agg.laborHoursPerUnit.length
          : (agg.totalQuantity > 0 ? agg.totalLaborHours / agg.totalQuantity : 0);
        
        const avgLaborCostPerUnit = agg.laborCostPerUnit.length > 0
          ? agg.laborCostPerUnit.reduce((a, b) => a + b, 0) / agg.laborCostPerUnit.length
          : (agg.totalQuantity > 0 ? agg.totalLaborCost / agg.totalQuantity : 0);
        
        const avgMaterialCostPerUnit = agg.materialCostPerUnit.length > 0
          ? agg.materialCostPerUnit.reduce((a, b) => a + b, 0) / agg.materialCostPerUnit.length
          : (agg.totalQuantity > 0 ? agg.totalMaterialCost / agg.totalQuantity : 0);
        
        const avgEquipmentCostPerUnit = agg.totalQuantity > 0 ? agg.totalEquipmentCost / agg.totalQuantity : 0;
        const avgTotalCostPerUnit = avgLaborCostPerUnit + avgMaterialCostPerUnit + avgEquipmentCostPerUnit;
        
        const avgProfitPerUnit = avgUnitPrice - avgTotalCostPerUnit;
        const profitMargin = avgUnitPrice > 0 ? (avgProfitPerUnit / avgUnitPrice) * 100 : 0;
        
        const avgCrewSize = agg.crewSizes.length > 0 
          ? agg.crewSizes.reduce((a, b) => a + b, 0) / agg.crewSizes.length 
          : 0;
        
        const totalDays = agg.workDates.size;
        const avgQuantityPerDay = totalDays > 0 ? agg.totalQuantity / totalDays : 0;
        
        // Determine confidence
        let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
        const totalProjects = agg.projectCodes.size;
        if (totalDays >= 10 && totalProjects >= 3) confidence = 'HIGH';
        else if (totalDays >= 5 && totalProjects >= 2) confidence = 'MEDIUM';
        else if (totalDays >= 2) confidence = 'LOW';

        return {
          description: agg.description,
          unit: agg.unit,
          // Productivity metrics
          totalQuantity: Math.round(agg.totalQuantity * 100) / 100,
          avgQuantityPerDay: Math.round(avgQuantityPerDay * 100) / 100,
          avgCrewSize: Math.round(avgCrewSize * 10) / 10,
          // Labor metrics
          totalLaborHours: Math.round(agg.totalLaborHours * 100) / 100,
          totalLaborCost: Math.round(agg.totalLaborCost * 100) / 100,
          avgLaborHoursPerUnit: Math.round(avgLaborHoursPerUnit * 1000) / 1000,
          avgLaborCostPerUnit: Math.round(avgLaborCostPerUnit * 100) / 100,
          // Material metrics
          totalMaterialCost: Math.round(agg.totalMaterialCost * 100) / 100,
          avgMaterialCostPerUnit: Math.round(avgMaterialCostPerUnit * 100) / 100,
          // Equipment metrics
          totalEquipmentCost: Math.round(agg.totalEquipmentCost * 100) / 100,
          avgEquipmentCostPerUnit: Math.round(avgEquipmentCostPerUnit * 100) / 100,
          // Total cost metrics
          totalCost: Math.round(totalCost * 100) / 100,
          avgTotalCostPerUnit: Math.round(avgTotalCostPerUnit * 100) / 100,
          // Profitability
          avgRevenuePerUnit: Math.round(avgUnitPrice * 100) / 100,
          avgProfitPerUnit: Math.round(avgProfitPerUnit * 100) / 100,
          profitMargin: Math.round(profitMargin * 10) / 10,
          // Statistics
          totalDays,
          totalProjects,
          confidence,
          hasLaborData: agg.totalLaborHours > 0,
          hasMaterialData: agg.totalMaterialCost > 0,
        };
      });

      // Sort by confidence then by data completeness
      rates.sort((a, b) => {
        const confidenceOrder = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };
        return confidenceOrder[a.confidence] - confidenceOrder[b.confidence] || b.totalDays - a.totalDays;
      });

      // Summary totals
      const summary = {
        totalSOWTypes: rates.length,
        totalQuantity: rates.reduce((sum, r) => sum + r.totalQuantity, 0),
        totalLaborHours: rates.reduce((sum, r) => sum + r.totalLaborHours, 0),
        totalLaborCost: rates.reduce((sum, r) => sum + r.totalLaborCost, 0),
        totalMaterialCost: rates.reduce((sum, r) => sum + r.totalMaterialCost, 0),
        totalEquipmentCost: rates.reduce((sum, r) => sum + r.totalEquipmentCost, 0),
        totalCost: rates.reduce((sum, r) => sum + r.totalCost, 0),
        totalProjects: new Set(filteredResults.map(r => r.projectCode)).size,
        ratesWithLaborData: rates.filter(r => r.hasLaborData).length,
        ratesWithMaterialData: rates.filter(r => r.hasMaterialData).length,
      };

      const availableUnits = Array.from(new Set(rates.map(r => r.unit))).sort();

      res.json({
        rates,
        summary,
        availableUnits,
      });
    } catch (error) {
      console.error("Get production rate metrics error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Estimate costs using production rate data
  // Query: "What will it cost to do 500 SF of 4" sidewalk?"
  app.get("/api/production-rates/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { description, unit, quantity } = req.query;
      
      if (!description || !unit || !quantity) {
        res.status(400).json({ error: "description, unit, and quantity are required" });
        return;
      }

      // SECURITY: Multi-tenant isolation
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { estimateLaborHoursFromProductionRate } = await import("./productionRateService");
      
      const estimate = await estimateLaborHoursFromProductionRate(
        description as string,
        unit as string,
        parseFloat(quantity as string),
        orgId || ""
      );

      res.json({
        description,
        unit,
        requestedQuantity: parseFloat(quantity as string),
        estimate: {
          suggestedLaborHours: estimate.suggestedLaborHours,
          suggestedLaborCost: estimate.suggestedLaborCost,
          suggestedMaterialCost: estimate.suggestedMaterialCost,
          suggestedTotalCost: estimate.suggestedTotalCost,
          laborHoursPerUnit: estimate.laborHoursPerUnit,
          laborCostPerUnit: estimate.laborCostPerUnit,
          materialCostPerUnit: estimate.materialCostPerUnit,
          totalCostPerUnit: estimate.totalCostPerUnit,
          productionRate: estimate.productionRateUsed,
          confidence: estimate.confidence,
          dataSource: estimate.dataSource,
        },
      });
    } catch (error) {
      console.error("Get production rate estimate error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // CRM Routes
  // ====================

  const { 
    crmOrganisations, crmContacts, crmOrganisationNotes,
    insertCrmOrganisationSchema, insertCrmContactSchema, insertCrmOrganisationNoteSchema 
  } = await import("@shared/schema");

  // List all CRM organisations with optional filters
  app.get("/api/crm/organisations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { type, search, active } = req.query;
      
      let query = db
        .select({
          id: crmOrganisations.id,
          organizationId: crmOrganisations.organizationId,
          type: crmOrganisations.type,
          name: crmOrganisations.name,
          address: crmOrganisations.address,
          city: crmOrganisations.city,
          state: crmOrganisations.state,
          zipCode: crmOrganisations.zipCode,
          website: crmOrganisations.website,
          specialties: crmOrganisations.specialties,
          insuranceExpiration: crmOrganisations.insuranceExpiration,
          wcInsuranceExpiration: crmOrganisations.wcInsuranceExpiration,
          licenseExpiration: crmOrganisations.licenseExpiration,
          paymentTerms: crmOrganisations.paymentTerms,
          notes: crmOrganisations.notes,
          isActive: crmOrganisations.isActive,
          createdAt: crmOrganisations.createdAt,
          updatedAt: crmOrganisations.updatedAt,
        })
        .from(crmOrganisations);
      
      const conditions: any[] = [];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      if (type) {
        conditions.push(sql`${crmOrganisations.type} = ${type}`);
      }
      if (active !== undefined) {
        conditions.push(eq(crmOrganisations.isActive, active === 'true'));
      }
      if (search) {
        conditions.push(
          sql`LOWER(${crmOrganisations.name}) LIKE LOWER(${'%' + search + '%'})`
        );
      }
      
      let results;
      if (conditions.length > 0) {
        results = await query.where(and(...conditions)).orderBy(crmOrganisations.name);
      } else {
        results = await query.orderBy(crmOrganisations.name);
      }
      
      res.json(results);
    } catch (error) {
      console.error("Get CRM organisations error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get single organisation with contacts
  app.get("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [eq(crmOrganisations.id, req.params.id)];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [organisation] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .limit(1);
      
      if (!organisation) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      const contacts = await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.organisationId, req.params.id))
        .orderBy(desc(crmContacts.isPrimary), crmContacts.lastName, crmContacts.firstName);
      
      res.json({ ...organisation, contacts });
    } catch (error) {
      console.error("Get CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create organisation (ADMIN, MANAGER, ESTIMATOR)
  app.post("/api/crm/organisations", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const validationResult = insertCrmOrganisationSchema.safeParse({
        ...req.body,
        organizationId: orgId,  // SECURITY: Set to user's organization
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      const [newOrg] = await db
        .insert(crmOrganisations)
        .values(validationResult.data)
        .returning();
      
      // Log to audit
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "crm_organisations",
        entityId: newOrg.id,
        newValue: JSON.stringify({ name: newOrg.name, type: newOrg.type }),
      });
      
      res.status(201).json(newOrg);
    } catch (error) {
      console.error("Create CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update organisation (ADMIN, MANAGER, ESTIMATOR)
  app.put("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [eq(crmOrganisations.id, req.params.id)];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      const validationResult = insertCrmOrganisationSchema.partial().safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      // SECURITY: Don't allow changing organizationId
      const { organizationId: _, ...safeData } = validationResult.data;
      
      const [updated] = await db
        .update(crmOrganisations)
        .set({
          ...safeData,
          updatedAt: new Date(),
        })
        .where(eq(crmOrganisations.id, req.params.id))
        .returning();
      
      // Log to audit
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "crm_organisations",
        entityId: updated.id,
        oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
        newValue: JSON.stringify({ name: updated.name, type: updated.type }),
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Update CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete organisation (ADMIN only)
  app.delete("/api/crm/organisations/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const conditions = [eq(crmOrganisations.id, req.params.id)];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      // SECURITY: Delete with organization filter applied
      await db.delete(crmOrganisations).where(and(...conditions));
      
      // Log to audit
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "crm_organisations",
        entityId: existing.id,
        oldValue: JSON.stringify({ name: existing.name, type: existing.type }),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete CRM organisation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get contacts for an organisation
  app.get("/api/crm/organisations/:id/contacts", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Verify the parent organisation belongs to user's org
      const orgConditions = [eq(crmOrganisations.id, req.params.id)];
      if (shouldFilter && orgId) {
        orgConditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [parentOrg] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...orgConditions))
        .limit(1);
      
      if (!parentOrg) {
        return res.status(404).json({ error: "Organisation not found" });
      }
      
      const contacts = await db
        .select()
        .from(crmContacts)
        .where(eq(crmContacts.organisationId, req.params.id))
        .orderBy(desc(crmContacts.isPrimary), crmContacts.lastName, crmContacts.firstName);
      
      res.json(contacts);
    } catch (error) {
      console.error("Get CRM contacts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create contact (ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT)
  app.post("/api/crm/contacts", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Verify the parent organisation belongs to user's org
      const orgConditions = [eq(crmOrganisations.id, req.body.organisationId)];
      if (shouldFilter && orgId) {
        orgConditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [parentOrg] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...orgConditions))
        .limit(1);
      
      if (!parentOrg) {
        return res.status(404).json({ error: "Parent organisation not found" });
      }
      
      const validationResult = insertCrmContactSchema.safeParse({
        ...req.body,
        organizationId: orgId,  // SECURITY: Set to user's organization
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      // If this is set as primary, unset other primaries for this org
      if (validationResult.data.isPrimary) {
        await db
          .update(crmContacts)
          .set({ isPrimary: false })
          .where(eq(crmContacts.organisationId, validationResult.data.organisationId));
      }
      
      const [newContact] = await db
        .insert(crmContacts)
        .values(validationResult.data)
        .returning();
      
      // Log to audit
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "crm_contacts",
        entityId: newContact.id,
        newValue: JSON.stringify({ firstName: newContact.firstName, lastName: newContact.lastName }),
      });
      
      res.status(201).json(newContact);
    } catch (error) {
      console.error("Create CRM contact error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update contact (ADMIN, MANAGER, ESTIMATOR)
  app.put("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Filter contact by organization
      const conditions = [eq(crmContacts.id, req.params.id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(crmContacts.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmContacts)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Contact not found" });
        return;
      }
      
      const validationResult = insertCrmContactSchema.partial().safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }
      
      // SECURITY: Don't allow changing organizationId
      const { organizationId: _, ...safeData } = validationResult.data;
      
      // If this is set as primary, unset other primaries for this org (with org filter)
      if (safeData.isPrimary) {
        const primaryConditions = [
          eq(crmContacts.organisationId, existing.organisationId),
          sql`${crmContacts.id} != ${req.params.id}`
        ];
        if (shouldFilter && orgId) {
          primaryConditions.push(eq(crmContacts.organizationId, orgId));
        }
        await db
          .update(crmContacts)
          .set({ isPrimary: false })
          .where(and(...primaryConditions));
      }
      
      const [updated] = await db
        .update(crmContacts)
        .set({
          ...safeData,
          updatedAt: new Date(),
        })
        .where(eq(crmContacts.id, req.params.id))
        .returning();
      
      // Log to audit
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "crm_contacts",
        entityId: updated.id,
        oldValue: JSON.stringify({ firstName: existing.firstName, lastName: existing.lastName }),
        newValue: JSON.stringify({ firstName: updated.firstName, lastName: updated.lastName }),
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Update CRM contact error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete contact (ADMIN, MANAGER only)
  app.delete("/api/crm/contacts/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Filter contact by organization
      const conditions = [eq(crmContacts.id, req.params.id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(crmContacts.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmContacts)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Contact not found" });
        return;
      }
      
      // SECURITY: Delete with organization filter applied
      await db.delete(crmContacts).where(and(...conditions));
      
      // Log to audit
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "crm_contacts",
        entityId: existing.id,
        oldValue: JSON.stringify({ firstName: existing.firstName, lastName: existing.lastName }),
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete CRM contact error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // CRM Organisation Notes Routes
  // ====================

  // Get notes for an organisation (most recent first)
  app.get("/api/crm/organisations/:id/notes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Verify the parent organisation belongs to user's org
      const orgConditions = [eq(crmOrganisations.id, req.params.id)];
      if (shouldFilter && orgId) {
        orgConditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [parentOrg] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...orgConditions))
        .limit(1);
      
      if (!parentOrg) {
        return res.status(404).json({ error: "Organisation not found" });
      }
      
      const notes = await db
        .select({
          id: crmOrganisationNotes.id,
          organisationId: crmOrganisationNotes.organisationId,
          contactId: crmOrganisationNotes.contactId,
          noteType: crmOrganisationNotes.noteType,
          content: crmOrganisationNotes.content,
          createdById: crmOrganisationNotes.createdById,
          createdAt: crmOrganisationNotes.createdAt,
          createdByFirstName: users.firstName,
          createdByLastName: users.lastName,
          contactFirstName: crmContacts.firstName,
          contactLastName: crmContacts.lastName,
        })
        .from(crmOrganisationNotes)
        .leftJoin(users, eq(users.id, crmOrganisationNotes.createdById))
        .leftJoin(crmContacts, eq(crmContacts.id, crmOrganisationNotes.contactId))
        .where(eq(crmOrganisationNotes.organisationId, req.params.id))
        .orderBy(desc(crmOrganisationNotes.createdAt));

      res.json(notes);
    } catch (error) {
      console.error("Get CRM organisation notes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a note for an organisation
  app.post("/api/crm/organisations/:id/notes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Verify the parent organisation belongs to user's org
      const orgConditions = [eq(crmOrganisations.id, req.params.id)];
      if (shouldFilter && orgId) {
        orgConditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      const [organisation] = await db
        .select()
        .from(crmOrganisations)
        .where(and(...orgConditions))
        .limit(1);

      if (!organisation) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }

      const validationResult = insertCrmOrganisationNoteSchema.safeParse({
        ...req.body,
        organizationId: orgId,  // SECURITY: Set to user's organization
        organisationId: req.params.id,
        createdById: req.user!.id,
      });

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newNote] = await db
        .insert(crmOrganisationNotes)
        .values(validationResult.data)
        .returning();

      // Fetch the note with creator info
      const [noteWithDetails] = await db
        .select({
          id: crmOrganisationNotes.id,
          organisationId: crmOrganisationNotes.organisationId,
          contactId: crmOrganisationNotes.contactId,
          noteType: crmOrganisationNotes.noteType,
          content: crmOrganisationNotes.content,
          createdById: crmOrganisationNotes.createdById,
          createdAt: crmOrganisationNotes.createdAt,
          createdByFirstName: users.firstName,
          createdByLastName: users.lastName,
          contactFirstName: crmContacts.firstName,
          contactLastName: crmContacts.lastName,
        })
        .from(crmOrganisationNotes)
        .leftJoin(users, eq(users.id, crmOrganisationNotes.createdById))
        .leftJoin(crmContacts, eq(crmContacts.id, crmOrganisationNotes.contactId))
        .where(eq(crmOrganisationNotes.id, newNote.id));

      res.status(201).json(noteWithDetails);
    } catch (error) {
      console.error("Create CRM organisation note error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete a note
  app.delete("/api/crm/organisations/:orgId/notes/:noteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Filter note by organization
      const conditions = [
        eq(crmOrganisationNotes.id, req.params.noteId),
        eq(crmOrganisationNotes.organisationId, req.params.orgId)
      ];
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisationNotes.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(crmOrganisationNotes)
        .where(and(...conditions))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Note not found" });
        return;
      }

      // SECURITY: Delete with organization filter applied
      await db.delete(crmOrganisationNotes).where(and(...conditions));

      res.json({ success: true });
    } catch (error) {
      console.error("Delete CRM organisation note error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Search CRM for form auto-populate (simplified endpoint)
  app.get("/api/crm/search", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { type, query } = req.query;
      
      if (!query || (query as string).length < 2) {
        res.json({ organisations: [], contacts: [] });
        return;
      }
      
      const conditions: any[] = [
        eq(crmOrganisations.isActive, true),
        sql`LOWER(${crmOrganisations.name}) LIKE LOWER(${'%' + query + '%'})`,
      ];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }
      
      if (type) {
        conditions.push(sql`${crmOrganisations.type} = ${type}`);
      }
      
      const organisations = await db
        .select({
          id: crmOrganisations.id,
          type: crmOrganisations.type,
          name: crmOrganisations.name,
          city: crmOrganisations.city,
          state: crmOrganisations.state,
        })
        .from(crmOrganisations)
        .where(and(...conditions))
        .orderBy(crmOrganisations.name)
        .limit(20);
      
      res.json({ organisations });
    } catch (error) {
      console.error("CRM search error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Vendor Pricing Catalog Routes (CRM Extension)
  // ====================
  const { vendorPricingCatalogs, insertVendorPricingCatalogSchema, rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema } = await import("@shared/schema");

  // Get all pricing items for an organisation
  app.get("/api/crm/organisations/:id/pricing", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const items = await db
        .select()
        .from(vendorPricingCatalogs)
        .where(eq(vendorPricingCatalogs.crmOrganisationId, req.params.id))
        .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);
      
      res.json(items);
    } catch (error) {
      console.error("Get vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get active pricing for current quarter
  app.get("/api/crm/organisations/:id/pricing/current", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const now = new Date();
      const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
      
      const items = await db
        .select()
        .from(vendorPricingCatalogs)
        .where(and(
          eq(vendorPricingCatalogs.crmOrganisationId, req.params.id),
          eq(vendorPricingCatalogs.isActive, true),
          eq(vendorPricingCatalogs.effectiveQuarter, currentQuarter)
        ))
        .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);
      
      res.json(items);
    } catch (error) {
      console.error("Get current vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create pricing item
  app.post("/api/crm/organisations/:id/pricing", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
      if (!org) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }

      // Convert date strings to Date objects for Drizzle-zod validation
      const bodyWithDates = {
        ...req.body,
        effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date(),
        expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : null,
        crmOrganisationId: req.params.id,
        createdById: req.user!.id,
      };

      const validationResult = insertVendorPricingCatalogSchema.safeParse(bodyWithDates);

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newItem] = await db.insert(vendorPricingCatalogs).values(validationResult.data).returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "vendor_pricing_catalogs",
        entityId: newItem.id,
        newValue: JSON.stringify({ itemName: newItem.itemName, category: newItem.category, unitPrice: newItem.unitPrice }),
      });

      res.status(201).json(newItem);
    } catch (error) {
      console.error("Create vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update pricing item
  app.put("/api/crm/pricing/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [existing] = await db.select().from(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Pricing item not found" });
        return;
      }

      // Convert date strings to Date objects for Drizzle-zod validation
      const bodyWithDates = {
        ...req.body,
        ...(req.body.effectiveDate && { effectiveDate: new Date(req.body.effectiveDate) }),
        ...(req.body.expirationDate && { expirationDate: new Date(req.body.expirationDate) }),
      };

      const validationResult = insertVendorPricingCatalogSchema.partial().safeParse(bodyWithDates);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [updated] = await db
        .update(vendorPricingCatalogs)
        .set({ ...validationResult.data, updatedAt: new Date() })
        .where(eq(vendorPricingCatalogs.id, req.params.id))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "vendor_pricing_catalogs",
        entityId: updated.id,
        oldValue: JSON.stringify({ itemName: existing.itemName, unitPrice: existing.unitPrice }),
        newValue: JSON.stringify({ itemName: updated.itemName, unitPrice: updated.unitPrice }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Update vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete pricing item
  app.delete("/api/crm/pricing/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [existing] = await db.select().from(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Pricing item not found" });
        return;
      }

      await db.delete(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id));

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "vendor_pricing_catalogs",
        entityId: existing.id,
        oldValue: JSON.stringify({ itemName: existing.itemName, category: existing.category }),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Search all vendor pricing across all suppliers (for bid auto-populate)
  app.get("/api/vendor-pricing/search", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { category, search, quarter } = req.query;
      const now = new Date();
      const currentQuarter = quarter as string || `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;

      const conditions: any[] = [
        eq(vendorPricingCatalogs.isActive, true),
      ];

      if (category) {
        conditions.push(eq(vendorPricingCatalogs.category, category as string));
      }
      if (search) {
        conditions.push(sql`LOWER(${vendorPricingCatalogs.itemName}) LIKE LOWER(${'%' + search + '%'})`);
      }

      const items = await db
        .select({
          id: vendorPricingCatalogs.id,
          itemName: vendorPricingCatalogs.itemName,
          itemCode: vendorPricingCatalogs.itemCode,
          category: vendorPricingCatalogs.category,
          description: vendorPricingCatalogs.description,
          unit: vendorPricingCatalogs.unit,
          unitPrice: vendorPricingCatalogs.unitPrice,
          minimumOrder: vendorPricingCatalogs.minimumOrder,
          deliveryFee: vendorPricingCatalogs.deliveryFee,
          effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
          leadTimeDays: vendorPricingCatalogs.leadTimeDays,
          vendorId: crmOrganisations.id,
          vendorName: crmOrganisations.name,
          vendorType: crmOrganisations.type,
        })
        .from(vendorPricingCatalogs)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricingCatalogs.crmOrganisationId))
        .where(and(...conditions))
        .orderBy(vendorPricingCatalogs.unitPrice)
        .limit(50);

      res.json(items);
    } catch (error) {
      console.error("Search vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Rental Equipment Catalog Routes (CRM Extension)
  // ====================

  // Get rental catalog for a CRM organisation
  app.get("/api/crm/organisations/:id/rental-catalog", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      // SECURITY: Verify crmOrganisation belongs to user's org
      const [crmOrg] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
      if (!crmOrg) {
        return res.json([]);
      }
      
      if (shouldFilter && crmOrg.organizationId !== orgId) {
        return res.json([]);
      }
      
      const items = await db
        .select()
        .from(rentalEquipmentCatalog)
        .where(eq(rentalEquipmentCatalog.crmOrganisationId, req.params.id))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json(items);
    } catch (error) {
      console.error("Get CRM rental catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create rental catalog item for CRM organisation
  app.post("/api/crm/organisations/:id/rental-catalog", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
      if (!org) {
        res.status(404).json({ error: "Organisation not found" });
        return;
      }
      
      // SECURITY: Verify crmOrganisation belongs to user's org
      if (shouldFilter && org.organizationId !== orgId) {
        return res.status(404).json({ error: "Organisation not found" });
      }
      
      if (org.type !== "RENTAL_VENDOR" && org.type !== "VENDOR") {
        res.status(400).json({ error: "Organisation must be a Rental Vendor or Vendor type" });
        return;
      }

      const validationResult = insertRentalEquipmentCatalogSchema.safeParse({
        ...req.body,
        crmOrganisationId: req.params.id,
      });

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newItem] = await db.insert(rentalEquipmentCatalog).values(validationResult.data).returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "rental_equipment_catalog",
        entityId: newItem.id,
        newValue: JSON.stringify({ name: newItem.name, equipmentType: newItem.equipmentType }),
      });

      res.status(201).json(newItem);
    } catch (error) {
      console.error("Create CRM rental catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update rental catalog item
  app.put("/api/crm/rental-catalog/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Verify catalog item belongs to user's org through crmOrganisation
      const [existing] = await db
        .select({ 
          catalogItem: rentalEquipmentCatalog, 
          orgOrgId: crmOrganisations.organizationId,
          crmOrgId: crmOrganisations.id
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
        .where(eq(rentalEquipmentCatalog.id, req.params.id))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Catalog item not found" });
        return;
      }
      
      if (shouldFilter && existing.orgOrgId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }

      const validationResult = insertRentalEquipmentCatalogSchema.partial().safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // SECURITY: Include crmOrganisationId in WHERE to prevent TOCTOU race condition
      const updateConditions = and(
        eq(rentalEquipmentCatalog.id, req.params.id),
        eq(rentalEquipmentCatalog.crmOrganisationId, existing.crmOrgId)
      );

      // SECURITY: Remove crmOrganisationId from update data to prevent cross-tenant reassignment
      const { crmOrganisationId, ...safeUpdateData } = validationResult.data;

      const [updated] = await db
        .update(rentalEquipmentCatalog)
        .set({ ...safeUpdateData, updatedAt: new Date() })
        .where(updateConditions)
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update CRM rental catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete rental catalog item
  app.delete("/api/crm/rental-catalog/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      // SECURITY: Verify catalog item belongs to user's org through crmOrganisation
      const [existing] = await db
        .select({ 
          catalogItem: rentalEquipmentCatalog, 
          orgOrgId: crmOrganisations.organizationId,
          crmOrgId: crmOrganisations.id
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
        .where(eq(rentalEquipmentCatalog.id, req.params.id))
        .limit(1);
      
      if (!existing) {
        res.status(404).json({ error: "Catalog item not found" });
        return;
      }
      
      if (shouldFilter && existing.orgOrgId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }

      // SECURITY: Include crmOrganisationId in WHERE to prevent TOCTOU race condition
      const deleteConditions = and(
        eq(rentalEquipmentCatalog.id, req.params.id),
        eq(rentalEquipmentCatalog.crmOrganisationId, existing.crmOrgId)
      );

      await db.delete(rentalEquipmentCatalog).where(deleteConditions);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete CRM rental catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Search all rental equipment across all vendors (for bid equipment selection)
  app.get("/api/rental-catalog/search", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { type, search } = req.query;

      const conditions: any[] = [
        eq(rentalEquipmentCatalog.isActive, true),
        sql`${rentalEquipmentCatalog.crmOrganisationId} IS NOT NULL`,
      ];
      
      // SECURITY: Filter by user's organization through crmOrganisation
      if (shouldFilter && orgId) {
        conditions.push(eq(crmOrganisations.organizationId, orgId));
      }

      if (type) {
        conditions.push(eq(rentalEquipmentCatalog.equipmentType, type as string));
      }
      if (search) {
        conditions.push(sql`LOWER(${rentalEquipmentCatalog.name}) LIKE LOWER(${'%' + search + '%'})`);
      }

      const items = await db
        .select({
          id: rentalEquipmentCatalog.id,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          description: rentalEquipmentCatalog.description,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          pickupFee: rentalEquipmentCatalog.pickupFee,
          minimumRentalDays: rentalEquipmentCatalog.minimumRentalDays,
          vendorId: crmOrganisations.id,
          vendorName: crmOrganisations.name,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
        .where(and(...conditions))
        .orderBy(rentalEquipmentCatalog.dailyRate)
        .limit(50);

      res.json(items);
    } catch (error) {
      console.error("Search rental catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Vendor Enrollment Routes
  // ====================
  const { vendorEnrollments, insertVendorEnrollmentSchema, vendorUsers, insertVendorUserSchema } = await import("@shared/schema");

  // Get all vendor enrollments for a contractor organization
  app.get("/api/vendor-enrollments", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const enrollments = await db
        .select({
          id: vendorEnrollments.id,
          vendorCrmOrgId: vendorEnrollments.vendorCrmOrgId,
          contractorOrgId: vendorEnrollments.contractorOrgId,
          status: vendorEnrollments.status,
          autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
          notifyOnPriceUpdate: vendorEnrollments.notifyOnPriceUpdate,
          invitedAt: vendorEnrollments.invitedAt,
          enrolledAt: vendorEnrollments.enrolledAt,
          enrolledCategories: vendorEnrollments.enrolledCategories,
          notes: vendorEnrollments.notes,
          vendorName: crmOrganisations.name,
          vendorType: crmOrganisations.type,
          vendorCity: crmOrganisations.city,
          vendorState: crmOrganisations.state,
        })
        .from(vendorEnrollments)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorEnrollments.vendorCrmOrgId))
        .where(eq(vendorEnrollments.contractorOrgId, organizationId))
        .orderBy(crmOrganisations.name);

      res.json(enrollments);
    } catch (error) {
      console.error("Get vendor enrollments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create vendor enrollment (invite vendor to send pricing)
  app.post("/api/vendor-enrollments", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const { vendorCrmOrgId, enrolledCategories, autoApproveNewPricing, notifyOnPriceUpdate, notes } = req.body;

      // Verify vendor exists and is a valid type
      const [vendor] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, vendorCrmOrgId)).limit(1);
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (vendor.type !== "VENDOR" && vendor.type !== "SUPPLIER") {
        return res.status(400).json({ error: "Organization must be a Vendor or Supplier type" });
      }

      // Generate enrollment code for vendor self-enrollment
      const enrollmentCode = `VE-${organizationId.slice(0, 4)}-${vendorCrmOrgId.slice(0, 4)}-${Date.now().toString(36)}`.toUpperCase();

      const [enrollment] = await db.insert(vendorEnrollments).values({
        vendorCrmOrgId,
        contractorOrgId: organizationId,
        status: "PENDING",
        autoApproveNewPricing: autoApproveNewPricing || false,
        notifyOnPriceUpdate: notifyOnPriceUpdate !== false,
        invitedByUserId: req.user!.id,
        enrolledCategories: enrolledCategories || [],
        enrollmentCode,
        notes,
      }).returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "vendor_enrollment",
        entityId: enrollment.id,
        newValue: JSON.stringify({ vendorName: vendor.name, status: "PENDING" }),
      });

      res.status(201).json({ ...enrollment, vendorName: vendor.name });
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Vendor is already enrolled" });
      }
      console.error("Create vendor enrollment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update vendor enrollment settings
  app.put("/api/vendor-enrollments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorEnrollments)
        .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      const { status, autoApproveNewPricing, notifyOnPriceUpdate, enrolledCategories, notes } = req.body;

      const [updated] = await db
        .update(vendorEnrollments)
        .set({
          ...(status && { status }),
          ...(autoApproveNewPricing !== undefined && { autoApproveNewPricing }),
          ...(notifyOnPriceUpdate !== undefined && { notifyOnPriceUpdate }),
          ...(enrolledCategories && { enrolledCategories }),
          ...(notes !== undefined && { notes }),
          ...(status === "ACTIVE" && !existing.enrolledAt && { enrolledAt: new Date() }),
          updatedAt: new Date(),
        })
        .where(eq(vendorEnrollments.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update vendor enrollment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete vendor enrollment
  app.delete("/api/vendor-enrollments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorEnrollments)
        .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      await db.delete(vendorEnrollments).where(eq(vendorEnrollments.id, req.params.id));

      res.json({ success: true });
    } catch (error) {
      console.error("Delete vendor enrollment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get enrollment by CRM organization ID (for CRM page)
  app.get("/api/vendor-enrollments/by-crm-org/:crmOrgId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [enrollment] = await db
        .select({
          id: vendorEnrollments.id,
          vendorCrmOrganisationId: vendorEnrollments.vendorCrmOrgId,
          contractorOrganizationId: vendorEnrollments.contractorOrgId,
          status: vendorEnrollments.status,
          autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
          invitedAt: vendorEnrollments.invitedAt,
          enrolledAt: vendorEnrollments.enrolledAt,
          suspendedAt: vendorEnrollments.updatedAt,
          vendorName: crmOrganisations.name,
        })
        .from(vendorEnrollments)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorEnrollments.vendorCrmOrgId))
        .where(and(
          eq(vendorEnrollments.vendorCrmOrgId, req.params.crmOrgId),
          eq(vendorEnrollments.contractorOrgId, organizationId)
        ))
        .limit(1);

      // Get vendor user email if exists
      if (enrollment) {
        const [vendorUser] = await db.select({ email: users.email })
          .from(vendorUsers)
          .innerJoin(users, eq(users.id, vendorUsers.userId))
          .where(and(
            eq(vendorUsers.crmOrganisationId, req.params.crmOrgId),
            eq(vendorUsers.isActive, true)
          ))
          .limit(1);

        res.json({
          ...enrollment,
          vendorUserEmail: vendorUser?.email || null,
        });
      } else {
        res.json(null);
      }
    } catch (error) {
      console.error("Get enrollment by CRM org error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Invite vendor to portal (from CRM page)
  app.post("/api/vendor-enrollments/invite", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const { vendorCrmOrganisationId, vendorEmail, autoApproveNewPricing } = req.body;

      if (!vendorCrmOrganisationId || !vendorEmail) {
        return res.status(400).json({ error: "Vendor CRM organization ID and email are required" });
      }

      // Verify vendor exists and is a valid type
      const [vendor] = await db.select().from(crmOrganisations)
        .where(eq(crmOrganisations.id, vendorCrmOrganisationId))
        .limit(1);
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (vendor.type !== "VENDOR" && vendor.type !== "SUPPLIER") {
        return res.status(400).json({ error: "Organization must be a Vendor or Supplier type" });
      }

      // Check if already enrolled
      const [existing] = await db.select().from(vendorEnrollments)
        .where(and(
          eq(vendorEnrollments.vendorCrmOrgId, vendorCrmOrganisationId),
          eq(vendorEnrollments.contractorOrgId, organizationId)
        ))
        .limit(1);

      if (existing) {
        return res.status(409).json({ error: "Vendor is already enrolled or invited" });
      }

      // Generate enrollment code
      const enrollmentCode = `VE-${organizationId.slice(0, 4)}-${vendorCrmOrganisationId.slice(0, 4)}-${Date.now().toString(36)}`.toUpperCase();

      // Get contractor organization name for the email
      const [contractorOrg] = await db.select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      const contractorName = contractorOrg?.name || "A contractor";

      // Create enrollment with PENDING status (awaiting vendor acceptance)
      const [enrollment] = await db.insert(vendorEnrollments).values({
        vendorCrmOrgId: vendorCrmOrganisationId,
        contractorOrgId: organizationId,
        status: "PENDING",
        autoApproveNewPricing: autoApproveNewPricing || false,
        notifyOnPriceUpdate: true,
        invitedByUserId: req.user!.id,
        enrollmentCode,
      }).returning();

      // Send invitation email to vendor
      try {
        const acceptLink = `${process.env.REPLIT_DEV_DOMAIN || 'https://smartmanage.app'}/vendor/accept?code=${enrollmentCode}`;
        const emailSent = await sendEmail({
          to: vendorEmail,
          subject: `Vendor Portal Invitation from ${contractorName}`,
          html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vendor Portal Invitation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background-color: #1a365d; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Vendor Portal Invitation</h1>
    </div>
    <div style="padding: 32px 24px;">
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        You have been invited by <strong>${contractorName}</strong> to join their vendor portal on SmartManageAI.
      </p>
      <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        As a vendor, you'll be able to:
      </p>
      <ul style="color: #333333; font-size: 14px; line-height: 1.8; margin: 0 0 24px; padding-left: 20px;">
        <li>Submit and update material pricing</li>
        <li>View enrolled contractor clients</li>
        <li>Manage your vendor profile</li>
      </ul>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${acceptLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
          Accept Invitation
        </a>
      </div>
      <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
        Your enrollment code: <strong>${enrollmentCode}</strong>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
      <p style="color: #999999; font-size: 12px; line-height: 1.6; margin: 0;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
    </div>
    <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
      <p style="color: #999999; font-size: 12px; margin: 0;">
        SmartManageAI Construction Management Platform
      </p>
    </div>
  </div>
</body>
</html>`,
          text: `
Vendor Portal Invitation

You have been invited by ${contractorName} to join their vendor portal on SmartManageAI.

As a vendor, you'll be able to:
- Submit and update material pricing
- View enrolled contractor clients  
- Manage your vendor profile

Accept the invitation here: ${acceptLink}

Your enrollment code: ${enrollmentCode}

If you didn't expect this invitation, you can safely ignore this email.

---
SmartManageAI Construction Management Platform
`,
        });
        console.log(`Vendor invitation email ${emailSent ? 'sent' : 'logged'} to: ${vendorEmail}`);
      } catch (emailError) {
        // Log email failure but don't fail the request - enrollment was created successfully
        console.error("Failed to send vendor invitation email:", emailError);
      }

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "vendor_enrollment",
        entityId: enrollment.id,
        newValue: JSON.stringify({ vendorName: vendor.name, vendorEmail, status: "PENDING" }),
      });

      res.status(201).json({
        ...enrollment,
        vendorName: vendor.name,
        message: `Invitation will be sent to ${vendorEmail}`,
      });
    } catch (error) {
      console.error("Invite vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update enrollment settings (PATCH for partial updates)
  app.patch("/api/vendor-enrollments/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorEnrollments)
        .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      const { autoApproveNewPricing, notifyOnPriceUpdate } = req.body;

      const [updated] = await db
        .update(vendorEnrollments)
        .set({
          ...(autoApproveNewPricing !== undefined && { autoApproveNewPricing }),
          ...(notifyOnPriceUpdate !== undefined && { notifyOnPriceUpdate }),
          updatedAt: new Date(),
        })
        .where(eq(vendorEnrollments.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update enrollment settings error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Suspend vendor enrollment
  app.post("/api/vendor-enrollments/:id/suspend", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorEnrollments)
        .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      if (existing.status === "SUSPENDED") {
        return res.status(400).json({ error: "Enrollment is already suspended" });
      }

      const [updated] = await db
        .update(vendorEnrollments)
        .set({
          status: "SUSPENDED",
          updatedAt: new Date(),
        })
        .where(eq(vendorEnrollments.id, req.params.id))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "vendor_enrollment",
        entityId: req.params.id,
        oldValue: JSON.stringify({ status: existing.status }),
        newValue: JSON.stringify({ status: "SUSPENDED" }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Suspend vendor enrollment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reactivate vendor enrollment
  app.post("/api/vendor-enrollments/:id/reactivate", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorEnrollments)
        .where(and(eq(vendorEnrollments.id, req.params.id), eq(vendorEnrollments.contractorOrgId, organizationId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      if (existing.status === "ACTIVE") {
        return res.status(400).json({ error: "Enrollment is already active" });
      }

      const [updated] = await db
        .update(vendorEnrollments)
        .set({
          status: "ACTIVE",
          enrolledAt: existing.enrolledAt || new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vendorEnrollments.id, req.params.id))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "vendor_enrollment",
        entityId: req.params.id,
        oldValue: JSON.stringify({ status: existing.status }),
        newValue: JSON.stringify({ status: "ACTIVE" }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Reactivate vendor enrollment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get pending pricing submissions for a vendor
  app.get("/api/crm/organisations/:id/pricing/pending", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const pendingPricing = await db
        .select({
          id: vendorPricingCatalogs.id,
          itemName: vendorPricingCatalogs.itemName,
          itemCode: vendorPricingCatalogs.itemCode,
          category: vendorPricingCatalogs.category,
          description: vendorPricingCatalogs.description,
          unit: vendorPricingCatalogs.unit,
          unitPrice: vendorPricingCatalogs.unitPrice,
          effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
          effectiveDate: vendorPricingCatalogs.effectiveDate,
          approvalStatus: vendorPricingCatalogs.approvalStatus,
          createdAt: vendorPricingCatalogs.createdAt,
          submittedByEmail: users.email,
          submittedByName: sql`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
        })
        .from(vendorPricingCatalogs)
        .leftJoin(users, eq(users.id, vendorPricingCatalogs.submittedByVendorUserId))
        .where(and(
          eq(vendorPricingCatalogs.crmOrganisationId, req.params.id),
          eq(vendorPricingCatalogs.organizationId, organizationId),
          eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
        ))
        .orderBy(vendorPricingCatalogs.createdAt);

      res.json(pendingPricing);
    } catch (error) {
      console.error("Get pending pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve pricing submission
  app.post("/api/crm/pricing/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorPricingCatalogs)
        .where(and(
          eq(vendorPricingCatalogs.id, req.params.id),
          eq(vendorPricingCatalogs.organizationId, organizationId)
        ))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Pricing item not found" });
      }

      if (existing.approvalStatus !== "PENDING_REVIEW") {
        return res.status(400).json({ error: "Pricing item is not pending approval" });
      }

      const [updated] = await db
        .update(vendorPricingCatalogs)
        .set({
          approvalStatus: "APPROVED",
          approvedByUserId: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vendorPricingCatalogs.id, req.params.id))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "vendor_pricing",
        entityId: req.params.id,
        oldValue: JSON.stringify({ approvalStatus: "PENDING_REVIEW" }),
        newValue: JSON.stringify({ approvalStatus: "APPROVED" }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Approve pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reject pricing submission
  app.post("/api/crm/pricing/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorPricingCatalogs)
        .where(and(
          eq(vendorPricingCatalogs.id, req.params.id),
          eq(vendorPricingCatalogs.organizationId, organizationId)
        ))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Pricing item not found" });
      }

      if (existing.approvalStatus !== "PENDING_REVIEW") {
        return res.status(400).json({ error: "Pricing item is not pending approval" });
      }

      const [updated] = await db
        .update(vendorPricingCatalogs)
        .set({
          approvalStatus: "REJECTED",
          approvedByUserId: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vendorPricingCatalogs.id, req.params.id))
        .returning();

      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "vendor_pricing",
        entityId: req.params.id,
        oldValue: JSON.stringify({ approvalStatus: "PENDING_REVIEW" }),
        newValue: JSON.stringify({ approvalStatus: "REJECTED" }),
      });

      res.json(updated);
    } catch (error) {
      console.error("Reject pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Vendor Portal Routes (for VENDOR role users)
  // ====================

  // Get vendor user's linked CRM organization and enrollments
  app.get("/api/vendor/portal", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Get vendor user's linked CRM organization
      const [vendorUser] = await db.select().from(vendorUsers)
        .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
        .limit(1);

      if (!vendorUser) {
        return res.status(403).json({ error: "Vendor account not linked to any organization" });
      }

      // Get the CRM organization details
      const [crmOrg] = await db.select().from(crmOrganisations)
        .where(eq(crmOrganisations.id, vendorUser.crmOrganisationId))
        .limit(1);

      if (!crmOrg) {
        return res.status(404).json({ error: "Vendor organization not found" });
      }

      // Get all enrollments for this vendor
      const enrollments = await db
        .select({
          id: vendorEnrollments.id,
          contractorOrgId: vendorEnrollments.contractorOrgId,
          status: vendorEnrollments.status,
          autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
          enrolledAt: vendorEnrollments.enrolledAt,
          enrolledCategories: vendorEnrollments.enrolledCategories,
          contractorName: organizations.name,
          contractorRegion: organizations.region,
        })
        .from(vendorEnrollments)
        .innerJoin(organizations, eq(organizations.id, vendorEnrollments.contractorOrgId))
        .where(and(
          eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId),
          eq(vendorEnrollments.status, "ACTIVE")
        ));

      res.json({
        vendor: {
          id: crmOrg.id,
          name: crmOrg.name,
          type: crmOrg.type,
          city: crmOrg.city,
          state: crmOrg.state,
        },
        permissions: {
          canSubmitPricing: vendorUser.canSubmitPricing,
          canViewEnrollments: vendorUser.canViewEnrollments,
          canManageUsers: vendorUser.canManageUsers,
          isPrimaryContact: vendorUser.isPrimaryContact,
        },
        enrolledClients: enrollments,
      });
    } catch (error) {
      console.error("Get vendor portal error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get vendor enrollments for the vendor portal (Enrolled Clients page)
  app.get("/api/vendor/enrollments", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Get vendor user's linked CRM organization
      const [vendorUser] = await db.select().from(vendorUsers)
        .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
        .limit(1);

      if (!vendorUser) {
        // Return empty array instead of error for better UX
        return res.json([]);
      }

      // Get all enrollments for this vendor (both ACTIVE and PENDING)
      const enrollments = await db
        .select({
          id: vendorEnrollments.id,
          vendorId: vendorEnrollments.vendorCrmOrgId,
          contractorOrgId: vendorEnrollments.contractorOrgId,
          contractorOrgName: organizations.name,
          status: vendorEnrollments.status,
          autoApproveNewPricing: vendorEnrollments.autoApproveNewPricing,
          notifyOnPriceUpdate: vendorEnrollments.notifyOnPriceUpdate,
          enrolledAt: vendorEnrollments.enrolledAt,
          invitedByUserId: vendorEnrollments.invitedByUserId,
        })
        .from(vendorEnrollments)
        .innerJoin(organizations, eq(organizations.id, vendorEnrollments.contractorOrgId))
        .where(eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId))
        .orderBy(organizations.name);

      res.json(enrollments);
    } catch (error) {
      console.error("Get vendor enrollments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Submit pricing to enrolled clients (vendor portal)
  app.post("/api/vendor/pricing", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Get vendor user's linked CRM organization
      const [vendorUser] = await db.select().from(vendorUsers)
        .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true), eq(vendorUsers.canSubmitPricing, true)))
        .limit(1);

      if (!vendorUser) {
        return res.status(403).json({ error: "No permission to submit pricing" });
      }

      const { items, targetContractorOrgIds } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "At least one pricing item is required" });
      }

      // Get active enrollments for this vendor (optionally filtered by target contractors)
      const conditions: any[] = [
        eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId),
        eq(vendorEnrollments.status, "ACTIVE"),
      ];
      if (targetContractorOrgIds && targetContractorOrgIds.length > 0) {
        conditions.push(sql`${vendorEnrollments.contractorOrgId} IN (${sql.join(targetContractorOrgIds.map((id: string) => sql`${id}`), sql`, `)})`);
      }

      const enrollments = await db.select().from(vendorEnrollments).where(and(...conditions));

      if (enrollments.length === 0) {
        return res.status(400).json({ error: "No active enrollments found for pricing submission" });
      }

      const now = new Date();
      const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
      const insertedItems: any[] = [];

      // Insert pricing items for each enrolled contractor
      for (const enrollment of enrollments) {
        for (const item of items) {
          const approvalStatus = enrollment.autoApproveNewPricing ? "AUTO_APPROVED" : "PENDING_REVIEW";
          
          const [inserted] = await db.insert(vendorPricingCatalogs).values({
            crmOrganisationId: vendorUser.crmOrganisationId,
            organizationId: enrollment.contractorOrgId,
            itemName: item.itemName,
            itemCode: item.itemCode,
            category: item.category,
            description: item.description,
            unit: item.unit,
            unitPrice: item.unitPrice,
            minimumOrder: item.minimumOrder,
            deliveryFee: item.deliveryFee,
            effectiveQuarter: currentQuarter,
            effectiveDate: now,
            expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
            leadTimeDays: item.leadTimeDays,
            sourceType: "VENDOR_PORTAL",
            approvalStatus,
            submittedByVendorUserId: userId,
            isActive: approvalStatus === "AUTO_APPROVED",
          }).returning();

          insertedItems.push(inserted);

          // Create notification for contractor if notify is enabled and we have a user to notify
          if (enrollment.notifyOnPriceUpdate && enrollment.invitedByUserId) {
            await db.insert(notifications).values({
              userId: enrollment.invitedByUserId,
              type: "GENERAL",
              title: "New Vendor Pricing Submitted",
              message: `Vendor has submitted ${items.length} pricing item(s) for review.`,
              isRead: false,
            });
          }
        }
      }

      res.status(201).json({
        success: true,
        itemsCreated: insertedItems.length,
        enrollmentsServed: enrollments.length,
      });
    } catch (error) {
      console.error("Submit vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get vendor's submitted pricing items
  app.get("/api/vendor/pricing", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Get vendor user's linked CRM organization
      const [vendorUser] = await db.select().from(vendorUsers)
        .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true)))
        .limit(1);

      if (!vendorUser) {
        return res.status(403).json({ error: "Vendor account not linked" });
      }

      const items = await db
        .select()
        .from(vendorPricingCatalogs)
        .where(eq(vendorPricingCatalogs.crmOrganisationId, vendorUser.crmOrganisationId))
        .orderBy(vendorPricingCatalogs.createdAt);

      res.json(items);
    } catch (error) {
      console.error("Get vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get CSV template for bulk upload
  app.get("/api/vendor/pricing/csv-template", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
    try {
      // Generate CSV template with headers matching the database schema
      const headers = [
        "itemName",
        "itemCode", 
        "category",
        "description",
        "unit",
        "unitPrice",
        "minimumOrder",
        "deliveryFee",
        "leadTimeDays"
      ];
      
      // Create a sample row to help users understand the format
      const sampleRow = [
        "Ready Mix Concrete 4000 PSI",
        "RMC-4000",
        "Concrete & Masonry",
        "High strength concrete for slabs and foundations",
        "CY",
        "145.00",
        "10",
        "75.00",
        "2"
      ];
      
      const csvContent = [
        headers.join(","),
        sampleRow.join(",")
      ].join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=pricing_template.csv");
      res.send(csvContent);
    } catch (error) {
      console.error("Get CSV template error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Bulk upload vendor pricing via CSV
  app.post("/api/vendor/pricing/bulk", requireAuth, requireRole("VENDOR"), async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Get vendor user's linked CRM organization
      const [vendorUser] = await db.select().from(vendorUsers)
        .where(and(eq(vendorUsers.userId, userId), eq(vendorUsers.isActive, true), eq(vendorUsers.canSubmitPricing, true)))
        .limit(1);

      if (!vendorUser) {
        return res.status(403).json({ error: "No permission to submit pricing" });
      }

      const { csvData, contractorOrgIds } = req.body;

      if (!csvData || typeof csvData !== "string") {
        return res.status(400).json({ error: "CSV data is required" });
      }

      // Parse CSV data
      const lines = csvData.trim().split("\n");
      if (lines.length < 2) {
        return res.status(400).json({ 
          error: "EMPTY_FILE",
          message: "You uploaded an empty file. Please fill out the CSV and upload again."
        });
      }

      const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ''));
      
      // Validate headers match expected format
      const expectedHeaders = ["itemName", "itemCode", "category", "description", "unit", "unitPrice", "minimumOrder", "deliveryFee", "leadTimeDays"];
      const missingHeaders = expectedHeaders.filter(h => !headers.includes(h));
      
      if (missingHeaders.length > 0) {
        return res.status(400).json({ 
          error: "INVALID_FORMAT",
          message: "Error: File does not match the required format.",
          details: `Missing headers: ${missingHeaders.join(", ")}`
        });
      }

      // Parse data rows
      const items: any[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines

        // Parse CSV line (handling quoted values with commas)
        const values: string[] = [];
        let currentValue = "";
        let insideQuotes = false;
        
        for (const char of line) {
          if (char === '"') {
            insideQuotes = !insideQuotes;
          } else if (char === ',' && !insideQuotes) {
            values.push(currentValue.trim());
            currentValue = "";
          } else {
            currentValue += char;
          }
        }
        values.push(currentValue.trim());

        const rowData: any = {};
        headers.forEach((header, index) => {
          rowData[header] = values[index]?.replace(/^"|"$/g, '') || null;
        });

        // Validate required fields
        if (!rowData.itemName || rowData.itemName.trim() === "") {
          errors.push(`Row ${i + 1}: itemName is required`);
          continue;
        }
        if (!rowData.unitPrice || isNaN(parseFloat(rowData.unitPrice))) {
          errors.push(`Row ${i + 1}: valid unitPrice is required`);
          continue;
        }
        if (!rowData.unit || rowData.unit.trim() === "") {
          errors.push(`Row ${i + 1}: unit is required`);
          continue;
        }

        items.push({
          itemName: rowData.itemName.trim(),
          itemCode: rowData.itemCode?.trim() || null,
          category: rowData.category?.trim() || null,
          description: rowData.description?.trim() || null,
          unit: rowData.unit.trim(),
          unitPrice: rowData.unitPrice.trim(),
          minimumOrder: rowData.minimumOrder ? parseInt(rowData.minimumOrder) : null,
          deliveryFee: rowData.deliveryFee?.trim() || null,
          leadTimeDays: rowData.leadTimeDays ? parseInt(rowData.leadTimeDays) : null,
        });
      }

      if (items.length === 0) {
        return res.status(400).json({ 
          error: "EMPTY_FILE",
          message: "You uploaded an empty file. Please fill out the CSV and upload again.",
          validationErrors: errors.length > 0 ? errors : undefined
        });
      }

      // Get active enrollments for this vendor
      const conditions: any[] = [
        eq(vendorEnrollments.vendorCrmOrgId, vendorUser.crmOrganisationId),
        eq(vendorEnrollments.status, "ACTIVE"),
      ];
      if (contractorOrgIds && contractorOrgIds.length > 0) {
        conditions.push(sql`${vendorEnrollments.contractorOrgId} IN (${sql.join(contractorOrgIds.map((id: string) => sql`${id}`), sql`, `)})`);
      }

      const enrollments = await db.select().from(vendorEnrollments).where(and(...conditions));

      if (enrollments.length === 0) {
        return res.status(400).json({ error: "No active enrollments found for pricing submission" });
      }

      const now = new Date();
      const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
      const insertedItems: any[] = [];

      // Insert pricing items for each enrolled contractor
      for (const enrollment of enrollments) {
        for (const item of items) {
          const approvalStatus = enrollment.autoApproveNewPricing ? "AUTO_APPROVED" : "PENDING_REVIEW";
          
          const [inserted] = await db.insert(vendorPricingCatalogs).values({
            crmOrganisationId: vendorUser.crmOrganisationId,
            organizationId: enrollment.contractorOrgId,
            itemName: item.itemName,
            itemCode: item.itemCode,
            category: item.category,
            description: item.description,
            unit: item.unit,
            unitPrice: item.unitPrice,
            minimumOrder: item.minimumOrder,
            deliveryFee: item.deliveryFee,
            effectiveQuarter: currentQuarter,
            effectiveDate: now,
            leadTimeDays: item.leadTimeDays,
            sourceType: "MANUAL",
            approvalStatus: approvalStatus,
            submittedByVendorUserId: userId,
            isActive: true,
            createdById: userId,
          }).returning();
          
          insertedItems.push(inserted);
        }
      }

      // Log the bulk upload
      await logAudit({
        action: "CREATE",
        entityType: "vendor_pricing_catalogs",
        entityId: insertedItems[0]?.id || "bulk",
        userId: userId,
        oldValue: null,
        newValue: JSON.stringify({ 
          itemCount: items.length,
          totalInserted: insertedItems.length,
          enrollmentsServed: enrollments.length
        }),
      }, req);

      res.json({
        success: true,
        message: "Items added successfully.",
        itemsCreated: items.length,
        totalRecords: insertedItems.length,
        enrollmentsServed: enrollments.length,
        validationWarnings: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Bulk upload vendor pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Contractor: Review vendor-submitted pricing
  // ====================

  // Get pending pricing submissions for review
  app.get("/api/crm/pricing-reviews", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const items = await db
        .select({
          id: vendorPricingCatalogs.id,
          itemName: vendorPricingCatalogs.itemName,
          itemCode: vendorPricingCatalogs.itemCode,
          category: vendorPricingCatalogs.category,
          description: vendorPricingCatalogs.description,
          unit: vendorPricingCatalogs.unit,
          unitPrice: vendorPricingCatalogs.unitPrice,
          minimumOrder: vendorPricingCatalogs.minimumOrder,
          deliveryFee: vendorPricingCatalogs.deliveryFee,
          effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
          sourceType: vendorPricingCatalogs.sourceType,
          approvalStatus: vendorPricingCatalogs.approvalStatus,
          createdAt: vendorPricingCatalogs.createdAt,
          vendorName: crmOrganisations.name,
          vendorId: crmOrganisations.id,
        })
        .from(vendorPricingCatalogs)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricingCatalogs.crmOrganisationId))
        .where(and(
          eq(vendorPricingCatalogs.organizationId, organizationId),
          eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
        ))
        .orderBy(vendorPricingCatalogs.createdAt);

      res.json(items);
    } catch (error) {
      console.error("Get pricing reviews error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve or reject vendor-submitted pricing
  app.post("/api/crm/pricing-reviews/:id/:action", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const { action } = req.params;
      if (action !== "approve" && action !== "reject") {
        return res.status(400).json({ error: "Invalid action" });
      }

      const [item] = await db.select().from(vendorPricingCatalogs)
        .where(and(
          eq(vendorPricingCatalogs.id, req.params.id),
          eq(vendorPricingCatalogs.organizationId, organizationId),
          eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
        ))
        .limit(1);

      if (!item) {
        return res.status(404).json({ error: "Pricing item not found or already reviewed" });
      }

      const [updated] = await db
        .update(vendorPricingCatalogs)
        .set({
          approvalStatus: action === "approve" ? "APPROVED" : "REJECTED",
          isActive: action === "approve",
          approvedByUserId: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vendorPricingCatalogs.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Review pricing error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Vendor Pricebook Routes (Staging/Import System)
  // ====================
  const { vendorPricebooks, vendorPricebookItems, insertVendorPricebookSchema, insertVendorPricebookItemSchema } = await import("@shared/schema");

  // Get all vendor pricebooks for the organization
  app.get("/api/ai-features/vendor-pricebooks", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const pricebooks = await db
        .select({
          id: vendorPricebooks.id,
          vendorId: vendorPricebooks.vendorId,
          vendorName: crmOrganisations.name,
          version: sql<string>`COALESCE(${vendorPricebooks.fileName}, 'Imported')`,
          effectiveDate: vendorPricebooks.effectiveDate,
          expirationDate: vendorPricebooks.expirationDate,
          itemCount: vendorPricebooks.itemCount,
          isActive: sql<boolean>`${vendorPricebooks.status} = 'ACTIVE'`,
          lastSyncedAt: vendorPricebooks.importedAt,
          createdAt: vendorPricebooks.createdAt,
          status: vendorPricebooks.status,
        })
        .from(vendorPricebooks)
        .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricebooks.vendorId))
        .where(eq(vendorPricebooks.organizationId, organizationId))
        .orderBy(sql`${vendorPricebooks.createdAt} DESC`);

      res.json({ pricebooks });
    } catch (error) {
      console.error("Get vendor pricebooks error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get items for a specific pricebook
  app.get("/api/ai-features/vendor-pricebooks/:pricebookId/items", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const items = await db
        .select({
          id: vendorPricebookItems.id,
          vendorCode: vendorPricebookItems.vendorCode,
          vendorDescription: vendorPricebookItems.vendorDescription,
          category: vendorPricebookItems.category,
          unit: vendorPricebookItems.unit,
          unitPrice: vendorPricebookItems.unitPrice,
          uom: vendorPricebookItems.vendorUnit,
          lastUpdated: vendorPricebookItems.updatedAt,
          isActive: vendorPricebookItems.isActive,
        })
        .from(vendorPricebookItems)
        .where(and(
          eq(vendorPricebookItems.pricebookId, req.params.pricebookId),
          eq(vendorPricebookItems.organizationId, organizationId)
        ))
        .orderBy(vendorPricebookItems.category, vendorPricebookItems.vendorDescription);

      res.json({ items });
    } catch (error) {
      console.error("Get pricebook items error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Upload a vendor pricebook (handles file upload and parsing)
  app.post("/api/ai-features/vendor-pricebooks/upload", requireAuth, requireRole("ADMIN", "MANAGER"), upload.single("file"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const { vendorId, effectiveDate } = req.body;
      const file = req.file;

      if (!file || !vendorId) {
        return res.status(400).json({ error: "File and vendor ID are required" });
      }

      // Verify vendor exists
      const [vendor] = await db.select().from(crmOrganisations)
        .where(eq(crmOrganisations.id, vendorId))
        .limit(1);
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }

      // Create pricebook record
      const [pricebook] = await db.insert(vendorPricebooks).values({
        organizationId,
        vendorId,
        fileKey: `pricebooks/${organizationId}/${Date.now()}_${file.originalname}`,
        fileName: file.originalname,
        fileType: file.mimetype.includes("csv") ? "CSV" : "XLSX",
        effectiveDate: effectiveDate || null,
        status: "PROCESSING",
        uploadedByUserId: req.user!.id,
      }).returning();

      // Parse the file and create pricebook items
      const xlsx = await import("xlsx");
      const workbook = xlsx.read(file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      if (rows.length < 2) {
        await db.update(vendorPricebooks)
          .set({ status: "PENDING", errorMessage: "File is empty or has no data rows" })
          .where(eq(vendorPricebooks.id, pricebook.id));
        return res.status(400).json({ error: "File has no data rows" });
      }

      const headers = rows[0] as string[];
      const dataRows = rows.slice(1);

      // Try to auto-map common column names
      const codeIdx = headers.findIndex(h => /code|sku|item.*no|part.*no/i.test(String(h)));
      const descIdx = headers.findIndex(h => /desc|name|item/i.test(String(h)));
      const priceIdx = headers.findIndex(h => /price|cost|unit.*price/i.test(String(h)));
      const unitIdx = headers.findIndex(h => /unit|uom/i.test(String(h)));
      const categoryIdx = headers.findIndex(h => /cat|type|group/i.test(String(h)));

      let itemsCreated = 0;
      for (const row of dataRows) {
        const code = codeIdx >= 0 ? String(row[codeIdx] || "") : "";
        const desc = descIdx >= 0 ? String(row[descIdx] || "") : "";
        const price = priceIdx >= 0 ? parseFloat(String(row[priceIdx] || "0")) : 0;
        const unit = unitIdx >= 0 ? String(row[unitIdx] || "EA") : "EA";
        const category = categoryIdx >= 0 ? String(row[categoryIdx] || "Uncategorized") : "Uncategorized";

        if (code || desc) {
          await db.insert(vendorPricebookItems).values({
            pricebookId: pricebook.id,
            organizationId,
            vendorId,
            vendorCode: code || `AUTO-${itemsCreated + 1}`,
            vendorDescription: desc || code,
            vendorUnit: unit,
            category,
            unit,
            unitPrice: String(price || 0),
            effectiveDate: effectiveDate || null,
          });
          itemsCreated++;
        }
      }

      // Update pricebook with item count and status
      await db.update(vendorPricebooks)
        .set({
          itemCount: itemsCreated,
          status: "ACTIVE",
          importedAt: new Date(),
        })
        .where(eq(vendorPricebooks.id, pricebook.id));

      res.status(201).json({
        pricebookId: pricebook.id,
        itemCount: itemsCreated,
        message: `Successfully imported ${itemsCreated} items`,
      });
    } catch (error) {
      console.error("Upload pricebook error:", error);
      res.status(500).json({ error: "Failed to process pricebook file" });
    }
  });

  // Add item to pricebook
  app.post("/api/ai-features/vendor-pricebooks/:pricebookId/items", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      // Verify pricebook exists and belongs to org
      const [pricebook] = await db.select().from(vendorPricebooks)
        .where(and(
          eq(vendorPricebooks.id, req.params.pricebookId),
          eq(vendorPricebooks.organizationId, organizationId)
        ))
        .limit(1);

      if (!pricebook) {
        return res.status(404).json({ error: "Pricebook not found" });
      }

      const { vendorCode, vendorDescription, category, unit, unitPrice } = req.body;

      const [item] = await db.insert(vendorPricebookItems).values({
        pricebookId: pricebook.id,
        organizationId,
        vendorId: pricebook.vendorId,
        vendorCode: vendorCode || `MANUAL-${Date.now()}`,
        vendorDescription: vendorDescription || "",
        vendorUnit: unit || "EA",
        category: category || "Uncategorized",
        unit: unit || "EA",
        unitPrice: String(unitPrice || 0),
      }).returning();

      // Update pricebook item count
      await db.update(vendorPricebooks)
        .set({ itemCount: sql`${vendorPricebooks.itemCount} + 1` })
        .where(eq(vendorPricebooks.id, pricebook.id));

      res.status(201).json(item);
    } catch (error) {
      console.error("Add pricebook item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update pricebook item
  app.patch("/api/ai-features/vendor-pricebooks/items/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [existing] = await db.select().from(vendorPricebookItems)
        .where(and(
          eq(vendorPricebookItems.id, req.params.id),
          eq(vendorPricebookItems.organizationId, organizationId)
        ))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Item not found" });
      }

      const { vendorCode, vendorDescription, category, unit, unitPrice, isActive } = req.body;

      const [updated] = await db.update(vendorPricebookItems)
        .set({
          ...(vendorCode !== undefined && { vendorCode }),
          ...(vendorDescription !== undefined && { vendorDescription }),
          ...(category !== undefined && { category }),
          ...(unit !== undefined && { unit, vendorUnit: unit }),
          ...(unitPrice !== undefined && { unitPrice: String(unitPrice) }),
          ...(isActive !== undefined && { isActive }),
          updatedAt: new Date(),
        })
        .where(eq(vendorPricebookItems.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update pricebook item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Sync pricebook to vendor pricing catalog (promote from staging)
  app.post("/api/ai-features/vendor-pricebooks/:pricebookId/sync", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(403).json({ error: "Organization not found" });
      }

      const [pricebook] = await db.select().from(vendorPricebooks)
        .where(and(
          eq(vendorPricebooks.id, req.params.pricebookId),
          eq(vendorPricebooks.organizationId, organizationId)
        ))
        .limit(1);

      if (!pricebook) {
        return res.status(404).json({ error: "Pricebook not found" });
      }

      // Get all active items from the pricebook
      const items = await db.select().from(vendorPricebookItems)
        .where(and(
          eq(vendorPricebookItems.pricebookId, pricebook.id),
          eq(vendorPricebookItems.isActive, true)
        ));

      let syncedCount = 0;
      for (const item of items) {
        // Check if item already exists in catalog
        const [existing] = await db.select().from(vendorPricingCatalogs)
          .where(and(
            eq(vendorPricingCatalogs.organizationId, organizationId),
            eq(vendorPricingCatalogs.crmOrganisationId, pricebook.vendorId),
            eq(vendorPricingCatalogs.itemCode, item.vendorCode)
          ))
          .limit(1);

        if (existing) {
          // Update existing catalog item
          await db.update(vendorPricingCatalogs)
            .set({
              itemName: item.vendorDescription,
              category: item.category,
              unit: item.unit,
              unitPrice: item.unitPrice,
              sourceType: "PRICEBOOK_IMPORT",
              updatedAt: new Date(),
            })
            .where(eq(vendorPricingCatalogs.id, existing.id));
        } else {
          // Create new catalog item
          const now = new Date();
          const quarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
          await db.insert(vendorPricingCatalogs).values({
            organizationId,
            crmOrganisationId: pricebook.vendorId,
            itemCode: item.vendorCode,
            itemName: item.vendorDescription,
            description: item.vendorDescription,
            category: item.category,
            unit: item.unit,
            unitPrice: item.unitPrice,
            sourceType: "PRICEBOOK_IMPORT",
            approvalStatus: "APPROVED",
            isActive: true,
            effectiveDate: now,
            effectiveQuarter: quarter,
          });
        }
        syncedCount++;
      }

      // Update pricebook last sync time
      await db.update(vendorPricebooks)
        .set({ importedAt: new Date() })
        .where(eq(vendorPricebooks.id, pricebook.id));

      res.json({
        success: true,
        syncedItems: syncedCount,
        message: `Successfully synced ${syncedCount} items to catalog`,
      });
    } catch (error) {
      console.error("Sync pricebook error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Scope Standardization Routes
  // ====================

  // Get all work type categories with their work types - organization-specific
  app.get("/api/scope/work-types", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: "Organization required" });
        return;
      }

      // Get organization to determine trade type
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      // First try to get organization-specific SOW items
      let sowItems = await db
        .select()
        .from(organizationSowItems)
        .where(
          and(
            eq(organizationSowItems.organizationId, organizationId),
            eq(organizationSowItems.isActive, true)
          )
        )
        .orderBy(organizationSowItems.displayOrder);

      // If no org-specific items, fall back to master SOW items for this trade
      if (sowItems.length === 0) {
        const masterItems = await db
          .select()
          .from(masterSowItems)
          .where(
            and(
              eq(masterSowItems.tradeType, org.tradeType),
              eq(masterSowItems.isActive, true)
            )
          )
          .orderBy(masterSowItems.sortOrder);

        // Convert master items to the expected format
        sowItems = masterItems.map((item, index) => ({
          id: item.id,
          organizationId: organizationId,
          categoryName: item.categoryName,
          name: item.name,
          code: item.code,
          description: item.description,
          unit: item.defaultUomCode,
          requiresDimensions: item.requiresDimensions,
          dimensionLabel: item.dimensionLabel,
          displayOrder: item.sortOrder,
          isFromTemplate: true,
          isActive: true,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
        }));
      }

      // If still no org-specific or trade-specific items, return empty array
      // Note: Legacy fallback to shared scope tables removed for multi-tenant isolation
      if (sowItems.length === 0) {
        console.log(`[WorkTypes] No SOW items found for organization ${organizationId} (trade: ${org.tradeType})`);
        res.json([]);
        return;
      }

      // Group SOW items by category name
      const categoryMap = new Map<string, {
        id: string;
        name: string;
        displayOrder: number;
        isActive: boolean;
        workTypes: Array<{
          id: string;
          categoryId: string;
          name: string;
          code: string;
          defaultUnit: string;
          requiresDimensions: boolean;
          dimensionType: string | null;
          displayOrder: number;
          isCustom: boolean;
          isActive: boolean;
        }>;
      }>();

      let categoryIndex = 0;
      for (const item of sowItems) {
        const categoryKey = item.categoryName;
        
        if (!categoryMap.has(categoryKey)) {
          categoryMap.set(categoryKey, {
            id: `cat-${categoryIndex++}`,
            name: item.categoryName,
            displayOrder: categoryIndex,
            isActive: true,
            workTypes: []
          });
        }

        const category = categoryMap.get(categoryKey)!;
        category.workTypes.push({
          id: item.id,
          categoryId: category.id,
          name: item.name,
          code: item.code,
          defaultUnit: item.unit || "EA",
          requiresDimensions: item.requiresDimensions,
          dimensionType: item.dimensionLabel ? "length_width_depth" : null,
          displayOrder: item.displayOrder,
          isCustom: !item.isFromTemplate,
          isActive: item.isActive
        });
      }

      // Convert map to array
      const categoriesWithTypes = Array.from(categoryMap.values());
      res.json(categoriesWithTypes);
    } catch (error) {
      console.error("Get scope work types error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all modifier categories with their modifiers - organization trade-specific
  app.get("/api/scope/modifiers", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: "Organization required" });
        return;
      }

      // Get organization to determine trade type
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      // Try to get trade-specific modifiers from master tables
      const masterCategories = await db
        .select()
        .from(masterModifierCategories)
        .where(
          and(
            eq(masterModifierCategories.tradeType, org.tradeType),
            eq(masterModifierCategories.isActive, true)
          )
        )
        .orderBy(masterModifierCategories.displayOrder);

      if (masterCategories.length > 0) {
        // Get all modifiers for this trade
        const masterMods = await db
          .select()
          .from(masterModifiers)
          .where(
            and(
              eq(masterModifiers.tradeType, org.tradeType),
              eq(masterModifiers.isActive, true)
            )
          )
          .orderBy(masterModifiers.displayOrder);

        // Group modifiers by category and format response
        const categoriesWithModifiers = masterCategories.map(cat => ({
          id: cat.id,
          name: cat.name,
          displayOrder: cat.displayOrder,
          isActive: cat.isActive,
          modifiers: masterMods
            .filter(m => m.categoryId === cat.id)
            .map(m => ({
              id: m.id,
              categoryId: m.categoryId,
              name: m.name,
              code: m.code,
              displayOrder: m.displayOrder,
              isActive: m.isActive,
              isCustom: false
            }))
        }));

        res.json(categoriesWithModifiers);
        return;
      }

      // No trade-specific modifiers found - return empty array for multi-tenant isolation
      // Note: Legacy fallback to shared tables removed to prevent cross-trade data leakage
      console.log(`[Modifiers] No trade-specific modifiers found for trade: ${org.tradeType}`);
      res.json([]);
    } catch (error) {
      console.error("Get scope modifiers error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Create work type category
  app.post("/api/scope/work-type-categories", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertScopeWorkTypeCategorySchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newCategory] = await db
        .insert(scopeWorkTypeCategories)
        .values(validationResult.data)
        .returning();

      res.status(201).json(newCategory);
    } catch (error) {
      console.error("Create work type category error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Create work type (creates in organizationSowItems for multi-tenant support)
  app.post("/api/scope/work-types", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: "Organization required" });
        return;
      }

      // Validate input shape with Zod
      const inputSchema = z.object({
        name: z.string().min(1, "Name is required"),
        code: z.string().min(1, "Code is required").regex(/^[a-zA-Z0-9_-]+$/, "Code must contain only letters, numbers, underscores, and dashes"),
        defaultUnit: z.string().optional().default("EA"),
        requiresDimensions: z.boolean().optional().default(false),
        dimensionType: z.string().optional().nullable(),
        tradeName: z.string().optional(),
        categoryName: z.string().optional(), // Direct category name from frontend
        displayOrder: z.number().optional(),
        categoryId: z.string().optional(), // Legacy support
      });

      const validationResult = inputSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { name, code, defaultUnit, requiresDimensions, dimensionType, tradeName, categoryName: inputCategoryName, displayOrder } = validationResult.data;

      // Sanitize text fields
      const sanitizedName = sanitizeShortText(name);
      const sanitizedCode = sanitizeShortText(code);

      // Use categoryName directly from frontend (robust approach - no index-based mapping)
      // Frontend sends the actual category name, either from existing category or generated
      const categoryName = sanitizeShortText(inputCategoryName) || sanitizeShortText(tradeName?.replace(/_/g, " ")) || "Custom";

      // Get max display order for this organization
      const [maxOrder] = await db
        .select({ max: sql<number>`COALESCE(MAX(display_order), 0)` })
        .from(organizationSowItems)
        .where(eq(organizationSowItems.organizationId, organizationId));

      const newDisplayOrder = displayOrder || (maxOrder?.max || 0) + 1;

      // Create the work type in organizationSowItems
      const [newWorkType] = await db
        .insert(organizationSowItems)
        .values({
          organizationId,
          categoryName,
          name: sanitizedName,
          code: sanitizedCode,
          unit: sanitizeShortText(defaultUnit) || "EA",
          requiresDimensions: requiresDimensions || false,
          dimensionLabel: dimensionType ? sanitizeShortText(dimensionType) : null,
          displayOrder: newDisplayOrder,
          isFromTemplate: false, // Custom items are not from template
          isActive: true,
        })
        .returning();

      // Calculate the actual categoryId by getting updated category list
      const updatedItems = await db
        .select({ categoryName: organizationSowItems.categoryName })
        .from(organizationSowItems)
        .where(
          and(
            eq(organizationSowItems.organizationId, organizationId),
            eq(organizationSowItems.isActive, true)
          )
        )
        .orderBy(organizationSowItems.displayOrder);
      
      const categoryMap = new Map<string, number>();
      let categoryIndex = 0;
      for (const item of updatedItems) {
        if (!categoryMap.has(item.categoryName)) {
          categoryMap.set(item.categoryName, categoryIndex++);
        }
      }
      const actualCategoryId = `cat-${categoryMap.get(categoryName) ?? 0}`;

      // Return response matching the format expected by GET endpoint
      res.status(201).json({
        id: newWorkType.id,
        categoryId: actualCategoryId,
        name: newWorkType.name,
        code: newWorkType.code,
        defaultUnit: newWorkType.unit,
        requiresDimensions: newWorkType.requiresDimensions,
        dimensionType: newWorkType.dimensionLabel,
        displayOrder: newWorkType.displayOrder,
        isCustom: true,
        isActive: newWorkType.isActive,
      });
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(400).json({ error: "A work type with this code already exists in your organization" });
        return;
      }
      console.error("Create work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Update work type
  app.put("/api/scope/work-types/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(scopeWorkTypes)
        .where(eq(scopeWorkTypes.id, req.params.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Work type not found" });
        return;
      }

      const [updated] = await db
        .update(scopeWorkTypes)
        .set({
          ...req.body,
          updatedAt: new Date()
        })
        .where(eq(scopeWorkTypes.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Soft delete work type (set inactive)
  app.delete("/api/scope/work-types/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(scopeWorkTypes)
        .where(eq(scopeWorkTypes.id, req.params.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Work type not found" });
        return;
      }

      // Soft delete - set inactive instead of hard delete
      await db
        .update(scopeWorkTypes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(scopeWorkTypes.id, req.params.id));

      res.json({ success: true });
    } catch (error) {
      console.error("Delete work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Create modifier category
  app.post("/api/scope/modifier-categories", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertScopeModifierCategorySchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newCategory] = await db
        .insert(scopeModifierCategories)
        .values(validationResult.data)
        .returning();

      res.status(201).json(newCategory);
    } catch (error) {
      console.error("Create modifier category error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Create modifier
  app.post("/api/scope/modifiers", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertScopeModifierSchema.safeParse({
        ...req.body,
        isCustom: true // Admin-added modifiers are marked as custom
      });
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newModifier] = await db
        .insert(scopeModifiers)
        .values(validationResult.data)
        .returning();

      res.status(201).json(newModifier);
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(400).json({ error: "A modifier with this code already exists" });
        return;
      }
      console.error("Create modifier error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Update modifier
  app.put("/api/scope/modifiers/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(scopeModifiers)
        .where(eq(scopeModifiers.id, req.params.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Modifier not found" });
        return;
      }

      const [updated] = await db
        .update(scopeModifiers)
        .set({
          ...req.body,
          updatedAt: new Date()
        })
        .where(eq(scopeModifiers.id, req.params.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Update modifier error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Admin: Soft delete modifier (set inactive)
  app.delete("/api/scope/modifiers/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const [existing] = await db
        .select()
        .from(scopeModifiers)
        .where(eq(scopeModifiers.id, req.params.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Modifier not found" });
        return;
      }

      // Soft delete - set inactive instead of hard delete
      await db
        .update(scopeModifiers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(scopeModifiers.id, req.params.id));

      res.json({ success: true });
    } catch (error) {
      console.error("Delete modifier error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Hierarchical Scope Selection for Line Items
  // Returns Trade → Subcategory → Work Types structure for GC and specialty trades
  // ====================

  app.get("/api/scope/hierarchical", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(403).json({ error: "Organization required" });
        return;
      }

      // Get organization trade type
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      const isGC = org.tradeType === "GENERAL_CONTRACTOR";

      // Get organization SOW items
      const sowItems = await db
        .select()
        .from(organizationSowItems)
        .where(
          and(
            eq(organizationSowItems.organizationId, organizationId),
            eq(organizationSowItems.isActive, true)
          )
        )
        .orderBy(organizationSowItems.displayOrder);

      // Build hierarchical structure
      // For GC: Trade → Subcategory → Work Types
      // For specialty: Single Trade → Category → Work Types
      const hierarchyMap = new Map<string, Map<string, typeof sowItems>>();

      for (const item of sowItems) {
        let tradeName: string;
        let subcategoryName: string;

        if (isGC && item.categoryName.includes(" - ")) {
          // Parse "TRADE_TYPE - Subcategory" format
          const parts = item.categoryName.split(" - ");
          tradeName = parts[0].replace(/_/g, " ");
          subcategoryName = parts.slice(1).join(" - ");
        } else {
          // Specialty trade: use org trade type as the trade
          tradeName = org.tradeType.replace(/_/g, " ");
          subcategoryName = item.categoryName;
        }

        if (!hierarchyMap.has(tradeName)) {
          hierarchyMap.set(tradeName, new Map());
        }
        const tradeMap = hierarchyMap.get(tradeName)!;

        if (!tradeMap.has(subcategoryName)) {
          tradeMap.set(subcategoryName, []);
        }
        tradeMap.get(subcategoryName)!.push(item);
      }

      // Convert to array structure for frontend
      const hierarchy = Array.from(hierarchyMap.entries()).map(([tradeName, subcategoryMap]) => {
        // Derive category code from trade name for reliable form mapping
        const categoryCode = tradeName.toUpperCase().replace(/ /g, "_");
        
        return {
          tradeName,
          categoryCode, // Include reliable category code for form mapping
          subcategories: Array.from(subcategoryMap.entries()).map(([subcategoryName, items]) => ({
            subcategoryName,
            workTypes: items.map(item => ({
              id: item.id,
              name: item.name,
              code: item.code,
              description: item.description,
              unit: item.unit,
              categoryName: item.categoryName, // Include original categoryName for reference
              requiresDimensions: item.requiresDimensions,
              dimensionLabel: item.dimensionLabel,
            })),
          })).sort((a, b) => a.subcategoryName.localeCompare(b.subcategoryName)),
        };
      }).sort((a, b) => a.tradeName.localeCompare(b.tradeName));

      res.json({
        isGC,
        tradeType: org.tradeType,
        hierarchy,
      });
    } catch (error) {
      console.error("Get hierarchical scope error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Material Calculator Presets
  // Save and load dimension configurations for work types
  // ====================

  // Get all presets for the organization
  app.get("/api/material-calculator/presets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "Organization required" });
        return;
      }

      const result = await db.execute(sql`
        SELECT * FROM material_calculator_presets 
        WHERE organization_id = ${organizationId}
        ORDER BY is_default DESC, name ASC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error("Get material calculator presets error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get presets for a specific work type code
  app.get("/api/material-calculator/presets/by-work-type/:workTypeCode", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "Organization required" });
        return;
      }

      const result = await db.execute(sql`
        SELECT * FROM material_calculator_presets 
        WHERE organization_id = ${organizationId}
          AND (work_type_code = ${req.params.workTypeCode} OR work_type_code IS NULL)
        ORDER BY 
          CASE WHEN work_type_code = ${req.params.workTypeCode} THEN 0 ELSE 1 END,
          is_default DESC, 
          name ASC
      `);

      res.json(result.rows);
    } catch (error) {
      console.error("Get presets by work type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new preset
  app.post("/api/material-calculator/presets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;
      const userId = req.user!.id;
      if (!organizationId) {
        res.status(400).json({ error: "Organization required" });
        return;
      }

      const { name, workTypeCode, unit, ...dimensions } = req.body;

      if (!name || !unit) {
        res.status(400).json({ error: "Name and unit are required" });
        return;
      }

      const result = await db.execute(sql`
        INSERT INTO material_calculator_presets (
          organization_id, name, work_type_code, unit,
          concrete_depth_inches, dimension_width_inches, dimension_height_inches, concrete_waste_factor,
          requires_stone_base, stone_type, stone_size, stone_depth_inches, stone_waste_factor,
          requires_excavation, excavation_depth_inches, excavation_width_inches, excavation_swell_factor,
          requires_wire_mesh, wire_mesh_type, wire_mesh_waste_factor,
          requires_rebar, rebar_size, rebar_fab_type, rebar_spacing_inches, rebar_waste_factor,
          requires_dowels, dowel_spacing_inches, joint_length_feet,
          requires_sealer, sealer_type, sealer_coats, sealer_waste_factor,
          requires_underlayment, underlayment_type, underlayment_overlap_inches, underlayment_waste_factor,
          is_default, created_by_id
        ) VALUES (
          ${organizationId}, ${name}, ${workTypeCode || null}, ${unit},
          ${dimensions.concreteDepthInches || null}, ${dimensions.dimensionWidthInches || null}, 
          ${dimensions.dimensionHeightInches || null}, ${dimensions.concreteWasteFactor || '10'},
          ${dimensions.requiresStoneBase || false}, ${dimensions.stoneType || null}, 
          ${dimensions.stoneSize || null}, ${dimensions.stoneDepthInches || null}, ${dimensions.stoneWasteFactor || '10'},
          ${dimensions.requiresExcavation || false}, ${dimensions.excavationDepthInches || null}, 
          ${dimensions.excavationWidthInches || null}, ${dimensions.excavationSwellFactor || '25'},
          ${dimensions.requiresWireMesh || false}, ${dimensions.wireMeshType || null}, 
          ${dimensions.wireMeshWasteFactor || '10'},
          ${dimensions.requiresRebar || false}, ${dimensions.rebarSize || null}, 
          ${dimensions.rebarFabType || null}, ${dimensions.rebarSpacingInches || null}, ${dimensions.rebarWasteFactor || '10'},
          ${dimensions.requiresDowels || false}, ${dimensions.dowelSpacingInches || null},
          ${dimensions.jointLengthFeet || null},
          ${dimensions.requiresSealer || false}, ${dimensions.sealerType || null}, 
          ${dimensions.sealerCoats || 1}, ${dimensions.sealerWasteFactor || '10'},
          ${dimensions.requiresUnderlayment || false}, ${dimensions.underlaymentType || null}, 
          ${dimensions.underlaymentOverlapInches || null}, ${dimensions.underlaymentWasteFactor || '10'},
          ${dimensions.isDefault || false}, ${userId}
        )
        RETURNING *
      `);

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Create material calculator preset error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update a preset
  app.put("/api/material-calculator/presets/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "Organization required" });
        return;
      }

      // Verify ownership
      const existing = await db.execute(sql`
        SELECT id FROM material_calculator_presets 
        WHERE id = ${req.params.id} AND organization_id = ${organizationId}
      `);

      if (existing.rows.length === 0) {
        res.status(404).json({ error: "Preset not found" });
        return;
      }

      const { name, workTypeCode, unit, ...dimensions } = req.body;

      const result = await db.execute(sql`
        UPDATE material_calculator_presets SET
          name = COALESCE(${name}, name),
          work_type_code = ${workTypeCode || null},
          unit = COALESCE(${unit}, unit),
          concrete_depth_inches = ${dimensions.concreteDepthInches || null},
          dimension_width_inches = ${dimensions.dimensionWidthInches || null},
          dimension_height_inches = ${dimensions.dimensionHeightInches || null},
          concrete_waste_factor = COALESCE(${dimensions.concreteWasteFactor}, '10'),
          requires_stone_base = COALESCE(${dimensions.requiresStoneBase}, false),
          stone_type = ${dimensions.stoneType || null},
          stone_size = ${dimensions.stoneSize || null},
          stone_depth_inches = ${dimensions.stoneDepthInches || null},
          stone_waste_factor = COALESCE(${dimensions.stoneWasteFactor}, '10'),
          requires_excavation = COALESCE(${dimensions.requiresExcavation}, false),
          excavation_depth_inches = ${dimensions.excavationDepthInches || null},
          excavation_width_inches = ${dimensions.excavationWidthInches || null},
          excavation_swell_factor = COALESCE(${dimensions.excavationSwellFactor}, '25'),
          requires_wire_mesh = COALESCE(${dimensions.requiresWireMesh}, false),
          wire_mesh_type = ${dimensions.wireMeshType || null},
          wire_mesh_waste_factor = COALESCE(${dimensions.wireMeshWasteFactor}, '10'),
          requires_rebar = COALESCE(${dimensions.requiresRebar}, false),
          rebar_size = ${dimensions.rebarSize || null},
          rebar_fab_type = ${dimensions.rebarFabType || null},
          rebar_spacing_inches = ${dimensions.rebarSpacingInches || null},
          rebar_waste_factor = COALESCE(${dimensions.rebarWasteFactor}, '10'),
          requires_dowels = COALESCE(${dimensions.requiresDowels}, false),
          dowel_spacing_inches = ${dimensions.dowelSpacingInches || null},
          joint_length_feet = ${dimensions.jointLengthFeet || null},
          requires_sealer = COALESCE(${dimensions.requiresSealer}, false),
          sealer_type = ${dimensions.sealerType || null},
          sealer_coats = COALESCE(${dimensions.sealerCoats}, 1),
          sealer_waste_factor = COALESCE(${dimensions.sealerWasteFactor}, '10'),
          requires_underlayment = COALESCE(${dimensions.requiresUnderlayment}, false),
          underlayment_type = ${dimensions.underlaymentType || null},
          underlayment_overlap_inches = ${dimensions.underlaymentOverlapInches || null},
          underlayment_waste_factor = COALESCE(${dimensions.underlaymentWasteFactor}, '10'),
          is_default = COALESCE(${dimensions.isDefault}, false),
          updated_at = NOW()
        WHERE id = ${req.params.id} AND organization_id = ${organizationId}
        RETURNING *
      `);

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Update material calculator preset error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete a preset
  app.delete("/api/material-calculator/presets/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "Organization required" });
        return;
      }

      // Verify ownership and delete
      const result = await db.execute(sql`
        DELETE FROM material_calculator_presets 
        WHERE id = ${req.params.id} AND organization_id = ${organizationId}
        RETURNING id
      `);

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Preset not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete material calculator preset error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Organization-Specific Work Categories
  // Get work categories based on organization's SOW items (trade-specific)
  // ====================
  
  // Legacy enum values that exist in the system for backward compatibility
  // These are the only valid category values for catalog lookups and estimate persistence
  const VALID_LEGACY_ENUMS = [
    "CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", 
    "STRIPING", "SIGNAGE", "LANDSCAPING", "ELECTRICAL", "OTHER"
  ] as const;
  
  // Comprehensive mapping from category name keywords to legacy enum values
  // Uses tokenized matching to avoid false positives
  // Priority order matters - more specific keywords should be checked first
  type CategoryMapping = {
    legacyEnum: string;
    priority: number;
    // Multi-word phrases that must appear as word sequences (not substrings)
    phrases: string[];
    // Single words that must match as complete tokens
    words: string[];
  };
  
  const categoryMappings: CategoryMapping[] = [
    // Striping/Markings (high priority)
    { legacyEnum: "STRIPING", priority: 1,
      phrases: ["pavement marking", "traffic paint", "cross walk", "stop bar", 
                "parking stall", "handicap space", "lane marking", "street marking", 
                "paint striping"],
      words: ["striping", "thermoplastic", "crosswalk"] },
    // Signage (high priority - avoid matching "design", "post-tension" etc.)
    { legacyEnum: "SIGNAGE", priority: 1,
      phrases: ["traffic sign", "street sign", "parking sign", "ada sign",
                "directional sign", "way finding", "sign installation",
                "monument sign", "regulatory sign"],
      words: ["signage", "wayfinding"] },
    // Bollards/Safety
    { legacyEnum: "BOLLARDS", priority: 2,
      phrases: ["guard rail", "safety barrier", "wheel stop", "parking barrier", 
                "crash barrier", "bumper post", "pipe bollard"],
      words: ["bollard", "guardrail"] },
    // Electrical
    { legacyEnum: "ELECTRICAL", priority: 2,
      phrases: ["electric work", "light fixture", "junction box", "pole light", 
                "area light", "parking lot lighting", "electrical conduit"],
      words: ["electrical", "lighting", "conduit", "transformer", "photocell"] },
    // Landscaping 
    { legacyEnum: "LANDSCAPING", priority: 2,
      phrases: ["erosion control", "silt fence", "fiber roll", "stormwater prevention", 
                "bmp installation", "sprinkler system", "drip line"],
      words: ["landscaping", "landscape", "irrigation", "hydroseed", "topsoil", 
              "swppp", "mulch", "sod", "turf", "shrub", "planting"] },
    // Concrete-related (flatwork, structural, decorative)
    { legacyEnum: "CONCRETE", priority: 3,
      phrases: ["curb and gutter", "curb & gutter", "stem wall", "retaining wall",
                "exposed aggregate", "stamped concrete", "colored concrete", 
                "expansion joint", "control joint", "post-tension", "post tension", 
                "pt slab"],
      words: ["concrete", "sidewalk", "driveway", "foundation", "patio", "flatwork",
              "footing", "slab", "pier", "rebar", "reinforcing", "dowel", "curb", 
              "gutter", "cmu", "masonry", "sawcut", "sawcutting"] },
    // Paving/Asphalt
    { legacyEnum: "PAVERS", priority: 3,
      phrases: ["ac paving", "hot mix", "cold patch", "base rock", "base course", 
                "seal coat", "slurry seal", "crack seal", "pothole repair", 
                "mill and overlay", "grind and overlay"],
      words: ["asphalt", "paving", "blacktop", "overlay", "paver"] },
    // Excavation/Earthwork-related (lowest priority - catches remaining site work)
    { legacyEnum: "EXCAVATION", priority: 4,
      phrases: ["site work", "rough grading", "fine grading", "haul off", "import fill",
                "storm drain", "sewer line", "underground utilities", "catch basin",
                "traffic control", "construction entrance", "jack and bore", 
                "pipe installation", "utility install", "temporary fencing", 
                "stabilized entrance", "site clearing", "directional drill"],
      words: ["excavation", "earthwork", "grading", "trenching", "backfill", "sitework",
              "demolition", "compaction", "subgrade", "manhole", "survey", "layout",
              "barricade", "flagging", "dewatering", "shoring", "boring", "grubbing",
              "stockpile", "stripping", "trench", "export"] },
  ].sort((a, b) => a.priority - b.priority);
  
  // Tokenize a string into words, handling hyphens and special characters
  function tokenize(input: string): string[] {
    // Replace hyphens/underscores with spaces, then split on non-alphanumeric
    return input.toLowerCase()
      .replace(/[-_]/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(word => word.length > 0);
  }
  
  // Check if phrase tokens appear in sequence within input tokens
  function containsPhrase(inputTokens: string[], phraseTokens: string[]): boolean {
    if (phraseTokens.length === 0) return false;
    
    for (let i = 0; i <= inputTokens.length - phraseTokens.length; i++) {
      let match = true;
      for (let j = 0; j < phraseTokens.length; j++) {
        if (inputTokens[i + j] !== phraseTokens[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }
  
  function mapCategoryToLegacyEnum(categoryName: string): { legacyEnum: string; isInferred: boolean } {
    const inputTokens = tokenize(categoryName);
    
    // Check each mapping for matches (in priority order)
    for (const mapping of categoryMappings) {
      // Check multi-word phrases first (more specific)
      for (const phrase of mapping.phrases) {
        const phraseTokens = tokenize(phrase);
        if (containsPhrase(inputTokens, phraseTokens)) {
          return { legacyEnum: mapping.legacyEnum, isInferred: true };
        }
      }
      
      // Then check single words (must be exact token match)
      for (const word of mapping.words) {
        if (inputTokens.includes(word.toLowerCase())) {
          return { legacyEnum: mapping.legacyEnum, isInferred: true };
        }
      }
    }
    
    // Fallback to OTHER for unmatched categories
    console.log(`[WorkCategories] Unmapped category: "${categoryName}" (tokens: ${inputTokens.join(', ')}) -> defaulting to OTHER`);
    return { legacyEnum: "OTHER", isInferred: true };
  }
  
  // Get organization-specific work categories from their SOW items
  app.get("/api/organization/work-categories", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      // Get organization's trade type first for context
      const [org] = await db
        .select({ tradeType: organizations.tradeType })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      // Default fallback categories based on valid legacy enums only
      // These match the enums used in vendor pricing, estimates, and analytics
      const defaultCategories = [
        { value: "CONCRETE", label: "Concrete", itemCount: 0, items: [], isDefault: false },
        { value: "EXCAVATION", label: "Excavation", itemCount: 0, items: [], isDefault: false },
        { value: "PAVERS", label: "Pavers", itemCount: 0, items: [], isDefault: false },
        { value: "BOLLARDS", label: "Bollards", itemCount: 0, items: [], isDefault: false },
        { value: "STRIPING", label: "Striping", itemCount: 0, items: [], isDefault: false },
        { value: "SIGNAGE", label: "Signage", itemCount: 0, items: [], isDefault: false },
        { value: "LANDSCAPING", label: "Landscaping", itemCount: 0, items: [], isDefault: false },
        { value: "ELECTRICAL", label: "Electrical", itemCount: 0, items: [], isDefault: false },
        { value: "OTHER", label: "Other", itemCount: 0, items: [], isDefault: true }
      ];

      // Fetch organization's SOW items grouped by category
      const orgSowItems = await db
        .select()
        .from(organizationSowItems)
        .where(and(
          eq(organizationSowItems.organizationId, orgId),
          eq(organizationSowItems.isActive, true)
        ))
        .orderBy(organizationSowItems.displayOrder);

      // Group by legacy enum value to maintain backward compatibility
      const categoriesMap = new Map<string, { 
        legacyEnum: string; 
        displayLabels: Set<string>;
        items: typeof orgSowItems;
        sortOrder: number;
      }>();

      for (const item of orgSowItems) {
        const { legacyEnum } = mapCategoryToLegacyEnum(item.categoryName);
        if (!categoriesMap.has(legacyEnum)) {
          categoriesMap.set(legacyEnum, {
            legacyEnum,
            displayLabels: new Set(),
            items: [],
            sortOrder: item.displayOrder || 0
          });
        }
        const cat = categoriesMap.get(legacyEnum)!;
        cat.displayLabels.add(item.categoryName);
        cat.items.push(item);
      }

      // Convert to array using legacy enum as value for backward compatibility
      if (categoriesMap.size > 0) {
        const categories = Array.from(categoriesMap.values())
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(cat => {
            // Create display label from unique category names
            const labelsArray = Array.from(cat.displayLabels);
            const displayLabel = labelsArray.length === 1 
              ? labelsArray[0] 
              : labelsArray.slice(0, 2).join(' / ') + (labelsArray.length > 2 ? ' +' : '');
            
            return {
              value: cat.legacyEnum, // Use legacy enum for backward compatibility
              label: displayLabel,
              itemCount: cat.items.length,
              isDefault: cat.legacyEnum === 'OTHER', // Mark OTHER as default fallback
              items: cat.items.map(i => ({
                id: i.id,
                name: i.name,
                code: i.code,
                unit: i.unit,
                description: i.description
              }))
            };
          });

        // Always ensure OTHER is available as catch-all
        if (!categories.find(c => c.value === 'OTHER')) {
          categories.push({ value: "OTHER", label: "Other", itemCount: 0, items: [], isDefault: true });
        }

        return res.json(categories);
      }

      // If no organization SOW items exist, get master SOW items based on trade type
      if (org?.tradeType) {
        const isGC = org.tradeType === 'GENERAL_CONTRACTOR';
        
        const masterItems = await db
          .select()
          .from(masterSowItems)
          .where(isGC 
            ? eq(masterSowItems.isActive, true)
            : and(
                eq(masterSowItems.tradeType, org.tradeType as any),
                eq(masterSowItems.isActive, true)
              )
          )
          .orderBy(masterSowItems.sortOrder);

        if (masterItems.length > 0) {
          // Group master items by legacy enum
          const masterCategoriesMap = new Map<string, { 
            legacyEnum: string; 
            displayLabels: Set<string>;
            items: typeof masterItems;
            sortOrder: number;
          }>();

          for (const item of masterItems) {
            const { legacyEnum } = mapCategoryToLegacyEnum(item.categoryName || 'General');
            if (!masterCategoriesMap.has(legacyEnum)) {
              masterCategoriesMap.set(legacyEnum, {
                legacyEnum,
                displayLabels: new Set(),
                items: [],
                sortOrder: item.sortOrder || 0
              });
            }
            const cat = masterCategoriesMap.get(legacyEnum)!;
            cat.displayLabels.add(item.categoryName || 'General');
            cat.items.push(item);
          }

          const masterCategories = Array.from(masterCategoriesMap.values())
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(cat => {
              const labelsArray = Array.from(cat.displayLabels);
              const displayLabel = labelsArray.length === 1 
                ? labelsArray[0] 
                : labelsArray.slice(0, 2).join(' / ') + (labelsArray.length > 2 ? ' +' : '');
              
              return {
                value: cat.legacyEnum,
                label: displayLabel,
                itemCount: cat.items.length,
                isDefault: cat.legacyEnum === 'OTHER',
                items: cat.items.map(i => ({
                  id: i.id,
                  name: i.name,
                  code: i.code,
                  unit: i.defaultUomCode,
                  description: i.description
                }))
              };
            });

          // Always ensure OTHER is available
          if (!masterCategories.find(c => c.value === 'OTHER')) {
            masterCategories.push({ value: "OTHER", label: "Other", itemCount: 0, items: [], isDefault: true });
          }

          return res.json(masterCategories);
        }
      }

      // Ultimate fallback - return default construction categories using legacy enums
      return res.json(defaultCategories);
    } catch (error) {
      console.error("Get organization work categories error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Trade Configuration Routes
  // ====================

  const { sowAuditLog, masterSowItems: masterSowItemsTable } = await import("@shared/schema");

  // Get organization trade configuration
  app.get("/api/organization/trade-config", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const [org] = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          tradeType: organizations.tradeType,
          tradeName: organizations.tradeName,
        })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // Get SOW item count
      const sowItemsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationSowItems)
        .where(and(
          eq(organizationSowItems.organizationId, orgId),
          eq(organizationSowItems.isActive, true)
        ));

      const sowItemCount = sowItemsResult[0]?.count || 0;

      // Get available trade types from enum
      const tradeTypes = tradeTypeEnum.enumValues.map(t => ({
        value: t,
        label: t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      }));

      res.json({
        organization: org,
        sowItemCount,
        tradeTypes
      });
    } catch (error) {
      console.error("Get trade config error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update organization trade type
  app.post("/api/organization/update-trade-type", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "HUSTLER"), async (req: AuthRequest, res) => {
    try {
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const { tradeType: newTradeType, tradeName } = req.body;

      // Validate trade type
      if (!tradeTypeEnum.enumValues.includes(newTradeType)) {
        return res.status(400).json({ 
          error: "Invalid trade type",
          message: `Trade type "${newTradeType}" is not valid. Valid options: ${tradeTypeEnum.enumValues.join(', ')}`
        });
      }

      // Get current organization
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      const previousTradeType = org.tradeType;

      // Update organization trade type
      await db
        .update(organizations)
        .set({ 
          tradeType: newTradeType,
          tradeName: newTradeType === 'OTHER' ? tradeName : null
        })
        .where(eq(organizations.id, orgId));

      // Log the change
      await db.insert(sowAuditLog).values({
        organizationId: orgId,
        userId: req.user!.id,
        action: "UPDATE",
        details: `Trade type changed from ${previousTradeType} to ${newTradeType}`,
        previousTradeType: previousTradeType,
        newTradeType: newTradeType,
      });

      console.log(`[TradeConfig] Trade type updated for org ${orgId}: ${previousTradeType} -> ${newTradeType}`);

      res.json({ 
        success: true, 
        message: "Trade type updated successfully",
        previousTradeType,
        newTradeType
      });
    } catch (error) {
      console.error("Update trade type error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Reinitialize SOW items based on current trade type
  app.post("/api/organization/reinitialize-sow", requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "HUSTLER"), async (req: AuthRequest, res) => {
    try {
      const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !orgId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      // Get organization
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      const tradeType = org.tradeType;
      const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
      const isCustomTrade = tradeType === 'OTHER';

      // Count existing active SOW items
      const existingCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(organizationSowItems)
        .where(and(
          eq(organizationSowItems.organizationId, orgId),
          eq(organizationSowItems.isActive, true)
        ));
      const existingCount = existingCountResult[0]?.count || 0;

      // Deactivate existing template-based SOW items (preserve custom items)
      const deactivatedResult = await db
        .update(organizationSowItems)
        .set({ isActive: false })
        .where(and(
          eq(organizationSowItems.organizationId, orgId),
          eq(organizationSowItems.isFromTemplate, true),
          eq(organizationSowItems.isActive, true)
        ))
        .returning({ id: organizationSowItems.id });

      const deactivatedCount = deactivatedResult.length;

      // Log deactivation
      await db.insert(sowAuditLog).values({
        organizationId: orgId,
        userId: req.user!.id,
        action: "DEACTIVATE",
        details: `Deactivated ${deactivatedCount} template-based SOW items for regeneration`,
        itemCount: deactivatedCount,
      });

      let newItemsCreated = 0;
      const newCategories: string[] = [];

      // Don't load new items for custom trades (OTHER) - they define their own
      if (!isCustomTrade) {
        // Load master SOW items based on trade type
        let masterItems;
        if (isGeneralContractor) {
          masterItems = await db
            .select()
            .from(masterSowItemsTable)
            .where(eq(masterSowItemsTable.isActive, true))
            .orderBy(asc(masterSowItemsTable.tradeType), asc(masterSowItemsTable.sortOrder));
        } else {
          masterItems = await db
            .select()
            .from(masterSowItemsTable)
            .where(and(
              eq(masterSowItemsTable.tradeType, tradeType as any),
              eq(masterSowItemsTable.isActive, true)
            ))
            .orderBy(asc(masterSowItemsTable.sortOrder));
        }

        // Safety check: Abort if no master items found for this trade type
        if (masterItems.length === 0) {
          console.warn(`[SOW] No master SOW items found for trade type ${tradeType} - reactivating deactivated items`);
          
          // Reactivate the items we just deactivated
          await db
            .update(organizationSowItems)
            .set({ isActive: true })
            .where(and(
              eq(organizationSowItems.organizationId, orgId),
              eq(organizationSowItems.isFromTemplate, true),
              eq(organizationSowItems.isActive, false)
            ));
          
          return res.status(400).json({ 
            error: "No templates available",
            message: `No master SOW items are configured for trade type ${tradeType}. Your existing items have been preserved.`
          });
        }

        // Create new organization SOW items
        for (const item of masterItems) {
          const categoryName = isGeneralContractor 
            ? `${item.tradeType} - ${item.categoryName || 'General'}`
            : item.categoryName || 'General';
          
          const itemCode = isGeneralContractor
            ? `${item.tradeType}_${item.code}`
            : item.code;

          // Check if this code already exists (even if inactive)
          const [existing] = await db
            .select()
            .from(organizationSowItems)
            .where(and(
              eq(organizationSowItems.organizationId, orgId),
              eq(organizationSowItems.code, itemCode)
            ))
            .limit(1);

          if (existing) {
            // Reactivate existing item
            await db
              .update(organizationSowItems)
              .set({ isActive: true })
              .where(eq(organizationSowItems.id, existing.id));
          } else {
            // Create new item
            await db.insert(organizationSowItems).values({
              organizationId: orgId,
              categoryName: categoryName,
              name: item.name,
              code: itemCode,
              description: item.description,
              unit: item.defaultUomCode,
              requiresDimensions: item.requiresDimensions || false,
              dimensionLabel: item.dimensionLabel,
              displayOrder: item.sortOrder || 0,
              isFromTemplate: true,
              isActive: true,
            });
            newItemsCreated++;
          }

          if (!newCategories.includes(categoryName)) {
            newCategories.push(categoryName);
          }
        }
      }

      // Log regeneration
      await db.insert(sowAuditLog).values({
        organizationId: orgId,
        userId: req.user!.id,
        action: "REGENERATE",
        details: `Regenerated SOW items for trade type ${tradeType}. Created ${newItemsCreated} new items across ${newCategories.length} categories.`,
        newTradeType: tradeType,
        itemCount: newItemsCreated,
      });

      console.log(`[SOW] Reinitialized SOW for org ${orgId}: ${deactivatedCount} deactivated, ${newItemsCreated} created, ${newCategories.length} categories`);

      res.json({
        success: true,
        message: isCustomTrade 
          ? "Template items deactivated. Add custom scope items for your trade."
          : "SOW items regenerated from trade templates",
        tradeType,
        isCustomTrade,
        deactivatedCount,
        newItemsCreated,
        categories: newCategories,
      });
    } catch (error) {
      console.error("Reinitialize SOW error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get SOW preview for a trade type (for onboarding review)
  app.get("/api/organization/sow-preview/:tradeType", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { tradeType } = req.params;

      // Validate trade type
      if (!tradeTypeEnum.enumValues.includes(tradeType as any)) {
        return res.status(400).json({ 
          error: "Invalid trade type",
          message: `Trade type "${tradeType}" is not valid.`
        });
      }

      const isGeneralContractor = tradeType === 'GENERAL_CONTRACTOR';
      const isCustomTrade = tradeType === 'OTHER';

      if (isCustomTrade) {
        return res.json({
          tradeType,
          isCustomTrade: true,
          categories: [],
          message: "Custom trades allow you to define your own scope of work items."
        });
      }

      // Get master SOW items
      let masterItems;
      if (isGeneralContractor) {
        masterItems = await db
          .select()
          .from(masterSowItemsTable)
          .where(eq(masterSowItemsTable.isActive, true))
          .orderBy(asc(masterSowItemsTable.tradeType), asc(masterSowItemsTable.sortOrder));
      } else {
        masterItems = await db
          .select()
          .from(masterSowItemsTable)
          .where(and(
            eq(masterSowItemsTable.tradeType, tradeType as any),
            eq(masterSowItemsTable.isActive, true)
          ))
          .orderBy(asc(masterSowItemsTable.sortOrder));
      }

      // Group by category
      const categoriesMap = new Map<string, { name: string; items: string[] }>();
      
      for (const item of masterItems) {
        const categoryName = isGeneralContractor 
          ? `${item.tradeType} - ${item.categoryName || 'General'}`
          : item.categoryName || 'General';
        
        if (!categoriesMap.has(categoryName)) {
          categoriesMap.set(categoryName, { name: categoryName, items: [] });
        }
        categoriesMap.get(categoryName)!.items.push(item.name);
      }

      const categories = Array.from(categoriesMap.values());

      res.json({
        tradeType,
        isCustomTrade: false,
        totalItems: masterItems.length,
        categories
      });
    } catch (error) {
      console.error("Get SOW preview error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Project Notes Routes
  // ====================

  const { projectNotes, insertProjectNoteSchema, media, insertMediaSchema } = await import("@shared/schema");

  // Get notes for a project
  app.get("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const notes = await db
        .select()
        .from(projectNotes)
        .where(eq(projectNotes.projectId, project.id))
        .orderBy(desc(projectNotes.createdAt));

      res.json(notes);
    } catch (error) {
      console.error("Get notes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create note (All authenticated users)
  app.post("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // SECURITY: Sanitize note content for data integrity
      const sanitizedBody = {
        ...req.body,
        content: sanitizeText(req.body.content),
      };

      const validationResult = insertProjectNoteSchema.extend({
        projectId: z.string().optional(),
        authorId: z.string().optional(),
      }).safeParse({
        ...sanitizedBody,
        projectId: project.id,
        authorId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Ensure required fields are set (TypeScript safety)
      const insertData = { ...validationResult.data, projectId: project.id, authorId: req.user!.id };
      const [newNote] = await db.insert(projectNotes).values([insertData]).returning();
      res.status(201).json(newNote);
    } catch (error: any) {
      console.error("Create note error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Media Routes
  // ====================

  // Get media for a project
  app.get("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get all media for this project
      const allMedia = await db
        .select()
        .from(media)
        .where(eq(media.projectId, project.id))
        .orderBy(desc(media.uploadedAt));

      // Filter by permissions
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const projectMedia = await filterFilesByPermissions(
        allMedia,
        req.user!.id,
        req.user!.role,
        "MEDIA"
      );

      res.json(projectMedia);
    } catch (error) {
      console.error("Get media error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create media (All authenticated users)
  // Note: This endpoint expects fileUrl to already be uploaded to object storage
  app.post("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        caption: req.body.caption ? sanitizeText(req.body.caption) : undefined,
      };

      const validationResult = insertMediaSchema.extend({
        projectId: z.string().optional(),
        uploadedById: z.string().optional(),
      }).safeParse({
        ...sanitizedBody,
        projectId: project.id,
        uploadedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
        validationResult.data.fileUrl,
        {
          owner: req.user!.id,
          organizationId: req.user!.organizationId!,
          visibility: "private",
        }
      );

      // Ensure required fields are set (TypeScript safety)
      const insertData = { ...validationResult.data, projectId: project.id, uploadedById: req.user!.id, objectKey };
      const [newMedia] = await db.insert(media).values([insertData]).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values([{
        fileId: newMedia.id,
        fileType: "MEDIA",
        userId: req.user!.id,
        grantedById: req.user!.id,
      }]);

      res.status(201).json(newMedia);
    } catch (error: any) {
      console.error("Create media error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete media (Admin/Manager/Superintendent or uploader)
  app.delete("/api/media/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [mediaItem] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);

      if (!mediaItem) {
        res.status(404).json({ error: "Media not found" });
        return;
      }

      // Check if user has permission
      const canDelete = req.user!.role === "ADMIN" || 
                       req.user!.role === "MANAGER" || 
                       req.user!.role === "SUPERINTENDENT" ||
                       mediaItem.uploadedById === req.user!.id;

      if (!canDelete) {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }

      await db.delete(media).where(eq(media.id, req.params.id));
      res.json({ success: true });
    } catch (error) {
      console.error("Delete media error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Time Entry Routes
  // ====================

  const { timeEntries, insertTimeEntrySchema, tmDailySheets, insertTMDailySheetSchema } = await import("@shared/schema");

  // Get time entries with pagination (filtered by role)
  app.get("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { page = "1", limit = "50", status, userId, projectId } = req.query;
      
      // Validate and sanitize pagination parameters
      const parsedPage = Number(page);
      const parsedLimit = Number(limit);

      let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
      let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
      
      if (limitNum > 1000) {
        limitNum = 1000; // Max limit to prevent abuse
      }

      const offset = (pageNum - 1) * limitNum;

      // Build base query conditions
      const conditions = [];
      
      if (req.user!.role === "HOURLY_EMPLOYEE") {
        // Hourly employees only see their own entries
        conditions.push(eq(timeEntries.userId, req.user!.id));
      } else if (userId) {
        // Managers/admins can filter by userId
        conditions.push(eq(timeEntries.userId, userId as string));
      }

      // Note: timeEntries table has no status column
      // Status is determined by whether approvedById is set or not
      if (status) {
        if (status === 'approved') {
          conditions.push(sql`${timeEntries.approvedById} IS NOT NULL`);
        } else if (status === 'pending') {
          conditions.push(sql`${timeEntries.approvedById} IS NULL`);
        }
      }

      if (projectId) {
        conditions.push(eq(timeEntries.projectId, projectId as string));
      }

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(timeEntries)
        .where(conditions.length > 0 ? and(...conditions) : sql`true`);
      const totalCount = totalResult[0]?.count || 0;

      // Get paginated entries
      let query = db.select().from(timeEntries);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const entries = await query
        .orderBy(desc(timeEntries.date))
        .limit(limitNum)
        .offset(offset);

      res.json({
        data: entries,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
        },
      });
    } catch (error) {
      console.error("Get time entries error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get time entries for a project
  app.get("/api/projects/:code/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const entries = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.projectId, project.id))
        .orderBy(desc(timeEntries.date));

      res.json(entries);
    } catch (error) {
      console.error("Get project time entries error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create time entry (All authenticated users)
  app.post("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const validationResult = insertTimeEntrySchema.extend({
        userId: z.string().optional(),
        date: z.coerce.date(),
      }).safeParse({
        ...sanitizedBody,
        userId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Check date constraints
      const entryDate = new Date(validationResult.data.date);
      const now = new Date();
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Prevent future dates
      if (entryDate > now) {
        res.status(400).json({ 
          error: "Invalid date",
          details: "Time entries cannot be created for future dates."
        });
        return;
      }

      // Non-admin users cannot create entries older than 90 days
      if (req.user!.role !== "ADMIN" && entryDate < ninetyDaysAgo) {
        res.status(400).json({ 
          error: "Invalid date",
          details: "Time entries cannot be created for dates more than 90 days in the past. Please contact an administrator."
        });
        return;
      }

      // Ensure required fields are set (TypeScript safety)
      const insertData = { ...validationResult.data, userId: req.user!.id };
      
      // Create time entry (sequential operations - Neon HTTP driver doesn't support transactions)
      const [newEntry] = await db.insert(timeEntries).values([insertData]).returning();
      
      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "TIME_ENTRY", newEntry.id, newEntry, req);
      
      res.status(201).json(newEntry);
    } catch (error: any) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update time entry (with locking)
  app.patch("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      };

      const schema = z.object({
        date: z.coerce.date().optional(),
        hoursRegular: z.string().optional(),
        hoursOvertime: z.string().optional(),
        costCode: z.string().optional(),
        notes: z.string().optional(),
        adminOverride: z.boolean().optional(),
      });

      const data = schema.parse(sanitizedBody);

      // Get existing entry
      const [existingEntry] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!existingEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

      // Check locking: if approved (has approvedAt or approvedById), only ADMIN can modify with explicit override
      if (existingEntry.approvedAt || existingEntry.approvedById) {
        if (req.user!.role !== "ADMIN" || !data.adminOverride) {
          res.status(403).json({ 
            error: "This time entry has been approved and is locked. Only administrators can modify approved entries with explicit override." 
          });
          return;
        }
      }

      // Verify ownership (unless admin)
      if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
        res.status(403).json({ error: "You can only edit your own time entries" });
        return;
      }

      const updates: any = { updatedAt: new Date() };
      
      if (data.date) updates.date = data.date;
      if (data.hoursRegular !== undefined) updates.hoursRegular = data.hoursRegular;
      if (data.hoursOvertime !== undefined) updates.hoursOvertime = data.hoursOvertime;
      if (data.costCode !== undefined) updates.costCode = data.costCode;
      if (data.notes !== undefined) updates.notes = data.notes;

      // Update time entry (sequential operations - Neon HTTP driver doesn't support transactions)
      const [updatedEntry] = await db
        .update(timeEntries)
        .set(updates)
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      // Audit log (pass raw objects, not JSON.stringify)
      await logUpdate(
        req.user!.id,
        "TIME_ENTRY",
        req.params.id,
        existingEntry,
        { ...updates, adminOverride: data.adminOverride },
        req
      );

      res.json(updatedEntry);
    } catch (error) {
      console.error("Update time entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete time entry (with locking)
  app.delete("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Get existing entry
      const [existingEntry] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!existingEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

      // Check locking: if approved (has approvedAt or approvedById), only ADMIN can delete
      if ((existingEntry.approvedAt || existingEntry.approvedById) && req.user!.role !== "ADMIN") {
        res.status(403).json({ 
          error: "This time entry has been approved and is locked. Only administrators can delete approved entries." 
        });
        return;
      }

      // Verify ownership (unless admin/manager)
      if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
        res.status(403).json({ error: "You can only delete your own time entries" });
        return;
      }

      // Delete time entry (sequential operations - Neon HTTP driver doesn't support transactions)
      await db.delete(timeEntries).where(eq(timeEntries.id, req.params.id));

      // Audit log (pass raw object, not JSON.stringify)
      await logDelete(req.user!.id, "TIME_ENTRY", req.params.id, existingEntry, req);

      res.status(204).send();
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve time entry (Admin/Manager only)
  app.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [existingEntry] = await db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, req.params.id))
        .limit(1);

      if (!existingEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

      // Approve time entry (sequential operations - Neon HTTP driver doesn't support transactions)
      const [updatedEntry] = await db
        .update(timeEntries)
        .set({
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      // Audit log (pass raw object, not JSON.stringify)
      await logApprove(req.user!.id, "TIME_ENTRY", req.params.id, { approver: req.user!.email }, req);

      res.json(updatedEntry);
    } catch (error) {
      console.error("Approve time entry error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // T&M Daily Sheet Routes
  // ====================

  // Get T&M sheets/tickets for a project (uses new tmTickets table, mapped to legacy format)
  app.get("/api/projects/:code/tm-sheets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Query the new tmTickets table with user info for rep name
      const tickets = await db
        .select({
          ticket: tmTickets,
          repFirstName: users.firstName,
          repLastName: users.lastName,
        })
        .from(tmTickets)
        .leftJoin(users, eq(tmTickets.tfrRepresentativeId, users.id))
        .where(eq(tmTickets.projectId, project.id))
        .orderBy(desc(tmTickets.workDate));

      // Map tmTickets fields to the format the frontend expects (compatible with legacy TMDailySheet format)
      const mappedSheets = tickets.map(row => ({
        id: row.ticket.id,
        projectId: row.ticket.projectId,
        date: row.ticket.workDate, // Map workDate to date for frontend compatibility
        tfrRepName: row.repFirstName && row.repLastName 
          ? `${row.repFirstName} ${row.repLastName}` 
          : "Unknown",
        clientRepName: null,
        weather: null,
        descriptionOfWork: row.ticket.scopeDescription,
        crewSize: null,
        laborSummaryJson: null,
        equipmentUsedJson: null,
        materialsUsedJson: null,
        attachmentsJson: null,
        clientSignatureName: null,
        clientSignatureDate: null,
        createdById: row.ticket.createdById,
        createdAt: row.ticket.createdAt,
        updatedAt: row.ticket.updatedAt,
        // Also include tmTickets-specific fields for enhanced display
        ticketNumber: row.ticket.ticketNumber,
        status: row.ticket.status,
        billingStatus: row.ticket.billingStatus,
        grandTotal: row.ticket.grandTotal,
        workTypeName: row.ticket.workTypeName,
        categoryName: row.ticket.categoryName,
        scopeQuantity: row.ticket.scopeQuantity,
        scopeUnit: row.ticket.scopeUnit,
      }));

      res.json(mappedSheets);
    } catch (error) {
      console.error("Get T&M sheets error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create T&M daily sheet (Admin/Manager/Superintendent only)
  app.post("/api/tm-sheets", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        descriptionOfWork: sanitizeText(req.body.descriptionOfWork),
        weather: req.body.weather ? sanitizeShortText(req.body.weather) : undefined,
      };

      const validationResult = insertTMDailySheetSchema.extend({
        createdById: z.string().optional(),
        date: z.coerce.date(),
      }).safeParse({
        ...sanitizedBody,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, createdById: req.user!.id };

      // BUSINESS VALIDATION: Validate JSON fields and normalize empty strings to null
      const jsonFields: Array<{ field: keyof typeof insertData; value: string | null | undefined; name: string }> = [
        { field: "laborSummaryJson", value: insertData.laborSummaryJson, name: "Labor summary JSON" },
        { field: "equipmentUsedJson", value: insertData.equipmentUsedJson, name: "Equipment used JSON" },
        { field: "materialsUsedJson", value: insertData.materialsUsedJson, name: "Materials used JSON" },
        { field: "attachmentsJson", value: insertData.attachmentsJson, name: "Attachments JSON" },
      ];

      for (const fieldDef of jsonFields) {
        if (fieldDef.value !== null && fieldDef.value !== undefined) {
          const jsonCheck = validateJSONField(fieldDef.value, fieldDef.name);
          if (!jsonCheck.valid) {
            res.status(400).json({ error: jsonCheck.error });
            return;
          }
          // Normalize empty strings to null
          if (fieldDef.value === "" || jsonCheck.parsed === null) {
            (insertData as any)[fieldDef.field] = null;
          }
        }
      }

      // BUSINESS VALIDATION: Check if T&M sheet already exists for this project/date
      const [existingSheet] = await db
        .select()
        .from(tmDailySheets)
        .where(
          and(
            eq(tmDailySheets.projectId, insertData.projectId),
            sql`DATE(${tmDailySheets.date}) = DATE(${insertData.date})`
          )
        )
        .limit(1);

      if (existingSheet) {
        res.status(409).json({ 
          error: "T&M sheet already exists for this project and date",
          details: "A Time & Materials sheet has already been created for this project on the specified date."
        });
        return;
      }

      const [newSheet] = await db.insert(tmDailySheets).values([insertData]).returning();
      res.status(201).json(newSheet);
    } catch (error: any) {
      console.error("Create T&M sheet error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Estimates Routes
  // ====================

  const { estimates, insertEstimateSchema, procurementItems, insertProcurementItemSchema, receipts, insertReceiptSchema, planDocuments, insertPlanDocumentSchema } = await import("@shared/schema");

  // Get estimates for a project (by code)
  app.get("/api/projects/:code/estimates", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const projectEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.projectId, project.id))
        .orderBy(desc(estimates.versionNumber));

      res.json(projectEstimates);
    } catch (error) {
      console.error("Get estimates error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get active estimate with line items for a project (by project ID)
  // Used by ProjectEstimate component - returns the active/approved estimate with line items and computed totals
  app.get("/api/projects/:id/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      const projectId = req.params.id;
      
      // Find active estimate (APPROVED or latest DRAFT)
      const projectEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.projectId, projectId))
        .orderBy(desc(estimates.versionNumber));
      
      if (projectEstimates.length === 0) {
        res.json({ estimate: null });
        return;
      }
      
      // Use approved estimate if available, otherwise most recent
      const activeEstimate = projectEstimates.find(e => e.status === "APPROVED") || projectEstimates[0];
      
      // Get line items for the active estimate
      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, activeEstimate.id));
      
      // Calculate totals from line items
      const totals = lineItems.reduce((acc, item) => {
        return {
          materialCost: acc.materialCost + Number(item.materialCost || 0),
          laborCost: acc.laborCost + Number(item.laborCost || 0),
          laborHours: acc.laborHours + Number(item.laborHours || 0),
          equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
          consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
          subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
          overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
          profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
          totalCost: acc.totalCost + Number(item.totalCost || 0),
        };
      }, {
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      });
      
      res.json({
        estimate: {
          ...activeEstimate,
          lineItems,
          totals,
        }
      });
    } catch (error) {
      console.error("Get project estimate error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create estimate for project (by project ID) - used by ProjectEstimate component
  app.post("/api/projects/:id/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const projectId = req.params.id;
      
      // Check if project exists
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      
      // Check if estimate already exists for this project
      const existingEstimates = await db
        .select()
        .from(estimates)
        .where(eq(estimates.projectId, projectId))
        .limit(1);
      
      if (existingEstimates.length > 0) {
        // Return existing estimate instead of creating new one
        const estimate = existingEstimates[0];
        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, estimate.id));
        
        const totals = lineItems.reduce((acc, item) => ({
          materialCost: acc.materialCost + Number(item.materialCost || 0),
          laborCost: acc.laborCost + Number(item.laborCost || 0),
          laborHours: acc.laborHours + Number(item.laborHours || 0),
          equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
          consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
          subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
          overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
          profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
          totalCost: acc.totalCost + Number(item.totalCost || 0),
        }), {
          materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
          consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
          profitAllocation: 0, totalCost: 0,
        });
        
        res.json({ estimate: { ...estimate, lineItems, totals } });
        return;
      }
      
      // Create new estimate
      const [newEstimate] = await db.insert(estimates).values({
        projectId,
        createdById: req.user!.id,
        status: "DRAFT",
        versionNumber: 1,
      }).returning();
      
      res.status(201).json({
        estimate: {
          ...newEstimate,
          lineItems: [],
          totals: {
            materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
            consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
            profitAllocation: 0, totalCost: 0,
          }
        }
      });
    } catch (error) {
      console.error("Create project estimate error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create estimate (Admin/Manager only)
  app.post("/api/estimates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertEstimateSchema.extend({
        createdById: z.string().optional(),
      }).safeParse({
        ...req.body,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Validate JSON fields and normalize empty strings to null
      const jsonFields: Array<{ field: keyof typeof validationResult.data; value: string | null | undefined; name: string }> = [
        { field: "altPricesJson", value: validationResult.data.altPricesJson, name: "Alternative prices JSON" },
        { field: "costBreakdownJson", value: validationResult.data.costBreakdownJson, name: "Cost breakdown JSON" },
      ];

      for (const fieldDef of jsonFields) {
        if (fieldDef.value !== null && fieldDef.value !== undefined) {
          const jsonCheck = validateJSONField(fieldDef.value, fieldDef.name);
          if (!jsonCheck.valid) {
            res.status(400).json({ error: jsonCheck.error });
            return;
          }
          // Normalize empty strings to null
          if (fieldDef.value === "" || jsonCheck.parsed === null) {
            (validationResult.data as any)[fieldDef.field] = null;
          }
        }
      }

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, createdById: req.user!.id };
      const [newEstimate] = await db.insert(estimates).values([insertData]).returning();
      res.status(201).json(newEstimate);
    } catch (error: any) {
      console.error("Create estimate error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Procurement Routes
  // ====================

  // Get procurement items for a project
  app.get("/api/projects/:code/procurement", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const items = await db
        .select()
        .from(procurementItems)
        .where(eq(procurementItems.projectId, project.id));

      res.json(items);
    } catch (error) {
      console.error("Get procurement items error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create procurement item (Admin/Manager only)
  app.post("/api/procurement", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertProcurementItemSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newItem] = await db.insert(procurementItems).values(validationResult.data).returning();
      res.status(201).json(newItem);
    } catch (error: any) {
      console.error("Create procurement item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update procurement item schema
  const updateProcurementSchema = insertProcurementItemSchema.omit({ projectId: true }).partial();

  // Update procurement item status (Admin/Manager only)
  app.patch("/api/procurement/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateProcurementSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedItem] = await db
        .update(procurementItems)
        .set(updateData)
        .where(eq(procurementItems.id, req.params.id))
        .returning();

      if (!updatedItem) {
        res.status(404).json({ error: "Procurement item not found" });
        return;
      }

      res.json(updatedItem);
    } catch (error: any) {
      console.error("Update procurement item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Pending Quotes Routes (for quotes transferred from bids but not yet selected)
  // ====================

  // Get all pending (non-selected) quotes for a project
  app.get("/api/projects/:code/pending-quotes", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const { and } = await import("drizzle-orm");

      // Get non-selected subcontractor quotes for this project
      const pendingSubQuotes = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(and(
          eq(bidSubcontractorQuotes.projectId, project.id),
          eq(bidSubcontractorQuotes.isSelected, false)
        ))
        .orderBy(desc(bidSubcontractorQuotes.createdAt));

      // Get non-selected material quotes for this project
      const pendingMatQuotes = await db
        .select()
        .from(bidMaterialQuotes)
        .where(and(
          eq(bidMaterialQuotes.projectId, project.id),
          eq(bidMaterialQuotes.isSelected, false)
        ))
        .orderBy(desc(bidMaterialQuotes.createdAt));

      res.json({
        subcontractorQuotes: pendingSubQuotes,
        materialQuotes: pendingMatQuotes,
      });
    } catch (error) {
      console.error("Get pending quotes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Select a pending subcontractor quote (creates contract)
  app.post("/api/projects/:code/pending-quotes/subcontractor/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const { and } = await import("drizzle-orm");

      // Get the quote
      const [quote] = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(and(
          eq(bidSubcontractorQuotes.id, req.params.quoteId),
          eq(bidSubcontractorQuotes.projectId, project.id),
          eq(bidSubcontractorQuotes.isSelected, false)
        ))
        .limit(1);

      if (!quote) {
        res.status(404).json({ error: "Pending quote not found" });
        return;
      }

      // Find or create subcontractor record
      let subcontractor;
      if (quote.contactEmail || quote.contactPhone) {
        const { or, and: andFn } = await import("drizzle-orm");
        const contactConditions = [];
        if (quote.contactEmail) {
          contactConditions.push(eq(subcontractors.email, quote.contactEmail));
        }
        if (quote.contactPhone) {
          contactConditions.push(eq(subcontractors.phone, quote.contactPhone));
        }
        
        subcontractor = await db.query.subcontractors.findFirst({
          where: andFn(
            eq(subcontractors.companyName, quote.subcontractorName),
            or(...contactConditions)
          ),
        });
      }
      
      if (!subcontractor) {
        subcontractor = await db.query.subcontractors.findFirst({
          where: eq(subcontractors.companyName, quote.subcontractorName),
        });
      }

      if (!subcontractor) {
        [subcontractor] = await db.insert(subcontractors).values({
          companyName: quote.subcontractorName,
          contactName: quote.contactName || null,
          email: quote.contactEmail || null,
          phone: quote.contactPhone || null,
          notes: quote.notes || null,
          isActive: true,
        }).returning();
      }

      // Get count of existing contracts for contract number
      const existingContracts = await db
        .select()
        .from(subcontractorContracts)
        .where(eq(subcontractorContracts.projectId, project.id));

      // Create subcontractor contract from quote
      const contractNumber = `SC-${project.code}-${String(existingContracts.length + 1).padStart(3, '0')}`;
      const paymentTerms = quote.leadTime ? `Lead Time: ${quote.leadTime}`.substring(0, 500) : null;
      
      const notesParts: string[] = [];
      if (quote.estimatedCompletionTime) notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
      if (quote.notes) notesParts.push(quote.notes);
      if (quote.fileUrl) {
        const sanitizedFileName = (quote.fileName || 'Document').replace(/[\r\n]/g, ' ').trim();
        notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
      }
      
      const notes = notesParts.length > 0 ? notesParts.join('\n').substring(0, 1000) : null;
      
      const [newContract] = await db.insert(subcontractorContracts).values({
        subcontractorId: subcontractor.id,
        projectId: project.id,
        contractNumber,
        scopeOfWork: quote.scopeOfWork,
        contractAmount: quote.quoteAmount,
        status: "PENDING",
        paymentTerms,
        notes,
        createdById: req.user!.id,
      }).returning();

      // Mark quote as selected
      await db
        .update(bidSubcontractorQuotes)
        .set({ isSelected: true, updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, quote.id));

      res.json({ 
        success: true, 
        contract: newContract,
        message: `Subcontractor contract created: ${contractNumber}`
      });
    } catch (error) {
      console.error("Select pending subcontractor quote error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Select a pending material quote (creates procurement item)
  app.post("/api/projects/:code/pending-quotes/material/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const { and } = await import("drizzle-orm");

      // Get the quote
      const [quote] = await db
        .select()
        .from(bidMaterialQuotes)
        .where(and(
          eq(bidMaterialQuotes.id, req.params.quoteId),
          eq(bidMaterialQuotes.projectId, project.id),
          eq(bidMaterialQuotes.isSelected, false)
        ))
        .limit(1);

      if (!quote) {
        res.status(404).json({ error: "Pending quote not found" });
        return;
      }

      // Build comprehensive description with all quote details
      let fullDescription = quote.materialName;
      if (quote.specs) fullDescription += ` - ${quote.specs}`;
      if (quote.description) fullDescription += `\n${quote.description}`;
      
      const additionalInfo: string[] = [];
      if (quote.leadTime) additionalInfo.push(`Lead Time: ${quote.leadTime}`);
      if (quote.supplierContact) additionalInfo.push(`Supplier Contact: ${quote.supplierContact}`);
      
      if (additionalInfo.length > 0) {
        fullDescription += `\n\n[Quote Details]\n${additionalInfo.join('\n')}`;
      }
      
      // Create procurement item from material quote
      const [newItem] = await db.insert(procurementItems).values({
        projectId: project.id,
        description: fullDescription,
        vendor: quote.supplierName || null,
        quantity: "1",
        unit: "LOT",
        unitCost: quote.cost,
        status: "PLANNED",
        neededByDate: null,
      }).returning();

      // Mark quote as selected
      await db
        .update(bidMaterialQuotes)
        .set({ isSelected: true, updatedAt: new Date() })
        .where(eq(bidMaterialQuotes.id, quote.id));

      res.json({ 
        success: true, 
        procurementItem: newItem,
        message: `Procurement item created: ${quote.materialName}`
      });
    } catch (error) {
      console.error("Select pending material quote error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Receipts Routes
  // ====================

  // Get receipts for a project
  app.get("/api/projects/:code/receipts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Get all receipts for this project
      const allReceipts = await db
        .select()
        .from(receipts)
        .where(eq(receipts.projectId, project.id))
        .orderBy(desc(receipts.date));

      // Filter by permissions
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const projectReceipts = await filterFilesByPermissions(
        allReceipts,
        req.user!.id,
        req.user!.role,
        "RECEIPT"
      );

      res.json(projectReceipts);
    } catch (error) {
      console.error("Get receipts error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create receipt (All authenticated users)
  app.post("/api/receipts", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Transform the request data to match schema expectations
      // Handle empty string for amount - convert to "0" or undefined
      const rawAmount = req.body.amount;
      let processedAmount: string | undefined = undefined;
      if (rawAmount !== undefined && rawAmount !== null && rawAmount !== "") {
        processedAmount = String(rawAmount);
      } else if (rawAmount === "") {
        processedAmount = "0"; // Default empty amount to 0
      }
      
      const transformedData = {
        ...req.body,
        userId: req.user!.id,
        // Ensure date is a Date object
        date: req.body.date ? new Date(req.body.date) : undefined,
        // Ensure amount is a valid string for decimal type
        amount: processedAmount,
      };
      
      const validationResult = insertReceiptSchema.extend({
        userId: z.string().optional(),
      }).safeParse(transformedData);
      
      if (!validationResult.success) {
        console.error("Receipt validation errors:", JSON.stringify(validationResult.error.errors, null, 2));
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
        validationResult.data.fileUrl,
        {
          owner: req.user!.id,
          organizationId: req.user!.organizationId!,
          visibility: "private",
        }
      );

      // Ensure required fields are set (TypeScript safety)
      const insertData = { ...validationResult.data, userId: req.user!.id, objectKey };
      const [newReceipt] = await db.insert(receipts).values([insertData]).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values([{
        fileId: newReceipt.id,
        fileType: "RECEIPT",
        userId: req.user!.id,
        grantedById: req.user!.id,
      }]);

      res.status(201).json(newReceipt);
    } catch (error: any) {
      console.error("Create receipt error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Plan Documents Routes
  // ====================

  // Get plan documents for a project
  app.get("/api/projects/:code/documents", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      // Get all documents for this project
      const allDocs = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.projectId, project.id))
        .orderBy(desc(planDocuments.uploadedAt));

      // Filter by permissions
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const docs = await filterFilesByPermissions(
        allDocs,
        req.user!.id,
        req.user!.role,
        "DOCUMENT"
      );

      res.json(docs);
    } catch (error) {
      console.error("Get documents error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create plan document (Admin/Manager only)
  app.post("/api/documents", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertPlanDocumentSchema.extend({
        uploadedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        uploadedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      
      const objectKey = await objectStorageService.trySetObjectEntityAclPolicy(
        validationResult.data.fileUrl,
        {
          owner: req.user!.id,
          organizationId: req.user!.organizationId!,
          visibility: "private",
        }
      );

      // Ensure required fields are set (TypeScript safety)
      const insertData = { ...validationResult.data, uploadedById: req.user!.id, objectKey };
      const [newDoc] = await db.insert(planDocuments).values([insertData]).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values([{
        fileId: newDoc.id,
        fileType: "DOCUMENT",
        userId: req.user!.id,
        grantedById: req.user!.id,
      }]);

      res.status(201).json(newDoc);
    } catch (error: any) {
      console.error("Create document error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete plan document
  app.delete("/api/documents/:documentId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { documentId } = req.params;
      const userRole = req.user!.role;
      const userId = req.user!.id;

      // Get the document with project verification
      const [document] = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.id, documentId))
        .limit(1);

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // Verify project exists
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, document.projectId))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Check if user has permission to delete
      // Only Admin and Manager roles can delete documents
      // This aligns with the RBAC system where these roles have project-level access
      const canDelete = userRole === "ADMIN" || userRole === "MANAGER";
      
      if (!canDelete) {
        res.status(403).json({ error: "Only administrators and managers can delete documents" });
        return;
      }

      // Delete the file from object storage first (before DB deletion)
      if (document.objectKey) {
        try {
          const { ObjectStorageService } = await import("./objectStorage");
          const objectStorageService = new ObjectStorageService();
          const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
          await objectFile.delete();
        } catch (error) {
          console.error("Error deleting file from object storage:", error);
          // Don't fail the whole operation if storage deletion fails
          // The file becomes orphaned but we can clean it up later
        }
      }

      // Delete related project_plans (which will cascade delete takeoff_sheets)
      // This ensures no orphaned plans or sheets remain after document deletion
      const { projectPlans } = await import("@shared/schema");
      await db.delete(projectPlans).where(eq(projectPlans.documentId, documentId));

      // Delete the document record
      await db.delete(planDocuments).where(eq(planDocuments.id, documentId));

      // Log the deletion
      await logDelete(
        req.user!.id,
        "DOCUMENT",
        documentId,
        JSON.stringify(document),
        req
      );

      res.json({ message: "Document deleted successfully" });
    } catch (error: any) {
      console.error("Delete document error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get presigned download URL for a document
  app.get("/api/documents/:documentId/download-url", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { documentId } = req.params;

      // Get the document
      const [document] = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.id, documentId))
        .limit(1);

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // Check if user has permission to access this document
      const [permission] = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, documentId),
            eq(filePermissions.fileType, "DOCUMENT"),
            eq(filePermissions.userId, req.user!.id)
          )
        )
        .limit(1);

      // Check if user uploaded the document or has permission
      const hasAccess = document.uploadedById === req.user!.id || 
                        permission !== undefined ||
                        req.user!.role === "ADMIN" ||
                        req.user!.role === "MANAGER";

      if (!hasAccess) {
        res.status(403).json({ error: "Not authorized to access this document" });
        return;
      }

      // If document has objectKey, generate presigned URL
      if (document.objectKey) {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
          
          // Generate presigned URL (valid for 1 hour)
          const [signedUrl] = await objectFile.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
          });

          res.json({ url: signedUrl });
        } catch (error) {
          console.error("Error generating presigned URL:", error);
          // Fallback to direct fileUrl if presigned URL generation fails
          res.json({ url: document.fileUrl });
        }
      } else {
        // No objectKey, return direct fileUrl
        res.json({ url: document.fileUrl });
      }
    } catch (error: any) {
      console.error("Get document download URL error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // File Permissions Routes
  // ====================

  // Grant file access (Manager/Admin only)
  app.post("/api/file-permissions", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertFilePermissionSchema.extend({
        grantedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        grantedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Check if permission already exists
      const [existing] = await db
        .select()
        .from(filePermissions)
        .where(
          and(
            eq(filePermissions.fileId, validationResult.data.fileId),
            eq(filePermissions.fileType, validationResult.data.fileType),
            eq(filePermissions.userId, validationResult.data.userId)
          )
        )
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "Permission already exists" });
        return;
      }

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, grantedById: req.user!.id };
      const [newPermission] = await db
        .insert(filePermissions)
        .values([insertData])
        .returning();
      
      res.status(201).json(newPermission);
    } catch (error: any) {
      console.error("Grant file permission error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Revoke file access (Manager/Admin only)
  app.delete("/api/file-permissions/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [deleted] = await db
        .delete(filePermissions)
        .where(eq(filePermissions.id, req.params.id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Permission not found" });
        return;
      }

      res.json({ message: "Permission revoked successfully" });
    } catch (error) {
      console.error("Revoke file permission error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get permissions for a specific file (Manager/Admin only)
  app.get("/api/file-permissions/:fileType/:fileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { fileType, fileId } = req.params;
      
      if (!["MEDIA", "DOCUMENT", "RECEIPT"].includes(fileType)) {
        res.status(400).json({ error: "Invalid file type" });
        return;
      }

      const permissions = await db
        .select({
          id: filePermissions.id,
          userId: filePermissions.userId,
          grantedById: filePermissions.grantedById,
          grantedAt: filePermissions.grantedAt,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(filePermissions)
        .leftJoin(users, eq(filePermissions.userId, users.id))
        .where(
          and(
            eq(filePermissions.fileId, fileId),
            eq(filePermissions.fileType, fileType as "MEDIA" | "DOCUMENT" | "RECEIPT")
          )
        );

      res.json(permissions);
    } catch (error) {
      console.error("Get file permissions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all files a user has access to (useful for superintendents/hourly employees)
  app.get("/api/users/:userId/file-permissions", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Users can only view their own permissions unless they're admin/manager
      if (req.user!.id !== req.params.userId && 
          req.user!.role !== "ADMIN" && 
          req.user!.role !== "MANAGER") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const permissions = await db
        .select()
        .from(filePermissions)
        .where(eq(filePermissions.userId, req.params.userId))
        .orderBy(desc(filePermissions.grantedAt));

      res.json(permissions);
    } catch (error) {
      console.error("Get user file permissions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Change Orders Routes
  // ====================

  // Get change orders for a project
  app.get("/api/projects/:code/change-orders", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

      const orders = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.projectId, project.id))
        .orderBy(desc(changeOrders.createdAt));

      res.json(orders);
    } catch (error) {
      console.error("Get change orders error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create change order (Admin/Manager/Superintendent/Office Manager)
  app.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        description: sanitizeText(req.body.description),
      };

      const validationResult = insertChangeOrderSchema.extend({
        requestedById: z.string().optional(),
      }).safeParse({
        ...sanitizedBody,
        requestedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // SECURITY: Verify org access via the parent project
      if (validationResult.data.projectId) {
        const [coProject] = await db.select().from(projects).where(eq(projects.id, validationResult.data.projectId)).limit(1);
        if (!coProject) {
          res.status(404).json({ error: "Project not found" });
          return;
        }
        if (!verifyOrgAccess(req, res, coProject.gcOrganizationId)) return;
      }

      // BUSINESS VALIDATION: Validate change order amount (allows positive additions or negative deductions)
      const amountCheck = validateChangeOrderAmount(validationResult.data.amount, "Change order amount");
      if (!amountCheck.valid) {
        res.status(400).json({ error: amountCheck.error });
        return;
      }

      // BUSINESS VALIDATION: Validate JSON fields and normalize empty strings to null
      if (validationResult.data.attachmentsJson !== null && validationResult.data.attachmentsJson !== undefined) {
        const jsonCheck = validateJSONField(validationResult.data.attachmentsJson, "Attachments JSON");
        if (!jsonCheck.valid) {
          res.status(400).json({ error: jsonCheck.error });
          return;
        }
        // Normalize empty strings to null
        if (validationResult.data.attachmentsJson === "" || jsonCheck.parsed === null) {
          validationResult.data.attachmentsJson = null;
        }
      }

      // Extract standardized scope fields from request body
      const {
        workTypeId,
        workTypeCode,
        workTypeName,
        categoryName,
        scopeModifierIds,
        scopeModifierNames,
        canonicalName,
        scopeUnit,
        scopeQuantity,
      } = req.body;

      // Ensure required field is set (TypeScript safety)
      const insertData = { 
        ...validationResult.data, 
        requestedById: req.user!.id,
        // Standardized scope of work (matches estimating sheets for production rate tracking)
        workTypeId: workTypeId || null,
        workTypeCode: workTypeCode || null,
        workTypeName: workTypeName || null,
        categoryName: categoryName || null,
        // Frontend sends these as JSON strings already
        scopeModifierIds: scopeModifierIds || null,
        scopeModifierNames: scopeModifierNames || null,
        canonicalName: canonicalName || null,
        scopeUnit: scopeUnit || null,
        scopeQuantity: scopeQuantity || null,
      };
      const [newOrder] = await db.insert(changeOrders).values([insertData]).returning();
      
      // Create notification for managers/admins about pending change order
      const adminsAndManagers = await db
        .select()
        .from(users)
        .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
      
      const notificationsToCreate = adminsAndManagers.map(user => ({
        userId: user.id,
        type: "CHANGE_ORDER_PENDING" as const,
        title: "New Change Order Pending",
        message: `Change order ${newOrder.changeOrderNumber} requires approval`,
        relatedEntityId: newOrder.id,
        relatedEntityType: "changeOrder",
      }));

      if (notificationsToCreate.length > 0) {
        await db.insert(notifications).values(notificationsToCreate);
      }

      res.status(201).json(newOrder);
    } catch (error: any) {
      console.error("Create change order error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update change order schema
  const updateChangeOrderSchema = insertChangeOrderSchema.omit({ requestedById: true }).partial();

  // Update change order (Admin/Manager only)
  app.patch("/api/change-orders/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = updateChangeOrderSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Validate change order amount if being updated (allows positive additions or negative deductions)
      if (validationResult.data.amount !== undefined && validationResult.data.amount !== null) {
        const amountCheck = validateChangeOrderAmount(validationResult.data.amount, "Change order amount");
        if (!amountCheck.valid) {
          res.status(400).json({ error: amountCheck.error });
          return;
        }
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedOrder] = await db
        .update(changeOrders)
        .set(updateData)
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      if (!updatedOrder) {
        res.status(404).json({ error: "Change order not found" });
        return;
      }

      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Update change order error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve/reject endpoints moved to changeOrderRoutes.ts for state machine logic

  // ====================
  // Change Order Line Items Routes
  // ====================

  // Get line items for a change order
  app.get("/api/change-orders/:id/line-items", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      const [laborEntries, equipmentEntries, materialEntries] = await Promise.all([
        db.select().from(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
        db.select().from(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
        db.select().from(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
      ]);
      
      res.json({ laborEntries, equipmentEntries, materialEntries });
    } catch (error) {
      console.error("Get change order line items error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update line items for a change order (replaces all)
  app.put("/api/change-orders/:id/line-items", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { laborEntries, equipmentEntries, materialEntries } = req.body;
      
      // Verify change order exists and is in DRAFT status
      const [existingOrder] = await db.select().from(changeOrders).where(eq(changeOrders.id, id));
      if (!existingOrder) {
        res.status(404).json({ error: "Change order not found" });
        return;
      }
      if (existingOrder.status !== "DRAFT") {
        res.status(400).json({ error: "Can only update line items for draft change orders" });
        return;
      }

      // Delete existing entries
      await Promise.all([
        db.delete(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
        db.delete(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
        db.delete(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
      ]);

      // Helper to safely parse numbers with NaN protection
      const safeParseFloat = (val: any): number => {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? 0 : parsed;
      };

      // Insert new entries with validation
      if (laborEntries && laborEntries.length > 0) {
        const validLaborEntries = laborEntries.filter((entry: any) => 
          entry.employeeName && entry.employeeName.trim() !== ""
        );
        if (validLaborEntries.length > 0) {
          await db.insert(changeOrderLaborEntries).values(
            validLaborEntries.map((entry: any) => {
              const hours = safeParseFloat(entry.hoursWorked);
              const rate = safeParseFloat(entry.hourlyRate);
              return {
                changeOrderId: id,
                employeeName: entry.employeeName,
                position: entry.position || null,
                hoursWorked: String(hours),
                hourlyRate: String(rate),
                totalCost: String(hours * rate),
              };
            })
          );
        }
      }

      if (equipmentEntries && equipmentEntries.length > 0) {
        const validEquipmentEntries = equipmentEntries.filter((entry: any) =>
          entry.equipmentType && entry.equipmentType.trim() !== ""
        );
        if (validEquipmentEntries.length > 0) {
          await db.insert(changeOrderEquipmentEntries).values(
            validEquipmentEntries.map((entry: any) => {
              const qty = Math.max(1, parseInt(entry.quantity) || 1);
              const hours = safeParseFloat(entry.hoursUsed);
              const rate = safeParseFloat(entry.hourlyRate);
              return {
                changeOrderId: id,
                equipmentType: entry.equipmentType,
                description: entry.description || null,
                quantity: qty,
                hoursUsed: String(hours),
                hourlyRate: String(rate),
                totalCost: String(qty * hours * rate),
              };
            })
          );
        }
      }

      if (materialEntries && materialEntries.length > 0) {
        const validMaterialEntries = materialEntries.filter((entry: any) =>
          entry.materialDescription && entry.materialDescription.trim() !== ""
        );
        if (validMaterialEntries.length > 0) {
          await db.insert(changeOrderMaterialEntries).values(
            validMaterialEntries.map((entry: any) => {
              const qty = safeParseFloat(entry.quantity);
              const cost = safeParseFloat(entry.unitCost);
              return {
                changeOrderId: id,
                materialDescription: entry.materialDescription,
                category: entry.category || null,
                quantity: String(qty),
                unit: entry.unit || null,
                unitCost: String(cost),
                totalCost: String(qty * cost),
                vendorPricingId: entry.vendorPricingId || null,
              };
            })
          );
        }
      }

      // Calculate new total from line items
      const [newLaborEntries, newEquipmentEntries, newMaterialEntries] = await Promise.all([
        db.select().from(changeOrderLaborEntries).where(eq(changeOrderLaborEntries.changeOrderId, id)),
        db.select().from(changeOrderEquipmentEntries).where(eq(changeOrderEquipmentEntries.changeOrderId, id)),
        db.select().from(changeOrderMaterialEntries).where(eq(changeOrderMaterialEntries.changeOrderId, id)),
      ]);

      const totalLabor = newLaborEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
      const totalEquipment = newEquipmentEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
      const totalMaterial = newMaterialEntries.reduce((sum, e) => sum + Number(e.totalCost || 0), 0);
      const grandTotal = totalLabor + totalEquipment + totalMaterial;

      // Update change order total
      await db.update(changeOrders)
        .set({ amount: String(grandTotal), updatedAt: new Date() })
        .where(eq(changeOrders.id, id));

      res.json({ 
        laborEntries: newLaborEntries, 
        equipmentEntries: newEquipmentEntries, 
        materialEntries: newMaterialEntries,
        total: grandTotal
      });
    } catch (error) {
      console.error("Update change order line items error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Calendar Events Routes
  // ====================

  // Get all calendar events
  app.get("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, eventType } = req.query;
      
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json([]);

      const conditions: SQL[] = [];
      if (startDate) {
        conditions.push(sql`${calendarEvents.startDate} >= ${startDate as string}`);
      }
      if (endDate) {
        conditions.push(sql`${calendarEvents.endDate} <= ${endDate as string}`);
      }
      if (eventType) {
        conditions.push(eq(calendarEvents.eventType, eventType as any));
      }
      if (shouldFilter && orgId) {
        conditions.push(eq(users.organizationId, orgId));
      }
      
      const eventsWithUser = await db
        .select({
          id: calendarEvents.id,
          eventType: calendarEvents.eventType,
          title: calendarEvents.title,
          description: calendarEvents.description,
          startDate: calendarEvents.startDate,
          endDate: calendarEvents.endDate,
          allDay: calendarEvents.allDay,
          userId: calendarEvents.userId,
          projectId: calendarEvents.projectId,
          approvedById: calendarEvents.approvedById,
          approvedAt: calendarEvents.approvedAt,
          createdById: calendarEvents.createdById,
          createdAt: calendarEvents.createdAt,
          requesteeName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`.as('requestee_name'),
          requesteeRole: users.role,
        })
        .from(calendarEvents)
        .leftJoin(users, eq(calendarEvents.userId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(calendarEvents.startDate);

      res.json(eventsWithUser);
    } catch (error) {
      console.error("Get calendar events error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get user's calendar events
  app.get("/api/calendar/my-events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const eventsWithUser = await db
        .select({
          id: calendarEvents.id,
          eventType: calendarEvents.eventType,
          title: calendarEvents.title,
          description: calendarEvents.description,
          startDate: calendarEvents.startDate,
          endDate: calendarEvents.endDate,
          allDay: calendarEvents.allDay,
          userId: calendarEvents.userId,
          projectId: calendarEvents.projectId,
          approvedById: calendarEvents.approvedById,
          approvedAt: calendarEvents.approvedAt,
          createdById: calendarEvents.createdById,
          createdAt: calendarEvents.createdAt,
          requesteeName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, ${users.email})`.as('requestee_name'),
          requesteeRole: users.role,
        })
        .from(calendarEvents)
        .leftJoin(users, eq(calendarEvents.userId, users.id))
        .where(eq(calendarEvents.userId, req.user!.id))
        .orderBy(calendarEvents.startDate);

      res.json(eventsWithUser);
    } catch (error) {
      console.error("Get user calendar events error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create calendar event (All authenticated users)
  app.post("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        title: sanitizeShortText(req.body.title),
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = insertCalendarEventSchema.extend({
        createdById: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
      }).safeParse({
        ...sanitizedBody,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, createdById: req.user!.id };
      const [newEvent] = await db.insert(calendarEvents).values([insertData]).returning();
      
      // Create notification for managers if it's a time-off request
      if (newEvent.eventType === "TIME_OFF_REQUEST") {
        const adminsAndManagers = await db
          .select()
          .from(users)
          .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
        
        const notificationsToCreate = adminsAndManagers.map(user => ({
          userId: user.id,
          type: "TIME_OFF_REQUEST" as const,
          title: "Time Off Request",
          message: `${req.user!.firstName} ${req.user!.lastName} requested time off: ${newEvent.title}`,
          relatedEntityId: newEvent.id,
          relatedEntityType: "calendarEvent",
        }));

        if (notificationsToCreate.length > 0) {
          await db.insert(notifications).values(notificationsToCreate);
        }
      }

      res.status(201).json(newEvent);
    } catch (error: any) {
      console.error("Create calendar event error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve time-off request (Admin/Manager only)
  app.post("/api/calendar/events/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Approve time-off request (sequential operations - Neon HTTP driver doesn't support transactions)
      const [event] = await db
        .update(calendarEvents)
        .set({
          eventType: "TIME_OFF_APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
        })
        .where(eq(calendarEvents.id, req.params.id))
        .returning();

      if (!event) {
        res.status(404).json({ error: "Calendar event not found" });
        return;
      }

      // Notify the requester
      if (event.userId) {
        await db.insert(notifications).values([{
          userId: event.userId,
          type: "GENERAL",
          title: "Time Off Approved",
          message: `Your time off request has been approved: ${event.title}`,
          relatedEntityId: event.id,
          relatedEntityType: "calendarEvent",
        }]);
      }

      res.json(event);
    } catch (error: any) {
      console.error("Approve time-off error:", error);
      if (error.message === "Calendar event not found") {
        res.status(404).json({ error: "Calendar event not found" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete calendar event
  app.delete("/api/calendar/events/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [event] = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, req.params.id))
        .limit(1);

      if (!event) {
        res.status(404).json({ error: "Calendar event not found" });
        return;
      }

      // Only creator, assigned user, or Admin/Manager can delete
      if (event.createdById !== req.user!.id && 
          event.userId !== req.user!.id &&
          req.user!.role !== "ADMIN" && 
          req.user!.role !== "MANAGER") {
        res.status(403).json({ error: "Not authorized to delete this event" });
        return;
      }

      await db.delete(calendarEvents).where(eq(calendarEvents.id, req.params.id));
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete calendar event error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Notifications Routes
  // ====================

  // Get user's notifications
  app.get("/api/notifications", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, req.user!.id))
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      res.json(userNotifications);
    } catch (error) {
      console.error("Get notifications error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(sql`${notifications.userId} = ${req.user!.id} AND ${notifications.isRead} = false`);

      res.json({ count: result.count });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [notification] = await db
        .update(notifications)
        .set({ isRead: true })
        .where(sql`${notifications.id} = ${req.params.id} AND ${notifications.userId} = ${req.user!.id}`)
        .returning();

      if (!notification) {
        res.status(404).json({ error: "Notification not found" });
        return;
      }

      res.json(notification);
    } catch (error: any) {
      console.error("Mark notification read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/read-all", requireAuth, async (req: AuthRequest, res) => {
    try {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, req.user!.id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Mark all notifications read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Billing Events Routes
  // ====================

  // Get billing events for a project
  // Note: billingEvents are linked to scopeItems, which are linked to projects
  app.get("/api/projects/:projectId/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { scopeItems } = await import("@shared/schema");
      const events = await db
        .select({
          billingEvent: billingEvents,
          scopeItem: scopeItems,
        })
        .from(billingEvents)
        .innerJoin(scopeItems, eq(billingEvents.scopeItemId, scopeItems.id))
        .where(eq(scopeItems.projectId, req.params.projectId))
        .orderBy(desc(billingEvents.createdAt));

      res.json(events);
    } catch (error) {
      console.error("Get billing events error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create billing event
  // This endpoint is aligned with the billingEvents table schema:
  // - scopeItemId, quantity, unitPrice, totalAmount, billedDate, invoiceNumber, paymentStatus
  app.post("/api/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Validation schema aligned with actual billingEvents table
      const schema = z.object({
        scopeItemId: z.string(),
        quantity: z.string(), // Fixed: quantity should be string in schema
        unitPrice: z.string(),
        totalAmount: z.string(),
        billedDate: z.coerce.date(),
        invoiceNumber: z.string().optional(),
        paymentStatus: z.enum(["pending", "paid", "overdue"]).default("pending"),
      });

      const data = schema.parse(req.body);

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...data, createdById: req.user!.id };

      // Create billing event (sequential operations - Neon HTTP driver doesn't support transactions)
      const [newEvent] = await db.insert(billingEvents).values([insertData]).returning();

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "BILLING_EVENT", newEvent.id, newEvent, req);

      res.status(201).json(newEvent);
    } catch (error) {
      console.error("Create billing event error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Audit Log Routes
  // ====================

  // Get audit logs (Admin only)
  app.get("/api/audit-logs", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { entityType, entityId, userId, action, page = "1", pageSize = "100" } = req.query;

      const pageNum = parseInt(page as string);
      const pageSizeNum = parseInt(pageSize as string);
      const offset = (pageNum - 1) * pageSizeNum;

      // SECURITY: Validate action parameter against enum values
      const validActions = ["CREATE", "READ", "UPDATE", "DELETE", "APPROVE", "REJECT", "LOGIN", "LOGOUT", "STATUS_CHANGE"];
      if (action && !validActions.includes(action as string)) {
        res.status(400).json({ error: "Invalid action parameter" });
        return;
      }

      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess) return res.json([]);

      const conditions: SQL[] = [];
      if (entityType) conditions.push(eq(auditLog.entityType, entityType as string));
      if (entityId) conditions.push(eq(auditLog.entityId, entityId as string));
      if (userId) conditions.push(eq(auditLog.userId, userId as string));
      if (action) conditions.push(eq(auditLog.action, action as any));

      if (shouldFilter && orgId) {
        const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, orgId));
        const orgUserIds = orgUsers.map(u => u.id);
        if (orgUserIds.length > 0) {
          conditions.push(inArray(auditLog.userId, orgUserIds));
        } else {
          return res.json([]);
        }
      }

      let query = db.select().from(auditLog);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const logs = await query
        .orderBy(desc(auditLog.createdAt))
        .limit(pageSizeNum)
        .offset(offset);

      res.json(logs);
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get audit logs for specific entity (Admin/Manager)
  app.get("/api/audit-logs/:entityType/:entityId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const logs = await db
        .select()
        .from(auditLog)
        .where(and(
          eq(auditLog.entityType, req.params.entityType),
          eq(auditLog.entityId, req.params.entityId)
        ))
        .orderBy(desc(auditLog.createdAt))
        .limit(100);

      res.json(logs);
    } catch (error) {
      console.error("Get entity audit logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Object Storage endpoints
  const { ObjectStorageService, ObjectNotFoundError } = await import("./objectStorage");
  const { ObjectPermission } = await import("./objectAcl");

  // Get upload URL for object
  app.post("/api/objects/upload", requireAuth, async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        res.status(400).json({ error: "User must belong to an organization to upload files" });
        return;
      }
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL(organizationId);
      res.json({ uploadURL });
    } catch (error: any) {
      console.error("Get upload URL error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Download private object with ACL check
  app.get("/objects/:objectPath(*)", requireAuth, async (req: AuthRequest, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      
      // Get object metadata to extract objectKey
      const [metadata] = await objectFile.getMetadata();
      const objectKey = objectFile.name;

      // Resolve objectKey to fileId and fileType
      const { resolveObjectKeyToFile } = await import("./fileAccessHelpers");
      const resolvedFile = await resolveObjectKeyToFile(objectKey);

      // Block orphaned objects (files not tracked in database)
      if (!resolvedFile) {
        res.status(404).json({ error: "File not found in system" });
        return;
      }

      const canAccess = await objectStorageService.canAccessObjectEntity({
        objectFile,
        userId: req.user!.id,
        userOrganizationId: req.user!.organizationId ?? undefined,
        userRole: req.user!.role,
        requestedPermission: ObjectPermission.READ,
        fileId: resolvedFile.fileId,
        fileType: resolvedFile.fileType,
      });

      if (!canAccess) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      objectStorageService.downloadObject(objectFile, res);
    } catch (error: any) {
      console.error("Object download error:", error);
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Crews & Skills Routes
  // ====================

  // Get all crews
  app.get("/api/crews", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Organization filtering: SUPER_ADMIN sees all crews, others see only their org's crews
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any crews
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      let allCrews;
      if (shouldFilter && orgId) {
        // Filter crews by crew's organization
        allCrews = await db
          .select({
            crew: crews,
            lead: {
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
            }
          })
          .from(crews)
          .leftJoin(users, eq(crews.leadId, users.id))
          .where(eq(crews.organizationId, orgId))
          .orderBy(desc(crews.isActive), crews.name);
      } else {
        allCrews = await db
          .select({
            crew: crews,
            lead: {
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
            }
          })
          .from(crews)
          .leftJoin(users, eq(crews.leadId, users.id))
          .orderBy(desc(crews.isActive), crews.name);
      }

      // PERFORMANCE: Get member counts efficiently with single query instead of N+1
      let countsMap = new Map<string, number>();
      
      if (allCrews.length > 0) {
        const crewIds = allCrews.map(c => c.crew.id);
        const memberCounts = await db
          .select({
            crewId: crewMembers.crewId,
            count: sql<number>`count(*)`.as('count'),
          })
          .from(crewMembers)
          .where(inArray(crewMembers.crewId, crewIds))
          .groupBy(crewMembers.crewId);
        
        countsMap = new Map(memberCounts.map(mc => [mc.crewId, Number(mc.count)]));
      }
      
      const crewsWithCounts = allCrews.map(({ crew, lead }) => ({
        ...crew,
        lead: lead?.id ? lead : null,
        memberCount: countsMap.get(crew.id) || 0,
      }));

      res.json(crewsWithCounts);
    } catch (error) {
      console.error("Error fetching crews:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create new crew (admin only)
  app.post("/api/crews", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
        // Auto-set organizationId from user's organization
        organizationId: req.user!.organizationId,
      };

      const validationResult = insertCrewSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Create crew (sequential operations - Neon HTTP driver doesn't support transactions)
      const [newCrew] = await db.insert(crews).values(validationResult.data).returning();
      
      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "crews", newCrew.id, {
        name: newCrew.name,
        leadId: newCrew.leadId,
      }, req);

      res.status(201).json(newCrew);
    } catch (error) {
      console.error("Error creating crew:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update crew (admin only)
  app.patch("/api/crews/:id", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const updateData = insertCrewSchema.partial().safeParse(sanitizedBody);

      if (!updateData.success) {
        res.status(400).json({ error: "Invalid input", details: updateData.error.errors });
        return;
      }

      // Check existence BEFORE transaction to preserve 404 status
      const [existing] = await db.select().from(crews).where(eq(crews.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Crew not found" });
        return;
      }

      // Update crew (sequential operations - Neon HTTP driver doesn't support transactions)
      const [updated] = await db
        .update(crews)
        .set({ ...updateData.data, updatedAt: new Date() })
        .where(eq(crews.id, id))
        .returning();

      // Audit log (pass raw objects, not JSON.stringify)
      await logUpdate(req.user!.id, "crews", id, existing, updateData.data, req);

      res.json(updated);
    } catch (error) {
      console.error("Error updating crew:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete crew (admin only)
  app.delete("/api/crews/:id", requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      // Check existence BEFORE transaction to preserve 404 status
      const [existing] = await db.select().from(crews).where(eq(crews.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Crew not found" });
        return;
      }

      // Delete crew (sequential operations - Neon HTTP driver doesn't support transactions)
      await db.delete(crews).where(eq(crews.id, id));
      
      // Audit log (pass raw object, not JSON.stringify)
      await logDelete(req.user!.id, "crews", id, { name: existing.name }, req);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting crew:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get crew members
  app.get("/api/crews/:id/members", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const members = await db
        .select({
          crewMember: crewMembers,
          user: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            role: users.role,
            costRateRegular: users.costRateRegular,
            costRateOvertime: users.costRateOvertime,
          }
        })
        .from(crewMembers)
        .innerJoin(users, eq(crewMembers.userId, users.id))
        .where(eq(crewMembers.crewId, id))
        .orderBy(crewMembers.addedAt);

      res.json(members);
    } catch (error) {
      console.error("Error fetching crew members:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add member to crew (admin only)
  app.post("/api/crews/:id/members", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { userId, role, skillIds } = req.body;

      if (!userId) {
        res.status(400).json({ error: "userId is required" });
        return;
      }

      // BUSINESS VALIDATION: Check if user is already a member of this crew
      const [existing] = await db
        .select()
        .from(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
        .limit(1);

      if (existing) {
        res.status(409).json({ 
          error: "User is already a member of this crew",
          details: "This user has already been added to the specified crew."
        });
        return;
      }

      // Add crew member (sequential operations - Neon HTTP driver doesn't support transactions)
      const [newMember] = await db
        .insert(crewMembers)
        .values({ crewId: id, userId, role })
        .returning();

      // Handle skill assignments if provided
      if (skillIds && Array.isArray(skillIds) && skillIds.length > 0) {
        // Get existing skills for this user to avoid duplicates
        const existingUserSkills = await db
          .select({ skillId: userSkills.skillId })
          .from(userSkills)
          .where(eq(userSkills.userId, userId));
        
        const existingSkillIds = new Set(existingUserSkills.map(s => s.skillId));
        
        // Filter out skills that are already assigned
        const newSkillIds = skillIds.filter((skillId: string) => !existingSkillIds.has(skillId));
        
        // Insert new skill assignments
        if (newSkillIds.length > 0) {
          await db.insert(userSkills).values(
            newSkillIds.map((skillId: string) => ({
              userId,
              skillId,
            }))
          );
          
          // Audit log for skill assignments
          await logCreate(req.user!.id, "user_skills", `${userId}-skills`, {
            userId,
            skillIds: newSkillIds,
            action: "bulk_assign",
          }, req);
        }
      }

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "crew_members", newMember.id, {
        crewId: id,
        userId,
        role,
        skillIds: skillIds || [],
      }, req);

      res.status(201).json(newMember);
    } catch (error: any) {
      console.error("Error adding crew member:", error);
      if (error.message === "User is already a member of this crew") {
        res.status(400).json({ error: "User is already a member of this crew" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Remove member from crew (admin only)
  app.delete("/api/crews/:id/members/:userId", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { id, userId } = req.params;

      // Check existence BEFORE transaction to preserve 404 status
      const [existing] = await db
        .select()
        .from(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Crew member not found" });
        return;
      }

      // Remove crew member (sequential operations - Neon HTTP driver doesn't support transactions)
      await db
        .delete(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)));

      // Audit log (pass raw object, not JSON.stringify)
      await logDelete(req.user!.id, "crew_members", existing.id, {
        crewId: id,
        userId,
      }, req);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing crew member:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get crew project assignments
  app.get("/api/crew-assignments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments } = await import("@shared/schema");
      
      const assignments = await db
        .select({
          assignment: crewProjectAssignments,
          crew: {
            id: crews.id,
            name: crews.name,
          },
          project: {
            id: projects.id,
            code: projects.code,
            name: projects.name,
            status: projects.status,
          },
        })
        .from(crewProjectAssignments)
        .leftJoin(crews, eq(crewProjectAssignments.crewId, crews.id))
        .leftJoin(projects, eq(crewProjectAssignments.projectId, projects.id))
        .orderBy(desc(crewProjectAssignments.createdAt));

      res.json(assignments);
    } catch (error) {
      console.error("Error fetching crew assignments:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Assign crew to project
  app.post("/api/crew-assignments", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments, insertCrewProjectAssignmentSchema } = await import("@shared/schema");
      
      const validated = insertCrewProjectAssignmentSchema.parse({
        ...req.body,
        assignedById: req.user!.id,
      });

      // BUSINESS VALIDATION: Check if crew is already assigned to this project
      const [existingAssignment] = await db
        .select()
        .from(crewProjectAssignments)
        .where(
          and(
            eq(crewProjectAssignments.crewId, validated.crewId),
            eq(crewProjectAssignments.projectId, validated.projectId)
          )
        )
        .limit(1);

      if (existingAssignment) {
        res.status(409).json({ 
          error: "Crew already assigned to this project",
          details: "This crew is already assigned to the specified project."
        });
        return;
      }

      // Create crew assignment (sequential operations - Neon HTTP driver doesn't support transactions)
      const [assignment] = await db.insert(crewProjectAssignments).values(validated).returning();

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "crew_project_assignments", assignment.id, {
        crewId: assignment.crewId,
        projectId: assignment.projectId,
      }, req);

      res.status(201).json(assignment);
    } catch (error: any) {
      console.error("Error creating crew assignment:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Remove crew from project
  app.delete("/api/crew-assignments/:id", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments } = await import("@shared/schema");
      const { id } = req.params;

      // Check existence BEFORE transaction to preserve 404 status
      const [existing] = await db
        .select()
        .from(crewProjectAssignments)
        .where(eq(crewProjectAssignments.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      // Delete crew assignment (sequential operations - Neon HTTP driver doesn't support transactions)
      await db
        .delete(crewProjectAssignments)
        .where(eq(crewProjectAssignments.id, id));

      // Audit log (pass raw object, not JSON.stringify)
      await logDelete(req.user!.id, "crew_project_assignments", id, {
        crewId: existing.crewId,
        projectId: existing.projectId,
      }, req);

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing crew assignment:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all skills
  app.get("/api/skills", requireAuth, async (req: AuthRequest, res) => {
    try {
      const allSkills = await db.select().from(skills).orderBy(skills.category, skills.name);
      res.json(allSkills);
    } catch (error) {
      console.error("Error fetching skills:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create new skill (admin only)
  app.post("/api/skills", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = insertSkillSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Create skill (sequential operations - Neon HTTP driver doesn't support transactions)
      const [newSkill] = await db.insert(skills).values(validationResult.data).returning();
      
      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "skills", newSkill.id, {
        name: newSkill.name,
        category: newSkill.category,
      }, req);

      res.status(201).json(newSkill);
    } catch (error: any) {
      console.error("Error creating skill:", error);
      if (error.constraint === "skills_name_unique") {
        res.status(400).json({ error: "A skill with this name already exists" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Generate predefined construction skills
  app.post("/api/skills/generate", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const predefinedSkills = [
        // Safety & Compliance
        { name: "OSHA 10 Certified", category: "Safety", description: "Completed OSHA 10-hour construction safety training" },
        { name: "OSHA 30 Certified", category: "Safety", description: "Completed OSHA 30-hour construction safety training" },
        { name: "First Aid/CPR Certified", category: "Safety", description: "Current first aid and CPR certification" },
        { name: "Confined Space Entry", category: "Safety", description: "Trained in confined space entry procedures" },
        { name: "Fall Protection", category: "Safety", description: "Trained in fall protection and prevention" },
        
        // Equipment Operation
        { name: "Forklift Operator", category: "Equipment", description: "Licensed to operate forklifts and material handlers" },
        { name: "Crane Operator", category: "Equipment", description: "Certified crane operator" },
        { name: "Excavator Operator", category: "Equipment", description: "Skilled in operating excavators and backhoes" },
        { name: "Skid Steer Operator", category: "Equipment", description: "Proficient in skid steer loader operation" },
        { name: "Boom Lift Operator", category: "Equipment", description: "Certified to operate aerial boom lifts" },
        { name: "Scissor Lift Operator", category: "Equipment", description: "Certified to operate scissor lifts" },
        
        // Trade Skills - Concrete
        { name: "Concrete Finishing", category: "Concrete", description: "Skilled in concrete finishing and troweling" },
        { name: "Concrete Forming", category: "Concrete", description: "Experienced in building concrete forms" },
        { name: "Concrete Pouring", category: "Concrete", description: "Skilled in concrete placement and pouring" },
        { name: "Rebar Tying", category: "Concrete", description: "Proficient in rebar installation and tying" },
        
        // Trade Skills - Carpentry
        { name: "Rough Carpentry", category: "Carpentry", description: "Skilled in framing and structural carpentry" },
        { name: "Finish Carpentry", category: "Carpentry", description: "Skilled in trim, molding, and finish work" },
        { name: "Cabinet Installation", category: "Carpentry", description: "Experienced in cabinet and countertop installation" },
        { name: "Drywall Installation", category: "Carpentry", description: "Skilled in drywall hanging and finishing" },
        
        // Trade Skills - Electrical
        { name: "Electrical Wiring", category: "Electrical", description: "Skilled in electrical wiring and connections" },
        { name: "Conduit Bending", category: "Electrical", description: "Proficient in conduit bending and installation" },
        { name: "Panel Installation", category: "Electrical", description: "Experienced in electrical panel installation" },
        
        // Trade Skills - Plumbing
        { name: "Pipe Fitting", category: "Plumbing", description: "Skilled in pipe fitting and installation" },
        { name: "Copper Soldering", category: "Plumbing", description: "Proficient in copper pipe soldering" },
        { name: "PVC Installation", category: "Plumbing", description: "Experienced in PVC pipe systems" },
        
        // Trade Skills - General
        { name: "Blueprint Reading", category: "General", description: "Able to read and interpret construction blueprints" },
        { name: "Surveying/Layout", category: "General", description: "Skilled in site layout and surveying" },
        { name: "Welding", category: "General", description: "Certified welder for structural and pipe welding" },
        { name: "Painting", category: "General", description: "Skilled in commercial and industrial painting" },
        { name: "Roofing", category: "General", description: "Experienced in roofing installation and repair" },
        { name: "Masonry", category: "General", description: "Skilled in brick, block, and stone work" },
        
        // Leadership
        { name: "Crew Leadership", category: "Leadership", description: "Experience leading construction crews" },
        { name: "Project Coordination", category: "Leadership", description: "Able to coordinate multiple trades and tasks" },
        { name: "Quality Control", category: "Leadership", description: "Trained in construction quality control procedures" },
      ];

      // Get existing skills to avoid duplicates
      const existingSkills = await db.select({ name: skills.name }).from(skills);
      const existingNames = new Set(existingSkills.map(s => s.name.toLowerCase()));

      // Filter out skills that already exist
      const newSkills = predefinedSkills.filter(
        skill => !existingNames.has(skill.name.toLowerCase())
      );

      if (newSkills.length === 0) {
        res.status(200).json({ message: "All skills already exist", created: 0 });
        return;
      }

      // Insert new skills
      const createdSkills = await db.insert(skills).values(newSkills).returning();

      // Audit log for each created skill
      for (const skill of createdSkills) {
        await logCreate(req.user!.id, "skills", skill.id, {
          name: skill.name,
          category: skill.category,
          generated: true,
        }, req);
      }

      res.status(201).json({ 
        message: `Generated ${createdSkills.length} new skills`,
        created: createdSkills.length,
        skills: createdSkills 
      });
    } catch (error) {
      console.error("Error generating skills:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete skill (admin only)
  app.delete("/api/skills/:id", requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      // Check existence BEFORE transaction to preserve 404 status
      const [existing] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
      if (!existing) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      // Delete skill (sequential operations - Neon HTTP driver doesn't support transactions)
      await db.delete(skills).where(eq(skills.id, id));
      
      // Audit log (pass raw object, not JSON.stringify)
      await logDelete(req.user!.id, "skills", id, { name: existing.name }, req);

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting skill:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get user skills
  app.get("/api/users/:userId/skills", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;

      const userSkillsList = await db
        .select({
          userSkill: userSkills,
          skill: skills,
        })
        .from(userSkills)
        .innerJoin(skills, eq(userSkills.skillId, skills.id))
        .where(eq(userSkills.userId, userId))
        .orderBy(skills.category, skills.name);

      res.json(userSkillsList);
    } catch (error) {
      console.error("Error fetching user skills:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Assign skill to user (admin only)
  app.post("/api/users/:userId/skills", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { userId } = req.params;
      const { skillId, proficiencyLevel, yearsExperience } = req.body;

      if (!skillId) {
        res.status(400).json({ error: "skillId is required" });
        return;
      }

      // Check if user already has this skill
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "User already has this skill" });
        return;
      }

      // Assign skill to user (sequential operations - Neon HTTP driver doesn't support transactions)
      const [newUserSkill] = await db
        .insert(userSkills)
        .values({ userId, skillId, proficiencyLevel, yearsExperience })
        .returning();

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "user_skills", newUserSkill.id, {
        userId,
        skillId,
        proficiencyLevel,
      }, req);

      res.status(201).json(newUserSkill);
    } catch (error) {
      console.error("Error assigning skill:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Remove skill from user (admin only)
  app.delete("/api/users/:userId/skills/:skillId", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { userId, skillId } = req.params;

      // Check existence BEFORE transaction to preserve 404 status
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "User skill not found" });
        return;
      }

      // Remove skill from user (sequential operations - Neon HTTP driver doesn't support transactions)
      await db
        .delete(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));

      // Audit log (pass raw object, not JSON.stringify)
      await logDelete(req.user!.id, "user_skills", existing.id, {
        userId,
        skillId,
      }, req);

      res.json({ success: true});
    } catch (error) {
      console.error("Error removing skill:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Subcontractor Routes
  // ====================

  // Get subcontractor contracts for a project
  app.get("/api/projects/:code/subcontractors", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;

      // Get project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get contracts with subcontractor details
      const contracts = await db
        .select({
          id: subcontractorContracts.id,
          contractNumber: subcontractorContracts.contractNumber,
          scopeOfWork: subcontractorContracts.scopeOfWork,
          contractAmount: subcontractorContracts.contractAmount,
          startDate: subcontractorContracts.startDate,
          completionDate: subcontractorContracts.completionDate,
          status: subcontractorContracts.status,
          paymentTerms: subcontractorContracts.paymentTerms,
          retentionPercent: subcontractorContracts.retentionPercent,
          notes: subcontractorContracts.notes,
          createdAt: subcontractorContracts.createdAt,
          subcontractor: {
            id: subcontractors.id,
            companyName: subcontractors.companyName,
            contactName: subcontractors.contactName,
            email: subcontractors.email,
            phone: subcontractors.phone,
          },
        })
        .from(subcontractorContracts)
        .leftJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
        .where(eq(subcontractorContracts.projectId, project.id))
        .orderBy(desc(subcontractorContracts.createdAt));

      res.json(contracts);
    } catch (error) {
      console.error("Error fetching subcontractor contracts:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get payments for a contract
  app.get("/api/subcontractor-contracts/:contractId/payments", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { contractId } = req.params;

      const payments = await db
        .select()
        .from(subcontractorPayments)
        .where(eq(subcontractorPayments.contractId, contractId))
        .orderBy(subcontractorPayments.paymentNumber);

      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create payment for a contract (Admin/Manager only)
  app.post("/api/subcontractor-contracts/:contractId/payments", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { contractId } = req.params;
      const { insertSubcontractorPaymentSchema } = await import("@shared/schema");

      // Verify contract exists
      const [contract] = await db
        .select()
        .from(subcontractorContracts)
        .where(eq(subcontractorContracts.id, contractId))
        .limit(1);

      if (!contract) {
        res.status(404).json({ error: "Contract not found" });
        return;
      }

      // Get next payment number
      const existingPayments = await db
        .select({ paymentNumber: subcontractorPayments.paymentNumber })
        .from(subcontractorPayments)
        .where(eq(subcontractorPayments.contractId, contractId))
        .orderBy(desc(subcontractorPayments.paymentNumber))
        .limit(1);

      const nextPaymentNumber = existingPayments.length > 0 ? existingPayments[0].paymentNumber + 1 : 1;

      // Validate input
      const validationResult = insertSubcontractorPaymentSchema.safeParse({
        ...req.body,
        contractId,
        paymentNumber: nextPaymentNumber,
      });

      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Insert payment
      const [newPayment] = await db.insert(subcontractorPayments).values(validationResult.data).returning();

      // Audit log
      await logCreate(req.user!.id, "SUBCONTRACTOR_PAYMENT", newPayment.id, {
        contractId,
        amount: req.body.amount,
        paymentNumber: nextPaymentNumber,
      });

      res.status(201).json(newPayment);
    } catch (error: any) {
      console.error("Create subcontractor payment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Subcontractor Payables Routes
  // ====================

  // Get all subcontractor payables (for CFO/Office Manager dashboard)
  app.get("/api/subcontractor-payables", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const payables = await db
        .select({
          subcontractorId: subcontractors.id,
          contractId: subcontractorContracts.id,
          projectId: subcontractorContracts.projectId,
          contractAmount: subcontractorContracts.contractAmount,
          totalPaid: sql<number>`COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("total_paid"),
          remainingBalance: sql<number>`${subcontractorContracts.contractAmount} - COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("remaining_balance"),
          projectName: projects.name,
          companyName: subcontractors.companyName,
        })
        .from(subcontractorContracts)
        .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
        .innerJoin(projects, eq(projects.id, subcontractorContracts.projectId))
        .leftJoin(subcontractorPayments, eq(subcontractorPayments.contractId, subcontractorContracts.id))
        .groupBy(subcontractorContracts.id, subcontractors.id, projects.id);

      res.json(payables);
    } catch (error) {
      console.error("Error fetching subcontractor payables:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Data Quality Routes
  // ====================

  // Get data quality score for a project (UI-facing endpoint with boolean flags)
  app.get("/api/projects/:code/data-quality", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;

      // Get project
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Calculate data quality with boolean flags for each category
      const { 
        scopeItems, estimates, estimateLineItems, timeEntries, procurementItems,
        dailyScopeProgress, media, changeOrders, scheduleOfValues, planDocuments 
      } = await import("@shared/schema");

      // Check for scope items
      const scopeCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(scopeItems)
        .where(eq(scopeItems.projectId, project.id));
      const has_scope = Number(scopeCount[0]?.count || 0) > 0;

      // Check for estimate line items (actual pricing data via estimates linked to project)
      const lineItemsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(estimateLineItems)
        .innerJoin(estimates, eq(estimateLineItems.estimateId, estimates.id))
        .where(eq(estimates.projectId, project.id));
      const has_estimates = Number(lineItemsCount[0]?.count || 0) > 0;

      // Check for budget (project has budget amount set)
      const has_budget = project.budget !== null && Number(project.budget) > 0;

      // Check for timeline (start date and estimated completion date)
      const has_timeline = !!(project.startDate && project.estimatedCompletionDate);

      // Check for daily updates (daily scope progress entries)
      const dailyUpdatesCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(dailyScopeProgress)
        .where(eq(dailyScopeProgress.projectId, project.id));
      const has_daily_updates = Number(dailyUpdatesCount[0]?.count || 0) > 0;

      // Check for cost tracking (time entries or procurement items)
      const timeEntriesCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(timeEntries)
        .where(eq(timeEntries.projectId, project.id));
      const procurementCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(procurementItems)
        .where(eq(procurementItems.projectId, project.id));
      const has_cost_tracking = Number(timeEntriesCount[0]?.count || 0) > 0 || Number(procurementCount[0]?.count || 0) > 0;

      // Check for media uploads
      const mediaCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(media)
        .where(eq(media.projectId, project.id));
      const has_media = Number(mediaCount[0]?.count || 0) > 0;

      // Check for documentation (plan documents)
      const docsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(planDocuments)
        .where(eq(planDocuments.projectId, project.id));
      const has_documentation = Number(docsCount[0]?.count || 0) > 0;

      // Check for change orders
      const changeOrdersCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(changeOrders)
        .where(eq(changeOrders.projectId, project.id));
      const has_change_orders_managed = Number(changeOrdersCount[0]?.count || 0) > 0;

      // Check for billing setup (schedule of values)
      const sovCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(scheduleOfValues)
        .where(eq(scheduleOfValues.projectId, project.id));
      const has_billing_setup = Number(sovCount[0]?.count || 0) > 0;

      // Calculate overall score (each flag worth 10 points)
      const flags = [
        has_scope, has_estimates, has_budget, has_timeline, has_daily_updates,
        has_cost_tracking, has_media, has_documentation, has_change_orders_managed, has_billing_setup
      ];
      const overall_score = flags.filter(Boolean).length * 10;

      res.json({
        overall_score,
        has_scope,
        has_estimates,
        has_budget,
        has_timeline,
        has_daily_updates,
        has_cost_tracking,
        has_media,
        has_documentation,
        has_change_orders_managed,
        has_billing_setup
      });
    } catch (error) {
      console.error("Error fetching data quality score:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // TAKEOFF + ESTIMATING ROUTES
  // ====================

  // Get all takeoff sheets for a project
  app.get("/api/projects/:projectId/takeoff/sheets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { takeoffSheets, projectPlans } = await import("@shared/schema");

      const sheets = await db
        .select({
          id: takeoffSheets.id,
          projectId: takeoffSheets.projectId,
          planId: takeoffSheets.planId,
          imageUrl: takeoffSheets.imageUrl,
          sheetIndex: takeoffSheets.sheetIndex,
          sheetName: takeoffSheets.sheetName,
          scalePxPerFoot: takeoffSheets.scalePxPerFoot,
          units: takeoffSheets.units,
          createdAt: takeoffSheets.createdAt,
          updatedAt: takeoffSheets.updatedAt,
          documentId: projectPlans.documentId,
        })
        .from(takeoffSheets)
        .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
        .where(eq(takeoffSheets.projectId, projectId))
        .orderBy(takeoffSheets.sheetIndex);

      res.json(sheets);
    } catch (error) {
      console.error("Error fetching takeoff sheets:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Stream PDF directly for a takeoff sheet (with authorization)
  app.get("/api/takeoff/sheets/:sheetId/pdf", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffSheets, projectPlans, planDocuments } = await import("@shared/schema");

      // Get the sheet with plan and document info
      const [sheetData] = await db
        .select({
          sheet: takeoffSheets,
          plan: projectPlans,
          document: planDocuments,
        })
        .from(takeoffSheets)
        .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
        .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
        .where(eq(takeoffSheets.id, sheetId))
        .limit(1);

      if (!sheetData) {
        res.status(404).json({ error: "Sheet not found" });
        return;
      }

      const { sheet, plan, document } = sheetData;

      // Verify project exists and user has access
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, sheet.projectId))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Check if user has permission to access this document
      const userRole = req.user!.role;
      const userId = req.user!.id;

      // Admins and Managers have full access
      const hasRoleAccess = userRole === "ADMIN" || userRole === "MANAGER";

      // Check if user uploaded the document or has explicit permission
      let hasDocumentAccess = hasRoleAccess;
      if (!hasDocumentAccess && document) {
        // Check if user uploaded this document
        const isUploader = document.uploadedById === userId;
        
        // Check for explicit file permission
        const [permission] = await db
          .select()
          .from(filePermissions)
          .where(
            and(
              eq(filePermissions.fileId, document.id),
              eq(filePermissions.fileType, "DOCUMENT"),
              eq(filePermissions.userId, userId)
            )
          )
          .limit(1);

        hasDocumentAccess = isUploader || !!permission;
      }

      if (!hasDocumentAccess) {
        res.status(403).json({ error: "You do not have permission to access this document" });
        return;
      }

      // If document exists and has objectKey, stream the file
      if (document?.objectKey) {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
          
          // Stream the file directly to the response with caching
          await objectStorageService.downloadObject(objectFile, res, 3600); // 1 hour cache
          return;
        } catch (error: any) {
          console.error("Error streaming PDF from objectKey:", error);
          
          // If object not found, return 404 instead of 500
          if (error.name === 'ObjectNotFoundError' || error.message?.includes('not found')) {
            res.status(404).json({ error: "PDF file no longer exists. Please re-upload the document." });
            return;
          }
          
          res.status(500).json({ error: "Internal server error" });
          return;
        }
      }

      // No valid document/objectKey available - cannot serve PDF securely
      res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
    } catch (error: any) {
      console.error("Stream sheet PDF error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Import a plan document to takeoff workspace
  app.post("/api/projects/:projectId/takeoff/import-plan", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { documentId } = req.body;

      if (!documentId) {
        res.status(400).json({ error: "Document ID is required" });
        return;
      }

      const { planDocuments, projectPlans, takeoffSheets } = await import("@shared/schema");

      // Get the document
      const [document] = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.id, documentId))
        .limit(1);

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      if (document.projectId !== projectId) {
        res.status(403).json({ error: "Document does not belong to this project" });
        return;
      }

      // Check if this document is already imported by checking if a plan exists with this documentId
      const [existingPlan] = await db
        .select()
        .from(projectPlans)
        .where(and(
          eq(projectPlans.projectId, projectId),
          eq(projectPlans.documentId, documentId)
        ))
        .limit(1);

      if (existingPlan) {
        res.status(400).json({ error: "This document is already imported to takeoff workspace" });
        return;
      }

      // Validate PDF and get page count BEFORE creating any database records
      let pageCount = 1;
      if (!document.objectKey) {
        res.status(400).json({ error: "Document has no file attached. Please re-upload the document." });
        return;
      }

      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
        
        // Download PDF to buffer using GCS File.download() method
        const [pdfBuffer] = await objectFile.download();
        
        // Load PDF with pdfjs-dist
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(pdfBuffer),
          useSystemFonts: true,
        });
        const pdfDoc = await loadingTask.promise;
        pageCount = pdfDoc.numPages;
      } catch (error: any) {
        console.error("Error processing PDF:", error);
        res.status(400).json({ 
          error: "Failed to process PDF file. The file may be corrupted or not a valid PDF document." 
        });
        return;
      }

      // Import plan to takeoff (sequential operations with compensating cleanup)
      // Create project plan record
      const [plan] = await db.insert(projectPlans).values({
        projectId,
        documentId: documentId,
        originalPdfUrl: document.fileUrl,
        fileName: document.fileName,
      }).returning();

      // Prepare all sheets for batch insert
      const baseSheetName = document.title || document.fileName.replace(/\.[^/.]+$/, ''); // Remove extension
      const sheetValues = [];
      
      for (let i = 0; i < pageCount; i++) {
        const sheetName = pageCount > 1 
          ? `${baseSheetName} - Page ${i + 1}`
          : baseSheetName;
        
        sheetValues.push({
          projectId,
          planId: plan.id,
          imageUrl: document.fileUrl,
          sheetIndex: i,
          sheetName,
        });
      }

      // Batch insert all sheets with compensating cleanup on failure
      let sheets;
      try {
        sheets = await db.insert(takeoffSheets).values(sheetValues).returning();
      } catch (sheetError) {
        // Compensating cleanup: delete the orphaned plan
        await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
        throw sheetError; // Re-throw to trigger outer catch
      }

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "project_plans", plan.id, {
        projectId,
        fileName: document.fileName,
        documentId,
        pageCount,
      }, req);

      res.status(201).json({ plan, sheets });
    } catch (error) {
      console.error("Error importing plan to takeoff:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Upload a plan PDF and create sheets
  app.post("/api/projects/:projectId/takeoff/plans", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { fileUrl, fileName } = req.body;

      if (!fileUrl || !fileName) {
        res.status(400).json({ error: "File URL and name are required" });
        return;
      }

      const { projectPlans, takeoffSheets, insertProjectPlanSchema, insertTakeoffSheetSchema } = await import("@shared/schema");

      // Upload plan (sequential operations with compensating cleanup)
      // Create project plan record
      const [plan] = await db.insert(projectPlans).values({
        projectId,
        originalPdfUrl: fileUrl,
        fileName,
      }).returning();

      // TODO: In a production system, you would use a PDF processing service here
      // For now, we'll create a single sheet placeholder
      // The frontend will handle PDF rendering with pdf.js
      let sheet;
      try {
        [sheet] = await db.insert(takeoffSheets).values({
          projectId,
          planId: plan.id,
          imageUrl: fileUrl, // Using PDF URL as placeholder
          sheetIndex: 0,
          sheetName: fileName,
        }).returning();
      } catch (sheetError) {
        // Compensating cleanup: delete the orphaned plan
        await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
        throw sheetError; // Re-throw to trigger outer catch
      }

      // Audit log
      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "project_plan",
        entityId: plan.id,
        newValue: `Uploaded plan: ${fileName}`,
      }, req);

      res.status(201).json({ plan, sheets: [sheet] });
    } catch (error) {
      console.error("Error uploading plan:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get measurements for a sheet
  app.get("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffMeasurements } = await import("@shared/schema");

      const measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sheetId, sheetId))
        .orderBy(takeoffMeasurements.createdAt);

      // Parse points JSON string to array for frontend
      const parsedMeasurements = measurements.map(m => ({
        ...m,
        points: JSON.parse(m.points),
      }));

      res.json(parsedMeasurements);
    } catch (error) {
      console.error("Error fetching measurements:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new measurement
  app.post("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      const validated = insertTakeoffMeasurementSchema.parse({
        ...sanitizedBody,
        sheetId,
      });

      const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();

      res.status(201).json(measurement);
    } catch (error: any) {
      console.error("Error creating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update a measurement
  app.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { takeoffMeasurements, takeoffSheets, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

      // PHASE 2.3a: If updating points, recompute arc length if applicable
      let finalValues = { ...validated };
      if (validated.points && validated.type === "LINEAR") {
        // Get the sheet's scale to compute arc length
        const measurement = await db
          .select({ sheetId: takeoffMeasurements.sheetId })
          .from(takeoffMeasurements)
          .where(eq(takeoffMeasurements.id, id))
          .limit(1);

        if (measurement && measurement.length > 0) {
          const sheet = await db
            .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
            .from(takeoffSheets)
            .where(eq(takeoffSheets.id, measurement[0].sheetId))
            .limit(1);

          if (sheet && sheet.length > 0 && sheet[0].scalePxPerFoot) {
            const points = typeof validated.points === 'string' ? JSON.parse(validated.points) : validated.points;
            
            // If 3 points, this is an arc - compute arc length
            if (points.length === 3) {
              try {
                const [start, middle, end] = points;
                const arcSegment = createArcSegment(start, end, middle, sheet[0].scalePxPerFoot);
                
                if (arcSegment) {
                  finalValues = {
                    ...validated,
                    computedLengthFt: arcSegment.arcLength,
                  };
                  console.log(`[Arc Measurement Update] Recomputed arc length: ${arcSegment.arcLength.toFixed(2)} LF`);
                }
              } catch (error) {
                console.error("Error computing arc length during update:", error);
              }
            }
          }
        }
      }

      const [updated] = await db
        .update(takeoffMeasurements)
        .set({ ...finalValues, updatedAt: new Date() })
        .where(eq(takeoffMeasurements.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Measurement not found" });
        return;
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Create a new measurement (with sheetId in body)
  app.post("/api/takeoff/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { takeoffMeasurements, takeoffSheets, projects, crewProjectAssignments, crewMembers, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      // Convert points array to JSON string if it's an array
      const bodyWithStringifiedPoints = {
        ...sanitizedBody,
        points: Array.isArray(sanitizedBody.points) ? JSON.stringify(sanitizedBody.points) : sanitizedBody.points,
      };

      const validated = insertTakeoffMeasurementSchema.parse(bodyWithStringifiedPoints);

      // Validate that the sheet exists and belongs to a valid project
      const sheetWithProject = await db
        .select({
          sheetId: takeoffSheets.id,
          projectId: takeoffSheets.projectId,
          projectCode: projects.code,
          scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        })
        .from(takeoffSheets)
        .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
        .where(eq(takeoffSheets.id, validated.sheetId))
        .limit(1);

      if (!sheetWithProject || sheetWithProject.length === 0) {
        res.status(404).json({ error: "Sheet not found or does not belong to a valid project" });
        return;
      }

      // Authorization check: Only ADMIN/MANAGER or users assigned to the project can create measurements
      const userRole = req.user!.role;
      if (userRole !== "ADMIN" && userRole !== "MANAGER") {
        // Check if user is assigned to this project via crew assignments
        const userAssignment = await db
          .select({ id: crewProjectAssignments.id })
          .from(crewProjectAssignments)
          .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
          .where(
            and(
              eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
              eq(crewMembers.userId, req.user!.id)
            )
          )
          .limit(1);

        if (!userAssignment || userAssignment.length === 0) {
          res.status(403).json({ error: "You do not have access to this project" });
          return;
        }
      }

      // PHASE 2.3a: Compute arc length for 3-point LINEAR measurements (arcs)
      let finalValues = { ...validated };
      if (validated.type === "LINEAR" && sheetWithProject[0].scalePxPerFoot) {
        const points = JSON.parse(validated.points);
        
        // If 3 points, this is an arc - compute arc length
        if (points.length === 3) {
          try {
            const [start, middle, end] = points;
            const arcSegment = createArcSegment(start, end, middle, sheetWithProject[0].scalePxPerFoot);
            
            if (arcSegment) {
              // Store the computed arc length in feet
              finalValues = {
                ...validated,
                computedLengthFt: arcSegment.arcLength,
              };
              console.log(`[Arc Measurement] Computed arc length: ${arcSegment.arcLength.toFixed(2)} LF`);
            }
          } catch (error) {
            console.error("Error computing arc length:", error);
            // If arc computation fails, don't block the measurement creation
            // The frontend will handle displaying the measurement
          }
        }
      }

      const [measurement] = await db.insert(takeoffMeasurements).values(finalValues).returning();

      res.status(201).json(measurement);
    } catch (error: any) {
      console.error("Error creating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete a measurement
  app.delete("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { takeoffMeasurements } = await import("@shared/schema");

      const [deleted] = await db
        .delete(takeoffMeasurements)
        .where(eq(takeoffMeasurements.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Measurement not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting measurement:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update sheet calibration
  app.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { scalePxPerFoot, units } = req.body;
      const { takeoffSheets, takeoffMeasurements, projects, crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const { 
        computeDistanceInFeet, 
        computePolygonAreaInFt2, 
        computeVolumeInCY, 
        inchesToFeet 
      } = await import("@shared/utils/geometry");

      if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
        res.status(400).json({ error: "Valid scale is required" });
        return;
      }

      // Validate that the sheet exists and belongs to a valid project
      const sheetWithProject = await db
        .select({
          sheetId: takeoffSheets.id,
          projectId: takeoffSheets.projectId,
        })
        .from(takeoffSheets)
        .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
        .where(eq(takeoffSheets.id, id))
        .limit(1);

      if (!sheetWithProject || sheetWithProject.length === 0) {
        res.status(404).json({ error: "Sheet not found or does not belong to a valid project" });
        return;
      }

      // Authorization check: Only ADMIN/MANAGER or users assigned to the project can calibrate
      const userRole = req.user!.role;
      if (userRole !== "ADMIN" && userRole !== "MANAGER") {
        // Check if user is assigned to this project via crew assignments
        const userAssignment = await db
          .select({ id: crewProjectAssignments.id })
          .from(crewProjectAssignments)
          .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
          .where(
            and(
              eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
              eq(crewMembers.userId, req.user!.id)
            )
          )
          .limit(1);

        if (!userAssignment || userAssignment.length === 0) {
          res.status(403).json({ error: "You do not have access to this project" });
          return;
        }
      }

      // Update the calibration
      const [updated] = await db
        .update(takeoffSheets)
        .set({ 
          scalePxPerFoot, 
          units: units || "ft",
          updatedAt: new Date() 
        })
        .where(eq(takeoffSheets.id, id))
        .returning();

      // Recompute all measurements for this sheet with the new scale
      const measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sheetId, id));

      console.log(`Recalculating ${measurements.length} measurements with new scale: ${scalePxPerFoot} px/ft`);

      for (const measurement of measurements) {
        if (!measurement.points) {
          continue;
        }

        // Parse points from JSON string (Drizzle may auto-parse or leave as string)
        let points: Array<{ x: number; y: number }>;
        try {
          points = typeof measurement.points === 'string' 
            ? JSON.parse(measurement.points) 
            : measurement.points as any;
        } catch (parseError) {
          console.error(`Error parsing points for measurement ${measurement.id}:`, parseError);
          continue;
        }

        // Skip measurements with no points
        if (!points || points.length === 0) {
          continue;
        }

        const updates: any = {};

        try {
          switch (measurement.type) {
            case "LINEAR":
              if (points.length >= 2) {
                const lengthFt = computeDistanceInFeet(points, scalePxPerFoot);
                updates.computedLengthFt = lengthFt;
              }
              break;

            case "AREA":
              if (points.length >= 3) {
                const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                updates.computedAreaFt2 = areaFt2;
              }
              break;

            case "VOLUME":
              if (points.length >= 3 && measurement.depthFeet) {
                const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                const volumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
                updates.computedAreaFt2 = areaFt2;
                updates.computedVolumeCy = volumeCy;
              }
              break;

            default:
              // COUNT and NOTE don't have computed quantities
              break;
          }

          if (Object.keys(updates).length > 0) {
            await db
              .update(takeoffMeasurements)
              .set({ ...updates, updatedAt: new Date() })
              .where(eq(takeoffMeasurements.id, measurement.id));
          }
        } catch (error) {
          console.error(`Error recalculating measurement ${measurement.id}:`, error);
          // Continue with other measurements even if one fails
        }
      }

      console.log(`Successfully recalculated ${measurements.length} measurements`);
      res.json(updated);
    } catch (error) {
      console.error("Error updating calibration:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // QUANTITY CATEGORY ROUTES
  // ====================

  // Get all quantity categories for a project
  app.get("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;
      const { quantityCategories } = await import("@shared/schema");

      // Get the project to find its internal ID
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const categories = await db
        .select()
        .from(quantityCategories)
        .where(eq(quantityCategories.projectId, project.id))
        .orderBy(quantityCategories.displayOrder);

      res.json(categories);
    } catch (error) {
      console.error("Error fetching quantity categories:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new quantity category
  app.post("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;
      const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

      // Get the project to find its internal ID
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validated = insertQuantityCategorySchema.parse({
        projectId: project.id,  // Use the internal UUID, not the code
        ...sanitizedBody,
      });

      const [category] = await db
        .insert(quantityCategories)
        .values(validated)
        .returning();

      res.status(201).json(category);
    } catch (error: any) {
      console.error("Error creating quantity category:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid category data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update a quantity category
  app.patch("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validated = insertQuantityCategorySchema.partial().parse(sanitizedBody);

      const [updated] = await db
        .update(quantityCategories)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(quantityCategories.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating quantity category:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid category data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete a quantity category
  app.delete("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { quantityCategories } = await import("@shared/schema");

      const [deleted] = await db
        .delete(quantityCategories)
        .where(eq(quantityCategories.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quantity category:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Internal Messaging System Routes
  // ====================

  const { 
    conversations, 
    conversationParticipants, 
    messages, 
    messageReadReceipts,
    insertConversationSchema,
    insertMessageSchema,
    organizations 
  } = await import("@shared/schema");

  // Get all conversations for current user
  app.get("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;

      // Get all conversations the user participates in
      const userConversations = await db
        .select({
          conversation: conversations,
          participant: conversationParticipants,
        })
        .from(conversationParticipants)
        .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
        .where(eq(conversationParticipants.userId, userId))
        .orderBy(desc(conversations.updatedAt));

      // For each conversation, get participants and last message
      const conversationsWithDetails = await Promise.all(
        userConversations.map(async ({ conversation, participant }) => {
          // Get all participants
          const participants = await db
            .select({
              participant: conversationParticipants,
              user: {
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                role: users.role,
              },
            })
            .from(conversationParticipants)
            .innerJoin(users, eq(conversationParticipants.userId, users.id))
            .where(eq(conversationParticipants.conversationId, conversation.id));

          // Get last message
          const [lastMessage] = await db
            .select({
              message: messages,
              sender: {
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
              },
            })
            .from(messages)
            .innerJoin(users, eq(messages.senderId, users.id))
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(desc(messages.createdAt))
            .limit(1);

          // Get unread count for this user
          const unreadMessages = await db
            .select({ count: sql<number>`count(*)` })
            .from(messages)
            .leftJoin(
              messageReadReceipts,
              and(
                eq(messageReadReceipts.messageId, messages.id),
                eq(messageReadReceipts.userId, userId)
              )
            )
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                sql`${messageReadReceipts.id} IS NULL`,
                sql`${messages.senderId} != ${userId}`
              )
            );

          return {
            ...conversation,
            participants: participants.map(p => ({
              ...p.participant,
              user: p.user,
            })),
            lastMessage: lastMessage ? {
              ...lastMessage.message,
              sender: lastMessage.sender,
            } : null,
            unreadCount: Number(unreadMessages[0]?.count || 0),
            currentUserParticipant: participant,
          };
        })
      );

      res.json(conversationsWithDetails);
    } catch (error) {
      console.error("Get conversations error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get or create company-wide channel (scoped to organization)
  app.get("/api/conversations/company-channel", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to access company chat" });
        return;
      }

      // Find existing company channel for this organization
      let [companyChannel] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.isCompanyChannel, true),
            eq(conversations.organizationId, organizationId)
          )
        )
        .limit(1);

      // Create if doesn't exist for this organization
      if (!companyChannel) {
        // Get organization name for channel title
        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        
        const orgName = org?.name || "Company";

        [companyChannel] = await db
          .insert(conversations)
          .values({
            type: "COMPANY",
            name: `${orgName} Team Chat`,
            description: "Company-wide announcements and general discussion",
            isCompanyChannel: true,
            organizationId: organizationId,
            createdById: userId,
          })
          .returning();

        // Add all active users from this organization as participants
        const orgUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.isActive, true),
              eq(users.organizationId, organizationId)
            )
          );

        if (orgUsers.length > 0) {
          await db.insert(conversationParticipants).values(
            orgUsers.map(u => ({
              conversationId: companyChannel.id,
              userId: u.id,
              isAdmin: u.id === userId,
            }))
          );
        }
      } else {
        // Ensure current user is a participant
        const [existingParticipant] = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, companyChannel.id),
              eq(conversationParticipants.userId, userId)
            )
          )
          .limit(1);

        if (!existingParticipant) {
          await db.insert(conversationParticipants).values({
            conversationId: companyChannel.id,
            userId: userId,
            isAdmin: false,
          });
        }
      }

      res.json(companyChannel);
    } catch (error) {
      console.error("Get company channel error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new conversation (direct message or group) - scoped to organization
  app.post("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;
      const { type, name, description, participantIds } = req.body;

      if (!organizationId) {
        res.status(400).json({ error: "You must belong to an organization to create conversations" });
        return;
      }

      // Validate type
      if (!["DIRECT", "GROUP"].includes(type)) {
        res.status(400).json({ error: "Invalid conversation type" });
        return;
      }

      // Validate that all participants are from the same organization
      if (participantIds && participantIds.length > 0) {
        const participantUsers = await db
          .select({ id: users.id, organizationId: users.organizationId })
          .from(users)
          .where(sql`${users.id} IN ${participantIds}`);

        const crossOrgParticipants = participantUsers.filter(u => u.organizationId !== organizationId);
        if (crossOrgParticipants.length > 0) {
          res.status(400).json({ error: "Cannot create conversations with users from different organizations" });
          return;
        }
      }

      // For direct messages, check if conversation already exists
      if (type === "DIRECT" && participantIds?.length === 1) {
        const otherUserId = participantIds[0];
        
        // Find existing direct conversation between these two users
        const existingConversations = await db
          .select({ conversationId: conversationParticipants.conversationId })
          .from(conversationParticipants)
          .innerJoin(conversations, eq(conversationParticipants.conversationId, conversations.id))
          .where(
            and(
              eq(conversations.type, "DIRECT"),
              eq(conversationParticipants.userId, userId)
            )
          );

        for (const { conversationId } of existingConversations) {
          const [otherParticipant] = await db
            .select()
            .from(conversationParticipants)
            .where(
              and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, otherUserId)
              )
            )
            .limit(1);

          if (otherParticipant) {
            // Return existing conversation
            const [existingConv] = await db
              .select()
              .from(conversations)
              .where(eq(conversations.id, conversationId))
              .limit(1);
            res.json(existingConv);
            return;
          }
        }
      }

      // Create new conversation with organization scope
      const [newConversation] = await db
        .insert(conversations)
        .values({
          type: type as "DIRECT" | "GROUP",
          name: type === "GROUP" ? (name || "Group Chat") : null,
          description: description || null,
          isCompanyChannel: false,
          organizationId: organizationId,
          createdById: userId,
        })
        .returning();

      // Add creator as participant
      await db.insert(conversationParticipants).values({
        conversationId: newConversation.id,
        userId: userId,
        isAdmin: true,
      });

      // Add other participants
      if (participantIds && participantIds.length > 0) {
        await db.insert(conversationParticipants).values(
          participantIds.map((pId: string) => ({
            conversationId: newConversation.id,
            userId: pId,
            isAdmin: false,
          }))
        );
      }

      res.status(201).json(newConversation);
    } catch (error) {
      console.error("Create conversation error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get messages for a conversation
  app.get("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const limit = parseInt(req.query.limit as string) || 50;
      const before = req.query.before as string | undefined;

      // Verify user is a participant
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .limit(1);

      if (!participant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      // Build query for messages
      let query = db
        .select({
          message: messages,
          sender: {
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            role: users.role,
          },
        })
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      const messageResults = await query;

      // Reverse to get chronological order
      const messagesWithSenders = messageResults.reverse().map(m => ({
        ...m.message,
        sender: m.sender,
      }));

      res.json(messagesWithSenders);
    } catch (error) {
      console.error("Get messages error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Send a message
  app.post("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;
      const { content, attachmentUrl, attachmentName, attachmentType } = req.body;

      if (!content?.trim()) {
        res.status(400).json({ error: "Message content is required" });
        return;
      }

      // Verify user is a participant
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .limit(1);

      if (!participant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      // Create message
      const sanitizedContent = sanitizeText(content);
      if (!sanitizedContent) {
        res.status(400).json({ error: "Message content is required" });
        return;
      }
      
      const [newMessage] = await db
        .insert(messages)
        .values({
          conversationId: conversationId as string,
          senderId: userId,
          content: sanitizedContent,
          attachmentUrl: attachmentUrl || null,
          attachmentName: attachmentName || null,
          attachmentType: attachmentType || null,
        })
        .returning();

      // Update conversation timestamp
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));

      // Mark as read for sender
      await db.insert(messageReadReceipts).values({
        messageId: newMessage.id,
        userId: userId,
      }).onConflictDoNothing();

      // Get sender info
      const [sender] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      res.status(201).json({
        ...newMessage,
        sender,
      });
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mark messages as read
  app.post("/api/conversations/:id/read", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const conversationId = req.params.id;

      // Verify user is a participant
      const [participant] = await db
        .select()
        .from(conversationParticipants)
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        )
        .limit(1);

      if (!participant) {
        res.status(403).json({ error: "Not a participant of this conversation" });
        return;
      }

      // Get all unread messages in this conversation
      const unreadMessages = await db
        .select({ id: messages.id })
        .from(messages)
        .leftJoin(
          messageReadReceipts,
          and(
            eq(messageReadReceipts.messageId, messages.id),
            eq(messageReadReceipts.userId, userId)
          )
        )
        .where(
          and(
            eq(messages.conversationId, conversationId),
            sql`${messageReadReceipts.id} IS NULL`
          )
        );

      // Mark all as read
      if (unreadMessages.length > 0) {
        await db.insert(messageReadReceipts).values(
          unreadMessages.map(m => ({
            messageId: m.id,
            userId: userId,
          }))
        ).onConflictDoNothing();
      }

      // Update last read timestamp
      await db
        .update(conversationParticipants)
        .set({ lastReadAt: new Date() })
        .where(
          and(
            eq(conversationParticipants.conversationId, conversationId),
            eq(conversationParticipants.userId, userId)
          )
        );

      res.json({ success: true, markedAsRead: unreadMessages.length });
    } catch (error) {
      console.error("Mark messages read error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get total unread message count for navigation badge
  app.get("/api/messages/unread-count", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;

      // Get all conversations user participates in
      const userConversationIds = await db
        .select({ conversationId: conversationParticipants.conversationId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.userId, userId));

      if (userConversationIds.length === 0) {
        res.json({ unreadCount: 0 });
        return;
      }

      const convIds = userConversationIds.map(c => c.conversationId);

      // Count unread messages across all conversations
      const unreadCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .leftJoin(
          messageReadReceipts,
          and(
            eq(messageReadReceipts.messageId, messages.id),
            eq(messageReadReceipts.userId, userId)
          )
        )
        .where(
          and(
            inArray(messages.conversationId, convIds),
            sql`${messageReadReceipts.id} IS NULL`,
            sql`${messages.senderId} != ${userId}`
          )
        );

      res.json({ unreadCount: Number(unreadCount[0]?.count || 0) });
    } catch (error) {
      console.error("Get unread count error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get users available for messaging (for starting new conversations)
  app.get("/api/messaging/users", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      
      // Organization filtering: Only show users from same organization for messaging
      // SUPER_ADMIN can message anyone
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any messaging users
      if (mustDenyAccess) {
        return res.json([]);
      }

      const conditions = [
        eq(users.isActive, true),
        sql`${users.id} != ${userId}`
      ];
      
      // Non-SUPER_ADMIN can only message users in their organization
      if (shouldFilter && orgId) {
        conditions.push(eq(users.organizationId, orgId));
      }

      const availableUsers = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          role: users.role,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(users.firstName, users.lastName);

      res.json(availableUsers);
    } catch (error) {
      console.error("Get messaging users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================================
  // EQUIPMENT & TOOL MANAGEMENT ROUTES
  // ============================================================

  // Get all equipment with optional filters
  app.get("/api/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't see any equipment
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { status, type, search } = req.query;
      
      const conditions: any[] = [];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      if (status && status !== "ALL") {
        conditions.push(eq(equipment.status, status as string));
      }
      
      if (type && type !== "ALL") {
        conditions.push(eq(equipment.type, type as string));
      }
      
      if (search) {
        const searchTerm = `%${String(search).toLowerCase()}%`;
        conditions.push(
          or(
            sql`LOWER(${equipment.name}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.equipmentCode}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.make}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.model}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.serialNumber}) LIKE ${searchTerm}`
          )
        );
      }
      
      const result = conditions.length > 0
        ? await db.select().from(equipment).where(and(...conditions)).orderBy(equipment.name)
        : await db.select().from(equipment).orderBy(equipment.name);
      
      res.json(result);
    } catch (error) {
      console.error("Get equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get available projects for equipment assignment (must be before :idOrCode route)
  app.get("/api/equipment/available-projects", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Organization filtering: Only show projects from user's organization
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any projects
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const conditions = [eq(projects.status, "ACTIVE")];
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const activeProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          code: projects.code,
        })
        .from(projects)
        .where(and(...conditions))
        .orderBy(projects.name);
      
      res.json(activeProjects);
    } catch (error) {
      console.error("Get available projects error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get single equipment by ID or code
  app.get("/api/equipment/:idOrCode", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't access equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { idOrCode } = req.params;
      
      const conditions = [
        or(
          eq(equipment.id, idOrCode),
          eq(equipment.equipmentCode, idOrCode)
        )
      ];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const result = await db
        .select()
        .from(equipment)
        .where(and(...conditions))
        .limit(1);
      
      if (result.length === 0) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      res.json(result[0]);
    } catch (error) {
      console.error("Get equipment by ID error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create new equipment
  app.post("/api/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't create equipment
      if (mustDenyAccess || !req.user?.organizationId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const body = req.body;
      
      // Generate equipment code if not provided
      if (!body.equipmentCode) {
        const lastEquipment = await db
          .select({ equipmentCode: equipment.equipmentCode })
          .from(equipment)
          .orderBy(desc(equipment.equipmentCode))
          .limit(1);
        
        let nextNumber = 1;
        if (lastEquipment.length > 0) {
          const match = lastEquipment[0].equipmentCode.match(/EQ-(\d+)/);
          if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
          }
        }
        body.equipmentCode = `EQ-${String(nextNumber).padStart(4, '0')}`;
      }
      
      // Validate and coerce input using the validated schema
      // This handles empty strings for numeric fields by converting them to null
      const validationResult = validatedEquipmentSchema.safeParse(body);
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ 
          error: "Validation failed",
          details: errors 
        });
        return;
      }
      
      const validatedData = validationResult.data;
      
      // SECURITY: Set organizationId from authenticated user
      const [newEquipment] = await db.insert(equipment).values({
        ...validatedData,
        organizationId: req.user.organizationId
      }).returning();
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "equipment",
        entityId: newEquipment.id,
        newValue: `Created equipment: ${newEquipment.name} (${newEquipment.equipmentCode})`,
      });
      
      res.status(201).json(newEquipment);
    } catch (error: any) {
      console.error("Create equipment error:", error);
      if (error.constraint === "equipment_equipment_code_unique") {
        res.status(400).json({ error: "Equipment code already exists" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update equipment
  app.patch("/api/equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't update equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const updates = req.body;
      
      // SECURITY: Verify ownership before update
      const conditions = [eq(equipment.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(equipment)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Validate and coerce numeric fields for partial updates
      // Create a partial schema that only validates provided fields
      const partialValidation = validatedEquipmentSchema.partial().safeParse(updates);
      if (!partialValidation.success) {
        const errors = partialValidation.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ 
          error: "Validation failed",
          details: errors 
        });
        return;
      }
      
      const validatedUpdates = partialValidation.data;
      
      // SECURITY: Prevent changing organizationId
      delete (validatedUpdates as any).organizationId;
      
      const [updated] = await db
        .update(equipment)
        .set({ ...validatedUpdates, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      
      if (!updated) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "equipment",
        entityId: id,
        newValue: `Updated equipment: ${updated.name}`,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Update equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete equipment
  app.delete("/api/equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't delete equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      
      // SECURITY: Build conditions with org filter
      const conditions = [eq(equipment.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      // SECURITY: Delete with organization filter applied
      const [deleted] = await db
        .delete(equipment)
        .where(and(...conditions))
        .returning();
      
      if (!deleted) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "equipment",
        entityId: id,
        newValue: `Deleted equipment: ${deleted.name} (${deleted.equipmentCode})`,
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get equipment assignments for a piece of equipment
  app.get("/api/equipment/:equipmentId/assignments", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify parent equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db
        .select()
        .from(equipment)
        .where(and(...equipConditions))
        .limit(1);
      
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const assignments = await db
        .select({
          id: equipmentAssignments.id,
          equipmentId: equipmentAssignments.equipmentId,
          projectId: equipmentAssignments.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          assignedById: equipmentAssignments.assignedById,
          assignedByName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          returnedAt: equipmentAssignments.returnedAt,
          hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
          hoursAtReturn: equipmentAssignments.hoursAtReturn,
          notes: equipmentAssignments.notes,
          isActive: equipmentAssignments.isActive,
        })
        .from(equipmentAssignments)
        .innerJoin(projects, eq(equipmentAssignments.projectId, projects.id))
        .innerJoin(users, eq(equipmentAssignments.assignedById, users.id))
        .where(eq(equipmentAssignments.equipmentId, equipmentId))
        .orderBy(desc(equipmentAssignments.assignedAt));
      
      res.json(assignments);
    } catch (error) {
      console.error("Get equipment assignments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Assign equipment to project
  app.post("/api/equipment/:equipmentId/assign", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, expectedReturnDate, notes } = req.body;
      
      // SECURITY: Check if equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Check if equipment is available
      if (equipmentItem.status !== "AVAILABLE") {
        res.status(400).json({ error: `Equipment is not available (current status: ${equipmentItem.status})` });
        return;
      }
      
      // Create assignment
      const [assignment] = await db.insert(equipmentAssignments).values({
        equipmentId,
        projectId,
        assignedById: req.user!.id,
        expectedReturnDate: expectedReturnDate || null,
        hoursAtAssignment: equipmentItem.currentHours,
        notes,
        isActive: true,
      }).returning();
      
      // Update equipment status
      await db.update(equipment).set({
        status: "ASSIGNED",
        assignedToProjectId: projectId,
        currentLocation: null, // Will be at project site
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      // Audit log
      const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "equipment_assignment",
        entityId: assignment.id,
        newValue: `Assigned ${equipmentItem.name} to ${project?.name || projectId}`,
      });
      
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Assign equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Return equipment from assignment
  app.post("/api/equipment/:equipmentId/return", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { returnCondition, endingHours, notes } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Find active assignment
      const [activeAssignment] = await db
        .select()
        .from(equipmentAssignments)
        .where(and(
          eq(equipmentAssignments.equipmentId, equipmentId),
          eq(equipmentAssignments.isActive, true)
        ))
        .limit(1);
      
      if (!activeAssignment) {
        res.status(400).json({ error: "No active assignment found for this equipment" });
        return;
      }
      
      // Update assignment
      const [updated] = await db.update(equipmentAssignments).set({
        returnedAt: new Date(),
        returnedById: req.user!.id,
        returnCondition,
        hoursAtReturn: endingHours,
        notes: notes || activeAssignment.notes,
        isActive: false,
        updatedAt: new Date(),
      }).where(eq(equipmentAssignments.id, activeAssignment.id)).returning();
      
      // Update equipment status and hours
      await db.update(equipment).set({
        status: "AVAILABLE",
        assignedToProjectId: null,
        currentHours: endingHours || undefined,
        currentLocation: null,
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "equipment_assignment",
        entityId: activeAssignment.id,
        newValue: `Returned equipment from assignment`,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Return equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get equipment repairs
  app.get("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const repairs = await db
        .select({
          id: equipmentRepairs.id,
          repairNumber: equipmentRepairs.repairNumber,
          description: equipmentRepairs.description,
          status: equipmentRepairs.status,
          problemReportedAt: equipmentRepairs.problemReportedAt,
          problemDescription: equipmentRepairs.problemDescription,
          repairLocation: equipmentRepairs.repairLocation,
          estimatedCost: equipmentRepairs.estimatedCost,
          actualCost: equipmentRepairs.actualCost,
          estimatedCompletionDate: equipmentRepairs.estimatedCompletionDate,
          completedAt: equipmentRepairs.completedAt,
          repairNotes: equipmentRepairs.repairNotes,
          createdAt: equipmentRepairs.createdAt,
          reportedByName: sql<string>`reporter.first_name || ' ' || reporter.last_name`,
        })
        .from(equipmentRepairs)
        .innerJoin(sql`users as reporter`, sql`${equipmentRepairs.problemReportedById} = reporter.id`)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt));
      
      res.json(repairs);
    } catch (error) {
      console.error("Get equipment repairs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Report equipment repair
  app.post("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { description, problemDescription, repairLocation, estimatedCost, estimatedCompletionDate } = req.body;
      
      // SECURITY: Check if equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Generate repair number
      const lastRepair = await db
        .select({ repairNumber: equipmentRepairs.repairNumber })
        .from(equipmentRepairs)
        .orderBy(desc(equipmentRepairs.createdAt))
        .limit(1);
      
      let nextNumber = 1;
      if (lastRepair.length > 0) {
        const match = lastRepair[0].repairNumber.match(/REP-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1], 10) + 1;
        }
      }
      const repairNumber = `REP-${String(nextNumber).padStart(4, '0')}`;
      
      // Create repair record
      const [repair] = await db.insert(equipmentRepairs).values({
        equipmentId,
        repairNumber,
        description,
        status: "PENDING",
        problemReportedById: req.user!.id,
        problemDescription,
        hoursAtReport: equipmentItem.currentHours,
        repairLocation,
        estimatedCost,
        estimatedCompletionDate: estimatedCompletionDate || null,
      }).returning();
      
      // Update equipment status
      await db.update(equipment).set({
        status: "IN_REPAIR",
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(repair);
    } catch (error) {
      console.error("Create repair error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update repair status
  app.patch("/api/equipment/repairs/:repairId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { repairId } = req.params;
      const updates = req.body;
      
      // Get repair to find equipment
      const [repair] = await db.select().from(equipmentRepairs).where(eq(equipmentRepairs.id, repairId));
      if (!repair) {
        res.status(404).json({ error: "Repair not found" });
        return;
      }
      
      // SECURITY: Verify parent equipment belongs to user's org
      const equipConditions = [eq(equipment.id, repair.equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Handle status change to COMPLETED
      if (updates.status === "COMPLETED" && repair.status !== "COMPLETED") {
        updates.completedAt = new Date();
        updates.completedById = req.user!.id;
        
        // Update equipment status back to AVAILABLE
        await db.update(equipment).set({
          status: "AVAILABLE",
          updatedAt: new Date(),
        }).where(eq(equipment.id, repair.equipmentId));
      }
      
      const [updated] = await db
        .update(equipmentRepairs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(equipmentRepairs.id, repairId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error("Update repair error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance schedules for equipment
  app.get("/api/equipment/:equipmentId/maintenance-schedules", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const schedules = await db
        .select()
        .from(equipmentMaintenanceSchedules)
        .where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId))
        .orderBy(equipmentMaintenanceSchedules.name);
      
      res.json(schedules);
    } catch (error) {
      console.error("Get maintenance schedules error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create maintenance schedule
  app.post("/api/equipment/:equipmentId/maintenance-schedules", requireAuth, requireRole("ADMIN", "MANAGER", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const body = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Calculate next due date based on interval
      let nextDueAt = null;
      let nextDueHours = null;
      
      if (body.intervalDays) {
        nextDueAt = new Date();
        nextDueAt.setDate(nextDueAt.getDate() + body.intervalDays);
      }
      
      if (body.intervalHours) {
        nextDueHours = (parseFloat(equipmentItem.currentHours || "0") + body.intervalHours).toString();
      }
      
      const [schedule] = await db.insert(equipmentMaintenanceSchedules).values({
        equipmentId,
        ...body,
        nextDueAt,
        nextDueHours,
      }).returning();
      
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create maintenance schedule error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Record maintenance completion
  app.post("/api/equipment/:equipmentId/maintenance-history", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { scheduleId, maintenanceType, description, performedByVendor, laborCost, partsCost, notes, partsUsed } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const totalCost = (parseFloat(laborCost || "0") + parseFloat(partsCost || "0")).toString();
      
      // Create maintenance history record
      const [history] = await db.insert(equipmentMaintenanceHistory).values({
        equipmentId,
        scheduleId,
        maintenanceType,
        description,
        performedAt: new Date(),
        hoursAtMaintenance: equipmentItem.currentHours,
        performedById: req.user!.id,
        performedByVendor,
        laborCost,
        partsCost,
        totalCost,
        notes,
        partsUsed,
      }).returning();
      
      // Update schedule if provided
      if (scheduleId) {
        const [schedule] = await db.select().from(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
        if (schedule) {
          let nextDueAt = null;
          let nextDueHours = null;
          
          if (schedule.intervalDays) {
            nextDueAt = new Date();
            nextDueAt.setDate(nextDueAt.getDate() + schedule.intervalDays);
          }
          
          if (schedule.intervalHours) {
            nextDueHours = (parseFloat(equipmentItem.currentHours || "0") + schedule.intervalHours).toString();
          }
          
          await db.update(equipmentMaintenanceSchedules).set({
            lastPerformedAt: new Date(),
            lastPerformedHours: equipmentItem.currentHours,
            nextDueAt,
            nextDueHours,
            updatedAt: new Date(),
          }).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
        }
      }
      
      // Update equipment maintenance dates
      await db.update(equipment).set({
        lastMaintenanceDate: new Date(),
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(history);
    } catch (error) {
      console.error("Record maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance history for equipment
  app.get("/api/equipment/:equipmentId/maintenance-history", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const history = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt));
      
      res.json(history);
    } catch (error) {
      console.error("Get maintenance history error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get upcoming maintenance due (for alerts)
  app.get("/api/equipment/maintenance/upcoming", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const now = new Date();
      const alertWindow = new Date();
      alertWindow.setDate(alertWindow.getDate() + 14); // 2 weeks ahead
      
      // SECURITY: Build conditions with org filter
      const conditions = [
        eq(equipmentMaintenanceSchedules.isActive, true),
        or(
          // Date-based maintenance due within window
          and(
            sql`${equipmentMaintenanceSchedules.nextDueAt} IS NOT NULL`,
            sql`${equipmentMaintenanceSchedules.nextDueAt} <= ${alertWindow}`
          ),
          // Hours-based maintenance due (within 50 hours)
          sql`(${equipmentMaintenanceSchedules.nextDueHours}::numeric - COALESCE(${equipment.currentHours}::numeric, 0)) <= 50`
        )
      ];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const upcomingMaintenance = await db
        .select({
          scheduleId: equipmentMaintenanceSchedules.id,
          equipmentId: equipmentMaintenanceSchedules.equipmentId,
          equipmentName: equipment.name,
          equipmentCode: equipment.equipmentCode,
          maintenanceName: equipmentMaintenanceSchedules.name,
          maintenanceType: equipmentMaintenanceSchedules.maintenanceType,
          nextDueAt: equipmentMaintenanceSchedules.nextDueAt,
          nextDueHours: equipmentMaintenanceSchedules.nextDueHours,
          currentHours: equipment.currentHours,
        })
        .from(equipmentMaintenanceSchedules)
        .innerJoin(equipment, eq(equipmentMaintenanceSchedules.equipmentId, equipment.id))
        .where(and(...conditions))
        .orderBy(equipmentMaintenanceSchedules.nextDueAt);
      
      res.json(upcomingMaintenance);
    } catch (error) {
      console.error("Get upcoming maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get equipment assigned to a project
  app.get("/api/projects/:projectId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // SECURITY: Also filter equipment by org to prevent cross-org data leakage
      const equipmentConditions = [eq(equipmentAssignments.projectId, projectId)];
      if (shouldFilter && orgId) {
        equipmentConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const projectEquipment = await db
        .select({
          assignmentId: equipmentAssignments.id,
          equipmentId: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          currentHours: equipment.currentHours,
          status: equipment.status,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
          isActive: equipmentAssignments.isActive,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipmentAssignments.equipmentId, equipment.id))
        .where(and(...equipmentConditions))
        .orderBy(desc(equipmentAssignments.assignedAt));
      
      res.json(projectEquipment);
    } catch (error) {
      console.error("Get project equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get project equipment plans (from bid or manually added)
  app.get("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const plans = await db
        .select()
        .from(projectEquipmentPlans)
        .where(eq(projectEquipmentPlans.projectId, projectId))
        .orderBy(projectEquipmentPlans.createdAt);
      
      res.json(plans);
    } catch (error) {
      console.error("Get project equipment plans error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add equipment plan to project
  app.post("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify project exists AND belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const { source, equipmentName, equipmentType } = req.body;
      if (!source || !equipmentName || !equipmentType) {
        return res.status(400).json({ error: "Source, equipment name, and type are required" });
      }
      
      const [newPlan] = await db.insert(projectEquipmentPlans).values({
        projectId,
        source: req.body.source,
        status: "PLANNED" as const,
        equipmentId: req.body.equipmentId || null,
        rentalCatalogId: req.body.rentalCatalogId || null,
        rentalVendorId: req.body.rentalVendorId || null,
        equipmentName: req.body.equipmentName,
        equipmentType: req.body.equipmentType,
        plannedHours: req.body.plannedHours != null ? String(req.body.plannedHours) : null,
        plannedDays: req.body.plannedDays != null ? Number(req.body.plannedDays) : null,
        plannedStartDate: req.body.plannedStartDate ? new Date(req.body.plannedStartDate) : null,
        plannedEndDate: req.body.plannedEndDate ? new Date(req.body.plannedEndDate) : null,
        plannedCost: req.body.plannedCost != null ? String(req.body.plannedCost) : null,
        hourlyRate: req.body.hourlyRate != null ? String(req.body.hourlyRate) : null,
        dailyRate: req.body.dailyRate != null ? String(req.body.dailyRate) : null,
        notes: req.body.notes || null,
        createdById: userId!,
      }).returning();
      
      await logCreate(userId!, "project_equipment_plans", newPlan.id, { projectId, equipmentName: req.body.equipmentName });
      
      res.status(201).json(newPlan);
    } catch (error) {
      console.error("Create project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update project equipment plan
  app.patch("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // SECURITY: Define conditions for both SELECT and UPDATE to prevent TOCTOU
      const planConditions = and(
        eq(projectEquipmentPlans.id, planId),
        eq(projectEquipmentPlans.projectId, projectId)
      );
      
      const [existing] = await db.select()
        .from(projectEquipmentPlans)
        .where(planConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment plan not found" });
      }
      
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (req.body.source !== undefined) updateData.source = req.body.source;
      if (req.body.status !== undefined) updateData.status = req.body.status;
      if (req.body.equipmentId !== undefined) updateData.equipmentId = req.body.equipmentId || null;
      if (req.body.assignmentId !== undefined) updateData.assignmentId = req.body.assignmentId || null;
      if (req.body.rentalCatalogId !== undefined) updateData.rentalCatalogId = req.body.rentalCatalogId || null;
      if (req.body.rentalVendorId !== undefined) updateData.rentalVendorId = req.body.rentalVendorId || null;
      if (req.body.equipmentName !== undefined) updateData.equipmentName = req.body.equipmentName;
      if (req.body.equipmentType !== undefined) updateData.equipmentType = req.body.equipmentType;
      if (req.body.plannedHours !== undefined) updateData.plannedHours = req.body.plannedHours != null ? String(req.body.plannedHours) : null;
      if (req.body.plannedDays !== undefined) updateData.plannedDays = req.body.plannedDays != null ? Number(req.body.plannedDays) : null;
      if (req.body.plannedStartDate !== undefined) updateData.plannedStartDate = req.body.plannedStartDate ? new Date(req.body.plannedStartDate) : null;
      if (req.body.plannedEndDate !== undefined) updateData.plannedEndDate = req.body.plannedEndDate ? new Date(req.body.plannedEndDate) : null;
      if (req.body.plannedCost !== undefined) updateData.plannedCost = req.body.plannedCost != null ? String(req.body.plannedCost) : null;
      if (req.body.actualHours !== undefined) updateData.actualHours = req.body.actualHours != null ? String(req.body.actualHours) : null;
      if (req.body.actualDays !== undefined) updateData.actualDays = req.body.actualDays != null ? Number(req.body.actualDays) : null;
      if (req.body.actualStartDate !== undefined) updateData.actualStartDate = req.body.actualStartDate ? new Date(req.body.actualStartDate) : null;
      if (req.body.actualEndDate !== undefined) updateData.actualEndDate = req.body.actualEndDate ? new Date(req.body.actualEndDate) : null;
      if (req.body.actualCost !== undefined) updateData.actualCost = req.body.actualCost != null ? String(req.body.actualCost) : null;
      if (req.body.hourlyRate !== undefined) updateData.hourlyRate = req.body.hourlyRate != null ? String(req.body.hourlyRate) : null;
      if (req.body.dailyRate !== undefined) updateData.dailyRate = req.body.dailyRate != null ? String(req.body.dailyRate) : null;
      if (req.body.rentalConfirmationNumber !== undefined) updateData.rentalConfirmationNumber = req.body.rentalConfirmationNumber || null;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes || null;
      
      // SECURITY: Use same conditions in UPDATE to prevent TOCTOU race condition
      const [updated] = await db
        .update(projectEquipmentPlans)
        .set(updateData)
        .where(planConditions)
        .returning();
      
      await logUpdate(userId!, "project_equipment_plans", planId, existing, updated);
      
      res.json(updated);
    } catch (error) {
      console.error("Update project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete project equipment plan
  app.delete("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // SECURITY: Include projectId in both SELECT and DELETE to prevent TOCTOU
      const planConditions = and(
        eq(projectEquipmentPlans.id, planId),
        eq(projectEquipmentPlans.projectId, projectId)
      );
      
      const [existing] = await db.select()
        .from(projectEquipmentPlans)
        .where(planConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment plan not found" });
      }
      
      // SECURITY: Use same conditions in DELETE to prevent TOCTOU race condition
      await db.delete(projectEquipmentPlans).where(planConditions);
      
      await logDelete(userId!, "project_equipment_plans", planId, { equipmentName: existing.equipmentName });
      
      res.status(204).send();
    } catch (error) {
      console.error("Delete project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Submit weekly hour log for equipment
  app.post("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, weekStartDate, weekEndDate, startingHours, endingHours, notes, fuelUsed } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const hoursUsed = (parseFloat(endingHours) - parseFloat(startingHours)).toString();
      
      // Find active assignment
      const [assignment] = await db
        .select()
        .from(equipmentAssignments)
        .where(and(
          eq(equipmentAssignments.equipmentId, equipmentId),
          eq(equipmentAssignments.projectId, projectId),
          eq(equipmentAssignments.isActive, true)
        ));
      
      const [log] = await db.insert(equipmentHourLogs).values({
        equipmentId,
        assignmentId: assignment?.id,
        projectId,
        weekStartDate,
        weekEndDate,
        startingHours,
        endingHours,
        hoursUsed,
        submittedById: req.user!.id,
        notes: notes || null,
        fuelUsed: fuelUsed && fuelUsed !== "" ? fuelUsed : null,
      }).returning();
      
      // Update equipment current hours
      await db.update(equipment).set({
        currentHours: endingHours,
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(log);
    } catch (error: any) {
      console.error("Submit hour log error:", error);
      if (error.constraint === "equipment_hour_logs_unique_week") {
        res.status(400).json({ error: "Hour log already exists for this week" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get hour logs for equipment
  app.get("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const logs = await db
        .select({
          id: equipmentHourLogs.id,
          weekStartDate: equipmentHourLogs.weekStartDate,
          weekEndDate: equipmentHourLogs.weekEndDate,
          startingHours: equipmentHourLogs.startingHours,
          endingHours: equipmentHourLogs.endingHours,
          hoursUsed: equipmentHourLogs.hoursUsed,
          notes: equipmentHourLogs.notes,
          fuelUsed: equipmentHourLogs.fuelUsed,
          submittedAt: equipmentHourLogs.submittedAt,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(equipmentHourLogs)
        .innerJoin(projects, eq(equipmentHourLogs.projectId, projects.id))
        .where(eq(equipmentHourLogs.equipmentId, equipmentId))
        .orderBy(desc(equipmentHourLogs.weekStartDate));
      
      res.json(logs);
    } catch (error) {
      console.error("Get hour logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // AI-powered equipment maintenance recommendations
  app.post("/api/equipment/:equipmentId/ai-recommendations", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const { problemDescription } = req.body;
      
      // Get equipment details
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Get repair history for context
      const repairHistory = await db
        .select()
        .from(equipmentRepairs)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt))
        .limit(10);
      
      // Get maintenance history for context
      const maintenanceHistory = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt))
        .limit(10);
      
      const { openai } = await import('./ai/openaiClient');
      
      const systemPrompt = `You are an expert equipment maintenance advisor for construction equipment. 
You provide practical, actionable recommendations for repairs and preventative maintenance.
Always respond in valid JSON format with the following structure:
{
  "recommendedTasks": [
    { "task": "Task description", "priority": "HIGH|MEDIUM|LOW", "estimatedCost": number, "estimatedHours": number }
  ],
  "recommendedParts": [
    { "part": "Part name", "quantity": number, "estimatedCost": number, "supplier": "Suggested supplier or 'OEM Dealer'" }
  ],
  "preventativeSchedule": [
    { "interval": "Hours or calendar interval", "task": "Maintenance task", "description": "Brief description" }
  ],
  "urgency": "CRITICAL|HIGH|MEDIUM|LOW",
  "estimatedTotalCost": number,
  "summary": "Brief summary of recommendations",
  "warningsOrNotes": ["Any important warnings or notes"]
}`;

      const userPrompt = `Equipment Details:
- Name: ${equipmentItem.name}
- Type: ${equipmentItem.type}
- Make: ${equipmentItem.make || 'Unknown'}
- Model: ${equipmentItem.model || 'Unknown'}
- Year: ${equipmentItem.year || 'Unknown'}
- Current Hours: ${equipmentItem.currentHours || 0}
- Last Maintenance: ${equipmentItem.lastMaintenanceDate ? new Date(equipmentItem.lastMaintenanceDate).toLocaleDateString() : 'Unknown'}

Problem Reported: ${problemDescription || 'General maintenance check requested'}

Recent Repair History (last 10):
${repairHistory.length > 0 
  ? repairHistory.map(r => `- ${r.description}: ${r.status} (Cost: ${r.actualCost || r.estimatedCost || 'Unknown'})`).join('\n')
  : 'No recent repairs'}

Recent Maintenance History (last 10):
${maintenanceHistory.length > 0
  ? maintenanceHistory.map(m => `- ${m.maintenanceType}: ${m.description || 'Completed'} at ${m.hoursAtMaintenance || 'Unknown'} hours`).join('\n')
  : 'No recent maintenance records'}

Please provide:
1. Recommended repair tasks based on the problem description
2. Parts that may be needed
3. Recommended preventative maintenance schedule for this equipment type
4. Urgency assessment
5. Cost estimates`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 2048,
      });
      
      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      const recommendations = JSON.parse(content);
      res.json(recommendations);
    } catch (error) {
      console.error("AI recommendations error:", error);
      res.status(500).json({ error: "Failed to generate AI recommendations" });
    }
  });

  // Notify maintenance managers about new repair/maintenance requests
  app.post("/api/equipment/notify-maintenance", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId, repairId, message, type } = req.body;
      
      // Get all maintenance managers
      const maintenanceManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.role, "MAINTENANCE_MANAGER"),
          eq(users.isActive, true)
        ));
      
      // Also notify admins and managers with maintenance oversight
      const adminsAndManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER")),
          eq(users.isActive, true)
        ));
      
      const allRecipients = [...maintenanceManagers, ...adminsAndManagers];
      const uniqueRecipientIds = Array.from(new Set(allRecipients.map(r => r.id)));
      
      // Create notifications for all recipients
      for (const recipientId of uniqueRecipientIds) {
        await db.insert(notifications).values({
          userId: recipientId,
          type: type === 'REPAIR' ? 'REPAIR_REQUEST' : 'MAINTENANCE_REQUEST',
          title: type === 'REPAIR' ? 'New Repair Request' : 'Maintenance Required',
          message,
          relatedEntityId: equipmentId,
          relatedEntityType: 'equipment',
        });
      }
      
      res.json({ success: true, notifiedCount: uniqueRecipientIds.length });
    } catch (error) {
      console.error("Notify maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get equipment assigned to a project (for project detail page)
  app.get("/api/projects/:projectId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      
      // Get active assignments for this project
      const assignedEquipment = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          year: equipment.year,
          status: equipment.status,
          currentHours: equipment.currentHours,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          assignmentId: equipmentAssignments.id,
          assignmentNotes: equipmentAssignments.notes,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipmentAssignments.equipmentId, equipment.id))
        .where(and(
          eq(equipmentAssignments.projectId, projectId),
          eq(equipmentAssignments.isActive, true)
        ))
        .orderBy(equipment.name);
      
      res.json(assignedEquipment);
    } catch (error) {
      console.error("Get project equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get preventative maintenance schedules for equipment
  app.get("/api/equipment/:equipmentId/maintenance-schedules", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      const schedules = await db
        .select()
        .from(equipmentMaintenanceSchedules)
        .where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId))
        .orderBy(equipmentMaintenanceSchedules.nextDueAt);
      
      res.json(schedules);
    } catch (error) {
      console.error("Get maintenance schedules error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Generate AI-powered preventative maintenance schedule for equipment
  app.post("/api/equipment/:equipmentId/generate-maintenance-schedule", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      // Get equipment details
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Get existing maintenance history for context
      const maintenanceHistory = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt))
        .limit(20);
      
      const { openai } = await import('./ai/openaiClient');
      
      const systemPrompt = `You are an expert equipment maintenance specialist with deep knowledge of manufacturer-recommended maintenance schedules.
You provide comprehensive preventative maintenance schedules based on specific equipment make, model, and type.
Research and provide manufacturer-specific recommendations where possible.
Always respond in valid JSON format with the following structure:
{
  "schedules": [
    {
      "name": "Maintenance task name (e.g., Engine Oil Change)",
      "maintenanceType": "PREVENTATIVE" | "SCHEDULED_SERVICE" | "INSPECTION" | "CALIBRATION",
      "description": "Detailed description of what this maintenance involves",
      "intervalHours": number or null (hours between maintenance, e.g., 250),
      "intervalDays": number or null (days between maintenance, e.g., 90),
      "alertDaysBefore": 7,
      "alertHoursBefore": 25,
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "estimatedDuration": "Time to complete (e.g., 1 hour)",
      "estimatedCost": number (approximate cost in USD),
      "requiredParts": ["List of parts needed"],
      "notes": "Any special notes or manufacturer recommendations"
    }
  ],
  "manufacturerNotes": "Any important notes about this specific make/model maintenance requirements",
  "totalAnnualMaintenanceCost": number (estimated annual cost for all maintenance),
  "criticalItems": ["List of most critical maintenance items that should never be skipped"]
}`;

      const userPrompt = `Generate a comprehensive preventative maintenance schedule for the following equipment:

Equipment Details:
- Name: ${equipmentItem.name}
- Type: ${equipmentItem.type}
- Make: ${equipmentItem.make || 'Unknown'}
- Model: ${equipmentItem.model || 'Unknown'}
- Year: ${equipmentItem.year || 'Unknown'}
- Current Hours: ${equipmentItem.currentHours || 0}
- Last Maintenance Date: ${equipmentItem.lastMaintenanceDate ? new Date(equipmentItem.lastMaintenanceDate).toLocaleDateString() : 'Unknown'}

Recent Maintenance History:
${maintenanceHistory.length > 0
  ? maintenanceHistory.map(m => `- ${m.maintenanceType}: ${m.description} at ${m.hoursAtMaintenance || 'Unknown'} hours`).join('\n')
  : 'No recent maintenance records'}

Please provide:
1. A complete preventative maintenance schedule based on manufacturer recommendations for this specific make/model
2. Include both hour-based and calendar-based intervals where appropriate
3. Prioritize items by importance
4. Include estimated costs and required parts
5. Note any special considerations for this equipment type/model

If the make/model is unknown, provide general best practices for the equipment type (${equipmentItem.type}).`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4096,
      });
      
      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      const aiResponse = JSON.parse(content);
      
      // Delete existing schedules for this equipment (replace with new AI-generated ones)
      await db.delete(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId));
      
      // Calculate next due dates based on current hours and last maintenance
      const currentHours = parseFloat(equipmentItem.currentHours || "0");
      const now = new Date();
      
      // Insert new schedules
      const insertedSchedules = [];
      for (const schedule of aiResponse.schedules) {
        // Calculate next due date
        let nextDueAt: Date | null = null;
        let nextDueHours: string | null = null;
        
        if (schedule.intervalDays) {
          nextDueAt = new Date(now.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000);
        }
        if (schedule.intervalHours) {
          nextDueHours = String(currentHours + schedule.intervalHours);
        }
        
        const [inserted] = await db.insert(equipmentMaintenanceSchedules).values({
          equipmentId,
          maintenanceType: schedule.maintenanceType || "PREVENTATIVE",
          name: schedule.name,
          description: schedule.description,
          intervalHours: schedule.intervalHours,
          intervalDays: schedule.intervalDays,
          nextDueAt,
          nextDueHours,
          alertDaysBefore: schedule.alertDaysBefore || 7,
          alertHoursBefore: schedule.alertHoursBefore || 25,
          isActive: true,
        }).returning();
        
        insertedSchedules.push({
          ...inserted,
          priority: schedule.priority,
          estimatedDuration: schedule.estimatedDuration,
          estimatedCost: schedule.estimatedCost,
          requiredParts: schedule.requiredParts,
          notes: schedule.notes,
        });
      }
      
      res.json({
        schedules: insertedSchedules,
        manufacturerNotes: aiResponse.manufacturerNotes,
        totalAnnualMaintenanceCost: aiResponse.totalAnnualMaintenanceCost,
        criticalItems: aiResponse.criticalItems,
      });
    } catch (error) {
      console.error("Generate maintenance schedule error:", error);
      res.status(500).json({ error: "Failed to generate maintenance schedule. Please try again." });
    }
  });

  // Complete a scheduled maintenance item
  app.post("/api/equipment/:equipmentId/maintenance-schedules/:scheduleId/complete", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId, scheduleId } = req.params;
      const { notes, laborCost, partsCost, performedByVendor, partsUsed } = req.body;
      
      // Get schedule
      const [schedule] = await db.select().from(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
      if (!schedule) {
        res.status(404).json({ error: "Maintenance schedule not found" });
        return;
      }
      
      // Get equipment current hours
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const currentHours = equipmentItem.currentHours;
      const now = new Date();
      const totalCost = (parseFloat(laborCost || "0") + parseFloat(partsCost || "0")).toString();
      
      // Create history record
      const [historyRecord] = await db.insert(equipmentMaintenanceHistory).values({
        equipmentId,
        scheduleId,
        maintenanceType: schedule.maintenanceType,
        description: schedule.name + (schedule.description ? `: ${schedule.description}` : ''),
        performedAt: now,
        hoursAtMaintenance: currentHours,
        performedById: req.user!.id,
        performedByVendor,
        laborCost,
        partsCost,
        totalCost,
        notes,
        partsUsed: partsUsed ? JSON.stringify(partsUsed) : null,
      }).returning();
      
      // Update schedule with new last performed date and calculate next due
      let nextDueAt: Date | null = null;
      let nextDueHours: string | null = null;
      
      if (schedule.intervalDays) {
        nextDueAt = new Date(now.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000);
      }
      if (schedule.intervalHours) {
        nextDueHours = String(parseFloat(currentHours || "0") + schedule.intervalHours);
      }
      
      await db.update(equipmentMaintenanceSchedules).set({
        lastPerformedAt: now,
        lastPerformedHours: currentHours,
        nextDueAt,
        nextDueHours,
        updatedAt: now,
      }).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
      
      // Update equipment last maintenance date
      await db.update(equipment).set({
        lastMaintenanceDate: now,
        updatedAt: now,
      }).where(eq(equipment.id, equipmentId));
      
      res.json({
        historyRecord,
        message: "Maintenance completed successfully",
      });
    } catch (error) {
      console.error("Complete maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance history for equipment
  app.get("/api/equipment/:equipmentId/maintenance-history", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      const history = await db
        .select({
          id: equipmentMaintenanceHistory.id,
          maintenanceType: equipmentMaintenanceHistory.maintenanceType,
          description: equipmentMaintenanceHistory.description,
          performedAt: equipmentMaintenanceHistory.performedAt,
          hoursAtMaintenance: equipmentMaintenanceHistory.hoursAtMaintenance,
          performedByVendor: equipmentMaintenanceHistory.performedByVendor,
          laborCost: equipmentMaintenanceHistory.laborCost,
          partsCost: equipmentMaintenanceHistory.partsCost,
          totalCost: equipmentMaintenanceHistory.totalCost,
          notes: equipmentMaintenanceHistory.notes,
          partsUsed: equipmentMaintenanceHistory.partsUsed,
          performedByName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, 'External')`,
        })
        .from(equipmentMaintenanceHistory)
        .leftJoin(users, eq(equipmentMaintenanceHistory.performedById, users.id))
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt));
      
      res.json(history);
    } catch (error) {
      console.error("Get maintenance history error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // EQUIPMENT RATE PROFILES
  // ============================================

  // Get rate profiles for equipment
  app.get("/api/equipment/:equipmentId/rate-profiles", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const profiles = await db
        .select({
          id: equipmentRateProfiles.id,
          equipmentId: equipmentRateProfiles.equipmentId,
          hourlyRate: equipmentRateProfiles.hourlyRate,
          dailyRate: equipmentRateProfiles.dailyRate,
          weeklyRate: equipmentRateProfiles.weeklyRate,
          monthlyRate: equipmentRateProfiles.monthlyRate,
          fuelCostPerHour: equipmentRateProfiles.fuelCostPerHour,
          maintenanceCostPerHour: equipmentRateProfiles.maintenanceCostPerHour,
          operatorCostPerHour: equipmentRateProfiles.operatorCostPerHour,
          includesOperator: equipmentRateProfiles.includesOperator,
          effectiveDate: equipmentRateProfiles.effectiveDate,
          expirationDate: equipmentRateProfiles.expirationDate,
          isActive: equipmentRateProfiles.isActive,
          notes: equipmentRateProfiles.notes,
          createdAt: equipmentRateProfiles.createdAt,
          createdByName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, 'System')`,
        })
        .from(equipmentRateProfiles)
        .leftJoin(users, eq(equipmentRateProfiles.createdById, users.id))
        .where(eq(equipmentRateProfiles.equipmentId, equipmentId))
        .orderBy(desc(equipmentRateProfiles.effectiveDate));
      
      res.json(profiles);
    } catch (error) {
      console.error("Get equipment rate profiles error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get active rate profile for equipment (most recent active)
  app.get("/api/equipment/:equipmentId/active-rate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      const [activeProfile] = await db
        .select()
        .from(equipmentRateProfiles)
        .where(and(
          eq(equipmentRateProfiles.equipmentId, equipmentId),
          eq(equipmentRateProfiles.isActive, true)
        ))
        .orderBy(desc(equipmentRateProfiles.effectiveDate))
        .limit(1);
      
      if (!activeProfile) {
        return res.json(null);
      }
      
      res.json(activeProfile);
    } catch (error) {
      console.error("Get active rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create rate profile for equipment
  app.post("/api/equipment/:equipmentId/rate-profiles", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Parse date strings to Date objects
      const bodyWithDates = {
        ...req.body,
        effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      };
      
      const validatedData = insertEquipmentRateProfileSchema.parse({
        ...bodyWithDates,
        equipmentId,
        createdById: userId,
      });
      
      // If this is marked as active, deactivate other profiles
      if (validatedData.isActive) {
        await db.update(equipmentRateProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(equipmentRateProfiles.equipmentId, equipmentId),
            eq(equipmentRateProfiles.isActive, true)
          ));
      }
      
      const [newProfile] = await db.insert(equipmentRateProfiles).values(validatedData).returning();
      
      await logCreate(userId!, "equipment_rate_profiles", newProfile.id, {
        equipmentId,
        hourlyRate: String(validatedData.hourlyRate),
      });
      
      res.status(201).json(newProfile);
    } catch (error) {
      console.error("Create equipment rate profile error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update rate profile
  app.patch("/api/equipment/:equipmentId/rate-profiles/:profileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId, profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [existingProfile] = await db.select().from(equipmentRateProfiles).where(
        and(
          eq(equipmentRateProfiles.id, profileId),
          eq(equipmentRateProfiles.equipmentId, equipmentId)
        )
      );
      if (!existingProfile) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      const updateData = {
        ...req.body,
        updatedAt: new Date(),
      };
      
      // If activating this profile, deactivate others
      if (updateData.isActive === true && !existingProfile.isActive) {
        await db.update(equipmentRateProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(equipmentRateProfiles.equipmentId, equipmentId),
            eq(equipmentRateProfiles.isActive, true)
          ));
      }
      
      const [updatedProfile] = await db.update(equipmentRateProfiles)
        .set(updateData)
        .where(eq(equipmentRateProfiles.id, profileId))
        .returning();
      
      await logUpdate(userId!, "equipment_rate_profiles", profileId, existingProfile, updateData);
      
      res.json(updatedProfile);
    } catch (error) {
      console.error("Update equipment rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Activate rate profile (deactivates others for same equipment)
  app.post("/api/equipment/:equipmentId/rate-profiles/:profileId/activate", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId, profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [existingProfile] = await db.select().from(equipmentRateProfiles).where(
        and(
          eq(equipmentRateProfiles.id, profileId),
          eq(equipmentRateProfiles.equipmentId, equipmentId)
        )
      );
      if (!existingProfile) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      // Deactivate all other profiles for this equipment
      await db.update(equipmentRateProfiles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(equipmentRateProfiles.equipmentId, equipmentId),
          eq(equipmentRateProfiles.isActive, true)
        ));
      
      // Activate the selected profile
      const [updatedProfile] = await db.update(equipmentRateProfiles)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(equipmentRateProfiles.id, profileId))
        .returning();
      
      await logUpdate(userId!, "equipment_rate_profiles", profileId, existingProfile, { isActive: true });
      
      res.json(updatedProfile);
    } catch (error) {
      console.error("Activate equipment rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete rate profile
  app.delete("/api/equipment/rate-profiles/:profileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to equipment to verify rate profile belongs to user's org
      const profileWithEquip = await db
        .select({
          profileId: equipmentRateProfiles.id,
          equipmentId: equipmentRateProfiles.equipmentId,
          organizationId: equipment.organizationId,
        })
        .from(equipmentRateProfiles)
        .innerJoin(equipment, eq(equipmentRateProfiles.equipmentId, equipment.id))
        .where(eq(equipmentRateProfiles.id, profileId))
        .limit(1);
      
      if (profileWithEquip.length === 0) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      // SECURITY: Verify equipment belongs to user's org
      if (shouldFilter && orgId && profileWithEquip[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      await db.delete(equipmentRateProfiles).where(eq(equipmentRateProfiles.id, profileId));
      
      await logDelete(userId!, "equipment_rate_profiles", profileId, { deleted: true });
      
      res.json({ message: "Rate profile deleted successfully" });
    } catch (error) {
      console.error("Delete equipment rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // RENTAL VENDORS
  // ============================================

  // Get all rental vendors
  app.get("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const conditions = [];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const vendors = await db
        .select()
        .from(rentalVendors)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(rentalVendors.name);
      
      res.json(vendors);
    } catch (error) {
      console.error("Get rental vendors error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get single rental vendor
  app.get("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const { id } = req.params;
      
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...conditions));
      
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      res.json(vendor);
    } catch (error) {
      console.error("Get rental vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create rental vendor
  app.post("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const userId = req.user?.id;
      
      const validatedData = insertRentalVendorSchema.parse(req.body);
      
      // Set organizationId to user's org
      const dataWithOrg = {
        ...validatedData,
        organizationId: shouldFilter && orgId ? orgId : (validatedData.organizationId || "tfr-default-org"),
      };
      
      const [newVendor] = await db.insert(rentalVendors).values(dataWithOrg).returning();
      
      await logCreate(userId!, "rental_vendors", newVendor.id, { name: validatedData.name });
      
      res.status(201).json(newVendor);
    } catch (error) {
      console.error("Create rental vendor error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update rental vendor
  app.patch("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify vendor belongs to user's org
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [existing] = await db.select().from(rentalVendors).where(and(...conditions));
      if (!existing) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const [updated] = await db.update(rentalVendors)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      
      await logUpdate(userId!, "rental_vendors", id, existing, req.body);
      
      res.json(updated);
    } catch (error) {
      console.error("Update rental vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete rental vendor
  app.delete("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify vendor belongs to user's org
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [existing] = await db.select().from(rentalVendors).where(and(...conditions));
      if (!existing) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      await db.delete(rentalVendors).where(and(...conditions));
      
      await logDelete(userId!, "rental_vendors", id, { name: existing.name });
      
      res.json({ message: "Rental vendor deleted successfully" });
    } catch (error) {
      console.error("Delete rental vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // RENTAL EQUIPMENT CATALOG
  // ============================================

  // Get equipment catalog for a vendor
  app.get("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { vendorId } = req.params;
      
      // SECURITY: Verify vendor belongs to user's org
      const vendorConditions = [eq(rentalVendors.id, vendorId)];
      if (shouldFilter && orgId) {
        vendorConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...vendorConditions));
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const catalog = await db
        .select()
        .from(rentalEquipmentCatalog)
        .where(eq(rentalEquipmentCatalog.vendorId, vendorId))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json(catalog);
    } catch (error) {
      console.error("Get rental equipment catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all rental equipment (across all vendors)
  app.get("/api/rental-equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { type, vendorId } = req.query;
      
      // SECURITY: Filter by vendor's org
      const conditions = [eq(rentalEquipmentCatalog.isActive, true)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const results = await db
        .select({
          id: rentalEquipmentCatalog.id,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          vendorId: rentalEquipmentCatalog.vendorId,
          vendorName: rentalVendors.name,
          vendorCode: rentalVendors.code,
          isActive: rentalEquipmentCatalog.isActive,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(and(...conditions))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      // Filter in memory if needed
      let filtered = results;
      if (type) {
        filtered = filtered.filter(r => r.equipmentType === type);
      }
      if (vendorId) {
        filtered = filtered.filter(r => r.vendorId === vendorId);
      }
      
      res.json(filtered);
    } catch (error) {
      console.error("Get rental equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add equipment to vendor catalog
  app.post("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { vendorId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify vendor exists AND belongs to user's org
      const vendorConditions = [eq(rentalVendors.id, vendorId)];
      if (shouldFilter && orgId) {
        vendorConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...vendorConditions));
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const validatedData = insertRentalEquipmentCatalogSchema.parse({
        ...req.body,
        vendorId,
      });
      
      const [newItem] = await db.insert(rentalEquipmentCatalog).values(validatedData).returning();
      
      await logCreate(userId!, "rental_equipment_catalog", newItem.id, { name: validatedData.name, vendorId });
      
      res.status(201).json(newItem);
    } catch (error) {
      console.error("Create rental equipment catalog item error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update catalog item
  app.patch("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to verify catalog item belongs to vendor in user's org
      const catalogWithVendor = await db
        .select({
          catalogId: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          organizationId: rentalVendors.organizationId,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(eq(rentalEquipmentCatalog.id, id))
        .limit(1);
      
      if (catalogWithVendor.length === 0) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      // SECURITY: Verify vendor belongs to user's org
      if (shouldFilter && orgId && catalogWithVendor[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      const [updated] = await db.update(rentalEquipmentCatalog)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(rentalEquipmentCatalog.id, id))
        .returning();
      
      await logUpdate(userId!, "rental_equipment_catalog", id, catalogWithVendor[0], req.body);
      
      res.json(updated);
    } catch (error) {
      console.error("Update rental equipment catalog item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete catalog item
  app.delete("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to verify catalog item belongs to vendor in user's org
      const catalogWithVendor = await db
        .select({
          catalogId: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          organizationId: rentalVendors.organizationId,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(eq(rentalEquipmentCatalog.id, id))
        .limit(1);
      
      if (catalogWithVendor.length === 0) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      // SECURITY: Verify vendor belongs to user's org
      if (shouldFilter && orgId && catalogWithVendor[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      await db.delete(rentalEquipmentCatalog).where(eq(rentalEquipmentCatalog.id, id));
      
      await logDelete(userId!, "rental_equipment_catalog", id, { deleted: true });
      
      res.json({ message: "Catalog item deleted successfully" });
    } catch (error) {
      console.error("Delete rental equipment catalog item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // BID EQUIPMENT SELECTIONS
  // ============================================

  // Get equipment selections for a bid
  app.get("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      
      // Verify bid exists (consistent with other bid endpoints like /quotes)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const selections = await db
        .select()
        .from(bidEquipmentSelections)
        .where(eq(bidEquipmentSelections.bidId, bidId))
        .orderBy(bidEquipmentSelections.createdAt);
      
      res.json(selections);
    } catch (error) {
      console.error("Get bid equipment selections error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add equipment selection to bid
  app.post("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      const userId = req.user?.id;
      
      // Verify bid exists (consistent with other bid endpoints like /quotes)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // Validate required fields
      const { source, equipmentName, equipmentType } = req.body;
      if (!source || !equipmentName || !equipmentType) {
        return res.status(400).json({ error: "Source, equipment name, and type are required" });
      }
      
      // Convert numeric values to strings for decimal fields (drizzle expects strings for decimal)
      const insertData = {
        bidId,
        source: req.body.source,
        equipmentId: req.body.equipmentId || null,
        rentalCatalogId: req.body.rentalCatalogId || null,
        rentalVendorId: req.body.rentalVendorId || null,
        equipmentName: req.body.equipmentName,
        equipmentType: req.body.equipmentType,
        plannedHours: req.body.plannedHours != null ? String(req.body.plannedHours) : null,
        plannedDays: req.body.plannedDays != null ? Number(req.body.plannedDays) : null,
        hourlyRate: req.body.hourlyRate != null ? String(req.body.hourlyRate) : null,
        dailyRate: req.body.dailyRate != null ? String(req.body.dailyRate) : null,
        weeklyRate: req.body.weeklyRate != null ? String(req.body.weeklyRate) : null,
        estimatedCost: req.body.estimatedCost != null ? String(req.body.estimatedCost) : null,
        deliveryFee: req.body.deliveryFee != null ? String(req.body.deliveryFee) : null,
        notes: req.body.notes || null,
        createdById: userId,
      };
      
      const [newSelection] = await db.insert(bidEquipmentSelections).values(insertData).returning();
      
      await logCreate(userId!, "bid_equipment_selections", newSelection.id, { bidId, equipmentName: insertData.equipmentName });
      
      res.status(201).json(newSelection);
    } catch (error) {
      console.error("Create bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update bid equipment selection
  app.patch("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      // Verify bid exists (consistent with other bid endpoints)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // SECURITY: Define conditions for both SELECT and UPDATE to prevent TOCTOU
      const selectionConditions = and(
        eq(bidEquipmentSelections.id, selectionId),
        eq(bidEquipmentSelections.bidId, bidId)
      );
      
      const [existing] = await db.select()
        .from(bidEquipmentSelections)
        .where(selectionConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment selection not found" });
      }
      
      // Convert numeric values to strings for decimal fields
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (req.body.source !== undefined) updateData.source = req.body.source;
      if (req.body.equipmentId !== undefined) updateData.equipmentId = req.body.equipmentId || null;
      if (req.body.rentalCatalogId !== undefined) updateData.rentalCatalogId = req.body.rentalCatalogId || null;
      if (req.body.rentalVendorId !== undefined) updateData.rentalVendorId = req.body.rentalVendorId || null;
      if (req.body.equipmentName !== undefined) updateData.equipmentName = req.body.equipmentName;
      if (req.body.equipmentType !== undefined) updateData.equipmentType = req.body.equipmentType;
      if (req.body.plannedHours !== undefined) updateData.plannedHours = req.body.plannedHours != null ? String(req.body.plannedHours) : null;
      if (req.body.plannedDays !== undefined) updateData.plannedDays = req.body.plannedDays != null ? Number(req.body.plannedDays) : null;
      if (req.body.hourlyRate !== undefined) updateData.hourlyRate = req.body.hourlyRate != null ? String(req.body.hourlyRate) : null;
      if (req.body.dailyRate !== undefined) updateData.dailyRate = req.body.dailyRate != null ? String(req.body.dailyRate) : null;
      if (req.body.weeklyRate !== undefined) updateData.weeklyRate = req.body.weeklyRate != null ? String(req.body.weeklyRate) : null;
      if (req.body.estimatedCost !== undefined) updateData.estimatedCost = req.body.estimatedCost != null ? String(req.body.estimatedCost) : null;
      if (req.body.deliveryFee !== undefined) updateData.deliveryFee = req.body.deliveryFee != null ? String(req.body.deliveryFee) : null;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes || null;
      
      // SECURITY: Use same conditions in UPDATE to prevent TOCTOU race condition
      const [updated] = await db.update(bidEquipmentSelections)
        .set(updateData)
        .where(selectionConditions)
        .returning();
      
      await logUpdate(userId!, "bid_equipment_selections", selectionId, existing, req.body);
      
      res.json(updated);
    } catch (error) {
      console.error("Update bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete bid equipment selection
  app.delete("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      // Verify bid exists (consistent with other bid endpoints)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // SECURITY: Define conditions for both SELECT and DELETE to prevent TOCTOU
      const selectionConditions = and(
        eq(bidEquipmentSelections.id, selectionId),
        eq(bidEquipmentSelections.bidId, bidId)
      );
      
      const [existing] = await db.select()
        .from(bidEquipmentSelections)
        .where(selectionConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment selection not found" });
      }
      
      // SECURITY: Use same conditions in DELETE to prevent TOCTOU race condition
      await db.delete(bidEquipmentSelections).where(selectionConditions);
      
      await logDelete(userId!, "bid_equipment_selections", selectionId, { equipmentName: existing.equipmentName });
      
      res.json({ message: "Equipment selection deleted successfully" });
    } catch (error) {
      console.error("Delete bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get available equipment for bid selection (owned + rental catalog)
  app.get("/api/equipment-for-selection", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json({ owned: [], rental: [] });
      }
      
      // SECURITY: Filter owned equipment by org
      const equipConditions = [ne(equipment.status, "RETIRED")];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      // Get owned equipment with active rate profiles (exclude RETIRED status)
      const ownedEquipment = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          status: equipment.status,
          hourlyRate: equipmentRateProfiles.hourlyRate,
          dailyRate: equipmentRateProfiles.dailyRate,
          weeklyRate: equipmentRateProfiles.weeklyRate,
          monthlyRate: equipmentRateProfiles.monthlyRate,
        })
        .from(equipment)
        .leftJoin(equipmentRateProfiles, and(
          eq(equipmentRateProfiles.equipmentId, equipment.id),
          eq(equipmentRateProfiles.isActive, true)
        ))
        .where(and(...equipConditions))
        .orderBy(equipment.type, equipment.name);
      
      // SECURITY: Filter rental catalog by vendor's org
      const rentalConditions = [
        eq(rentalEquipmentCatalog.isActive, true),
        eq(rentalVendors.isActive, true)
      ];
      if (shouldFilter && orgId) {
        rentalConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      // Get rental equipment catalog (active items)
      const rentalCatalog = await db
        .select({
          id: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          vendorName: rentalVendors.name,
          vendorCode: rentalVendors.code,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(and(...rentalConditions))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json({
        owned: ownedEquipment,
        rental: rentalCatalog,
      });
    } catch (error) {
      console.error("Get equipment for selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  seedCoreTradeModifierCategories().catch(err => {
    console.error("Failed to seed core modifier categories:", err);
  });

  const httpServer = createServer(app);
  return httpServer;
}
