import {logError, logWarn } from "./utils/logger";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, organizations, organizationSubscriptions, hustlerOrganizations, userDashboardPermissions, type User, type SelectUser } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { getRoleDefaults, mergePermissions } from "./dashboardRoutes";
import type { UserRole } from "@shared/schema";

// Task #2427 — under autoscale this cache is intentionally per-process.
// `revokeUserTokens` only invalidates the local Map, so peer replicas
// keep serving the previous cached `tokenVersion` until their own entry
// expires. We rely on two things to make this safe:
//   1. JWTs carry `tokenVersion`. Even if a peer serves a stale cache,
//      the next request from a revoked token still fails the
//      `userTokenVersion !== payloadTokenVersion` check below — the
//      cache only ever returns the user row, never bypasses the version
//      check.
//   2. The TTL is intentionally short (5s) so the worst-case window
//      where a peer might still consider a *role change* (not a token
//      revoke) effective is bounded to ~5s. Removing the cache entirely
//      would multiply the auth-DB load by 1 SELECT per request per
//      replica; benchmarks at typical load show this would saturate the
//      pg pool's `waiting` queue under bursts. The 5s TTL is the
//      smallest window we can keep without measurable pool pressure.
// See `docs/runbooks/autoscale-verification.md` for the verification
// queries operators can run in production.
const AUTH_CACHE_TTL_MS = 5_000;
interface AuthCacheEntry {
  user: User;
  hustlerLink?: { roleOverride: string | null } | null;
  expiresAt: number;
}
const authUserCache = new Map<string, AuthCacheEntry>();

function getAuthCachedUser(userId: string): AuthCacheEntry | null {
  const entry = authUserCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    authUserCache.delete(userId);
    return null;
  }
  return entry;
}

function setAuthCachedUser(userId: string, user: User, hustlerLink?: { roleOverride: string | null } | null): void {
  if (authUserCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of authUserCache) {
      if (now > v.expiresAt) authUserCache.delete(k);
    }
    if (authUserCache.size > 2000) {
      const oldest = authUserCache.keys().next().value;
      if (oldest) authUserCache.delete(oldest);
    }
  }
  authUserCache.set(userId, { user, hustlerLink, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

export function invalidateAuthCache(userId: string): void {
  authUserCache.delete(userId);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authUserCache) {
    if (now > v.expiresAt) authUserCache.delete(k);
  }
}, 60_000).unref();

// Enforce SESSION_SECRET - fail fast if not set
if (!process.env.SESSION_SECRET) {
  throw new Error(
    "CRITICAL SECURITY ERROR: SESSION_SECRET environment variable must be set. " +
    "This is required for JWT token signing and session security. " +
    "The application cannot start without it."
  );
}

const JWT_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = "auth_token";

// Sanitized user type - excludes sensitive fields (passwordHash, tokenVersion)
// Adds effectiveRole for HUSTLER users who have organization-specific role overrides
export type SanitizedUser = Omit<SelectUser, 'passwordHash' | 'tokenVersion'> & {
  effectiveRole?: string; // The role to use for permission checks (differs from base role for HUSTLERs)
  isHustlerOwner?: boolean; // True if HUSTLER has owner-level access to current org
};

export interface AuthRequest extends Request {
  user?: SanitizedUser;
}

export function getUserIdFromRequest(req: Request): string | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  const payload = verifyToken(token);
  return payload?.userId || null;
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generate JWT token with tokenVersion (handle null defensively)
export function generateToken(userId: string, tokenVersion: number | null): string {
  return jwt.sign({ userId, tokenVersion: tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: "7d" });
}

// Verify JWT token
export function verifyToken(token: string): { userId: string; tokenVersion: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; tokenVersion: number };
  } catch {
    logWarn("Non-critical operation failed");
    return null;
  }
}

