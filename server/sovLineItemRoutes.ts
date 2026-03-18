import { Router, Response } from "express";
import { insertNotifications } from "./services/notificationService";
import { z } from "zod";
import { db } from "./db";
import { 
  sovLineItems, 
  projects, 
  users,
  notifications,
  estimateLineItems,
  scheduleOfValues,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, AuthRequest, requireRole } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { verifySOVAccess, calculateSOVTotals } from "./sovHelpers";

const router = Router();

const addLineItemSchema = z.object({
  description: z.string(),
  scheduledValue: z.string().or(z.number()),
  itemCode: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
  estimateLineItemId: z.string().optional(),
  organizationSowItemId: z.string().optional(),
});

router.post("/sov/:id/items", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { id: sovId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const validationResult = addLineItemSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const { description, scheduledValue, itemCode, category, notes, estimateLineItemId, organizationSowItemId } = validationResult.data;

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only add line items to DRAFT SOVs" });
    }

    const existingItems = await db
      .select({ maxLine: sql<number>`COALESCE(MAX(line_number), 0)` })
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, sovId));

    const nextLineNumber = (existingItems[0]?.maxLine || 0) + 1;
    const scheduled = Math.max(0, Number(scheduledValue) || 0);
    const retainagePct = Math.max(0, Math.min(100, Number(sov.retainagePercent || 10))) / 100;

    let resolvedSowItemId = organizationSowItemId || null;
    if (!resolvedSowItemId && estimateLineItemId) {
      const [estItem] = await db
        .select({ organizationSowItemId: estimateLineItems.organizationSowItemId })
        .from(estimateLineItems)
        .where(eq(estimateLineItems.id, estimateLineItemId))
        .limit(1);
      if (estItem?.organizationSowItemId) {
        resolvedSowItemId = estItem.organizationSowItemId;
      }
    }

    const [newItem] = await db
      .insert(sovLineItems)
      .values({
        sovId,
        lineNumber: nextLineNumber,
        itemCode: itemCode || null,
        description,
        category: category || null,
        scheduledValue: String(scheduled),
        previouslyCompleted: "0",
        thisPeriodCompleted: "0",
        materialsStored: "0",
        totalCompletedAndStored: "0",
        percentComplete: "0",
        balanceToFinish: String(scheduled),
        retainageAmount: "0",
        notes: notes || null,
        estimateLineItemId: estimateLineItemId || null,
        organizationSowItemId: resolvedSowItemId,
      })
      .returning();

    const allLineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, sovId));

    const totals = calculateSOVTotals(allLineItems, retainagePct);

    await db
      .update(scheduleOfValues)
      .set({
        ...totals,
        updatedAt: new Date(),
      })
      .where(eq(scheduleOfValues.id, sovId));

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Add SOV line item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/sov/:sovId/items/:itemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { sovId, itemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only delete line items from DRAFT SOVs" });
    }

    const [deletedItem] = await db
      .delete(sovLineItems)
      .where(
        and(
          eq(sovLineItems.id, itemId),
          eq(sovLineItems.sovId, sovId)
        )
      )
      .returning();

    if (!deletedItem) {
      return res.status(404).json({ error: "Line item not found" });
    }

    const allLineItems = await db
      .select()
      .from(sovLineItems)
      .where(eq(sovLineItems.sovId, sovId));

    const retainagePct = Math.max(0, Math.min(100, Number(sov.retainagePercent || 10))) / 100;
    const totals = calculateSOVTotals(allLineItems, retainagePct);

    await db
      .update(scheduleOfValues)
      .set({
        ...totals,
        updatedAt: new Date(),
      })
      .where(eq(scheduleOfValues.id, sovId));

    res.json({ success: true });
  } catch (error) {
    console.error("Delete SOV line item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const updateLineItemSchema = z.object({
  previouslyCompleted: z.string().or(z.number()).optional(),
  thisPeriodCompleted: z.string().or(z.number()).optional(),
  materialsStored: z.string().or(z.number()).optional(),
  notes: z.string().optional(),
});

