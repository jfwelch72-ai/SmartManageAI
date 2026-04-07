import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import { projectNotePages, projectNoteBlocks, users, projects, type ProjectNoteBlock } from "@shared/schema";
import { insertProjectNotePageSchema, insertProjectNoteBlockSchema } from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { z } from "zod";

const router = Router();

const ALLOWED_TAGS = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "br", "span"]);

function sanitizeHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi, (match, tag) => {
    const lower = tag.toLowerCase();
    if (ALLOWED_TAGS.has(lower)) {
      if (match.startsWith("</")) return `</${lower}>`;
      return `<${lower}>`;
    }
    return "";
  }).replace(/on\w+\s*=/gi, "").replace(/javascript:/gi, "");
}

function sanitizeBlockContent(content: { text?: string } | undefined): { text?: string } | undefined {
  if (!content) return content;
  if (content.text !== undefined) {
    return { text: sanitizeHtml(content.text) };
  }
  return content;
}

const VALID_BLOCK_TYPES = ["HEADING1", "HEADING2", "HEADING3", "PARAGRAPH", "BULLETED_LIST", "NUMBERED_LIST", "TODO", "DIVIDER"] as const;
const MANAGEMENT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"];

function hasNoteAccess(role: string | undefined): boolean {
  return MANAGEMENT_ROLES.includes(role || "");
}

async function getProjectOrgId(projectId: string): Promise<string | null> {
  const [project] = await db
    .select({ gcOrganizationId: projects.gcOrganizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return project?.gcOrganizationId || null;
}

async function verifyPageOwnership(pageId: string, projectId: string): Promise<boolean> {
  const [page] = await db
    .select({ id: projectNotePages.id })
    .from(projectNotePages)
    .where(and(eq(projectNotePages.id, pageId), eq(projectNotePages.projectId, projectId)))
    .limit(1);
  return !!page;
}

async function verifyProjectAccess(req: AuthRequest, res: Response, projectId: string): Promise<boolean> {
  const userRole = req.user?.role;
  if (!hasNoteAccess(userRole)) {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  const projectOrgId = await getProjectOrgId(projectId);
  if (!projectOrgId) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  return verifyOrgAccess(req, res, projectOrgId);
}

router.get("/projects/:projectId/note-pages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pages = await db
      .select({
        id: projectNotePages.id,
        projectId: projectNotePages.projectId,
        title: projectNotePages.title,
        authorId: projectNotePages.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        createdAt: projectNotePages.createdAt,
        updatedAt: projectNotePages.updatedAt,
      })
      .from(projectNotePages)
      .leftJoin(users, eq(projectNotePages.authorId, users.id))
      .where(eq(projectNotePages.projectId, projectId))
      .orderBy(desc(projectNotePages.updatedAt));

    res.json(pages);
  } catch (error: any) {
    logError("Error fetching project note pages:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch note pages" });
  }
});

router.post("/projects/:projectId/note-pages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const validationResult = insertProjectNotePageSchema.safeParse({
      ...req.body,
      projectId,
      authorId: userId,
    });

    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const [newPage] = await db
      .insert(projectNotePages)
      .values(validationResult.data)
      .returning();

    await db.insert(projectNoteBlocks).values({
      pageId: newPage.id,
      type: "PARAGRAPH",
      content: { text: "" },
      sortOrder: 0,
    });

    const [pageWithAuthor] = await db
      .select({
        id: projectNotePages.id,
        projectId: projectNotePages.projectId,
        title: projectNotePages.title,
        authorId: projectNotePages.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        createdAt: projectNotePages.createdAt,
        updatedAt: projectNotePages.updatedAt,
      })
      .from(projectNotePages)
      .leftJoin(users, eq(projectNotePages.authorId, users.id))
      .where(eq(projectNotePages.id, newPage.id));

    res.status(201).json(pageWithAuthor);
  } catch (error: any) {
    logError("Error creating project note page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create note page" });
  }
});

router.patch("/projects/:projectId/note-pages/:pageId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId } = req.params;
    const { title } = req.body;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    await db
      .update(projectNotePages)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(and(eq(projectNotePages.id, pageId), eq(projectNotePages.projectId, projectId)));

    res.json({ success: true });
  } catch (error: any) {
    logError("Error updating note page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update note page" });
  }
});

