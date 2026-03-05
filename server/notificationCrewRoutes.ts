import { Router } from "express";
import { db } from "./db";
import {
  users, auditLog, billingEvents, notifications,
  crews, crewMembers, skills, userSkills, projects,
  insertCrewSchema, insertSkillSchema,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, desc, sql, and, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

// ====================
// Notifications Routes
// ====================

// Get user's notifications
router.get("/api/notifications", requireAuth, async (req: AuthRequest, res) => {
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
router.get("/api/notifications/unread-count", requireAuth, async (req: AuthRequest, res) => {
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
router.patch("/api/notifications/:id/read", requireAuth, async (req: AuthRequest, res) => {
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
router.post("/api/notifications/read-all", requireAuth, async (req: AuthRequest, res) => {
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
router.get("/api/projects/:projectId/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
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
router.post("/api/billing-events", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
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
router.get("/api/audit-logs", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res) => {
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
router.get("/api/audit-logs/:entityType/:entityId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
const objectStoragePromise = import("./objectStorage").then(m => ({
  ObjectStorageService: m.ObjectStorageService,
  ObjectNotFoundError: m.ObjectNotFoundError,
}));
const objectAclPromise = import("./objectAcl").then(m => ({
  ObjectPermission: m.ObjectPermission,
}));

// Get upload URL for object
router.post("/api/objects/upload", requireAuth, async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "User must belong to an organization to upload files" });
      return;
    }
    const { ObjectStorageService } = await objectStoragePromise;
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(organizationId);
    res.json({ uploadURL });
  } catch (error: any) {
    console.error("Get upload URL error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Download private object with ACL check
router.get("/objects/:objectPath(*)", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { ObjectStorageService, ObjectNotFoundError } = await objectStoragePromise;
    const { ObjectPermission } = await objectAclPromise;
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
    const { ObjectNotFoundError } = await objectStoragePromise;
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
router.get("/api/crews", requireAuth, async (req: AuthRequest, res) => {
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
router.post("/api/crews", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.patch("/api/crews/:id", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.delete("/api/crews/:id", requireRole("ADMIN"), async (req: AuthRequest, res) => {
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
router.get("/api/crews/:id/members", requireAuth, async (req: AuthRequest, res) => {
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
router.post("/api/crews/:id/members", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.delete("/api/crews/:id/members/:userId", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.get("/api/crew-assignments", requireAuth, async (req: AuthRequest, res) => {
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
router.post("/api/crew-assignments", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const { crewProjectAssignments, insertCrewProjectAssignmentSchema } = await import("@shared/schema");
    const { ne, or, isNull, lte, gte } = await import("drizzle-orm");
    
    const allowOverlap = req.body.allowOverlap === true;
    const bodyWithoutFlag = { ...req.body };
    delete bodyWithoutFlag.allowOverlap;

    const validated = insertCrewProjectAssignmentSchema.parse({
      ...bodyWithoutFlag,
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

    // BUSINESS VALIDATION: Check for overlapping date ranges with other assignments for the same crew
    if (validated.startDate || validated.endDate) {
      const otherAssignments = await db
        .select({
          assignment: crewProjectAssignments,
          project: {
            id: projects.id,
            name: projects.name,
            code: projects.code,
          },
        })
        .from(crewProjectAssignments)
        .leftJoin(projects, eq(crewProjectAssignments.projectId, projects.id))
        .where(
          and(
            eq(crewProjectAssignments.crewId, validated.crewId),
            ne(crewProjectAssignments.projectId, validated.projectId)
          )
        );

      const conflicts: Array<{
        assignmentId: string;
        projectId: string;
        projectName: string;
        projectCode: string | null;
        existingStart: string | null;
        existingEnd: string | null;
      }> = [];

      for (const other of otherAssignments) {
        const otherStart = other.assignment.startDate;
        const otherEnd = other.assignment.endDate;
        const newStart = validated.startDate;
        const newEnd = validated.endDate;

        const hasOverlap = (() => {
          if (!otherStart && !otherEnd) return true;
          if (!newStart && !newEnd) return true;
          if (newStart && !newEnd) {
            if (!otherEnd) return true;
            return newStart <= otherEnd;
          }
          if (!newStart && newEnd) {
            if (!otherStart) return true;
            return otherStart <= newEnd;
          }
          if (newStart && newEnd) {
            if (!otherStart && !otherEnd) return true;
            if (!otherStart) return newStart <= otherEnd!;
            if (!otherEnd) return otherStart <= newEnd;
            return newStart <= otherEnd && otherStart <= newEnd;
          }
          return false;
        })();

        if (hasOverlap) {
          conflicts.push({
            assignmentId: other.assignment.id,
            projectId: other.assignment.projectId,
            projectName: other.project?.name || "Unknown Project",
            projectCode: other.project?.code || null,
            existingStart: otherStart?.toISOString() || null,
            existingEnd: otherEnd?.toISOString() || null,
          });
        }
      }

      if (conflicts.length > 0 && !allowOverlap) {
        res.status(409).json({
          error: "Scheduling conflict detected",
          conflicts,
          message: `This crew has overlapping assignments with ${conflicts.length} other project(s). Set allowOverlap to true to force assignment.`,
        });
        return;
      }
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
router.delete("/api/crew-assignments/:id", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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
router.get("/api/skills", requireAuth, async (req: AuthRequest, res) => {
  try {
    const allSkills = await db.select().from(skills).orderBy(skills.category, skills.name);
    res.json(allSkills);
  } catch (error) {
    console.error("Error fetching skills:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create new skill (admin only)
router.post("/api/skills", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.post("/api/skills/generate", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.delete("/api/skills/:id", requireRole("ADMIN"), async (req: AuthRequest, res) => {
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
router.get("/api/users/:userId/skills", requireAuth, async (req: AuthRequest, res) => {
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
router.post("/api/users/:userId/skills", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
router.delete("/api/users/:userId/skills/:skillId", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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

export default router;