router.patch("/sov/:sovId/line-items/:lineItemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { sovId, lineItemId } = req.params;
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    const { sov, hasAccess } = await verifySOVAccess(sovId, orgId, shouldFilter);

    if (!sov || !hasAccess) {
      return res.status(404).json({ error: "SOV not found" });
    }

    if (sov.status !== "DRAFT") {
      return res.status(400).json({ error: "Can only update line items on DRAFT SOVs" });
    }

    const validationResult = updateLineItemSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationResult.error.flatten() 
      });
    }

    const [lineItem] = await db
      .select()
      .from(sovLineItems)
      .where(and(
        eq(sovLineItems.id, lineItemId),
        eq(sovLineItems.sovId, sovId)
      ))
      .limit(1);

    if (!lineItem) {
      return res.status(404).json({ error: "Line item not found" });
    }

    const updates = validationResult.data;
    const scheduled = Math.max(0, Number(lineItem.scheduledValue) || 0);
    const previous = Math.max(0, Number(updates.previouslyCompleted ?? lineItem.previouslyCompleted ?? 0));
    const current = Math.max(0, Number(updates.thisPeriodCompleted ?? lineItem.thisPeriodCompleted ?? 0));
    const stored = Math.max(0, Number(updates.materialsStored ?? lineItem.materialsStored ?? 0));
    const retainagePct = Math.max(0, Math.min(100, Number(sov.retainagePercent || 10))) / 100;

    const totalCompleted = previous + current + stored;
    const percentComplete = scheduled > 0 ? Math.min(100, (totalCompleted / scheduled) * 100) : 0;
    const balance = Math.max(0, scheduled - totalCompleted);
    const retainageAmt = totalCompleted * retainagePct;

    const result = await db.execute(sql`
      WITH locked_item AS (
        SELECT 
          id,
          COALESCE(CAST(previously_completed AS DECIMAL(14,2)), 0) as old_previous,
          COALESCE(CAST(this_period_completed AS DECIMAL(14,2)), 0) as old_current,
          COALESCE(CAST(materials_stored AS DECIMAL(14,2)), 0) as old_stored
        FROM sov_line_items 
        WHERE id = ${lineItemId} 
        FOR UPDATE
      ),
      deltas AS (
        SELECT
          ${previous} - old_previous as delta_previous,
          ${current} - old_current as delta_current,
          ${stored} - old_stored as delta_stored,
          (${previous} - old_previous) + (${current} - old_current) + (${stored} - old_stored) as delta_total
        FROM locked_item
      ),
      updated_line_item AS (
        UPDATE sov_line_items
        SET 
          previously_completed = ${String(previous)},
          this_period_completed = ${String(current)},
          materials_stored = ${String(stored)},
          total_completed_and_stored = ${String(totalCompleted)},
          percent_complete = ${String(percentComplete.toFixed(2))},
          balance_to_finish = ${String(balance)},
          retainage_amount = ${String(retainageAmt.toFixed(2))},
          notes = ${updates.notes ?? lineItem.notes ?? null},
          updated_at = NOW()
        WHERE id = ${lineItemId}
        RETURNING *
      ),
      updated_sov AS (
        UPDATE schedule_of_values
        SET 
          total_previously_completed = GREATEST(0, 
            COALESCE(CAST(schedule_of_values.total_previously_completed AS DECIMAL(14,2)), 0) + deltas.delta_previous
          )::text,
          total_this_period = GREATEST(0,
            COALESCE(CAST(schedule_of_values.total_this_period AS DECIMAL(14,2)), 0) + deltas.delta_current
          )::text,
          total_materials_stored = GREATEST(0,
            COALESCE(CAST(schedule_of_values.total_materials_stored AS DECIMAL(14,2)), 0) + deltas.delta_stored
          )::text,
          total_completed_to_date = GREATEST(0,
            COALESCE(CAST(schedule_of_values.total_completed_to_date AS DECIMAL(14,2)), 0) + deltas.delta_total
          )::text,
          total_retainage = ROUND(
            GREATEST(0, COALESCE(CAST(schedule_of_values.total_completed_to_date AS DECIMAL(14,2)), 0) + deltas.delta_total) * ${retainagePct}
          , 2)::text,
          total_earned_less_retainage = ROUND(
            GREATEST(0, COALESCE(CAST(schedule_of_values.total_completed_to_date AS DECIMAL(14,2)), 0) + deltas.delta_total) * (1 - ${retainagePct})
          , 2)::text,
          updated_at = NOW()
        FROM deltas
        WHERE schedule_of_values.id = ${sovId}
        RETURNING schedule_of_values.*
      )
      SELECT * FROM updated_line_item
    `);

    const rows = result.rows as Record<string, unknown>[];
    const updated = rows[0] || lineItem;

    const oldPercent = Number(lineItem.percentComplete || 0);
    if (percentComplete >= 100 && oldPercent < 100) {
      try {
        const [project] = await db
          .select({ id: projects.id, code: projects.code, gcOrganizationId: projects.gcOrganizationId })
          .from(projects)
          .where(eq(projects.id, sov.projectId))
          .limit(1);

        if (project?.gcOrganizationId) {
          const officeManagers = await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.organizationId, project.gcOrganizationId),
                eq(users.role, "OFFICE_MANAGER"),
                eq(users.isActive, true)
              )
            );

          if (officeManagers.length > 0) {
            const formattedValue = `$${Number(lineItem.scheduledValue || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
            const sovNotifs = officeManagers.map((mgr) => ({
              userId: mgr.id,
              type: "SOV_ITEM_COMPLETED" as const,
              title: "SOV Line Item 100% Complete",
              message: `"${lineItem.description}" (${formattedValue}) is fully complete on ${sov.title} - project ${project.code || "Unknown"}`,
              relatedEntityId: project.id,
              relatedEntityType: "project" as const,
            }));
            await insertNotifications(sovNotifs);
          }
        }
      } catch (notifError) {
        console.error("Failed to create SOV completion notification:", notifError);
      }
    }

    res.json(updated);
  } catch (error) {
    console.error("Update SOV line item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
