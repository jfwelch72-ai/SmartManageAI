import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";
import { isDevSeedEnabled } from "./utils/devSeedFlag";

const CSRF_HEADER = "x-csrf-token";
const CSRF_COOKIE = "csrf_token";
const TOKEN_LENGTH = 32;

function generateCsrfToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString("hex");
}

export function setCsrfToken(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies[CSRF_COOKIE]) {
    const token = generateCsrfToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  next();
}

export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  const exempt = [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/stripe/webhook",
  ];
  if (
    exempt.includes(req.path) ||
    req.path.startsWith("/api/webhooks") ||
    (req.path.startsWith("/api/dev/") && isDevSeedEnabled()) ||
    req.path.startsWith("/api/auth/google") ||
    req.path.startsWith("/api/auth/apple") ||
    req.path.startsWith("/api/auth/passkey") ||
    req.path.startsWith("/api/email/oauth") ||
    req.path.startsWith("/api/integrations/connections") ||
    req.path.startsWith("/api/portal/auth") ||
    req.path.startsWith("/api/public/") ||
    req.path.startsWith("/api/v1/public/") ||
    (method === "PUT" && /^\/api\/objects\/multipart\/[^/]+\/\d+\/upload/.test(req.path))
  ) {
    return next();
  }

  const cookieToken = req.cookies[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ error: "Invalid or missing CSRF token" });
    return;
  }

  next();
}
