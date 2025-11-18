import type { Express } from "express";
import { createServer, type Server } from "http";
import { db } from "./db";
import { users, insertUserSchema, type InsertUser, type SelectUser } from "@shared/schema";
import { 
  projects, bids, estimates, procurementItems, planDocuments,
  timeEntries, tmDailySheets, receipts, projectNotes, scopeItems, media,
  changeOrders, calendarEvents, notifications,
  insertProjectSchema, insertBidSchema, insertEstimateSchema,
  insertProcurementItemSchema, insertPlanDocumentSchema, insertTimeEntrySchema,
  insertTMDailySheetSchema, insertReceiptSchema, insertProjectNoteSchema,
  insertScopeItemSchema, insertMediaSchema, insertChangeOrderSchema,
  insertCalendarEventSchema, insertNotificationSchema
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
  type AuthRequest 
} from "./auth";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply auth middleware to all routes
  app.use(authMiddleware);

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
    password: z.string().min(6, "Password must be at least 6 characters"),
  });

  // Register new user
  app.post("/api/auth/register", async (req: AuthRequest, res) => {
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
  app.post("/api/auth/login", async (req: AuthRequest, res) => {
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

      const token = generateToken(user.id);
      setAuthCookie(res, token);

      const { passwordHash, ...userWithoutPassword } = user;
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
  app.get("/api/dashboard/stats", requireAuth, async (req: AuthRequest, res) => {
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

      const { passwordHash, ...userWithoutPassword } = updatedUser;
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
  // Project Routes
  // ====================

  const { insertProjectSchema, scopeItems, insertScopeItemSchema } = await import("@shared/schema");
  const { desc, inArray, sql } = await import("drizzle-orm");

  // Get all projects
  app.get("/api/projects", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Get all projects
      const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt));
      
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
        
      res.json(projectsWithNames);
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

      const projectMedia = await db
        .select()
        .from(media)
        .where(eq(media.projectId, project.id))
        .orderBy(desc(media.uploadedAt));

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

      const [newMedia] = await db.insert(media).values(validationResult.data).returning();
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

  // Get time entries (filtered by role)
  app.get("/api/time-entries", requireAuth, async (req: AuthRequest, res) => {
    try {
      let entries;
      
      if (req.user!.role === "HOURLY_EMPLOYEE") {
        // Hourly employees only see their own entries
        entries = await db
          .select()
          .from(timeEntries)
          .where(eq(timeEntries.userId, req.user!.id))
          .orderBy(desc(timeEntries.date));
      } else {
        // Managers and admins see all entries
        entries = await db.select().from(timeEntries).orderBy(desc(timeEntries.date));
      }

      res.json(entries);
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
      res.status(201).json(newEntry);
    } catch (error: any) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  // Approve time entry (Admin/Manager only)
  app.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [updatedEntry] = await db
        .update(timeEntries)
        .set({
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timeEntries.id, req.params.id))
        .returning();

      if (!updatedEntry) {
        res.status(404).json({ error: "Time entry not found" });
        return;
      }

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

      const projectReceipts = await db
        .select()
        .from(receipts)
        .where(eq(receipts.projectId, project.id))
        .orderBy(desc(receipts.date));

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

      const [newReceipt] = await db.insert(receipts).values(validationResult.data).returning();
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

      const docs = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.projectId, project.id))
        .orderBy(desc(planDocuments.uploadedAt));

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

      const [newDoc] = await db.insert(planDocuments).values(validationResult.data).returning();
      res.status(201).json(newDoc);
    } catch (error: any) {
      console.error("Create document error:", error);
      res.status(500).json({ error: "Failed to create document" });
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

  // Approve change order (Admin/Manager only)
  app.post("/api/change-orders/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const [order] = await db
        .update(changeOrders)
        .set({
          status: "APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      if (!order) {
        res.status(404).json({ error: "Change order not found" });
        return;
      }

      // Notify requester
      await db.insert(notifications).values({
        userId: order.requestedById,
        type: "GENERAL",
        title: "Change Order Approved",
        message: `Change order ${order.changeOrderNumber} has been approved`,
        relatedEntityId: order.id,
        relatedEntityType: "changeOrder",
      });

      res.json(order);
    } catch (error: any) {
      console.error("Approve change order error:", error);
      res.status(500).json({ error: "Failed to approve change order" });
    }
  });

  // Reject change order (Admin/Manager only)
  app.post("/api/change-orders/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { rejectionReason } = req.body;

      const [order] = await db
        .update(changeOrders)
        .set({
          status: "REJECTED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
          rejectionReason,
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      if (!order) {
        res.status(404).json({ error: "Change order not found" });
        return;
      }

      // Notify requester
      await db.insert(notifications).values({
        userId: order.requestedById,
        type: "GENERAL",
        title: "Change Order Rejected",
        message: `Change order ${order.changeOrderNumber} has been rejected: ${rejectionReason || 'No reason provided'}`,
        relatedEntityId: order.id,
        relatedEntityType: "changeOrder",
      });

      res.json(order);
    } catch (error: any) {
      console.error("Reject change order error:", error);
      res.status(500).json({ error: "Failed to reject change order" });
    }
  });

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
      // Convert date strings to Date objects
      const payload = {
        ...req.body,
        createdById: req.user!.id,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      };
      
      const validationResult = insertCalendarEventSchema.extend({
        createdById: z.string().optional(),
      }).safeParse(payload);
      
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

  const httpServer = createServer(app);
  return httpServer;
}
