/**
 * Feature Access Service
 * Backend enforcement of feature gating based on organization subscription and add-ons
 */

import { db } from "../db";
import { organizationSubscriptions, organizationAddOns, organizationUsage } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { 
  PlanTier, 
  AddOnKey, 
  FeatureKey,
  hasFeatureAccess as checkFeatureAccess,
  getAvailableFeatures 
} from "@shared/billing/plans";
import { logInfo, logWarn } from "../utils/logger";

// Cache for current request only (per-request cache to prevent cross-tenant bugs)
const requestCache = new WeakMap<object, Map<string, OrgEntitlements>>();

export interface OrgEntitlements {
  organizationId: string;
  planTier: PlanTier;
  status: string;
  activeAddons: AddOnKey[];
  features: FeatureKey[];
}

/**
 * Get organization entitlements (plan tier and active add-ons)
 * Uses per-request caching to prevent redundant DB queries
 */
export async function getOrgEntitlements(
  organizationId: string,
  requestContext?: object
): Promise<OrgEntitlements | null> {
  // Check per-request cache if context provided
  if (requestContext) {
    let cache = requestCache.get(requestContext);
    if (cache?.has(organizationId)) {
      return cache.get(organizationId)!;
    }
  }

  // Fetch subscription
  const [subscription] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);

  if (!subscription) {
    // No subscription found - default to FREE plan for backward compatibility
    // This ensures existing orgs continue to work with minimal features
    logWarn("No subscription found for org, using default FREE plan", { organizationId });
    const defaultEntitlements: OrgEntitlements = {
      organizationId,
      planTier: "free",
      status: "active",
      activeAddons: [],
      features: getAvailableFeatures("free", []),
    };
    return defaultEntitlements;
  }

  // Fetch active add-ons
  const addons = await db
    .select()
    .from(organizationAddOns)
    .where(
      and(
        eq(organizationAddOns.organizationId, organizationId),
        eq(organizationAddOns.status, "active")
      )
    );

  const activeAddons = addons.map(a => a.addonKey) as AddOnKey[];
  const planTier = subscription.planTier as PlanTier;

  const entitlements: OrgEntitlements = {
    organizationId,
    planTier,
    status: subscription.status,
    activeAddons,
    features: getAvailableFeatures(planTier, activeAddons),
  };

  // Store in per-request cache
  if (requestContext) {
    let cache = requestCache.get(requestContext);
    if (!cache) {
      cache = new Map();
      requestCache.set(requestContext, cache);
    }
    cache.set(organizationId, entitlements);
  }

  return entitlements;
}

/**
 * Check if organization has access to a specific feature
 */
export async function hasFeature(
  organizationId: string,
  featureKey: FeatureKey,
  requestContext?: object
): Promise<boolean> {
  const entitlements = await getOrgEntitlements(organizationId, requestContext);
  
  if (!entitlements) {
    return false;
  }

  // Check subscription status - only active/trialing allowed
  if (entitlements.status !== "active" && entitlements.status !== "trialing") {
    return false;
  }

  return checkFeatureAccess(entitlements.planTier, entitlements.activeAddons, featureKey);
}

/**
 * Get current usage for a usage-based feature
 */
export async function getUsage(
  organizationId: string,
  usageKey: string
): Promise<{ quantity: number; periodStart: Date; periodEnd: Date } | null> {
  const now = new Date();
  
  const [usage] = await db
    .select()
    .from(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, organizationId),
        eq(organizationUsage.usageKey, usageKey as any),
        lte(organizationUsage.periodStart, now),
        gte(organizationUsage.periodEnd, now)
      )
    )
    .limit(1);

  if (!usage) {
    return null;
  }

  return {
    quantity: usage.quantity,
    periodStart: usage.periodStart,
    periodEnd: usage.periodEnd,
  };
}

/**
 * Increment usage for a usage-based feature
 */
export async function incrementUsage(
  organizationId: string,
  usageKey: string,
  amount: number = 1
): Promise<void> {
  const now = new Date();
  
  // Get current month period
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Try to update existing usage record
  const [existing] = await db
    .select()
    .from(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, organizationId),
        eq(organizationUsage.usageKey, usageKey as any),
        lte(organizationUsage.periodStart, now),
        gte(organizationUsage.periodEnd, now)
      )
    )
    .limit(1);

  if (existing) {
    // Update existing record
    await db
      .update(organizationUsage)
      .set({ quantity: existing.quantity + amount })
      .where(eq(organizationUsage.id, existing.id));
  } else {
    // Create new usage record for this period
    await db
      .insert(organizationUsage)
      .values({
        organizationId,
        usageKey: usageKey as any,
        periodStart,
        periodEnd,
        quantity: amount,
      });
  }

  logInfo("Usage incremented", { organizationId, usageKey, amount });
}

/**
 * Check if usage is within limits (for usage-based features)
 * Returns true if under limit, false if over
 */
export async function isWithinUsageLimit(
  organizationId: string,
  usageKey: string,
  limit: number
): Promise<boolean> {
  const usage = await getUsage(organizationId, usageKey);
  
  if (!usage) {
    return true; // No usage yet
  }

  return usage.quantity < limit;
}

// Dev mode override - allows testing without real subscriptions
export function isDevMode(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.BILLING_MODE === "manual";
}

/**
 * Check feature access with dev mode override
 * In dev mode, allows access for testing purposes
 */
export async function hasFeatureWithDevOverride(
  organizationId: string,
  featureKey: FeatureKey,
  requestContext?: object
): Promise<{ hasAccess: boolean; reason?: string }> {
  const hasAccess = await hasFeature(organizationId, featureKey, requestContext);
  
  if (hasAccess) {
    return { hasAccess: true };
  }

  // In dev mode, log but still deny to test gating properly
  // However, the billing page allows toggling features in dev mode
  if (isDevMode()) {
    return { 
      hasAccess: false, 
      reason: `Feature ${featureKey} not enabled. Use Billing page to enable in dev mode.` 
    };
  }

  return { 
    hasAccess: false, 
    reason: `Feature ${featureKey} requires plan upgrade or add-on.` 
  };
}