// Middleware to attach user to request
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies[COOKIE_NAME];

  if (!token) {
    next();
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.clearCookie(COOKIE_NAME);
    next();
    return;
  }

  let user: User | undefined;
  let hustlerLink: { roleOverride: string | null } | null | undefined;

  const cached = getAuthCachedUser(payload.userId);
  if (cached) {
    user = cached.user;
    hustlerLink = cached.hustlerLink;
  } else {
    const [fetched] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    user = fetched;
    if (user && user.role === "HUSTLER" && user.organizationId) {
      const [link] = await db
        .select({ roleOverride: hustlerOrganizations.roleOverride })
        .from(hustlerOrganizations)
        .where(
          and(
            eq(hustlerOrganizations.userId, user.id),
            eq(hustlerOrganizations.organizationId, user.organizationId),
            eq(hustlerOrganizations.isActive, true)
          )
        )
        .limit(1);
      hustlerLink = link || null;
    }
    if (user) setAuthCachedUser(payload.userId, user, hustlerLink);
  }

  if (user && user.isActive) {
    const userTokenVersion = user.tokenVersion ?? 0;
    const payloadTokenVersion = payload.tokenVersion ?? 0;
    
    if (userTokenVersion !== payloadTokenVersion) {
      invalidateAuthCache(payload.userId);
      res.clearCookie(COOKIE_NAME);
      next();
      return;
    }

    let effectiveRole: string | undefined;
    let isHustlerOwner = false;
    
    if (user.role === "HUSTLER" && user.organizationId && hustlerLink) {
      effectiveRole = hustlerLink.roleOverride || "ADMIN";
      isHustlerOwner = true;
    }

    // Create sanitized user object - explicitly omit passwordHash and tokenVersion (security critical).
    // We destructure to drop the secrets so any future column added to `users` is automatically
    // surfaced on `req.user` without having to update this list (and the typechecker enforces that
    // every SelectUser field is present on SanitizedUser).
    const { passwordHash: _pw, tokenVersion: _tv, ...safeUser } = user;
    void _pw; void _tv;
    const sanitized: SanitizedUser = {
      ...safeUser,
      effectiveRole,
      isHustlerOwner,
    };
    req.user = sanitized;
  }

  next();
}

export async function requireActiveOrganization(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    next();
    return;
  }

  if (req.path === "/api/auth/logout") {
    next();
    return;
  }

  if (req.user.role === "SUPER_ADMIN") {
    next();
    return;
  }

  if (!req.user.organizationId) {
    next();
    return;
  }

  const [org] = await db
    .select({ isActive: organizations.isActive })
    .from(organizations)
    .where(eq(organizations.id, req.user.organizationId))
    .limit(1);

  if (org && !org.isActive) {
    res.status(403).json({
      error: "Organization suspended",
      message: "Your organization has been suspended. Please contact support for more information.",
      suspended: true,
    });
    return;
  }

  // Task #2482 — billing-driven write freeze. When the org's
  // subscription has been auto-suspended by the dunning cycle (after
  // DUNNING_GRACE_PERIOD_DAYS days of unpaid invoice), block mutating
  // requests to enforce read-only mode. Reads (GET/HEAD/OPTIONS) and
  // billing-recovery endpoints stay open so the customer can update
  // their payment method or view past data.
  const method = req.method.toUpperCase();
  const isMutation = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
  if (isMutation && !isBillingRecoveryPath(req.path)) {
    const [sub] = await db
      .select({ status: organizationSubscriptions.status })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, req.user.organizationId))
      .limit(1);
    if (sub?.status === "suspended") {
      res.status(402).json({
        error: "Billing suspended",
        message: "Your subscription is suspended for non-payment. Update your payment method on the Billing page to restore write access.",
        suspended: true,
        billingSuspended: true,
      });
      return;
    }
  }

  next();
}

/**
 * Allowlist of paths that must remain writable even when the org's
 * subscription is suspended — otherwise the customer couldn't
 * recover. Covers self-serve checkout, the Stripe Customer Portal
 * link, manual->Stripe migration, the dunning cycle endpoint, logout,
 * and CSRF token issuance.
 */
