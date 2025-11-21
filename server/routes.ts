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
import { eq, desc, sql, and, or, isNull } from "drizzle-orm";
import { z } from "zod";
import { authLimiter, sensitiveLimiter, apiLimiter } from "./rateLimiter";
import { logCreate, logUpdate, logDelete, logApprove, logReject, logAudit } from "./auditLogger";
import { validateFileExists, validateMimeType, validateFileSize } from "./fileValidation";
import { registerTimeClockRoutes } from "./timeClockRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import aiRoutes from "./aiRoutes";

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
      const validationResult = registerSchema.safeParse(req.body);
      
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
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Login
  app.post("/api/auth/login", authLimiter, async (req: AuthRequest, res) => {
    try {
      const validationResult = loginSchema.safeParse(req.body);
      
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
      res.status(500).json({ error: "Login failed" });
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
      res.status(500).json({ error: "Initialization failed" });
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
      res.status(500).json({ error: "Failed to fetch dashboard statistics" });
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
      res.status(500).json({ error: "Failed to fetch users" });
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
      res.status(500).json({ error: "Failed to fetch user" });
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
      const validationResult = createUserSchema.safeParse(req.body);
      
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
        res.status(500).json({ error: "Failed to create user" });
      }
    }
  });

  // Update user (Admin only)
  app.patch("/api/users/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateUserSchema.safeParse(req.body);
      
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
        res.status(500).json({ error: "Failed to update user" });
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
      res.status(500).json({ error: "Failed to update cost rates" });
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
      res.status(500).json({ error: "Failed to revoke tokens" });
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
      res.status(500).json({ error: "Failed to change password" });
    }
  });

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
      res.status(500).json({ error: "Failed to fetch bids" });
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
      res.status(500).json({ error: "Failed to fetch bid" });
    }
  });

  // Create bid (Admin/Manager only)
  app.post("/api/bids", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertBidSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newBid] = await db.insert(bids).values(validationResult.data).returning();
      res.status(201).json(newBid);
    } catch (error: any) {
      console.error("Create bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Bid code already exists" });
      } else {
        res.status(500).json({ error: "Failed to create bid" });
      }
    }
  });

  // Update bid schema
  const updateBidSchema = insertBidSchema.partial();

  // Update bid (Admin/Manager only)
  app.patch("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateBidSchema.safeParse(req.body);
      
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
      res.status(500).json({ error: "Failed to update bid" });
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
      res.status(500).json({ error: "Failed to delete bid" });
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

      res.status(201).json(newProject);
    } catch (error: any) {
      console.error("Convert bid error:", error);
      if (error.code === '23505') {
        res.status(409).json({ error: "Project with this code already exists" });
      } else {
        res.status(500).json({ error: "Failed to convert bid" });
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
      res.status(500).json({ error: "Failed to fetch bid quotes" });
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

      const validated = insertBidSubcontractorQuoteSchema.parse({
        ...req.body,
        bidId: bid.id,
      });

      const [newQuote] = await db.insert(bidSubcontractorQuotes).values(validated).returning();

      // Log audit
      await logAudit({
        userId: req.user!.id,
        action: "CREATE_BID_QUOTE",
        resourceType: "bid_quote",
        resourceId: newQuote.id,
        details: `Created quote from ${validated.subcontractorName} for bid ${bid.code}`,
      });

      res.status(201).json(newQuote);
    } catch (error: any) {
      console.error("Create bid quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create bid quote" });
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

      const validated = insertBidSubcontractorQuoteSchema.partial().parse(req.body);

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
        resourceType: "bid_quote",
        resourceId: updated.id,
        details: `Updated quote from ${updated.subcontractorName} for bid ${bid.code}`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Update bid quote error:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid quote data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to update bid quote" });
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
        resourceType: "bid_quote",
        resourceId: deleted.id,
        details: `Deleted quote from ${deleted.subcontractorName} for bid ${bid.code}`,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete bid quote error:", error);
      res.status(500).json({ error: "Failed to delete bid quote" });
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
      res.status(500).json({ error: "Failed to fetch projects" });
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
      res.status(500).json({ error: "Failed to fetch project" });
    }
  });

  // Create project (Admin/Manager only)
  app.post("/api/projects", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertProjectSchema.safeParse(req.body);
      
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
        res.status(500).json({ error: "Failed to create project" });
      }
    }
  });

  // Update project schema
  const updateProjectSchema = insertProjectSchema.partial();

  // Update project (Admin/Manager only)
  app.patch("/api/projects/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateProjectSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
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
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  // Update project financials (Admin only)
  app.patch("/api/projects/:code/financials", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { budget, contractAmount, texturaDrawDate, drawDayOfMonth } = req.body;

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
      res.status(500).json({ error: "Failed to update project financials" });
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
      res.status(500).json({ error: "Failed to fetch scope items" });
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

      const validationResult = insertScopeItemSchema.extend({
        projectId: z.string().optional(),
      }).safeParse({ ...req.body, projectId: project.id });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newScopeItem] = await db.insert(scopeItems).values(validationResult.data).returning();
      res.status(201).json(newScopeItem);
    } catch (error: any) {
      console.error("Create scope item error:", error);
      res.status(500).json({ error: "Failed to create scope item" });
    }
  });

  // Update scope item schema
  const updateScopeItemSchema = insertScopeItemSchema.omit({ projectId: true }).partial();

  // Update scope item (Admin/Manager/Superintendent only)
  app.patch("/api/scope-items/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateScopeItemSchema.safeParse(req.body);
      
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
      res.status(500).json({ error: "Failed to update scope item" });
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
      res.status(500).json({ error: "Failed to delete scope item" });
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
      res.status(500).json({ error: "Failed to fetch notes" });
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

      const validationResult = insertProjectNoteSchema.extend({
        projectId: z.string().optional(),
        authorId: z.string().optional(),
      }).safeParse({
        ...req.body,
        projectId: project.id,
        authorId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newNote] = await db.insert(projectNotes).values(validationResult.data).returning();
      res.status(201).json(newNote);
    } catch (error: any) {
      console.error("Create note error:", error);
      res.status(500).json({ error: "Failed to create note" });
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
      res.status(500).json({ error: "Failed to fetch media" });
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

      const validationResult = insertMediaSchema.extend({
        projectId: z.string().optional(),
        uploadedById: z.string().optional(),
      }).safeParse({
        ...req.body,
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

      const [newMedia] = await db.insert(media).values({
        ...validationResult.data,
        objectKey,
      }).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values({
        fileId: newMedia.id,
        fileType: "MEDIA",
        userId: req.user!.id,
        grantedById: req.user!.id,
      });

      res.status(201).json(newMedia);
    } catch (error: any) {
      console.error("Create media error:", error);
      res.status(500).json({ error: "Failed to create media" });
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
      res.status(500).json({ error: "Failed to delete media" });
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

      if (status) {
        conditions.push(eq(timeEntries.status, status as any));
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
      res.status(500).json({ error: "Failed to fetch time entries" });
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
      res.status(500).json({ error: "Failed to fetch time entries" });
    }
  });

  // Create time entry (All authenticated users)
  app.post("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      const validationResult = insertTimeEntrySchema.extend({
        userId: z.string().optional(),
        date: z.coerce.date(),
      }).safeParse({
        ...req.body,
        userId: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newEntry] = await db.insert(timeEntries).values(validationResult.data).returning();
      
      // Audit log
      await logCreate(req.user!.id, "TIME_ENTRY", newEntry.id, JSON.stringify(newEntry), req);
      
      res.status(201).json(newEntry);
    } catch (error: any) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  // Update time entry (with locking)
  app.patch("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        date: z.coerce.date().optional(),
        hoursRegular: z.string().optional(),
        hoursOvertime: z.string().optional(),
        costCode: z.string().optional(),
        notes: z.string().optional(),
        adminOverride: z.boolean().optional(),
      });

      const data = schema.parse(req.body);

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

      const [updatedEntry] = await db
        .update(timeEntries)
        .set(updates)
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      // Audit log
      await logUpdate(
        req.user!.id,
        "TIME_ENTRY",
        req.params.id,
        JSON.stringify(existingEntry),
        JSON.stringify({ ...updates, adminOverride: data.adminOverride }),
        req
      );

      res.json(updatedEntry);
    } catch (error) {
      console.error("Update time entry error:", error);
      res.status(500).json({ error: "Failed to update time entry" });
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

      await db.delete(timeEntries).where(eq(timeEntries.id, req.params.id));

      // Audit log
      await logDelete(req.user!.id, "TIME_ENTRY", req.params.id, JSON.stringify(existingEntry), req);

      res.status(204).send();
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ error: "Failed to delete time entry" });
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

      const [updatedEntry] = await db
        .update(timeEntries)
        .set({
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      // Audit log
      await logApprove(req.user!.id, "TIME_ENTRY", req.params.id, JSON.stringify({ approver: req.user!.email }), req);

      res.json(updatedEntry);
    } catch (error) {
      console.error("Approve time entry error:", error);
      res.status(500).json({ error: "Failed to approve time entry" });
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
      res.status(500).json({ error: "Failed to fetch T&M sheets" });
    }
  });

  // Create T&M daily sheet (Admin/Manager/Superintendent only)
  app.post("/api/tm-sheets", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertTMDailySheetSchema.extend({
        createdById: z.string().optional(),
        date: z.coerce.date(),
      }).safeParse({
        ...req.body,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newSheet] = await db.insert(tmDailySheets).values(validationResult.data).returning();
      res.status(201).json(newSheet);
    } catch (error: any) {
      console.error("Create T&M sheet error:", error);
      res.status(500).json({ error: "Failed to create T&M sheet" });
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
      res.status(500).json({ error: "Failed to fetch estimates" });
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

      const [newEstimate] = await db.insert(estimates).values(validationResult.data).returning();
      res.status(201).json(newEstimate);
    } catch (error: any) {
      console.error("Create estimate error:", error);
      res.status(500).json({ error: "Failed to create estimate" });
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
      res.status(500).json({ error: "Failed to fetch procurement items" });
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
      res.status(500).json({ error: "Failed to create procurement item" });
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
      res.status(500).json({ error: "Failed to update procurement item" });
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
      res.status(500).json({ error: "Failed to fetch receipts" });
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

      const [newReceipt] = await db.insert(receipts).values({
        ...validationResult.data,
        objectKey,
      }).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values({
        fileId: newReceipt.id,
        fileType: "RECEIPT",
        userId: req.user!.id,
        grantedById: req.user!.id,
      });

      res.status(201).json(newReceipt);
    } catch (error: any) {
      console.error("Create receipt error:", error);
      res.status(500).json({ error: "Failed to create receipt" });
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
      res.status(500).json({ error: "Failed to fetch documents" });
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

      const [newDoc] = await db.insert(planDocuments).values({
        ...validationResult.data,
        objectKey,
      }).returning();
      
      // Grant permission to uploader
      await db.insert(filePermissions).values({
        fileId: newDoc.id,
        fileType: "DOCUMENT",
        userId: req.user!.id,
        grantedById: req.user!.id,
      });

      res.status(201).json(newDoc);
    } catch (error: any) {
      console.error("Create document error:", error);
      res.status(500).json({ error: "Failed to create document" });
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
      res.status(500).json({ error: "Failed to get download URL" });
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

      const [newPermission] = await db
        .insert(filePermissions)
        .values(validationResult.data)
        .returning();
      
      res.status(201).json(newPermission);
    } catch (error: any) {
      console.error("Grant file permission error:", error);
      res.status(500).json({ error: "Failed to grant file permission" });
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
      res.status(500).json({ error: "Failed to revoke file permission" });
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
      res.status(500).json({ error: "Failed to fetch file permissions" });
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
      res.status(500).json({ error: "Failed to fetch user file permissions" });
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
      res.status(500).json({ error: "Failed to fetch change orders" });
    }
  });

  // Create change order (Admin/Manager/Superintendent)
  app.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertChangeOrderSchema.extend({
        requestedById: z.string().optional(),
      }).safeParse({
        ...req.body,
        requestedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newOrder] = await db.insert(changeOrders).values(validationResult.data).returning();
      
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
      res.status(500).json({ error: "Failed to create change order" });
    }
  });

  // Update change order schema
  const updateChangeOrderSchema = insertChangeOrderSchema.omit({ requestedById: true }).partial();

  // Update change order (Admin/Manager only)
  app.patch("/api/change-orders/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const validationResult = updateChangeOrderSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
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
      res.status(500).json({ error: "Failed to update change order" });
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
        query = query.where(sql`${sql.join(conditions, sql` AND `)}`);
      }
      
      const events = await query.orderBy(calendarEvents.startDate);

      res.json(events);
    } catch (error) {
      console.error("Get calendar events error:", error);
      res.status(500).json({ error: "Failed to fetch calendar events" });
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
      res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  // Create calendar event (All authenticated users)
  app.post("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const validationResult = insertCalendarEventSchema.extend({
        createdById: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
      }).safeParse({
        ...req.body,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newEvent] = await db.insert(calendarEvents).values(validationResult.data).returning();
      
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
      res.status(500).json({ error: "Failed to create calendar event" });
    }
  });

  // Approve time-off request (Admin/Manager only)
  app.post("/api/calendar/events/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
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
        await db.insert(notifications).values({
          userId: event.userId,
          type: "GENERAL",
          title: "Time Off Approved",
          message: `Your time off request has been approved: ${event.title}`,
          relatedEntityId: event.id,
          relatedEntityType: "calendarEvent",
        });
      }

      res.json(event);
    } catch (error: any) {
      console.error("Approve time-off error:", error);
      res.status(500).json({ error: "Failed to approve time-off request" });
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
      res.status(500).json({ error: "Failed to delete calendar event" });
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
      res.status(500).json({ error: "Failed to fetch notifications" });
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
      res.status(500).json({ error: "Failed to fetch unread count" });
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
      res.status(500).json({ error: "Failed to mark notification as read" });
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
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });

  // ====================
  // Billing Events Routes
  // ====================

  // Get billing events for a project
  app.get("/api/projects/:projectId/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const events = await db
        .select()
        .from(billingEvents)
        .where(eq(billingEvents.projectId, req.params.projectId))
        .orderBy(desc(billingEvents.eventDate));

      res.json(events);
    } catch (error) {
      console.error("Get billing events error:", error);
      res.status(500).json({ error: "Failed to fetch billing events" });
    }
  });

  // Create billing event
  app.post("/api/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        projectId: z.string(),
        eventType: z.enum(["INVOICE_SENT", "PAYMENT_RECEIVED", "CHANGE_ORDER_INVOICED", "RETENTION_RELEASED", "LIEN_WAIVER_RECEIVED"]),
        eventDate: z.coerce.date(),
        amount: z.string(),
        description: z.string().optional(),
        invoiceNumber: z.string().optional(),
        referenceId: z.string().optional(),
      });

      const data = schema.parse(req.body);

      const [newEvent] = await db.insert(billingEvents).values({
        ...data,
        createdById: req.user!.id,
      }).returning();

      // Audit log
      await logCreate(req.user!.id, "BILLING_EVENT", newEvent.id, JSON.stringify(newEvent), req);

      res.status(201).json(newEvent);
    } catch (error) {
      console.error("Create billing event error:", error);
      res.status(500).json({ error: "Failed to create billing event" });
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
        .orderBy(desc(auditLog.timestamp))
        .limit(pageSizeNum)
        .offset(offset);

      res.json(logs);
    } catch (error) {
      console.error("Get audit logs error:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
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
        .orderBy(desc(auditLog.timestamp))
        .limit(100);

      res.json(logs);
    } catch (error) {
      console.error("Get entity audit logs error:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
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
      res.status(500).json({ error: "Failed to get upload URL" });
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
      res.status(500).json({ error: "Failed to download object" });
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

      // Get member counts for each crew
      const crewsWithCounts = await Promise.all(
        allCrews.map(async ({ crew, lead }) => {
          const [memberCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(crewMembers)
            .where(eq(crewMembers.crewId, crew.id));
          
          return {
            ...crew,
            lead: lead.id ? lead : null,
            memberCount: Number(memberCount?.count || 0),
          };
        })
      );

      res.json(crewsWithCounts);
    } catch (error) {
      console.error("Error fetching crews:", error);
      res.status(500).json({ error: "Failed to fetch crews" });
    }
  });

  // Create new crew (admin only)
  app.post("/api/crews", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertCrewSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newCrew] = await db.insert(crews).values(validationResult.data).returning();
      
      await logCreate(req.user!.id, "crews", newCrew.id, {
        name: newCrew.name,
        leadId: newCrew.leadId,
      });

      res.status(201).json(newCrew);
    } catch (error) {
      console.error("Error creating crew:", error);
      res.status(500).json({ error: "Failed to create crew" });
    }
  });

  // Update crew (admin only)
  app.patch("/api/crews/:id", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const updateData = insertCrewSchema.partial().safeParse(req.body);

      if (!updateData.success) {
        res.status(400).json({ error: "Invalid input", details: updateData.error.errors });
        return;
      }

      const [updated] = await db
        .update(crews)
        .set({ ...updateData.data, updatedAt: new Date() })
        .where(eq(crews.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Crew not found" });
        return;
      }

      await logUpdate(req.user!.id, "crews", id, updateData.data);

      res.json(updated);
    } catch (error) {
      console.error("Error updating crew:", error);
      res.status(500).json({ error: "Failed to update crew" });
    }
  });

  // Delete crew (admin only)
  app.delete("/api/crews/:id", requireRole(["ADMIN"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const [deleted] = await db.delete(crews).where(eq(crews.id, id)).returning();

      if (!deleted) {
        res.status(404).json({ error: "Crew not found" });
        return;
      }

      await logDelete(req.user!.id, "crews", id, { name: deleted.name });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting crew:", error);
      res.status(500).json({ error: "Failed to delete crew" });
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
      res.status(500).json({ error: "Failed to fetch crew members" });
    }
  });

  // Add member to crew (admin only)
  app.post("/api/crews/:id/members", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { userId, role } = req.body;

      if (!userId) {
        res.status(400).json({ error: "userId is required" });
        return;
      }

      // Check if member already exists
      const [existing] = await db
        .select()
        .from(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
        .limit(1);

      if (existing) {
        res.status(400).json({ error: "User is already a member of this crew" });
        return;
      }

      const [newMember] = await db
        .insert(crewMembers)
        .values({ crewId: id, userId, role })
        .returning();

      await logCreate(req.user!.id, "crew_members", newMember.id, {
        crewId: id,
        userId,
        role,
      });

      res.status(201).json(newMember);
    } catch (error) {
      console.error("Error adding crew member:", error);
      res.status(500).json({ error: "Failed to add crew member" });
    }
  });

  // Remove member from crew (admin only)
  app.delete("/api/crews/:id/members/:userId", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { id, userId } = req.params;

      const [deleted] = await db
        .delete(crewMembers)
        .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Crew member not found" });
        return;
      }

      await logDelete(req.user!.id, "crew_members", deleted.id, {
        crewId: id,
        userId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing crew member:", error);
      res.status(500).json({ error: "Failed to remove crew member" });
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
      res.status(500).json({ error: "Failed to fetch crew assignments" });
    }
  });

  // Assign crew to project
  app.post("/api/crew-assignments", requireRole(["ADMIN", "MANAGER", "SUPERINTENDENT"]), async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments, insertCrewProjectAssignmentSchema } = await import("@shared/schema");
      
      const validated = insertCrewProjectAssignmentSchema.parse({
        ...req.body,
        assignedById: req.user!.id,
      });

      const [assignment] = await db.insert(crewProjectAssignments).values(validated).returning();

      await logCreate(req.user!.id, "crew_project_assignments", assignment.id, {
        crewId: assignment.crewId,
        projectId: assignment.projectId,
      });

      res.status(201).json(assignment);
    } catch (error: any) {
      console.error("Error creating crew assignment:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create crew assignment" });
      }
    }
  });

  // Remove crew from project
  app.delete("/api/crew-assignments/:id", requireRole(["ADMIN", "MANAGER", "SUPERINTENDENT"]), async (req: AuthRequest, res) => {
    try {
      const { crewProjectAssignments } = await import("@shared/schema");
      const { id } = req.params;

      const [deleted] = await db
        .delete(crewProjectAssignments)
        .where(eq(crewProjectAssignments.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }

      await logDelete(req.user!.id, "crew_project_assignments", id, {
        crewId: deleted.crewId,
        projectId: deleted.projectId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing crew assignment:", error);
      res.status(500).json({ error: "Failed to remove crew assignment" });
    }
  });

  // Get all skills
  app.get("/api/skills", requireAuth, async (req: AuthRequest, res) => {
    try {
      const allSkills = await db.select().from(skills).orderBy(skills.category, skills.name);
      res.json(allSkills);
    } catch (error) {
      console.error("Error fetching skills:", error);
      res.status(500).json({ error: "Failed to fetch skills" });
    }
  });

  // Create new skill (admin only)
  app.post("/api/skills", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const validationResult = insertSkillSchema.safeParse(req.body);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      const [newSkill] = await db.insert(skills).values(validationResult.data).returning();
      
      await logCreate(req.user!.id, "skills", newSkill.id, {
        name: newSkill.name,
        category: newSkill.category,
      });

      res.status(201).json(newSkill);
    } catch (error: any) {
      console.error("Error creating skill:", error);
      if (error.constraint === "skills_name_unique") {
        res.status(400).json({ error: "A skill with this name already exists" });
        return;
      }
      res.status(500).json({ error: "Failed to create skill" });
    }
  });

  // Delete skill (admin only)
  app.delete("/api/skills/:id", requireRole(["ADMIN"]), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const [deleted] = await db.delete(skills).where(eq(skills.id, id)).returning();

      if (!deleted) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }

      await logDelete(req.user!.id, "skills", id, { name: deleted.name });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting skill:", error);
      res.status(500).json({ error: "Failed to delete skill" });
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
      res.status(500).json({ error: "Failed to fetch user skills" });
    }
  });

  // Assign skill to user (admin only)
  app.post("/api/users/:userId/skills", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
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

      const [newUserSkill] = await db
        .insert(userSkills)
        .values({ userId, skillId, proficiencyLevel, yearsExperience })
        .returning();

      await logCreate(req.user!.id, "user_skills", newUserSkill.id, {
        userId,
        skillId,
        proficiencyLevel,
      });

      res.status(201).json(newUserSkill);
    } catch (error) {
      console.error("Error assigning skill:", error);
      res.status(500).json({ error: "Failed to assign skill" });
    }
  });

  // Remove skill from user (admin only)
  app.delete("/api/users/:userId/skills/:skillId", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
    try {
      const { userId, skillId } = req.params;

      const [deleted] = await db
        .delete(userSkills)
        .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "User skill not found" });
        return;
      }

      await logDelete(req.user!.id, "user_skills", deleted.id, {
        userId,
        skillId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing skill:", error);
      res.status(500).json({ error: "Failed to remove skill" });
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
      res.status(500).json({ error: "Failed to fetch subcontractor contracts" });
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
      res.status(500).json({ error: "Failed to fetch payments" });
    }
  });

  // ====================
  // Subcontractor Payables Routes
  // ====================

  // Get all subcontractor payables (for CFO/Office Manager dashboard)
  app.get("/api/subcontractor-payables", requireRole(["ADMIN", "MANAGER"]), async (req: AuthRequest, res) => {
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
      res.status(500).json({ error: "Failed to fetch subcontractor payables" });
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
      res.status(500).json({ error: "Failed to fetch data quality score" });
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
      res.status(500).json({ error: "Failed to fetch takeoff sheets" });
    }
  });

  // Get presigned URL for a takeoff sheet's PDF
  app.get("/api/takeoff/sheets/:sheetId/pdf-url", requireAuth, async (req: AuthRequest, res) => {
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

      // If document exists and has objectKey, generate presigned URL
      if (document?.objectKey) {
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
          return;
        } catch (error: any) {
          console.error("Error generating presigned URL from objectKey:", error);
          
          // If object not found, return 404 instead of 500
          if (error.name === 'ObjectNotFoundError' || error.message?.includes('not found')) {
            res.status(404).json({ error: "PDF file no longer exists. Please re-upload the document." });
            return;
          }
          
          res.status(500).json({ error: "Failed to generate secure PDF URL" });
          return;
        }
      }

      // No valid document/objectKey available - cannot serve PDF securely
      res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
    } catch (error: any) {
      console.error("Get sheet PDF URL error:", error);
      res.status(500).json({ error: "Failed to get PDF URL" });
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

      // Check if this document is already imported
      const [existingPlan] = await db
        .select()
        .from(takeoffSheets)
        .where(and(
          eq(takeoffSheets.projectId, projectId),
          eq(takeoffSheets.sheetName, document.title)
        ))
        .limit(1);

      if (existingPlan) {
        res.status(400).json({ error: "This document is already imported to takeoff workspace" });
        return;
      }

      // Create project plan record
      const [plan] = await db.insert(projectPlans).values({
        projectId,
        documentId: documentId,
        originalPdfUrl: document.fileUrl,
        fileName: document.fileName,
      }).returning();

      // Create takeoff sheet (single sheet for now - PDF processing would create multiple)
      const [sheet] = await db.insert(takeoffSheets).values({
        projectId,
        planId: plan.id,
        imageUrl: document.fileUrl,
        sheetIndex: 0,
        sheetName: document.title,
      }).returning();

      await logCreate(req.user!.id, "project_plans", plan.id, {
        projectId,
        fileName: document.fileName,
        documentId,
      });

      res.status(201).json({ plan, sheet });
    } catch (error) {
      console.error("Error importing plan to takeoff:", error);
      res.status(500).json({ error: "Failed to import plan to takeoff" });
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

      // Create project plan record
      const [plan] = await db.insert(projectPlans).values({
        projectId,
        originalPdfUrl: fileUrl,
        fileName,
      }).returning();

      // TODO: In a production system, you would use a PDF processing service here
      // For now, we'll create a single sheet placeholder
      // The frontend will handle PDF rendering with pdf.js
      const [sheet] = await db.insert(takeoffSheets).values({
        projectId,
        planId: plan.id,
        imageUrl: fileUrl, // Using PDF URL as placeholder
        sheetIndex: 0,
        sheetName: fileName,
      }).returning();

      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        resourceType: "project_plan",
        resourceId: plan.id,
        details: `Uploaded plan: ${fileName}`,
      });

      res.status(201).json({ plan, sheets: [sheet] });
    } catch (error) {
      console.error("Error uploading plan:", error);
      res.status(500).json({ error: "Failed to upload plan" });
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

      res.json(measurements);
    } catch (error) {
      console.error("Error fetching measurements:", error);
      res.status(500).json({ error: "Failed to fetch measurements" });
    }
  });

  // Create a new measurement
  app.post("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      const validated = insertTakeoffMeasurementSchema.parse({
        ...req.body,
        sheetId,
      });

      const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();

      res.status(201).json(measurement);
    } catch (error: any) {
      console.error("Error creating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create measurement" });
      }
    }
  });

  // Update a measurement
  app.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      const validated = insertTakeoffMeasurementSchema.partial().parse(req.body);

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
        res.status(500).json({ error: "Failed to update measurement" });
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
      res.status(500).json({ error: "Failed to delete measurement" });
    }
  });

  // Update sheet calibration
  app.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { scalePxPerFoot, units } = req.body;
      const { takeoffSheets } = await import("@shared/schema");

      if (!scalePxPerFoot) {
        res.status(400).json({ error: "Scale is required" });
        return;
      }

      const [updated] = await db
        .update(takeoffSheets)
        .set({ 
          scalePxPerFoot, 
          units: units || "ft",
          updatedAt: new Date() 
        })
        .where(eq(takeoffSheets.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Sheet not found" });
        return;
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating calibration:", error);
      res.status(500).json({ error: "Failed to update calibration" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
