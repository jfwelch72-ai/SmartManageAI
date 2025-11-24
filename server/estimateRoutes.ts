import type { Express } from "express";
import { db } from "./db";
import { 
  estimates, 
  estimateLineItems, 
  projects,
  quantityCategories,
  takeoffMeasurements,
  insertEstimateSchema,
  insertEstimateLineItemSchema,
  type EstimateLineItem,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper to check if user has management access (ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT)
function hasManagementAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"].includes(role);
}

export function registerEstimateRoutes(app: Express) {
  
  // Get active estimate for a project
  app.get("/api/projects/:projectId/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;

      // Check project access
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Get the most recent active estimate (DRAFT, PENDING_APPROVAL, or APPROVED)
      const estimate = await db.query.estimates.findFirst({
        where: and(
          eq(estimates.projectId, projectId),
          sql`${estimates.status} IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')`
        ),
        orderBy: [desc(estimates.createdAt)],
      });

      if (!estimate) {
        return res.json(null);
      }

      // Get line items for this estimate
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimate.id),
      });

      // Calculate totals
      const totals = lineItems.reduce((acc: {
        materialCost: number;
        laborCost: number;
        laborHours: number;
        equipmentCost: number;
        consumablesCost: number;
        subcontractCost: number;
        overheadAllocation: number;
        profitAllocation: number;
        totalCost: number;
      }, item: EstimateLineItem) => ({
        materialCost: acc.materialCost + Number(item.materialCost),
        laborCost: acc.laborCost + Number(item.laborCost),
        laborHours: acc.laborHours + Number(item.laborHours),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation),
        totalCost: acc.totalCost + Number(item.totalCost),
      }), {
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      });

      res.json({ ...estimate, lineItems, totals });
    } catch (error) {
      console.error("Error fetching estimate:", error);
      res.status(500).json({ error: "Failed to fetch estimate" });
    }
  });

  // Create new estimate
  app.post("/api/projects/:projectId/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const userId = req.user!.id;

      // Check if user has management access
      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check project exists
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Get version number
      const existingEstimates = await db.query.estimates.findMany({
        where: eq(estimates.projectId, projectId),
        orderBy: [desc(estimates.versionNumber)],
      });

      const versionNumber = existingEstimates.length > 0 
        ? existingEstimates[0].versionNumber + 1 
        : 1;

      // Create estimate
      const [newEstimate] = await db.insert(estimates).values({
        projectId,
        versionNumber,
        status: "DRAFT",
        createdById: userId,
      }).returning();

      res.json(newEstimate);
    } catch (error) {
      console.error("Error creating estimate:", error);
      res.status(500).json({ error: "Failed to create estimate" });
    }
  });

  // Import takeoff quantities into estimate
  app.post("/api/projects/:projectId/estimate/import-takeoff", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { estimateId, categoryIds } = req.body as { estimateId: string, categoryIds: string[] };

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate belongs to project
      const estimate = await db.query.estimates.findFirst({
        where: and(
          eq(estimates.id, estimateId),
          eq(estimates.projectId, projectId)
        ),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (estimate.status !== "DRAFT") {
        return res.status(400).json({ error: "Can only import into draft estimates" });
      }

      // Get selected categories
      const categories = await db.query.quantityCategories.findMany({
        where: sql`${quantityCategories.id} = ANY(${categoryIds})`,
      });

      const lineItemsToCreate = [];

      for (const category of categories) {
        // Get measurements for this category
        const measurements = await db.query.takeoffMeasurements.findMany({
          where: eq(takeoffMeasurements.categoryId, category.id),
        });
        // Calculate totals for this category
        let linearTotal = 0;
        let areaTotal = 0;
        let volumeTotal = 0;
        let countTotal = 0;

        for (const measurement of measurements) {
          if (measurement.type === "LINEAR" && measurement.computedLengthFt) {
            linearTotal += Number(measurement.computedLengthFt);
          } else if (measurement.type === "AREA" && measurement.computedAreaFt2) {
            areaTotal += Number(measurement.computedAreaFt2);
          } else if (measurement.type === "VOLUME" && measurement.computedVolumeCy) {
            volumeTotal += Number(measurement.computedVolumeCy);
          } else if (measurement.type === "COUNT") {
            countTotal += 1;
          }
        }

        // Create line items based on non-zero totals
        if (linearTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Linear`,
            quantity: linearTotal.toString(),
            unit: "LF",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: linearTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }

        if (areaTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Area`,
            quantity: areaTotal.toString(),
            unit: "SF",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: areaTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }

        if (volumeTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Volume`,
            quantity: volumeTotal.toString(),
            unit: "CY",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: volumeTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }

        if (countTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Count`,
            quantity: countTotal.toString(),
            unit: "EA",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: countTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }
      }

      if (lineItemsToCreate.length > 0) {
        const newLineItems = await db.insert(estimateLineItems).values(lineItemsToCreate).returning();
        res.json({ lineItems: newLineItems, count: newLineItems.length });
      } else {
        res.json({ lineItems: [], count: 0 });
      }
    } catch (error) {
      console.error("Error importing takeoff:", error);
      res.status(500).json({ error: "Failed to import takeoff" });
    }
  });

  // Add manual line item
  app.post("/api/estimates/:estimateId/line-items", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;
      const lineItem = req.body;

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists and is editable
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (estimate.status !== "DRAFT") {
        return res.status(400).json({ error: "Can only edit draft estimates" });
      }

      // Validate and create line item
      const validatedData = insertEstimateLineItemSchema.parse({
        ...lineItem,
        estimateId,
        source: "MANUAL",
      });

      const [newLineItem] = await db.insert(estimateLineItems).values(validatedData).returning();

      res.json(newLineItem);
    } catch (error) {
      console.error("Error creating line item:", error);
      res.status(500).json({ error: "Failed to create line item" });
    }
  });

  // Update line item
  app.put("/api/estimates/:estimateId/line-items/:lineItemId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const updates = req.body;

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate is editable
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate || estimate.status !== "DRAFT") {
        return res.status(400).json({ error: "Cannot edit this estimate" });
      }

      // Update line item
      const [updatedLineItem] = await db.update(estimateLineItems)
        .set({ ...updates, userAdjusted: true, updatedAt: new Date() })
        .where(and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ))
        .returning();

      if (!updatedLineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      res.json(updatedLineItem);
    } catch (error) {
      console.error("Error updating line item:", error);
      res.status(500).json({ error: "Failed to update line item" });
    }
  });

  // Delete line item
  app.delete("/api/estimates/:estimateId/line-items/:lineItemId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate is editable
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate || estimate.status !== "DRAFT") {
        return res.status(400).json({ error: "Cannot edit this estimate" });
      }

      await db.delete(estimateLineItems)
        .where(and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ));

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting line item:", error);
      res.status(500).json({ error: "Failed to delete line item" });
    }
  });

  // Approve estimate and sync to project budget
  app.post("/api/estimates/:estimateId/approve", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;
      const userId = req.user!.id;

      // Only admins and managers can approve
      if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER") {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Get estimate
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (estimate.status === "APPROVED") {
        return res.status(400).json({ error: "Estimate already approved" });
      }

      // Get line items
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimateId),
      });

      // Calculate total
      const total = lineItems.reduce((sum: number, item: EstimateLineItem) => sum + Number(item.totalCost), 0);

      // Update estimate status and base bid amount
      await db.update(estimates)
        .set({ 
          status: "APPROVED", 
          baseBidAmount: total.toString(),
          updatedAt: new Date(),
        })
        .where(eq(estimates.id, estimateId));

      // Update project budget
      await db.update(projects)
        .set({ 
          budget: total.toString(),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, estimate.projectId));

      res.json({ success: true, total, estimateId, projectId: estimate.projectId });
    } catch (error) {
      console.error("Error approving estimate:", error);
      res.status(500).json({ error: "Failed to approve estimate" });
    }
  });

  // AI CFO estimate analysis
  app.post("/api/estimates/:estimateId/analyze", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Get estimate and project data
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      const project = await db.query.projects.findFirst({
        where: eq(projects.id, estimate.projectId),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Get line items
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimateId),
      });

      // Get actual labor costs for comparison (if project is active)
      const actualLaborQuery = await db.execute(sql`
        SELECT 
          COALESCE(SUM(CAST(hours_worked AS NUMERIC)), 0) as total_hours,
          COALESCE(SUM(CAST(labor_cost AS NUMERIC)), 0) as total_labor_cost
        FROM time_clock_entries
        WHERE project_id = ${project.id}
          AND approval_status = 'APPROVED'
      `);

      const actualLabor = actualLaborQuery.rows[0] as { total_hours: string, total_labor_cost: string };

      // Prepare data for AI analysis
      const estimateSummary = lineItems.reduce((acc: {
        totalCost: number;
        materialCost: number;
        laborCost: number;
        laborHours: number;
        equipmentCost: number;
        subcontractCost: number;
        overhead: number;
        profit: number;
      }, item: EstimateLineItem) => ({
        totalCost: acc.totalCost + Number(item.totalCost),
        materialCost: acc.materialCost + Number(item.materialCost),
        laborCost: acc.laborCost + Number(item.laborCost),
        laborHours: acc.laborHours + Number(item.laborHours),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost),
        overhead: acc.overhead + Number(item.overheadAllocation),
        profit: acc.profit + Number(item.profitAllocation),
      }), {
        totalCost: 0,
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overhead: 0,
        profit: 0,
      });

      const categoryBreakdown = lineItems.reduce((acc: Record<string, { count: number, totalCost: number, laborCost: number, materialCost: number }>, item: EstimateLineItem) => {
        const cat = item.category;
        if (!acc[cat]) {
          acc[cat] = { count: 0, totalCost: 0, laborCost: 0, materialCost: 0 };
        }
        acc[cat].count++;
        acc[cat].totalCost += Number(item.totalCost);
        acc[cat].laborCost += Number(item.laborCost);
        acc[cat].materialCost += Number(item.materialCost);
        return acc;
      }, {} as Record<string, { count: number, totalCost: number, laborCost: number, materialCost: number }>);

      // Call OpenAI for analysis
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are an AI CFO analyzing a construction project estimate. Provide:
1. Budget Health Assessment (Low/Medium/High risk)
2. Key Insights (3-5 bullet points)
3. Cost Distribution Analysis
4. Profitability Analysis
5. Recommendations (3-5 actionable items)

