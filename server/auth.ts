import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, hustlerOrganizations, userDashboardPermissions, type User, type SelectUser } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { getRoleDefaults, mergePermissions } from "./dashboardLayoutRoutes";

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

  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  
  if (user && user.isActive) {
    // Check tokenVersion - reject if it doesn't match (token revocation)
    // Handle null tokenVersion defensively (legacy users) by treating null as 0
    const userTokenVersion = user.tokenVersion ?? 0;
    const payloadTokenVersion = payload.tokenVersion ?? 0;
    
    if (userTokenVersion !== payloadTokenVersion) {
      res.clearCookie(COOKIE_NAME);
      next();
      return;
    }

    // Determine effective role for HUSTLER users
    // HUSTLERs are owners of their linked organizations and get ADMIN-level access by default
    let effectiveRole: string | undefined;
    let isHustlerOwner = false;
    
    if (user.role === "HUSTLER" && user.organizationId) {
      const [link] = await db
        .select()
        .from(hustlerOrganizations)
        .where(
          and(
            eq(hustlerOrganizations.userId, user.id),
            eq(hustlerOrganizations.organizationId, user.organizationId),
            eq(hustlerOrganizations.isActive, true)
          )
        )
        .limit(1);
      
      if (link) {
        // HUSTLER is the OWNER of linked organizations
        // roleOverride allows specific role assignment, but defaults to ADMIN (owner-level)
        effectiveRole = link.roleOverride || "ADMIN";
        isHustlerOwner = true;
      }
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
      walkthroughCompleted: user.walkthroughCompleted,
      walkthroughStep: user.walkthroughStep,
      walkthroughStartedAt: user.walkthroughStartedAt,
      effectiveRole,
      isHustlerOwner,
    };
    req.user = sanitized;
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

// Type for all valid user roles (must match userRoleEnum in schema.ts)
export type UserRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "OFFICE_MANAGER" | "HOURLY_EMPLOYEE" | "MAINTENANCE_MANAGER" | "VENDOR" | "HUSTLER" | "SALES" | "MARKETING" | "SAFETY_MANAGER" | "HR_MANAGER" | "EQUIPMENT_MANAGER" | "PROJECT_ENGINEER" | "PROCUREMENT_MANAGER" | "DISPATCHER";

// Middleware to require specific roles (all 18 roles supported including SUPER_ADMIN and HUSTLER)
// For HUSTLER users, checks effectiveRole if available (enables owner-level access to linked orgs)
export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // For HUSTLER users, use effectiveRole if set (owner-level access to linked organizations)
    const roleToCheck = req.user.effectiveRole || req.user.role;
    const originalRole = req.user.role;
    
    // Check if either the effective role OR the original role matches
    // This allows HUSTLER users to access HUSTLER endpoints even when their effectiveRole is ADMIN
    if (!roles.includes(roleToCheck as UserRole) && !roles.includes(originalRole as UserRole)) {
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

export type FeaturePermissionKey = 'canAccessFinancials' | 'canManagePayroll' | 'canAccessReports' | 'canUseAiFeatures' | 'canPostSocialMedia' | 'canManageWebsite' | 'canManageEquipment' | 'canManageProcurement';

export function requireFeaturePermission(permKey: FeaturePermissionKey) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const effectiveRole = req.user.effectiveRole || req.user.role;

    if (effectiveRole === 'ADMIN' || effectiveRole === 'SUPER_ADMIN') {
      next();
      return;
    }

    const roleDefaults = getRoleDefaults(effectiveRole);
    if (roleDefaults[permKey]) {
      next();
      return;
    }

    const orgId = req.user.organizationId;
    if (orgId) {
      try {
        const [perm] = await db.select().from(userDashboardPermissions)
          .where(and(
            eq(userDashboardPermissions.organizationId, orgId),
            eq(userDashboardPermissions.userId, req.user.id)
          ));

        if (perm && perm[permKey]) {
          next();
          return;
        }
      } catch (error) {
        console.error('Error checking feature permission:', error);
      }
    }

    res.status(403).json({ error: "Feature permission required: " + permKey });
  };
}

// Helper function to increment tokenVersion (revokes all existing tokens)
export async function revokeUserTokens(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ 
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId));
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
