import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import { projectNotes, companyDailyNotes, users, projects } from "@shared/schema";
import { insertProjectNoteSchema, insertCompanyDailyNoteSchema } from "@shared/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";

const router = Router();

// Get project notes with optional filters
router.get("/projects/:projectId/notes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { authorId, startDate, endDate } = req.query;

    const conditions = [eq(projectNotes.projectId, projectId)];

    if (authorId && typeof authorId === "string") {
      conditions.push(eq(projectNotes.authorId, authorId));
    }

    if (startDate && typeof startDate === "string") {
      conditions.push(gte(projectNotes.createdAt, new Date(startDate)));
    }

    if (endDate && typeof endDate === "string") {
      // Normalize to end of day to include all notes from that day
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(projectNotes.createdAt, endOfDay));
    }

    const notes = await db
      .select({
        id: projectNotes.id,
        projectId: projectNotes.projectId,
        authorId: projectNotes.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorRole: users.role,
        noteType: projectNotes.noteType,
        text: projectNotes.text,
        createdAt: projectNotes.createdAt,
      })
      .from(projectNotes)
      .leftJoin(users, eq(projectNotes.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(projectNotes.createdAt));

    res.json(notes);
  } catch (error: any) {
    logError("Error fetching project notes:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ 
      error: "Failed to fetch project notes",
      details: error.message 
    });
  }
});

// Update a project note (creator OR admin only)
router.patch("/projects/:projectId/notes/:noteId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { noteId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch the existing note
    const [existingNote] = await db
      .select()
      .from(projectNotes)
      .where(eq(projectNotes.id, noteId))
      .limit(1);

    if (!existingNote) {
      return res.status(404).json({ error: "Note not found" });
    }

    // Check authorization: must be the creator OR an admin
    const isCreator = existingNote.authorId === userId;
    const isAdmin = userRole === "ADMIN";

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: "You do not have permission to edit this note" });
    }

    // Validate the update
    if (!req.body.text || typeof req.body.text !== "string" || !req.body.text.trim()) {
      return res.status(400).json({ error: "Note text is required" });
    }

    // Update the note
    await db
      .update(projectNotes)
      .set({ text: req.body.text.trim() })
      .where(eq(projectNotes.id, noteId));

    // Fetch the updated note with user details
    const [updatedNote] = await db
      .select({
        id: projectNotes.id,
        projectId: projectNotes.projectId,
        authorId: projectNotes.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorRole: users.role,
        noteType: projectNotes.noteType,
        text: projectNotes.text,
        createdAt: projectNotes.createdAt,
      })
      .from(projectNotes)
      .leftJoin(users, eq(projectNotes.authorId, users.id))
      .where(eq(projectNotes.id, noteId));

    res.json(updatedNote);
  } catch (error: any) {
    logError("Error updating project note:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ 
      error: "Failed to update project note",
      details: error.message 
    });
  }
});

// Create a project note
router.post("/projects/:projectId/notes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const validationResult = insertProjectNoteSchema.safeParse({
      ...req.body,
      projectId,
      authorId: userId,
    });

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: validationResult.error.issues 
      });
    }

    const [newNote] = await db
      .insert(projectNotes)
      .values(validationResult.data)
      .returning();

    // Fetch the note with user details
    const [noteWithUser] = await db
      .select({
        id: projectNotes.id,
        projectId: projectNotes.projectId,
        authorId: projectNotes.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorRole: users.role,
        noteType: projectNotes.noteType,
        text: projectNotes.text,
        createdAt: projectNotes.createdAt,
      })
      .from(projectNotes)
      .leftJoin(users, eq(projectNotes.authorId, users.id))
      .where(eq(projectNotes.id, newNote.id));

    res.status(201).json(noteWithUser);
  } catch (error: any) {
    logError("Error creating project note:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ 
      error: "Failed to create project note",
      details: error.message 
    });
  }
});

// Get company daily notes with optional filters
router.get("/company-notes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { authorId, projectId, startDate, endDate } = req.query;
    const userOrgId = req.user?.organizationId;
    const userRole = req.user?.role;

    // SECURITY: Non-SUPER_ADMIN users must have an organization
    if (userRole !== "SUPER_ADMIN" && !userOrgId) {
      return res.json([]); // Return empty if no org
    }

    const conditions = [];

    // SECURITY: Filter by organization - only show notes from users in the same organization
    // SUPER_ADMIN can see all notes
    if (userRole !== "SUPER_ADMIN" && userOrgId) {
      conditions.push(eq(users.organizationId, userOrgId));
    }

    if (authorId && typeof authorId === "string") {
      conditions.push(eq(companyDailyNotes.authorId, authorId));
    }

    if (projectId && typeof projectId === "string") {
      conditions.push(eq(companyDailyNotes.projectId, projectId));
    }

    if (startDate && typeof startDate === "string") {
      conditions.push(gte(companyDailyNotes.createdAt, new Date(startDate)));
    }

    if (endDate && typeof endDate === "string") {
      // Normalize to end of day to include all notes from that day
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      conditions.push(lte(companyDailyNotes.createdAt, endOfDay));
    }

    const notesQuery = db
      .select({
        id: companyDailyNotes.id,
        authorId: companyDailyNotes.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorRole: users.role,
        projectId: companyDailyNotes.projectId,
        projectName: projects.name,
        projectCode: projects.code,
        text: companyDailyNotes.text,
        createdAt: companyDailyNotes.createdAt,
      })
      .from(companyDailyNotes)
      .innerJoin(users, eq(companyDailyNotes.authorId, users.id))
      .leftJoin(projects, eq(companyDailyNotes.projectId, projects.id))
      .orderBy(desc(companyDailyNotes.createdAt));

    const notes = conditions.length > 0 
      ? await notesQuery.where(and(...conditions))
      : await notesQuery;

    res.json(notes);
  } catch (error: any) {
    logError("Error fetching company notes:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ 
      error: "Failed to fetch company notes",
      details: error.message 
    });
  }
});

