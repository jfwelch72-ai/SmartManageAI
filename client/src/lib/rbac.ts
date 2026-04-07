/**
 * Role-Based Access Control (RBAC) Utilities
 * 
 * 7 Org-Level Roles + 1 Platform-Level Role, with 73 Feature Flags
 * 
 * Architecture:
 * - Server-side authorization is AUTHORITATIVE via requireRoleOrFeature / requireFeaturePermission
 * - Client-side checks are UI visibility hints only
 * - When feature flags (perms) are provided, they are ALWAYS used exclusively
 * - Role-string fallbacks ONLY activate when perms have not loaded yet (async fetch)
 * 
 * Platform Role (separate from org roles — not included in CORE_ROLES):
 * - SUPER_ADMIN: Platform administrator — bypasses org permission system, has dedicated admin panel
 * 
 * Org-Level Roles (CORE_ROLES):
 * - ADMIN: Organization admin — full access to everything within their organization including user management
 * - HUSTLER: Multi-organization owner — switches between linked orgs, per-org permissions
 * - MANAGER: Management-level — full org features except user management & website builder
 * - SUPERINTENDENT: Field management — project execution, crew oversight, time approvals
 * - ESTIMATOR: Pre-construction — bidding, cost analysis, project creation
 * - FIELD_WORKER: Basic access — time clock, daily notes, active projects only
 * - VENDOR: External vendor portal access — submit pricing to enrolled clients, view enrollments (NO contractor features)
 */

export type { UserRole } from "@shared/schema";
import type { UserRole } from "@shared/schema";

export const CORE_ROLES: UserRole[] = ["ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "VENDOR"];
export const ASSIGNABLE_ROLES: UserRole[] = ["ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "VENDOR"];

export const ROLE_HIERARCHY: UserRole[] = [
  "SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER", "VENDOR"
];

export function rolesAtOrAbove(role: UserRole): UserRole[] {
  const idx = ROLE_HIERARCHY.indexOf(role);
  if (idx === -1) return [role];
  return ROLE_HIERARCHY.slice(0, idx + 1);
}

export function rolesAtOrBelow(role: UserRole): UserRole[] {
  const idx = ROLE_HIERARCHY.indexOf(role);
  if (idx === -1) return [role];
  return ROLE_HIERARCHY.slice(idx);
}

export function isRoleAtOrAbove(userRole: UserRole, threshold: UserRole): boolean {
  const userIdx = ROLE_HIERARCHY.indexOf(userRole);
  const thresholdIdx = ROLE_HIERARCHY.indexOf(threshold);
  if (userIdx === -1 || thresholdIdx === -1) return false;
  return userIdx <= thresholdIdx;
}

export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  HUSTLER: "Hustler",
  MANAGER: "Manager",
  SUPERINTENDENT: "Superintendent",
  ESTIMATOR: "Estimator",
  FIELD_WORKER: "Field Worker",
  VENDOR: "Vendor",
};

export const ROLE_ALTERNATE_LABELS: Record<string, string> = {
  MANAGER: "Project Manager",
};

export function getRoleDisplayName(role?: string, useAlternate?: boolean): string {
  if (!role) return "Unknown";
  if (useAlternate && role in ROLE_ALTERNATE_LABELS) {
    return ROLE_ALTERNATE_LABELS[role];
  }
  return ROLE_DISPLAY_NAMES[role] || role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function isSuperAdmin(role?: string): boolean {
  return role === "SUPER_ADMIN";
}

export function isVendor(role?: string): boolean {
  return role === "VENDOR";
}

export function isOrganizationAdmin(role?: string): boolean {
  return role === "ADMIN";
}

export function isAdmin(role?: string): boolean {
  return role === "ADMIN";
}

export function isFieldWorker(role?: string): boolean {
  return role === "FIELD_WORKER";
}

export function isHustler(role?: string): boolean {
  return role === "HUSTLER";
}

export function isSuperintendent(role?: string): boolean {
  return role === "SUPERINTENDENT";
}

export function hasContractorAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canAccessDashboard;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" ||
         role === "ESTIMATOR" || role === "FIELD_WORKER" || role === "HUSTLER";
}

export function hasVendorOrContractorAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canAccessDashboard;
  return hasContractorAccess(role) || role === "VENDOR";
}

