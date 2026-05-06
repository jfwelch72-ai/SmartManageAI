import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { getUserIdFromRequest } from "./auth";
import { isDevSeedEnabled } from "./utils/devSeedFlag";
import { PgExpressRateLimitStore } from "./utils/expressRateLimitPgStore";

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

// In dev / test environments (the same gate that exposes /api/dev/test-login)
// the global apiLimiter would otherwise stop chatty e2e suites mid-run when
// the same server instance is reused across multiple Playwright invocations
// (see playwright.config.ts `reuseExistingServer: !process.env.CI`). The
// limiter is a production DDoS protection — not business logic — so skipping
// it in dev matches the existing dev-only bypasses for CSRF and the dev
// route surface. Per-endpoint limiters (sensitive/auth/export/feedback)
// remain in force so any test that asserts limiter behavior still works.
const skipInDevSeed = () => isDevSeedEnabled();

// Task #2427 — every limiter writes through a shared Postgres-backed
// `Store` keyed on `rate_limit_state` so the per-window quotas hold
// across all replicas in the autoscale deployment, not just within a
// single Node process. Each limiter gets its own prefix so the buckets
// stay logically isolated and one limiter's reset doesn't wipe another.
// In dev / unit-test runs the env flag `RATE_LIMIT_USE_MEMORY_STORE=1`
// falls back to the default in-memory store so test suites that don't
// stand up Postgres (or that import the module twice via vi.resetModules
// — see `server/__tests__/multi-instance/`) still get deterministic
// behaviour.
function makeStore(prefix: string) {
  if (process.env.RATE_LIMIT_USE_MEMORY_STORE === "1") return undefined;
  return new PgExpressRateLimitStore(prefix);
}

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  store: makeStore("auth"),
});

export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
  store: makeStore("sensitive"),
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
  skip: skipInDevSeed,
  store: makeStore("api"),
});

export const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many export requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getUserKeyOrIp,
  store: makeStore("export"),
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
  store: makeStore("feedback"),
});
