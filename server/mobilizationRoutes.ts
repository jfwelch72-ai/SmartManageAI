import { Router, Response } from "express";
import { db } from "./db";
import { mobilizationChecklists, mobilizationChecklistItems, methodStatements } from "@shared/schema/operations";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { z } from "zod";

const router = Router();

const MANAGEMENT_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "HUSTLER"] as const;

const DEFAULT_CHECKLIST_ITEMS = [
  { title: "Site Office Setup", description: "Establish temporary site office with utilities, internet, and phone", category: "Facilities", sortOrder: 0 },
  { title: "Temporary Facilities", description: "Install portable restrooms, wash stations, and break areas", category: "Facilities", sortOrder: 1 },
  { title: "Utility Connections", description: "Arrange temporary power, water, and drainage connections", category: "Utilities", sortOrder: 2 },
  { title: "Site Fencing & Hoarding", description: "Install perimeter fencing, hoarding, and signage", category: "Security", sortOrder: 3 },
  { title: "Security Measures", description: "Set up access control, CCTV, and security lighting", category: "Security", sortOrder: 4 },
  { title: "Equipment Delivery & Staging", description: "Coordinate delivery and staging of major equipment and plant", category: "Equipment", sortOrder: 5 },
  { title: "Workforce Deployment", description: "Confirm crew assignments, inductions, and site access passes", category: "Workforce", sortOrder: 6 },
  { title: "Environmental Controls", description: "Install erosion controls, dust suppression, and waste management", category: "Environmental", sortOrder: 7 },
  { title: "Safety Signage & First Aid", description: "Post required safety signs and set up first aid station", category: "Safety", sortOrder: 8 },
  { title: "Material Storage Areas", description: "Designate and prepare material laydown and storage zones", category: "Materials", sortOrder: 9 },
];

const createChecklistSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  useDefaults: z.boolean().optional().default(true),
});

const createChecklistItemSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.string().optional().default("General"),
  sortOrder: z.number().optional().default(0),
  dueDate: z.string().optional(),
  assignedToUserId: z.string().optional(),
  assignedToName: z.string().optional(),
});

const updateChecklistItemSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"]).optional(),
  notes: z.string().optional(),
  assignedToUserId: z.string().optional(),
  assignedToName: z.string().optional(),
  dueDate: z.string().nullable().optional(),
});

const createMethodStatementSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  workActivity: z.string().min(1, "Work activity is required"),
  hazards: z.string().optional(),
  controlMeasures: z.string().optional(),
  ppe: z.string().optional(),
  emergencyProcedures: z.string().optional(),
  linkedScheduleTaskId: z.string().optional(),
});

const updateMethodStatementSchema = z.object({
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  workActivity: z.string().optional(),
  hazards: z.string().optional(),
  controlMeasures: z.string().optional(),
  ppe: z.string().optional(),
  emergencyProcedures: z.string().optional(),
  linkedScheduleTaskId: z.string().optional(),
  rejectionReason: z.string().optional(),
});

