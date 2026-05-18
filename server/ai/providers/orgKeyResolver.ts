/**
 * Task #2948 — Shared org-key resolver for BYOK (Bring-Your-Own-Key).
 *
 * Extracted into its own module so both the chat router (providers/index.ts)
 * and the embedding router (providers/embeddingProvider.ts) can import it
 * without creating a circular dependency.
 */

import { db } from "../../db";
import { orgAiKeys, organizationSubscriptions } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { isKeyVaultConfigured, decryptKey } from "../../services/keyVault";
import { isFeatureEnabled } from "../../services/featureFlagService";
import { PLAN_DEFAULT_FEATURES } from "@shared/billing/plans";
import { logWarn } from "../../utils/logger";

/**
 * Returns true when an org is entitled to use BYOK, via EITHER:
 *  1. An explicit `BYOK_AI_KEYS` feature-flag override (e.g. Super Admin toggle), OR
 *  2. The org's active plan tier includes BYOK in PLAN_DEFAULT_FEATURES
 *     (Growth, Scale, Enterprise).
 *
 * Exported so `byokRoutes.ts` can reuse the same entitlement check without
 * re-implementing the plan-tier lookup.
 */
export async function isByokEntitled(orgId: string): Promise<boolean> {
  // 1. Explicit flag override (works at any plan tier — Super Admin can grant).
  try {
    if (await isFeatureEnabled(orgId, "BYOK_AI_KEYS")) return true;
  } catch {
    // flag lookup failed — fall through to plan-tier check
  }

  // 2. Plan-tier entitlement: Growth / Scale / Enterprise include BYOK.
  try {
    const [sub] = await db
      .select({ planTier: organizationSubscriptions.planTier })
      .from(organizationSubscriptions)
      .where(
        and(
          eq(organizationSubscriptions.organizationId, orgId),
          eq(organizationSubscriptions.status, "active"),
        ),
      )
      .limit(1);
    const tier = (sub?.planTier ?? "free") as keyof typeof PLAN_DEFAULT_FEATURES;
    const planFeatures = PLAN_DEFAULT_FEATURES[tier] ?? [];
    if ((planFeatures as string[]).includes("BYOK_AI_KEYS")) return true;
  } catch {
    // plan lookup failed — deny
  }
  return false;
}

/**
 * Look up the per-org plaintext API key for `provider`.
 * Returns null when:
 *  - Org is not entitled to BYOK (flag off AND plan does not include BYOK)
 *  - KEY_VAULT_SECRET is not configured (vault not available)
 *  - no row exists for this (orgId, provider) pair
 *  - decryption fails (logs a warning, falls back to platform key)
 *
 * Entitlement covers downgrade safety: after a plan downgrade or flag
 * revocation, keys remain stored in DB but resolveOrgKey returns null so
 * routing falls back to the platform key transparently.
 */
export async function resolveOrgKey(
  orgId: string,
  provider: "openai" | "anthropic",
): Promise<string | null> {
  if (!isKeyVaultConfigured()) return null;
  try {
    const entitled = await isByokEntitled(orgId);
    if (!entitled) return null;

    const rows = await db
      .select({ encryptedKey: orgAiKeys.encryptedKey })
      .from(orgAiKeys)
      .where(and(eq(orgAiKeys.organizationId, orgId), eq(orgAiKeys.provider, provider)));
    if (!rows[0]) return null;
    return decryptKey(rows[0].encryptedKey);
  } catch (err) {
    logWarn("BYOK key resolution failed; falling back to platform key", {
      orgId,
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
