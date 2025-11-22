import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { users, insertUserSchema, type InsertUser, type SelectUser, auditLog, billingEvents, timeClockShifts } from "@shared/schema";
import { 
  projects, bids, estimates, procurementItems, planDocuments,
  timeEntries, tmDailySheets, receipts, projectNotes, scopeItems, media,
  changeOrders, calendarEvents, notifications, filePermissions,
  insertProjectSchema, insertBidSchema, insertEstimateSchema,
  insertProcurementItemSchema, insertPlanDocumentSchema, insertTimeEntrySchema,
  insertTMDailySheetSchema, insertReceiptSchema, insertProjectNoteSchema,
  insertScopeItemSchema, insertMediaSchema, insertChangeOrderSchema,
  insertCalendarEventSchema, insertNotificationSchema, insertFilePermissionSchema,
  crews, crewMembers, skills, userSkills, equipment,
  insertCrewSchema, insertCrewMemberSchema, insertSkillSchema, insertUserSkillSchema,
  subcontractors, subcontractorContracts, subcontractorPayments
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
import { eq, desc, sql, and, or, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { authLimiter, sensitiveLimiter, apiLimiter } from "./rateLimiter";
import { logCreate, logUpdate, logDelete, logApprove, logReject, logAudit } from "./auditLogger";
import { validateFileExists, validateMimeType, validateFileSize } from "./fileValidation";
import { sanitizeShortText, sanitizeText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { registerTimeClockRoutes } from "./timeClockRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import aiRoutes from "./aiRoutes";
import notesRoutes from "./notesRoutes";

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply auth middleware to all routes
  app.use(authMiddleware);

  // Apply general API rate limiter to all API routes BEFORE registering any routes
  app.use("/api", apiLimiter);

  // Register time-clock routes (now protected by rate limiter)
  registerTimeClockRoutes(app);

  // Register change order state machine routes
  app.use("/api/change-orders", changeOrderRoutes);

  // Register AI PM + CFO routes
  app.use("/api", aiRoutes);

  // Register daily notes routes
  app.use("/api", notesRoutes);

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

      // Create new user (inactive by default, awaiting admin approval)
      const passwordHash = await hashPassword(password);
      
      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone,
        role: "HOURLY_EMPLOYEE", // Default role
        isActive: false, // Requires admin activation
        passwordHash,
      }).returning();

      const { passwordHash: _, ...userWithoutPassword } = newUser;
      res.status(201).json({
        user: userWithoutPassword,
        message: "Registration successful. Your account is pending admin approval."
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

  // Get current user
  app.get("/api/auth/me", requireAuth, (req: AuthRequest, res) => {
    res.json({ user: req.user });
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

  // ====================
  // Dashboard Routes
  // ====================

  // Get dashboard statistics
  app.get("/api/dashboard/stats", requireAuth, sensitiveLimiter, async (req: AuthRequest, res) => {
    try {
      // Count active projects
      const activeProjectsResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.status, "ACTIVE"));
      const activeProjectsCount = activeProjectsResult[0]?.count || 0;

      // Count pending change orders
      const pendingChangeOrdersResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(changeOrders)
        .where(eq(changeOrders.status, "PENDING_APPROVAL"));
      const pendingChangeOrdersCount = pendingChangeOrdersResult[0]?.count || 0;

      // Count pending time-off requests
      // Use dual check for robustness: eventType = TIME_OFF_REQUEST AND approvedById IS NULL
      // This ensures we only count truly pending requests that haven't been processed
      const pendingTimeOffResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(calendarEvents)
        .where(sql`${calendarEvents.eventType} = 'TIME_OFF_REQUEST' AND ${calendarEvents.approvedById} IS NULL`);
      const pendingTimeOffCount = pendingTimeOffResult[0]?.count || 0;

      res.json({
        activeProjectsCount,
        pendingChangeOrdersCount,
        pendingTimeOffCount,
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // User Management Routes
  // ====================

  // Get all users (Admin/Manager only)
  app.get("/api/users", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const allUsers = await db.select().from(users);
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

      const [newUser] = await db.insert(users).values({
        firstName,
        lastName,
        email,
        phone: phone || null,
        role: role || "HOURLY_EMPLOYEE",
        isActive: true,
        passwordHash,
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

  // Get all bids
  app.get("/api/bids", requireAuth, async (req: AuthRequest, res) => {
    try {
      const allBids = await db.select().from(bids).orderBy(bids.createdAt);
      res.json(allBids);
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

      res.json(bid);
    } catch (error) {
      console.error("Get bid error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create bid (Admin/Manager only)
  app.post("/api/bids", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        clientName: sanitizeShortText(req.body.clientName),
        description: sanitizeText(req.body.description),
      };

      const validationResult = insertBidSchema.safeParse(sanitizedBody);
      
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

      const [newBid] = await db.insert(bids).values(validationResult.data).returning();
      res.status(201).json(newBid);
    } catch (error: any) {
      console.error("Create bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Bid code already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update bid schema
  const updateBidSchema = insertBidSchema.partial();

  // Update bid (Admin/Manager only)
  app.patch("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
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

      res.json(updatedBid);
    } catch (error: any) {
      console.error("Update bid error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete bid (Admin only)
  app.delete("/api/bids/:code", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const [deletedBid] = await db
        .delete(bids)
        .where(eq(bids.code, req.params.code))
        .returning();

      if (!deletedBid) {
        res.status(404).json({ error: "Bid not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete bid error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Convert bid to project (Admin/Manager only)
  app.post("/api/bids/:code/convert", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
      
      if (!bid) {
        res.status(404).json({ error: "Bid not found" });
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
          details: `A project with code ${bid.code} already exists. Cannot convert bid.`
        });
        return;
      }

      // NOTE: Neon HTTP driver doesn't support transactions in serverless environments
      // Sequential operations with error handling (not atomic)
      
      // Create project from bid data
      const [newProject] = await db.insert(projects).values({
        name: bid.name,
        code: bid.code,
        clientName: bid.clientName,
        clientContactName: bid.clientContactName,
        clientContactEmail: bid.clientContactEmail,
        clientContactPhone: bid.clientContactPhone,
        status: "PLANNING",
        locationAddress: bid.locationAddress,
        city: bid.city,
        state: bid.state,
        description: bid.description,
        estimatorId: bid.estimatorId,
        contractAmount: bid.bidAmount,
        budget: bid.bidAmount,
      }).returning();

      // Delete the bid after converting
      await db.delete(bids).where(eq(bids.code, req.params.code));

      // Log audit (best effort)
      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "project",
        entityId: newProject.id,
        newValue: `Converted bid ${bid.code} to project`,
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

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        subcontractorName: req.body.subcontractorName ? sanitizeShortText(req.body.subcontractorName) : undefined,
        scopeOfWork: req.body.scopeOfWork ? sanitizeText(req.body.scopeOfWork) : undefined,
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
        contactName: req.body.contactName ? sanitizeShortText(req.body.contactName) : undefined,
        contactEmail: req.body.contactEmail ? sanitizeEmail(req.body.contactEmail) : undefined,
        contactPhone: req.body.contactPhone ? sanitizePhone(req.body.contactPhone) : undefined,
      };

      const validated = insertBidSubcontractorQuoteSchema.partial().parse(sanitizedBody);

      const [updated] = await db
        .update(bidSubcontractorQuotes)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

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

      const [deleted] = await db
        .delete(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Quote not found" });
        return;
      }

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
  // Project Routes
  // ====================

  const { insertProjectSchema, scopeItems, insertScopeItemSchema } = await import("@shared/schema");
  const { desc, inArray, sql } = await import("drizzle-orm");

  // Get all projects with pagination
  app.get("/api/projects", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { page = "1", limit = "50", status } = req.query;
      
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

      // Build query with optional status filter
      let query = db.select().from(projects);
      if (status) {
        query = query.where(eq(projects.status, status as any)) as any;
      }

      // Get total count
      const totalResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(status ? eq(projects.status, status as any) : sql`true`);
      const totalCount = totalResult[0]?.count || 0;

      // Get paginated projects
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

  // Get project by code with scope items
  app.get("/api/projects/:code", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

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

  // Create project (Admin/Manager only)
  app.post("/api/projects", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        projectCode: sanitizeShortText(req.body.projectCode),
        description: sanitizeText(req.body.description),
        clientName: sanitizeShortText(req.body.clientName),
        location: sanitizeText(req.body.location),
      };

      const validationResult = insertProjectSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newProject] = await db.insert(projects).values(validationResult.data).returning();
      res.status(201).json(newProject);
    } catch (error: any) {
      console.error("Create project error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Project code already exists" });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update project schema
  const updateProjectSchema = insertProjectSchema.partial();

  // Update project (Admin/Manager only)
  app.patch("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
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
        const [currentProject] = await db
          .select()
          .from(projects)
          .where(eq(projects.code, req.params.code))
          .limit(1);

        if (!currentProject) {
          res.status(404).json({ error: "Project not found" });
          return;
        }

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

  // Get scope items for a project
  app.get("/api/projects/:code/scope", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const items = await db.select().from(scopeItems).where(eq(scopeItems.projectId, project.id));
      res.json(items);
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
        const admins = await db
          .select()
          .from(users)
          .where(eq(users.role, "ADMIN"));
        
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

  // Delete scope item (Admin/Manager only)
  app.delete("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [deletedItem] = await db
        .delete(scopeItems)
        .where(eq(scopeItems.id, req.params.id))
        .returning();

      if (!deletedItem) {
        res.status(404).json({ error: "Scope item not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete scope item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============================
  // Daily Scope Progress Routes
  // =============================

  const { dailyScopeProgress, insertDailyScopeProgressSchema } = await import("@shared/schema");

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

      await db
        .update(scopeItems)
        .set({
          completedQuantity: totalCompleted.toString(),
          billedQuantity: totalBilled.toString(),
          updatedAt: new Date(),
        })
        .where(eq(scopeItems.id, req.params.scopeItemId));

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

      await db
        .update(scopeItems)
        .set({
          completedQuantity: totalCompleted.toString(),
          billedQuantity: totalBilled.toString(),
          updatedAt: new Date(),
        })
        .where(eq(scopeItems.id, existingProgress.scopeItemId));

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

      await db
        .update(scopeItems)
        .set({
          completedQuantity: totalCompleted.toString(),
          billedQuantity: totalBilled.toString(),
          updatedAt: new Date(),
        })
        .where(eq(scopeItems.id, existingProgress.scopeItemId));

      res.json({ success: true });
    } catch (error) {
      console.error("Delete daily progress error:", error);
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

  // Get T&M sheets for a project
  app.get("/api/projects/:code/tm-sheets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const sheets = await db
        .select()
        .from(tmDailySheets)
        .where(eq(tmDailySheets.projectId, project.id))
        .orderBy(desc(tmDailySheets.date));

      res.json(sheets);
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

  // Get estimates for a project
  app.get("/api/projects/:code/estimates", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

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
      const validationResult = insertReceiptSchema.extend({
        userId: z.string().optional(),
      }).safeParse({
        ...req.body,
        userId: req.user!.id,
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

  // Create change order (Admin/Manager/Superintendent)
  app.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, requestedById: req.user!.id };
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
  // Calendar Events Routes
  // ====================

  // Get all calendar events
  app.get("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, eventType } = req.query;
      
      let query = db.select().from(calendarEvents);
      
      const conditions = [];
      if (startDate) {
        conditions.push(sql`${calendarEvents.startDate} >= ${startDate as string}`);
      }
      if (endDate) {
        conditions.push(sql`${calendarEvents.endDate} <= ${endDate as string}`);
      }
      if (eventType) {
        conditions.push(eq(calendarEvents.eventType, eventType as any));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const events = await query.orderBy(calendarEvents.startDate);

      res.json(events);
    } catch (error) {
      console.error("Get calendar events error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get user's calendar events
  app.get("/api/calendar/my-events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const events = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.userId, req.user!.id))
        .orderBy(calendarEvents.startDate);

      res.json(events);
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
  // NOTE: This endpoint is currently disabled due to schema mismatch.
  // The billingEvents table expects: scopeItemId, quantity, unitPrice, totalAmount, billedDate
  // But this endpoint was designed for: projectId, eventType, eventDate, amount, description
  // TODO: Either redesign this endpoint to match the actual schema, or update the schema to support this use case
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

      let query = db.select().from(auditLog);

      const conditions = [];
      if (entityType) conditions.push(eq(auditLog.entityType, entityType as string));
      if (entityId) conditions.push(eq(auditLog.entityId, entityId as string));
      if (userId) conditions.push(eq(auditLog.userId, userId as string));
      if (action) conditions.push(eq(auditLog.action, action as any));

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
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
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
      const allCrews = await db
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
      const { userId, role } = req.body;

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

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "crew_members", newMember.id, {
        crewId: id,
        userId,
        role,
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

  // Get data quality score for a project
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

      // Import the data quality scorer
      const { calculateProjectDataQuality } = await import("./ai/dataQualityScorer");

      // Calculate data quality score
      const qualityScore = await calculateProjectDataQuality(code);

      res.json(qualityScore);
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
      const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

      const [updated] = await db
        .update(takeoffMeasurements)
        .set({ ...validated, updatedAt: new Date() })
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
      const { takeoffSheets, projects, crewProjectAssignments, crewMembers } = await import("@shared/schema");

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

  const httpServer = createServer(app);
  return httpServer;
}