Format as JSON with keys: riskLevel, insights (array), costAnalysis (string), profitabilityAnalysis (string), recommendations (array).`
          },
          {
            role: "user",
            content: `Analyze this estimate:

Project: ${project.name} (${project.status})
Contract Amount: $${project.contractAmount || 'Not set'}

ESTIMATE SUMMARY:
- Total Estimated Cost: $${estimateSummary.totalCost.toFixed(2)}
- Material Cost: $${estimateSummary.materialCost.toFixed(2)} (${((estimateSummary.materialCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Labor Cost: $${estimateSummary.laborCost.toFixed(2)} (${((estimateSummary.laborCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Labor Hours: ${estimateSummary.laborHours.toFixed(1)} hrs
- Equipment Cost: $${estimateSummary.equipmentCost.toFixed(2)} (${((estimateSummary.equipmentCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Subcontract Cost: $${estimateSummary.subcontractCost.toFixed(2)} (${((estimateSummary.subcontractCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Overhead: $${estimateSummary.overhead.toFixed(2)} (${((estimateSummary.overhead / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Profit: $${estimateSummary.profit.toFixed(2)} (${((estimateSummary.profit / estimateSummary.totalCost) * 100).toFixed(1)}%)

CATEGORY BREAKDOWN:
${Object.entries(categoryBreakdown).map(([cat, breakdown]) => 
  `- ${cat}: ${breakdown.count} items, $${breakdown.totalCost.toFixed(2)} total`
).join('\n')}

ACTUAL COSTS (if available):
- Actual Labor Hours: ${Number(actualLabor.total_hours).toFixed(1)} hrs
- Actual Labor Cost: $${Number(actualLabor.total_labor_cost).toFixed(2)}
${Number(actualLabor.total_hours) > 0 ? `- Labor Variance: ${((Number(actualLabor.total_labor_cost) - estimateSummary.laborCost) / estimateSummary.laborCost * 100).toFixed(1)}%` : ''}

Provide comprehensive financial analysis and recommendations.`
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const analysisText = completion.choices[0]?.message?.content;
      if (!analysisText) {
        throw new Error("No analysis generated");
      }

      // Parse JSON response
      const analysis = JSON.parse(analysisText) as {
        riskLevel: string;
        insights: string[];
        costAnalysis: string;
        profitabilityAnalysis: string;
        recommendations: string[];
      };

      res.json({
        ...analysis,
        estimateSummary,
        actualLabor: {
          hours: Number(actualLabor.total_hours),
          cost: Number(actualLabor.total_labor_cost),
        },
        categoryBreakdown,
      });
    } catch (error) {
      console.error("Error analyzing estimate:", error);
      res.status(500).json({ error: "Failed to analyze estimate" });
    }
  });
}

export default registerEstimateRoutes;
