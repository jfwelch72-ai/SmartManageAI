import type { Request, Response, NextFunction } from "express";
import { authenticateApiKey, hasScope, logApiRequest } from "./apiKeyService";
import { verifyPublicApiToken } from "./oauthRoutes";
import { db } from "../db";
import { integrationApiKeys } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { IntegrationApiKey, PublicApiScope } from "@shared/schema";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: IntegrationApiKey;
      orgId?: string;
    }
  }
}

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(keyId: string, perMinute: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(keyId);
  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + 60_000;
    buckets.set(keyId, { count: 1, resetAt });
    return { allowed: true, remaining: perMinute - 1, resetAt };
  }
  bucket.count += 1;
  if (bucket.count > perMinute) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  return { allowed: true, remaining: perMinute - bucket.count, resetAt: bucket.resetAt };
}

export function publicApiAuth(requiredScope?: PublicApiScope) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const auth = req.header("authorization") || "";
    const headerKey = req.header("x-api-key") || "";
    let raw = headerKey;
    if (!raw && auth.toLowerCase().startsWith("bearer ")) {
      raw = auth.slice(7).trim();
    }
    if (!raw) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="public-api"');
      return res.status(401).json({ error: "Missing API key", code: "missing_credentials" });
    }

    let key: IntegrationApiKey | null = null;
    // Try OAuth bearer JWT (issued by /api/v1/public/oauth/token) first when token doesn't look like a raw key.
    if (!raw.startsWith("ckp_")) {
      const claims = verifyPublicApiToken(raw);
      if (claims) {
        const [row] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, claims.sub)).limit(1);
        if (row && row.isActive && (!row.expiresAt || row.expiresAt > new Date())) {
          // Effective scopes are intersection of token scopes and current key scopes.
          const grantedScopes = (row.scopes as string[]) || [];
          const tokenScopes = claims.scopes.filter(s => grantedScopes.includes(s));
          key = { ...row, scopes: tokenScopes } as IntegrationApiKey;
        }
      }
    }
    if (!key) {
      key = await authenticateApiKey(raw);
    }
    if (!key) {
      return res.status(401).json({ error: "Invalid or expired credentials", code: "invalid_credentials" });
    }
    if (requiredScope && !hasScope(key, requiredScope)) {
      await logApiRequest({
        orgId: key.organizationId,
        apiKeyId: key.id,
        method: req.method,
        path: req.path,
        statusCode: 403,
        scopeUsed: requiredScope,
        errorMessage: "missing_scope",
        ip: req.ip,
      });
      return res.status(403).json({ error: `Missing required scope: ${requiredScope}`, code: "insufficient_scope" });
    }
    const rl = rateLimit(key.id, key.rateLimitPerMinute);
    res.setHeader("X-RateLimit-Limit", String(key.rateLimitPerMinute));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
    if (!rl.allowed) {
      await logApiRequest({
        orgId: key.organizationId,
        apiKeyId: key.id,
        method: req.method,
        path: req.path,
        statusCode: 429,
        errorMessage: "rate_limited",
        scopeUsed: requiredScope,
        ip: req.ip,
      });
      return res.status(429).json({ error: "Rate limit exceeded", code: "rate_limited" });
    }
    req.apiKey = key;
    req.orgId = key.organizationId;
    res.on("finish", () => {
      void logApiRequest({
        orgId: key.organizationId,
        apiKeyId: key.id,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        scopeUsed: requiredScope,
        ip: req.ip,
      });
    });
    next();
  };
}

export function publicApiError(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err?.status || 500;
  res.status(status).json({
    error: err?.message || "Internal server error",
    code: err?.code || "internal_error",
  });
}
