/**
 * Role-Based Access Control (RBAC) Utilities
 * 
 * This module defines permission checks for different user roles in the SmartManageAI Construction Management Platform.
 * 
 * Role Hierarchy (18 roles):
 * - SUPER_ADMIN: Platform administrator - monitors all organizations, analytics, support tools (NO contractor features)
 * - ADMIN: Organization admin - full access to everything within their organization including user management
 * - MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER: Full access except user management
 * - MAINTENANCE_MANAGER: Full access to equipment management and receives maintenance/repair requests
 * - HOURLY_EMPLOYEE: Limited access to active projects, daily notes, calendar, time clock (no finances/budgets)
 * - VENDOR: External vendor portal access - submit pricing to enrolled clients, view enrollments (NO contractor features)
 * - HUSTLER: Multi-organization role - can switch between linked organizations with management-level access
 * - SALES: CRM, leads, pipeline, proposals — no payroll/banking/full financials
 * - MARKETING: Marketing campaigns, lead sources, CRM analytics — no payroll/banking
 * - SAFETY_MANAGER: Safety logs, incidents, training, certifications, job site roster — no payroll/banking
 * - HR_MANAGER: Hiring, onboarding, employee profiles, certifications, performance — no banking/invoices
 * - EQUIPMENT_MANAGER: Equipment registry, assignments, maintenance, utilization — no payroll/banking
 * - PROJECT_ENGINEER: RFIs, submittals, docs, drawings, change events — no payroll/banking
 * - PROCUREMENT_MANAGER: Material requests, POs, vendor catalogs, deliveries — no payroll/banking
 * - DISPATCHER: Crew/tech schedules, assignments, daily plans, dispatch — no payroll/banking
 */

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "OFFICE_MANAGER" | "HOURLY_EMPLOYEE" | "MAINTENANCE_MANAGER" | "VENDOR" | "HUSTLER" | "SALES" | "MARKETING" | "SAFETY_MANAGER" | "HR_MANAGER" | "EQUIPMENT_MANAGER" | "PROJECT_ENGINEER" | "PROCUREMENT_MANAGER" | "DISPATCHER";

/**
 * Check if user is a super admin (platform level - NO contractor features)
 */
export function isSuperAdmin(role?: string): boolean {
  return role === "SUPER_ADMIN";
}

/**
 * Check if user is a vendor (external vendor portal - NO contractor features)
 */
export function isVendor(role?: string): boolean {
  return role === "VENDOR";
}

/**
 * Check if user is an organization admin (NOT super admin)
 */
export function isOrganizationAdmin(role?: string): boolean {
  return role === "ADMIN";
}

/**
 * Check if user is an organization admin or super admin
 */
export function isAdmin(role?: string): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * Check if user is admin or manager (organization level only, not super admin)
 */
export function isAdminOrManager(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/**
 * Check if user is hourly employee
 */
export function isHourlyEmployee(role?: string): boolean {
  return role === "HOURLY_EMPLOYEE";
}

/**
 * Check if user is a HUSTLER (multi-organization role)
 */
export function isHustler(role?: string): boolean {
  return role === "HUSTLER";
}

/**
 * Check if user has contractor-level access (excludes SUPER_ADMIN who only does platform admin)
 * HUSTLER role has contractor access to work across their organizations
 * All org-level roles (including new specialized roles) have contractor access
 */
export function hasContractorAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER" || role === "MAINTENANCE_MANAGER" ||
         role === "HOURLY_EMPLOYEE" || role === "HUSTLER" ||
         role === "SALES" || role === "MARKETING" || role === "SAFETY_MANAGER" ||
         role === "HR_MANAGER" || role === "EQUIPMENT_MANAGER" || role === "PROJECT_ENGINEER" ||
         role === "PROCUREMENT_MANAGER" || role === "DISPATCHER";
}

