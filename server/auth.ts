import {logError, logWarn } from "./utils/logger";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, organizations, hustlerOrganizations, userDashboardPermissions, type User, type SelectUser } from "@shared/schema";
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

    // Create sanitized user object - explicitly omit passwordHash and tokenVersion (security critical)
    // TypeScript enforces at compile time that only allowed fields are included
    const sanitized: SanitizedUser = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      costRateRegular: user.costRateRegular,
      costRateOvertime: user.costRateOvertime,
      organizationId: user.organizationId,
      birthdate: user.birthdate,
      timezone: user.timezone,
      profileDescription: user.profileDescription,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roleLabel: user.roleLabel,
      walkthroughCompleted: user.walkthroughCompleted,
      walkthroughStep: user.walkthroughStep,
      walkthroughStartedAt: user.walkthroughStartedAt,
      receivesJobMetricAlertEmails: user.receivesJobMetricAlertEmails,
      jobMetricAlertQuietHoursEnabled: user.jobMetricAlertQuietHoursEnabled,
      jobMetricAlertQuietHoursStart: user.jobMetricAlertQuietHoursStart,
      jobMetricAlertQuietHoursEnd: user.jobMetricAlertQuietHoursEnd,
      jobMetricAlertQuietHoursTimezone: user.jobMetricAlertQuietHoursTimezone,
      jobMetricAlertQuietHoursWeekdays: user.jobMetricAlertQuietHoursWeekdays,
      jobMetricAlertQuietHoursDigestEnabled: user.jobMetricAlertQuietHoursDigestEnabled,
      jobMetricAlertQuietHoursLastDigestAt: user.jobMetricAlertQuietHoursLastDigestAt,
      jobMetricAlertQuietHoursDigestFormat: user.jobMetricAlertQuietHoursDigestFormat,
      jobMetricAlertQuietHoursDigestCsvEnabled: user.jobMetricAlertQuietHoursDigestCsvEnabled,
      jobMetricAlertQuietHoursDigestMaxEvents: user.jobMetricAlertQuietHoursDigestMaxEvents,
      // Task #797 — locale + 12h/24h + weekday prefs for the digest
      // timestamps. Surfaced to the client so the in-app preview and
      // the Notification Preferences UI both see the persisted values.
      jobMetricAlertQuietHoursDigestLocale: user.jobMetricAlertQuietHoursDigestLocale,
      jobMetricAlertQuietHoursDigestTimeFormat: user.jobMetricAlertQuietHoursDigestTimeFormat,
      jobMetricAlertQuietHoursDigestShowWeekday: user.jobMetricAlertQuietHoursDigestShowWeekday,
      // Task #1021 — per-admin delivery prefs for the CRM transcript backfill
      // completion summary. Surfaced to the client so Notification Preferences
      // can render the saved channel + failure-only filter.
      crmBackfillSummaryChannel: user.crmBackfillSummaryChannel,
      crmBackfillSummaryOnFailureOnly: user.crmBackfillSummaryOnFailureOnly,
      // Task #1066 — per-admin mute knobs for the alert delivery failure
      // fallback emails (Task #1051). Surfaced so Notification Preferences
      // can render the persisted toggle and per-channel mutes.
      crmAlertFailureFallbackEnabled: user.crmAlertFailureFallbackEnabled,
      crmAlertFailureFallbackMutedChannels: user.crmAlertFailureFallbackMutedChannels,
      // Task #1076 — per-admin opt-in for the two streams of CRM
      // transcript-backfill alert delivery failure emails. Surfaced so
      // Notification Preferences can render the persisted value after a
      // /api/auth/me refetch (PATCH /api/auth/profile already returns
      // it, but the middleware-cached `req.user` was missing it).
      alertFailureEmailMode: user.alertFailureEmailMode,
      // Task #1414 — per-admin opt-out for the
      // INTEGRATION_SYNC_RETRIES_EXHAUSTED transactional email so the
      // settings toggle reflects the saved state across reloads.
      integrationSyncExhaustedEmailOptOut: user.integrationSyncExhaustedEmailOptOut,
      // Task #1695 — per-user Plans-surface preferences (labeled toolbar
      // toggle + plans-tour dismissal marker). Promoted from per-user
      // localStorage keys so the settings hydrate from the server on
      // every device the user signs in on.
      plansToolbarLabeled: user.plansToolbarLabeled,
      plansTourCompleted: user.plansTourCompleted,
      // Task #1720 — per-user CRM owner-filter selections promoted
      // from per-user-id localStorage so the "Show only my orgs /
      // contacts" picks travel with the user across devices. Same
      // hydrate/persist contract as the Plans-surface preferences
      // above; NULL means "no preference saved yet" and the client
      // falls back to its default ("all").
      crmContactOwnerFilter: user.crmContactOwnerFilter,
      crmOrgOwnerFilter: user.crmOrgOwnerFilter,
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

  next();
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
