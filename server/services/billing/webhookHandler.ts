/**
 * Stripe webhook event router.
 *
 * Task #2482 — Billing & Subscription Productization.
 *
 * Idempotent: every event is upserted into `stripe_webhook_events` by
 * Stripe event ID (unique). Re-deliveries short-circuit before any
 * side effect.
 */

import type Stripe from "stripe";
import { db } from "../../db";
import {
  organizationSubscriptions,
  stripeWebhookEvents,
  subscriptionEvents,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { logError, logInfo } from "../../utils/logger";
import { DUNNING_GRACE_PERIOD_DAYS, type PlanTier } from "@shared/billing/plans";
import { clearDunning } from "./dunning";
import { invalidateMeteredItemCache } from "./usageMetering";

// Stripe SDK v22 surfaces `current_period_{start,end}` and
// `invoice.subscription` reliably at runtime, but the typings shifted
// these fields between the parent object and its line items across
// minor releases. We declare narrow extension types so the rest of
// this file can stay strictly typed without `any` reaches.
type SubscriptionWithPeriod = Stripe.Subscription & {
  current_period_start?: number | null;
  current_period_end?: number | null;
};
type SubscriptionItemWithPeriod = Stripe.SubscriptionItem & {
  current_period_start?: number | null;
  current_period_end?: number | null;
};
type InvoiceWithSubscription = Stripe.Invoice & {
  subscription?: string | { id: string } | null;
};

type SubscriptionStatusValue =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused"
  | "suspended";

function planTierFromPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  const map: Record<string, PlanTier> = {
    [process.env.STRIPE_PRICE_FREE ?? ""]: "free",
    [process.env.STRIPE_PRICE_STARTER ?? ""]: "starter",
    [process.env.STRIPE_PRICE_GROWTH ?? ""]: "professional",
    [process.env.STRIPE_PRICE_SCALE ?? ""]: "enterprise",
  };
  return map[priceId] ?? null;
}

/**
 * Resolve the local organization id for a Stripe Subscription.
 *
 * Preference order:
 *   1. `subscription.metadata.organizationId` (set by our checkout flow)
 *   2. local row keyed by `stripe_subscription_id` (the migration
 *      playbook pre-links externally-created subscriptions this way)
 *   3. local row keyed by `stripe_customer_id`
 *
 * Returns null only when none of those locate a row — the event is
 * still recorded in `stripe_webhook_events` for the audit trail.
 */
async function resolveOrgIdForSubscription(sub: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = (sub.metadata?.organizationId as string | undefined) ?? null;
  if (fromMetadata) return fromMetadata;

  const [bySubId] = await db
    .select({ organizationId: organizationSubscriptions.organizationId })
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.stripeSubscriptionId, sub.id))
    .limit(1);
  if (bySubId?.organizationId) return bySubId.organizationId;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (customerId) {
    const [byCustomer] = await db
      .select({ organizationId: organizationSubscriptions.organizationId })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.stripeCustomerId, customerId))
      .limit(1);
    if (byCustomer?.organizationId) return byCustomer.organizationId;
  }
  return null;
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatusValue {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "paused":
      return status;
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
      return "past_due";
    default:
      return "active";
  }
}

