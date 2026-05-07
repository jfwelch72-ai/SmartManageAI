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
export type AddOnKey = "ai_pm" | "ai_cfo" | "ai_email" | "website_seo" | "bid_network" | "ai_vision" | "integration_qbo" | "integration_esign" | "ai_governance_pack";

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
  | "PRIORITY_SUPPORT"
  | "INTEGRATIONS_HUB"
  | "INTEGRATION_QBO"
  | "INTEGRATION_GOOGLE"
  | "INTEGRATION_MICROSOFT"
  | "INTEGRATION_ESIGN"
  | "AI_GOVERNANCE"
  | "APPROVALS_FRAMEWORK"
  | "DOCUMENT_CONTROL"
  | "EXECUTIVE_DIGEST"
  | "PROJECT_HEALTH_SCORE"
  | "MOBILE_OFFLINE_V2"
  | "SSO"
  | "AUDIT_EXPORT"
  | "DATA_RETENTION"
  | "PRIVACY_COMPLIANCE"
  | "SESSION_MANAGEMENT"
  | "MODIFIER_AI_SUGGEST"
  | "CONTRACTS"
  | "HIRING_ATS"
  | "SAFETY_TRAINING"
  | "SUBCONTRACT_MGMT"
  | "T_AND_M"
  | "LEAVE_MANAGEMENT"
  | "CPM_SCHEDULING"
  | "BIM_VIEWER"
  | "WORKFLOW_BUILDER"
  | "DASHBOARD_CUSTOMIZATION"
  | "PUNCH_LIST"
  | "WARRANTY_MODULE"
  | "RISK_MANAGEMENT"
  | "ASSET_MANAGEMENT"
  | "ENTERPRISE_NOTIFICATIONS"
  | "LIDAR_SCANNER";

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
    "APPROVALS_FRAMEWORK",
    "DOCUMENT_CONTROL",
    "PROJECT_HEALTH_SCORE",
    "MODIFIER_AI_SUGGEST",
    "CONTRACTS",
    "HIRING_ATS",
    "SAFETY_TRAINING",
    "SUBCONTRACT_MGMT",
    "T_AND_M",
    "LEAVE_MANAGEMENT",
    "PUNCH_LIST",
    "WARRANTY_MODULE",
    "DASHBOARD_CUSTOMIZATION",
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
    "MULTI_ORG",
    "INTEGRATIONS_HUB",
    "APPROVALS_FRAMEWORK",
    "DOCUMENT_CONTROL",
    "EXECUTIVE_DIGEST",
    "PROJECT_HEALTH_SCORE",
    "AI_GOVERNANCE",
    "MOBILE_OFFLINE_V2",
    "SSO",
    "AUDIT_EXPORT",
    "DATA_RETENTION",
    "PRIVACY_COMPLIANCE",
    "SESSION_MANAGEMENT",
    "MODIFIER_AI_SUGGEST",
    "CONTRACTS",
    "HIRING_ATS",
    "SAFETY_TRAINING",
    "SUBCONTRACT_MGMT",
    "T_AND_M",
    "LEAVE_MANAGEMENT",
    "PUNCH_LIST",
    "WARRANTY_MODULE",
    "DASHBOARD_CUSTOMIZATION",
    "CPM_SCHEDULING",
    "BIM_VIEWER",
    "LIDAR_SCANNER",
    "WORKFLOW_BUILDER",
    "RISK_MANAGEMENT",
    "ASSET_MANAGEMENT",
    "ENTERPRISE_NOTIFICATIONS",
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
  integration_qbo: "INTEGRATION_QBO",
  integration_esign: "INTEGRATION_ESIGN",
  ai_governance_pack: "AI_GOVERNANCE",
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
  integration_qbo: {
    name: "QBO Integration",
    description: "QuickBooks Online sync for accounting",
    price: 49,
    category: "growth",
  },
  integration_esign: {
    name: "E-Sign Integration",
    description: "DocuSign/Dropbox Sign integration",
    price: 29,
    category: "growth",
  },
  ai_governance_pack: {
    name: "AI Governance Pack",
    description: "AI cost tracking, limits, and audit dashboard",
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
  INTEGRATIONS_HUB: {
    name: "Integrations Hub",
    description: "Central hub for third-party integrations",
  },
  INTEGRATION_QBO: {
    name: "QuickBooks Online",
    description: "QuickBooks Online accounting sync",
  },
  INTEGRATION_GOOGLE: {
    name: "Google Workspace",
    description: "Google Calendar, Drive, and Gmail integration",
  },
  INTEGRATION_MICROSOFT: {
    name: "Microsoft 365",
    description: "Outlook, Teams, and OneDrive integration",
  },
  INTEGRATION_ESIGN: {
    name: "E-Signatures",
    description: "DocuSign and Dropbox Sign integration",
  },
  AI_GOVERNANCE: {
    name: "AI Governance",
    description: "AI cost tracking, usage limits, and audit dashboard",
  },
  APPROVALS_FRAMEWORK: {
    name: "Approvals Framework",
    description: "Multi-step approval workflows for key actions",
  },
  DOCUMENT_CONTROL: {
    name: "Document Control",
    description: "Version control and revision management for documents",
  },
  EXECUTIVE_DIGEST: {
    name: "Executive Digest",
    description: "Weekly executive summary reports and insights",
  },
  PROJECT_HEALTH_SCORE: {
    name: "Project Health Score",
    description: "Automated project health scoring and alerts",
  },
  MOBILE_OFFLINE_V2: {
    name: "Mobile Offline V2",
    description: "Enhanced offline mode with background sync",
  },
  SSO: {
    name: "Single Sign-On",
    description: "SAML 2.0 SSO integration with enterprise identity providers",
  },
  AUDIT_EXPORT: {
    name: "Audit Log Export",
    description: "Searchable audit logs with CSV and JSON export",
  },
  DATA_RETENTION: {
    name: "Data Retention Policies",
    description: "Automated data lifecycle management with configurable retention",
  },
  PRIVACY_COMPLIANCE: {
    name: "Privacy & Compliance",
    description: "GDPR/DPA tooling with data subject request management",
  },
  SESSION_MANAGEMENT: {
    name: "Session Management",
    description: "Active session tracking, idle timeout, and concurrent session limits",
  },
  MODIFIER_AI_SUGGEST: {
    name: "AI Modifier Suggestions",
    description: "AI-powered scope modifier recommendations for estimating",
  },
  CONTRACTS: {
    name: "Contracts Management",
    description: "Contract creation, versioning, redlines, and approval workflows",
  },
  HIRING_ATS: {
    name: "Hiring & ATS",
    description: "Applicant tracking, job postings, candidate pipeline management",
  },
  SAFETY_TRAINING: {
    name: "Safety Training",
    description: "Safety program management and training assignment tracking",
  },
  SUBCONTRACT_MGMT: {
    name: "Subcontract Management",
    description: "Subcontractor contracts, payments, and billing schedules",
  },
  T_AND_M: {
    name: "Time & Material Billing",
    description: "T&M ticket management, approvals, and invoicing",
  },
  LEAVE_MANAGEMENT: {
    name: "Leave Management",
    description: "Employee leave requests, approvals, and balance tracking",
  },
  CPM_SCHEDULING: {
    name: "CPM Scheduling",
    description: "Critical path method scheduling and Gantt charts",
  },
  BIM_VIEWER: {
    name: "BIM Viewer",
    description: "3D building information model viewing and collaboration",
  },
  WORKFLOW_BUILDER: {
    name: "Workflow Builder",
    description: "Custom automated workflow creation and management",
  },
  DASHBOARD_CUSTOMIZATION: {
    name: "Dashboard Customization",
    description: "Custom dashboard layouts, widgets, and role-based views",
  },
  PUNCH_LIST: {
    name: "Punch List",
    description: "Project closeout punch list tracking and management",
  },
  WARRANTY_MODULE: {
    name: "Warranty Module",
    description: "Post-construction warranty tracking and claims management",
  },
  RISK_MANAGEMENT: {
    name: "Risk Management",
    description: "Project risk identification, assessment, and mitigation tracking",
  },
  ASSET_MANAGEMENT: {
    name: "Asset Management",
    description: "Company asset tracking, depreciation, and lifecycle management",
  },
  ENTERPRISE_NOTIFICATIONS: {
    name: "Enterprise Notifications",
    description: "SMS, Microsoft Teams, and Slack notification channels",
  },
  LIDAR_SCANNER: {
    name: "LiDAR Scanner",
    description: "3D point cloud scanning, measurement, and comparison tools",
  },
};

