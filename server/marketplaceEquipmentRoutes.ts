import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import {
  equipmentListings,
  equipmentRentalRequests,
  insertEquipmentListingSchema,
  insertEquipmentRentalRequestSchema,
  organizations,
  users,
} from "@shared/schema";
import { eq, and, desc, asc, or, ilike, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { insertNotification } from "./services/notificationService";

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
    console.error("Error fetching equipment listings:", error);
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
    console.error("Error fetching own equipment listings:", error);
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
    console.error("Error fetching equipment listing:", error);
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
    console.error("Error creating equipment listing:", error);
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
      .where(eq(equipmentListings.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating equipment listing:", error);
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
    console.error("Error deleting equipment listing:", error);
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
        type: "EQUIPMENT_RENTAL_REQUEST_RECEIVED",
        title: "New Equipment Rental Request",
        message: `A rental inquiry has been submitted for your listing: ${listing.name}`,
        relatedEntityId: created.id,
        relatedEntityType: "equipment_rental_request",
      });
    }

    res.status(201).json(created);
  } catch (error) {
    console.error("Error submitting rental request:", error);
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
    console.error("Error fetching rental requests:", error);
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
    console.error("Error fetching my rental requests:", error);
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
        type: "EQUIPMENT_RENTAL_REQUEST_RESPONDED",
        title: `Rental Request ${validation.data.status === "ACCEPTED" ? "Accepted" : "Declined"}`,
        message: `Your rental request for "${listing.name}" has been ${statusLabel}.`,
        relatedEntityId: updated.id,
        relatedEntityType: "equipment_rental_request",
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error responding to rental request:", error);
    res.status(500).json({ error: "Failed to respond to rental request" });
  }
});

export default router;