// Update a company daily note (creator OR admin only)
router.patch("/company-notes/:noteId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { noteId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const userOrgId = req.user?.organizationId;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // Fetch the existing note with author's organization info
    const [existingNote] = await db
      .select({
        id: companyDailyNotes.id,
        authorId: companyDailyNotes.authorId,
        authorOrgId: users.organizationId,
        text: companyDailyNotes.text,
      })
      .from(companyDailyNotes)
      .innerJoin(users, eq(companyDailyNotes.authorId, users.id))
      .where(eq(companyDailyNotes.id, noteId))
      .limit(1);

    if (!existingNote) {
      return res.status(404).json({ error: "Note not found" });
    }

    // SECURITY: Verify user belongs to the same organization as the note author
    // SUPER_ADMIN can edit any note
    if (userRole !== "SUPER_ADMIN" && existingNote.authorOrgId !== userOrgId) {
      return res.status(403).json({ error: "You do not have permission to edit this note" });
    }

    // Check authorization: must be the creator OR an admin
    const isCreator = existingNote.authorId === userId;
    const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: "You do not have permission to edit this note" });
    }

    // Validate the update
    if (!req.body.text || typeof req.body.text !== "string" || !req.body.text.trim()) {
      return res.status(400).json({ error: "Note text is required" });
    }

    // Update the note
    await db
      .update(companyDailyNotes)
      .set({ text: req.body.text.trim() })
      .where(eq(companyDailyNotes.id, noteId));

    // Fetch the updated note with user and project details
    const [updatedNote] = await db
      .select({
        id: companyDailyNotes.id,
        authorId: companyDailyNotes.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorRole: users.role,
        projectId: companyDailyNotes.projectId,
        projectName: projects.name,
        projectCode: projects.code,
        text: companyDailyNotes.text,
        createdAt: companyDailyNotes.createdAt,
      })
      .from(companyDailyNotes)
      .leftJoin(users, eq(companyDailyNotes.authorId, users.id))
      .leftJoin(projects, eq(companyDailyNotes.projectId, projects.id))
      .where(eq(companyDailyNotes.id, noteId));

    res.json(updatedNote);
  } catch (error: any) {
    logError("Error updating company note:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ 
      error: "Failed to update company note",
      details: error.message 
    });
  }
});

// Create a company daily note
router.post("/company-notes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userOrgId = req.user?.organizationId;
    const userRole = req.user?.role;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    // SECURITY: Non-SUPER_ADMIN users must have an organization
    if (userRole !== "SUPER_ADMIN" && !userOrgId) {
      return res.status(403).json({ error: "User must belong to an organization" });
    }

    // SECURITY: If a projectId is provided, verify it belongs to user's organization
    if (req.body.projectId && userRole !== "SUPER_ADMIN" && userOrgId) {
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, req.body.projectId))
        .limit(1);
      
      if (!project || project.gcOrganizationId !== userOrgId) {
        return res.status(403).json({ error: "Project does not belong to your organization" });
      }
    }

    const validationResult = insertCompanyDailyNoteSchema.safeParse({
      ...req.body,
      authorId: userId,
    });

    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Invalid input", 
        details: validationResult.error.issues 
      });
    }

    const [newNote] = await db
      .insert(companyDailyNotes)
      .values(validationResult.data)
      .returning();

    // Fetch the note with user and project details
    const [noteWithDetails] = await db
      .select({
        id: companyDailyNotes.id,
        authorId: companyDailyNotes.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorRole: users.role,
        projectId: companyDailyNotes.projectId,
        projectName: projects.name,
        projectCode: projects.code,
        text: companyDailyNotes.text,
        createdAt: companyDailyNotes.createdAt,
      })
      .from(companyDailyNotes)
      .leftJoin(users, eq(companyDailyNotes.authorId, users.id))
      .leftJoin(projects, eq(companyDailyNotes.projectId, projects.id))
      .where(eq(companyDailyNotes.id, newNote.id));

    res.status(201).json(noteWithDetails);
  } catch (error: any) {
    logError("Error creating company note:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ 
      error: "Failed to create company note",
      details: error.message 
    });
  }
});

export default router;
