import { Router, NextFunction } from "express";
import { db } from "./db";
import { projects, users, procurementItems, subcontractorContracts, tmDailySheets, tmTickets, estimates, estimateLineItems, timeEntries, insertTimeEntrySchema, insertTMDailySheetSchema, insertEstimateSchema, insertProcurementItemSchema, subcontractors, bidSubcontractorQuotes, bidMaterialQuotes } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { logUpdate, logDelete, logCreate, logApprove } from "./auditLogger";

const router = Router();

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
// Time Entry Routes
// ====================

router.get("/api/time-entries", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { page = "1", limit = "50", status, userId, projectId } = req.query;
    
    const parsedPage = Number(page);
    const parsedLimit = Number(limit);

    let pageNum = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
    let limitNum = Number.isInteger(parsedLimit) && parsedLimit >= 1 ? parsedLimit : 50;
    
    if (limitNum > 1000) {
      limitNum = 1000;
    }

    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    
    if (req.user!.role === "FIELD_WORKER") {
      conditions.push(eq(timeEntries.userId, req.user!.id));
    } else if (userId) {
      conditions.push(eq(timeEntries.userId, userId as string));
    }

    if (status) {
      if (status === 'approved') {
        conditions.push(sql`${timeEntries.approvedById} IS NOT NULL`);
      } else if (status === 'pending') {
        conditions.push(sql`${timeEntries.approvedById} IS NULL`);
      }
    }

    if (projectId) {
      conditions.push(eq(timeEntries.projectId, projectId as string));
    }

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timeEntries)
      .where(conditions.length > 0 ? and(...conditions) : sql`true`);
    const totalCount = totalResult[0]?.count || 0;

    let query = db.select().from(timeEntries);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const entries = await query
      .orderBy(desc(timeEntries.date))
      .limit(limitNum)
      .offset(offset);

    const userIds = [...new Set(entries.map(e => e.userId))];
    const userRows = userIds.length > 0
      ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const userMap = new Map(userRows.map(u => [u.id, `${u.firstName} ${u.lastName}`]));

    const enrichedEntries = entries.map(e => ({
      ...e,
      userName: userMap.get(e.userId) || 'Unknown',
    }));

    res.json({
      data: enrichedEntries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
  next(error);
  }
});

router.get("/api/projects/:code/time-entries", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const entries = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.projectId, project.id))
      .orderBy(desc(timeEntries.date));

    res.json(entries);
  } catch (error) {
  next(error);
  }
});

router.post("/api/time-entries", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const validationResult = insertTimeEntrySchema.extend({
      userId: z.string().optional(),
      date: z.coerce.date(),
    }).safeParse({
      ...sanitizedBody,
      userId: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const entryDate = new Date(validationResult.data.date);
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    if (entryDate > now) {
      res.status(400).json({ 
        error: "Invalid date",
        details: "Time entries cannot be created for future dates."
      });
      return;
    }

    if (req.user!.role !== "ADMIN" && entryDate < ninetyDaysAgo) {
      res.status(400).json({ 
        error: "Invalid date",
        details: "Time entries cannot be created for dates more than 90 days in the past. Please contact an administrator."
      });
      return;
    }

    const insertData = { ...validationResult.data, userId: req.user!.id };
    
    const [newEntry] = await db.insert(timeEntries).values([insertData]).returning();
    
    await logCreate(req.user!.id, "TIME_ENTRY", newEntry.id, newEntry, req);
    
    res.status(201).json(newEntry);
  } catch (error) {
  next(error);
  }
});

