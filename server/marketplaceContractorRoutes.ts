import { Router, Response } from "express";
import { db } from "./db";
import {
  organizationNetworkSettings,
  marketplaceReviews,
  organizations,
} from "@shared/schema";
import { eq, and, ne, desc, sql, ilike, gte, or } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./auth";
import { logInfo, logError } from "./utils/logger";
import { z } from "zod";

const router = Router();

// ============================================
// LIST DIRECTORY - public browse (auth required but no org restriction)
// ============================================
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
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
router.get("/:orgId", requireAuth, async (req: AuthRequest, res: Response) => {
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
router.patch("/:orgId/profile", requireAuth, async (req: AuthRequest, res: Response) => {
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
router.post("/:orgId/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
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
router.get("/:orgId/reviews", requireAuth, async (req: AuthRequest, res: Response) => {
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

export default router;
