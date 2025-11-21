import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, type User, type SelectUser } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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
export type SanitizedUser = Omit<SelectUser, 'passwordHash' | 'tokenVersion'>;

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
      costRateRegular: user.costRateRegular,
      costRateOvertime: user.costRateOvertime,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
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

// Middleware to require specific roles (all 6 roles supported)
export function requireRole(...roles: Array<"ADMIN" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "OFFICE_MANAGER" | "HOURLY_EMPLOYEE">) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    if (!roles.includes(req.user.role as any)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
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
