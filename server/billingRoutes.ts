/**
 * Billing Routes
 * Manage organization subscriptions, add-ons, and entitlements
 */

import { Router, Response, NextFunction } from "express";
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
import { z } from "zod";
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
// Task #2482: Stripe-backed billing.
import {
  STRIPE_PRICE_ENV_VARS,
  STRIPE_ADDON_PRICE_ENV_VARS,
  PLAN_LIMITS,
} from "@shared/billing/plans";
import {
  createCheckoutSession,
  createPortalSession,
  ensureStripeCustomer,
  isStripeConfigured,
} from "./services/billing/stripeService";
import { getSeatStatus } from "./services/billing/seatEnforcement";
import { getAllUsage } from "./services/billing/usageMetering";
import { runDunningCycle } from "./services/billing/dunning";

const router = Router();

/**
 * GET /api/billing/entitlements
 * Get current organization's entitlements, plan, and add-ons
 */
router.get("/entitlements", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

/**
 * GET /api/billing/plans
 * Get available plans and add-ons
 */
router.get("/plans", async (req: AuthRequest, res: Response, next: NextFunction) => {
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
router.get("/subscription", requireAuth, requireRole("ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

/**
 * POST /api/billing/subscription
 * Create or update subscription (admin only, manual billing mode)
 */
router.post("/subscription", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

/**
 * POST /api/billing/addons/:addonKey/toggle
 * Enable or disable an add-on (admin only, manual billing mode)
 */
router.post("/addons/:addonKey/toggle", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
          eq(organizationAddOns.addonKey, addonKey as AddOnKey)
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
          addonKey: addonKey as AddOnKey,
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
    next(error);
  }
});

/**
 * POST /api/billing/backfill
 * Backfill subscriptions for existing orgs (admin/dev only)
 */
router.post("/backfill", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

/**
 * GET /api/billing/usage
 * Get current usage metrics
 */
router.get("/usage", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

/**
 * POST /api/billing/toggle-mode
 * Toggle between Dev Mode and Production Mode (super admin / admin only)
 */
router.post("/toggle-mode", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !["dev", "production"].includes(mode)) {
      return res.status(400).json({ error: "Mode must be 'dev' or 'production'" });
    }

    if (mode === "dev") {
      process.env.BILLING_MODE = "manual";
    } else {
      delete process.env.BILLING_MODE;
    }

    logInfo("Billing mode toggled", { mode, by: req.user?.email });

    res.json({ 
      success: true, 
      mode,
      isDevMode: isDevMode(),
    });
  } catch (error) {
    next(error);
  }
});

// ===========================================================================
// Task #2482 — Stripe checkout, customer portal, seats, dunning, migration.
// ===========================================================================

const checkoutBodySchema = z.object({
  planTier: z.enum(["starter", "professional", "enterprise"]),
  seats: z.number().int().min(1).max(1000).default(1),
  addOns: z.array(z.string()).optional(),
  successPath: z.string().optional(),
  cancelPath: z.string().optional(),
});

function appBaseUrl(req: AuthRequest): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || (req.secure ? "https" : "http");
  return `${proto}://${req.headers.host}`;
}

/**
 * POST /api/billing/checkout — start a Stripe Checkout session for the
 * caller's organization. Returns the URL to redirect to.
 */
router.post("/checkout", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: "Stripe is not configured on this deployment" });
    }
    const user = req.user!;
    if (!user.organizationId) {
      return res.status(400).json({ error: "No organization associated with user" });
    }
    const parsed = checkoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }
    const { planTier, seats, addOns, successPath, cancelPath } = parsed.data;

    const priceEnv = STRIPE_PRICE_ENV_VARS[planTier as keyof typeof STRIPE_PRICE_ENV_VARS];
    const priceId = priceEnv ? process.env[priceEnv] : undefined;
    if (!priceId) {
      return res.status(409).json({ error: `No Stripe price configured for plan "${planTier}". Set ${priceEnv}.` });
    }

    const addOnPriceIds: string[] = [];
    for (const key of addOns ?? []) {
      const env = (STRIPE_ADDON_PRICE_ENV_VARS as Record<string, string>)[key];
      const id = env ? process.env[env] : undefined;
      if (!id) {
        return res.status(409).json({ error: `No Stripe price configured for add-on "${key}". Set ${env}.` });
      }
      addOnPriceIds.push(id);
    }

    const [org] = await db
      .select({ id: organizations.id, name: organizations.name, email: organizations.email })
      .from(organizations)
      .where(eq(organizations.id, user.organizationId))
      .limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const [sub] = await db
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, user.organizationId))
      .limit(1);

    const customerEmail = org.email || user.email;
    const customerId = await ensureStripeCustomer(org.id, org.name, customerEmail, sub?.stripeCustomerId);

    // Persist the customer id eagerly so the webhook can correlate.
    if (sub) {
      if (sub.stripeCustomerId !== customerId) {
        await db
          .update(organizationSubscriptions)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(organizationSubscriptions.id, sub.id));
      }
    } else {
      await db.insert(organizationSubscriptions).values({
        organizationId: org.id,
        planTier: "free",
        status: "active",
        billingProvider: "stripe",
        stripeCustomerId: customerId,
      });
    }

    const base = appBaseUrl(req);
    const session = await createCheckoutSession({
      organizationId: org.id,
      organizationName: org.name,
      customerEmail,
      priceId,
      addOnPriceIds,
      seats,
      successUrl: `${base}${successPath ?? "/billing?checkout=success"}`,
      cancelUrl: `${base}${cancelPath ?? "/billing?checkout=cancel"}`,
      existingCustomerId: customerId,
    });

    res.json(session);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/billing/portal — open the Stripe Customer Portal for the
 * caller's org. Used to update payment method, view invoices, cancel.
 */