// Usage limits by plan tier — single source of truth for entitlement
// gating across the platform. -1 = unlimited.
//
// Task #2482: added `aiTokens` (monthly token budget across all AI calls)
// and `aiJobs` (monthly count of distinct AI requests). Existing
// `aiVisionDocs` remains for the AI Vision document add-on which is
// metered independently. Per-org overrides live on
// `organization_subscriptions.{seat,ai_token,storage_gb}_quota_override`.
export const PLAN_LIMITS: Record<PlanTier, {
  projects: number;
  users: number;        // alias for "seats"
  storageGb: number;
  aiVisionDocs: number;
  aiTokens: number;
  aiJobs: number;
}> = {
  free: {
    projects: 2,
    users: 1,
    storageGb: 0.5,
    aiVisionDocs: 3,
    aiTokens: 50_000,
    aiJobs: 25,
  },
  starter: {
    projects: 10,
    users: 5,
    storageGb: 10,
    aiVisionDocs: 10,
    aiTokens: 500_000,
    aiJobs: 500,
  },
  professional: {
    projects: 50,
    users: 25,
    storageGb: 50,
    aiVisionDocs: 50,
    aiTokens: 5_000_000,
    aiJobs: 5_000,
  },
  enterprise: {
    projects: -1, // Unlimited
    users: -1, // Unlimited
    storageGb: 500,
    aiVisionDocs: 200,
    aiTokens: 50_000_000,
    aiJobs: 50_000,
  },
};

