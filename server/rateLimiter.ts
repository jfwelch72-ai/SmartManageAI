import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { getUserIdFromRequest } from "./auth";

function normalizeIp(req: Request): string {
  const ip = req.ip || "unknown";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function getUserKeyOrIp(req: Request): string {
  const userId = getUserIdFromRequest(req);
  if (userId) return `user:${userId}`;
  return normalizeIp(req);
}

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
});
