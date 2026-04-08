import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { AuthRequest } from "./auth";

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

  if (req.path === "/api/auth/login" || req.path === "/api/auth/register" || req.path === "/api/auth/forgot-password" || req.path === "/api/auth/reset-password" || req.path.startsWith("/api/webhooks") || req.path === "/api/stripe/webhook") {
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
