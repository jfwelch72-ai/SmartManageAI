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
    console.error("Error fetching project notes:", error);
    res.status(500).json({ 
      error: "Failed to fetch project notes",
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
    console.error("Error creating project note:", error);
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

    const conditions = [];

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
      .leftJoin(users, eq(companyDailyNotes.authorId, users.id))
      .leftJoin(projects, eq(companyDailyNotes.projectId, projects.id))
      .orderBy(desc(companyDailyNotes.createdAt));

    const notes = conditions.length > 0 
      ? await notesQuery.where(and(...conditions))
      : await notesQuery;

    res.json(notes);
  } catch (error: any) {
    console.error("Error fetching company notes:", error);
    res.status(500).json({ 
      error: "Failed to fetch company notes",
      details: error.message 
    });
  }
});

// Create a company daily note
router.post("/company-notes", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
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
    console.error("Error creating company note:", error);
    res.status(500).json({ 
      error: "Failed to create company note",
      details: error.message 
    });
  }
});

export default router;
