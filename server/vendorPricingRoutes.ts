import { Router } from "express";
import multer from "multer";
import { db } from "./db";
import {
  crmOrganisations,
  vendorPricingCatalogs, insertVendorPricingCatalogSchema,
  rentalEquipmentCatalog, insertRentalEquipmentCatalogSchema,
  vendorPricebooks, vendorPricebookItems,
  auditLog, users,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get("/api/crm/organisations/:id/pricing", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const items = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.crmOrganisationId, req.params.id))
      .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);
    
    res.json(items);
  } catch (error) {
    console.error("Get vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/pricing/current", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
    
    const items = await db
      .select()
      .from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.crmOrganisationId, req.params.id),
        eq(vendorPricingCatalogs.isActive, true),
        eq(vendorPricingCatalogs.effectiveQuarter, currentQuarter)
      ))
      .orderBy(vendorPricingCatalogs.category, vendorPricingCatalogs.itemName);
    
    res.json(items);
  } catch (error) {
    console.error("Get current vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/organisations/:id/pricing", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
    if (!org) {
      res.status(404).json({ error: "Organisation not found" });
      return;
    }

    const bodyWithDates = {
      ...req.body,
      effectiveDate: req.body.effectiveDate ? new Date(req.body.effectiveDate) : new Date(),
      expirationDate: req.body.expirationDate ? new Date(req.body.expirationDate) : null,
      crmOrganisationId: req.params.id,
      createdById: req.user!.id,
    };

    const validationResult = insertVendorPricingCatalogSchema.safeParse(bodyWithDates);

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newItem] = await db.insert(vendorPricingCatalogs).values(validationResult.data).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "vendor_pricing_catalogs",
      entityId: newItem.id,
      newValue: JSON.stringify({ itemName: newItem.itemName, category: newItem.category, unitPrice: newItem.unitPrice }),
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Create vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/crm/pricing/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [existing] = await db.select().from(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Pricing item not found" });
      return;
    }

    const bodyWithDates = {
      ...req.body,
      ...(req.body.effectiveDate && { effectiveDate: new Date(req.body.effectiveDate) }),
      ...(req.body.expirationDate && { expirationDate: new Date(req.body.expirationDate) }),
    };

    const validationResult = insertVendorPricingCatalogSchema.partial().safeParse(bodyWithDates);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({ ...validationResult.data, updatedAt: new Date() })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_pricing_catalogs",
      entityId: updated.id,
      oldValue: JSON.stringify({ itemName: existing.itemName, unitPrice: existing.unitPrice }),
      newValue: JSON.stringify({ itemName: updated.itemName, unitPrice: updated.unitPrice }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Update vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crm/pricing/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [existing] = await db.select().from(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Pricing item not found" });
      return;
    }

    await db.delete(vendorPricingCatalogs).where(eq(vendorPricingCatalogs.id, req.params.id));

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "DELETE",
      entityType: "vendor_pricing_catalogs",
      entityId: existing.id,
      oldValue: JSON.stringify({ itemName: existing.itemName, category: existing.category }),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/vendor-pricing/search", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { category, search, quarter } = req.query;
    const now = new Date();
    const currentQuarter = quarter as string || `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;

    const conditions: any[] = [
      eq(vendorPricingCatalogs.isActive, true),
    ];

    if (category) {
      conditions.push(eq(vendorPricingCatalogs.category, category as string));
    }
    if (search) {
      conditions.push(sql`LOWER(${vendorPricingCatalogs.itemName}) LIKE LOWER(${'%' + search + '%'})`);
    }

    const items = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        description: vendorPricingCatalogs.description,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
        minimumOrder: vendorPricingCatalogs.minimumOrder,
        deliveryFee: vendorPricingCatalogs.deliveryFee,
        effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
        leadTimeDays: vendorPricingCatalogs.leadTimeDays,
        vendorId: crmOrganisations.id,
        vendorName: crmOrganisations.name,
        vendorType: crmOrganisations.type,
      })
      .from(vendorPricingCatalogs)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricingCatalogs.crmOrganisationId))
      .where(and(...conditions))
      .orderBy(vendorPricingCatalogs.unitPrice)
      .limit(50);

    res.json(items);
  } catch (error) {
    console.error("Search vendor pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/rental-catalog", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT", "OFFICE_MANAGER", "SALES", "MARKETING", "PROCUREMENT_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    const [crmOrg] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
    if (!crmOrg) {
      return res.json([]);
    }
    
    if (shouldFilter && crmOrg.organizationId !== orgId) {
      return res.json([]);
    }
    
    const items = await db
      .select()
      .from(rentalEquipmentCatalog)
      .where(eq(rentalEquipmentCatalog.crmOrganisationId, req.params.id))
      .orderBy(rentalEquipmentCatalog.equipmentType, rentalEquipmentCatalog.name);
    
    res.json(items);
  } catch (error) {
    console.error("Get CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/organisations/:id/rental-catalog", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const [org] = await db.select().from(crmOrganisations).where(eq(crmOrganisations.id, req.params.id)).limit(1);
    if (!org) {
      res.status(404).json({ error: "Organisation not found" });
      return;
    }
    
    if (shouldFilter && org.organizationId !== orgId) {
      return res.status(404).json({ error: "Organisation not found" });
    }
    
    if (org.type !== "RENTAL_VENDOR" && org.type !== "VENDOR") {
      res.status(400).json({ error: "Organisation must be a Rental Vendor or Vendor type" });
      return;
    }

    const validationResult = insertRentalEquipmentCatalogSchema.safeParse({
      ...req.body,
      crmOrganisationId: req.params.id,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newItem] = await db.insert(rentalEquipmentCatalog).values(validationResult.data).returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "rental_equipment_catalog",
      entityId: newItem.id,
      newValue: JSON.stringify({ name: newItem.name, equipmentType: newItem.equipmentType }),
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Create CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/crm/rental-catalog/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const [existing] = await db
      .select({ 
        catalogItem: rentalEquipmentCatalog, 
        orgOrgId: crmOrganisations.organizationId,
        crmOrgId: crmOrganisations.id
      })
      .from(rentalEquipmentCatalog)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
      .where(eq(rentalEquipmentCatalog.id, req.params.id))
      .limit(1);
    
    if (!existing) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    
    if (shouldFilter && existing.orgOrgId !== orgId) {
      return res.status(404).json({ error: "Catalog item not found" });
    }

    const validationResult = insertRentalEquipmentCatalogSchema.partial().safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const updateConditions = and(
      eq(rentalEquipmentCatalog.id, req.params.id),
      eq(rentalEquipmentCatalog.crmOrganisationId, existing.crmOrgId)
    );

    const { crmOrganisationId, ...safeUpdateData } = validationResult.data;

    const [updated] = await db
      .update(rentalEquipmentCatalog)
      .set({ ...safeUpdateData, updatedAt: new Date() })
      .where(updateConditions)
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/crm/rental-catalog/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.status(403).json({ error: "Access denied - no organization" });
    }
    
    const [existing] = await db
      .select({ 
        catalogItem: rentalEquipmentCatalog, 
        orgOrgId: crmOrganisations.organizationId,
        crmOrgId: crmOrganisations.id
      })
      .from(rentalEquipmentCatalog)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
      .where(eq(rentalEquipmentCatalog.id, req.params.id))
      .limit(1);
    
    if (!existing) {
      res.status(404).json({ error: "Catalog item not found" });
      return;
    }
    
    if (shouldFilter && existing.orgOrgId !== orgId) {
      return res.status(404).json({ error: "Catalog item not found" });
    }

    const deleteConditions = and(
      eq(rentalEquipmentCatalog.id, req.params.id),
      eq(rentalEquipmentCatalog.crmOrganisationId, existing.crmOrgId)
    );

    await db.delete(rentalEquipmentCatalog).where(deleteConditions);

    res.json({ success: true });
  } catch (error) {
    console.error("Delete CRM rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/rental-catalog/search", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    const { type, search } = req.query;

    const conditions: any[] = [
      eq(rentalEquipmentCatalog.isActive, true),
      sql`${rentalEquipmentCatalog.crmOrganisationId} IS NOT NULL`,
    ];
    
    if (shouldFilter && orgId) {
      conditions.push(eq(crmOrganisations.organizationId, orgId));
    }

    if (type) {
      conditions.push(eq(rentalEquipmentCatalog.equipmentType, type as string));
    }
    if (search) {
      conditions.push(sql`LOWER(${rentalEquipmentCatalog.name}) LIKE LOWER(${'%' + search + '%'})`);
    }

    const items = await db
      .select({
        id: rentalEquipmentCatalog.id,
        name: rentalEquipmentCatalog.name,
        equipmentType: rentalEquipmentCatalog.equipmentType,
        make: rentalEquipmentCatalog.make,
        model: rentalEquipmentCatalog.model,
        description: rentalEquipmentCatalog.description,
        hourlyRate: rentalEquipmentCatalog.hourlyRate,
        dailyRate: rentalEquipmentCatalog.dailyRate,
        weeklyRate: rentalEquipmentCatalog.weeklyRate,
        monthlyRate: rentalEquipmentCatalog.monthlyRate,
        deliveryFee: rentalEquipmentCatalog.deliveryFee,
        pickupFee: rentalEquipmentCatalog.pickupFee,
        minimumRentalDays: rentalEquipmentCatalog.minimumRentalDays,
        vendorId: crmOrganisations.id,
        vendorName: crmOrganisations.name,
      })
      .from(rentalEquipmentCatalog)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, rentalEquipmentCatalog.crmOrganisationId))
      .where(and(...conditions))
      .orderBy(rentalEquipmentCatalog.dailyRate)
      .limit(50);

    res.json(items);
  } catch (error) {
    console.error("Search rental catalog error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/organisations/:id/pricing/pending", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const pendingPricing = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        description: vendorPricingCatalogs.description,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
        effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
        effectiveDate: vendorPricingCatalogs.effectiveDate,
        approvalStatus: vendorPricingCatalogs.approvalStatus,
        createdAt: vendorPricingCatalogs.createdAt,
        submittedByEmail: users.email,
        submittedByName: sql`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
      })
      .from(vendorPricingCatalogs)
      .leftJoin(users, eq(users.id, vendorPricingCatalogs.submittedByVendorUserId))
      .where(and(
        eq(vendorPricingCatalogs.crmOrganisationId, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId),
        eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
      ))
      .orderBy(vendorPricingCatalogs.createdAt);

    res.json(pendingPricing);
  } catch (error) {
    console.error("Get pending pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/pricing/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.id, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Pricing item not found" });
    }

    if (existing.approvalStatus !== "PENDING_REVIEW") {
      return res.status(400).json({ error: "Pricing item is not pending approval" });
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "APPROVED",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_pricing",
      entityId: req.params.id,
      oldValue: JSON.stringify({ approvalStatus: "PENDING_REVIEW" }),
      newValue: JSON.stringify({ approvalStatus: "APPROVED" }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Approve pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/pricing/:id/reject", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.id, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Pricing item not found" });
    }

    if (existing.approvalStatus !== "PENDING_REVIEW") {
      return res.status(400).json({ error: "Pricing item is not pending approval" });
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: "REJECTED",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    await db.insert(auditLog).values({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "vendor_pricing",
      entityId: req.params.id,
      oldValue: JSON.stringify({ approvalStatus: "PENDING_REVIEW" }),
      newValue: JSON.stringify({ approvalStatus: "REJECTED" }),
    });

    res.json(updated);
  } catch (error) {
    console.error("Reject pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/crm/pricing-reviews", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const items = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        description: vendorPricingCatalogs.description,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
        minimumOrder: vendorPricingCatalogs.minimumOrder,
        deliveryFee: vendorPricingCatalogs.deliveryFee,
        effectiveQuarter: vendorPricingCatalogs.effectiveQuarter,
        sourceType: vendorPricingCatalogs.sourceType,
        approvalStatus: vendorPricingCatalogs.approvalStatus,
        createdAt: vendorPricingCatalogs.createdAt,
        vendorName: crmOrganisations.name,
        vendorId: crmOrganisations.id,
      })
      .from(vendorPricingCatalogs)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricingCatalogs.crmOrganisationId))
      .where(and(
        eq(vendorPricingCatalogs.organizationId, organizationId),
        eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
      ))
      .orderBy(vendorPricingCatalogs.createdAt);

    res.json(items);
  } catch (error) {
    console.error("Get pricing reviews error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/crm/pricing-reviews/:id/:action", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { action } = req.params;
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "Invalid action" });
    }

    const [item] = await db.select().from(vendorPricingCatalogs)
      .where(and(
        eq(vendorPricingCatalogs.id, req.params.id),
        eq(vendorPricingCatalogs.organizationId, organizationId),
        eq(vendorPricingCatalogs.approvalStatus, "PENDING_REVIEW")
      ))
      .limit(1);

    if (!item) {
      return res.status(404).json({ error: "Pricing item not found or already reviewed" });
    }

    const [updated] = await db
      .update(vendorPricingCatalogs)
      .set({
        approvalStatus: action === "approve" ? "APPROVED" : "REJECTED",
        isActive: action === "approve",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricingCatalogs.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Review pricing error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/ai-features/vendor-pricebooks", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const pricebooks = await db
      .select({
        id: vendorPricebooks.id,
        vendorId: vendorPricebooks.vendorId,
        vendorName: crmOrganisations.name,
        version: sql<string>`COALESCE(${vendorPricebooks.fileName}, 'Imported')`,
        effectiveDate: vendorPricebooks.effectiveDate,
        expirationDate: vendorPricebooks.expirationDate,
        itemCount: vendorPricebooks.itemCount,
        isActive: sql<boolean>`${vendorPricebooks.status} = 'ACTIVE'`,
        lastSyncedAt: vendorPricebooks.importedAt,
        createdAt: vendorPricebooks.createdAt,
        status: vendorPricebooks.status,
      })
      .from(vendorPricebooks)
      .innerJoin(crmOrganisations, eq(crmOrganisations.id, vendorPricebooks.vendorId))
      .where(eq(vendorPricebooks.organizationId, organizationId))
      .orderBy(sql`${vendorPricebooks.createdAt} DESC`);

    res.json({ pricebooks });
  } catch (error) {
    console.error("Get vendor pricebooks error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/ai-features/vendor-pricebooks/:pricebookId/items", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const items = await db
      .select({
        id: vendorPricebookItems.id,
        vendorCode: vendorPricebookItems.vendorCode,
        vendorDescription: vendorPricebookItems.vendorDescription,
        category: vendorPricebookItems.category,
        unit: vendorPricebookItems.unit,
        unitPrice: vendorPricebookItems.unitPrice,
        uom: vendorPricebookItems.vendorUnit,
        lastUpdated: vendorPricebookItems.updatedAt,
        isActive: vendorPricebookItems.isActive,
      })
      .from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.pricebookId, req.params.pricebookId),
        eq(vendorPricebookItems.organizationId, organizationId)
      ))
      .orderBy(vendorPricebookItems.category, vendorPricebookItems.vendorDescription);

    res.json({ items });
  } catch (error) {
    console.error("Get pricebook items error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/ai-features/vendor-pricebooks/upload", requireAuth, requireRole("ADMIN", "MANAGER"), upload.single("file"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const { vendorId, effectiveDate } = req.body;
    const file = req.file;

    if (!file || !vendorId) {
      return res.status(400).json({ error: "File and vendor ID are required" });
    }

    const [vendor] = await db.select().from(crmOrganisations)
      .where(eq(crmOrganisations.id, vendorId))
      .limit(1);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const [pricebook] = await db.insert(vendorPricebooks).values({
      organizationId,
      vendorId,
      fileKey: `pricebooks/${organizationId}/${Date.now()}_${file.originalname}`,
      fileName: file.originalname,
      fileType: file.mimetype.includes("csv") ? "CSV" : "XLSX",
      effectiveDate: effectiveDate || null,
      status: "PROCESSING",
      uploadedByUserId: req.user!.id,
    }).returning();

    const xlsx = await import("xlsx");
    const workbook = xlsx.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    if (rows.length < 2) {
      await db.update(vendorPricebooks)
        .set({ status: "PENDING", errorMessage: "File is empty or has no data rows" })
        .where(eq(vendorPricebooks.id, pricebook.id));
      return res.status(400).json({ error: "File has no data rows" });
    }

    const headers = rows[0] as string[];
    const dataRows = rows.slice(1);

    const codeIdx = headers.findIndex(h => /code|sku|item.*no|part.*no/i.test(String(h)));
    const descIdx = headers.findIndex(h => /desc|name|item/i.test(String(h)));
    const priceIdx = headers.findIndex(h => /price|cost|unit.*price/i.test(String(h)));
    const unitIdx = headers.findIndex(h => /unit|uom/i.test(String(h)));
    const categoryIdx = headers.findIndex(h => /cat|type|group/i.test(String(h)));

    let itemsCreated = 0;
    for (const row of dataRows) {
      const code = codeIdx >= 0 ? String(row[codeIdx] || "") : "";
      const descVal = descIdx >= 0 ? String(row[descIdx] || "") : "";
      const price = priceIdx >= 0 ? parseFloat(String(row[priceIdx] || "0")) : 0;
      const unit = unitIdx >= 0 ? String(row[unitIdx] || "EA") : "EA";
      const category = categoryIdx >= 0 ? String(row[categoryIdx] || "Uncategorized") : "Uncategorized";

      if (code || descVal) {
        await db.insert(vendorPricebookItems).values({
          pricebookId: pricebook.id,
          organizationId,
          vendorId,
          vendorCode: code || `AUTO-${itemsCreated + 1}`,
          vendorDescription: descVal || code,
          vendorUnit: unit,
          category,
          unit,
          unitPrice: String(price || 0),
          effectiveDate: effectiveDate || null,
        });
        itemsCreated++;
      }
    }

    await db.update(vendorPricebooks)
      .set({
        itemCount: itemsCreated,
        status: "ACTIVE",
        importedAt: new Date(),
      })
      .where(eq(vendorPricebooks.id, pricebook.id));

    res.status(201).json({
      pricebookId: pricebook.id,
      itemCount: itemsCreated,
      message: `Successfully imported ${itemsCreated} items`,
    });
  } catch (error) {
    console.error("Upload pricebook error:", error);
    res.status(500).json({ error: "Failed to process pricebook file" });
  }
});