router.patch("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const sanitizedBody = {
      ...req.body,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
    };

    const schema = z.object({
      date: z.coerce.date().optional(),
      hoursRegular: z.string().optional(),
      hoursOvertime: z.string().optional(),
      costCode: z.string().optional(),
      notes: z.string().optional(),
      adminOverride: z.boolean().optional(),
    });

    const data = schema.parse(sanitizedBody);

    const [existingEntry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, req.params.id))
      .limit(1);

    if (!existingEntry) {
      res.status(404).json({ error: "Time entry not found" });
      return;
    }

    if (existingEntry.approvedAt || existingEntry.approvedById) {
      if (req.user!.role !== "ADMIN" || !data.adminOverride) {
        res.status(403).json({ 
          error: "This time entry has been approved and is locked. Only administrators can modify approved entries with explicit override." 
        });
        return;
      }
    }

    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit your own time entries" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    
    if (data.date) updates.date = data.date;
    if (data.hoursRegular !== undefined) updates.hoursRegular = data.hoursRegular;
    if (data.hoursOvertime !== undefined) updates.hoursOvertime = data.hoursOvertime;
    if (data.costCode !== undefined) updates.costCode = data.costCode;
    if (data.notes !== undefined) updates.notes = data.notes;

    const [updatedEntry] = await db
      .update(timeEntries)
      .set(updates)
      .where(eq(timeEntries.id, req.params.id))
      .returning();

    await logUpdate(
      req.user!.id,
      "TIME_ENTRY",
      req.params.id,
      existingEntry,
      { ...updates, adminOverride: data.adminOverride },
      req
    );

    res.json(updatedEntry);
  } catch (error) {
  next(error);
  }
});

router.delete("/api/time-entries/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [existingEntry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, req.params.id))
      .limit(1);

    if (!existingEntry) {
      res.status(404).json({ error: "Time entry not found" });
      return;
    }

    if ((existingEntry.approvedAt || existingEntry.approvedById) && req.user!.role !== "ADMIN") {
      res.status(403).json({ 
        error: "This time entry has been approved and is locked. Only administrators can delete approved entries." 
      });
      return;
    }

    if (req.user!.role !== "ADMIN" && req.user!.role !== "MANAGER" && existingEntry.userId !== req.user!.id) {
      res.status(403).json({ error: "You can only delete your own time entries" });
      return;
    }

    await db.delete(timeEntries).where(eq(timeEntries.id, req.params.id));

    await logDelete(req.user!.id, "TIME_ENTRY", req.params.id, existingEntry, req);

    res.status(204).send();
  } catch (error) {
  next(error);
  }
});

router.post("/api/time-entries/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const [existingEntry] = await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.id, req.params.id))
      .limit(1);

    if (!existingEntry) {
      res.status(404).json({ error: "Time entry not found" });
      return;
    }

    const [updatedEntry] = await db
      .update(timeEntries)
      .set({
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, req.params.id))
      .returning();

    await logApprove(req.user!.id, "TIME_ENTRY", req.params.id, { approver: req.user!.email }, req);

    res.json(updatedEntry);
  } catch (error) {
  next(error);
  }
});

// ====================
// T&M Daily Sheet Routes
// ====================

router.get("/api/projects/:code/tm-sheets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const tickets = await db
      .select({
        ticket: tmTickets,
        repFirstName: users.firstName,
        repLastName: users.lastName,
      })
      .from(tmTickets)
      .leftJoin(users, eq(tmTickets.tfrRepresentativeId, users.id))
      .where(eq(tmTickets.projectId, project.id))
      .orderBy(desc(tmTickets.workDate));

    const mappedSheets = tickets.map(row => ({
      id: row.ticket.id,
      projectId: row.ticket.projectId,
      date: row.ticket.workDate,
      tfrRepName: row.repFirstName && row.repLastName 
        ? `${row.repFirstName} ${row.repLastName}` 
        : "Unknown",
      clientRepName: null,
      weather: null,
      descriptionOfWork: row.ticket.scopeDescription,
      crewSize: null,
      laborSummaryJson: null,
      equipmentUsedJson: null,
      materialsUsedJson: null,
      attachmentsJson: null,
      clientSignatureName: null,
      clientSignatureDate: null,
      createdById: row.ticket.createdById,
      createdAt: row.ticket.createdAt,
      updatedAt: row.ticket.updatedAt,
      ticketNumber: row.ticket.ticketNumber,
      status: row.ticket.status,
      billingStatus: row.ticket.billingStatus,
      grandTotal: row.ticket.grandTotal,
      workTypeName: row.ticket.workTypeName,
      categoryName: row.ticket.categoryName,
      scopeQuantity: row.ticket.scopeQuantity,
      scopeUnit: row.ticket.scopeUnit,
    }));

    res.json(mappedSheets);
  } catch (error) {
  next(error);
  }
});

