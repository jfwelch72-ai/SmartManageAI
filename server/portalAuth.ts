import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { subcontractorPortalTokens } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";

export interface PortalRequest extends Request {
  portalToken?: {
    id: string;
    organizationId: string;
    projectId: string;
    crmOrganisationId: string;
    contactEmail: string;
    contactName: string;
    permissions: string[];
  };
}

export function generatePortalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function hashPortalToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

export async function verifyPortalToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

export async function requirePortalAuth(req: PortalRequest, res: Response, next: NextFunction): Promise<void> {
  const rawToken = (req.query.token as string) || req.headers["x-portal-token"] as string;
  
  if (!rawToken) {
    res.status(401).json({ error: "Portal access token required" });
    return;
  }

  try {
    const activeTokens = await db
      .select()
      .from(subcontractorPortalTokens)
      .where(
        and(
          eq(subcontractorPortalTokens.status, "active"),
          gt(subcontractorPortalTokens.expiresAt, new Date())
        )
      );

    let matchedToken = null;
    for (const t of activeTokens) {
      const isMatch = await bcrypt.compare(rawToken, t.tokenHash);
      if (isMatch) {
        matchedToken = t;
        break;
      }
    }

    if (!matchedToken) {
      res.status(401).json({ error: "Invalid or expired portal access token" });
      return;
    }

    await db
      .update(subcontractorPortalTokens)
      .set({ lastAccessedAt: new Date() })
      .where(eq(subcontractorPortalTokens.id, matchedToken.id));

    req.portalToken = {
      id: matchedToken.id,
      organizationId: matchedToken.organizationId,
      projectId: matchedToken.projectId,
      crmOrganisationId: matchedToken.crmOrganisationId,
      contactEmail: matchedToken.contactEmail,
      contactName: matchedToken.contactName,
      permissions: matchedToken.permissions || ["view"],
    };

    next();
  } catch (error) {
    console.error("Portal auth error:", error);
    res.status(500).json({ error: "Portal authentication failed" });
  }
}

export function requirePortalPermission(permission: string) {
  return (req: PortalRequest, res: Response, next: NextFunction): void => {
    if (!req.portalToken) {
      res.status(401).json({ error: "Portal access required" });
      return;
    }
    if (!req.portalToken.permissions.includes(permission)) {
      res.status(403).json({ error: `Permission '${permission}' is required for this action` });
      return;
    }
    next();
  };
}
