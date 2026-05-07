/**
 * Usage metering for AI tokens, AI jobs, AI Vision documents, and storage.
 *
 * Task #2482 — Billing & Subscription Productization.
 *
 * Each helper increments the per-org `organization_usage` row for the
 * current monthly period and, depending on the org's plan + Stripe
 * configuration, either:
 *   - blocks the request (no metered Stripe price configured), or
 *   - bills the overage by emitting a Stripe usage record.
 */

import { db } from "../../db";
import { organizationSubscriptions, organizationUsage } from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  PLAN_LIMITS,
  STRIPE_METERED_PRICE_ENV_VARS,
  type PlanTier,
} from "@shared/billing/plans";
import { logInfo, logWarn } from "../../utils/logger";
import { isStripeConfigured, getStripe, reportMeteredUsage } from "./stripeService";

type MeteredKey = "ai_vision_docs" | "ai_tokens" | "ai_jobs" | "storage_bytes";

interface MeterResult {
  allowed: boolean;
  reason?: string;
  used: number;
  limit: number;
  overage: number;
  billedToStripe: boolean;
}

const KEY_TO_PLAN_FIELD: Record<MeteredKey, keyof (typeof PLAN_LIMITS)["free"]> = {
  ai_vision_docs: "aiVisionDocs",
  ai_tokens: "aiTokens",
  ai_jobs: "aiJobs",
  storage_bytes: "storageGb", // compared after converting bytes → GB
};

function currentPeriod(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

async function readUsage(orgId: string, key: MeteredKey): Promise<number> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, orgId),
        eq(organizationUsage.usageKey, key),
        lte(organizationUsage.periodStart, now),
        gte(organizationUsage.periodEnd, now),
      ),
    )
    .limit(1);
  return row?.quantity ?? 0;
}

async function bumpUsage(orgId: string, key: MeteredKey, amount: number): Promise<number> {
  const now = new Date();
  // Atomic increment via a single UPDATE ... RETURNING. Reading and
  // then writing in two round-trips lost concurrent increments under
  // load (two callers both read X, both wrote X+1, undercounting by
  // one). Letting Postgres compute `quantity + amount` in a single
  // statement preserves every increment.
  const updated = await db
    .update(organizationUsage)
    .set({ quantity: sql`${organizationUsage.quantity} + ${amount}` })
    .where(
      and(
        eq(organizationUsage.organizationId, orgId),
        eq(organizationUsage.usageKey, key),
        lte(organizationUsage.periodStart, now),
        gte(organizationUsage.periodEnd, now),
      ),
    )
    .returning({ quantity: organizationUsage.quantity });

  if (updated.length > 0) {
    return updated[0].quantity;
  }

  // No row for this period yet. Insert one. If a concurrent caller
  // raced us to the insert (no unique index, so we can't ON CONFLICT),
  // retry the atomic UPDATE — that path is now guaranteed to find a
  // row and increment it correctly.
  const { start, end } = currentPeriod(now);
  try {
    await db.insert(organizationUsage).values({
      organizationId: orgId,
      usageKey: key,
      periodStart: start,
      periodEnd: end,
      quantity: amount,
    });
    return amount;
  } catch (e) {
    const retried = await db
      .update(organizationUsage)
      .set({ quantity: sql`${organizationUsage.quantity} + ${amount}` })
      .where(
        and(
          eq(organizationUsage.organizationId, orgId),
          eq(organizationUsage.usageKey, key),
          lte(organizationUsage.periodStart, now),
          gte(organizationUsage.periodEnd, now),
        ),
      )
      .returning({ quantity: organizationUsage.quantity });
    if (retried.length > 0) return retried[0].quantity;
    throw e;
  }
}

/**
 * Get the effective limit for a metered key on this org. Storage is
 * returned in BYTES (plan stores GB). -1 = unlimited.
 */