router.post("/api/tm-sheets", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const sanitizedBody = {
      ...req.body,
      descriptionOfWork: sanitizeText(req.body.descriptionOfWork),
      weather: req.body.weather ? sanitizeShortText(req.body.weather) : undefined,
    };

    const validationResult = insertTMDailySheetSchema.extend({
      createdById: z.string().optional(),
      date: z.coerce.date(),
    }).safeParse({
      ...sanitizedBody,
      createdById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const insertData = { ...validationResult.data, createdById: req.user!.id };

    const jsonFields: Array<{ field: keyof typeof insertData; value: string | null | undefined; name: string }> = [
      { field: "laborSummaryJson", value: insertData.laborSummaryJson, name: "Labor summary JSON" },
      { field: "equipmentUsedJson", value: insertData.equipmentUsedJson, name: "Equipment used JSON" },
      { field: "materialsUsedJson", value: insertData.materialsUsedJson, name: "Materials used JSON" },
      { field: "attachmentsJson", value: insertData.attachmentsJson, name: "Attachments JSON" },
    ];

    for (const fieldDef of jsonFields) {
      if (fieldDef.value !== null && fieldDef.value !== undefined) {
        const jsonCheck = validateJSONField(fieldDef.value, fieldDef.name);
        if (!jsonCheck.valid) {
          res.status(400).json({ error: jsonCheck.error });
          return;
        }
        if (fieldDef.value === "" || jsonCheck.parsed === null) {
          (insertData as any)[fieldDef.field] = null;
        }
      }
    }

    const [existingSheet] = await db
      .select()
      .from(tmDailySheets)
      .where(
        and(
          eq(tmDailySheets.projectId, insertData.projectId),
          sql`DATE(${tmDailySheets.date}) = DATE(${insertData.date})`
        )
      )
      .limit(1);

    if (existingSheet) {
      res.status(409).json({ 
        error: "T&M sheet already exists for this project and date",
        details: "A Time & Materials sheet has already been created for this project on the specified date."
      });
      return;
    }

    const [newSheet] = await db.insert(tmDailySheets).values([insertData]).returning();
    res.status(201).json(newSheet);
  } catch (error) {
  next(error);
  }
});

// ====================
// Estimates Routes
// ====================

router.get("/api/projects/:code/estimates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const projectEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, project.id))
      .orderBy(desc(estimates.versionNumber));

    res.json(projectEstimates);
  } catch (error) {
  next(error);
  }
});

router.get("/api/projects/:id/estimate", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const projectId = req.params.id;
    
    const projectEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, projectId))
      .orderBy(desc(estimates.versionNumber));
    
    if (projectEstimates.length === 0) {
      res.json({ estimate: null });
      return;
    }
    
    const activeEstimate = projectEstimates.find(e => e.status === "APPROVED") || projectEstimates[0];
    
    const lineItems = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, activeEstimate.id));
    
    const totals = lineItems.reduce((acc, item) => {
      return {
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        laborHours: acc.laborHours + Number(item.laborHours || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      };
    }, {
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
    
    res.json({
      estimate: {
        ...activeEstimate,
        lineItems,
        totals,
      }
    });
  } catch (error) {
  next(error);
  }
});

router.post("/api/projects/:id/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const projectId = req.params.id;
    
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const existingEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.projectId, projectId))
      .limit(1);
    
    if (existingEstimates.length > 0) {
      const estimate = existingEstimates[0];
      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));
      
      const totals = lineItems.reduce((acc, item) => ({
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        laborHours: acc.laborHours + Number(item.laborHours || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      }), {
        materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
        consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
        profitAllocation: 0, totalCost: 0,
      });
      
      res.json({ estimate: { ...estimate, lineItems, totals } });
      return;
    }
    
    const [newEstimate] = await db.insert(estimates).values({
      projectId,
      createdById: req.user!.id,
      status: "DRAFT",
      versionNumber: 1,
    }).returning();
    
    res.status(201).json({
      estimate: {
        ...newEstimate,
        lineItems: [],
        totals: {
          materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
          consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
          profitAllocation: 0, totalCost: 0,
        }
      }
    });
  } catch (error) {
  next(error);
  }
});