export function hasManagementAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canAccessProjects && !perms.canAccessActiveProjectsOnly;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" ||
         role === "ESTIMATOR" || role === "HUSTLER";
}

export function hasExtendedManagementAccess(role?: string, perms?: FeaturePerms): boolean {
  return hasManagementAccess(role, perms);
}

export function isAdminOrManager(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageUsers || !!perms.canAccessCompanySettings;
  return role === "ADMIN" || role === "MANAGER" || role === "HUSTLER";
}

export function hasFinancialAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canViewFinancials || !!perms.canAccessFinancials;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" ||
         role === "ESTIMATOR" || role === "HUSTLER";
}

export function hasFinancialEditAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canEditFinancials;
  return role === "ADMIN" || role === "MANAGER" || role === "HUSTLER";
}

export function hasEquipmentAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageEquipment;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export function hasSafetyAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageSafety || !!perms.canViewSafety;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export function hasProcurementAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageProcurement;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "ESTIMATOR" || role === "HUSTLER";
}

export function hasHRAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageHiring;
  return role === "ADMIN" || role === "MANAGER" || role === "HUSTLER";
}

export function hasDispatchAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageScheduling;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export function hasCrmAccess(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canAccessCRM;
  return hasManagementAccess(role);
}

export function canAccessBids(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canViewBids;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" ||
         role === "ESTIMATOR" || role === "HUSTLER";
}

export function canEditBids(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canEditBids;
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER";
}

export function canDeleteBids(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canDeleteBids;
  return role === "ADMIN" || role === "MANAGER" || role === "HUSTLER";
}

export function canGenerateBidPDFs(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canGenerateBidPDFs;
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER";
}

export function canAccessBidNetworkAsGC(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canAccessBidNetworkGC;
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER";
}

export function canAccessBidNetworkAsSub(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canAccessBidNetworkInbox;
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "VENDOR";
}

export function canManageBidResponseStatus(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageBidResponses;
  return role === "ADMIN" || role === "MANAGER" || role === "HUSTLER";
}

export function canDeleteBidRequests(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canDeleteBidRequests;
  return role === "ADMIN" || role === "MANAGER" || role === "HUSTLER";
}

export function canEditProject(role?: string, userId?: string, projectEstimatorId?: string | null, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canEditProjects;
  if (role === "ADMIN" || role === "MANAGER" || role === "HUSTLER" || role === "ESTIMATOR") return true;
  return false;
}

export function canDeleteScopeItems(role?: string, userId?: string, projectSuperintendentId?: string | null, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canDeleteScopeItems;
  if (role === "ADMIN" || role === "MANAGER" || role === "HUSTLER") return true;
  if (role === "SUPERINTENDENT" && userId && projectSuperintendentId && userId === projectSuperintendentId) return true;
  return false;
}

export function canEditProjectHandoff(role?: string, userId?: string, projectSuperintendentId?: string | null, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canEditProjectHandoff;
  if (role === "ADMIN" || role === "MANAGER" || role === "HUSTLER") return true;
  if (role === "SUPERINTENDENT" && userId && projectSuperintendentId && userId === projectSuperintendentId) return true;
  return false;
}