router.delete("/projects/:projectId/note-pages/:pageId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId } = req.params;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    await db.delete(projectNotePages).where(and(eq(projectNotePages.id, pageId), eq(projectNotePages.projectId, projectId)));
    res.json({ success: true });
  } catch (error: any) {
    logError("Error deleting note page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete note page" });
  }
});

router.get("/projects/:projectId/note-pages/:pageId/blocks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId } = req.params;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    const blocks = await db
      .select()
      .from(projectNoteBlocks)
      .where(eq(projectNoteBlocks.pageId, pageId))
      .orderBy(asc(projectNoteBlocks.sortOrder));

    res.json(blocks);
  } catch (error: any) {
    logError("Error fetching note blocks:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch note blocks" });
  }
});

router.post("/projects/:projectId/note-pages/:pageId/blocks", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId } = req.params;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    const validationResult = insertProjectNoteBlockSchema.safeParse({
      ...req.body,
      pageId,
    });

    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.issues });
    }

    const sanitizedData = {
      ...validationResult.data,
      content: sanitizeBlockContent(validationResult.data.content as { text?: string }),
    };

    const [newBlock] = await db
      .insert(projectNoteBlocks)
      .values(sanitizedData)
      .returning();

    await db
      .update(projectNotePages)
      .set({ updatedAt: new Date() })
      .where(eq(projectNotePages.id, pageId));

    res.status(201).json(newBlock);
  } catch (error: any) {
    logError("Error creating note block:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create note block" });
  }
});

const blockUpdateSchema = z.object({
  type: z.enum(VALID_BLOCK_TYPES).optional(),
  content: z.object({ text: z.string().optional() }).optional(),
  sortOrder: z.number().int().min(0).optional(),
  checked: z.boolean().optional(),
});

router.patch("/projects/:projectId/note-pages/:pageId/blocks/:blockId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId, blockId } = req.params;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    const parsed = blockUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    }

    const updateData: Partial<Pick<ProjectNoteBlock, "type" | "content" | "sortOrder" | "checked" | "updatedAt">> = { updatedAt: new Date() };
    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.content !== undefined) updateData.content = sanitizeBlockContent(parsed.data.content) as { text?: string };
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.checked !== undefined) updateData.checked = parsed.data.checked;

    const result = await db
      .update(projectNoteBlocks)
      .set(updateData)
      .where(and(eq(projectNoteBlocks.id, blockId), eq(projectNoteBlocks.pageId, pageId)))
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: "Block not found" });
    }

    await db
      .update(projectNotePages)
      .set({ updatedAt: new Date() })
      .where(eq(projectNotePages.id, pageId));

    res.json(result[0]);
  } catch (error: any) {
    logError("Error updating note block:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update note block" });
  }
});

router.delete("/projects/:projectId/note-pages/:pageId/blocks/:blockId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId, blockId } = req.params;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    await db
      .delete(projectNoteBlocks)
      .where(and(eq(projectNoteBlocks.id, blockId), eq(projectNoteBlocks.pageId, pageId)));

    await db
      .update(projectNotePages)
      .set({ updatedAt: new Date() })
      .where(eq(projectNotePages.id, pageId));

    res.json({ success: true });
  } catch (error: any) {
    logError("Error deleting note block:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete note block" });
  }
});

const reorderSchema = z.object({
  blocks: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().int().min(0),
  })),
});

router.put("/projects/:projectId/note-pages/:pageId/blocks/reorder", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, pageId } = req.params;

    if (!(await verifyProjectAccess(req, res, projectId))) return;

    const pageExists = await verifyPageOwnership(pageId, projectId);
    if (!pageExists) {
      return res.status(404).json({ error: "Page not found" });
    }

    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    }

    for (const block of parsed.data.blocks) {
      await db
        .update(projectNoteBlocks)
        .set({ sortOrder: block.sortOrder, updatedAt: new Date() })
        .where(and(eq(projectNoteBlocks.id, block.id), eq(projectNoteBlocks.pageId, pageId)));
    }

    await db
      .update(projectNotePages)
      .set({ updatedAt: new Date() })
      .where(eq(projectNotePages.id, pageId));

    res.json({ success: true });
  } catch (error: any) {
    logError("Error reordering blocks:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to reorder blocks" });
  }
});

export default router;