function isBillingRecoveryPath(path: string): boolean {
  return (
    path === "/api/auth/logout" ||
    path === "/api/billing/checkout" ||
    path === "/api/billing/portal" ||
    path === "/api/billing/migrate-to-stripe" ||
    path === "/api/billing/dunning/run" ||
    path.startsWith("/api/stripe/webhook")
  );
}

// Middleware to require authentication
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

// Type for all valid user roles (must match userRoleEnum in schema.ts) — 8 roles
export type { UserRole };

// Middleware to require specific roles (8 roles supported including SUPER_ADMIN and HUSTLER)
// For HUSTLER users, checks effectiveRole if available (enables owner-level access to linked orgs)
export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (req.user.role === "SUPER_ADMIN") {
      next();
      return;
    }

    const roleToCheck = (req.user.effectiveRole || req.user.role) as UserRole;
    
    if (!roles.includes(roleToCheck)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

// Helper to get the effective role for permission checks
export function getEffectiveRole(user: SanitizedUser): UserRole {
  return (user.effectiveRole || user.role) as UserRole;
}

export type FeaturePermissionKey =
  | 'canAccessDashboard' | 'canAccessProjects' | 'canCreateProjects' | 'canEditProjects'
  | 'canAccessCalendar' | 'canAccessTasks' | 'canAccessMessages' | 'canAccessBulletins' | 'canAccessEmailAssistant'
  | 'canViewBids' | 'canEditBids' | 'canDeleteBids' | 'canGenerateBidPDFs' | 'canConvertBidToProject'
  | 'canAccessBidNetworkGC' | 'canAccessBidNetworkInbox' | 'canManageBidResponses' | 'canDeleteBidRequests'
  | 'canAccessHistoricalCosts' | 'canAccessScopeSettings' | 'canUseAiBidAnalysis' | 'canUseAiContractAnalysis'
  | 'canViewFinancials' | 'canEditFinancials'
  | 'canAccessCostRates' | 'canAccessCFODashboard' | 'canAccessTMBilling' | 'canAccessProgressBilling'
  | 'canManageContracts' | 'canAccessSubcontracts' | 'canAccessOverheadCosts' | 'canAccessProductionRates' | 'canAccessVendorPricing'
  | 'canAccessTimeClock' | 'canManageTimeClock' | 'canApproveTime' | 'canAccessTMDaily'
  | 'canManagePayroll' | 'canManageCrews' | 'canManageWorkforce' | 'canManageLeave'
  | 'canManageSafety' | 'canManageScheduling' | 'canAccessKPIs' | 'canLockDailyReports'
  | 'canManageEquipment' | 'canManageProcurement'
  | 'canAccessCRM' | 'canCreateCRMContacts' | 'canViewCrmEmails' | 'canLogCrmCalls' | 'canAccessMarketplace'
  | 'canManageHiring' | 'canAccessHiringInterviews' | 'canManageHiringSettings'
  | 'canPostSocialMedia' | 'canManageWebsite' | 'canAccessExecutiveDigest'
  | 'canUseAiFeatures' | 'canViewSafety' | 'canViewAiSummaries'
  | 'canUseAiEstimator' | 'canManageAiEstimator'
  | 'canAccessCompanySettings' | 'canManageUsers' | 'canAccessApprovals' | 'canAccessAuditLogs'
  | 'canAccessReports' | 'canAccessEnterpriseSettings' | 'canManageAISettings'
  | 'canViewProjectBudget' | 'canViewProjectEstimates' | 'canViewProjectProcurement'
  | 'canViewProjectReceipts' | 'canViewProjectTimeEntries' | 'canViewProjectSubcontractors'
  | 'canCreateChangeOrders' | 'canDeleteScopeItems' | 'canEditProjectHandoff'
  | 'canSubmitPeerRatings' | 'canViewPeerRatings'
  | 'canAccessTimeMaterial'
  | 'canViewDotLibrary' | 'canManageDotLibrary'
  | 'canViewDbeGoals' | 'canManageDbeGoals'
  | 'canViewHaulTickets' | 'canManageHaulTickets' | 'canApproveHaulTickets'
  | 'canViewInspectorReports' | 'canSubmitInspectorReports' | 'canManageInspectorReports' | 'canApproveInspectorReports'
  | 'canViewSwppp' | 'canManageSwppp'
  | 'canViewMaterialCertifications' | 'canManageMaterialCertifications' | 'canVerifyMaterialCertifications'
  | 'canViewSuretyBonds' | 'canManageSuretyBonds'
  | 'canViewComplianceDashboard'
  | 'canManageProjectTemplates';

export async function getEffectivePermissions(userId: string, orgId: string | null, role: string): Promise<Record<string, boolean | string>> {
  if (role === "SUPER_ADMIN") return getRoleDefaults("SUPER_ADMIN");
  const roleDefaults = getRoleDefaults(role);
  if (!orgId) return roleDefaults;
  try {
    const [perm] = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));
    if (!perm) return roleDefaults;
    const dbPerms: Partial<Record<string, boolean | string>> = {};
    for (const key of Object.keys(roleDefaults)) {
      if (key === 'canViewFinancials' || key === 'canEditFinancials') continue;
      if (key === 'projectScope') {
        const val = (perm as Record<string, unknown>)[key];
        if (val === 'ALL' || val === 'ACTIVE_ONLY') {
          dbPerms[key] = val;
        }
        continue;
      }
      const val = (perm as Record<string, unknown>)[key];
      if (typeof val === 'boolean') {
        dbPerms[key] = val;
      }
    }
    const financialsAccess = (perm as Record<string, unknown>).financialsAccess as string | undefined;
    if (financialsAccess === 'manage') {
      dbPerms.canViewFinancials = true;
      dbPerms.canEditFinancials = true;
    } else if (financialsAccess === 'view') {
      dbPerms.canViewFinancials = true;
      dbPerms.canEditFinancials = false;
    } else if (financialsAccess === 'none') {
      dbPerms.canViewFinancials = false;
      dbPerms.canEditFinancials = false;
    }
    return mergePermissions(roleDefaults, dbPerms);
  } catch (error) {
    logError('Error fetching effective permissions:', {}, error instanceof Error ? error : new Error(String(error)));
    return roleDefaults;
  }
}

