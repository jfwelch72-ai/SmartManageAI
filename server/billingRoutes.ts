/**
 * Billing Routes
 * Manage organization subscriptions, add-ons, and entitlements
 */

import { Router, Response } from "express";
import { db } from "./db";
import { 
  organizations,
  organizationSubscriptions, 
  organizationAddOns, 
  organizationUsage,
  insertOrganizationSubscriptionSchema,
  insertOrganizationAddOnSchema
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { AuthRequest, requireAuth, requireRole } from "./auth";
import { getOrgEntitlements, getUsage, isDevMode } from "./services/featureAccess";
import { 
  PlanTier, 
  AddOnKey, 
  PLAN_INFO, 
  ADDON_INFO, 
  ADDON_FEATURES,
  getAvailableFeatures
} from "@shared/billing/plans";
import { logInfo, logError } from "./utils/logger";
import { sensitiveLimiter } from "./rateLimiter";

const router = Router();

/**
 * GET /api/billing/entitlements
 * Get current organization's entitlements, plan, and add-ons
 */
router.get("/entitlements", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    if (!user.organizationId) {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const entitlements = await getOrgEntitlements(user.organizationId, req);
    
    if (!entitlements) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    // Get usage data
    const aiVisionUsage = await getUsage(user.organizationId, "ai_vision_docs");

    // Get organization info
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, user.organizationId))
      .limit(1);

    res.json({
      organizationId: user.organizationId,
      organizationName: org?.name || "Unknown",
      planTier: entitlements.planTier,
      planInfo: PLAN_INFO[entitlements.planTier],
      status: entitlements.status,
      activeAddons: entitlements.activeAddons,
      addonDetails: entitlements.activeAddons.map(k => ({
        key: k,
        ...ADDON_INFO[k]
      })),
      features: entitlements.features,
      usage: {
        ai_vision_docs: aiVisionUsage || { quantity: 0, periodStart: null, periodEnd: null }
      },
      isDevMode: isDevMode(),
    });
  } catch (error) {
    logError("Failed to get entitlements", undefined, error as Error);
    res.status(500).json({ error: "Failed to retrieve entitlements" });
  }
});

/**
 * GET /api/billing/plans
 * Get available plans and add-ons
 */
router.get("/plans", async (req: AuthRequest, res: Response) => {
  res.json({
    plans: Object.entries(PLAN_INFO).map(([tier, info]) => ({
      tier,
      ...info,
      features: getAvailableFeatures(tier as PlanTier, []),
    })),
    addons: Object.entries(ADDON_INFO).map(([key, info]) => ({
      key,
      ...info,
      grantsFeature: ADDON_FEATURES[key as AddOnKey],
    })),
  });
});

/**
 * GET /api/billing/subscription
 * Get detailed subscription info (admin only)
 */
router.get("/subscription", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    if (!user.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }

    const [subscription] = await db
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, user.organizationId))
      .limit(1);

    const addons = await db
      .select()
      .from(organizationAddOns)
      .where(eq(organizationAddOns.organizationId, user.organizationId));

    res.json({
      subscription: subscription || null,
      addons,
      isDevMode: isDevMode(),
    });
  } catch (error) {
    logError("Failed to get subscription", undefined, error as Error);
    res.status(500).json({ error: "Failed to retrieve subscription" });
  }
});

/**
 * POST /api/billing/subscription
 * Create or update subscription (admin only, manual billing mode)
 */
