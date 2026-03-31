import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { vendorScores, insertVendorScoreSchema, materialPriceIndex, insertMaterialPriceIndexSchema, crewMarketplace, insertCrewMarketplaceSchema, crmOrganisations, projects, users, crews, organizationNetworkSettings, marketplaceReviews, organizations, equipmentListings, equipmentRentalRequests, insertEquipmentListingSchema, insertEquipmentRentalRequestSchema, talentProfiles } from "@shared/schema";
import { eq, and, desc, asc, gte, lte, or, isNull, sql, ne, ilike } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, AuthRequest } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { insertNotification } from "./services/notificationService";

const router = Router();

// ========================================
// Routes from marketplaceRoutes.ts
// ========================================

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    organizationId: string;
    role: string;
  };
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

// ==========================================
// VENDOR SCORES ROUTES
// ==========================================

router.get("/vendor-scores", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { vendorId, projectId } = req.query;

    let conditions = [eq(vendorScores.organizationId, organizationId)];
    
    if (vendorId && typeof vendorId === "string") {
      conditions.push(eq(vendorScores.crmEntityId, vendorId));
    }
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(vendorScores.projectId, projectId));
    }

    const scores = await db
      .select({
        score: vendorScores,
        vendor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
          type: crmOrganisations.type,
        },
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
        scoredBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(vendorScores)
      .leftJoin(crmOrganisations, eq(vendorScores.crmEntityId, crmOrganisations.id))
      .leftJoin(projects, eq(vendorScores.projectId, projects.id))
      .leftJoin(users, eq(vendorScores.scoredById, users.id))
      .where(and(...conditions))
      .orderBy(desc(vendorScores.scoreDate));

    res.json(scores);
  } catch (error) {
    logError("Error fetching vendor scores:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch vendor scores" });
  }
});

router.get("/vendor-scores/summary/by-vendor", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const summary = await db
      .select({
        vendorId: vendorScores.crmEntityId,
        vendorName: crmOrganisations.name,
        vendorType: crmOrganisations.type,
        avgOnTimeDelivery: sql<string>`AVG(${vendorScores.onTimeDeliveryScore}::numeric)`,
        avgQuality: sql<string>`AVG(${vendorScores.qualityScore}::numeric)`,
        avgCommunication: sql<string>`AVG(${vendorScores.communicationScore}::numeric)`,
        avgPriceCompetitiveness: sql<string>`AVG(${vendorScores.priceCompetitivenessScore}::numeric)`,
        avgReliability: sql<string>`AVG(${vendorScores.reliabilityScore}::numeric)`,
        avgOverall: sql<string>`AVG(${vendorScores.overallScore}::numeric)`,
        scoreCount: sql<number>`COUNT(*)::int`,
      })
      .from(vendorScores)
      .leftJoin(crmOrganisations, eq(vendorScores.crmEntityId, crmOrganisations.id))
      .where(eq(vendorScores.organizationId, organizationId))
      .groupBy(vendorScores.crmEntityId, crmOrganisations.name, crmOrganisations.type)
      .orderBy(desc(sql`AVG(${vendorScores.overallScore}::numeric)`));

    res.json(summary);
  } catch (error) {
    logError("Error fetching vendor score summary:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch vendor score summary" });
  }
});

router.get("/vendor-scores/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [score] = await db
      .select({
        score: vendorScores,
        vendor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
          type: crmOrganisations.type,
        },
        project: {
          id: projects.id,
          name: projects.name,
          code: projects.code,
        },
        scoredBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(vendorScores)
      .leftJoin(crmOrganisations, eq(vendorScores.crmEntityId, crmOrganisations.id))
      .leftJoin(projects, eq(vendorScores.projectId, projects.id))
      .leftJoin(users, eq(vendorScores.scoredById, users.id))
      .where(and(eq(vendorScores.id, id), eq(vendorScores.organizationId, organizationId)))
      .limit(1);

    if (!score) {
      return res.status(404).json({ error: "Vendor score not found" });
    }

    res.json(score);
  } catch (error) {
    logError("Error fetching vendor score:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch vendor score" });
  }
});

router.post("/vendor-scores", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const body = {
      ...req.body,
      organizationId,
      scoredById: userId,
    };

    const validationResult = insertVendorScoreSchema.safeParse(body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
    }

    const data = validationResult.data;
    const scores = [
      data.onTimeDeliveryScore ? parseFloat(data.onTimeDeliveryScore) : null,
      data.qualityScore ? parseFloat(data.qualityScore) : null,
      data.communicationScore ? parseFloat(data.communicationScore) : null,
      data.priceCompetitivenessScore ? parseFloat(data.priceCompetitivenessScore) : null,
      data.reliabilityScore ? parseFloat(data.reliabilityScore) : null,
    ].filter(s => s !== null) as number[];

    const overallScore = scores.length > 0 
      ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
      : null;

    const [newScore] = await db
      .insert(vendorScores)
      .values({ ...data, overallScore })
      .returning();

    res.status(201).json(newScore);
  } catch (error) {
    logError("Error creating vendor score:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create vendor score" });
  }
});

