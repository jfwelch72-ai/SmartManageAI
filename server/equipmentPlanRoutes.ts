import { Router } from "express";
import { db } from "./db";
import {
  equipment, equipmentAssignments,
  equipmentRateProfiles,
  equipmentHourLogs, equipmentRepairs,
  equipmentMaintenanceHistory,
  rentalEquipmentCatalog, rentalVendors,
  bidEquipmentSelections,
  projectEquipmentPlans,
  projects, bids, users, notifications,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, ne, desc, and, or, sql } from "drizzle-orm";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { governedAiCall } from "./services/aiGovernance";

const router = Router();

  // ============================================
  // PROJECT EQUIPMENT (assigned to project)
  // ============================================

  router.get("/api/projects/:projectId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
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

  // ============================================
  // PROJECT EQUIPMENT PLANS
  // ============================================

  router.get("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { projectId } = req.params;
      
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

  router.post("/api/projects/:projectId/equipment-plans", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId } = req.params;
      const userId = req.user?.id;
      
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
        costCode: req.body.costCode || null,
        createdById: userId!,
      }).returning();
      
      await logCreate(userId!, "project_equipment_plans", newPlan.id, { projectId, equipmentName: req.body.equipmentName });
      
      res.status(201).json(newPlan);
    } catch (error) {
      console.error("Create project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.patch("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
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
      if (req.body.costCode !== undefined) updateData.costCode = req.body.costCode || null;
      
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

  router.delete("/api/projects/:projectId/equipment-plans/:planId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { projectId, planId } = req.params;
      const userId = req.user?.id;
      
      const projectConditions = [eq(projects.id, projectId)];
      if (shouldFilter && orgId) {
        projectConditions.push(eq(projects.gcOrganizationId, orgId));
      }
      
      const [project] = await db.select().from(projects).where(and(...projectConditions));
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      
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
      
      await db.delete(projectEquipmentPlans).where(planConditions);
      
      await logDelete(userId!, "project_equipment_plans", planId, { equipmentName: existing.equipmentName });
      
      res.status(204).send();
    } catch (error) {
      console.error("Delete project equipment plan error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // GET EQUIPMENT ASSIGNED TO PROJECT (for project detail page)
  // ============================================

  router.get("/api/projects/:projectId/assigned-equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      
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

  // ============================================
  // BID EQUIPMENT SELECTIONS
  // ============================================

  router.get("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      
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

  router.post("/api/bids/:bidId/equipment", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      const userId = req.user?.id;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
      const { source, equipmentName, equipmentType } = req.body;
      if (!source || !equipmentName || !equipmentType) {
        return res.status(400).json({ error: "Source, equipment name, and type are required" });
      }
      
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

  router.patch("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
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

  router.delete("/api/bids/:bidId/equipment/:selectionId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { bidId, selectionId } = req.params;
      const userId = req.user?.id;
      
      const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
      
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
      
      await db.delete(bidEquipmentSelections).where(selectionConditions);
      
      await logDelete(userId!, "bid_equipment_selections", selectionId, { equipmentName: existing.equipmentName });
      
      res.json({ message: "Equipment selection deleted successfully" });
    } catch (error) {
      console.error("Delete bid equipment selection error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ============================================
  // EQUIPMENT FOR SELECTION (owned + rental)
  // ============================================

  router.get("/api/equipment-for-selection", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json({ owned: [], rental: [] });
      }
      
      const equipConditions = [ne(equipment.status, "RETIRED")];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
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
      
      const rentalConditions = [
        eq(rentalEquipmentCatalog.isActive, true),
        eq(rentalVendors.isActive, true)
      ];
      if (shouldFilter && orgId) {
        rentalConditions.push(eq(rentalVendors.organizationId, orgId));
      }
      
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

  // ============================================
  // EQUIPMENT REPAIRS
  // ============================================

  // Get equipment repairs
  router.get("/api/equipment/:equipmentId/repairs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { equipmentId } = req.params;
      
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
      
      const conditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        conditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...conditions));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
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
      
      const [repair] = await db.select().from(equipmentRepairs).where(eq(equipmentRepairs.id, repairId));
      if (!repair) {
        res.status(404).json({ error: "Repair not found" });
        return;
      }
      
      const equipConditions = [eq(equipment.id, repair.equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      if (updates.status === "COMPLETED" && repair.status !== "COMPLETED") {
        updates.completedAt = new Date();
        updates.completedById = req.user!.id;
        
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

  // ============================================
  // EQUIPMENT USAGE TRACKING (Hour Logs, AI, Notifications)
  // ============================================

  // Submit weekly hour log for equipment
  router.post("/api/equipment/:equipmentId/hour-logs", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { equipmentId } = req.params;
      const { projectId, weekStartDate, weekEndDate, startingHours, endingHours, notes, fuelUsed } = req.body;
      
      const equipConditions = [eq(equipment.id, equipmentId)];
      if (shouldFilter && orgId) {
        equipConditions.push(eq(equipment.organizationId, orgId));
      }
      
      const [equipmentItem] = await db.select().from(equipment).where(and(...equipConditions)).limit(1);
      if (!equipmentItem) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      
      const hoursUsed = (parseFloat(endingHours) - parseFloat(startingHours)).toString();
      
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
      
      const [equipmentItem] = await db.select().from(equipment).where(eq(equipment.id, equipmentId));
      if (!equipmentItem) {
        res.status(404).json({ error: "Equipment not found" });
        return;
      }
      
      const repairHistory = await db
        .select()
        .from(equipmentRepairs)
        .where(eq(equipmentRepairs.equipmentId, equipmentId))
        .orderBy(desc(equipmentRepairs.problemReportedAt))
        .limit(10);
      
      const maintenanceHistory = await db
        .select()
        .from(equipmentMaintenanceHistory)
        .where(eq(equipmentMaintenanceHistory.equipmentId, equipmentId))
        .orderBy(desc(equipmentMaintenanceHistory.performedAt))
        .limit(10);
      
      const { openai } = await import('./ai/openaiClient');
      
      const equipOrgId = equipmentItem.organizationId || req.user?.organizationId || "system";

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

      const { result: recommendations, blocked, reason } = await governedAiCall({
        orgId: equipOrgId,
        userId: req.user?.id || null,
        actionType: "equipment_ai_recommendations",
        inputRefs: { equipmentId, problemDescription: problemDescription?.substring(0, 200) },
        fn: async () => {
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
          return {
            result: JSON.parse(content),
            completion,
          };
        },
      });

      if (blocked) {
        return res.status(429).json({ error: reason || "AI usage limit reached" });
      }

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
      
      const maintenanceManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.role, "MAINTENANCE_MANAGER"),
          eq(users.isActive, true)
        ));
      
      const adminsAndManagers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER")),
          eq(users.isActive, true)
        ));
      
      const allRecipients = [...maintenanceManagers, ...adminsAndManagers];
      const uniqueRecipientIds = Array.from(new Set(allRecipients.map(r => r.id)));
      
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

export default router;