async function applySubscriptionState(sub: Stripe.Subscription): Promise<string | null> {
  const orgId = await resolveOrgIdForSubscription(sub);
  if (!orgId) {
    logError("Stripe subscription event could not be matched to an organization", {
      subscriptionId: sub.id,
      hasMetadata: !!sub.metadata?.organizationId,
    });
    return null;
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const planTier = planTierFromPriceId(priceId);

  // current_period_{start,end} live on the SDK's Subscription object at
  // runtime but are typed under the subscription item in newer SDK
  // releases. Fall back through both shapes via the typed extensions.
  const subWithPeriod = sub as SubscriptionWithPeriod;
  const itemWithPeriod = item as SubscriptionItemWithPeriod | undefined;
  const periodEndRaw = subWithPeriod.current_period_end ?? itemWithPeriod?.current_period_end ?? null;
  const periodStartRaw = subWithPeriod.current_period_start ?? itemWithPeriod?.current_period_start ?? null;
  const periodEnd = periodEndRaw ? new Date(periodEndRaw * 1000) : null;
  const periodStart = periodStartRaw ? new Date(periodStartRaw * 1000) : null;

  const status = mapSubscriptionStatus(sub.status);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  await db
    .insert(organizationSubscriptions)
    .values({
      organizationId: orgId,
      planTier: planTier ?? "starter",
      status,
      billingProvider: "stripe",
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoUpdate({
      target: organizationSubscriptions.organizationId,
      set: {
        ...(planTier ? { planTier } : {}),
        status,
        billingProvider: "stripe",
        stripeCustomerId: customerId,
        stripeSubscriptionId: sub.id,
        stripePriceId: priceId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      },
    });

  await db.insert(subscriptionEvents).values({
    organizationId: orgId,
    eventType: `stripe.${sub.status}`,
    newValue: planTier ?? "unknown",
    description: `Stripe subscription ${sub.id} → ${sub.status}`,
  });

  // Subscription line items may have changed — drop the metered-item
  // resolution cache so the next overage emit re-resolves the
  // subscription_item id.
  invalidateMeteredItemCache(orgId);

  return orgId;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | undefined {
  // `invoice.subscription` is present at runtime but the SDK types
  // sometimes hide it behind the parent invoice item shape.
  const rawSub = (invoice as InvoiceWithSubscription).subscription;
  if (!rawSub) return undefined;
  return typeof rawSub === "string" ? rawSub : rawSub.id;
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<string | null> {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return null;

  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);
  if (!sub) return null;

  // Don't reset the cycle if we're already mid-dunning.
  if (sub.paymentFailedAt) return sub.organizationId;

  const failedAt = new Date();
  const graceEnd = new Date(failedAt.getTime() + DUNNING_GRACE_PERIOD_DAYS * 86_400_000);

  await db
    .update(organizationSubscriptions)
    .set({
      paymentFailedAt: failedAt,
      gracePeriodEndsAt: graceEnd,
      status: "past_due",
      updatedAt: failedAt,
    })
    .where(eq(organizationSubscriptions.id, sub.id));

  await db.insert(subscriptionEvents).values({
    organizationId: sub.organizationId,
    eventType: "payment_failed",
    newValue: "past_due",
    description: `Stripe invoice ${invoice.id} payment failed; grace period ends ${graceEnd.toISOString()}`,
  });

  return sub.organizationId;
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<string | null> {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return null;

  const [sub] = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);
  if (!sub) return null;

  await clearDunning(sub.organizationId);
  return sub.organizationId;
}

/**
 * Process one Stripe event. Idempotent: re-deliveries return the
 * cached result without side effects.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<{ duplicate: boolean; organizationId: string | null }> {
  // Idempotency: a row with this stripe_event_id may already exist
  // from a previous delivery attempt. Re-process ONLY if that prior
  // attempt is not yet `processed` — i.e. it crashed mid-flight or
  // hit a transient error and Stripe is retrying. A row that's
  // already `processed` short-circuits.
  const [existing] = await db
    .select({ status: stripeWebhookEvents.status, organizationId: stripeWebhookEvents.organizationId })
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripeEventId, event.id))
    .limit(1);

  if (existing?.status === "processed") {
    logInfo("Duplicate Stripe webhook event already processed", { id: event.id, type: event.type });
    return { duplicate: true, organizationId: existing.organizationId ?? null };
  }

  if (existing) {
    // Prior attempt was `processing` (timed out / pod died) or
    // `error`. Reset the row to `processing` and re-run the handler.
    await db
      .update(stripeWebhookEvents)
      .set({ status: "processing", errorMessage: null })
      .where(eq(stripeWebhookEvents.stripeEventId, event.id));
    logInfo("Retrying Stripe webhook event after prior non-success", {
      id: event.id,
      type: event.type,
      priorStatus: existing.status,
    });
  } else {
    try {
      await db.insert(stripeWebhookEvents).values({
        stripeEventId: event.id,
        eventType: event.type,
        payload: event as unknown as Record<string, unknown>,
        status: "processing",
      });
    } catch (e: unknown) {
      // Race: another concurrent delivery raced us to the insert.
      // Treat as duplicate; the winning worker will mark processed.
      const code = (e as { code?: string } | null)?.code;
      if (code === "23505") {
        logInfo("Concurrent Stripe webhook insert raced; deferring", { id: event.id });
        return { duplicate: true, organizationId: null };
      }
      throw e;
    }
  }

  let organizationId: string | null = null;
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        organizationId = await applySubscriptionState(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        organizationId = await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_succeeded":
        organizationId = await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        organizationId = (session.client_reference_id as string | null) ?? null;
        // The actual subscription state lands via customer.subscription.created.
        break;
      }
      default:
        // Unhandled event types are still recorded for the audit trail.
        break;
    }

    await db
      .update(stripeWebhookEvents)
      .set({ status: "processed", organizationId })
      .where(eq(stripeWebhookEvents.stripeEventId, event.id));

    return { duplicate: false, organizationId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .update(stripeWebhookEvents)
      .set({ status: "error", errorMessage: message })
      .where(eq(stripeWebhookEvents.stripeEventId, event.id));
    throw e;
  }
}