router.patch("/vendor-scores/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(vendorScores)
      .where(and(eq(vendorScores.id, id), eq(vendorScores.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Vendor score not found" });
    }

    const updateData = { ...req.body };
    const scores = [
      updateData.onTimeDeliveryScore ?? existing.onTimeDeliveryScore,
      updateData.qualityScore ?? existing.qualityScore,
      updateData.communicationScore ?? existing.communicationScore,
      updateData.priceCompetitivenessScore ?? existing.priceCompetitivenessScore,
      updateData.reliabilityScore ?? existing.reliabilityScore,
    ].filter(s => s !== null).map(s => parseFloat(s as string));

    if (scores.length > 0) {
      updateData.overallScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
    }

    const [updated] = await db
      .update(vendorScores)
      .set({ ...updateData, updatedAt: new Date() })
      .where(and(eq(vendorScores.id, id), eq(vendorScores.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error updating vendor score:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update vendor score" });
  }
});

router.delete("/vendor-scores/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [deleted] = await db
      .delete(vendorScores)
      .where(and(eq(vendorScores.id, id), eq(vendorScores.organizationId, organizationId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Vendor score not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting vendor score:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete vendor score" });
  }
});

// ==========================================
// MATERIAL PRICE INDEX ROUTES
// ==========================================

router.get("/material-prices", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { category, vendorId, activeOnly } = req.query;

    let conditions = [eq(materialPriceIndex.organizationId, organizationId)];
    
    if (category && typeof category === "string") {
      conditions.push(eq(materialPriceIndex.materialCategory, category));
    }
    if (vendorId && typeof vendorId === "string") {
      conditions.push(eq(materialPriceIndex.sourceVendorId, vendorId));
    }
    if (activeOnly === "true") {
      const today = new Date().toISOString().split("T")[0];
      conditions.push(lte(materialPriceIndex.effectiveDate, today));
      conditions.push(or(
        isNull(materialPriceIndex.expirationDate),
        gte(materialPriceIndex.expirationDate, today)
      )!);
    }

    const prices = await db
      .select({
        price: materialPriceIndex,
        vendor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
        },
        createdBy: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(materialPriceIndex)
      .leftJoin(crmOrganisations, eq(materialPriceIndex.sourceVendorId, crmOrganisations.id))
      .leftJoin(users, eq(materialPriceIndex.createdById, users.id))
      .where(and(...conditions))
      .orderBy(asc(materialPriceIndex.materialName), desc(materialPriceIndex.effectiveDate));

    res.json(prices);
  } catch (error) {
    logError("Error fetching material prices:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch material prices" });
  }
});

router.get("/material-prices/categories/list", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const categories = await db
      .selectDistinct({ category: materialPriceIndex.materialCategory })
      .from(materialPriceIndex)
      .where(eq(materialPriceIndex.organizationId, organizationId))
      .orderBy(asc(materialPriceIndex.materialCategory));

    res.json(categories.filter(c => c.category).map(c => c.category));
  } catch (error) {
    logError("Error fetching categories:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

router.get("/material-prices/history/:materialName", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { materialName } = req.params;

    const history = await db
      .select({
        price: materialPriceIndex,
        vendor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
        },
      })
      .from(materialPriceIndex)
      .leftJoin(crmOrganisations, eq(materialPriceIndex.sourceVendorId, crmOrganisations.id))
      .where(and(
        eq(materialPriceIndex.organizationId, organizationId),
        eq(materialPriceIndex.materialName, decodeURIComponent(materialName))
      ))
      .orderBy(desc(materialPriceIndex.effectiveDate));

    res.json(history);
  } catch (error) {
    logError("Error fetching price history:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch price history" });
  }
});

router.get("/material-prices/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [price] = await db
      .select({
        price: materialPriceIndex,
        vendor: {
          id: crmOrganisations.id,
          name: crmOrganisations.name,
        },
      })
      .from(materialPriceIndex)
      .leftJoin(crmOrganisations, eq(materialPriceIndex.sourceVendorId, crmOrganisations.id))
      .where(and(eq(materialPriceIndex.id, id), eq(materialPriceIndex.organizationId, organizationId)))
      .limit(1);

    if (!price) {
      return res.status(404).json({ error: "Material price not found" });
    }

    res.json(price);
  } catch (error) {
    logError("Error fetching material price:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch material price" });
  }
});

router.post("/material-prices", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const body = {
      ...req.body,
      organizationId,
      createdById: userId,
    };

    const validationResult = insertMaterialPriceIndexSchema.safeParse(body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
    }

    const [newPrice] = await db
      .insert(materialPriceIndex)
      .values(validationResult.data)
      .returning();

    res.status(201).json(newPrice);
  } catch (error) {
    logError("Error creating material price:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create material price" });
  }
});

