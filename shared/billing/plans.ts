/**
 * Subscription Plans & Feature Gating Configuration
 * Single source of truth for plan tiers, add-ons, and feature access
 */

// Plan tier definitions matching the spec: FREE, STARTER, PROFESSIONAL, ENTERPRISE
export type PlanTier = "free" | "starter" | "professional" | "enterprise";

// Add-on keys matching the database enum
export type AddOnKey = "ai_pm" | "ai_cfo" | "ai_email" | "website_seo" | "bid_network" | "ai_vision";

// Feature keys for gating
export type FeatureKey = 
  | "AI_PM"
  | "AI_CFO" 
  | "AI_EMAIL"
  | "WEBSITE_SEO"
  | "BID_NETWORK"
  | "AI_VISION"
  | "PRODUCTION_RATES"
  | "MATERIAL_BUDGET"
  | "MULTI_ORG";

// Plan default features - what each plan tier includes by default
export const PLAN_DEFAULT_FEATURES: Record<PlanTier, FeatureKey[]> = {
  free: [
    // Basic features only - very limited, encourages upgrade
  ],
  starter: [
    // Core business features
    "PRODUCTION_RATES",
  ],
  professional: [
    // Starter features + advanced analytics and budget tracking
    "PRODUCTION_RATES",
    "MATERIAL_BUDGET",
    "WEBSITE_SEO",
  ],
  enterprise: [
    // Professional features + all premium features
    "PRODUCTION_RATES",
    "MATERIAL_BUDGET",
    "WEBSITE_SEO",
    "BID_NETWORK",
    "AI_CFO",
    "MULTI_ORG",
  ],
};

// Add-on to feature mapping - which feature each add-on grants
export const ADDON_FEATURES: Record<AddOnKey, FeatureKey> = {
  ai_pm: "AI_PM",
  ai_cfo: "AI_CFO",
  ai_email: "AI_EMAIL",
  website_seo: "WEBSITE_SEO",
  bid_network: "BID_NETWORK",
  ai_vision: "AI_VISION",
};

// Plan display information for UI
export const PLAN_INFO: Record<PlanTier, { name: string; description: string; price: number }> = {
  free: {
    name: "Free",
    description: "Get started with essential construction management tools",
    price: 0,
  },
  starter: {
    name: "Starter",
    description: "Core features for small teams with production tracking",
    price: 49,
  },
  professional: {
    name: "Professional",
    description: "Advanced analytics, budget tracking, and website builder",
    price: 99,
  },
  enterprise: {
    name: "Enterprise",
    description: "Full platform with bid network and multi-organization support",
    price: 249,
  },
};

// Add-on pricing and display info
export const ADDON_INFO: Record<AddOnKey, { name: string; description: string; price: number }> = {
  ai_pm: {
    name: "AI Project Manager",
    description: "Automated project scheduling and task generation",
    price: 49,
  },
  ai_cfo: {
    name: "AI CFO",
    description: "Financial insights and profitability analysis",
    price: 79,
  },
  ai_email: {
    name: "AI Email Assistant",
    description: "Email classification and task extraction",
    price: 39,
  },
  website_seo: {
    name: "Website Builder + SEO",
    description: "White-label website with SEO optimization",
    price: 59,
  },
  bid_network: {
    name: "Bid Network",
    description: "Platform-wide subcontractor bid solicitation",
    price: 69,
  },
  ai_vision: {
    name: "AI Vision Takeoff",
    description: "AI-powered plan takeoff and material estimation",
    price: 99,
  },
};

// Feature metadata for UI display
export const FEATURE_INFO: Record<FeatureKey, { name: string; description: string }> = {
  AI_PM: {
    name: "AI Project Manager",
    description: "Automated scheduling and task management",
  },
  AI_CFO: {
    name: "AI CFO",
    description: "Financial analysis and profitability insights",
  },
  AI_EMAIL: {
    name: "AI Email",
    description: "Smart email classification and task extraction",
  },
  WEBSITE_SEO: {
    name: "Website Builder",
    description: "White-label website with SEO tools",
  },
  BID_NETWORK: {
    name: "Bid Network",
    description: "Subcontractor bid solicitation network",
  },
  AI_VISION: {
    name: "AI Vision Takeoff",
    description: "AI-powered plan analysis and takeoff",
  },
  PRODUCTION_RATES: {
    name: "Production Rate Tracking",
    description: "Crew productivity and cost analytics",
  },
  MATERIAL_BUDGET: {
    name: "Material Budget Tracking",
    description: "Budget variance alerts and tracking",
  },
  MULTI_ORG: {
    name: "Multi-Organization",
    description: "Portfolio management across multiple organizations",
  },
};

// Usage limits by plan tier
export const PLAN_LIMITS: Record<PlanTier, {
  projects: number;
  users: number;
  storageGb: number;
  aiVisionDocs: number;
}> = {
  free: {
    projects: 3,
    users: 2,
    storageGb: 1,
    aiVisionDocs: 5,
  },
  starter: {
    projects: 10,
    users: 5,
    storageGb: 10,
    aiVisionDocs: 25,
  },
  professional: {
    projects: 50,
    users: 25,
    storageGb: 50,
    aiVisionDocs: 100,
  },
  enterprise: {
    projects: -1, // Unlimited
    users: -1, // Unlimited
    storageGb: 500,
    aiVisionDocs: 500,
  },
};

/**
 * Check if a feature is available for a given plan tier and add-ons
 */
export function hasFeatureAccess(
  planTier: PlanTier,
  activeAddons: AddOnKey[],
  featureKey: FeatureKey
): boolean {
  // Check if plan includes the feature by default
  const planFeatures = PLAN_DEFAULT_FEATURES[planTier] || [];
  if (planFeatures.includes(featureKey)) {
    return true;
  }

  // Check if any active add-on grants the feature
  for (const addon of activeAddons) {
    if (ADDON_FEATURES[addon] === featureKey) {
      return true;
    }
  }

  return false;
}

/**
 * Get all features available for a plan tier and add-ons
 */
export function getAvailableFeatures(
  planTier: PlanTier,
  activeAddons: AddOnKey[]
): FeatureKey[] {
  const features = new Set<FeatureKey>();

  // Add plan default features
  const planFeatures = PLAN_DEFAULT_FEATURES[planTier] || [];
  planFeatures.forEach(f => features.add(f));

  // Add features from active add-ons
  for (const addon of activeAddons) {
    const feature = ADDON_FEATURES[addon];
    if (feature) {
      features.add(feature);
    }
  }

  return Array.from(features);
}

/**
 * Get add-ons that would unlock a specific feature
 */
export function getAddonsForFeature(featureKey: FeatureKey): AddOnKey[] {
  return Object.entries(ADDON_FEATURES)
    .filter(([, feature]) => feature === featureKey)
    .map(([addon]) => addon as AddOnKey);
}

/**
 * Get the minimum plan tier that includes a feature by default
 */
export function getMinimumPlanForFeature(featureKey: FeatureKey): PlanTier | null {
  const tiers: PlanTier[] = ["free", "starter", "professional", "enterprise"];
  
  for (const tier of tiers) {
    if (PLAN_DEFAULT_FEATURES[tier].includes(featureKey)) {
      return tier;
    }
  }
  
  return null;
}

/**
 * Get plan limits for a given tier
 */
export function getPlanLimits(planTier: PlanTier) {
  return PLAN_LIMITS[planTier] || PLAN_LIMITS.free;
}
