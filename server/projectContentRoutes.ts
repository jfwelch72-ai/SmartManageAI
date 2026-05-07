import { Router, NextFunction } from "express";
import { db } from "./db";
import { projects, users, media, projectNotes, insertProjectNoteSchema, insertMediaSchema, filePermissions, organizations, orgCostCodes, insertOrgCostCodeSchema, projectCostCodes, conversations, conversationParticipants, messages, photoCustodyRecords } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { sanitizeText } from "./sanitization";
import { emitMessageNew } from "./messagingEvents";
import { logError } from "./utils/logger";
import { assertStorageKeyBelongsToOrg } from "./services/documentRevisionService";
import { parseOrRespond } from "./utils/validation";

const router = Router();

// ========================================
// Routes from projectContentRoutes.ts
// ========================================

function validateJSONField(jsonString: string | null | undefined, fieldName: string): { valid: boolean; error?: string; parsed?: any } {
  if (jsonString === null || jsonString === undefined) {
    return { valid: true };
  }

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

// ====================
// Project Notes Routes
// ====================

router.get("/api/projects/:code/notes", requireAuth, async (req: AuthRequest, res, next) => {
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
  next(error);
  }
});

router.post("/api/projects/:code/notes", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"), async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

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

    const insertData = { ...validationResult.data, projectId: project.id, authorId: req.user!.id };
    const [newNote] = await db.insert(projectNotes).values([insertData]).returning();

    const userId = req.user!.id;
    const orgId = req.user!.organizationId!;

    if (orgId) {
      let [projectConversation] = await db
        .select()
        .from(conversations)
        .where(and(
          eq(conversations.projectId, project.id),
          eq(conversations.type, "GROUP"),
          eq(conversations.isArchived, false),
        ))
        .limit(1);

      if (!projectConversation) {
        [projectConversation] = await db
          .insert(conversations)
          .values({
            type: "GROUP",
            name: project.name || project.code,
            projectId: project.id,
            organizationId: orgId,
            createdById: userId,
          })
          .returning();

        await db.insert(conversationParticipants).values({
          conversationId: projectConversation.id,
          userId,
          isAdmin: true,
        });
      }

      const existingParticipant = await db
        .select()
        .from(conversationParticipants)
        .where(and(
          eq(conversationParticipants.conversationId, projectConversation.id),
          eq(conversationParticipants.userId, userId),
        ))
        .limit(1);

      if (existingParticipant.length === 0) {
        await db.insert(conversationParticipants).values({
          conversationId: projectConversation.id,
          userId,
          isAdmin: false,
        }).onConflictDoNothing();
      }

      const [fieldNoteMsg] = await db
        .insert(messages)
        .values({
          conversationId: projectConversation.id,
          senderId: userId,
          content: sanitizeText(newNote.text) ?? "",
          isFieldNote: true,
        })
        .returning();

      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, projectConversation.id));

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

      const fullMessage = { ...fieldNoteMsg, sender, reactions: [], entityLinks: [] };

      const participants = await db
        .select({ userId: conversationParticipants.userId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, projectConversation.id));
      const participantUserIds = new Set(participants.map(p => p.userId));
      emitMessageNew(orgId, projectConversation.id, participantUserIds, fullMessage);
    }

    res.status(201).json(newNote);
  } catch (error) {
  next(error);
  }
});

// ====================
// Media Routes
// ====================

router.get("/api/projects/:code/media", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const allMedia = await db
      .select()
      .from(media)
      .where(eq(media.projectId, project.id))
      .orderBy(desc(media.uploadedAt));

    const { filterFilesByPermissions } = await import("./fileAccessHelpers");
    const projectMedia = await filterFilesByPermissions(
      allMedia,
      req.user!.id,
      req.user!.role,
      "MEDIA"
    );

    res.json(projectMedia);
  } catch (error) {
  next(error);
  }
});