router.patch("/material-prices/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(materialPriceIndex)
      .where(and(eq(materialPriceIndex.id, id), eq(materialPriceIndex.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Material price not found" });
    }

    const [updated] = await db
      .update(materialPriceIndex)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(materialPriceIndex.id, id), eq(materialPriceIndex.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error updating material price:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update material price" });
  }
});

router.delete("/material-prices/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [deleted] = await db
      .delete(materialPriceIndex)
      .where(and(eq(materialPriceIndex.id, id), eq(materialPriceIndex.organizationId, organizationId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Material price not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting material price:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete material price" });
  }
});

// ==========================================
// CREW MARKETPLACE ROUTES
// ==========================================

router.get("/crew-listings", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { tradeType, status, location, ownOnly } = req.query;

    let conditions: any[] = [];
    
    if (ownOnly === "true") {
      conditions.push(eq(crewMarketplace.organizationId, organizationId));
    } else {
      conditions.push(or(
        eq(crewMarketplace.organizationId, organizationId),
        eq(crewMarketplace.isPublic, true)
      )!);
    }

    if (tradeType && typeof tradeType === "string") {
      conditions.push(eq(crewMarketplace.tradeType, tradeType as any));
    }
    if (status && typeof status === "string") {
      conditions.push(eq(crewMarketplace.availabilityStatus, status as any));
    }
    if (location && typeof location === "string") {
      conditions.push(sql`${crewMarketplace.baseLocation} ILIKE ${'%' + location + '%'}`);
    }

    const listings = await db
      .select({
        listing: crewMarketplace,
        crew: {
          id: crews.id,
          name: crews.name,
        },
      })
      .from(crewMarketplace)
      .leftJoin(crews, eq(crewMarketplace.crewId, crews.id))
      .where(and(...conditions))
      .orderBy(desc(crewMarketplace.rating), desc(crewMarketplace.updatedAt));

    res.json(listings);
  } catch (error) {
    logError("Error fetching crew listings:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch crew listings" });
  }
});

router.get("/crew-listings/search/available", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tradeType, startDate, endDate, minRating, location } = req.query;

    let conditions: any[] = [
      eq(crewMarketplace.isPublic, true),
      eq(crewMarketplace.availabilityStatus, "AVAILABLE"),
    ];

    if (tradeType && typeof tradeType === "string") {
      conditions.push(eq(crewMarketplace.tradeType, tradeType as any));
    }
    if (startDate && typeof startDate === "string") {
      conditions.push(or(
        isNull(crewMarketplace.availableFrom),
        lte(crewMarketplace.availableFrom, startDate)
      )!);
    }
    if (endDate && typeof endDate === "string") {
      conditions.push(or(
        isNull(crewMarketplace.availableTo),
        gte(crewMarketplace.availableTo, endDate)
      )!);
    }
    if (minRating && typeof minRating === "string") {
      conditions.push(gte(crewMarketplace.rating, minRating));
    }
    if (location && typeof location === "string") {
      conditions.push(sql`${crewMarketplace.baseLocation} ILIKE ${'%' + location + '%'}`);
    }

    const results = await db
      .select()
      .from(crewMarketplace)
      .where(and(...conditions))
      .orderBy(desc(crewMarketplace.rating), asc(crewMarketplace.hourlyRate));

    res.json(results);
  } catch (error) {
    logError("Error searching crews:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to search crews" });
  }
});

router.get("/crew-listings/stats/by-trade", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await db
      .select({
        tradeType: crewMarketplace.tradeType,
        count: sql<number>`COUNT(*)::int`,
        avgRating: sql<string>`AVG(${crewMarketplace.rating}::numeric)`,
        avgHourlyRate: sql<string>`AVG(${crewMarketplace.hourlyRate}::numeric)`,
      })
      .from(crewMarketplace)
      .where(eq(crewMarketplace.isPublic, true))
      .groupBy(crewMarketplace.tradeType)
      .orderBy(desc(sql`COUNT(*)`));

    res.json(stats);
  } catch (error) {
    logError("Error fetching crew stats:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch crew stats" });
  }
});

router.get("/crew-listings/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [listing] = await db
      .select({
        listing: crewMarketplace,
        crew: {
          id: crews.id,
          name: crews.name,
        },
      })
      .from(crewMarketplace)
      .leftJoin(crews, eq(crewMarketplace.crewId, crews.id))
      .where(and(
        eq(crewMarketplace.id, id),
        or(
          eq(crewMarketplace.organizationId, organizationId),
          eq(crewMarketplace.isPublic, true)
        )!
      ))
      .limit(1);

    if (!listing) {
      return res.status(404).json({ error: "Crew listing not found" });
    }

    res.json(listing);
  } catch (error) {
    logError("Error fetching crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch crew listing" });
  }
});

router.post("/crew-listings", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const body = {
      ...req.body,
      organizationId,
    };

    const validationResult = insertCrewMarketplaceSchema.safeParse(body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
    }

    const [newListing] = await db
      .insert(crewMarketplace)
      .values(validationResult.data)
      .returning();

    res.status(201).json(newListing);
  } catch (error) {
    logError("Error creating crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create crew listing" });
  }
});

