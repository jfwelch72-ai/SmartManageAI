import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { 
  vendorScores, insertVendorScoreSchema,
  materialPriceIndex, insertMaterialPriceIndexSchema,
  crewMarketplace, insertCrewMarketplaceSchema,
  crmOrganisations, projects, users, crews
} from "@shared/schema";
import { eq, and, desc, asc, gte, lte, or, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

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
    console.error("Error fetching vendor scores:", error);
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
    console.error("Error fetching vendor score summary:", error);
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
    console.error("Error fetching vendor score:", error);
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
    console.error("Error creating vendor score:", error);
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
      .where(eq(vendorScores.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating vendor score:", error);
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
    console.error("Error deleting vendor score:", error);
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
    console.error("Error fetching material prices:", error);
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
    console.error("Error fetching categories:", error);
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
    console.error("Error fetching price history:", error);
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
    console.error("Error fetching material price:", error);
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
    console.error("Error creating material price:", error);
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
      .where(eq(materialPriceIndex.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating material price:", error);
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
    console.error("Error deleting material price:", error);
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
    console.error("Error fetching crew listings:", error);
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
    console.error("Error searching crews:", error);
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
    console.error("Error fetching crew stats:", error);
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
    console.error("Error fetching crew listing:", error);
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
    console.error("Error creating crew listing:", error);
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
      .where(eq(crewMarketplace.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating crew listing:", error);
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
    console.error("Error deleting crew listing:", error);
    res.status(500).json({ error: "Failed to delete crew listing" });
  }
});

export default router;