router.post("/subscription", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    if (!user.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }

    // Only allow in dev/manual mode
    if (!isDevMode()) {
      return res.status(403).json({ 
        error: "Manual subscription management disabled",
        message: "Use Stripe checkout in production mode"
      });
    }

    const { planTier } = req.body;

    if (!planTier || !["free", "starter", "professional", "enterprise"].includes(planTier)) {
      return res.status(400).json({ error: "Invalid plan tier" });
    }

    // Check if subscription exists
    const [existing] = await db
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, user.organizationId))
      .limit(1);

    let subscription;
    if (existing) {
      // Update existing
      [subscription] = await db
        .update(organizationSubscriptions)
        .set({ 
          planTier,
          updatedAt: new Date()
        })
        .where(eq(organizationSubscriptions.id, existing.id))
        .returning();
    } else {
      // Create new
      [subscription] = await db
        .insert(organizationSubscriptions)
        .values({
          organizationId: user.organizationId,
          planTier,
          status: "active",
          billingProvider: "manual",
        })
        .returning();
    }

    logInfo("Subscription updated", { 
      organizationId: user.organizationId, 
      planTier,
      userId: user.id 
    });

    res.json(subscription);
  } catch (error) {
    logError("Failed to update subscription", undefined, error as Error);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

/**
 * POST /api/billing/addons/:addonKey/toggle
 * Enable or disable an add-on (admin only, manual billing mode)
 */
router.post("/addons/:addonKey/toggle", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { addonKey } = req.params;
    const { enabled } = req.body;
    
    if (!user.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }

    // Only allow in dev/manual mode
    if (!isDevMode()) {
      return res.status(403).json({ 
        error: "Manual add-on management disabled",
        message: "Use Stripe checkout in production mode"
      });
    }

    // Validate addon key
    if (!ADDON_INFO[addonKey as AddOnKey]) {
      return res.status(400).json({ error: "Invalid add-on key" });
    }

    // Check if addon record exists
    const [existing] = await db
      .select()
      .from(organizationAddOns)
      .where(
        and(
          eq(organizationAddOns.organizationId, user.organizationId),
          eq(organizationAddOns.addonKey, addonKey as any)
        )
      )
      .limit(1);

    let addon;
    const newStatus = enabled ? "active" : "inactive";

    if (existing) {
      // Update existing
      [addon] = await db
        .update(organizationAddOns)
        .set({ 
          status: newStatus,
          updatedAt: new Date()
        })
        .where(eq(organizationAddOns.id, existing.id))
        .returning();
    } else {
      // Create new
      [addon] = await db
        .insert(organizationAddOns)
        .values({
          organizationId: user.organizationId,
          addonKey: addonKey as any,
          status: newStatus,
        })
        .returning();
    }

    logInfo("Add-on toggled", { 
      organizationId: user.organizationId, 
      addonKey,
      enabled,
      userId: user.id 
    });

    res.json(addon);
  } catch (error) {
    logError("Failed to toggle add-on", undefined, error as Error);
    res.status(500).json({ error: "Failed to toggle add-on" });
  }
});

/**
 * POST /api/billing/backfill
 * Backfill subscriptions for existing orgs (admin/dev only)
 */
router.post("/backfill", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    // Only SUPER_ADMIN or dev mode
    if (user.role !== "SUPER_ADMIN" && !isDevMode()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    // Get all orgs without subscriptions
    const orgsWithoutSubs = await db.execute(sql`
      SELECT o.id, o.name 
      FROM organizations o 
      LEFT JOIN organization_subscriptions os ON o.id = os.organization_id
      WHERE os.id IS NULL
    `);

    const backfilled: string[] = [];
    
    for (const org of orgsWithoutSubs.rows as { id: string; name: string }[]) {
      await db.insert(organizationSubscriptions).values({
        organizationId: org.id,
        planTier: "free",
        status: "active",
        billingProvider: "manual",
      });
      backfilled.push(org.id);
    }

    logInfo("Subscriptions backfilled", { count: backfilled.length });

    res.json({ 
      success: true, 
      backfilledCount: backfilled.length,
      backfilledOrgs: backfilled 
    });
  } catch (error) {
    logError("Failed to backfill subscriptions", undefined, error as Error);
    res.status(500).json({ error: "Failed to backfill" });
  }
});

/**
 * GET /api/billing/usage
 * Get current usage metrics
 */
router.get("/usage", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    if (!user.organizationId) {
      return res.status(400).json({ error: "No organization" });
    }

    const aiVisionUsage = await getUsage(user.organizationId, "ai_vision_docs");

    res.json({
      ai_vision_docs: aiVisionUsage || { quantity: 0, periodStart: null, periodEnd: null },
      limits: {
        ai_vision_docs: isDevMode() ? 50 : 100, // Dev mode has lower limit for testing
      }
    });
  } catch (error) {
    logError("Failed to get usage", undefined, error as Error);
    res.status(500).json({ error: "Failed to retrieve usage" });
  }
});

export default router;