router.patch("/crew-listings/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(crewMarketplace)
      .where(and(eq(crewMarketplace.id, id), eq(crewMarketplace.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Crew listing not found" });
    }

    const [updated] = await db
      .update(crewMarketplace)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(crewMarketplace.id, id), eq(crewMarketplace.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error updating crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update crew listing" });
  }
});

router.delete("/crew-listings/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [deleted] = await db
      .delete(crewMarketplace)
      .where(and(eq(crewMarketplace.id, id), eq(crewMarketplace.organizationId, organizationId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Crew listing not found" });
    }

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete crew listing" });
  }
});

// ========================================
// Routes from marketplaceContractorRoutes.ts
// ========================================

// ============================================
// LIST DIRECTORY - public browse (auth required but no org restriction)
// ============================================
router.get("/contractors", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { search, trade, location, minRating } = req.query;

    const results = await db
      .select({
        settings: organizationNetworkSettings,
        org: organizations,
      })
      .from(organizationNetworkSettings)
      .innerJoin(organizations, eq(organizationNetworkSettings.organizationId, organizations.id))
      .where(eq(organizationNetworkSettings.isDirectoryListed, true))
      .orderBy(desc(organizationNetworkSettings.avgRating));

    let filtered = results;

    if (search && typeof search === "string" && search.trim()) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.org.name.toLowerCase().includes(s) ||
          (r.settings.bio && r.settings.bio.toLowerCase().includes(s)) ||
          (r.settings.companyDescription && r.settings.companyDescription.toLowerCase().includes(s))
      );
    }

    if (trade && typeof trade === "string" && trade !== "all") {
      filtered = filtered.filter(
        (r) =>
          r.org.tradeType === trade ||
          (r.settings.tradeSpecialties && r.settings.tradeSpecialties.includes(trade))
      );
    }

    if (location && typeof location === "string" && location.trim()) {
      const loc = location.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.settings.serviceAreas &&
          r.settings.serviceAreas.some((a) => a.toLowerCase().includes(loc))
      );
    }

    if (minRating && typeof minRating === "string") {
      const min = parseFloat(minRating);
      if (!isNaN(min)) {
        filtered = filtered.filter(
          (r) => r.settings.avgRating !== null && parseFloat(r.settings.avgRating as string) >= min
        );
      }
    }

    res.json(
      filtered.map((r) => ({
        orgId: r.org.id,
        name: r.org.name,
        tradeType: r.org.tradeType,
        logoUrl: r.org.logoUrl,
        serviceAreas: r.settings.serviceAreas || [],
        tradeSpecialties: r.settings.tradeSpecialties || [],
        avgRating: r.settings.avgRating ? parseFloat(r.settings.avgRating as string) : null,
        reviewCount: r.settings.reviewCount || 0,
        foundedYear: r.settings.foundedYear,
        bio: r.settings.bio,
        portfolioPhotos: (r.settings.portfolioPhotos || []).slice(0, 1),
        certifications: r.settings.certifications || [],
        yearsInBusiness: r.settings.yearsInBusiness,
      }))
    );
  } catch (error) {
    logError("Failed to list contractor directory", undefined, error as Error);
    res.status(500).json({ error: "Failed to list contractor directory" });
  }
});

// ============================================
// GET SINGLE CONTRACTOR PROFILE
// ============================================
router.get("/contractors/:orgId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId } = req.params;

    const [result] = await db
      .select({
        settings: organizationNetworkSettings,
        org: organizations,
      })
      .from(organizationNetworkSettings)
      .innerJoin(organizations, eq(organizationNetworkSettings.organizationId, organizations.id))
      .where(
        and(
          eq(organizationNetworkSettings.organizationId, orgId),
          eq(organizationNetworkSettings.isDirectoryListed, true)
        )
      );

    if (!result) {
      // Check if it's own org requesting own profile (for edit view)
      const user = req.user!;
      if (user.organizationId !== orgId) {
        return res.status(404).json({ error: "Contractor not found in directory" });
      }
      // Return settings even if not listed (for own org)
      const [ownResult] = await db
        .select({ settings: organizationNetworkSettings, org: organizations })
        .from(organizationNetworkSettings)
        .innerJoin(organizations, eq(organizationNetworkSettings.organizationId, organizations.id))
        .where(eq(organizationNetworkSettings.organizationId, orgId));

      if (!ownResult) {
        return res.status(404).json({ error: "Organization not found" });
      }

      return res.json(buildProfile(ownResult));
    }

    res.json(buildProfile(result));
  } catch (error) {
    logError("Failed to get contractor profile", undefined, error as Error);
    res.status(500).json({ error: "Failed to get contractor profile" });
  }
});