router.post("/api/ai-features/vendor-pricebooks/:pricebookId/items", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [pricebook] = await db.select().from(vendorPricebooks)
      .where(and(
        eq(vendorPricebooks.id, req.params.pricebookId),
        eq(vendorPricebooks.organizationId, organizationId)
      ))
      .limit(1);

    if (!pricebook) {
      return res.status(404).json({ error: "Pricebook not found" });
    }

    const { vendorCode, vendorDescription, category, unit, unitPrice } = req.body;

    const [item] = await db.insert(vendorPricebookItems).values({
      pricebookId: pricebook.id,
      organizationId,
      vendorId: pricebook.vendorId,
      vendorCode: vendorCode || `MANUAL-${Date.now()}`,
      vendorDescription: vendorDescription || "",
      vendorUnit: unit || "EA",
      category: category || "Uncategorized",
      unit: unit || "EA",
      unitPrice: String(unitPrice || 0),
    }).returning();

    await db.update(vendorPricebooks)
      .set({ itemCount: sql`${vendorPricebooks.itemCount} + 1` })
      .where(eq(vendorPricebooks.id, pricebook.id));

    res.status(201).json(item);
  } catch (error) {
    console.error("Add pricebook item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/api/ai-features/vendor-pricebooks/items/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [existing] = await db.select().from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.id, req.params.id),
        eq(vendorPricebookItems.organizationId, organizationId)
      ))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    const { vendorCode, vendorDescription, category, unit, unitPrice, isActive } = req.body;

    const [updated] = await db.update(vendorPricebookItems)
      .set({
        ...(vendorCode !== undefined && { vendorCode }),
        ...(vendorDescription !== undefined && { vendorDescription }),
        ...(category !== undefined && { category }),
        ...(unit !== undefined && { unit, vendorUnit: unit }),
        ...(unitPrice !== undefined && { unitPrice: String(unitPrice) }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      })
      .where(eq(vendorPricebookItems.id, req.params.id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Update pricebook item error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/ai-features/vendor-pricebooks/:pricebookId/sync", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(403).json({ error: "Organization not found" });
    }

    const [pricebook] = await db.select().from(vendorPricebooks)
      .where(and(
        eq(vendorPricebooks.id, req.params.pricebookId),
        eq(vendorPricebooks.organizationId, organizationId)
      ))
      .limit(1);

    if (!pricebook) {
      return res.status(404).json({ error: "Pricebook not found" });
    }

    const items = await db.select().from(vendorPricebookItems)
      .where(and(
        eq(vendorPricebookItems.pricebookId, pricebook.id),
        eq(vendorPricebookItems.isActive, true)
      ));

    let syncedCount = 0;
    for (const item of items) {
      const [existing] = await db.select().from(vendorPricingCatalogs)
        .where(and(
          eq(vendorPricingCatalogs.organizationId, organizationId),
          eq(vendorPricingCatalogs.crmOrganisationId, pricebook.vendorId),
          eq(vendorPricingCatalogs.itemCode, item.vendorCode)
        ))
        .limit(1);

      if (existing) {
        await db.update(vendorPricingCatalogs)
          .set({
            itemName: item.vendorDescription,
            category: item.category,
            unit: item.unit,
            unitPrice: item.unitPrice,
            sourceType: "PRICEBOOK_IMPORT",
            updatedAt: new Date(),
          })
          .where(eq(vendorPricingCatalogs.id, existing.id));
      } else {
        const now = new Date();
        const quarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
        await db.insert(vendorPricingCatalogs).values({
          organizationId,
          crmOrganisationId: pricebook.vendorId,
          itemCode: item.vendorCode,
          itemName: item.vendorDescription,
          description: item.vendorDescription,
          category: item.category,
          unit: item.unit,
          unitPrice: item.unitPrice,
          sourceType: "PRICEBOOK_IMPORT",
          approvalStatus: "APPROVED",
          isActive: true,
          effectiveDate: now,
          effectiveQuarter: quarter,
        });
      }
      syncedCount++;
    }

    await db.update(vendorPricebooks)
      .set({ importedAt: new Date() })
      .where(eq(vendorPricebooks.id, pricebook.id));

    res.json({
      success: true,
      syncedItems: syncedCount,
      message: `Successfully synced ${syncedCount} items to catalog`,
    });
  } catch (error) {
    console.error("Sync pricebook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
