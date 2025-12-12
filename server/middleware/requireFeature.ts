/**
 * Feature Gating Middleware
 * Enforces feature access at the route level
 */

import { Response, NextFunction } from "express";
import { AuthRequest } from "../auth";
import { hasFeature, getOrgEntitlements, isDevMode } from "../services/featureAccess";
import { FeatureKey, FEATURE_INFO } from "@shared/billing/plans";
import { logWarn } from "../utils/logger";

/**
 * Middleware factory to require a specific feature
 * Returns 403 if organization doesn't have access to the feature
 */
export function requireFeature(featureKey: FeatureKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    // Must be authenticated
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // SUPER_ADMIN bypasses feature checks for platform management
    // But they should not access org-specific features without an org context
    if (user.role === "SUPER_ADMIN") {
      return next();
    }

    // User must have an organization
    if (!user.organizationId) {
      return res.status(403).json({ 
        error: "Organization required",
        message: "You must belong to an organization to access this feature"
      });
    }

    // Check feature access
    const hasAccess = await hasFeature(user.organizationId, featureKey, req);

    if (hasAccess) {
      return next();
    }

    // Feature not available
    const featureInfo = FEATURE_INFO[featureKey];
    logWarn("Feature access denied", { 
      userId: user.id, 
      organizationId: user.organizationId, 
      featureKey 
    });

    return res.status(403).json({
      error: "Feature not available",
      featureKey,
      featureName: featureInfo?.name || featureKey,
      message: `Your organization's plan does not include ${featureInfo?.name || featureKey}. Please upgrade your plan or add this feature.`,
      upgradeRequired: true,
    });
  };
}

/**
 * Middleware factory to require one of multiple features
 * User must have at least one of the specified features
 */
export function requireAnyFeature(...featureKeys: FeatureKey[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (user.role === "SUPER_ADMIN") {
      return next();
    }

    if (!user.organizationId) {
      return res.status(403).json({ 
        error: "Organization required",
        message: "You must belong to an organization to access this feature"
      });
    }

    // Check if user has any of the required features
    for (const featureKey of featureKeys) {
      const hasAccess = await hasFeature(user.organizationId, featureKey, req);
      if (hasAccess) {
        return next();
      }
    }

    // None of the features available
    const featureNames = featureKeys.map(k => FEATURE_INFO[k]?.name || k).join(", ");
    logWarn("Feature access denied (all)", { 
      userId: user.id, 
      organizationId: user.organizationId, 
      featureKeys 
    });

    return res.status(403).json({
      error: "Feature not available",
      requiredFeatures: featureKeys,
      message: `Your organization's plan does not include any of: ${featureNames}. Please upgrade your plan.`,
      upgradeRequired: true,
    });
  };
}

/**
 * Middleware that checks feature but doesn't block - just adds info to request
 * Useful for conditional rendering or degraded functionality
 */
export function checkFeatureAvailability(featureKey: FeatureKey) {
  return async (req: AuthRequest & { featureAccess?: Record<string, boolean> }, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!req.featureAccess) {
      req.featureAccess = {};
    }

    if (!user || !user.organizationId) {
      req.featureAccess[featureKey] = false;
      return next();
    }

    if (user.role === "SUPER_ADMIN") {
      req.featureAccess[featureKey] = true;
      return next();
    }

    req.featureAccess[featureKey] = await hasFeature(user.organizationId, featureKey, req);
    return next();
  };
}

/**
 * Get all available features for the current user's organization
 * Useful for frontend to know what to enable/disable
 */
export async function getAvailableFeaturesForUser(req: AuthRequest): Promise<FeatureKey[]> {
  const user = req.user;

  if (!user || !user.organizationId) {
    return [];
  }

  const entitlements = await getOrgEntitlements(user.organizationId, req);
  return entitlements?.features || [];
}