router.post("/portal", requireAuth, requireRole("ADMIN"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: "Stripe is not configured on this deployment" });
    }
    const user = req.user!;
    if (!user.organizationId) return res.status(400).json({ error: "No organization associated with user" });

    const [sub] = await db
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, user.organizationId))
      .limit(1);

    if (!sub?.stripeCustomerId) {
      return res.status(409).json({ error: "No Stripe customer on file. Run checkout first." });
    }

    const base = appBaseUrl(req);
    const returnUrl = `${base}${(req.body?.returnPath as string) ?? "/billing"}`;
    const portal = await createPortalSession(sub.stripeCustomerId, returnUrl);
    res.json(portal);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/billing/seats — current seat usage and limit.
 */
router.get("/seats", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!user.organizationId) return res.status(400).json({ error: "No organization" });
    const status = await getSeatStatus(user.organizationId);
    res.json({
      ...status,
      remaining: status.remaining === Infinity ? null : status.remaining,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/billing/usage/all — aggregated usage for the dashboard
 * (AI tokens, AI jobs, AI vision docs, storage bytes).
 */
router.get("/usage/all", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    if (!user.organizationId) return res.status(400).json({ error: "No organization" });
    const usage = await getAllUsage(user.organizationId);
    res.json(usage);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/billing/migrate-to-stripe — admin/super-admin tool to flip a
 * manual-billed org over to Stripe. Validates the target plan has a
 * configured Stripe price, creates (or reuses) the Stripe customer, and
 * marks the org for Stripe billing. The actual subscription is created
 * by the next checkout flow (or by linking an existing Stripe sub via
 * `stripeSubscriptionId`).
 *
 * See docs/billing/manual-to-stripe-playbook.md for the full runbook.
 */
const migrateBodySchema = z.object({
  organizationId: z.string().min(1),
  stripeSubscriptionId: z.string().optional(),
});

router.post("/migrate-to-stripe", requireAuth, requireRole("SUPER_ADMIN"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    if (!isStripeConfigured()) {
      return res.status(503).json({ error: "Stripe is not configured on this deployment" });
    }
    const parsed = migrateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }
    const { organizationId, stripeSubscriptionId } = parsed.data;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const [sub] = await db
      .select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .limit(1);

    const customerId = await ensureStripeCustomer(
      org.id,
      org.name,
      org.email ?? req.user!.email,
      sub?.stripeCustomerId,
    );

    if (sub) {
      await db
        .update(organizationSubscriptions)
        .set({
          billingProvider: "stripe",
          stripeCustomerId: customerId,
          stripeSubscriptionId: stripeSubscriptionId ?? sub.stripeSubscriptionId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(organizationSubscriptions.id, sub.id));
    } else {
      await db.insert(organizationSubscriptions).values({
        organizationId,
        planTier: "free",
        status: "active",
        billingProvider: "stripe",
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSubscriptionId ?? null,
      });
    }

    logInfo("Migrated organization to Stripe billing", {
      organizationId,
      customerId,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      by: req.user?.email,
    });

    res.json({
      organizationId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscriptionId ?? null,
      next: "Direct the org admin to /api/billing/checkout to complete subscription, or link the existing Stripe subscription via stripeSubscriptionId.",
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/billing/dunning/run — manual trigger for the dunning cycle
 * (sends due reminder emails and suspends orgs past the grace window).
 * Intended to be called by a cron job; super-admin can also invoke
 * manually for incident response.
 */
router.post("/dunning/run", requireAuth, requireRole("SUPER_ADMIN"), sensitiveLimiter, async (req: AuthRequest, res, next) => {
  try {
    const result = await runDunningCycle();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// Keep the unused-import linter happy.
void PLAN_LIMITS;

export default router;