/**
 * Check if user has management-level access within an organization (not hourly employee, not super admin)
 * HUSTLER role has management access to work across their organizations
 * Note: MAINTENANCE_MANAGER has specialized access to equipment only - use hasEquipmentAccess() for them
 * New specialized roles: SAFETY_MANAGER, HR_MANAGER, EQUIPMENT_MANAGER, PROJECT_ENGINEER, PROCUREMENT_MANAGER have management access
 * SALES, MARKETING, DISPATCHER have scoped access (not full management)
 */
export function hasManagementAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER" ||
         role === "HUSTLER" ||
         role === "SAFETY_MANAGER" || role === "HR_MANAGER" || role === "EQUIPMENT_MANAGER" ||
         role === "PROJECT_ENGINEER" || role === "PROCUREMENT_MANAGER";
}

/**
 * Check if user has full management access INCLUDING maintenance manager
 * Use this for features like CRM contacts that maintenance managers can view but not financial features
 */
export function hasExtendedManagementAccess(role?: string): boolean {
  return hasManagementAccess(role) || role === "MAINTENANCE_MANAGER" || 
         role === "SALES" || role === "MARKETING" || role === "DISPATCHER";
}

/**
 * Check if user has financial access (budget, estimates, receipts, payroll, banking)
 * Only core management roles — excludes new specialized roles per design
 */
export function hasFinancialAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER" ||
         role === "HUSTLER";
}

/**
 * Check if user is a maintenance manager
 */
export function isMaintenanceManager(role?: string): boolean {
  return role === "MAINTENANCE_MANAGER";
}

/**
 * Check if user has equipment access (organization level only)
 */
export function hasEquipmentAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "MAINTENANCE_MANAGER" || role === "EQUIPMENT_MANAGER";
}

/**
 * Check if user has safety module access
 */
export function hasSafetyAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "SAFETY_MANAGER";
}

/**
 * Check if user has procurement module access
 */
export function hasProcurementAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "PROCUREMENT_MANAGER";
}

/**
 * Check if user has HR module access
 */
export function hasHRAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "HR_MANAGER";
}

/**
 * Check if user has dispatch/scheduling access
 */
export function hasDispatchAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "DISPATCHER";
}

/**
 * Check if user has CRM/sales access
 */
export function hasCrmAccess(role?: string): boolean {
  return hasManagementAccess(role) || role === "SALES" || role === "MARKETING";
}

/**
 * Check if user is a superintendent (view-only access to bids)
 */
export function isSuperintendent(role?: string): boolean {
  return role === "SUPERINTENDENT";
}

/**
 * Check if user can access bids at all (view/list)
 * MAINTENANCE_MANAGER and HOURLY_EMPLOYEE cannot access bids
 */
export function canAccessBids(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER" || role === "HUSTLER" ||
         role === "PROJECT_ENGINEER";
}

/**
 * Check if user can edit bids (create, edit, delete, convert, add quotes/equipment)
 * SUPERINTENDENT has view-only access to bids
 */
export function canEditBids(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR";
}

/**
 * Check if user can delete bids (more restricted than edit)
 */
