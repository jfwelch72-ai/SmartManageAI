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

export const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many export requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
});

// Task #1278 — protects POST /api/dot/pay-items/match/feedback against a
// runaway client (or bad actor inside an org) flooding dot_pay_item_match_history
// and skewing the history-aware ranking. The endpoint already accepts up to
// 500 decisions per call, so the per-window cap can stay modest.
export const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => {
    const raw = Number(process.env.DOT_FEEDBACK_RATE_LIMIT_MAX);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60;
  },
  message: { error: "Too many match-feedback requests, please slow down and try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
});
