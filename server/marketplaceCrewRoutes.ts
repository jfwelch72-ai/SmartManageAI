import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { crewMarketplace, insertCrewMarketplaceSchema, crews, organizations } from "@shared/schema";
import { eq, and, desc, asc, gte, lte, or, isNull, sql, ilike } from "drizzle-orm";

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
router.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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
    console.error("Error fetching crew listings:", error);
    res.status(500).json({ error: "Failed to fetch crew listings" });
  }
});

// GET /api/marketplace/crews/my - List caller's org's listings
router.get("/my", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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
    console.error("Error fetching own crew listings:", error);
    res.status(500).json({ error: "Failed to fetch crew listings" });
  }
});

// GET /api/marketplace/crews/:id - Single listing
router.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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

// POST /api/marketplace/crews - Create listing (org admin/manager only)
router.post("/", requireAuth, requireOrgRole, async (req: AuthenticatedRequest, res: Response) => {
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

// PATCH /api/marketplace/crews/:id - Update own listing
router.patch("/:id", requireAuth, requireOrgRole, async (req: AuthenticatedRequest, res: Response) => {
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
      .where(eq(crewMarketplace.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating crew listing:", error);
    res.status(500).json({ error: "Failed to update crew listing" });
  }
});

// DELETE /api/marketplace/crews/:id - Delete own listing
router.delete("/:id", requireAuth, requireOrgRole, async (req: AuthenticatedRequest, res: Response) => {
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
    console.error("Error deleting crew listing:", error);
    res.status(500).json({ error: "Failed to delete crew listing" });
  }
});

export default router;