export async function getEffectiveLimit(orgId: string, key: MeteredKey): Promise<{ planTier: PlanTier; limit: number }> {
  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, orgId))
    .limit(1);
  const planTier = (sub?.planTier as PlanTier) ?? "free";
  const planLimits = PLAN_LIMITS[planTier] ?? PLAN_LIMITS.free;

  let limit: number;
  if (key === "ai_tokens") {
    limit = sub?.aiTokenQuotaOverride ?? planLimits.aiTokens;
  } else if (key === "storage_bytes") {
    const gb = sub?.storageGbQuotaOverride ?? planLimits.storageGb;
    limit = gb === -1 ? -1 : Math.floor(gb * 1024 * 1024 * 1024);
  } else if (key === "ai_jobs") {
    limit = planLimits.aiJobs;
  } else {
    limit = planLimits.aiVisionDocs;
  }
  return { planTier, limit };
}

/**
 * Pre-flight check: does the org have headroom for `amount` more units?
 * Does NOT increment. Use this BEFORE doing the work; call
 * `recordUsage` after the work succeeds.
 */
export async function checkQuota(orgId: string, key: MeteredKey, amount: number): Promise<MeterResult> {
  const used = await readUsage(orgId, key);
  const { planTier, limit } = await getEffectiveLimit(orgId, key);
  if (limit === -1) {
    return { allowed: true, used, limit, overage: 0, billedToStripe: false };
  }
  if (used + amount <= limit) {
    return { allowed: true, used, limit, overage: 0, billedToStripe: false };
  }

  // Over quota. If the metered Stripe price is configured AND the org
  // is billed via Stripe, allow + bill the overage; otherwise block.
  const meteredEnvVar = (STRIPE_METERED_PRICE_ENV_VARS as Record<string, string>)[key];
  const meteredPriceConfigured = !!(meteredEnvVar && process.env[meteredEnvVar]);

  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, orgId))
    .limit(1);
  const isStripeOrg = sub?.billingProvider === "stripe" && !!sub?.stripeSubscriptionId;

  if (isStripeConfigured() && meteredPriceConfigured && isStripeOrg) {
    return {
      allowed: true,
      used,
      limit,
      overage: used + amount - limit,
      billedToStripe: true,
    };
  }

  return {
    allowed: false,
    reason: `Quota exceeded for ${key} on plan "${planTier}" (${used}/${limit}).`,
    used,
    limit,
    overage: used + amount - limit,
    billedToStripe: false,
  };
}

/**
 * Atomically increment usage. Returns the new total.
 */
export async function recordUsage(orgId: string, key: MeteredKey, amount: number): Promise<number> {
  if (amount <= 0) return readUsage(orgId, key);
  const next = await bumpUsage(orgId, key, amount);
  logInfo("Usage recorded", { orgId, key, amount, total: next });
  return next;
}

/**
 * Convenience: assert quota, throw if blocked, otherwise record.
 */
export class QuotaExceededError extends Error {
  status = 402;
  code = "QUOTA_EXCEEDED";
  constructor(public meter: MeterResult, public key: MeteredKey) {
    super(meter.reason || `Quota exceeded for ${key}`);
  }
}