function buildProfile(r: {
  settings: typeof organizationNetworkSettings.$inferSelect;
  org: typeof organizations.$inferSelect;
}) {
  return {
    orgId: r.org.id,
    name: r.org.name,
    tradeType: r.org.tradeType,
    logoUrl: r.org.logoUrl,
    bio: r.settings.bio,
    foundedYear: r.settings.foundedYear,
    companyDescription: r.settings.companyDescription,
    serviceAreas: r.settings.serviceAreas || [],
    tradeSpecialties: r.settings.tradeSpecialties || [],
    certifications: r.settings.certifications || [],
    licenseNumbers: r.settings.licenseNumbers || [],
    portfolioPhotos: (r.settings.portfolioPhotos || []).slice(0, 20),
    avgRating: r.settings.avgRating ? parseFloat(r.settings.avgRating as string) : null,
    reviewCount: r.settings.reviewCount || 0,
    isDirectoryListed: r.settings.isDirectoryListed,
    yearsInBusiness: r.settings.yearsInBusiness,
  };
}

// ============================================
// UPDATE OWN MARKETPLACE PROFILE
// ============================================
router.patch("/contractors/:orgId/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId } = req.params;
    const user = req.user!;

    if (user.organizationId !== orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Access denied" });
    }

    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN" && user.role !== "MANAGER") {
      return res.status(403).json({ error: "Only admins can update marketplace profile" });
    }

    const updateSchema = z.object({
      bio: z.string().optional().nullable(),
      foundedYear: z.number().int().min(1800).max(new Date().getFullYear()).optional().nullable(),
      licenseNumbers: z.array(z.string()).optional(),
      portfolioPhotos: z.array(z.string().url()).max(20).optional(),
      isDirectoryListed: z.boolean().optional(),
    });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.issues });
    }

    const data = parsed.data;

    const [existing] = await db
      .select()
      .from(organizationNetworkSettings)
      .where(eq(organizationNetworkSettings.organizationId, orgId));

    if (existing) {
      const [updated] = await db
        .update(organizationNetworkSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(organizationNetworkSettings.organizationId, orgId))
        .returning();
      logInfo("Marketplace profile updated", { orgId, userId: user.id });
      return res.json(updated);
    } else {
      const [created] = await db
        .insert(organizationNetworkSettings)
        .values({ ...data, organizationId: orgId })
        .returning();
      logInfo("Marketplace profile created", { orgId, userId: user.id });
      return res.json(created);
    }
  } catch (error) {
    logError("Failed to update marketplace profile", undefined, error as Error);
    res.status(500).json({ error: "Failed to update marketplace profile" });
  }
});

// ============================================
// SUBMIT REVIEW
// ============================================
router.post("/contractors/:orgId/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId } = req.params;
    const user = req.user!;

    if (!user.organizationId) {
      return res.status(400).json({ error: "Must belong to an organization to submit a review" });
    }

    if (user.organizationId === orgId) {
      return res.status(403).json({ error: "Cannot review your own organization" });
    }

    const reviewSchema = z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(2000).optional().nullable(),
      projectRef: z.string().max(200).optional().nullable(),
    });

    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid review data", details: parsed.error.issues });
    }

    const { rating, comment, projectRef } = parsed.data;

    // Check for existing review (one per org pair)
    const [existing] = await db
      .select()
      .from(marketplaceReviews)
      .where(
        and(
          eq(marketplaceReviews.reviewerOrgId, user.organizationId),
          eq(marketplaceReviews.revieweeOrgId, orgId)
        )
      );

    if (existing) {
      return res.status(409).json({ error: "Your organization has already reviewed this contractor" });
    }

    const [review] = await db
      .insert(marketplaceReviews)
      .values({
        reviewerOrgId: user.organizationId,
        revieweeOrgId: orgId,
        rating,
        comment: comment || null,
        projectRef: projectRef || null,
      })
      .returning();

    // Update avg rating and review count
    const allReviews = await db
      .select({ rating: marketplaceReviews.rating })
      .from(marketplaceReviews)
      .where(eq(marketplaceReviews.revieweeOrgId, orgId));

    const count = allReviews.length;
    const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / count;

    await db
      .update(organizationNetworkSettings)
      .set({
        avgRating: avg.toFixed(2),
        reviewCount: count,
        updatedAt: new Date(),
      })
      .where(eq(organizationNetworkSettings.organizationId, orgId));

    logInfo("Marketplace review submitted", { reviewId: review.id, orgId, reviewerOrgId: user.organizationId });
    res.status(201).json(review);
  } catch (error) {
    logError("Failed to submit review", undefined, error as Error);
    res.status(500).json({ error: "Failed to submit review" });
  }
});