router.get("/api/projects/:projectId/mobilization/checklists", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const checklists = await db.select().from(mobilizationChecklists)
      .where(eq(mobilizationChecklists.projectId, projectId))
      .orderBy(desc(mobilizationChecklists.createdAt));
    res.json(checklists);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/projects/:projectId/mobilization/checklists", requireAuth, requireRole(...MANAGEMENT_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const parsed = createChecklistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { title, description, useDefaults } = parsed.data;

    const [checklist] = await db.insert(mobilizationChecklists).values({
      projectId,
      title,
      description: description || null,
      createdById: req.user!.id,
    }).returning();

    if (useDefaults !== false) {
      const itemsToInsert = DEFAULT_CHECKLIST_ITEMS.map(item => ({
        checklistId: checklist.id,
        ...item,
      }));
      await db.insert(mobilizationChecklistItems).values(itemsToInsert);
    }

    res.json(checklist);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/mobilization/checklists/:checklistId/items", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { checklistId } = req.params;
    const [checklist] = await db.select({ projectId: mobilizationChecklists.projectId })
      .from(mobilizationChecklists)
      .where(eq(mobilizationChecklists.id, checklistId));
    if (!checklist) return res.status(404).json({ error: "Checklist not found" });

    const items = await db.select().from(mobilizationChecklistItems)
      .where(eq(mobilizationChecklistItems.checklistId, checklistId))
      .orderBy(mobilizationChecklistItems.sortOrder);
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/mobilization/checklists/:checklistId/items", requireAuth, requireRole(...MANAGEMENT_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { checklistId } = req.params;
    const [checklist] = await db.select({ projectId: mobilizationChecklists.projectId })
      .from(mobilizationChecklists)
      .where(eq(mobilizationChecklists.id, checklistId));
    if (!checklist) return res.status(404).json({ error: "Checklist not found" });

    const parsed = createChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const [item] = await db.insert(mobilizationChecklistItems).values({
      checklistId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      category: parsed.data.category || "General",
      sortOrder: parsed.data.sortOrder ?? 0,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      assignedToUserId: parsed.data.assignedToUserId || null,
      assignedToName: parsed.data.assignedToName || null,
    }).returning();

    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/api/mobilization/checklist-items/:itemId", requireAuth, requireRole(...MANAGEMENT_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { itemId } = req.params;

    const [existingItem] = await db.select().from(mobilizationChecklistItems)
      .where(eq(mobilizationChecklistItems.id, itemId));
    if (!existingItem) return res.status(404).json({ error: "Item not found" });

    const [checklist] = await db.select({ projectId: mobilizationChecklists.projectId })
      .from(mobilizationChecklists)
      .where(eq(mobilizationChecklists.id, existingItem.checklistId));
    if (!checklist) return res.status(403).json({ error: "Access denied" });

    const parsed = updateChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status;
      if (parsed.data.status === "COMPLETED") {
        updates.completedAt = new Date();
        updates.completedById = req.user!.id;
      }
    }
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (parsed.data.assignedToUserId !== undefined) updates.assignedToUserId = parsed.data.assignedToUserId;
    if (parsed.data.assignedToName !== undefined) updates.assignedToName = parsed.data.assignedToName;
    if (parsed.data.dueDate !== undefined) updates.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;

    const [updated] = await db.update(mobilizationChecklistItems)
      .set(updates)
      .where(eq(mobilizationChecklistItems.id, itemId))
      .returning();

    const allItems = await db.select().from(mobilizationChecklistItems)
      .where(eq(mobilizationChecklistItems.checklistId, updated.checklistId));

    const allCompleted = allItems.every(i => i.status === "COMPLETED" || i.status === "SKIPPED");
    const anyInProgress = allItems.some(i => i.status === "IN_PROGRESS" || i.status === "COMPLETED");

    let checklistStatus: "DRAFT" | "IN_PROGRESS" | "COMPLETED" = "DRAFT";
    if (allCompleted) checklistStatus = "COMPLETED";
    else if (anyInProgress) checklistStatus = "IN_PROGRESS";

    await db.update(mobilizationChecklists)
      .set({
        status: checklistStatus,
        updatedAt: new Date(),
        ...(allCompleted ? { completedAt: new Date(), completedById: req.user!.id } : {}),
      })
      .where(eq(mobilizationChecklists.id, updated.checklistId));

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/projects/:projectId/method-statements", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const statements = await db.select().from(methodStatements)
      .where(eq(methodStatements.projectId, projectId))
      .orderBy(desc(methodStatements.createdAt));
    res.json(statements);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/projects/:projectId/method-statements", requireAuth, requireRole(...MANAGEMENT_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const parsed = createMethodStatementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const [statement] = await db.insert(methodStatements).values({
      projectId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      workActivity: parsed.data.workActivity,
      hazards: parsed.data.hazards || null,
      controlMeasures: parsed.data.controlMeasures || null,
      ppe: parsed.data.ppe || null,
      emergencyProcedures: parsed.data.emergencyProcedures || null,
      linkedScheduleTaskId: parsed.data.linkedScheduleTaskId || null,
      createdById: req.user!.id,
    }).returning();

    res.json(statement);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const VALID_METHOD_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: ["DRAFT"],
};

router.patch("/api/method-statements/:id", requireAuth, requireRole(...MANAGEMENT_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const [existing] = await db.select().from(methodStatements)
      .where(eq(methodStatements.id, id));
    if (!existing) return res.status(404).json({ error: "Method statement not found" });

    const parsed = updateMethodStatementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    if (parsed.data.status) {
      const allowed = VALID_METHOD_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(parsed.data.status)) {
        return res.status(400).json({ error: `Cannot transition from ${existing.status} to ${parsed.data.status}` });
      }
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.workActivity !== undefined) updates.workActivity = parsed.data.workActivity;
    if (parsed.data.hazards !== undefined) updates.hazards = parsed.data.hazards;
    if (parsed.data.controlMeasures !== undefined) updates.controlMeasures = parsed.data.controlMeasures;
    if (parsed.data.ppe !== undefined) updates.ppe = parsed.data.ppe;
    if (parsed.data.emergencyProcedures !== undefined) updates.emergencyProcedures = parsed.data.emergencyProcedures;
    if (parsed.data.linkedScheduleTaskId !== undefined) updates.linkedScheduleTaskId = parsed.data.linkedScheduleTaskId;

    if (parsed.data.status) {
      updates.status = parsed.data.status;
      if (parsed.data.status === "SUBMITTED") {
        updates.submittedAt = new Date();
        updates.submittedById = req.user!.id;
      } else if (parsed.data.status === "APPROVED") {
        updates.approvedAt = new Date();
        updates.approvedById = req.user!.id;
      } else if (parsed.data.status === "REJECTED") {
        updates.rejectedAt = new Date();
        updates.rejectionReason = parsed.data.rejectionReason || null;
      }
    }

    const [updated] = await db.update(methodStatements)
      .set(updates)
      .where(eq(methodStatements.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/method-statements/:id", requireAuth, requireRole(...MANAGEMENT_ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const [existing] = await db.select().from(methodStatements)
      .where(eq(methodStatements.id, id));
    if (!existing) return res.status(404).json({ error: "Method statement not found" });

    await db.delete(methodStatements).where(eq(methodStatements.id, id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
