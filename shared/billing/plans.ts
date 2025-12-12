/**
 * Subscription Plans & Feature Gating Configuration
 * Single source of truth for plan tiers, add-ons, and feature access
 * 
 * New Pricing Model (December 2025):
 * - Starter ($89): Under $500k revenue - core features
 * - Growth ($229): $500k-$2M revenue - production tracking, advanced reports
 * - Scale ($579): $2M-$10M revenue - portfolio dashboards, bid network, website
 * - Hustler ($1199): Multi-company owners - cross-org analytics, COO mode
 */

// Plan tier definitions - using database enum values
// Note: "free" maps to trial/demo, "starter" stays, "professional" → "growth", "enterprise" → "scale"
// The "hustler" tier uses "enterprise" in the database but is displayed as "Hustler"
export type PlanTier = "free" | "starter" | "professional" | "enterprise";

// Display tier names for UI (maps to database values)
export const PLAN_DISPLAY_NAMES: Record<PlanTier, string> = {
  free: "Trial",
  starter: "Starter",
  professional: "Growth",
  enterprise: "Scale",
};

// Special Hustler tier flag - stored as enterprise with a flag
export const HUSTLER_TIER = "enterprise" as PlanTier;

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
  | "MULTI_ORG"
  | "VENDOR_INVITES"
  | "ADVANCED_REPORTS"
  | "PORTFOLIO_DASHBOARDS"
  | "PRIORITY_SUPPORT";