export function canCreateCrmContact(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canCreateCRMContacts;
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export function canCreateChangeOrder(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canCreateChangeOrders;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export function canViewTimeApprovals(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canManageTimeClock;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export function canApproveTime(role?: string, perms?: FeaturePerms): boolean {
  if (perms) return !!perms.canApproveTime;
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER";
}

export const RoutePermissions = {
  PLATFORM_ADMIN: (role?: string) => isSuperAdmin(role),
  PLATFORM_ORGANIZATIONS: (role?: string) => isSuperAdmin(role),
  PLATFORM_ANALYTICS: (role?: string) => isSuperAdmin(role),
  PLATFORM_SUPPORT: (role?: string) => isSuperAdmin(role),

  USERS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageUsers : isOrganizationAdmin(role) || role === "HUSTLER",
  AI_SETTINGS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageAISettings : isOrganizationAdmin(role) || role === "HUSTLER",
  COST_RATES: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCostRates : isOrganizationAdmin(role) || role === "ESTIMATOR" || role === "HUSTLER",
  CREWS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageCrews : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
  SUBCONTRACTOR_PAYABLES: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessSubcontracts : isOrganizationAdmin(role) || role === "HUSTLER",
  COMPANY_SETTINGS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCompanySettings : isOrganizationAdmin(role) || role === "MANAGER" || role === "HUSTLER",

  BIDS: (role?: string, perms?: FeaturePerms) => canAccessBids(role, perms),
  BID_DETAIL: (role?: string, perms?: FeaturePerms) => canAccessBids(role, perms),
  TIME_ENTRY: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageTimeClock : hasManagementAccess(role),
  TIME_CLOCK_MANAGER: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageTimeClock : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
  AI_PM: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canUseAiFeatures : hasManagementAccess(role),
  CFO: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCFODashboard : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
  TM_DAILY: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTMDaily : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
  TM_BILLING: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTMBilling : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
  PROGRESS_BILLING: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProgressBilling : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
  PRODUCTION_RATES: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProductionRates : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER",
  CRM: (role?: string, perms?: FeaturePerms) => hasCrmAccess(role, perms),
  SCOPE_SETTINGS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessScopeSettings : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER",
  EQUIPMENT: (role?: string, perms?: FeaturePerms) => hasEquipmentAccess(role, perms),

  AI_BID_ANALYSIS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canUseAiBidAnalysis : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER",
  AI_CONTRACT_ANALYSIS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canUseAiContractAnalysis : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
  SUBCONTRACTS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessSubcontracts : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",

  WEBSITE_BUILDER: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageWebsite : isOrganizationAdmin(role) || role === "HUSTLER",

  SOCIAL_MEDIA: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canPostSocialMedia : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",

  DASHBOARD: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessDashboard : hasVendorOrContractorAccess(role),
  PROJECTS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  PROJECT_DETAIL: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  CALENDAR: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCalendar : hasContractorAccess(role),
  TIME_CLOCK: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTimeClock : hasContractorAccess(role),
  MESSAGES: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessMessages : hasVendorOrContractorAccess(role),

  DAILY_REPORT_LOCKS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canLockDailyReports : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",

  BID_NETWORK_GC: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessBidNetworkGC : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER",
  BID_NETWORK_INBOX: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessBidNetworkInbox : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "VENDOR" || role === "HUSTLER",

  MANAGE_WORKERS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageWorkforce : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",

  PAYROLL_MANAGEMENT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManagePayroll : isOrganizationAdmin(role) || role === "MANAGER" || role === "HUSTLER",

  KPI_MANAGEMENT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessKPIs : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",

  REPORTS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessReports : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER",

  PROCUREMENT: (role?: string, perms?: FeaturePerms) => hasProcurementAccess(role, perms),

  HIRING: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageHiring : role === "ADMIN" || role === "HUSTLER" || role === "MANAGER",
  HIRING_REVIEW: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageHiring : role === "ADMIN" || role === "HUSTLER" || role === "MANAGER",
  HIRING_ADVANCED: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessHiringInterviews : role === "ADMIN" || role === "HUSTLER" || role === "MANAGER",
  HIRING_SETTINGS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageHiringSettings : role === "ADMIN",

  OVERHEAD_COSTS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessOverheadCosts : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",

  BULLETINS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessBulletins : hasContractorAccess(role),
  EMAIL_ASSISTANT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessEmailAssistant : hasManagementAccess(role),
  TASKS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTasks : hasContractorAccess(role),
  HISTORICAL_COSTS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessHistoricalCosts : canAccessBids(role) || hasFinancialAccess(role),
  SAFETY_TRAINING: (role?: string, perms?: FeaturePerms) => hasSafetyAccess(role, perms),
  LEAVE_MANAGEMENT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageLeave : hasContractorAccess(role),
  MARKETPLACE: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessMarketplace : hasManagementAccess(role),
  EXECUTIVE_DIGEST: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessExecutiveDigest : role === "ADMIN" || role === "HUSTLER",
};

export const FeaturePermissions = {
  VIEW_BUDGET_METRICS: (role?: string, perms?: FeaturePerms) => hasFinancialAccess(role, perms),
  VIEW_FINANCIAL_KPIs: (role?: string, perms?: FeaturePerms) => hasFinancialAccess(role, perms),

  CREATE_PROJECT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canCreateProjects : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER",
  EDIT_PROJECT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canEditProjects : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER",
  VIEW_PROJECT_BUDGET: (role?: string, perms?: FeaturePerms) => hasFinancialAccess(role, perms),
  VIEW_PROJECT_FINANCIALS: (role?: string, perms?: FeaturePerms) => hasFinancialAccess(role, perms),
  CONVERT_BID_TO_PROJECT: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canConvertBidToProject : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "HUSTLER",

  VIEW_BUDGET_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canViewProjectBudget : hasFinancialAccess(role, perms),
  VIEW_ESTIMATES_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canViewProjectEstimates : hasFinancialAccess(role, perms),
  VIEW_PROCUREMENT_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canViewProjectProcurement : hasFinancialAccess(role, perms),
  VIEW_RECEIPTS_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canViewProjectReceipts : hasFinancialAccess(role, perms),
  VIEW_TIME_ENTRIES_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canViewProjectTimeEntries : hasFinancialAccess(role, perms),
  VIEW_SUBCONTRACTORS_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canViewProjectSubcontractors : hasFinancialAccess(role, perms),

  VIEW_OVERVIEW_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  VIEW_SCOPE_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  VIEW_CHANGE_ORDERS_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  VIEW_TAKEOFF_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  VIEW_DOCUMENTS_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  VIEW_MEDIA_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
  VIEW_DAILY_NOTES_TAB: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),

  VIEW_EQUIPMENT: (role?: string, perms?: FeaturePerms) => hasEquipmentAccess(role, perms),
  MANAGE_EQUIPMENT: (role?: string, perms?: FeaturePerms) => hasEquipmentAccess(role, perms),

  MANAGE_USERS: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageUsers : isOrganizationAdmin(role) || role === "HUSTLER",

  VIEW_ALL_ORGANIZATIONS: (role?: string) => isSuperAdmin(role),
  MANAGE_PLATFORM: (role?: string) => isSuperAdmin(role),
  VIEW_PLATFORM_ANALYTICS: (role?: string) => isSuperAdmin(role),
  BACKEND_SUPPORT: (role?: string) => isSuperAdmin(role),
};

export function getAllowedProjectStatuses(role?: string, perms?: FeaturePerms): string[] {
  if (isSuperAdmin(role)) {
    return [];
  }
  if (perms?.canAccessActiveProjectsOnly) {
    return ["ACTIVE"];
  }
  if (!perms && isFieldWorker(role)) {
    return ["ACTIVE"];
  }
  return ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"];
}

export function canViewProjectStatus(role?: string, status?: string, perms?: FeaturePerms): boolean {
  const allowedStatuses = getAllowedProjectStatuses(role, perms);
  return allowedStatuses.includes(status || "");
}

export interface FeaturePerms {
  canAccessDashboard?: boolean;
  canAccessProjects?: boolean;
  canAccessActiveProjectsOnly?: boolean;
  canCreateProjects?: boolean;
  canEditProjects?: boolean;
  canAccessCalendar?: boolean;
  canAccessTasks?: boolean;
  canAccessMessages?: boolean;
  canAccessBulletins?: boolean;
  canAccessEmailAssistant?: boolean;
  canViewBids?: boolean;
  canEditBids?: boolean;
  canDeleteBids?: boolean;
  canGenerateBidPDFs?: boolean;
  canConvertBidToProject?: boolean;
  canAccessBidNetworkGC?: boolean;
  canAccessBidNetworkInbox?: boolean;
  canManageBidResponses?: boolean;
  canDeleteBidRequests?: boolean;
  canAccessHistoricalCosts?: boolean;
  canAccessScopeSettings?: boolean;
  canUseAiBidAnalysis?: boolean;
  canUseAiContractAnalysis?: boolean;
  canAccessFinancials?: boolean;
  canViewFinancials?: boolean;
  canEditFinancials?: boolean;
  canAccessCostRates?: boolean;
  canAccessCFODashboard?: boolean;
  canAccessTMBilling?: boolean;
  canAccessProgressBilling?: boolean;
  canManageContracts?: boolean;
  canAccessSubcontracts?: boolean;
  canAccessOverheadCosts?: boolean;
  canAccessProductionRates?: boolean;
  canAccessVendorPricing?: boolean;
  canAccessTimeClock?: boolean;
  canManageTimeClock?: boolean;
  canApproveTime?: boolean;
  canAccessTMDaily?: boolean;
  canManagePayroll?: boolean;
  canManageCrews?: boolean;
  canManageWorkforce?: boolean;
  canManageLeave?: boolean;
  canManageSafety?: boolean;
  canManageScheduling?: boolean;
  canAccessKPIs?: boolean;
  canLockDailyReports?: boolean;
  canManageEquipment?: boolean;
  canManageProcurement?: boolean;
  canAccessCRM?: boolean;
  canCreateCRMContacts?: boolean;
  canAccessMarketplace?: boolean;
  canManageHiring?: boolean;
  canAccessHiringInterviews?: boolean;
  canManageHiringSettings?: boolean;
  canPostSocialMedia?: boolean;
  canManageWebsite?: boolean;
  canAccessExecutiveDigest?: boolean;
  canUseAiFeatures?: boolean;
  canViewSafety?: boolean;
  canViewAiSummaries?: boolean;
  canAccessCompanySettings?: boolean;
  canManageUsers?: boolean;
  canAccessApprovals?: boolean;
  canAccessAuditLogs?: boolean;
  canAccessReports?: boolean;
  canAccessEnterpriseSettings?: boolean;
  canManageAISettings?: boolean;
  canViewProjectBudget?: boolean;
  canViewProjectEstimates?: boolean;
  canViewProjectProcurement?: boolean;
  canViewProjectReceipts?: boolean;
  canViewProjectTimeEntries?: boolean;
  canViewProjectSubcontractors?: boolean;
  canCreateChangeOrders?: boolean;
  canDeleteScopeItems?: boolean;
  canEditProjectHandoff?: boolean;
  canSubmitPeerRatings?: boolean;
  canViewPeerRatings?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  testId: string;
  visible: (role?: string, perms?: FeaturePerms) => boolean;
}

export const NavigationConfig = {
  mainNav: [
    {
      href: "/dashboard",
      label: "Dashboard",
      testId: "nav-dashboard",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessDashboard : hasVendorOrContractorAccess(role),
    },
    {
      href: "/communications",
      label: "Bulletins",
      testId: "nav-bulletins",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessBulletins : hasContractorAccess(role),
    },
  ],

  projectsMenu: [
    {
      href: "/calendar",
      label: "Calendar",
      testId: "nav-calendar",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCalendar : hasContractorAccess(role),
    },
    {
      href: "/email-assistant",
      label: "Email Assistant",
      testId: "nav-email-assistant",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessEmailAssistant : hasManagementAccess(role),
    },
    {
      href: "/projects",
      label: "Projects",
      testId: "nav-projects",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProjects : hasContractorAccess(role),
    },
    {
      href: "/tasks",
      label: "Tasks",
      testId: "nav-tasks",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTasks : hasContractorAccess(role),
    },
    {
      href: "/messages",
      label: "Messages",
      testId: "nav-messages",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessMessages : hasContractorAccess(role),
    },
  ],

  preconstructionMenu: [
    {
      href: "/bids",
      label: "Bids",
      testId: "nav-bids",
      visible: (role?: string, perms?: FeaturePerms) => canAccessBids(role, perms),
    },
    {
      href: "/bid-network",
      label: "Bid Network",
      testId: "nav-bid-network",
      visible: (role?: string, perms?: FeaturePerms) => canAccessBidNetworkAsGC(role, perms),
    },
    {
      href: "/historical-costs",
      label: "Historical Costs",
      testId: "nav-historical-costs",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessHistoricalCosts : canAccessBids(role) || hasFinancialAccess(role),
    },
  ],

  operationsMenu: [
    {
      href: "/equipment",
      label: "Equipment",
      testId: "nav-equipment",
      visible: (role?: string, perms?: FeaturePerms) => hasEquipmentAccess(role, perms),
    },
    {
      href: "/procurement-module",
      label: "Procurement",
      testId: "nav-procurement",
      visible: (role?: string, perms?: FeaturePerms) => hasProcurementAccess(role, perms),
    },
  ],

  workforceMenu: [
    {
      href: "/time-clock",
      label: "My Time Clock",
      testId: "nav-my-time-clock",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTimeClock : hasContractorAccess(role),
    },
    {
      href: "/time-clock-manager",
      label: "Manage Time Clock",
      testId: "nav-manage-time-clock",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageTimeClock : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/tm-daily",
      label: "T&M Daily Sheets",
      testId: "nav-tm-daily",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTMDaily : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/crews",
      label: "Crews & Skills",
      testId: "nav-crews",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageCrews : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
    },
    {
      href: "/manage-workers",
      label: "Workforce Management",
      testId: "nav-manage-workers",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageWorkforce : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/payroll-management",
      label: "Payroll Management",
      testId: "nav-payroll-management",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManagePayroll : isOrganizationAdmin(role) || role === "MANAGER" || role === "HUSTLER",
    },
    {
      href: "/safety-training",
      label: "Safety Training",
      testId: "nav-safety-training",
      visible: (role?: string, perms?: FeaturePerms) => hasSafetyAccess(role, perms),
    },
    {
      href: "/leave-management",
      label: "Leave Management",
      testId: "nav-leave-management",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageLeave : hasContractorAccess(role),
    },
  ],

  financialsMenu: [
    {
      href: "/cfo-dashboard",
      label: "CFO Dashboard",
      testId: "nav-cfo-dashboard",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCFODashboard : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/tm-billing",
      label: "T&M Billing",
      testId: "nav-tm-billing",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessTMBilling : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
    },
    {
      href: "/progress-billing",
      label: "AIA / Progress Billing",
      testId: "nav-progress-billing",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProgressBilling : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
    },
    {
      href: "/cost-rates",
      label: "Cost Rates",
      testId: "nav-cost-rates",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCostRates : isOrganizationAdmin(role) || role === "ESTIMATOR" || role === "HUSTLER",
    },
    {
      href: "/production-rates",
      label: "Production Rates",
      testId: "nav-production-rates",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessProductionRates : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/subcontractor-payables",
      label: "Subcontractor Payables",
      testId: "nav-subcontractor-payables",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessSubcontracts : isOrganizationAdmin(role) || role === "HUSTLER",
    },
    {
      href: "/overhead-costs",
      label: "Overhead Costs",
      testId: "nav-overhead-costs",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessOverheadCosts : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
    },
  ],

  crmMenu: [
    {
      href: "/crm",
      label: "CRM",
      testId: "nav-crm",
      visible: (role?: string, perms?: FeaturePerms) => hasCrmAccess(role, perms),
    },
  ],

  marketplaceMenu: [
    {
      href: "/marketplace",
      label: "Marketplace",
      testId: "nav-marketplace",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessMarketplace : hasManagementAccess(role),
    },
  ],

  hiringMenu: [
    {
      href: "/hiring",
      label: "Hiring",
      testId: "nav-hiring",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageHiring : role === "ADMIN" || role === "HUSTLER" || role === "MANAGER",
    },
  ],

  insightsMenu: [
    {
      href: "/executive-digest",
      label: "Executive Digest",
      testId: "nav-executive-digest",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessExecutiveDigest : role === "ADMIN" || role === "HUSTLER",
    },
  ],

  administrationMenu: [
    {
      href: "/users",
      label: "User Management",
      testId: "nav-users",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageUsers : isOrganizationAdmin(role) || role === "HUSTLER",
    },
    {
      href: "/company-settings",
      label: "Company Settings",
      testId: "nav-company-settings",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessCompanySettings : isOrganizationAdmin(role) || role === "MANAGER" || role === "HUSTLER",
    },
    {
      href: "/scope-settings",
      label: "Scope Settings",
      testId: "nav-scope-settings",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessScopeSettings : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/ai-settings",
      label: "AI Settings",
      testId: "nav-ai-settings",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageAISettings : isOrganizationAdmin(role) || role === "HUSTLER",
    },
    {
      href: "/audit-logs",
      label: "Audit Logs",
      testId: "nav-audit-logs",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessAuditLogs : isOrganizationAdmin(role) || role === "HUSTLER",
    },
    {
      href: "/reports",
      label: "Reports",
      testId: "nav-reports",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessReports : role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
    {
      href: "/approvals",
      label: "Approvals",
      testId: "nav-approvals",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canAccessApprovals : role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER",
    },
  ],

  toolsMenu: [
    {
      href: "/website-builder",
      label: "Website Builder",
      testId: "nav-website-builder",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canManageWebsite : isOrganizationAdmin(role) || role === "HUSTLER",
    },
    {
      href: "/social-media",
      label: "Social Media",
      testId: "nav-social-media",
      visible: (role?: string, perms?: FeaturePerms) => perms ? !!perms.canPostSocialMedia : role === "ADMIN" || role === "MANAGER" || role === "HUSTLER",
    },
    {
      href: "/calculator",
      label: "Calculator",
      testId: "nav-calculator",
      visible: () => true,
    },
  ],
};

export type SidebarSection = 'portfolio' | 'dashboard' | 'bulletins' | 'projects' | 'operations' | 'workforce' | 'preconstruction' | 'marketplace' | 'crm' | 'financials' | 'insights' | 'hiring' | 'administration' | 'tools';

export const DEFAULT_SECTION_ORDER: SidebarSection[] = [
  'portfolio', 'dashboard', 'bulletins', 'projects', 'operations', 'workforce', 'preconstruction', 'marketplace', 'crm', 'financials', 'insights', 'hiring', 'administration', 'tools'
];

export const ROLE_SECTION_ORDER: Partial<Record<string, SidebarSection[]>> = {
  ADMIN: ['dashboard', 'administration', 'financials', 'projects', 'operations', 'workforce', 'preconstruction', 'marketplace', 'crm', 'insights', 'hiring', 'tools', 'bulletins'],
  MANAGER: ['dashboard', 'projects', 'operations', 'workforce', 'financials', 'preconstruction', 'marketplace', 'crm', 'insights', 'hiring', 'administration', 'tools', 'bulletins'],
  HUSTLER: ['portfolio', 'dashboard', 'financials', 'projects', 'operations', 'workforce', 'preconstruction', 'marketplace', 'crm', 'insights', 'hiring', 'administration', 'tools', 'bulletins'],
  FIELD_WORKER: ['dashboard', 'workforce', 'projects', 'tools', 'bulletins'],
  SUPERINTENDENT: ['operations', 'workforce', 'dashboard', 'bulletins', 'projects', 'preconstruction', 'financials', 'administration', 'tools'],
  ESTIMATOR: ['preconstruction', 'operations', 'dashboard', 'bulletins', 'financials', 'projects', 'crm', 'marketplace', 'administration', 'tools'],
};

export function getSidebarSectionOrder(role?: string): SidebarSection[] {
  if (role && ROLE_SECTION_ORDER[role]) {
    const roleOrder = ROLE_SECTION_ORDER[role]!;
    const unlisted = DEFAULT_SECTION_ORDER.filter(s => !roleOrder.includes(s));
    return [...roleOrder, ...unlisted];
  }
  return DEFAULT_SECTION_ORDER;
}

export const PlatformAdminNavConfig = {
  mainNav: [
    { href: "/admin", label: "Dashboard", testId: "nav-admin-dashboard", visible: () => true },
    { href: "/admin/organizations", label: "Organizations", testId: "nav-admin-organizations", visible: () => true },
    { href: "/admin/analytics", label: "Analytics", testId: "nav-admin-analytics", visible: () => true },
    { href: "/admin/tools", label: "Support Tools", testId: "nav-admin-tools", visible: () => true },
  ],
};

export const VendorPortalNavConfig = {
  mainNav: [
    { href: "/vendor", label: "Dashboard", testId: "nav-vendor-dashboard", visible: () => true },
    { href: "/vendor/pricing", label: "Pricing", testId: "nav-vendor-pricing", visible: () => true },
    { href: "/vendor/clients", label: "Clients", testId: "nav-vendor-clients", visible: () => true },
    { href: "/vendor/messages", label: "Messages", testId: "nav-vendor-messages", visible: () => true },
    { href: "/bid-network-inbox", label: "Bid Inbox", testId: "nav-vendor-bid-inbox", visible: () => true },
  ],
};

export const VendorRoutePermissions = {
  VENDOR_DASHBOARD: (role: string) => role === "VENDOR",
  VENDOR_PRICING: (role: string) => role === "VENDOR",
  VENDOR_CLIENTS: (role: string) => role === "VENDOR",
  VENDOR_MESSAGES: (role: string) => role === "VENDOR",
  BID_INBOX: (role: string) => role === "VENDOR",
};