export function canDeleteBids(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/**
 * Check if user can generate bid PDFs
 */
export function canGenerateBidPDFs(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR";
}

/**
 * Check if user can access bid network features (as GC - creating bid requests, sending invitations)
 */
export function canAccessBidNetworkAsGC(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR";
}

/**
 * Check if user can access bid network inbox (as subcontractor - receiving and responding to bid invitations)
 */
export function canAccessBidNetworkAsSub(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "VENDOR";
}

/**
 * Check if user can manage bid response status (shortlist, award, reject)
 */
export function canManageBidResponseStatus(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/**
 * Check if user can delete bid requests
 */
export function canDeleteBidRequests(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/**
 * Check if user can edit a project (Admin/Manager always, ESTIMATOR if they are assigned estimator)
 * This is an ownership-based permission check
 */
export function canEditProject(role?: string, userId?: string, projectEstimatorId?: string | null): boolean {
  if (role === "ADMIN" || role === "MANAGER") return true;
  if (role === "ESTIMATOR" && userId && projectEstimatorId && userId === projectEstimatorId) return true;
  return false;
}

/**
 * Check if user can delete scope items (Admin/Manager always, SUPERINTENDENT if assigned to project)
 * This is an ownership-based permission check
 */
export function canDeleteScopeItems(role?: string, userId?: string, projectSuperintendentId?: string | null): boolean {
  if (role === "ADMIN" || role === "MANAGER") return true;
  if (role === "SUPERINTENDENT" && userId && projectSuperintendentId && userId === projectSuperintendentId) return true;
  return false;
}

/**
 * Check if user can edit project handoff (Admin/Manager/Office Manager, or SUPERINTENDENT if assigned)
 */
export function canEditProjectHandoff(role?: string, userId?: string, projectSuperintendentId?: string | null): boolean {
  if (role === "ADMIN" || role === "MANAGER" || role === "OFFICE_MANAGER") return true;
  if (role === "SUPERINTENDENT" && userId && projectSuperintendentId && userId === projectSuperintendentId) return true;
  return false;
}

/**
 * Check if user can create CRM contacts (Admin/Manager/Estimator/Superintendent)
 */
export function canCreateCrmContact(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "SALES" || role === "PROCUREMENT_MANAGER";
}

/**
 * Check if user can create change orders (Admin/Manager/Superintendent/Office Manager)
 */
export function canCreateChangeOrder(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER";
}

/**
 * Check if user can view time approval data (Admin/Manager/Superintendent/Office Manager)
 * Note: OFFICE_MANAGER can view but not approve
 */
export function canViewTimeApprovals(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER" || role === "HR_MANAGER" || role === "DISPATCHER";
}

/**
 * Check if user can approve time entries/shifts (Admin/Manager/Superintendent/Office Manager)
 */
export function canApproveTime(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER";
}

/**
 * Route access permissions
 */
export const RoutePermissions = {
  // Platform Admin routes (SUPER_ADMIN only)
  PLATFORM_ADMIN: (role?: string) => isSuperAdmin(role),
  PLATFORM_ORGANIZATIONS: (role?: string) => isSuperAdmin(role),
  PLATFORM_ANALYTICS: (role?: string) => isSuperAdmin(role),
  PLATFORM_SUPPORT: (role?: string) => isSuperAdmin(role),

  // Organization Admin-only routes (not for SUPER_ADMIN)
  USERS: (role?: string) => isOrganizationAdmin(role),
  AI_SETTINGS: (role?: string) => isOrganizationAdmin(role),
  COST_RATES: (role?: string) => isOrganizationAdmin(role) || role === "ESTIMATOR" || role === "OFFICE_MANAGER",
  CREWS: (role?: string) => isOrganizationAdmin(role),
  SUBCONTRACTOR_PAYABLES: (role?: string) => isOrganizationAdmin(role),
  COMPANY_SETTINGS: (role?: string) => isOrganizationAdmin(role),

  // Management routes (blocked for hourly employees, maintenance managers, and SUPER_ADMIN)
  BIDS: (role?: string) => canAccessBids(role),
  BID_DETAIL: (role?: string) => canAccessBids(role),
  TIME_ENTRY: (role?: string) => hasManagementAccess(role) || role === "DISPATCHER",
  TIME_CLOCK_MANAGER: (role?: string) => isAdminOrManager(role) || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER" || role === "HR_MANAGER" || role === "DISPATCHER",
  AI_PM: (role?: string) => hasManagementAccess(role),
  CFO: (role?: string) => isAdminOrManager(role),
  TM_DAILY: (role?: string) => hasManagementAccess(role),
  TM_BILLING: (role?: string) => isAdminOrManager(role) || role === "OFFICE_MANAGER",
  PRODUCTION_RATES: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER",
  CRM: (role?: string) => hasCrmAccess(role),
  SCOPE_LIBRARY: (role?: string) => isAdminOrManager(role) || role === "ESTIMATOR",
  SCOPE_SETTINGS: (role?: string) => isAdminOrManager(role) || role === "ESTIMATOR",
  EQUIPMENT: (role?: string) => hasEquipmentAccess(role),
  
  // New feature routes
  AI_BID_ANALYSIS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR",
  AI_CONTRACT_ANALYSIS: (role?: string) => isAdminOrManager(role),
  SCHEDULE_OF_VALUES: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER",
  SUBCONTRACTS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT",
  
  // Website Builder routes (ADMIN only - organization feature)
  WEBSITE_BUILDER: (role?: string) => isOrganizationAdmin(role),

  // Social Media Management (ADMIN and MANAGER)
  SOCIAL_MEDIA: (role?: string) => role === "ADMIN" || role === "MANAGER",

  // Contractor user access (everyone except SUPER_ADMIN)
  DASHBOARD: (role?: string) => hasContractorAccess(role),
  PROJECTS: (role?: string) => hasContractorAccess(role),
  PROJECT_DETAIL: (role?: string) => hasContractorAccess(role),
  CALENDAR: (role?: string) => hasContractorAccess(role),
  TIME_CLOCK: (role?: string) => hasContractorAccess(role),
  MESSAGES: (role?: string) => hasContractorAccess(role),
  
  // Delay Claims routes (management access)
  DELAY_CLAIMS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER" || role === "SAFETY_MANAGER",
  DAILY_REPORT_LOCKS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT",
  PHOTO_CUSTODY: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER",
  
  // Bid Network routes
  BID_NETWORK_GC: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR",
  BID_NETWORK_INBOX: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "VENDOR",

  // Workforce Management (merged Manage Workers + Performance & Rewards)
  MANAGE_WORKERS: (role?: string) => hasContractorAccess(role),

  // Payroll Management
  PAYROLL_MANAGEMENT: (role?: string) => isOrganizationAdmin(role) || role === "OFFICE_MANAGER" || role === "MANAGER",

  // KPI Management (ADMIN, MANAGER, SUPERINTENDENT, HUSTLER, HR_MANAGER)
  KPI_MANAGEMENT: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "HUSTLER" || role === "HR_MANAGER",

  // Reports (ADMIN, MANAGER, ESTIMATOR, SUPERINTENDENT)
  REPORTS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT",

  // Procurement Module
  PROCUREMENT: (role?: string) => hasProcurementAccess(role),

  // Hiring Module
  HIRING: (role?: string) => role === "ADMIN" || role === "HUSTLER" || role === "MANAGER" || role === "OFFICE_MANAGER" || role === "HR_MANAGER",
  HIRING_SETTINGS: (role?: string) => role === "ADMIN",
};

/**
 * Feature permissions for different sections within pages
 */
export const FeaturePermissions = {
  // Dashboard features — financial metrics restricted to core management
  VIEW_BUDGET_METRICS: (role?: string) => hasFinancialAccess(role),
  VIEW_FINANCIAL_KPIs: (role?: string) => hasFinancialAccess(role),

  // Project features
  CREATE_PROJECT: (role?: string) => isAdminOrManager(role) || role === "ESTIMATOR",
  EDIT_PROJECT: (role?: string) => hasManagementAccess(role),
  VIEW_PROJECT_BUDGET: (role?: string) => hasFinancialAccess(role),
  VIEW_PROJECT_FINANCIALS: (role?: string) => hasFinancialAccess(role),
  CONVERT_BID_TO_PROJECT: (role?: string) => isAdminOrManager(role) || role === "ESTIMATOR",

  // Project detail tabs - Financial tabs restricted to core management roles
  VIEW_BUDGET_TAB: (role?: string) => hasFinancialAccess(role),
  VIEW_ESTIMATES_TAB: (role?: string) => hasFinancialAccess(role),
  VIEW_PROCUREMENT_TAB: (role?: string) => hasFinancialAccess(role) || role === "PROCUREMENT_MANAGER",
  VIEW_RECEIPTS_TAB: (role?: string) => hasFinancialAccess(role),
  VIEW_TIME_ENTRIES_TAB: (role?: string) => hasFinancialAccess(role) || role === "HR_MANAGER",
  VIEW_SUBCONTRACTORS_TAB: (role?: string) => hasFinancialAccess(role),

  // Always accessible tabs for contractor users
  VIEW_OVERVIEW_TAB: (role?: string) => hasContractorAccess(role),
  VIEW_SCOPE_TAB: (role?: string) => hasContractorAccess(role),
  VIEW_CHANGE_ORDERS_TAB: (role?: string) => hasContractorAccess(role),
  VIEW_TAKEOFF_TAB: (role?: string) => hasContractorAccess(role),
  VIEW_DOCUMENTS_TAB: (role?: string) => hasContractorAccess(role),
  VIEW_MEDIA_TAB: (role?: string) => hasContractorAccess(role),
  VIEW_DAILY_NOTES_TAB: (role?: string) => hasContractorAccess(role),

  // Equipment management
  VIEW_EQUIPMENT: (role?: string) => hasEquipmentAccess(role),
  MANAGE_EQUIPMENT: (role?: string) => hasEquipmentAccess(role),

  // User management (organization admin only)
  MANAGE_USERS: (role?: string) => isOrganizationAdmin(role),

  // Platform admin features
  VIEW_ALL_ORGANIZATIONS: (role?: string) => isSuperAdmin(role),
  MANAGE_PLATFORM: (role?: string) => isSuperAdmin(role),
  VIEW_PLATFORM_ANALYTICS: (role?: string) => isSuperAdmin(role),
  BACKEND_SUPPORT: (role?: string) => isSuperAdmin(role),
};

/**
 * Get allowed project statuses for viewing based on role
 */
export function getAllowedProjectStatuses(role?: string): string[] {
  if (isSuperAdmin(role)) {
    // Super admin doesn't view projects
    return [];
  }
  if (isHourlyEmployee(role)) {
    // Hourly employees only see active projects
    return ["ACTIVE"];
  }
  // All other roles see all project statuses
  return ["BID", "PLANNING", "ACTIVE", "COMPLETE", "CLOSED"];
}

/**
 * Check if user can view a specific project status
 */
export function canViewProjectStatus(role?: string, status?: string): boolean {
  const allowedStatuses = getAllowedProjectStatuses(role);
  return allowedStatuses.includes(status || "");
}

export interface FeaturePerms {
  canAccessFinancials?: boolean;
  canManagePayroll?: boolean;
  canAccessReports?: boolean;
  canUseAiFeatures?: boolean;
  canPostSocialMedia?: boolean;
  canManageWebsite?: boolean;
  canManageEquipment?: boolean;
  canManageProcurement?: boolean;
}

/**
 * Navigation items configuration for contractors
 */
export interface NavItem {
  href: string;
  label: string;
  testId: string;
  visible: (role?: string, perms?: FeaturePerms) => boolean;
}

/**
 * Contractor Navigation Config (for organization users, NOT super admin)
 */
export const NavigationConfig = {
  mainNav: [
    {
      href: "/dashboard",
      label: "Dashboard",
      testId: "nav-dashboard",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/communications",
      label: "Bulletins",
      testId: "nav-bulletins",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/procurement-module",
      label: "Procurement",
      testId: "nav-procurement",
      visible: (role?: string) => hasProcurementAccess(role),
    },
  ],

  projectsMenu: [
    {
      href: "/calendar",
      label: "Calendar",
      testId: "nav-calendar",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/messages",
      label: "Messages",
      testId: "nav-messages",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/projects",
      label: "Projects",
      testId: "nav-projects",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/tasks",
      label: "Tasks",
      testId: "nav-tasks",
      visible: (role?: string) => hasContractorAccess(role),
    },
  ],

  timeClockMenu: [
    {
      href: "/time-clock",
      label: "My Time Clock",
      testId: "nav-my-time-clock",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/time-clock-manager",
      label: "Manage Time Clock",
      testId: "nav-manage-time-clock",
      visible: (role?: string) => isAdminOrManager(role) || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER" || role === "HR_MANAGER" || role === "DISPATCHER",
    },
    {
      href: "/tm-daily",
      label: "T&M Daily Sheets",
      testId: "nav-tm-daily",
      visible: (role?: string) => hasManagementAccess(role),
    },
  ],

  operationsMenu: [
    {
      href: "/equipment",
      label: "Equipment",
      testId: "nav-equipment",
      visible: (role?: string, perms?: FeaturePerms) => hasEquipmentAccess(role) || perms?.canManageEquipment === true,
    },
    {
      href: "/delay-claims",
      label: "Daily Claims",
      testId: "nav-delay-claims",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER" || role === "SAFETY_MANAGER",
    },
    {
      href: "/rfis",
      label: "RFIs",
      testId: "nav-rfis",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER" || role === "SAFETY_MANAGER",
    },
    {
      href: "/transmittals",
      label: "Transmittals",
      testId: "nav-transmittals",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER",
    },
    {
      href: "/submittals",
      label: "Submittals",
      testId: "nav-submittals",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER",
    },
    {
      href: "/photo-custody",
      label: "Photo Custody",
      testId: "nav-photo-custody",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "PROJECT_ENGINEER",
    },
  ],

  preconstructionMenu: [
    {
      href: "/bids",
      label: "Bids",
      testId: "nav-bids",
      visible: (role?: string) => canAccessBids(role),
    },
    {
      href: "/bid-network",
      label: "Bid Network",
      testId: "nav-bid-network",
      visible: (role?: string) => canAccessBidNetworkAsGC(role),
    },
    {
      href: "/bid-inbox",
      label: "Bid Inbox",
      testId: "nav-bid-inbox",
      visible: (role?: string) => canAccessBidNetworkAsSub(role),
    },
  ],

  financialsMenu: [
    {
      href: "/cfo",
      label: "CFO Dashboard",
      testId: "nav-cfo",
      visible: (role?: string, perms?: FeaturePerms) => isAdminOrManager(role) || perms?.canAccessFinancials === true,
    },
    {
      href: "/cost-rates",
      label: "Cost Rates",
      testId: "nav-cost-rates",
      visible: (role?: string, perms?: FeaturePerms) => isOrganizationAdmin(role) || role === "ESTIMATOR" || role === "OFFICE_MANAGER" || perms?.canAccessFinancials === true,
    },
    {
      href: "/schedule-of-values",
      label: "Schedule of Values",
      testId: "nav-sov",
      visible: (role?: string, perms?: FeaturePerms) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER" || perms?.canAccessFinancials === true,
    },
    {
      href: "/subcontracts",
      label: "Subcontracts & Payables",
      testId: "nav-subcontracts",
      visible: (role?: string, perms?: FeaturePerms) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER" || perms?.canAccessFinancials === true,
    },
    {
      href: "/tm-billing",
      label: "T&M Billing",
      testId: "nav-tm-billing",
      visible: (role?: string, perms?: FeaturePerms) => isAdminOrManager(role) || role === "OFFICE_MANAGER" || perms?.canAccessFinancials === true,
    },
    {
      href: "/vendor-pricing",
      label: "Vendor Pricing Sync",
      testId: "nav-vendor-pricing",
      visible: (role?: string, perms?: FeaturePerms) => hasManagementAccess(role) || perms?.canManageProcurement === true,
    },
  ],

  insightsMenu: [
    {
      href: "/ai-bid-analysis",
      label: "AI Bid Analysis",
      testId: "nav-ai-bid-analysis",
      visible: (role?: string, perms?: FeaturePerms) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || perms?.canUseAiFeatures === true,
    },
    {
      href: "/ai-contract-analysis",
      label: "AI Contract Analysis",
      testId: "nav-ai-contract-analysis",
      visible: (role?: string, perms?: FeaturePerms) => isAdminOrManager(role) || perms?.canUseAiFeatures === true,
    },
    {
      href: "/ai-pm",
      label: "AI Project Manager",
      testId: "nav-ai-pm",
      visible: (role?: string, perms?: FeaturePerms) => hasManagementAccess(role) || perms?.canUseAiFeatures === true,
    },
    {
      href: "/ai-settings",
      label: "AI Settings",
      testId: "nav-ai-settings",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/production-rates",
      label: "Production Rates",
      testId: "nav-production-rates",
      visible: (role?: string, perms?: FeaturePerms) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER" || perms?.canAccessReports === true,
    },
    {
      href: "/email-assistant",
      label: "Email Assistant",
      testId: "nav-email-assistant",
      visible: (role?: string, perms?: FeaturePerms) => hasManagementAccess(role) || perms?.canUseAiFeatures === true,
    },
  ],

  administrationMenu: [
    {
      href: "/company-settings",
      label: "Company Settings",
      testId: "nav-company-settings",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/crews",
      label: "Crews & Skills",
      testId: "nav-crews",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/daily-report-locks",
      label: "Report Locks",
      testId: "nav-report-locks",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT",
    },
    {
      href: "/scope-library",
      label: "Scope Library",
      testId: "nav-scope-library",
      visible: (role?: string) => isAdminOrManager(role) || role === "ESTIMATOR",
    },
    {
      href: "/cost-codes",
      label: "Cost Codes",
      testId: "nav-cost-codes",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/scope-settings",
      label: "Scope Settings",
      testId: "nav-scope-settings",
      visible: (role?: string) => isAdminOrManager(role) || role === "ESTIMATOR",
    },
    {
      href: "/users",
      label: "Users & Roles",
      testId: "nav-users",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/website-builder",
      label: "Website Builder",
      testId: "nav-website-builder",
      visible: (role?: string, perms?: FeaturePerms) => isOrganizationAdmin(role) || perms?.canManageWebsite === true,
    },
    {
      href: "/manage-workers",
      label: "Workforce Management",
      testId: "nav-manage-workers",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/payroll-management",
      label: "Payroll Management",
      testId: "nav-payroll-management",
      visible: (role?: string, perms?: FeaturePerms) => isOrganizationAdmin(role) || role === "OFFICE_MANAGER" || role === "MANAGER" || perms?.canManagePayroll === true,
    },
    {
      href: "/integrations",
      label: "Integrations Hub",
      testId: "nav-integrations",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/approvals",
      label: "Approvals",
      testId: "nav-approvals",
      visible: (role?: string) => isOrganizationAdmin(role) || role === "MANAGER" || role === "SUPERINTENDENT",
    },
    {
      href: "/ai-governance",
      label: "AI Governance",
      testId: "nav-ai-governance",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/executive-digest",
      label: "Executive Digest",
      testId: "nav-executive-digest",
      visible: (role?: string) => isOrganizationAdmin(role) || role === "MANAGER",
    },
    {
      href: "/audit-logs",
      label: "Audit Logs",
      testId: "nav-audit-logs",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/enterprise-settings",
      label: "Enterprise Settings",
      testId: "nav-enterprise-settings",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/safety-training",
      label: "Safety Training",
      testId: "nav-safety-training",
      visible: (role?: string) => hasSafetyAccess(role) || isOrganizationAdmin(role),
    },
  ],

  hiringMenu: [
    {
      href: "/hiring",
      label: "Dashboard",
      testId: "nav-hiring-dashboard",
      visible: (role?: string) => role === "ADMIN" || role === "HUSTLER" || role === "MANAGER" || role === "OFFICE_MANAGER" || role === "HR_MANAGER",
    },
    {
      href: "/hiring/jobs",
      label: "Jobs",
      testId: "nav-hiring-jobs",
      visible: (role?: string) => role === "ADMIN" || role === "HUSTLER" || role === "MANAGER" || role === "OFFICE_MANAGER" || role === "HR_MANAGER",
    },
    {
      href: "/hiring/candidates",
      label: "Candidates",
      testId: "nav-hiring-candidates",
      visible: (role?: string) => role === "ADMIN" || role === "HUSTLER" || role === "MANAGER" || role === "OFFICE_MANAGER" || role === "HR_MANAGER",
    },
    {
      href: "/hiring/pipeline",
      label: "Pipeline",
      testId: "nav-hiring-pipeline",
      visible: (role?: string) => role === "ADMIN" || role === "HUSTLER" || role === "MANAGER" || role === "OFFICE_MANAGER" || role === "HR_MANAGER",
    },
    {
      href: "/hiring/settings",
      label: "Settings",
      testId: "nav-hiring-settings",
      visible: (role?: string) => role === "ADMIN",
    },
  ],

  toolsMenu: [
    {
      href: "/calculator",
      label: "Calculator",
      testId: "nav-calculator",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/crm",
      label: "CRM",
      testId: "nav-crm",
      visible: (role?: string) => hasCrmAccess(role),
    },
    {
      href: "/mobile-sync",
      label: "Mobile Sync Status",
      testId: "nav-mobile-sync",
      visible: (role?: string) => hasContractorAccess(role),
    },
  ],
};

/**
 * Platform Admin Navigation Config (SUPER_ADMIN only)
 */
export const PlatformAdminNavConfig = {
  mainNav: [
    {
      href: "/admin",
      label: "Dashboard",
      testId: "nav-platform-dashboard",
      visible: (role?: string) => isSuperAdmin(role),
    },
    {
      href: "/admin/organizations",
      label: "Organizations",
      testId: "nav-platform-organizations",
      visible: (role?: string) => isSuperAdmin(role),
    },
    {
      href: "/admin/subscriptions",
      label: "Subscriptions",
      testId: "nav-platform-subscriptions",
      visible: (role?: string) => isSuperAdmin(role),
    },
    {
      href: "/admin/analytics",
      label: "Analytics",
      testId: "nav-platform-analytics",
      visible: (role?: string) => isSuperAdmin(role),
    },
    {
      href: "/admin/support",
      label: "Support Tools",
      testId: "nav-platform-support",
      visible: (role?: string) => isSuperAdmin(role),
    },
    {
      href: "/admin/audit",
      label: "Security Audit",
      testId: "nav-platform-audit",
      visible: (role?: string) => isSuperAdmin(role),
    },
  ],
};

/**
 * Vendor Portal Navigation Config (VENDOR only)
 * External vendors can submit pricing to enrolled contractor clients
 */
export const VendorPortalNavConfig = {
  mainNav: [
    {
      href: "/vendor",
      label: "Dashboard",
      testId: "nav-vendor-dashboard",
      visible: (role?: string) => isVendor(role),
    },
    {
      href: "/vendor/pricing",
      label: "My Pricing",
      testId: "nav-vendor-pricing",
      visible: (role?: string) => isVendor(role),
    },
    {
      href: "/vendor/clients",
      label: "Enrolled Clients",
      testId: "nav-vendor-clients",
      visible: (role?: string) => isVendor(role),
    },
  ],
};

/**
 * Route permissions for vendor portal
 */
export const VendorRoutePermissions = {
  VENDOR_DASHBOARD: (role?: string) => isVendor(role),
  VENDOR_PRICING: (role?: string) => isVendor(role),
  VENDOR_CLIENTS: (role?: string) => isVendor(role),
};
