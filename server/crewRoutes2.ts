/**
 * @openapi
 * /api/crews:
 *   get:
 *     tags: [Workforce]
 *     summary: List crews
 *     description: Returns all crews for the organization.
 *     responses:
 *       200: { description: List of crews }
 *   post:
 *     tags: [Workforce]
 *     summary: Create a crew
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertCrew'
 *     responses:
 *       201: { description: Crew created }
 * /api/crews/{id}:
 *   get:
 *     tags: [Workforce]
 *     summary: Get crew details
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Crew details with members }
 *       404: { description: Crew not found }
 *   patch:
 *     tags: [Workforce]
 *     summary: Update a crew
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Crew updated }
 *   delete:
 *     tags: [Workforce]
 *     summary: Delete a crew
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Crew deleted }
 * /api/crews/{id}/members:
 *   get:
 *     tags: [Workforce]
 *     summary: Get crew members
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of crew members }
 *   post:
 *     tags: [Workforce]
 *     summary: Add member to crew
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string, format: uuid }
 *               role: { type: string }
 *     responses:
 *       201: { description: Member added }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import {
  users, crews, crewMembers, userSkills, projects,
  insertCrewSchema, conversations, conversationParticipants,
} from "@shared/schema";
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { eq, desc, sql, and, ne, inArray } from "drizzle-orm";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";

const router = Router();

router.use("/api/crews", requireAuth, requireFeaturePermission('canManageScheduling'));
router.use("/api/crew-assignments", requireAuth, requireFeaturePermission('canManageScheduling'));
router.use("/api/dispatch", requireAuth, requireFeaturePermission('canManageScheduling'));

router.get("/api/crews", async (req: AuthRequest, res) => {
  try {
    const { getOrgIdForFilter } = await import("./orgFilter");
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    let allCrews;
    if (shouldFilter && orgId) {
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
    logError("Error fetching crews:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crews", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      name: sanitizeShortText(req.body.name),
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
      organizationId: req.user!.organizationId,
    };

    const validationResult = insertCrewSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newCrew] = await db.insert(crews).values(validationResult.data).returning();
    
    await logCreate(req.user!.id, "crews", newCrew.id, {
      name: newCrew.name,
      leadId: newCrew.leadId,
    }, req);

    // Auto-create a crew channel and add all current crew members
    if (newCrew.organizationId) {
      try {
        const slug = `crew-${newCrew.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40)}`;
        const [channel] = await db.insert(conversations).values({
          type: "GROUP",
          name: `${newCrew.name} Crew`,
          description: `Team channel for ${newCrew.name}`,
          channelSlug: slug,
          crewId: newCrew.id,
          organizationId: newCrew.organizationId,
          createdById: req.user!.id,
        }).returning();
        // Add creator as admin participant
        await db.insert(conversationParticipants).values({
          conversationId: channel.id,
          userId: req.user!.id,
          isAdmin: true,
        });
        // Add existing crew members
        const members = await db
          .select({ userId: crewMembers.userId })
          .from(crewMembers)
          .where(eq(crewMembers.crewId, newCrew.id));
        if (members.length > 0) {
          const toAdd = members
            .filter(m => m.userId !== req.user!.id)
            .map(m => ({ conversationId: channel.id, userId: m.userId, isAdmin: false }));
          if (toAdd.length > 0) {
            await db.insert(conversationParticipants).values(toAdd).onConflictDoNothing();
          }
        }
      } catch (channelErr) {
        console.warn("Could not auto-create crew channel:", channelErr);
      }
    }

    res.status(201).json(newCrew);
  } catch (error) {
    logError("Error creating crew:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/crews/:id", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    
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

    const [existing] = await db.select().from(crews).where(eq(crews.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Crew not found" });
      return;
    }

    const [updated] = await db
      .update(crews)
      .set({ ...updateData.data, updatedAt: new Date() })
      .where(eq(crews.id, id))
      .returning();

    await logUpdate(req.user!.id, "crews", id, existing, updateData.data, req);

    res.json(updated);
  } catch (error) {
    logError("Error updating crew:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crews/:id", requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.select().from(crews).where(eq(crews.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Crew not found" });
      return;
    }

    await db.delete(crews).where(eq(crews.id, id));
    
    await logDelete(req.user!.id, "crews", id, { name: existing.name }, req);

    res.json({ success: true });
  } catch (error: any) {
    logError("Error deleting crew:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

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
    logError("Error fetching crew members:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crews/:id/members", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { userId, role, skillIds } = req.body;

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

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

    const [newMember] = await db
      .insert(crewMembers)
      .values({ crewId: id, userId, role })
      .returning();

    if (skillIds && Array.isArray(skillIds) && skillIds.length > 0) {
      const existingUserSkills = await db
        .select({ skillId: userSkills.skillId })
        .from(userSkills)
        .where(eq(userSkills.userId, userId));
      
      const existingSkillIds = new Set(existingUserSkills.map(s => s.skillId));
      
      const newSkillIds = skillIds.filter((skillId: string) => !existingSkillIds.has(skillId));
      
      if (newSkillIds.length > 0) {
        await db.insert(userSkills).values(
          newSkillIds.map((skillId: string) => ({
            userId,
            skillId,
          }))
        );
        
        await logCreate(req.user!.id, "user_skills", `${userId}-skills`, {
          userId,
          skillIds: newSkillIds,
          action: "bulk_assign",
        }, req);
      }
    }

    await logCreate(req.user!.id, "crew_members", newMember.id, {
      crewId: id,
      userId,
      role,
      skillIds: skillIds || [],
    }, req);

    // Auto-join the crew's messaging channel when a member is added
    try {
      const [crewChannel] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.crewId, id))
        .limit(1);
      if (crewChannel) {
        await db
          .insert(conversationParticipants)
          .values({ conversationId: crewChannel.id, userId, isAdmin: false })
          .onConflictDoNothing();
      }
    } catch (channelErr) {
      console.warn("Could not auto-join crew channel for new member:", channelErr);
    }

    res.status(201).json(newMember);
  } catch (error: any) {
    logError("Error adding crew member:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.message === "User is already a member of this crew") {
      res.status(400).json({ error: "User is already a member of this crew" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/api/crews/:id/members/:userId", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { id, userId } = req.params;

    const [existing] = await db
      .select()
      .from(crewMembers)
      .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    await db
      .delete(crewMembers)
      .where(and(eq(crewMembers.crewId, id), eq(crewMembers.userId, userId)));

    await logDelete(req.user!.id, "crew_members", existing.id, {
      crewId: id,
      userId,
    }, req);

    res.json({ success: true });
  } catch (error: any) {
    logError("Error removing crew member:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

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
    logError("Error fetching crew assignments:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crew-assignments", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"), async (req: AuthRequest, res) => {
  try {
    const { crewProjectAssignments, insertCrewProjectAssignmentSchema } = await import("@shared/schema");
    const { ne: neOp } = await import("drizzle-orm");
    
    const allowOverlap = req.body.allowOverlap === true;
    const bodyWithoutFlag = { ...req.body };
    delete bodyWithoutFlag.allowOverlap;

    const validated = insertCrewProjectAssignmentSchema.parse({
      ...bodyWithoutFlag,
      assignedById: req.user!.id,
    });

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
            neOp(crewProjectAssignments.projectId, validated.projectId)
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

    const [assignment] = await db.insert(crewProjectAssignments).values(validated).returning();

    await logCreate(req.user!.id, "crew_project_assignments", assignment.id, {
      crewId: assignment.crewId,
      projectId: assignment.projectId,
    }, req);

    res.status(201).json(assignment);
  } catch (error: any) {
    logError("Error creating crew assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid input", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/api/crew-assignments/:id", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"), async (req: AuthRequest, res) => {
  try {
    const { crewProjectAssignments } = await import("@shared/schema");
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(crewProjectAssignments)
      .where(eq(crewProjectAssignments.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    await db
      .delete(crewProjectAssignments)
      .where(eq(crewProjectAssignments.id, id));

    await logDelete(req.user!.id, "crew_project_assignments", id, {
      crewId: existing.crewId,
      projectId: existing.projectId,
    }, req);

    res.json({ success: true });
  } catch (error) {
    logError("Error removing crew assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/dispatch/assignments", async (req: AuthRequest, res) => {
  try {
    const { crewProjectAssignments, projectSchedules, projectScheduleTasks, crewMembers } = await import("@shared/schema");
    const { getOrgIdForFilter } = await import("./orgFilter");
    const { lte, gte, or, isNull, inArray } = await import("drizzle-orm");
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

    if (mustDenyAccess) {
      return res.json({ crews: [], assignments: [], projects: [], scheduleTasks: [] });
    }

    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate query params required" });
    }

    const crewWhereClause = shouldFilter && orgId
      ? and(eq(crews.organizationId, orgId), eq(crews.isActive, true))
      : eq(crews.isActive, true);

    const allCrews = await db
      .select({
        crew: crews,
        lead: { id: users.id, firstName: users.firstName, lastName: users.lastName },
      })
      .from(crews)
      .leftJoin(users, eq(crews.leadId, users.id))
      .where(crewWhereClause)
      .orderBy(crews.name);

    const crewIds = allCrews.map(c => c.crew.id);

    if (crewIds.length === 0) {
      return res.json({ crews: [], assignments: [], projects: [], scheduleTasks: [] });
    }

    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    const assignments = await db
      .select({
        assignment: crewProjectAssignments,
        crew: { id: crews.id, name: crews.name },
        project: { id: projects.id, code: projects.code, name: projects.name, status: projects.status },
      })
      .from(crewProjectAssignments)
      .leftJoin(crews, eq(crewProjectAssignments.crewId, crews.id))
      .leftJoin(projects, eq(crewProjectAssignments.projectId, projects.id))
      .where(
        and(
          inArray(crewProjectAssignments.crewId, crewIds),
          or(isNull(crewProjectAssignments.startDate), lte(crewProjectAssignments.startDate, rangeEnd)),
          or(isNull(crewProjectAssignments.endDate), gte(crewProjectAssignments.endDate, rangeStart))
        )
      );

    const projectWhereClause = shouldFilter && orgId
      ? and(eq(projects.status, "ACTIVE"), eq(projects.gcOrganizationId, orgId))
      : eq(projects.status, "ACTIVE");

    const activeProjects = await db
      .select({ id: projects.id, code: projects.code, name: projects.name, status: projects.status })
      .from(projects)
      .where(projectWhereClause)
      .orderBy(projects.name);

    const scheduleTasks = await db
      .select({
        id: projectScheduleTasks.id,
        name: projectScheduleTasks.name,
        crewId: projectScheduleTasks.crewId,
        crewIds: projectScheduleTasks.crewIds,
        plannedStartDate: projectScheduleTasks.plannedStartDate,
        plannedEndDate: projectScheduleTasks.plannedEndDate,
        status: projectScheduleTasks.status,
        percentComplete: projectScheduleTasks.percentComplete,
        projectId: projectSchedules.projectId,
        projectName: projects.name,
        projectCode: projects.code,
      })
      .from(projectScheduleTasks)
      .innerJoin(projectSchedules, eq(projectScheduleTasks.scheduleId, projectSchedules.id))
      .innerJoin(projects, eq(projectSchedules.projectId, projects.id))
      .where(
        and(
          eq(projectSchedules.isActive, true),
          or(
            inArray(projectScheduleTasks.crewId, crewIds),
            sql`EXISTS (SELECT 1 FROM unnest(${projectScheduleTasks.crewIds}) AS cid WHERE cid = ANY(ARRAY[${sql.join(crewIds.map(id => sql`${id}`), sql`,`)}]))`
          ),
          or(isNull(projectScheduleTasks.plannedStartDate), lte(projectScheduleTasks.plannedStartDate, endDate)),
          or(isNull(projectScheduleTasks.plannedEndDate), gte(projectScheduleTasks.plannedEndDate, startDate))
        )
      );

    const memberCounts = await db
      .select({
        crewId: crewMembers.crewId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(crewMembers)
      .where(inArray(crewMembers.crewId, crewIds))
      .groupBy(crewMembers.crewId);

    const memberCountMap = new Map(memberCounts.map(mc => [mc.crewId, Number(mc.count)]));

    const crewsWithCounts = allCrews.map(({ crew, lead }) => ({
      ...crew,
      lead: lead?.id ? lead : null,
      memberCount: memberCountMap.get(crew.id) || 0,
    }));

    res.json({ crews: crewsWithCounts, assignments, projects: activeProjects, scheduleTasks });
  } catch (error) {
    logError("Error fetching dispatch data:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/dispatch/assignments/:id", requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "HUSTLER"), async (req: AuthRequest, res) => {
  try {
    const { crewProjectAssignments } = await import("@shared/schema");
    const { getOrgIdForFilter } = await import("./orgFilter");
    const { id } = req.params;
    const { startDate, endDate, projectId, notes } = req.body as {
      startDate?: string | null;
      endDate?: string | null;
      projectId?: string;
      notes?: string | null;
    };

    const [existing] = await db
      .select({
        assignment: crewProjectAssignments,
        crewOrgId: crews.organizationId,
      })
      .from(crewProjectAssignments)
      .innerJoin(crews, eq(crewProjectAssignments.crewId, crews.id))
      .where(eq(crewProjectAssignments.id, id))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const { shouldFilter, orgId } = getOrgIdForFilter(req);
    if (shouldFilter && orgId && existing.crewOrgId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (projectId !== undefined && shouldFilter && orgId) {
      const [targetProject] = await db
        .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!targetProject || targetProject.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Target project not accessible" });
      }
    }

    const updateData: Partial<{
      startDate: Date | null;
      endDate: Date | null;
      projectId: string;
      notes: string | null;
    }> = {};
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (projectId !== undefined) updateData.projectId = projectId;
    if (notes !== undefined) updateData.notes = notes;

    const [updated] = await db
      .update(crewProjectAssignments)
      .set(updateData)
      .where(eq(crewProjectAssignments.id, id))
      .returning();

    await logUpdate(req.user!.id, "crew_project_assignments", id, existing.assignment, updateData, req);

    res.json(updated);
  } catch (error) {
    logError("Error updating dispatch assignment:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