router.post("/api/projects/:code/media", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"), async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

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

    try {
      await assertStorageKeyBelongsToOrg(
        validationResult.data.fileUrl,
        req.user!.organizationId!,
        req.user!.id,
        req.user!.role,
      );
    } catch (err: any) {
      return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
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

    const insertData = { ...validationResult.data, projectId: project.id, uploadedById: req.user!.id, objectKey };
    const [newMedia] = await db.insert(media).values([insertData]).returning();
    
    await db.insert(filePermissions).values([{
      fileId: newMedia.id,
      fileType: "MEDIA",
      userId: req.user!.id,
      grantedById: req.user!.id,
    }]);

    if (newMedia.type === "IMAGE" && req.user!.organizationId) {
      try {
        await db.insert(photoCustodyRecords).values({
          organizationId: req.user!.organizationId,
          projectId: project.id,
          photoUrl: newMedia.fileUrl,
          photoFileName: newMedia.fileName,
          photoObjectKey: newMedia.objectKey || undefined,
          originalMetadataJson: {
            captureTimestamp: new Date().toISOString(),
            deviceId: req.headers["x-device-id"] as string || undefined,
            deviceModel: req.headers["x-device-model"] as string || undefined,
          },
          action: "UPLOADED",
          actionById: req.user!.id,
          actionNotes: newMedia.caption || undefined,
          ipAddress: (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || undefined),
          userAgent: req.headers["user-agent"] || undefined,
        });
      } catch (custodyErr) {
        logError("Failed to create photo custody record:", { mediaId: newMedia.id, projectId: project.id }, custodyErr instanceof Error ? custodyErr : new Error(String(custodyErr)));
      }
    }

    res.status(201).json(newMedia);
  } catch (error) {
  next(error);
  }
});

