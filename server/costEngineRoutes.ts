import { logError } from "./utils/logger";
import { Router } from "express";
import { requireAuth, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { db } from "./db";
import { projects } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getByProject,
  getByCostCode,
  getSummary,
  postTransaction,
  voidTransaction,
  type CostSourceCategory,
  type CostOriginModule,
} from "./costEngineService";

const router = Router();

function canAccessCostEngine(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" ||
    role === "ESTIMATOR" || role === "MANAGER" || role === "HUSTLER";
}

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  return project;
}

router.get("/api/projects/:code/cost-transactions", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canAccessCostEngine(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { startDate, endDate, sourceCategory, originModule, costCode, limit, offset } = req.query;

    const result = await getByProject(project.id, {
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      sourceCategory: sourceCategory as CostSourceCategory | undefined,
      originModule: originModule as CostOriginModule | undefined,
      costCode: costCode as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 100,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    res.json(result);
  } catch (error) {
    logError("Get cost transactions error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/cost-transactions/summary", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canAccessCostEngine(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { startDate, endDate, sourceCategory, originModule, costCode, groupBy } = req.query;

    const result = await getSummary({
      projectId: project.id,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      sourceCategory: sourceCategory as CostSourceCategory | undefined,
      originModule: originModule as CostOriginModule | undefined,
      costCode: costCode as string | undefined,
      groupBy: (groupBy as "cost_code" | "source_category" | "origin_module" | "month") || "cost_code",
    });

    res.json(result);
  } catch (error) {
    logError("Get cost summary error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/cost-transactions/by-cost-code/:costCode", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!canAccessCostEngine(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const transactions = await getByCostCode(project.id, req.params.costCode);
    res.json(transactions);
  } catch (error) {
    logError("Get cost transactions by cost code error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

const postTransactionSchema = z.object({
  costCode: z.string().min(1),
  sourceCategory: z.enum(["LABOR", "MATERIAL", "EQUIPMENT", "SUBCONTRACTOR", "OTHER"]),
  originModule: z.enum(["ESTIMATE", "PO", "PAYROLL", "TM", "RECEIPT", "CHANGE_ORDER", "EQUIPMENT", "SUBCONTRACTOR"]),
  amount: z.coerce.number().finite(),
  transactionDate: z.string().min(1),
  referenceId: z.string().optional(),
  description: z.string().optional(),
});

router.post("/api/projects/:code/cost-transactions", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const parseResult = postTransactionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Validation error", details: parseResult.error.flatten() });
    }

    const row = await postTransaction({
      projectId: project.id,
      ...parseResult.data,
      amount: String(parseResult.data.amount),
      createdBy: req.user!.id,
    });

    res.status(201).json(row);
  } catch (error) {
    logError("Post cost transaction error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/projects/:code/cost-transactions/:transactionId/void", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER") {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const row = await voidTransaction(
      req.params.transactionId,
      project.id,
      req.user!.id,
      req.body.reason
    );

    if (!row) return res.status(404).json({ error: "Transaction not found or already voided" });
    res.json(row);
  } catch (error) {
    logError("Void cost transaction error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
