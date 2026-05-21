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
import type { Response, Request } from "express";
import { logAudit } from "./auditLogger";

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
    const targetOrgId = req.query?.organizationId as string
      || req.body?.organizationId as string
      || req.params?.organizationId as string
      || null;
    logAudit({
      userId: user.id,
      entityType: "cross_org_access",
      entityId: targetOrgId || "all_orgs",
      action: "CREATE",
      oldValue: null,
      newValue: JSON.stringify({
        targetOrganizationId: targetOrgId,
        resource: req.originalUrl,
        method: req.method,
        scope: targetOrgId ? "targeted" : "unfiltered",
      }),
    }, req as Request).catch(() => {});
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
export function logSuperAdminCrossOrgAccess(req: AuthRequest, targetOrgId: string | null | undefined, resource?: string): void {
  const user = req.user;
  if (!user || user.role !== "SUPER_ADMIN") return;
  if (!targetOrgId) return;
  if (user.organizationId && user.organizationId === targetOrgId) return;

  logAudit({
    userId: user.id,
    entityType: "cross_org_access",
    entityId: targetOrgId,
    action: "CREATE",
    oldValue: null,
    newValue: JSON.stringify({
      targetOrganizationId: targetOrgId,
      resource: resource || req.originalUrl,
      method: req.method,
    }),
  }, req as Request).catch(() => {});
}

export function verifyOrgAccess(req: AuthRequest, res: Response, resourceOrgId: string | null | undefined): boolean {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }

  if (isSuperAdmin(user)) {
    logSuperAdminCrossOrgAccess(req, resourceOrgId);
    return true;
  }

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

/**
 * Reusable helper for route handlers that operate on a resource by ID.
 * Resolves the org filter context and denies access when appropriate.
 * 
 * Returns { orgId, isSuperAdmin } if access is allowed, or null if denied (response already sent).
 * - SUPER_ADMIN: orgId is null (no org filter needed — skip org-scoped WHERE clauses)
 * - Regular user: orgId is the user's organizationId (use in WHERE clauses)
 * 
 * Usage in a route handler:
 *   const orgCtx = requireOrgOwnership(req as AuthRequest, res);
 *   if (!orgCtx) return;
 *   if (!orgCtx.isSuperAdmin) {
 *     // Add eq(table.organizationId, orgCtx.orgId!) to WHERE clause
 *   }
 */
/**
 * Verifies that a bid belongs to the authenticated user's organization.
 * SUPER_ADMIN bypasses the org check. Returns the bid if accessible, null if not found or denied.
 * Importers should treat null as 404 (bid not found or access denied).
 */
export async function verifyBidOrgAccess(
  bidId: string,
  user: AuthRequest["user"],
): Promise<{ id: string; gcOrganizationId: string | null; [key: string]: unknown } | null> {
  const { db } = await import("./db");
  const { bids } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
  if (!bid) return null;
  if (user!.organizationId && bid.gcOrganizationId !== user!.organizationId) return null;
  return bid as { id: string; gcOrganizationId: string | null; [key: string]: unknown };
}

export function requireOrgOwnership(req: AuthRequest, res: Response): { orgId: string | null; isSuperAdmin: boolean } | null {
  const { shouldFilter, orgId, isSuperAdmin: isSuper, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  if (isSuper) {
    return { orgId: null, isSuperAdmin: true };
  }
  if (shouldFilter && !orgId) {
    res.status(400).json({ error: "Organization required" });
    return null;
  }
  return { orgId: orgId!, isSuperAdmin: false };
}
