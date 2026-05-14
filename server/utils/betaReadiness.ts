/**
 * Beta Readiness Controls
 *
 * Enumerates every boolean gate that must be active before the platform
 * is safe to expose to real beta users. Used at boot time (structured log
 * + fail-fast) and served via GET /api/ops/beta-readiness for on-demand
 * verification by a SUPER_ADMIN operator.
 */

import { isDevSeedEnabled } from "./devSeedFlag";

export interface BetaControl {
  name: string;
  ok: boolean;
  description: string;
  value: string;
}

/**
 * Returns the current status of every critical beta control.
 * Call this at boot and from the ops endpoint.
 */
export function getBetaReadinessControls(): BetaControl[] {
  const strictRls = process.env.STRICT_TENANT_RLS === "true";
  const sessionSecretSet = Boolean(process.env.SESSION_SECRET);
  const anthropicKeySet = Boolean(process.env.ANTHROPIC_API_KEY);
  const devSeedOff = !isDevSeedEnabled();
  const avScanMode = (process.env.UPLOAD_AV_SCAN_MODE ?? "").toLowerCase();
  const avScanActive = avScanMode !== "disabled";
  // Rate limiting is active when the global apiLimiter is NOT skipping in dev
  // and limiters are backed by the shared Postgres store (not in-memory).
  // The apiLimiter uses skipInDevSeed() which returns true when isDevSeedEnabled()
  // is true. So rate limiting is fully active when dev seed is off AND the Postgres
  // store is in use (RATE_LIMIT_USE_MEMORY_STORE != '1').
  const rateLimitPgBacked = process.env.RATE_LIMIT_USE_MEMORY_STORE !== "1";
  const rateLimitingActive = devSeedOff && rateLimitPgBacked;

  return [
    {
      name: "strict_tenant_rls",
      ok: strictRls,
      description: "STRICT_TENANT_RLS=true — fail-closed tenant isolation via Postgres RLS",
      value: strictRls ? "on" : "off",
    },
    {
      name: "session_secret_set",
      ok: sessionSecretSet,
      description: "SESSION_SECRET environment variable is present",
      value: sessionSecretSet ? "set" : "missing",
    },
    {
      name: "anthropic_api_key_set",
      ok: anthropicKeySet,
      description: "ANTHROPIC_API_KEY environment variable is present",
      value: anthropicKeySet ? "set" : "missing",
    },
    {
      name: "dev_seed_off",
      ok: devSeedOff,
      description: "Dev seed routes are disabled (NODE_ENV !== development)",
      value: devSeedOff ? "off" : "on",
    },
    {
      name: "av_scan_active",
      ok: avScanActive,
      description: "Upload AV scanning is not explicitly disabled (UPLOAD_AV_SCAN_MODE !== disabled)",
      value: avScanMode || "default",
    },
    {
      name: "rate_limiting_active",
      ok: rateLimitingActive,
      description:
        "Rate limiting is fully active: apiLimiter not bypassed (dev_seed_off) and Postgres-backed store in use (RATE_LIMIT_USE_MEMORY_STORE != 1)",
      value: rateLimitingActive ? "active" : rateLimitPgBacked ? "bypassed-dev-seed" : "memory-store",
    },
  ];
}

/** True when every critical control is active. */
export function isBetaReady(controls: BetaControl[]): boolean {
  return controls.every((c) => c.ok);
}
