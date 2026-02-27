import { Router } from "express";
import { db } from "./db";
import {
  equipment, equipmentAssignments, equipmentRepairs,
  equipmentMaintenanceSchedules, equipmentMaintenanceHistory,
  equipmentHourLogs,
  equipmentRateProfiles, insertEquipmentRateProfileSchema, validatedEquipmentSchema,
  rentalVendors, insertRentalVendorSchema,
  rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema,
  bidEquipmentSelections,
  projectEquipmentPlans,
  projects, bids, users, notifications, auditLog,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, ne, desc, sql, and, or } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";

const router = Router();

  // ============================================================
  // EQUIPMENT & TOOL MANAGEMENT ROUTES
  // ============================================================

  // Get all equipment with optional filters
  router.get("/api/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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

  // Get available projects for equipment assignment (must be before :idOrCode route)
  router.get("/api/equipment/available-projects", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.get("/api/equipment/:idOrCode", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.patch("/api/equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.delete("/api/equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.get("/api/equipment/maintenance/upcoming", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.get("/api/equipment/:equipmentId/assignments", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment/:equipmentId/assign", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment/:equipmentId/return", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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

  // Get equipment repairs
  router.get("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      
      const repairs = await db
        .select({
          id: equipmentRepairs.id,
          repairNumber: equipmentRepairs.repairNumber,
          description: equipmentRepairs.description,
          status: equipmentRepairs.status,
          problemReportedAt: equipmentRepairs.problemReportedAt,
          problemDescription: equipmentRepairs.problemDescription,
          repairLocation: equipmentRepairs.repairLocation,
          estimatedCost: equipmentRepairs.estimatedCost,
          actualCost: equipmentRepairs.actualCost,
          estimatedCompletionDate: equipmentRepairs.estimatedCompletionDate,
          completedAt: equipmentRepairs.completedAt,
          repairNotes: equipmentRepairs.repairNotes,
          createdAt: equipmentRepairs.createdAt,
          reportedByName: sql<string>`reporter.first_name || ' ' || reporter.last_name`,
        })
        .from(equipmentRepairs)
        .innerJoin(sql`users as reporter`, sql`${equipmentRepairs.problemReportedById} = reporter.id`)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt));
      
      res.json(repairs);
    } catch (error) {
      console.error("Get equipment repairs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Report equipment repair
  router.post("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { description, problemDescription, repairLocation, estimatedCost, estimatedCompletionDate } = req.body;
      
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
      
      // Generate repair number
      const lastRepair = await db
        .select({ repairNumber: equipmentRepairs.repairNumber })
        .from(equipmentRepairs)
        .orderBy(desc(equipmentRepairs.createdAt))
        .limit(1);
      
      let nextNumber = 1;
      if (lastRepair.length > 0) {
        const match = lastRepair[0].repairNumber.match(/REP-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1], 10) + 1;
        }
      }
      const repairNumber = `REP-${String(nextNumber).padStart(4, '0')}`;
      
      // Create repair record
      const [repair] = await db.insert(equipmentRepairs).values({
        equipmentId,
        repairNumber,
        description,
        status: "PENDING",
        problemReportedById: req.user!.id,
        problemDescription,
        hoursAtReport: equipmentItem.currentHours,
        repairLocation,
        estimatedCost,
        estimatedCompletionDate: estimatedCompletionDate || null,
      }).returning();
      
      // Update equipment status
      await db.update(equipment).set({
        status: "IN_REPAIR",
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(repair);
    } catch (error) {
      console.error("Create repair error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update repair status
  router.patch("/api/equipment/repairs/:repairId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { repairId } = req.params;
      const updates = req.body;
      
      // Get repair to find equipment
      const [repair] = await db.select().from(equipmentRepairs).where(eq(equipmentRepairs.id, repairId));
      if (!repair) {
        res.status(404).json({ error: "Repair not found" });
        return;
      }
      
      // SECURITY: Verify parent equipment belongs to user's org
      const equipConditions = [eq(equipment.id, repair.equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      // Handle status change to COMPLETED
      if (updates.status === "COMPLETED" && repair.status !== "COMPLETED") {
        updates.completedAt = new Date();
        updates.completedById = req.user!.id;
        
        // Update equipment status back to AVAILABLE
        await db.update(equipment).set({
          status: "AVAILABLE",
          updatedAt: new Date(),
        }).where(eq(equipment.id, repair.equipmentId));
      }
      
      const [updated] = await db
        .update(equipmentRepairs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(equipmentRepairs.id, repairId))
        .returning();
      
      res.json(updated);
    } catch (error) {
      console.error("Update repair error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance schedules for equipment
  router.get("/api/equipment/:equipmentId/maintenance-schedules", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment/:equipmentId/maintenance-schedules", requireAuth, requireRole("ADMIN", "MANAGER", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment/:equipmentId/maintenance-history", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.get("/api/equipment/:equipmentId/maintenance-history", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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

  // Get equipment assigned to a project
  router.get("/api/projects/:projectId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // SECURITY: Also filter equipment by org to prevent cross-org data leakage
      const equipmentConditions = [eq(equipmentAssignments.projectId, projectId)];
      if (shouldFilter && orgId) {
        equipmentConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const projectEquipment = await db
        .select({
          assignmentId: equipmentAssignments.id,
          equipmentId: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          currentHours: equipment.currentHours,
          status: equipment.status,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          hoursAtAssignment: equipmentAssignments.hoursAtAssignment,
          isActive: equipmentAssignments.isActive,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipmentAssignments.equipmentId, equipment.id))
        .where(and(...equipmentConditions))
        .orderBy(desc(equipmentAssignments.assignedAt));
      
      res.json(projectEquipment);
    } catch (error) {
      console.error("Get project equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get project equipment plans (from bid or manually added)
  router.get("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const plans = await db
        .select()
        .from(projectEquipmentPlans)
        .where(eq(projectEquipmentPlans.projectId, projectId))
        .orderBy(projectEquipmentPlans.createdAt);
      
      res.json(plans);
    } catch (error) {
      console.error("Get project equipment plans error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add equipment plan to project
  router.post("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify project exists AND belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const { source, equipmentName, equipmentType } = req.body;
      if (!source || !equipmentName || !equipmentType) {
        return res.status(400).json({ error: "Source, equipment name, and type are required" });
      }
      
      const [newPlan] = await db.insert(projectEquipmentPlans).values({
        projectId,
        source: req.body.source,
        status: "PLANNED" as const,
        equipmentId: req.body.equipmentId || null,
        rentalCatalogId: req.body.rentalCatalogId || null,
        rentalVendorId: req.body.rentalVendorId || null,
        equipmentName: req.body.equipmentName,
        equipmentType: req.body.equipmentType,
        plannedHours: req.body.plannedHours != null ? String(req.body.plannedHours) : null,
        plannedDays: req.body.plannedDays != null ? Number(req.body.plannedDays) : null,
        plannedStartDate: req.body.plannedStartDate ? new Date(req.body.plannedStartDate) : null,
        plannedEndDate: req.body.plannedEndDate ? new Date(req.body.plannedEndDate) : null,
        plannedCost: req.body.plannedCost != null ? String(req.body.plannedCost) : null,
        hourlyRate: req.body.hourlyRate != null ? String(req.body.hourlyRate) : null,
        dailyRate: req.body.dailyRate != null ? String(req.body.dailyRate) : null,
        notes: req.body.notes || null,
        createdById: userId!,
      }).returning();
      
      await logCreate(userId!, "project_equipment_plans", newPlan.id, { projectId, equipmentName: req.body.equipmentName });
      
      res.status(201).json(newPlan);
    } catch (error) {
      console.error("Create project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update project equipment plan
  router.patch("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // SECURITY: Define conditions for both SELECT and UPDATE to prevent TOCTOU
      const planConditions = and(
        eq(projectEquipmentPlans.id, planId),
        eq(projectEquipmentPlans.projectId, projectId)
      );
      
      const [existing] = await db.select()
        .from(projectEquipmentPlans)
        .where(planConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment plan not found" });
      }
      
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (req.body.source !== undefined) updateData.source = req.body.source;
      if (req.body.status !== undefined) updateData.status = req.body.status;
      if (req.body.equipmentId !== undefined) updateData.equipmentId = req.body.equipmentId || null;
      if (req.body.assignmentId !== undefined) updateData.assignmentId = req.body.assignmentId || null;
      if (req.body.rentalCatalogId !== undefined) updateData.rentalCatalogId = req.body.rentalCatalogId || null;
      if (req.body.rentalVendorId !== undefined) updateData.rentalVendorId = req.body.rentalVendorId || null;
      if (req.body.equipmentName !== undefined) updateData.equipmentName = req.body.equipmentName;
      if (req.body.equipmentType !== undefined) updateData.equipmentType = req.body.equipmentType;
      if (req.body.plannedHours !== undefined) updateData.plannedHours = req.body.plannedHours != null ? String(req.body.plannedHours) : null;
      if (req.body.plannedDays !== undefined) updateData.plannedDays = req.body.plannedDays != null ? Number(req.body.plannedDays) : null;
      if (req.body.plannedStartDate !== undefined) updateData.plannedStartDate = req.body.plannedStartDate ? new Date(req.body.plannedStartDate) : null;
      if (req.body.plannedEndDate !== undefined) updateData.plannedEndDate = req.body.plannedEndDate ? new Date(req.body.plannedEndDate) : null;
      if (req.body.plannedCost !== undefined) updateData.plannedCost = req.body.plannedCost != null ? String(req.body.plannedCost) : null;
      if (req.body.actualHours !== undefined) updateData.actualHours = req.body.actualHours != null ? String(req.body.actualHours) : null;
      if (req.body.actualDays !== undefined) updateData.actualDays = req.body.actualDays != null ? Number(req.body.actualDays) : null;
      if (req.body.actualStartDate !== undefined) updateData.actualStartDate = req.body.actualStartDate ? new Date(req.body.actualStartDate) : null;
      if (req.body.actualEndDate !== undefined) updateData.actualEndDate = req.body.actualEndDate ? new Date(req.body.actualEndDate) : null;
      if (req.body.actualCost !== undefined) updateData.actualCost = req.body.actualCost != null ? String(req.body.actualCost) : null;
      if (req.body.hourlyRate !== undefined) updateData.hourlyRate = req.body.hourlyRate != null ? String(req.body.hourlyRate) : null;
      if (req.body.dailyRate !== undefined) updateData.dailyRate = req.body.dailyRate != null ? String(req.body.dailyRate) : null;
      if (req.body.rentalConfirmationNumber !== undefined) updateData.rentalConfirmationNumber = req.body.rentalConfirmationNumber || null;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes || null;
      
      // SECURITY: Use same conditions in UPDATE to prevent TOCTOU race condition
      const [updated] = await db
        .update(projectEquipmentPlans)
        .set(updateData)
        .where(planConditions)
        .returning();
      
      await logUpdate(userId!, "project_equipment_plans", planId, existing, updated);
      
      res.json(updated);
    } catch (error) {
      console.error("Update project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete project equipment plan
  router.delete("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify project belongs to user's org
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // SECURITY: Include projectId in both SELECT and DELETE to prevent TOCTOU
      const planConditions = and(
        eq(projectEquipmentPlans.id, planId),
        eq(projectEquipmentPlans.projectId, projectId)
      );
      
      const [existing] = await db.select()
        .from(projectEquipmentPlans)
        .where(planConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment plan not found" });
      }
      
      // SECURITY: Use same conditions in DELETE to prevent TOCTOU race condition
      await db.delete(projectEquipmentPlans).where(planConditions);
      
      await logDelete(userId!, "project_equipment_plans", planId, { equipmentName: existing.equipmentName });
      
      res.status(204).send();
    } catch (error) {
      console.error("Delete project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Submit weekly hour log for equipment
  router.post("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, weekStartDate, weekEndDate, startingHours, endingHours, notes, fuelUsed } = req.body;
      
      // SECURITY: Verify equipment belongs to user's org
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const hoursUsed = (parseFloat(endingHours) - parseFloat(startingHours)).toString();
      
      // Find active assignment
      const [assignment] = await db
        .select()
        .from(equipmentAssignments)
        .where(and(
          eq(equipmentAssignments.equipmentId, equipmentId),
          eq(equipmentAssignments.projectId, projectId),
          eq(equipmentAssignments.isActive, true)
        ));
      
      const [log] = await db.insert(equipmentHourLogs).values({
        equipmentId,
        assignmentId: assignment?.id,
        projectId,
        weekStartDate,
        weekEndDate,
        startingHours,
        endingHours,
        hoursUsed,
        submittedById: req.user!.id,
        notes: notes || null,
        fuelUsed: fuelUsed && fuelUsed !== "" ? fuelUsed : null,
      }).returning();
      
      // Update equipment current hours
      await db.update(equipment).set({
        currentHours: endingHours,
        updatedAt: new Date(),
      }).where(eq(equipment.id, equipmentId));
      
      res.status(201).json(log);
    } catch (error: any) {
      console.error("Submit hour log error:", error);
      if (error.constraint === "equipment_hour_logs_unique_week") {
        res.status(400).json({ error: "Hour log already exists for this week" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get hour logs for equipment
  router.get("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
      
      const logs = await db
        .select({
          id: equipmentHourLogs.id,
          weekStartDate: equipmentHourLogs.weekStartDate,
          weekEndDate: equipmentHourLogs.weekEndDate,
          startingHours: equipmentHourLogs.startingHours,
          endingHours: equipmentHourLogs.endingHours,
          hoursUsed: equipmentHourLogs.hoursUsed,
          notes: equipmentHourLogs.notes,
          fuelUsed: equipmentHourLogs.fuelUsed,
          submittedAt: equipmentHourLogs.submittedAt,
          projectName: projects.name,
          projectCode: projects.code,
        })
        .from(equipmentHourLogs)
        .innerJoin(projects, eq(equipmentHourLogs.projectId, projects.id))
        .where(eq(equipmentHourLogs.equipmentId, equipmentId))
        .orderBy(desc(equipmentHourLogs.weekStartDate));
      
      res.json(logs);
    } catch (error) {
      console.error("Get hour logs error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // AI-powered equipment maintenance recommendations
  router.post("/api/equipment/:equipmentId/ai-recommendations", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      const { problemDescription } = req.body;
      
      // Get equipment details
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Get repair history for context
      const repairHistory = await db
        .select()
        .from(equipmentRepairs)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt))
        .limit(10);
      
      // Get maintenance history for context
      const maintenanceHistory = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt))
        .limit(10);
      
      const { openai } = await import('./ai/openaiClient');
      
      const systemPrompt = `You are an expert equipment maintenance advisor for construction equipment. 
You provide practical, actionable recommendations for repairs and preventative maintenance.
Always respond in valid JSON format with the following structure:
{
  "recommendedTasks": [
    { "task": "Task description", "priority": "HIGH|MEDIUM|LOW", "estimatedCost": number, "estimatedHours": number }
  ],
  "recommendedParts": [
    { "part": "Part name", "quantity": number, "estimatedCost": number, "supplier": "Suggested supplier or 'OEM Dealer'" }
  ],
  "preventativeSchedule": [
    { "interval": "Hours or calendar interval", "task": "Maintenance task", "description": "Brief description" }
  ],
  "urgency": "CRITICAL|HIGH|MEDIUM|LOW",
  "estimatedTotalCost": number,
  "summary": "Brief summary of recommendations",
  "warningsOrNotes": ["Any important warnings or notes"]
}`;

      const userPrompt = `Equipment Details:
- Name: ${equipmentItem.name}
- Type: ${equipmentItem.type}
- Make: ${equipmentItem.make || 'Unknown'}
- Model: ${equipmentItem.model || 'Unknown'}
- Year: ${equipmentItem.year || 'Unknown'}
- Current Hours: ${equipmentItem.currentHours || 0}
- Last Maintenance: ${equipmentItem.lastMaintenanceDate ? new Date(equipmentItem.lastMaintenanceDate).toLocaleDateString() : 'Unknown'}

Problem Reported: ${problemDescription || 'General maintenance check requested'}

Recent Repair History (last 10):
${repairHistory.length > 0 
  ? repairHistory.map(r => `- ${r.description}: ${r.status} (Cost: ${r.actualCost || r.estimatedCost || 'Unknown'})`).join('\n')
  : 'No recent repairs'}

Recent Maintenance History (last 10):
${maintenanceHistory.length > 0
  ? maintenanceHistory.map(m => `- ${m.maintenanceType}: ${m.description || 'Completed'} at ${m.hoursAtMaintenance || 'Unknown'} hours`).join('\n')
  : 'No recent maintenance records'}

Please provide:
1. Recommended repair tasks based on the problem description
2. Parts that may be needed
3. Recommended preventative maintenance schedule for this equipment type
4. Urgency assessment
5. Cost estimates`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 2048,
      });
      
      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      const recommendations = JSON.parse(content);
      res.json(recommendations);
    } catch (error) {
      console.error("AI recommendations error:", error);
      res.status(500).json({ error: "Failed to generate AI recommendations" });
    }
  });

  // Notify maintenance managers about new repair/maintenance requests
  router.post("/api/equipment/notify-maintenance", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId, repairId, message, type } = req.body;
      
      // Get all maintenance managers
      const maintenanceManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.role, "MAINTENANCE_MANAGER"),
          eq(users.isActive, true)
        ));
      
      // Also notify admins and managers with maintenance oversight
      const adminsAndManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER")),
          eq(users.isActive, true)
        ));
      
      const allRecipients = [...maintenanceManagers, ...adminsAndManagers];
      const uniqueRecipientIds = Array.from(new Set(allRecipients.map(r => r.id)));
      
      // Create notifications for all recipients
      for (const recipientId of uniqueRecipientIds) {
        await db.insert(notifications).values({
          userId: recipientId,
          type: type === 'REPAIR' ? 'REPAIR_REQUEST' : 'MAINTENANCE_REQUEST',
          title: type === 'REPAIR' ? 'New Repair Request' : 'Maintenance Required',
          message,
          relatedEntityId: equipmentId,
          relatedEntityType: 'equipment',
        });
      }
      
      res.json({ success: true, notifiedCount: uniqueRecipientIds.length });
    } catch (error) {
      console.error("Notify maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get equipment assigned to a project (for project detail page)
  router.get("/api/projects/:projectId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      
      // Get active assignments for this project
      const assignedEquipment = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          year: equipment.year,
          status: equipment.status,
          currentHours: equipment.currentHours,
          assignedAt: equipmentAssignments.assignedAt,
          expectedReturnDate: equipmentAssignments.expectedReturnDate,
          assignmentId: equipmentAssignments.id,
          assignmentNotes: equipmentAssignments.notes,
        })
        .from(equipmentAssignments)
        .innerJoin(equipment, eq(equipmentAssignments.equipmentId, equipment.id))
        .where(and(
          eq(equipmentAssignments.projectId, projectId),
          eq(equipmentAssignments.isActive, true)
        ))
        .orderBy(equipment.name);
      
      res.json(assignedEquipment);
    } catch (error) {
      console.error("Get project equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get preventative maintenance schedules for equipment
  router.get("/api/equipment/:equipmentId/maintenance-schedules", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      const schedules = await db
        .select()
        .from(equipmentMaintenanceSchedules)
        .where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId))
        .orderBy(equipmentMaintenanceSchedules.nextDueAt);
      
      res.json(schedules);
    } catch (error) {
      console.error("Get maintenance schedules error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Generate AI-powered preventative maintenance schedule for equipment
  router.post("/api/equipment/:equipmentId/generate-maintenance-schedule", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      // Get equipment details
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      // Get existing maintenance history for context
      const maintenanceHistory = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt))
        .limit(20);
      
      const { openai } = await import('./ai/openaiClient');
      
      const systemPrompt = `You are an expert equipment maintenance specialist with deep knowledge of manufacturer-recommended maintenance schedules.
You provide comprehensive preventative maintenance schedules based on specific equipment make, model, and type.
Research and provide manufacturer-specific recommendations where possible.
Always respond in valid JSON format with the following structure:
{
  "schedules": [
    {
      "name": "Maintenance task name (e.g., Engine Oil Change)",
      "maintenanceType": "PREVENTATIVE" | "SCHEDULED_SERVICE" | "INSPECTION" | "CALIBRATION",
      "description": "Detailed description of what this maintenance involves",
      "intervalHours": number or null (hours between maintenance, e.g., 250),
      "intervalDays": number or null (days between maintenance, e.g., 90),
      "alertDaysBefore": 7,
      "alertHoursBefore": 25,
      "priority": "HIGH" | "MEDIUM" | "LOW",
      "estimatedDuration": "Time to complete (e.g., 1 hour)",
      "estimatedCost": number (approximate cost in USD),
      "requiredParts": ["List of parts needed"],
      "notes": "Any special notes or manufacturer recommendations"
    }
  ],
  "manufacturerNotes": "Any important notes about this specific make/model maintenance requirements",
  "totalAnnualMaintenanceCost": number (estimated annual cost for all maintenance),
  "criticalItems": ["List of most critical maintenance items that should never be skipped"]
}`;

      const userPrompt = `Generate a comprehensive preventative maintenance schedule for the following equipment:

Equipment Details:
- Name: ${equipmentItem.name}
- Type: ${equipmentItem.type}
- Make: ${equipmentItem.make || 'Unknown'}
- Model: ${equipmentItem.model || 'Unknown'}
- Year: ${equipmentItem.year || 'Unknown'}
- Current Hours: ${equipmentItem.currentHours || 0}
- Last Maintenance Date: ${equipmentItem.lastMaintenanceDate ? new Date(equipmentItem.lastMaintenanceDate).toLocaleDateString() : 'Unknown'}

Recent Maintenance History:
${maintenanceHistory.length > 0
  ? maintenanceHistory.map(m => `- ${m.maintenanceType}: ${m.description} at ${m.hoursAtMaintenance || 'Unknown'} hours`).join('\n')
  : 'No recent maintenance records'}

Please provide:
1. A complete preventative maintenance schedule based on manufacturer recommendations for this specific make/model
2. Include both hour-based and calendar-based intervals where appropriate
3. Prioritize items by importance
4. Include estimated costs and required parts
5. Note any special considerations for this equipment type/model

If the make/model is unknown, provide general best practices for the equipment type (${equipmentItem.type}).`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4096,
      });
      
      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }
      
      const aiResponse = JSON.parse(content);
      
      // Delete existing schedules for this equipment (replace with new AI-generated ones)
      await db.delete(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.equipmentId, equipmentId));
      
      // Calculate next due dates based on current hours and last maintenance
      const currentHours = parseFloat(equipmentItem.currentHours || "0");
      const now = new Date();
      
      // Insert new schedules
      const insertedSchedules = [];
      for (const schedule of aiResponse.schedules) {
        // Calculate next due date
        let nextDueAt: Date | null = null;
        let nextDueHours: string | null = null;
        
        if (schedule.intervalDays) {
          nextDueAt = new Date(now.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000);
        }
        if (schedule.intervalHours) {
          nextDueHours = String(currentHours + schedule.intervalHours);
        }
        
        const [inserted] = await db.insert(equipmentMaintenanceSchedules).values({
          equipmentId,
          maintenanceType: schedule.maintenanceType || "PREVENTATIVE",
          name: schedule.name,
          description: schedule.description,
          intervalHours: schedule.intervalHours,
          intervalDays: schedule.intervalDays,
          nextDueAt,
          nextDueHours,
          alertDaysBefore: schedule.alertDaysBefore || 7,
          alertHoursBefore: schedule.alertHoursBefore || 25,
          isActive: true,
        }).returning();
        
        insertedSchedules.push({
          ...inserted,
          priority: schedule.priority,
          estimatedDuration: schedule.estimatedDuration,
          estimatedCost: schedule.estimatedCost,
          requiredParts: schedule.requiredParts,
          notes: schedule.notes,
        });
      }
      
      res.json({
        schedules: insertedSchedules,
        manufacturerNotes: aiResponse.manufacturerNotes,
        totalAnnualMaintenanceCost: aiResponse.totalAnnualMaintenanceCost,
        criticalItems: aiResponse.criticalItems,
      });
    } catch (error) {
      console.error("Generate maintenance schedule error:", error);
      res.status(500).json({ error: "Failed to generate maintenance schedule. Please try again." });
    }
  });

  // Complete a scheduled maintenance item
  router.post("/api/equipment/:equipmentId/maintenance-schedules/:scheduleId/complete", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId, scheduleId } = req.params;
      const { notes, laborCost, partsCost, performedByVendor, partsUsed } = req.body;
      
      // Get schedule
      const [schedule] = await db.select().from(equipmentMaintenanceSchedules).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
      if (!schedule) {
        res.status(404).json({ error: "Maintenance schedule not found" });
        return;
      }
      
      // Get equipment current hours
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const currentHours = equipmentItem.currentHours;
      const now = new Date();
      const totalCost = (parseFloat(laborCost || "0") + parseFloat(partsCost || "0")).toString();
      
      // Create history record
      const [historyRecord] = await db.insert(equipmentMaintenanceHistory).values({
        equipmentId,
        scheduleId,
        maintenanceType: schedule.maintenanceType,
        description: schedule.name + (schedule.description ? `: ${schedule.description}` : ''),
        performedAt: now,
        hoursAtMaintenance: currentHours,
        performedById: req.user!.id,
        performedByVendor,
        laborCost,
        partsCost,
        totalCost,
        notes,
        partsUsed: partsUsed ? JSON.stringify(partsUsed) : null,
      }).returning();
      
      // Update schedule with new last performed date and calculate next due
      let nextDueAt: Date | null = null;
      let nextDueHours: string | null = null;
      
      if (schedule.intervalDays) {
        nextDueAt = new Date(now.getTime() + schedule.intervalDays * 24 * 60 * 60 * 1000);
      }
      if (schedule.intervalHours) {
        nextDueHours = String(parseFloat(currentHours || "0") + schedule.intervalHours);
      }
      
      await db.update(equipmentMaintenanceSchedules).set({
        lastPerformedAt: now,
        lastPerformedHours: currentHours,
        nextDueAt,
        nextDueHours,
        updatedAt: now,
      }).where(eq(equipmentMaintenanceSchedules.id, scheduleId));
      
      // Update equipment last maintenance date
      await db.update(equipment).set({
        lastMaintenanceDate: now,
        updatedAt: now,
      }).where(eq(equipment.id, equipmentId));
      
      res.json({
        historyRecord,
        message: "Maintenance completed successfully",
      });
    } catch (error) {
      console.error("Complete maintenance error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get maintenance history for equipment
  router.get("/api/equipment/:equipmentId/maintenance-history", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { equipmentId } = req.params;
      
      const history = await db
        .select({
          id: equipmentMaintenanceHistory.id,
          maintenanceType: equipmentMaintenanceHistory.maintenanceType,
          description: equipmentMaintenanceHistory.description,
          performedAt: equipmentMaintenanceHistory.performedAt,
          hoursAtMaintenance: equipmentMaintenanceHistory.hoursAtMaintenance,
          performedByVendor: equipmentMaintenanceHistory.performedByVendor,
          laborCost: equipmentMaintenanceHistory.laborCost,
          partsCost: equipmentMaintenanceHistory.partsCost,
          totalCost: equipmentMaintenanceHistory.totalCost,
          notes: equipmentMaintenanceHistory.notes,
          partsUsed: equipmentMaintenanceHistory.partsUsed,
          performedByName: sql<string>`COALESCE(${users.firstName} || ' ' || ${users.lastName}, 'External')`,
        })
        .from(equipmentMaintenanceHistory)
        .leftJoin(users, eq(equipmentMaintenanceHistory.performedById, users.id))
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
  router.get("/api/equipment/:equipmentId/rate-profiles", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.get("/api/equipment/:equipmentId/active-rate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment/:equipmentId/rate-profiles", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
  router.patch("/api/equipment/:equipmentId/rate-profiles/:profileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
  router.post("/api/equipment/:equipmentId/rate-profiles/:profileId/activate", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
  router.delete("/api/equipment/rate-profiles/:profileId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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

  // ============================================
  // RENTAL VENDORS
  // ============================================

  // Get all rental vendors
  router.get("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const conditions = [];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const vendors = await db
        .select()
        .from(rentalVendors)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(rentalVendors.name);
      
      res.json(vendors);
    } catch (error) {
      console.error("Get rental vendors error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get single rental vendor
  router.get("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const { id } = req.params;
      
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...conditions));
      
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      res.json(vendor);
    } catch (error) {
      console.error("Get rental vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create rental vendor
  router.post("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const userId = req.user?.id;
      
      const validatedData = insertRentalVendorSchema.parse(req.body);
      
      // Set organizationId to user's org
      const dataWithOrg = {
        ...validatedData,
        organizationId: shouldFilter && orgId ? orgId : (validatedData.organizationId || "tfr-default-org"),
      };
      
      const [newVendor] = await db.insert(rentalVendors).values(dataWithOrg).returning();
      
      await logCreate(userId!, "rental_vendors", newVendor.id, { name: validatedData.name });
      
      res.status(201).json(newVendor);
    } catch (error) {
      console.error("Create rental vendor error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update rental vendor
  router.patch("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify vendor belongs to user's org
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [existing] = await db.select().from(rentalVendors).where(and(...conditions));
      if (!existing) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const [updated] = await db.update(rentalVendors)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
      
      await logUpdate(userId!, "rental_vendors", id, existing, req.body);
      
      res.json(updated);
    } catch (error) {
      console.error("Update rental vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete rental vendor
  router.delete("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify vendor belongs to user's org
      const conditions = [eq(rentalVendors.id, id)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [existing] = await db.select().from(rentalVendors).where(and(...conditions));
      if (!existing) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      await db.delete(rentalVendors).where(and(...conditions));
      
      await logDelete(userId!, "rental_vendors", id, { name: existing.name });
      
      res.json({ message: "Rental vendor deleted successfully" });
    } catch (error) {
      console.error("Delete rental vendor error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // RENTAL EQUIPMENT CATALOG
  // ============================================

  // Get equipment catalog for a vendor
  router.get("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { vendorId } = req.params;
      
      // SECURITY: Verify vendor belongs to user's org
      const vendorConditions = [eq(rentalVendors.id, vendorId)];
      if (shouldFilter && orgId) {
        vendorConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...vendorConditions));
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const catalog = await db
        .select()
        .from(rentalEquipmentCatalog)
        .where(eq(rentalEquipmentCatalog.vendorId, vendorId))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json(catalog);
    } catch (error) {
      console.error("Get rental equipment catalog error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get all rental equipment (across all vendors)
  router.get("/api/rental-equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { type, vendorId } = req.query;
      
      // SECURITY: Filter by vendor's org
      const conditions = [eq(rentalEquipmentCatalog.isActive, true)];
      if (shouldFilter && orgId) {
        conditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const results = await db
        .select({
          id: rentalEquipmentCatalog.id,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          vendorId: rentalEquipmentCatalog.vendorId,
          vendorName: rentalVendors.name,
          vendorCode: rentalVendors.code,
          isActive: rentalEquipmentCatalog.isActive,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(and(...conditions))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      // Filter in memory if needed
      let filtered = results;
      if (type) {
        filtered = filtered.filter(r => r.equipmentType === type);
      }
      if (vendorId) {
        filtered = filtered.filter(r => r.vendorId === vendorId);
      }
      
      res.json(filtered);
    } catch (error) {
      console.error("Get rental equipment error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add equipment to vendor catalog
  router.post("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { vendorId } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Verify vendor exists AND belongs to user's org
      const vendorConditions = [eq(rentalVendors.id, vendorId)];
      if (shouldFilter && orgId) {
        vendorConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      const [vendor] = await db.select().from(rentalVendors).where(and(...vendorConditions));
      if (!vendor) {
        return res.status(404).json({ error: "Rental vendor not found" });
      }
      
      const validatedData = insertRentalEquipmentCatalogSchema.parse({
        ...req.body,
        vendorId,
      });
      
      const [newItem] = await db.insert(rentalEquipmentCatalog).values(validatedData).returning();
      
      await logCreate(userId!, "rental_equipment_catalog", newItem.id, { name: validatedData.name, vendorId });
      
      res.status(201).json(newItem);
    } catch (error) {
      console.error("Create rental equipment catalog item error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid input", details: error.errors });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update catalog item
  router.patch("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to verify catalog item belongs to vendor in user's org
      const catalogWithVendor = await db
        .select({
          catalogId: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          organizationId: rentalVendors.organizationId,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(eq(rentalEquipmentCatalog.id, id))
        .limit(1);
      
      if (catalogWithVendor.length === 0) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      // SECURITY: Verify vendor belongs to user's org
      if (shouldFilter && orgId && catalogWithVendor[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      const [updated] = await db.update(rentalEquipmentCatalog)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(rentalEquipmentCatalog.id, id))
        .returning();
      
      await logUpdate(userId!, "rental_equipment_catalog", id, catalogWithVendor[0], req.body);
      
      res.json(updated);
    } catch (error) {
      console.error("Update rental equipment catalog item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete catalog item
  router.delete("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
      // SECURITY: Join to verify catalog item belongs to vendor in user's org
      const catalogWithVendor = await db
        .select({
          catalogId: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          organizationId: rentalVendors.organizationId,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(eq(rentalEquipmentCatalog.id, id))
        .limit(1);
      
      if (catalogWithVendor.length === 0) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      // SECURITY: Verify vendor belongs to user's org
      if (shouldFilter && orgId && catalogWithVendor[0].organizationId !== orgId) {
        return res.status(404).json({ error: "Catalog item not found" });
      }
      
      await db.delete(rentalEquipmentCatalog).where(eq(rentalEquipmentCatalog.id, id));
      
      await logDelete(userId!, "rental_equipment_catalog", id, { deleted: true });
      
      res.json({ message: "Catalog item deleted successfully" });
    } catch (error) {
      console.error("Delete rental equipment catalog item error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // BID EQUIPMENT SELECTIONS
  // ============================================

  // Get equipment selections for a bid
  router.get("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      
      // Verify bid exists (consistent with other bid endpoints like /quotes)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const selections = await db
        .select()
        .from(bidEquipmentSelections)
        .where(eq(bidEquipmentSelections.bidId, bidId))
        .orderBy(bidEquipmentSelections.createdAt);
      
      res.json(selections);
    } catch (error) {
      console.error("Get bid equipment selections error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Add equipment selection to bid
  router.post("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      const userId = req.user?.id;
      
      // Verify bid exists (consistent with other bid endpoints like /quotes)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // Validate required fields
      const { source, equipmentName, equipmentType } = req.body;
      if (!source || !equipmentName || !equipmentType) {
        return res.status(400).json({ error: "Source, equipment name, and type are required" });
      }
      
      // Convert numeric values to strings for decimal fields (drizzle expects strings for decimal)
      const insertData = {
        bidId,
        source: req.body.source,
        equipmentId: req.body.equipmentId || null,
        rentalCatalogId: req.body.rentalCatalogId || null,
        rentalVendorId: req.body.rentalVendorId || null,
        equipmentName: req.body.equipmentName,
        equipmentType: req.body.equipmentType,
        plannedHours: req.body.plannedHours != null ? String(req.body.plannedHours) : null,
        plannedDays: req.body.plannedDays != null ? Number(req.body.plannedDays) : null,
        hourlyRate: req.body.hourlyRate != null ? String(req.body.hourlyRate) : null,
        dailyRate: req.body.dailyRate != null ? String(req.body.dailyRate) : null,
        weeklyRate: req.body.weeklyRate != null ? String(req.body.weeklyRate) : null,
        estimatedCost: req.body.estimatedCost != null ? String(req.body.estimatedCost) : null,
        deliveryFee: req.body.deliveryFee != null ? String(req.body.deliveryFee) : null,
        notes: req.body.notes || null,
        createdById: userId,
      };
      
      const [newSelection] = await db.insert(bidEquipmentSelections).values(insertData).returning();
      
      await logCreate(userId!, "bid_equipment_selections", newSelection.id, { bidId, equipmentName: insertData.equipmentName });
      
      res.status(201).json(newSelection);
    } catch (error) {
      console.error("Create bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update bid equipment selection
  router.patch("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      // Verify bid exists (consistent with other bid endpoints)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // SECURITY: Define conditions for both SELECT and UPDATE to prevent TOCTOU
      const selectionConditions = and(
        eq(bidEquipmentSelections.id, selectionId),
        eq(bidEquipmentSelections.bidId, bidId)
      );
      
      const [existing] = await db.select()
        .from(bidEquipmentSelections)
        .where(selectionConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment selection not found" });
      }
      
      // Convert numeric values to strings for decimal fields
      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (req.body.source !== undefined) updateData.source = req.body.source;
      if (req.body.equipmentId !== undefined) updateData.equipmentId = req.body.equipmentId || null;
      if (req.body.rentalCatalogId !== undefined) updateData.rentalCatalogId = req.body.rentalCatalogId || null;
      if (req.body.rentalVendorId !== undefined) updateData.rentalVendorId = req.body.rentalVendorId || null;
      if (req.body.equipmentName !== undefined) updateData.equipmentName = req.body.equipmentName;
      if (req.body.equipmentType !== undefined) updateData.equipmentType = req.body.equipmentType;
      if (req.body.plannedHours !== undefined) updateData.plannedHours = req.body.plannedHours != null ? String(req.body.plannedHours) : null;
      if (req.body.plannedDays !== undefined) updateData.plannedDays = req.body.plannedDays != null ? Number(req.body.plannedDays) : null;
      if (req.body.hourlyRate !== undefined) updateData.hourlyRate = req.body.hourlyRate != null ? String(req.body.hourlyRate) : null;
      if (req.body.dailyRate !== undefined) updateData.dailyRate = req.body.dailyRate != null ? String(req.body.dailyRate) : null;
      if (req.body.weeklyRate !== undefined) updateData.weeklyRate = req.body.weeklyRate != null ? String(req.body.weeklyRate) : null;
      if (req.body.estimatedCost !== undefined) updateData.estimatedCost = req.body.estimatedCost != null ? String(req.body.estimatedCost) : null;
      if (req.body.deliveryFee !== undefined) updateData.deliveryFee = req.body.deliveryFee != null ? String(req.body.deliveryFee) : null;
      if (req.body.notes !== undefined) updateData.notes = req.body.notes || null;
      
      // SECURITY: Use same conditions in UPDATE to prevent TOCTOU race condition
      const [updated] = await db.update(bidEquipmentSelections)
        .set(updateData)
        .where(selectionConditions)
        .returning();
      
      await logUpdate(userId!, "bid_equipment_selections", selectionId, existing, req.body);
      
      res.json(updated);
    } catch (error) {
      console.error("Update bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete bid equipment selection
  router.delete("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      // Verify bid exists (consistent with other bid endpoints)
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      // SECURITY: Define conditions for both SELECT and DELETE to prevent TOCTOU
      const selectionConditions = and(
        eq(bidEquipmentSelections.id, selectionId),
        eq(bidEquipmentSelections.bidId, bidId)
      );
      
      const [existing] = await db.select()
        .from(bidEquipmentSelections)
        .where(selectionConditions);
      
      if (!existing) {
        return res.status(404).json({ error: "Equipment selection not found" });
      }
      
      // SECURITY: Use same conditions in DELETE to prevent TOCTOU race condition
      await db.delete(bidEquipmentSelections).where(selectionConditions);
      
      await logDelete(userId!, "bid_equipment_selections", selectionId, { equipmentName: existing.equipmentName });
      
      res.json({ message: "Equipment selection deleted successfully" });
    } catch (error) {
      console.error("Delete bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get available equipment for bid selection (owned + rental catalog)
  router.get("/api/equipment-for-selection", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json({ owned: [], rental: [] });
      }
      
      // SECURITY: Filter owned equipment by org
      const equipConditions = [ne(equipment.status, "RETIRED")];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      // Get owned equipment with active rate profiles (exclude RETIRED status)
      const ownedEquipment = await db
        .select({
          id: equipment.id,
          equipmentCode: equipment.equipmentCode,
          name: equipment.name,
          type: equipment.type,
          make: equipment.make,
          model: equipment.model,
          status: equipment.status,
          hourlyRate: equipmentRateProfiles.hourlyRate,
          dailyRate: equipmentRateProfiles.dailyRate,
          weeklyRate: equipmentRateProfiles.weeklyRate,
          monthlyRate: equipmentRateProfiles.monthlyRate,
        })
        .from(equipment)
        .leftJoin(equipmentRateProfiles, and(
          eq(equipmentRateProfiles.equipmentId, equipment.id),
          eq(equipmentRateProfiles.isActive, true)
        ))
        .where(and(...equipConditions))
        .orderBy(equipment.type, equipment.name);
      
      // SECURITY: Filter rental catalog by vendor's org
      const rentalConditions = [
        eq(rentalEquipmentCatalog.isActive, true),
        eq(rentalVendors.isActive, true)
      ];
      if (shouldFilter && orgId) {
        rentalConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
      // Get rental equipment catalog (active items)
      const rentalCatalog = await db
        .select({
          id: rentalEquipmentCatalog.id,
          vendorId: rentalEquipmentCatalog.vendorId,
          name: rentalEquipmentCatalog.name,
          equipmentType: rentalEquipmentCatalog.equipmentType,
          make: rentalEquipmentCatalog.make,
          model: rentalEquipmentCatalog.model,
          hourlyRate: rentalEquipmentCatalog.hourlyRate,
          dailyRate: rentalEquipmentCatalog.dailyRate,
          weeklyRate: rentalEquipmentCatalog.weeklyRate,
          monthlyRate: rentalEquipmentCatalog.monthlyRate,
          deliveryFee: rentalEquipmentCatalog.deliveryFee,
          vendorName: rentalVendors.name,
          vendorCode: rentalVendors.code,
        })
        .from(rentalEquipmentCatalog)
        .innerJoin(rentalVendors, eq(rentalEquipmentCatalog.vendorId, rentalVendors.id))
        .where(and(...rentalConditions))
        .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
      
      res.json({
        owned: ownedEquipment,
        rental: rentalCatalog,
      });
    } catch (error) {
      console.error("Get equipment for selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

export default router;