router.post("/api/estimates", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const validationResult = insertEstimateSchema.extend({
      createdById: z.string().optional(),
    }).safeParse({
      ...req.body,
      createdById: req.user!.id,
    });
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const jsonFields: Array<{ field: keyof typeof validationResult.data; value: string | null | undefined; name: string }> = [
      { field: "altPricesJson", value: validationResult.data.altPricesJson, name: "Alternative prices JSON" },
      { field: "costBreakdownJson", value: validationResult.data.costBreakdownJson, name: "Cost breakdown JSON" },
    ];

    for (const fieldDef of jsonFields) {
      if (fieldDef.value !== null && fieldDef.value !== undefined) {
        const jsonCheck = validateJSONField(fieldDef.value, fieldDef.name);
        if (!jsonCheck.valid) {
          res.status(400).json({ error: jsonCheck.error });
          return;
        }
        if (fieldDef.value === "" || jsonCheck.parsed === null) {
          (validationResult.data as any)[fieldDef.field] = null;
        }
      }
    }

    const insertData = { ...validationResult.data, createdById: req.user!.id };
    const [newEstimate] = await db.insert(estimates).values([insertData]).returning();
    res.status(201).json(newEstimate);
  } catch (error) {
  next(error);
  }
});

// ====================
// Procurement Routes
// ====================

router.get("/api/projects/:code/procurement", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const items = await db
      .select()
      .from(procurementItems)
      .where(eq(procurementItems.projectId, project.id));

    res.json(items);
  } catch (error) {
  next(error);
  }
});

router.post("/api/procurement", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const validationResult = insertProcurementItemSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const data = validationResult.data;

    const [project] = await db.select().from(projects).where(eq(projects.id, data.projectId)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const [newItem] = await db.insert(procurementItems).values(data).returning();
    res.status(201).json(newItem);
  } catch (error) {
  next(error);
  }
});

const updateProcurementSchema = insertProcurementItemSchema.omit({ projectId: true }).partial();

router.patch("/api/procurement/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const validationResult = updateProcurementSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [existing] = await db.select().from(procurementItems).where(eq(procurementItems.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Procurement item not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project || !verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedItem] = await db
      .update(procurementItems)
      .set(updateData)
      .where(eq(procurementItems.id, req.params.id))
      .returning();

    res.json(updatedItem);
  } catch (error) {
  next(error);
  }
});

