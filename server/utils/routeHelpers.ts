import { logWarn, logInfo } from "./logger";
import type { Request, Response } from "express";
import type { AuthRequest } from "../auth";

export function getCanonicalBaseUrl(req?: Request): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/+$/, "");
  }

  if (process.env.REPLIT_DEPLOYED_URL) {
    return process.env.REPLIT_DEPLOYED_URL.replace(/\/+$/, "");
  }

  if (process.env.REPLIT_DEPLOYMENT && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }

  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
    return `${proto}://${host}`;
  }

  return "https://localhost:5000";
}

export function isRedirectUriValid(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "";
  } catch {
    logWarn("Non-critical operation failed");
    return false;
  }
}

export function logOAuthRedirectUris(): void {
  const base = getCanonicalBaseUrl();
  logInfo("[OAuth] Resolved base URL:", base);
  logInfo("[OAuth] Gmail redirect URI:", process.env.GOOGLE_REDIRECT_URI ? `${process.env.GOOGLE_REDIRECT_URI} (env)` : `${base}/api/email/oauth/gmail/callback (auto)`);
  logInfo("[OAuth] Outlook redirect URI:", process.env.MICROSOFT_REDIRECT_URI ? `${process.env.MICROSOFT_REDIRECT_URI} (env)` : `${base}/api/email/oauth/outlook/callback (auto)`);
  logInfo("[OAuth] Outlook config:", (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) ? "configured" : "NOT configured");
  logInfo("[OAuth] Google login redirect URI:", `${base}/api/auth/google/callback`);
  logInfo("[OAuth] Google integration redirect URI:", `${base}/api/integrations/connections/:id/callback`);
}

export function getOrgId(req: AuthRequest, res: Response): string | null {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
}

export function getUserOrThrow(req: AuthRequest, res: Response) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user;
}

export interface PaginationResult {
  page: number;
  limit: number;
  offset: number;
}

export function parsePagination(
  req: Request,
  defaults: { page?: number; limit?: number; maxLimit?: number } = {}
): PaginationResult {
  const { page: defaultPage = 1, limit: defaultLimit = 50, maxLimit } = defaults;
  const rawLimit = Math.max(1, parseInt(req.query.limit as string) || defaultLimit);
  const limit = maxLimit ? Math.min(rawLimit, maxLimit) : rawLimit;
  const explicitOffset = req.query.offset as string | undefined;
  if (explicitOffset !== undefined) {
    const offset = Math.max(0, parseInt(explicitOffset) || 0);
    const page = Math.floor(offset / limit) + 1;
    return { page, limit, offset };
  }
  const page = Math.max(1, parseInt(req.query.page as string) || defaultPage);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