export async function consume(orgId: string, key: MeteredKey, amount: number): Promise<MeterResult> {
  const check = await checkQuota(orgId, key, amount);
  if (!check.allowed) {
    throw new QuotaExceededError(check, key);
  }
  await recordUsage(orgId, key, amount);
  // Task #2482: when the org has crossed quota and overage is billed
  // through Stripe, push the units onto the matching metered Stripe
  // subscription item. The lookup is cached per (org,key) for the
  // process lifetime so we don't hit Stripe on every increment.
  if (check.billedToStripe && check.overage > 0) {
    await emitMeteredUsage(orgId, key, Math.min(amount, check.overage)).catch((e) => {
      logWarn("Metered usage emission failed (already recorded locally)", {
        orgId,
        key,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }
  return check;
}

// Cache of (orgId|key) → stripe subscription_item id resolved from the
// org's subscription line items. Cleared by `invalidateMeteredItemCache`
// when subscription state changes via the webhook.
const meteredItemCache = new Map<string, string | null>();

export function invalidateMeteredItemCache(orgId?: string): void {
  if (!orgId) {
    meteredItemCache.clear();
    return;
  }
  for (const k of Array.from(meteredItemCache.keys())) {
    if (k.startsWith(`${orgId}|`)) meteredItemCache.delete(k);
  }
}

async function resolveMeteredSubscriptionItem(
  orgId: string,
  key: MeteredKey,
): Promise<string | null> {
  const cacheKey = `${orgId}|${key}`;
  if (meteredItemCache.has(cacheKey)) return meteredItemCache.get(cacheKey)!;

  const meteredEnvVar = (STRIPE_METERED_PRICE_ENV_VARS as Record<string, string>)[key];
  const meteredPriceId = meteredEnvVar ? process.env[meteredEnvVar] : undefined;
  if (!meteredPriceId) {
    meteredItemCache.set(cacheKey, null);
    return null;
  }

  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, orgId))
    .limit(1);
  if (!sub?.stripeSubscriptionId) {
    meteredItemCache.set(cacheKey, null);
    return null;
  }

  try {
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const item = stripeSub.items?.data?.find((it) => it.price?.id === meteredPriceId);
    const id = item?.id ?? null;
    meteredItemCache.set(cacheKey, id);
    return id;
  } catch (e) {
    logWarn("Failed to resolve metered Stripe subscription item", {
      orgId,
      key,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Public alias for the internal metered-usage emitter. Used by the
 * storage quota gate which already runs its own quota check via
 * `checkQuota` and only needs to push the overage units to Stripe.
 */
export async function reportMeteredOverage(orgId: string, key: MeteredKey, units: number): Promise<void> {
  return emitMeteredUsage(orgId, key, units);
}

async function emitMeteredUsage(orgId: string, key: MeteredKey, units: number): Promise<void> {
  const itemId = await resolveMeteredSubscriptionItem(orgId, key);
  if (!itemId) return;
  await reportMeteredUsage(itemId, units);
  logInfo("Reported metered overage to Stripe", { orgId, key, units, subscriptionItemId: itemId });
}

/**
 * Snapshot the org's storage footprint into the metered usage row so
 * the dashboard and overage logic see a current value. Storage is
 * cumulative, not monthly — we overwrite rather than add. Callers
 * pass the total bytes used at this moment.
 */
export async function recordStorageSnapshot(orgId: string, totalBytes: number): Promise<void> {
  const now = new Date();
  const { start, end } = currentPeriod(now);

  const [existing] = await db
    .select()
    .from(organizationUsage)
    .where(
      and(
        eq(organizationUsage.organizationId, orgId),
        eq(organizationUsage.usageKey, "storage_bytes"),
        lte(organizationUsage.periodStart, now),
        gte(organizationUsage.periodEnd, now),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(organizationUsage)
      .set({ quantity: totalBytes })
      .where(eq(organizationUsage.id, existing.id));
  } else {
    await db.insert(organizationUsage).values({
      organizationId: orgId,
      usageKey: "storage_bytes",
      periodStart: start,
      periodEnd: end,
      quantity: totalBytes,
    });
  }
}

/**
 * Read all current-period usage for one org as a flat map.
 */
export async function getAllUsage(orgId: string) {
  const keys: MeteredKey[] = ["ai_vision_docs", "ai_tokens", "ai_jobs", "storage_bytes"];
  const out = {} as Record<MeteredKey, { used: number; limit: number }>;
  for (const k of keys) {
    const used = await readUsage(orgId, k);
    const { limit } = await getEffectiveLimit(orgId, k);
    out[k] = { used, limit };
  }
  return out;
}

// Silence unused-import lint for getStripe in environments without Stripe.
void getStripe;
void logWarn;