router.delete("/api/media/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"), async (req: AuthRequest, res, next) => {
  try {
    const [mediaItem] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);

    if (!mediaItem) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    if (mediaItem.projectId) {
      const [mediaProject] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, mediaItem.projectId))
        .limit(1);
      if (!mediaProject) {
        res.status(404).json({ error: "Media not found" });
        return;
      }
      if (!verifyOrgAccess(req, res, mediaProject.gcOrganizationId)) return;
    }

    const canDelete = req.user!.role === "ADMIN" || 
                     req.user!.role === "MANAGER" || 
                     req.user!.role === "SUPERINTENDENT" ||
                     mediaItem.uploadedById === req.user!.id;

    if (!canDelete) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    if (mediaItem.objectKey) {
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(mediaItem.objectKey);
        await objectFile.delete();
      } catch (error) {
        logError("Error deleting media file from object storage:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    }

    await db.delete(media).where(eq(media.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

// ====================
// Cost Codes Route
// ====================

router.get("/api/projects/:id/cost-codes", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const projectId = req.params.id;

    const [project] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects).where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId))).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const assigned = await db.select().from(projectCostCodes)
      .where(and(eq(projectCostCodes.projectId, projectId), eq(projectCostCodes.isActive, true)));

    if (assigned.length > 0) {
      const { getCostCodesForTrade } = await import("@shared/costCodes");
      const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
      const tradeType = org?.tradeType || "OTHER";
      const staticCodes = getCostCodesForTrade(tradeType);
      const staticMap = new Map(staticCodes.map(c => [c.code, c]));

      const orgRows = await db.select().from(orgCostCodes).where(eq(orgCostCodes.organizationId, orgId));
      const orgMap = new Map(orgRows.map(r => [r.code, r]));

      const result = assigned.map(a => {
        const orgEntry = orgMap.get(a.costCode);
        const staticEntry = staticMap.get(a.costCode);
        return {
          code: a.costCode,
          description: orgEntry?.description || staticEntry?.description || a.costCode,
          division: orgEntry?.division || staticEntry?.division || "Unassigned",
          isCustom: orgEntry?.isCustom || false,
          isActive: true,
        };
      });
      res.json(result);
      return;
    }

    const { getCostCodesForTrade } = await import("@shared/costCodes");
    const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const tradeType = org?.tradeType || "OTHER";
    const staticCodes = getCostCodesForTrade(tradeType);

    const orgRows = await db.select().from(orgCostCodes).where(and(eq(orgCostCodes.organizationId, orgId), eq(orgCostCodes.isActive, true)));
    const orgEntries = orgRows.map(r => ({
      code: r.code,
      description: r.description,
      division: r.division,
      isCustom: r.isCustom,
      isActive: r.isActive,
    }));

    const orgCodeSet = new Set(orgRows.map(r => r.code));
    const customFirst = orgEntries.filter(e => e.isCustom);
    const overrides = orgEntries.filter(e => !e.isCustom);
    const overrideMap = new Map(overrides.map(o => [o.code, o]));

    const staticWithOverrides = staticCodes
      .filter(c => !orgCodeSet.has(c.code) || overrideMap.has(c.code))
      .map(c => {
        const override = overrideMap.get(c.code);
        if (override) return { ...c, isActive: override.isActive };
        return c;
      })
      .filter(c => c.isActive !== false);

    const merged = [...customFirst, ...staticWithOverrides];

    const seedValues = merged.map(c => ({
      projectId,
      costCode: c.code,
      isActive: true,
    }));
    if (seedValues.length > 0) {
      await db.insert(projectCostCodes).values(seedValues).onConflictDoNothing();
    }

    res.json(merged);
  } catch (error) {
    logError("Error fetching project cost codes:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

router.post("/api/projects/:id/cost-codes", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const projectId = req.params.id;

    const [project] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects).where(and(eq(projects.id, projectId), eq(projects.gcOrganizationId, orgId))).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const { costCodes } = req.body;
    if (!Array.isArray(costCodes)) {
      res.status(400).json({ error: "costCodes must be an array of { costCode, isActive }" });
      return;
    }

    const { getCostCodesForTrade } = await import("@shared/costCodes");
    const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const tradeType = org?.tradeType || "OTHER";
    const staticCodes = new Set(getCostCodesForTrade(tradeType).map(c => c.code));
    const orgRows = await db.select().from(orgCostCodes).where(and(eq(orgCostCodes.organizationId, orgId), eq(orgCostCodes.isActive, true)));
    const orgCodeSet = new Set(orgRows.map(r => r.code));
    const validUniverse = new Set([...staticCodes, ...orgCodeSet]);

    const invalidCodes = costCodes.filter(e => e.costCode && !validUniverse.has(e.costCode)).map(e => e.costCode);
    if (invalidCodes.length > 0) {
      res.status(400).json({ error: `Invalid cost codes: ${invalidCodes.join(", ")}` });
      return;
    }

    for (const entry of costCodes) {
      if (!entry.costCode) continue;
      await db.insert(projectCostCodes)
        .values({ projectId, costCode: entry.costCode, isActive: entry.isActive !== false })
        .onConflictDoUpdate({
          target: [projectCostCodes.projectId, projectCostCodes.costCode],
          set: { isActive: entry.isActive !== false },
        });
    }

    const updated = await db.select().from(projectCostCodes)
      .where(and(eq(projectCostCodes.projectId, projectId), eq(projectCostCodes.isActive, true)));
    res.json(updated);
  } catch (error) {
    logError("Error updating project cost codes:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

router.get("/api/cost-codes", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { getCostCodesForTrade } = await import("@shared/costCodes");
    const orgId = req.user!.organizationId!;
    const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const tradeType = org?.tradeType || "OTHER";
    const staticCodes = getCostCodesForTrade(tradeType);

    const orgRows = await db.select().from(orgCostCodes).where(eq(orgCostCodes.organizationId, orgId));
    const orgEntries = orgRows.map(r => ({
      code: r.code,
      description: r.description,
      division: r.division,
      isCustom: r.isCustom,
      isActive: r.isActive,
    }));

    const orgCodeSet = new Set(orgRows.map(r => r.code));
    const customFirst = orgEntries.filter(e => e.isCustom);
    const overrides = orgEntries.filter(e => !e.isCustom);
    const overrideMap = new Map(overrides.map(o => [o.code, o]));

    const staticWithOverrides = staticCodes
      .filter(c => !orgCodeSet.has(c.code) || overrideMap.has(c.code))
      .map(c => {
        const override = overrideMap.get(c.code);
        if (override) return { ...c, isActive: override.isActive };
        return c;
      });

    const merged = [
      ...customFirst,
      ...staticWithOverrides,
    ];

    res.json(merged);
  } catch (error) {
    logError("Error fetching cost codes:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

router.get("/api/cost-codes/org", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const rows = await db
      .select({
        id: orgCostCodes.id,
        organizationId: orgCostCodes.organizationId,
        code: orgCostCodes.code,
        description: orgCostCodes.description,
        division: orgCostCodes.division,
        isCustom: orgCostCodes.isCustom,
        isActive: orgCostCodes.isActive,
        deactivatedById: orgCostCodes.deactivatedById,
        deactivatedAt: orgCostCodes.deactivatedAt,
        deactivatedByName: sql<string | null>`(SELECT CONCAT(first_name, ' ', last_name) FROM users WHERE id = ${orgCostCodes.deactivatedById})`,
        createdAt: orgCostCodes.createdAt,
        updatedAt: orgCostCodes.updatedAt,
      })
      .from(orgCostCodes)
      .where(eq(orgCostCodes.organizationId, orgId));
    res.json(rows);
  } catch (error) {
    logError("Error fetching org cost codes:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

router.post("/api/cost-codes", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const isCustom = req.body.isCustom !== false;

    if (isCustom) {
      const { getCostCodesForTrade } = await import("@shared/costCodes");
      const [org] = await db.select({ tradeType: organizations.tradeType }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
      const tradeType = org?.tradeType || "OTHER";
      const staticCodes = getCostCodesForTrade(tradeType);
      if (staticCodes.some(c => c.code === req.body.code)) {
        return res.status(400).json({ error: "Cannot create a custom code with the same code as a standard code. Deactivate the standard code instead." });
      }
    }

    const parsed = parseOrRespond(insertOrgCostCodeSchema, { ...req.body, organizationId: orgId, isCustom }, res);
    if (!parsed) return;
    const insertData: typeof orgCostCodes.$inferInsert = { ...parsed };
    if (parsed.isActive === false) {
      insertData.deactivatedById = req.user!.id;
      insertData.deactivatedAt = new Date();
    }
    const [row] = await db.insert(orgCostCodes).values(insertData).returning();
    res.status(201).json(row);
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "A cost code with that code already exists" });
    }
    logError("Error creating org cost code:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

router.patch("/api/cost-codes/:id", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const id = Number(req.params.id);
    const { code, description, division, isActive, isCustom } = req.body;

    const [existing] = await db.select().from(orgCostCodes).where(and(eq(orgCostCodes.id, id), eq(orgCostCodes.organizationId, orgId))).limit(1);
    if (!existing) return res.status(404).json({ error: "Cost code not found" });

    const updates: Partial<typeof orgCostCodes.$inferInsert> = { updatedAt: new Date() };
    if (code !== undefined) updates.code = code;
    if (description !== undefined) updates.description = description;
    if (division !== undefined) updates.division = division;
    if (isCustom !== undefined) updates.isCustom = isCustom;

    if (isActive !== undefined) {
      updates.isActive = isActive;
      if (isActive === false && existing.isActive === true) {
        updates.deactivatedById = req.user!.id;
        updates.deactivatedAt = new Date();
      } else if (isActive === true && existing.isActive === false) {
        updates.deactivatedById = null;
        updates.deactivatedAt = null;
      }
    }

    const [row] = await db.update(orgCostCodes).set(updates).where(and(eq(orgCostCodes.id, id), eq(orgCostCodes.organizationId, orgId))).returning();
    res.json(row);
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "A cost code with that code already exists" });
    }
    logError("Error updating org cost code:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});


export default router;