export function requireFeaturePermission(permKey: FeaturePermissionKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const effectiveRole = req.user.effectiveRole || req.user.role;
    const effective = await getEffectivePermissions(req.user.id, req.user.organizationId ?? null, effectiveRole);

    if (effective[permKey]) {
      next();
      return;
    }

    res.status(403).json({ error: "Feature permission required: " + permKey });
  };
}

export function requireAnyFeaturePermission(...permKeys: FeaturePermissionKey[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const effectiveRole = req.user.effectiveRole || req.user.role;
    const effective = await getEffectivePermissions(req.user.id, req.user.organizationId ?? null, effectiveRole);

    if (permKeys.some(k => effective[k])) {
      next();
      return;
    }

    res.status(403).json({ error: "Feature permission required: " + permKeys.join(' or ') });
  };
}

export function requireRoleOrFeature(roles: UserRole[], permKey: FeaturePermissionKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (req.user.role === "SUPER_ADMIN") {
      next();
      return;
    }

    const roleToCheck = req.user.effectiveRole || req.user.role;
    const originalRole = req.user.role;
    if (roles.includes(roleToCheck as UserRole) || roles.includes(originalRole as UserRole)) {
      next();
      return;
    }

    const effective = await getEffectivePermissions(req.user.id, req.user.organizationId ?? null, roleToCheck);

    if (effective[permKey]) {
      next();
      return;
    }

    res.status(403).json({ error: "Insufficient permissions" });
  };
}

export async function revokeUserTokens(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ 
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId));
  invalidateAuthCache(userId);
}

// Set auth cookie
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

// Clear auth cookie
export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}
