/**
 * Role-Based Access Control (RBAC) Utilities
 * 
 * This module defines permission checks for different user roles in the SmartManageAI Construction Management Platform.
 * 
 * Role Hierarchy:
 * - SUPER_ADMIN: Platform administrator - monitors all organizations, analytics, support tools (NO contractor features)
 * - ADMIN: Organization admin - full access to everything within their organization including user management
 * - MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER: Full access except user management
 * - MAINTENANCE_MANAGER: Full access to equipment management and receives maintenance/repair requests
 * - HOURLY_EMPLOYEE: Limited access to active projects, daily notes, calendar, time clock (no finances/budgets)
 * - VENDOR: External vendor portal access - submit pricing to enrolled clients, view enrollments (NO contractor features)
 */

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "OFFICE_MANAGER" | "HOURLY_EMPLOYEE" | "MAINTENANCE_MANAGER" | "VENDOR";

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
 * Check if user has contractor-level access (excludes SUPER_ADMIN who only does platform admin)
 */
export function hasContractorAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER" || role === "MAINTENANCE_MANAGER" ||
         role === "HOURLY_EMPLOYEE";
}

/**
 * Check if user has management-level access within an organization (not hourly employee, not super admin)
 */
export function hasManagementAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER" || role === "MAINTENANCE_MANAGER";
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
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "MAINTENANCE_MANAGER";
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
  COST_RATES: (role?: string) => isOrganizationAdmin(role),
  CREWS: (role?: string) => isOrganizationAdmin(role),
  SUBCONTRACTOR_PAYABLES: (role?: string) => isOrganizationAdmin(role),
  COMPANY_SETTINGS: (role?: string) => isOrganizationAdmin(role),

  // Management routes (blocked for hourly employees and SUPER_ADMIN)
  BIDS: (role?: string) => hasManagementAccess(role),
  BID_DETAIL: (role?: string) => hasManagementAccess(role),
  TIME_ENTRY: (role?: string) => hasManagementAccess(role),
  TIME_CLOCK_MANAGER: (role?: string) => isAdminOrManager(role),
  AI_PM: (role?: string) => hasManagementAccess(role),
  CFO: (role?: string) => isAdminOrManager(role),
  TM_DAILY: (role?: string) => hasManagementAccess(role),
  PRODUCTION_RATES: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT",
  CRM: (role?: string) => hasManagementAccess(role),
  SCOPE_SETTINGS: (role?: string) => isAdminOrManager(role),
  EQUIPMENT: (role?: string) => hasEquipmentAccess(role),
  
  // New feature routes
  AI_BID_ANALYSIS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR",
  AI_CONTRACT_ANALYSIS: (role?: string) => isAdminOrManager(role),
  SCHEDULE_OF_VALUES: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER",
  SUBCONTRACTS: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT",

  // Contractor user access (everyone except SUPER_ADMIN)
  DASHBOARD: (role?: string) => hasContractorAccess(role),
  PROJECTS: (role?: string) => hasContractorAccess(role),
  PROJECT_DETAIL: (role?: string) => hasContractorAccess(role),
  CALENDAR: (role?: string) => hasContractorAccess(role),
  TIME_CLOCK: (role?: string) => hasContractorAccess(role),
  MESSAGES: (role?: string) => hasContractorAccess(role),
};

/**
 * Feature permissions for different sections within pages
 */
