import { Router } from "express";
import { db } from "./db";
import {
  equipment, equipmentAssignments,
  equipmentMaintenanceSchedules, equipmentMaintenanceHistory,
  equipmentRateProfiles, insertEquipmentRateProfileSchema, validatedEquipmentSchema,
  projects, users, auditLog,
} from "@shared/schema";
import { requireAuth, requireRole, requireFeaturePermission, type AuthRequest } from "./auth";
import { eq, desc, sql, and, or } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();
router.use("/api/equipment", requireAuth, requireFeaturePermission('canManageEquipment'));

  // ============================================================
  // EQUIPMENT & TOOL MANAGEMENT ROUTES
  // ============================================================

  // Get all equipment with optional filters
  router.get("/api/equipment", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't see any equipment
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { status, type, search } = req.query;
      
      const conditions: any[] = [];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      if (status && status !== "ALL") {
        conditions.push(eq(equipment.status, status as string));
      }
      
      if (type && type !== "ALL") {
        conditions.push(eq(equipment.type, type as string));
      }
      
      if (search) {
        const searchTerm = `%${String(search).toLowerCase()}%`;
        conditions.push(
          or(
            sql`LOWER(${equipment.name}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.equipmentCode}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.make}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.model}) LIKE ${searchTerm}`,
            sql`LOWER(${equipment.serialNumber}) LIKE ${searchTerm}`
          )
        );
      }
      
      const result = conditions.length > 0
        ? await db.select().from(equipment).where(and(...conditions)).orderBy(equipment.name)
        : await db.select().from(equipment).orderBy(equipment.name);
      
      res.json(result);
    } catch (error) {
      console.error("Get equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Import equipment from CSV (batch create)
  router.post("/api/equipment/import", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      if (mustDenyAccess || !req.user?.organizationId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "No rows provided" });
      }
      if (rows.length > 500) {
        return res.status(400).json({ error: "Maximum 500 rows per import" });
      }

      const existingCodes = await db
        .select({ equipmentCode: equipment.equipmentCode })
        .from(equipment)
        .where(eq(equipment.organizationId, req.user.organizationId));
      const existingCodeSet = new Set(existingCodes.map(e => e.equipmentCode));

      let created = 0;
      let skipped = 0;
      const errors: { row: number; reason: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          if (!row.name || !row.type) {
            errors.push({ row: i + 1, reason: "Name and Type are required" });
            continue;
          }

          let code = row.equipmentCode;
          if (!code) {
            const lastEquipment = await db
              .select({ equipmentCode: equipment.equipmentCode })
              .from(equipment)
              .orderBy(desc(equipment.equipmentCode))
              .limit(1);
            let nextNumber = 1;
            if (lastEquipment.length > 0) {
              const match = lastEquipment[0].equipmentCode.match(/EQ-(\d+)/);
              if (match) nextNumber = parseInt(match[1], 10) + 1;
            }
            code = `EQ-${String(nextNumber + created).padStart(4, '0')}`;
          }

          if (existingCodeSet.has(code)) {
            skipped++;
            continue;
          }

          const validationResult = validatedEquipmentSchema.safeParse({
            ...row,
            equipmentCode: code,
            status: row.status || "AVAILABLE",
          });

          if (!validationResult.success) {
            const msg = validationResult.error.errors.map(e => e.message).join(", ");
            errors.push({ row: i + 1, reason: msg });
            continue;
          }

          await db.insert(equipment).values({
            ...validationResult.data,
            organizationId: req.user.organizationId,
          });

          existingCodeSet.add(code);
          created++;
        } catch (err: any) {
          if (err.constraint === "equipment_equipment_code_unique") {
            skipped++;
          } else {
            errors.push({ row: i + 1, reason: err.message || "Unknown error" });
          }
        }
      }

      if (created > 0) {
        await db.insert(auditLog).values({
          userId: req.user!.id,
          action: "CREATE",
          entityType: "equipment",
          entityId: "bulk-import",
          newValue: `Bulk imported ${created} equipment records (${skipped} skipped, ${errors.length} errors)`,
        });
      }

      res.json({ created, skipped, errors });
    } catch (error) {
      console.error("Import equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get available projects for equipment assignment (must be before :idOrCode route)
  router.get("/api/equipment/available-projects", async (req: AuthRequest, res) => {
    try {
      // Organization filtering: Only show projects from user's organization
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without org can't see any projects
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const conditions = [eq(projects.status, "ACTIVE")];
      if (shouldFilter && orgId) {
        conditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const activeProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          code: projects.code,
        })
        .from(projects)
        .where(and(...conditions))
        .orderBy(projects.name);
      
      res.json(activeProjects);
    } catch (error) {
      console.error("Get available projects error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get single equipment by ID or code
  router.get("/api/equipment/:idOrCode", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't access equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { idOrCode } = req.params;
      
      const conditions = [
        or(
          eq(equipment.id, idOrCode),
          eq(equipment.equipmentCode, idOrCode)
        )
      ];
      
      // SECURITY: Filter by organization
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const result = await db
        .select()
        .from(equipment)
        .where(and(...conditions))
        .limit(1);
      
      if (result.length === 0) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      res.json(result[0]);
    } catch (error) {
      console.error("Get equipment by ID error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create new equipment
  router.post("/api/equipment", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't create equipment
      if (mustDenyAccess || !req.user?.organizationId) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const body = req.body;
      
      // Generate equipment code if not provided
      if (!body.equipmentCode) {
        const lastEquipment = await db
          .select({ equipmentCode: equipment.equipmentCode })
          .from(equipment)
          .orderBy(desc(equipment.equipmentCode))
          .limit(1);
        
        let nextNumber = 1;
        if (lastEquipment.length > 0) {
          const match = lastEquipment[0].equipmentCode.match(/EQ-(\d+)/);
          if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
          }
        }
        body.equipmentCode = `EQ-${String(nextNumber).padStart(4, '0')}`;
      }
      
      // Validate and coerce input using the validated schema
      // This handles empty strings for numeric fields by converting them to null
      const validationResult = validatedEquipmentSchema.safeParse(body);
      if (!validationResult.success) {
        const errors = validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ 
          error: "Validation failed",
          details: errors 
        });
        return;
      }
      
      const validatedData = validationResult.data;
      
      // SECURITY: Set organizationId from authenticated user
      const [newEquipment] = await db.insert(equipment).values({
        ...validatedData,
        organizationId: req.user.organizationId
      }).returning();
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "equipment",
        entityId: newEquipment.id,
        newValue: `Created equipment: ${newEquipment.name} (${newEquipment.equipmentCode})`,
      });
      
      res.status(201).json(newEquipment);
    } catch (error: any) {
      console.error("Create equipment error:", error);
      if (error.constraint === "equipment_equipment_code_unique") {
        res.status(400).json({ error: "Equipment code already exists" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update equipment
  router.patch("/api/equipment/:id", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't update equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const updates = req.body;
      
      // SECURITY: Verify ownership before update
      const conditions = [eq(equipment.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [existing] = await db
        .select()
        .from(equipment)
        .where(and(...conditions))
        .limit(1);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Validate and coerce numeric fields for partial updates
      // Create a partial schema that only validates provided fields
      const partialValidation = validatedEquipmentSchema.partial().safeParse(updates);
      if (!partialValidation.success) {
        const errors = partialValidation.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        res.status(400).json({ 
          error: "Validation failed",
          details: errors 
        });
        return;
      }
      
      const validatedUpdates = partialValidation.data;
      
      // SECURITY: Prevent changing organizationId
      delete (validatedUpdates as any).organizationId;
      
      const [updated] = await db
        .update(equipment)
        .set({ ...validatedUpdates, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      
      if (!updated) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "equipment",
        entityId: id,
        newValue: `Updated equipment: ${updated.name}`,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Update equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete equipment
  router.delete("/api/equipment/:id", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      // SECURITY: Users without organization can't delete equipment
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      
      // SECURITY: Build conditions with org filter
      const conditions = [eq(equipment.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      // SECURITY: Delete with organization filter applied
      const [deleted] = await db
        .delete(equipment)
        .where(and(...conditions))
        .returning();
      
      if (!deleted) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "DELETE",
        entityType: "equipment",
        entityId: id,
        newValue: `Deleted equipment: ${deleted.name} (${deleted.equipmentCode})`,
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Delete equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get upcoming maintenance due (for alerts) — must be before /:equipmentId routes to avoid route shadowing
  router.get("/api/equipment/maintenance/upcoming", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const now = new Date();
      const alertWindow = new Date();
      alertWindow.setDate(alertWindow.getDate() + 14); // 2 weeks ahead
      
      // SECURITY: Build conditions with org filter
      const conditions = [
        eq(equipmentMaintenanceSchedules.isActive, true),
        or(
          // Date-based maintenance due within window
          and(
            sql`${equipmentMaintenanceSchedules.nextDueAt} IS NOT NULL`,
            sql`${equipmentMaintenanceSchedules.nextDueAt} <= ${alertWindow}`
          ),
          // Hours-based maintenance due (within 50 hours)
          sql`(${equipmentMaintenanceSchedules.nextDueHours}::numeric - COALESCE(${equipment.currentHours}::numeric, 0)) <= 50`
        )
      ];
      
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const upcomingMaintenance = await db
        .select({
          scheduleId: equipmentMaintenanceSchedules.id,
          equipmentId: equipmentMaintenanceSchedules.equipmentId,
          equipmentName: equipment.name,
          equipmentCode: equipment.equipmentCode,
          maintenanceName: equipmentMaintenanceSchedules.name,
          maintenanceType: equipmentMaintenanceSchedules.maintenanceType,
          nextDueAt: equipmentMaintenanceSchedules.nextDueAt,
          nextDueHours: equipmentMaintenanceSchedules.nextDueHours,
          currentHours: equipment.currentHours,
        })
        .from(equipmentMaintenanceSchedules)
        .innerJoin(equipment, eq(equipmentMaintenanceSchedules.equipmentId, equipment.id))
        .where(and(...conditions))
        .orderBy(equipmentMaintenanceSchedules.nextDueAt);
      
      res.json(upcomingMaintenance);
    } catch (error) {
      console.error("Get upcoming maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get equipment assignments for a piece of equipment
  router.get("/api/equipment/:equipmentId/assignments", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify parent equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db
        .select()
        .from(equipment)
        .where(and(...equipConditions))
        .limit(1);
      
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const assignments = await db
        .select({
          id: equipmentAssignments.id,
          equipmentId: equipmentAssignments.equipmentId,
          projectId: equipmentAssignments.projectId,
          projectName: projects.name,
          projectCode: projects.code,
          assignedById: equipmentAssignments.assignedById,
          assignedByName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          returnedAt: equipmentAssignments.returnedAt,
          hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
          hoursAtReturn: equipmentAssignments.hoursAtReturn,
          notes: equipmentAssignments.notes,
          isActive: equipmentAssignments.isActive,
        })
        .from(equipmentAssignments)
        .innerJoin(projects, eq(equipmentAssignments.projectId, projects.id))
        .innerJoin(users, eq(equipmentAssignments.assignedById, users.id))
        .where(eq(equipmentAssignments.equipmentId, equipmentId))
        .orderBy(desc(equipmentAssignments.assignedAt));
      
      res.json(assignments);
    } catch (error) {
      console.error("Get equipment assignments error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Assign equipment to project
  router.post("/api/equipment/:equipmentId/assign", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, expectedReturnDate, notes } = req.body;
      
      // SECURITY: Check if equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Check if equipment is available
      if (equipmentItem.status !== "AVAILABLE") {
        res.status(400).json({ error: `Equipment is not available (current status: ${equipmentItem.status})` });
        return;
      }
      
      // Create assignment
      const [assignment] = await db.insert(equipmentAssignments).values({
        equipmentId,
        projectId,
        assignedById: req.user!.id,
        expectedReturnDate: expectedReturnDate || null,
        hoursAtAssignment: equipmentItem.currentHours,
        notes,
        isActive: true,
      }).returning();
      
      // Update equipment status
      await db.update(equipment).set({
        status: "ASSIGNED",
        assignedToProjectId: projectId,
        currentLocation: null, // Will be at project site
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      // Audit log
      const [project] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId));
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "equipment_assignment",
        entityId: assignment.id,
        newValue: `Assigned ${equipmentItem.name} to ${project?.name || projectId}`,
      });
      
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Assign equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Return equipment from assignment
  router.post("/api/equipment/:equipmentId/return", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { returnCondition, endingHours, notes } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Find active assignment
      const [activeAssignment] = await db
        .select()
        .from(equipmentAssignments)
        .where(and(
          eq(equipmentAssignments.equipmentId, equipmentId),
          eq(equipmentAssignments.isActive, true)
        ))
        .limit(1);
      
      if (!activeAssignment) {
        res.status(400).json({ error: "No active assignment found for this equipment" });
        return;
      }
      
      // Update assignment
      const [updated] = await db.update(equipmentAssignments).set({
        returnedAt: new Date(),
        returnedById: req.user!.id,
        returnCondition,
        hoursAtReturn: endingHours,
        notes: notes || activeAssignment.notes,
        isActive: false,
        updatedAt: new Date(),
      }).where(eq(equipmentAssignments.id, activeAssignment.id)).returning();
      
      // Update equipment status and hours
      await db.update(equipment).set({
        status: "AVAILABLE",
        assignedToProjectId: null,
        currentHours: endingHours || undefined,
        currentLocation: null,
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      // Audit log
      await db.insert(auditLog).values({
        userId: req.user!.id,
        action: "UPDATE",
        entityType: "equipment_assignment",
        entityId: activeAssignment.id,
        newValue: `Returned equipment from assignment`,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Return equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance schedules for equipment
  router.get("/api/equipment/:equipmentId/maintenance-schedules", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const schedules = await db
        .select()
        .from(equipmentMaintenanceSchedules)
        .where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId))
        .orderBy(equipmentMaintenanceSchedules.name);
      
      res.json(schedules);
    } catch (error) {
      console.error("Get maintenance schedules error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create maintenance schedule
  router.post("/api/equipment/:equipmentId/maintenance-schedules", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const body = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Calculate next due date based on interval
      let nextDueAt = null;
      let nextDueHours = null;
      
      if (body.intervalDays) {
        nextDueAt = new Date();
        nextDueAt.setDate(nextDueAt.getDate() + body.intervalDays);
      }
      
      if (body.intervalHours) {
        nextDueHours = (parseFloat(equipmentItem.currentHours || "0") + body.intervalHours).toString();
      }
      
      const [schedule] = await db.insert(equipmentMaintenanceSchedules).values({
        equipmentId,
        ...body,
        nextDueAt,
        nextDueHours,
      }).returning();
      
      res.status(201).json(schedule);
    } catch (error) {
      console.error("Create maintenance schedule error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Record maintenance completion
  router.post("/api/equipment/:equipmentId/maintenance-history", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { scheduleId, maintenanceType, description, performedByVendor, laborCost, partsCost, notes, partsUsed } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const totalCost = (parseFloat(laborCost || "0") + parseFloat(partsCost || "0")).toString();
      
      // Create maintenance history record
      const [history] = await db.insert(equipmentMaintenanceHistory).values({
        equipmentId,
        scheduleId,
        maintenanceType,
        description,
        performedAt: new Date(),
        hoursAtMaintenance: equipmentItem.currentHours,
        performedById: req.user!.id,
        performedByVendor,
        laborCost,
        partsCost,
        totalCost,
        notes,
        partsUsed,
      }).returning();
      
      // Update schedule if provided
      if (scheduleId) {
        const [schedule] = await db.select().from(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
        if (schedule) {
          let nextDueAt = null;
          let nextDueHours = null;
          
          if (schedule.intervalDays) {
            nextDueAt = new Date();
            nextDueAt.setDate(nextDueAt.getDate() + schedule.intervalDays);
          }
          
          if (schedule.intervalHours) {
            nextDueHours = (parseFloat(equipmentItem.currentHours || "0") + schedule.intervalHours).toString();
          }
          
          await db.update(equipmentMaintenanceSchedules).set({
            lastPerformedAt: new Date(),
            lastPerformedHours: equipmentItem.currentHours,
            nextDueAt,
            nextDueHours,
            updatedAt: new Date(),
          }).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
        }
      }
      
      // Update equipment maintenance dates
      await db.update(equipment).set({
        lastMaintenanceDate: new Date(),
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(history);
    } catch (error) {
      console.error("Record maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance history for equipment
  router.get("/api/equipment/:equipmentId/maintenance-history", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const history = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt));
      
      res.json(history);
    } catch (error) {
      console.error("Get maintenance history error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // EQUIPMENT RATE PROFILES
  // ============================================

  // Get rate profiles for equipment
  router.get("/api/equipment/:equipmentId/rate-profiles", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const profiles = await db
        .select({
          id: equipmentRateProfiles.id,
          equipmentId: equipmentRateProfiles.equipmentId,
          hourlyRate: equipmentRateProfiles.hourlyRate,
          dailyRate: equipmentRateProfiles.dailyRate,
          weeklyRate: equipmentRateProfiles.weeklyRate,
          monthlyRate: equipmentRateProfiles.monthlyRate,
          fuelCostPerHour: equipmentRateProfiles.fuelCostPerHour,
          maintenanceCostPerHour: equipmentRateProfiles.maintenanceCostPerHour,
          operatorCostPerHour: equipmentRateProfiles.operatorCostPerHour,
          includesOperator: equipmentRateProfiles.includesOperator,
          effectiveDate: equipmentRateProfiles.effectiveDate,
          expirationDate: equipmentRateProfiles.expirationDate,
          isActive: equipmentRateProfiles.isActive,
          notes: equipmentRateProfiles.notes,
          createdAt: equipmentRateProfiles.createdAt,
          createdByName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, 'System')`,
        })
        .from(equipmentRateProfiles)
        .leftJoin(users, eq(equipmentRateProfiles.createdById, users.id))
        .where(eq(equipmentRateProfiles.equipmentId, equipmentId))
        .orderBy(desc(equipmentRateProfiles.effectiveDate));
      
      res.json(profiles);
    } catch (error) {
      console.error("Get equipment rate profiles error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get active rate profile for equipment (most recent active)
  router.get("/api/equipment/:equipmentId/active-rate", async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      const [activeProfile] = await db
        .select()
        .from(equipmentRateProfiles)
        .where(and(
          eq(equipmentRateProfiles.equipmentId, equipmentId),
          eq(equipmentRateProfiles.isActive, true)
        ))
        .orderBy(desc(equipmentRateProfiles.effectiveDate))
        .limit(1);
      
      if (!activeProfile) {
        return res.json(null);
      }
      
      res.json(activeProfile);
    } catch (error) {
      console.error("Get active rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create rate profile for equipment
  router.post("/api/equipment/:equipmentId/rate-profiles", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment exists AND belongs to user's org
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Parse date strings to Date objects
      const bodyWithDates = {
        ...req.body,
        effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      };
      
      const validatedData = insertEquipmentRateProfileSchema.parse({
        ...bodyWithDates,
        equipmentId,
        createdById: userId,
      });
      
      // If this is marked as active, deactivate other profiles
      if (validatedData.isActive) {
        await db.update(equipmentRateProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(equipmentRateProfiles.equipmentId, equipmentId),
            eq(equipmentRateProfiles.isActive, true)
          ));
      }
      
      const [newProfile] = await db.insert(equipmentRateProfiles).values(validatedData).returning();
      
      await logCreate(userId!, "equipment_rate_profiles", newProfile.id, {
        equipmentId,
        hourlyRate: String(validatedData.hourlyRate),
      });
      
      res.status(201).json(newProfile);
    } catch (error) {
      console.error("Create equipment rate profile error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update rate profile
  router.patch("/api/equipment/:equipmentId/rate-profiles/:profileId", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId, profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [existingProfile] = await db.select().from(equipmentRateProfiles).where(
        and(
          eq(equipmentRateProfiles.id, profileId),
          eq(equipmentRateProfiles.equipmentId, equipmentId)
        )
      );
      if (!existingProfile) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      const updateData = {
        ...req.body,
        updatedAt: new Date(),
      };
      
      // If activating this profile, deactivate others
      if (updateData.isActive === true && !existingProfile.isActive) {
        await db.update(equipmentRateProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(and(
            eq(equipmentRateProfiles.equipmentId, equipmentId),
            eq(equipmentRateProfiles.isActive, true)
          ));
      }
      
      const [updatedProfile] = await db.update(equipmentRateProfiles)
        .set(updateData)
        .where(eq(equipmentRateProfiles.id, profileId))
        .returning();
      
      await logUpdate(userId!, "equipment_rate_profiles", profileId, existingProfile, updateData);
      
      res.json(updatedProfile);
    } catch (error) {
      console.error("Update equipment rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Activate rate profile (deactivates others for same equipment)
  router.post("/api/equipment/:equipmentId/rate-profiles/:profileId/activate", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId, profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const [existingProfile] = await db.select().from(equipmentRateProfiles).where(
        and(
          eq(equipmentRateProfiles.id, profileId),
          eq(equipmentRateProfiles.equipmentId, equipmentId)
        )
      );
      if (!existingProfile) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      // Deactivate all other profiles for this equipment
      await db.update(equipmentRateProfiles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(equipmentRateProfiles.equipmentId, equipmentId),
          eq(equipmentRateProfiles.isActive, true)
        ));
      
      // Activate the selected profile
      const [updatedProfile] = await db.update(equipmentRateProfiles)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(equipmentRateProfiles.id, profileId))
        .returning();
      
      await logUpdate(userId!, "equipment_rate_profiles", profileId, existingProfile, { isActive: true });
      
      res.json(updatedProfile);
    } catch (error) {
      console.error("Activate equipment rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete rate profile
  router.delete("/api/equipment/rate-profiles/:profileId", async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { profileId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to equipment to verify rate profile belongs to user's org
      const profileWithEquip = await db
        .select({
          profileId: equipmentRateProfiles.id,
          equipmentId: equipmentRateProfiles.equipmentId,
          organizationId: equipment.organizationId,
        })
        .from(equipmentRateProfiles)
        .innerJoin(equipment, eq(equipmentRateProfiles.equipmentId, equipment.id))
        .where(eq(equipmentRateProfiles.id, profileId))
        .limit(1);
      
      if (profileWithEquip.length === 0) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      // SECURITY: Verify equipment belongs to user's org
      if (shouldFilter && orgId && profileWithEquip[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Rate profile not found" });
      }
      
      await db.delete(equipmentRateProfiles).where(eq(equipmentRateProfiles.id, profileId));
      
      await logDelete(userId!, "equipment_rate_profiles", profileId, { deleted: true });
      
      res.json({ message: "Rate profile deleted successfully" });
    } catch (error) {
      console.error("Delete equipment rate profile error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

export default router;
