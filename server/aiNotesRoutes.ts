import { Router, type Response } from "express";
import { aiNotesService } from "./aiNotesService";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { db } from "./db";
import { projects } from "@shared/schema";
import { eq, or } from "drizzle-orm";

const router = Router();

/**
 * POST /api/ai-notes/analyze
 * Trigger AI analysis on recent notes (ADMIN/MANAGER only)
 * Body: { sinceDate?: string, hoursBack?: number }
 */
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
    
    // Only return summary metadata, not full insights (users can query insights endpoint for filtered results)
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

/**
 * GET /api/ai-notes/insights
 * Get all insights (company-wide, filtered by user role for RBAC)
 * Query params: { limit?: number }
 */
router.get("/insights", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    // Pass user role for RBAC filtering
    const insights = await aiNotesService.getAllInsights(limit, req.user!.role);
    
    res.json({ insights });
  } catch (error) {
    console.error("Error fetching insights:", error);
    res.status(500).json({
      error: "Failed to fetch insights",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/ai-notes/insights/role
 * Get insights relevant to the current user's role
 * Query params: { limit?: number }
 */
router.get("/insights/role", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const insights = await aiNotesService.getInsightsForRole(req.user!.role, limit);
    
    res.json({ insights });
  } catch (error) {
    console.error("Error fetching role-based insights:", error);
    res.status(500).json({
      error: "Failed to fetch insights",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /api/ai-notes/insights/project/:projectId
 * Get insights for a specific project (with project membership verification and RBAC filtering)
 * Query params: { limit?: number }
 */
router.get("/insights/project/:projectId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // Admins and managers can access any project's insights
    const isAdminOrManager = ["ADMIN", "MANAGER"].includes(userRole);
    
    if (!isAdminOrManager) {
      // Verify user is assigned to this project (superintendent or estimator)
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
        project[0].superintendentId === userId || 
        project[0].estimatorId === userId;

      if (!isAssignedToProject) {
        return res.status(403).json({ 
          error: "Access denied",
          message: "You are not assigned to this project" 
        });
      }
    }

    // Pass user role for RBAC filtering
    const insights = await aiNotesService.getProjectInsights(projectId, limit, userRole);
    
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