// Task #2482: dunning grace period in days. After payment fails, the org
// receives reminder emails on day 0/3/7 and is suspended on day 14 unless
// payment succeeds. Suspended orgs still have READ access to their data.
export const DUNNING_GRACE_PERIOD_DAYS = 14;

// Task #2482: env-var names that hold the Stripe price IDs for each
// plan and add-on. They're env-var names rather than hard-coded IDs so
// the same code runs against dev/staging/prod with different Stripe
// accounts. Looking up `process.env[STRIPE_PRICE_ENV_VARS.starter]`
// gives the active price ID; missing env = the plan can't be checked
// out via Stripe yet (manual mode only).
export const STRIPE_PRICE_ENV_VARS: Record<PlanTier, string> = {
  free: "STRIPE_PRICE_FREE",
  starter: "STRIPE_PRICE_STARTER",
  professional: "STRIPE_PRICE_GROWTH",
  enterprise: "STRIPE_PRICE_SCALE",
};

export const STRIPE_ADDON_PRICE_ENV_VARS: Record<AddOnKey, string> = {
  ai_pm: "STRIPE_PRICE_ADDON_AI_PM",
  ai_cfo: "STRIPE_PRICE_ADDON_AI_CFO",
  ai_email: "STRIPE_PRICE_ADDON_AI_EMAIL",
  website_seo: "STRIPE_PRICE_ADDON_WEBSITE_SEO",
  bid_network: "STRIPE_PRICE_ADDON_BID_NETWORK",
  ai_vision: "STRIPE_PRICE_ADDON_AI_VISION",
  integration_qbo: "STRIPE_PRICE_ADDON_INTEGRATION_QBO",
  integration_esign: "STRIPE_PRICE_ADDON_INTEGRATION_ESIGN",
  ai_governance_pack: "STRIPE_PRICE_ADDON_AI_GOVERNANCE",
};

// Task #2482: env-var name for the metered Stripe price that records
// AI vision document overage. When the org exceeds its quota and the
// plan allows overage billing, we emit a Stripe usage record against
// this price. Missing env = overage is hard-blocked instead of billed.
export const STRIPE_METERED_PRICE_ENV_VARS = {
  ai_vision_docs: "STRIPE_METERED_PRICE_AI_VISION_DOCS",
  ai_tokens: "STRIPE_METERED_PRICE_AI_TOKENS",
  ai_jobs: "STRIPE_METERED_PRICE_AI_JOBS",
  storage_bytes: "STRIPE_METERED_PRICE_STORAGE",
} as const;

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