// ============================================
// LIST REVIEWS FOR A CONTRACTOR
// ============================================
router.get("/contractors/:orgId/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId } = req.params;

    const reviews = await db
      .select({
        review: marketplaceReviews,
        reviewerOrg: organizations,
      })
      .from(marketplaceReviews)
      .innerJoin(organizations, eq(marketplaceReviews.reviewerOrgId, organizations.id))
      .where(eq(marketplaceReviews.revieweeOrgId, orgId))
      .orderBy(desc(marketplaceReviews.createdAt));

    res.json(
      reviews.map((r) => ({
        id: r.review.id,
        rating: r.review.rating,
        comment: r.review.comment,
        projectRef: r.review.projectRef,
        createdAt: r.review.createdAt,
        reviewerOrg: {
          id: r.reviewerOrg.id,
          name: r.reviewerOrg.name,
          logoUrl: r.reviewerOrg.logoUrl,
        },
      }))
    );
  } catch (error) {
    logError("Failed to list reviews", undefined, error as Error);
    res.status(500).json({ error: "Failed to list reviews" });
  }
});

// ========================================
// Routes from marketplaceCrewRoutes.ts
// ========================================

function requireOrgRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const allowed = ["ADMIN", "MANAGER", "SUPER_ADMIN", "ORG_ADMIN"];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

// GET /api/marketplace/crews - List public crew listings with filters
router.get("/crews", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tradeType, location, status, availableFrom, availableTo } = req.query;

    let conditions: any[] = [eq(crewMarketplace.isPublic, true)];

    if (tradeType && typeof tradeType === "string") {
      conditions.push(eq(crewMarketplace.tradeType, tradeType as any));
    }
    if (status && typeof status === "string") {
      conditions.push(eq(crewMarketplace.availabilityStatus, status as any));
    }
    if (location && typeof location === "string") {
      conditions.push(sql`${crewMarketplace.baseLocation} ILIKE ${'%' + location + '%'}`);
    }
    if (availableFrom && typeof availableFrom === "string") {
      conditions.push(or(
        isNull(crewMarketplace.availableTo),
        gte(crewMarketplace.availableTo, availableFrom)
      )!);
    }
    if (availableTo && typeof availableTo === "string") {
      conditions.push(or(
        isNull(crewMarketplace.availableFrom),
        lte(crewMarketplace.availableFrom, availableTo)
      )!);
    }

    const listings = await db
      .select({
        listing: crewMarketplace,
        crew: {
          id: crews.id,
          name: crews.name,
        },
      })
      .from(crewMarketplace)
      .leftJoin(crews, eq(crewMarketplace.crewId, crews.id))
      .where(and(...conditions))
      .orderBy(desc(crewMarketplace.rating), desc(crewMarketplace.updatedAt));

    res.json(listings);
  } catch (error) {
    logError("Error fetching crew listings:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch crew listings" });
  }
});

// GET /api/marketplace/crews/my - List caller's org's listings
router.get("/crews/my", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const listings = await db
      .select({
        listing: crewMarketplace,
        crew: {
          id: crews.id,
          name: crews.name,
        },
      })
      .from(crewMarketplace)
      .leftJoin(crews, eq(crewMarketplace.crewId, crews.id))
      .where(eq(crewMarketplace.organizationId, organizationId))
      .orderBy(desc(crewMarketplace.updatedAt));

    res.json(listings);
  } catch (error) {
    logError("Error fetching own crew listings:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch crew listings" });
  }
});

// GET /api/marketplace/crews/:id - Single listing
router.get("/crews/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [listing] = await db
      .select({
        listing: crewMarketplace,
        crew: {
          id: crews.id,
          name: crews.name,
        },
      })
      .from(crewMarketplace)
      .leftJoin(crews, eq(crewMarketplace.crewId, crews.id))
      .where(and(
        eq(crewMarketplace.id, id),
        or(
          eq(crewMarketplace.organizationId, organizationId),
          eq(crewMarketplace.isPublic, true)
        )!
      ))
      .limit(1);

    if (!listing) {
      return res.status(404).json({ error: "Crew listing not found" });
    }

    res.json(listing);
  } catch (error) {
    logError("Error fetching crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch crew listing" });
  }
});

// POST /api/marketplace/crews - Create listing (org admin/manager only)
router.post("/crews", requireAuth, requireOrgRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const body = {
      ...req.body,
      organizationId,
    };

    const validationResult = insertCrewMarketplaceSchema.safeParse(body);
    if (!validationResult.success) {
      return res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
    }

    const [newListing] = await db
      .insert(crewMarketplace)
      .values(validationResult.data)
      .returning();

    res.status(201).json(newListing);
  } catch (error) {
    logError("Error creating crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create crew listing" });
  }
});