router.delete("/api/procurement/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const [existing] = await db.select().from(procurementItems).where(eq(procurementItems.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Procurement item not found" });
      return;
    }

    const [project] = await db.select().from(projects).where(eq(projects.id, existing.projectId)).limit(1);
    if (!project || !verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    await db.delete(procurementItems).where(eq(procurementItems.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

// ====================
// Pending Quotes Routes (for quotes transferred from bids but not yet selected)
// ====================

router.get("/api/projects/:code/pending-quotes", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const pendingSubQuotes = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(and(
        eq(bidSubcontractorQuotes.projectId, project.id),
        eq(bidSubcontractorQuotes.isSelected, false)
      ))
      .orderBy(desc(bidSubcontractorQuotes.createdAt));

    const pendingMatQuotes = await db
      .select()
      .from(bidMaterialQuotes)
      .where(and(
        eq(bidMaterialQuotes.projectId, project.id),
        eq(bidMaterialQuotes.isSelected, false)
      ))
      .orderBy(desc(bidMaterialQuotes.createdAt));

    res.json({
      subcontractorQuotes: pendingSubQuotes,
      materialQuotes: pendingMatQuotes,
    });
  } catch (error) {
  next(error);
  }
});

router.post("/api/projects/:code/pending-quotes/subcontractor/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [quote] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(and(
        eq(bidSubcontractorQuotes.id, req.params.quoteId),
        eq(bidSubcontractorQuotes.projectId, project.id),
        eq(bidSubcontractorQuotes.isSelected, false)
      ))
      .limit(1);

    if (!quote) {
      res.status(404).json({ error: "Pending quote not found" });
      return;
    }

    let subcontractor;
    if (quote.contactEmail || quote.contactPhone) {
      const { or, and: andFn } = await import("drizzle-orm");
      const contactConditions = [];
      if (quote.contactEmail) {
        contactConditions.push(eq(subcontractors.email, quote.contactEmail));
      }
      if (quote.contactPhone) {
        contactConditions.push(eq(subcontractors.phone, quote.contactPhone));
      }
      
      subcontractor = await db.query.subcontractors.findFirst({
        where: andFn(
          eq(subcontractors.companyName, quote.subcontractorName),
          or(...contactConditions)
        ),
      });
    }
    
    if (!subcontractor) {
      subcontractor = await db.query.subcontractors.findFirst({
        where: eq(subcontractors.companyName, quote.subcontractorName),
      });
    }

    if (!subcontractor) {
      [subcontractor] = await db.insert(subcontractors).values({
        companyName: quote.subcontractorName,
        contactName: quote.contactName || null,
        email: quote.contactEmail || null,
        phone: quote.contactPhone || null,
        notes: quote.notes || null,
        isActive: true,
      }).returning();
    }

    const existingContracts = await db
      .select()
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.projectId, project.id));

    const contractNumber = `SC-${project.code}-${String(existingContracts.length + 1).padStart(3, '0')}`;
    const paymentTerms = quote.leadTime ? `Lead Time: ${quote.leadTime}`.substring(0, 500) : null;
    
    const notesParts: string[] = [];
    if (quote.estimatedCompletionTime) notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
    if (quote.notes) notesParts.push(quote.notes);
    if (quote.fileUrl) {
      const sanitizedFileName = (quote.fileName || 'Document').replace(/[\r\n]/g, ' ').trim();
      notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
    }
    
    const notes = notesParts.length > 0 ? notesParts.join('\n').substring(0, 1000) : null;
    
    const [newContract] = await db.insert(subcontractorContracts).values({
      subcontractorId: subcontractor.id,
      projectId: project.id,
      contractNumber,
      scopeOfWork: quote.scopeOfWork,
      contractAmount: quote.quoteAmount,
      status: "PENDING",
      paymentTerms,
      notes,
      createdById: req.user!.id,
    }).returning();

    await db
      .update(bidSubcontractorQuotes)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, quote.id));

    res.json({ 
      success: true, 
      contract: newContract,
      message: `Subcontractor contract created: ${contractNumber}`
    });
  } catch (error) {
  next(error);
  }
});

router.post("/api/projects/:code/pending-quotes/material/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [quote] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(and(
        eq(bidMaterialQuotes.id, req.params.quoteId),
        eq(bidMaterialQuotes.projectId, project.id),
        eq(bidMaterialQuotes.isSelected, false)
      ))
      .limit(1);

    if (!quote) {
      res.status(404).json({ error: "Pending quote not found" });
      return;
    }

    let fullDescription = quote.materialName;
    if (quote.specs) fullDescription += ` - ${quote.specs}`;
    if (quote.description) fullDescription += `\n${quote.description}`;
    
    const additionalInfo: string[] = [];
    if (quote.leadTime) additionalInfo.push(`Lead Time: ${quote.leadTime}`);
    if (quote.supplierContact) additionalInfo.push(`Supplier Contact: ${quote.supplierContact}`);
    
    if (additionalInfo.length > 0) {
      fullDescription += `\n\n[Quote Details]\n${additionalInfo.join('\n')}`;
    }
    
    const [newItem] = await db.insert(procurementItems).values({
      projectId: project.id,
      description: fullDescription,
      vendor: quote.supplierName || null,
      quantity: "1",
      unit: "LOT",
      unitCost: quote.cost,
      status: "PLANNED",
      neededByDate: null,
    }).returning();

    await db
      .update(bidMaterialQuotes)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(bidMaterialQuotes.id, quote.id));

    res.json({ 
      success: true, 
      procurementItem: newItem,
      message: `Procurement item created: ${quote.materialName}`
    });
  } catch (error) {
  next(error);
  }
});

export default router;