// Plan default features - what each plan tier includes by default
export const PLAN_DEFAULT_FEATURES: Record<PlanTier, FeatureKey[]> = {
  free: [
    // Trial/demo mode - limited access for evaluation
  ],
  starter: [
    // Starter ($89): Core business features
    // Project management, Time clock + GPS, Core estimating, CRM, Documents & messaging
  ],
  professional: [
    // Growth ($229): Everything in Starter, plus:
    "PRODUCTION_RATES",
    "MATERIAL_BUDGET",
    "VENDOR_INVITES",
    "ADVANCED_REPORTS",
  ],
  enterprise: [
    // Scale ($579) or Hustler ($1199): Everything in Growth, plus:
    "PRODUCTION_RATES",
    "MATERIAL_BUDGET",
    "VENDOR_INVITES",
    "ADVANCED_REPORTS",
    "PORTFOLIO_DASHBOARDS",
    "BID_NETWORK",
    "WEBSITE_SEO",
    "PRIORITY_SUPPORT",
    "MULTI_ORG", // Full multi-org for Hustler
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

// Plan display information for UI - New pricing structure
export const PLAN_INFO: Record<PlanTier, { 
  name: string; 
  displayName: string;
  description: string; 
  price: number;
  revenueRange: string;
  bestFor: string;
  features: string[];
}> = {
  free: {
    name: "Trial",
    displayName: "Trial",
    description: "Explore the platform with limited access",
    price: 0,
    revenueRange: "Demo",
    bestFor: "Evaluating the platform",
    features: [
      "Limited project access",
      "Basic dashboard",
      "14-day evaluation period",
    ],
  },
  starter: {
    name: "Starter",
    displayName: "Starter",
    description: "Get started with essential construction management tools",
    price: 89,
    revenueRange: "Under $500k Revenue",
    bestFor: "Owner-operators and small crews",
    features: [
      "Project management",
      "Time clock + GPS",
      "Core estimating",
      "CRM",
      "Documents & messaging",
      "Standard dashboard",
      "Email support",
    ],
  },
  professional: {
    name: "Growth",
    displayName: "Growth",
    description: "Advanced features for growing contractors replacing multiple tools",
    price: 229,
    revenueRange: "$500k–$2M Revenue",
    bestFor: "Growing contractors replacing multiple tools",
    features: [
      "Everything in Starter",
      "Production rate tracking",
      "Budget vs actuals",
      "Vendor invites",
      "Advanced reports",
      "Chat support",
    ],
  },
  enterprise: {
    name: "Scale",
    displayName: "Scale",
    description: "Full platform for multi-project, multi-crew operations",
    price: 579,
    revenueRange: "$2M–$10M Revenue",
    bestFor: "Multi-project, multi-crew operations",
    features: [
      "Everything in Growth",
      "Portfolio dashboards",
      "Bid Network access",
      "Website builder (basic)",
      "Priority support",
      "Quarterly success review",
    ],
  },
};

// Hustler plan info (special tier for multi-company owners)
export const HUSTLER_PLAN_INFO = {
  name: "Hustler",
  displayName: "Hustler",
  description: "For business owners running multiple companies",
  price: 1199,
  revenueRange: "Multi-Company",
  bestFor: "Owners running multiple businesses",
  features: [
    "Multiple companies under one account",
    "Cross-org analytics",
    "COO / delegation mode",
    "White-glove onboarding",
    "Priority roadmap input",
  ],
};

// Add-on pricing and display info - Updated pricing
export const ADDON_INFO: Record<AddOnKey, { 
  name: string; 
  description: string; 
  price: number;
  category: "ai" | "growth";
}> = {
  ai_pm: {
    name: "AI PM Pack",
    description: "Task generation, risk alerts, daily summaries",
    price: 39,
    category: "ai",
  },
  ai_cfo: {
    name: "AI CFO Pack",
    description: "Margin tracking, cashflow forecasting, financial alerts",
    price: 59,
    category: "ai",
  },
  ai_email: {
    name: "AI Email & Admin Pack",
    description: "Email categorization, task extraction, follow-ups",
    price: 29,
    category: "ai",
  },
  website_seo: {
    name: "Website + SEO Pack",
    description: "Website builder, SEO optimization, blog & gallery",
    price: 39,
    category: "growth",
  },
  bid_network: {
    name: "Bid Network Pack",
    description: "Competitive vendor bidding, pricing pressure reduction",
    price: 49,
    category: "growth",
  },
  ai_vision: {
    name: "AI Vision Pack",
    description: "AI-powered plan takeoff and material estimation",
    price: 79,
    category: "ai",
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
  VENDOR_INVITES: {
    name: "Vendor Invites",
    description: "Invite vendors to submit pricing",
  },
  ADVANCED_REPORTS: {
    name: "Advanced Reports",
    description: "Detailed project and financial reporting",
  },
  PORTFOLIO_DASHBOARDS: {
    name: "Portfolio Dashboards",
    description: "Cross-project performance insights",
  },
  PRIORITY_SUPPORT: {
    name: "Priority Support",
    description: "Faster response times and dedicated support",
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
    projects: 2,
    users: 1,
    storageGb: 0.5,
    aiVisionDocs: 3,
  },
  starter: {
    projects: 10,
    users: 5,
    storageGb: 10,
    aiVisionDocs: 10,
  },
  professional: {
    projects: 50,
    users: 25,
    storageGb: 50,
    aiVisionDocs: 50,
  },
  enterprise: {
    projects: -1, // Unlimited
    users: -1, // Unlimited
    storageGb: 500,
    aiVisionDocs: 200,
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

/**
 * Get display name for a plan tier
 */
export function getPlanDisplayName(planTier: PlanTier): string {
  return PLAN_DISPLAY_NAMES[planTier] || planTier;
}

/**
 * Calculate monthly cost for a plan with selected add-ons
 */
export function calculateMonthlyCost(planTier: PlanTier, addons: AddOnKey[]): number {
  const planPrice = PLAN_INFO[planTier]?.price || 0;
  const addonTotal = addons.reduce((sum, addon) => {
    return sum + (ADDON_INFO[addon]?.price || 0);
  }, 0);
  return planPrice + addonTotal;
}

/**
 * Get recommended plan based on company size/revenue
 */
export function getRecommendedPlanByRevenue(annualRevenue: number): PlanTier {
  if (annualRevenue >= 2000000) {
    return "enterprise"; // Scale
  } else if (annualRevenue >= 500000) {
    return "professional"; // Growth
  } else {
    return "starter";
  }
}

/**
 * Get recommended plan based on crew size
 */
export function getRecommendedPlanByCrewSize(crewSize: number): PlanTier {
  if (crewSize >= 25) {
    return "enterprise"; // Scale
  } else if (crewSize >= 10) {
    return "professional"; // Growth
  } else {
    return "starter";
  }
}