export const FeaturePermissions = {
  // Dashboard features
  VIEW_BUDGET_METRICS: (role?: string) => hasManagementAccess(role),
  VIEW_FINANCIAL_KPIs: (role?: string) => hasManagementAccess(role),

  // Project features
  CREATE_PROJECT: (role?: string) => hasManagementAccess(role),
  EDIT_PROJECT: (role?: string) => hasManagementAccess(role),
  VIEW_PROJECT_BUDGET: (role?: string) => hasManagementAccess(role),
  VIEW_PROJECT_FINANCIALS: (role?: string) => hasManagementAccess(role),
  CONVERT_BID_TO_PROJECT: (role?: string) => isAdminOrManager(role),

  // Project detail tabs - Financial tabs (restricted from hourly)
  VIEW_BUDGET_TAB: (role?: string) => hasManagementAccess(role),
  VIEW_ESTIMATES_TAB: (role?: string) => hasManagementAccess(role),
  VIEW_PROCUREMENT_TAB: (role?: string) => hasManagementAccess(role),
  VIEW_RECEIPTS_TAB: (role?: string) => hasManagementAccess(role),
  VIEW_TIME_ENTRIES_TAB: (role?: string) => hasManagementAccess(role),
  VIEW_SUBCONTRACTORS_TAB: (role?: string) => hasManagementAccess(role),

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

/**
 * Navigation items configuration for contractors
 */
export interface NavItem {
  href: string;
  label: string;
  testId: string;
  visible: (role?: string) => boolean;
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
      href: "/projects",
      label: "Projects",
      testId: "nav-projects",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/crm",
      label: "CRM",
      testId: "nav-crm",
      visible: (role?: string) => hasManagementAccess(role),
    },
    {
      href: "/calendar",
      label: "Calendar",
      testId: "nav-calendar",
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
      visible: (role?: string) => isAdminOrManager(role),
    },
    {
      href: "/time-entry",
      label: "Time Entries",
      testId: "nav-time-entry",
      visible: (role?: string) => hasManagementAccess(role),
    },
    {
      href: "/tm-daily",
      label: "T&M Daily Sheets",
      testId: "nav-tm-daily",
      visible: (role?: string) => hasManagementAccess(role),
    },
  ],

  aiMenu: [
    {
      href: "/ai-pm",
      label: "AI Project Manager",
      testId: "nav-ai-pm",
      visible: (role?: string) => hasManagementAccess(role),
    },
    {
      href: "/cfo",
      label: "CFO Dashboard",
      testId: "nav-cfo",
      visible: (role?: string) => isAdminOrManager(role),
    },
    {
      href: "/ai-bid-analysis",
      label: "AI Bid Analysis",
      testId: "nav-ai-bid-analysis",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR",
    },
    {
      href: "/ai-contract-analysis",
      label: "AI Contract Analysis",
      testId: "nav-ai-contract-analysis",
      visible: (role?: string) => isAdminOrManager(role),
    },
    {
      href: "/production-rates",
      label: "Production Rates",
      testId: "nav-production-rates",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT",
    },
    {
      href: "/ai-settings",
      label: "AI Settings",
      testId: "nav-ai-settings",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
  ],

  adminMenu: [
    {
      href: "/users",
      label: "Users",
      testId: "nav-users",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/crews",
      label: "Crews & Skills",
      testId: "nav-crews",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/cost-rates",
      label: "Cost Rates",
      testId: "nav-cost-rates",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/subcontractor-payables",
      label: "Subcontractor Payables",
      testId: "nav-subcontractor-payables",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
    {
      href: "/vendor-pricing",
      label: "Vendor Pricing Sync",
      testId: "nav-vendor-pricing",
      visible: (role?: string) => hasManagementAccess(role),
    },
    {
      href: "/scope-settings",
      label: "Scope Settings",
      testId: "nav-scope-settings",
      visible: (role?: string) => isAdminOrManager(role),
    },
    {
      href: "/company-settings",
      label: "Company Settings",
      testId: "nav-company-settings",
      visible: (role?: string) => isOrganizationAdmin(role),
    },
  ],

  toolsMenu: [
    {
      href: "/mobile-sync",
      label: "Mobile Sync Status",
      testId: "nav-mobile-sync",
      visible: (role?: string) => hasContractorAccess(role),
    },
    {
      href: "/equipment",
      label: "Equipment",
      testId: "nav-equipment",
      visible: (role?: string) => hasEquipmentAccess(role),
    },
    {
      href: "/schedule-of-values",
      label: "Schedule of Values",
      testId: "nav-sov",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || role === "OFFICE_MANAGER",
    },
    {
      href: "/subcontracts",
      label: "Subcontracts",
      testId: "nav-subcontracts",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT",
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
