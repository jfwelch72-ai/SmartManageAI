/**
 * Role-Based Access Control (RBAC) Utilities
 * 
 * This module defines permission checks for different user roles in the TFR Construction Management Platform.
 * 
 * Role Hierarchy:
 * - ADMIN: Full access to everything including user management
 * - MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER: Full access except user management
 * - HOURLY_EMPLOYEE: Limited access to active projects, daily notes, calendar, time clock (no finances/budgets)
 */

export type UserRole = "ADMIN" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "OFFICE_MANAGER" | "HOURLY_EMPLOYEE";

/**
 * Check if user is an admin
 */
export function isAdmin(role?: string): boolean {
  return role === "ADMIN";
}

/**
 * Check if user is admin or manager
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
 * Check if user has management-level access (not hourly employee)
 */
export function hasManagementAccess(role?: string): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "SUPERINTENDENT" || 
         role === "ESTIMATOR" || role === "OFFICE_MANAGER";
}

/**
 * Route access permissions
 */
export const RoutePermissions = {
  // Admin-only routes
  USERS: (role?: string) => isAdmin(role),
  AI_SETTINGS: (role?: string) => isAdmin(role),
  COST_RATES: (role?: string) => isAdmin(role),
  CREWS: (role?: string) => isAdmin(role),
  SUBCONTRACTOR_PAYABLES: (role?: string) => isAdmin(role),

  // Management routes (blocked for hourly employees)
  BIDS: (role?: string) => hasManagementAccess(role),
  BID_DETAIL: (role?: string) => hasManagementAccess(role),
  TIME_ENTRY: (role?: string) => hasManagementAccess(role),
  TIME_CLOCK_MANAGER: (role?: string) => isAdminOrManager(role),
  AI_PM: (role?: string) => hasManagementAccess(role),
  CFO: (role?: string) => isAdminOrManager(role),
  TM_DAILY: (role?: string) => hasManagementAccess(role),
  PRODUCTION_RATES: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT",

  // Everyone has access
  DASHBOARD: () => true,
  PROJECTS: () => true,
  PROJECT_DETAIL: () => true,
  CALENDAR: () => true,
  TIME_CLOCK: () => true,
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

  // Always accessible tabs for all users (including hourly employees)
  VIEW_OVERVIEW_TAB: () => true,
  VIEW_SCOPE_TAB: () => true,
  VIEW_CHANGE_ORDERS_TAB: () => true,
  VIEW_TAKEOFF_TAB: () => true,
  VIEW_DOCUMENTS_TAB: () => true,
  VIEW_MEDIA_TAB: () => true,
  VIEW_DAILY_NOTES_TAB: () => true,

  // User management
  MANAGE_USERS: (role?: string) => isAdmin(role),
};

/**
 * Get allowed project statuses for viewing based on role
 */
export function getAllowedProjectStatuses(role?: string): string[] {
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
 * Navigation items configuration
 */
export interface NavItem {
  href: string;
  label: string;
  testId: string;
  visible: (role?: string) => boolean;
}

export const NavigationConfig = {
  mainNav: [
    {
      href: "/dashboard",
      label: "Dashboard",
      testId: "nav-dashboard",
      visible: () => true,
    },
    {
      href: "/projects",
      label: "Projects",
      testId: "nav-projects",
      visible: () => true,
    },
    {
      href: "/calendar",
      label: "Calendar",
      testId: "nav-calendar",
      visible: () => true,
    },
  ],
  
  timeClockMenu: [
    {
      href: "/time-clock",
      label: "My Time Clock",
      testId: "nav-my-time-clock",
      visible: () => true,
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
      href: "/production-rates",
      label: "Production Rates",
      testId: "nav-production-rates",
      visible: (role?: string) => role === "ADMIN" || role === "MANAGER" || role === "ESTIMATOR" || role === "SUPERINTENDENT",
    },
    {
      href: "/ai-settings",
      label: "AI Settings",
      testId: "nav-ai-settings",
      visible: (role?: string) => isAdmin(role),
    },
  ],

  adminMenu: [
    {
      href: "/users",
      label: "Users",
      testId: "nav-users",
      visible: (role?: string) => isAdmin(role),
    },
    {
      href: "/crews",
      label: "Crews & Skills",
      testId: "nav-crews",
      visible: (role?: string) => isAdmin(role),
    },
    {
      href: "/cost-rates",
      label: "Cost Rates",
      testId: "nav-cost-rates",
      visible: (role?: string) => isAdmin(role),
    },
    {
      href: "/subcontractor-payables",
      label: "Subcontractor Payables",
      testId: "nav-subcontractor-payables",
      visible: (role?: string) => isAdmin(role),
    },
  ],
};