// PATCH /api/marketplace/crews/:id - Update own listing
router.patch("/crews/:id", requireAuth, requireOrgRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(crewMarketplace)
      .where(and(eq(crewMarketplace.id, id), eq(crewMarketplace.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Crew listing not found or access denied" });
    }

    const { organizationId: _orgId, id: _id, createdAt, ...updateBody } = req.body;

    const [updated] = await db
      .update(crewMarketplace)
      .set({ ...updateBody, updatedAt: new Date() })
      .where(and(eq(crewMarketplace.id, id), eq(crewMarketplace.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error updating crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update crew listing" });
  }
});

// DELETE /api/marketplace/crews/:id - Delete own listing
router.delete("/crews/:id", requireAuth, requireOrgRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [deleted] = await db
      .delete(crewMarketplace)
      .where(and(eq(crewMarketplace.id, id), eq(crewMarketplace.organizationId, organizationId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Crew listing not found or access denied" });
    }

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting crew listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete crew listing" });
  }
});

// ========================================
// Routes from marketplaceEquipmentRoutes.ts
// ========================================

// GET /api/marketplace/equipment - Browse all active listings
router.get("/equipment", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, location, minRate, maxRate } = req.query;

    let conditions: any[] = [eq(equipmentListings.isActive, true)];

    if (category && typeof category === "string") {
      conditions.push(eq(equipmentListings.category, category as any));
    }
    if (location && typeof location === "string") {
      conditions.push(ilike(equipmentListings.location, `%${location}%`));
    }
    if (minRate && typeof minRate === "string") {
      conditions.push(gte(equipmentListings.dailyRate, minRate));
    }
    if (maxRate && typeof maxRate === "string") {
      conditions.push(lte(equipmentListings.dailyRate, maxRate));
    }

    const listings = await db
      .select({
        listing: equipmentListings,
        ownerOrg: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(equipmentListings)
      .leftJoin(organizations, eq(equipmentListings.organizationId, organizations.id))
      .where(and(...conditions))
      .orderBy(desc(equipmentListings.createdAt));

    res.json(listings);
  } catch (error) {
    logError("Error fetching equipment listings:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch equipment listings" });
  }
});

// GET /api/marketplace/equipment/my - Own org's listings
router.get("/equipment/my", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const listings = await db
      .select({
        listing: equipmentListings,
        ownerOrg: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(equipmentListings)
      .leftJoin(organizations, eq(equipmentListings.organizationId, organizations.id))
      .where(eq(equipmentListings.organizationId, organizationId))
      .orderBy(desc(equipmentListings.createdAt));

    res.json(listings);
  } catch (error) {
    logError("Error fetching own equipment listings:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch your listings" });
  }
});

// GET /api/marketplace/equipment/:id - Single listing
router.get("/equipment/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const [listing] = await db
      .select({
        listing: equipmentListings,
        ownerOrg: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(equipmentListings)
      .leftJoin(organizations, eq(equipmentListings.organizationId, organizations.id))
      .where(eq(equipmentListings.id, id))
      .limit(1);

    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }

    res.json(listing);
  } catch (error) {
    logError("Error fetching equipment listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch listing" });
  }
});

// POST /api/marketplace/equipment - Create listing
router.post("/equipment", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    const body = { ...req.body, organizationId };
    const validation = insertEquipmentListingSchema.safeParse(body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const [created] = await db
      .insert(equipmentListings)
      .values(validation.data)
      .returning();

    res.status(201).json(created);
  } catch (error) {
    logError("Error creating equipment listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create listing" });
  }
});

// PATCH /api/marketplace/equipment/:id - Update listing (owner only)
router.patch("/equipment/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(equipmentListings)
      .where(and(eq(equipmentListings.id, id), eq(equipmentListings.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Listing not found or access denied" });
    }

    const [updated] = await db
      .update(equipmentListings)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(equipmentListings.id, id), eq(equipmentListings.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error updating equipment listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update listing" });
  }
});

// DELETE /api/marketplace/equipment/:id - Delete listing (owner only)
router.delete("/equipment/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id } = req.params;

    const [deleted] = await db
      .delete(equipmentListings)
      .where(and(eq(equipmentListings.id, id), eq(equipmentListings.organizationId, organizationId)))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Listing not found or access denied" });
    }

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting equipment listing:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete listing" });
  }
});

// POST /api/marketplace/equipment/:id/requests - Submit rental inquiry
router.post("/equipment/:id/requests", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requesterOrgId = req.user!.organizationId;
    const { id: listingId } = req.params;

    const [listing] = await db
      .select()
      .from(equipmentListings)
      .where(and(eq(equipmentListings.id, listingId), eq(equipmentListings.isActive, true)))
      .limit(1);

    if (!listing) {
      return res.status(404).json({ error: "Listing not found or inactive" });
    }

    if (listing.organizationId === requesterOrgId) {
      return res.status(400).json({ error: "Cannot request rental from your own listing" });
    }

    const body = { ...req.body, listingId, requesterOrgId };
    const validation = insertEquipmentRentalRequestSchema.safeParse(body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const [created] = await db
      .insert(equipmentRentalRequests)
      .values(validation.data)
      .returning();

    // Find owner org's admin users to notify
    const ownerAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, listing.organizationId),
          or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER"))
        )
      );

    for (const admin of ownerAdmins) {
      await insertNotification({
        userId: admin.id,
        organizationId: listing.organizationId,
        type: "EQUIPMENT_RENTAL_REQUEST_RECEIVED",
        title: "New Equipment Rental Request",
        message: `A rental inquiry has been submitted for your listing: ${listing.name}`,
        relatedEntityId: created.id,
        relatedEntityType: "equipment_rental_request",
      });
    }

    res.status(201).json(created);
  } catch (error) {
    logError("Error submitting rental request:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to submit rental request" });
  }
});

