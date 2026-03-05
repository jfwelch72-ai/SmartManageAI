import { Router } from "express";
import { db } from "./db";
import {
  rentalVendors, insertRentalVendorSchema,
  rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

  // ============================================
  // RENTAL VENDORS
  // ============================================

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

  router.post("/api/rental-vendors", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const userId = req.user?.id;
      
      const validatedData = insertRentalVendorSchema.parse(req.body);
      
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

  router.patch("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
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

  router.delete("/api/rental-vendors/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
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

  router.get("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { vendorId } = req.params;
      
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

  router.get("/api/rental-equipment", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "MAINTENANCE_MANAGER", "ESTIMATOR", "EQUIPMENT_MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json([]);
      }
      
      const { type, vendorId } = req.query;
      
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

  router.post("/api/rental-vendors/:vendorId/catalog", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { vendorId } = req.params;
      const userId = req.user?.id;
      
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

  router.patch("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
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

  router.delete("/api/rental-equipment/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.status(403).json({ error: "Access denied - no organization" });
      }
      
      const { id } = req.params;
      const userId = req.user?.id;
      
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

export default router;
