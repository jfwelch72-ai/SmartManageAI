import { eq, sql, and, or, isNull, SQL } from "drizzle-orm";
import { AuthRequest, SanitizedUser } from "./auth";
import { 
  projects, bids, tasks, equipment, timeEntries, crews, 
  crmOrganisations, estimates, timeClockShifts, conversations,
  vendorPricebooks, vendorPricingCatalogs, organizationCalculators,
  organizationWorkTypes, organizationSowItems, aiTakeoffAnalyses,
  projectSchedules, jobsiteAnalysisBatches, aiCoDrafts, mobileDevices,
  clientPortalAccess, users
} from "@shared/schema";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Response } from "express";

/**
 * Check if the user is a SUPER_ADMIN (platform-level admin who can see all organizations)
 */
export function isSuperAdmin(user: SanitizedUser | undefined): boolean {
  return user?.role === "SUPER_ADMIN";
}

/**
 * Get the user's organization ID (null for SUPER_ADMIN or users without org)
 */
export function getUserOrgId(user: SanitizedUser | undefined): string | null {
  if (!user) return null;
  return user.organizationId || null;
}

/**
 * Creates a WHERE condition to filter by organization.
 * - SUPER_ADMIN: No filter (sees all data)
 * - Regular users: Filter by their organizationId
 * 
 * @param user - The authenticated user
 * @param orgColumn - The organization column to filter on (e.g., projects.gcOrganizationId)
 * @returns SQL condition or undefined (no filter needed)
 */
export function getOrgFilter<T extends PgColumn>(
  user: SanitizedUser | undefined,
  orgColumn: T
): SQL | undefined {
  if (!user) return sql`false`; // No user = no access
  
  // SUPER_ADMIN sees all data
  if (isSuperAdmin(user)) {
    return undefined; // No filter needed
  }
  
  const orgId = getUserOrgId(user);
  if (!orgId) {
    // User has no organization - can only see data with null org (unlikely in practice)
    return isNull(orgColumn);
  }
  
  // Filter to user's organization
  return eq(orgColumn, orgId);
}

/**
 * Creates a WHERE condition for entities that link through projects.
 * For tables with projectId that need to check gcOrganizationId on projects.
 * This returns a subquery condition.
 * 
 * Note: For complex joins, it's better to join projects table directly.
 */
export function shouldFilterByOrg(user: SanitizedUser | undefined): boolean {
  if (!user) return true;
  return !isSuperAdmin(user);
}

/**
 * Gets the organization ID to filter by, or null if no filter needed.
 * Returns:
 * - null if SUPER_ADMIN (no filter)
 * - user's orgId if regular user
 * - undefined if user has no org (edge case)
 */
export function getFilterOrgId(user: SanitizedUser | undefined): string | null | undefined {
  if (!user) return undefined;
  if (isSuperAdmin(user)) return null; // null means no filter
  return user.organizationId || undefined;
}

/**
 * Helper to apply organization filter when building queries.
 * Returns the orgId to filter by, or null if no filtering needed (SUPER_ADMIN).
 * 
 * SECURITY: Non-SUPER_ADMIN users without an organization will have:
 * - shouldFilter: true
 * - orgId: null
 * - mustDenyAccess: true (they should be denied access to any org-scoped data)
 */
export function getOrgIdForFilter(req: AuthRequest): { 
  shouldFilter: boolean; 
  orgId: string | null;
  isSuperAdmin: boolean;
  mustDenyAccess: boolean;
} {
  const user = req.user;
  
  if (!user) {
    return { shouldFilter: true, orgId: null, isSuperAdmin: false, mustDenyAccess: true };
  }
  
  if (user.role === "SUPER_ADMIN") {
    return { shouldFilter: false, orgId: null, isSuperAdmin: true, mustDenyAccess: false };
  }
  
  // SECURITY: Non-SUPER_ADMIN users without an organization must be denied access
  // to any organization-scoped data
  if (!user.organizationId) {
    return { 
      shouldFilter: true, 
      orgId: null,
      isSuperAdmin: false,
      mustDenyAccess: true // This user should not see any org-scoped data
    };
  }
  
  return { 
    shouldFilter: true, 
    orgId: user.organizationId,
    isSuperAdmin: false,
    mustDenyAccess: false
  };
}

/**
 * Verifies that a resource belongs to the authenticated user's organization.
 * SUPER_ADMIN bypasses this check. Returns true if access is allowed.
 * If access is denied, sends a 403 response and returns false.
 * 
 * @param req - The authenticated request
 * @param res - Express response (used to send 403 if denied)
 * @param resourceOrgId - The organizationId of the resource being accessed (e.g., project.gcOrganizationId)
 * @returns true if the user can access the resource, false if denied (response already sent)
 */
export function verifyOrgAccess(req: AuthRequest, res: Response, resourceOrgId: string | null | undefined): boolean {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }

  if (isSuperAdmin(user)) return true;

  if (!user.organizationId) {
    res.status(403).json({ error: "No organization access" });
    return false;
  }

  if (!resourceOrgId || resourceOrgId !== user.organizationId) {
    res.status(403).json({ error: "Access denied" });
    return false;
  }

  return true;
}

/**
 * Verifies that a user belongs to the authenticated user's organization.
 * SUPER_ADMIN bypasses this check.
 */
export function verifyUserOrgAccess(req: AuthRequest, res: Response, targetUser: { organizationId: string | null }): boolean {
  return verifyOrgAccess(req, res, targetUser.organizationId);
}