// GET /api/marketplace/equipment/:id/requests - Owner sees requests for their listing
router.get("/equipment/:id/requests", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id: listingId } = req.params;

    const [listing] = await db
      .select()
      .from(equipmentListings)
      .where(and(eq(equipmentListings.id, listingId), eq(equipmentListings.organizationId, organizationId)))
      .limit(1);

    if (!listing) {
      return res.status(404).json({ error: "Listing not found or access denied" });
    }

    const requests = await db
      .select({
        request: equipmentRentalRequests,
        requesterOrg: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(equipmentRentalRequests)
      .leftJoin(organizations, eq(equipmentRentalRequests.requesterOrgId, organizations.id))
      .where(eq(equipmentRentalRequests.listingId, listingId))
      .orderBy(desc(equipmentRentalRequests.createdAt));

    res.json(requests);
  } catch (error) {
    logError("Error fetching rental requests:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch rental requests" });
  }
});

// GET /api/marketplace/equipment/requests/my - Requester sees their own requests
router.get("/equipment/requests/my", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requesterOrgId = req.user!.organizationId;

    const requests = await db
      .select({
        request: equipmentRentalRequests,
        listing: {
          id: equipmentListings.id,
          name: equipmentListings.name,
          category: equipmentListings.category,
          dailyRate: equipmentListings.dailyRate,
          location: equipmentListings.location,
          organizationId: equipmentListings.organizationId,
        },
        ownerOrg: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(equipmentRentalRequests)
      .leftJoin(equipmentListings, eq(equipmentRentalRequests.listingId, equipmentListings.id))
      .leftJoin(organizations, eq(equipmentListings.organizationId, organizations.id))
      .where(eq(equipmentRentalRequests.requesterOrgId, requesterOrgId))
      .orderBy(desc(equipmentRentalRequests.createdAt));

    res.json(requests);
  } catch (error) {
    logError("Error fetching my rental requests:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch your rental requests" });
  }
});

// PATCH /api/marketplace/equipment/:id/requests/:reqId - Owner responds to a request
router.patch("/equipment/:id/requests/:reqId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { id: listingId, reqId } = req.params;

    const [listing] = await db
      .select()
      .from(equipmentListings)
      .where(and(eq(equipmentListings.id, listingId), eq(equipmentListings.organizationId, organizationId)))
      .limit(1);

    if (!listing) {
      return res.status(404).json({ error: "Listing not found or access denied" });
    }

    const respondSchema = z.object({
      status: z.enum(["ACCEPTED", "DECLINED"]),
      ownerResponse: z.string().optional(),
    });

    const validation = respondSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid input", details: validation.error.errors });
    }

    const [updated] = await db
      .update(equipmentRentalRequests)
      .set({ ...validation.data, updatedAt: new Date() })
      .where(and(eq(equipmentRentalRequests.id, reqId), eq(equipmentRentalRequests.listingId, listingId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Notify requester org admins
    const requesterAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, updated.requesterOrgId),
          or(eq(users.role, "ADMIN"), eq(users.role, "MANAGER"))
        )
      );

    const statusLabel = validation.data.status === "ACCEPTED" ? "accepted" : "declined";
    for (const admin of requesterAdmins) {
      await insertNotification({
        userId: admin.id,
        organizationId: updated.requesterOrgId,
        type: "EQUIPMENT_RENTAL_REQUEST_RESPONDED",
        title: `Rental Request ${validation.data.status === "ACCEPTED" ? "Accepted" : "Declined"}`,
        message: `Your rental request for "${listing.name}" has been ${statusLabel}.`,
        relatedEntityId: updated.id,
        relatedEntityType: "equipment_rental_request",
      });
    }

    res.json(updated);
  } catch (error) {
    logError("Error responding to rental request:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to respond to rental request" });
  }
});

// ==========================================
// TEAM MEMBERS (Talent Pool cross-link)
// ==========================================

router.get("/contractors/:orgId/team-members", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetOrgId = req.params.orgId;

    const members = await db
      .select({
        profile: {
          id: talentProfiles.id,
          headline: talentProfiles.headline,
          tradeSpecialization: talentProfiles.tradeSpecialization,
          availability: talentProfiles.availability,
          yearsOfExperience: talentProfiles.yearsOfExperience,
        },
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(talentProfiles)
      .innerJoin(users, eq(talentProfiles.userId, users.id))
      .where(
        and(
          eq(talentProfiles.organizationId, targetOrgId),
          eq(talentProfiles.isPublished, true),
          eq(talentProfiles.visibility, "PUBLIC"),
        )
      )
      .orderBy(users.firstName);

    res.json(members);
  } catch (error) {
    logError("Error fetching team members:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

export default router;
