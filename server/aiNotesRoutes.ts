import { Router, type Response } from "express";
import { aiNotesService } from "./aiNotesService";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { parsePagination, getUserOrThrow } from "./utils/routeHelpers";
import { db } from "./db";
import { projects } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.post("/analyze", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { sinceDate, hoursBack } = req.body;
    
    let cutoffDate: Date | undefined;
    if (sinceDate) {
      cutoffDate = new Date(sinceDate);
    } else if (hoursBack) {
      cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    }

    const result = await aiNotesService.analyzeRecentNotes(req.user!.id, cutoffDate);
    
    res.json({
      success: true,
      runId: result.runId,
      insightsGenerated: result.insightsCount,
    });
  } catch (error) {
    console.error("Error triggering AI analysis:", error);
    res.status(500).json({
      error: "Failed to analyze notes",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/insights", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const { limit } = parsePagination(req, { limit: 100 });
    const insights = await aiNotesService.getAllInsights(limit, user.role);
    res.json({ insights });
  } catch (error) {
    console.error("Error fetching insights:", error);
    res.status(500).json({
      error: "Failed to fetch insights",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/insights/role", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const { limit } = parsePagination(req);
    const insights = await aiNotesService.getInsightsForRole(user.role, limit);
    res.json({ insights });
  } catch (error) {
    console.error("Error fetching role-based insights:", error);
    res.status(500).json({
      error: "Failed to fetch insights",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/insights/project/:projectId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const { projectId } = req.params;
    const { limit } = parsePagination(req);

    const isAdminOrManager = ["ADMIN", "MANAGER"].includes(user.role);
    
    if (!isAdminOrManager) {
      const project = await db
        .select({ 
          id: projects.id, 
          superintendentId: projects.superintendentId,
          estimatorId: projects.estimatorId 
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (project.length === 0) {
        return res.status(404).json({ error: "Project not found" });
      }

      const isAssignedToProject = 
        project[0].superintendentId === user.id || 
        project[0].estimatorId === user.id;

      if (!isAssignedToProject) {
        return res.status(403).json({ 
          error: "Access denied",
          message: "You are not assigned to this project" 
        });
      }
    }

    const insights = await aiNotesService.getProjectInsights(projectId, limit, user.role);
    res.json({ insights });
  } catch (error) {
    console.error("Error fetching project insights:", error);
    res.status(500).json({
      error: "Failed to fetch project insights",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
