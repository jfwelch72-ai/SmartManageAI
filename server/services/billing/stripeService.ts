/**
 * Stripe SDK wrapper.
 *
 * Task #2482 — Billing & Subscription Productization.
 *
 * Lazily initialises the Stripe SDK from `STRIPE_SECRET_KEY`. When the key
 * is missing the helpers either return null (callers can fall back to the
 * "manual" billing provider) or throw a 503-style error for endpoints
 * that explicitly require Stripe (checkout, portal, webhooks).
 *
 * No business logic lives here — this file is purely an infrastructure
 * seam so the rest of the billing code can be tested without hitting
 * the real Stripe API.
 */

import Stripe from "stripe";
import { logError, logInfo } from "../../utils/logger";

let cachedClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY to enable Stripe billing.",
    );
  }
  if (!cachedClient) {
    // Intentionally omit `apiVersion` — the SDK pins itself to the
    // version bundled with the installed @types/stripe release, which
    // avoids the literal-string mismatch we'd otherwise have to cast
    // around on every minor types bump.
    cachedClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      typescript: true,
    });
  }
  return cachedClient;
}

export interface CheckoutParams {
  organizationId: string;
  organizationName: string;
  customerEmail: string;
  priceId: string;
  addOnPriceIds?: string[];
  seats: number;
  successUrl: string;
  cancelUrl: string;
  existingCustomerId?: string | null;
}

export async function createCheckoutSession(
  params: CheckoutParams,
): Promise<{ url: string; sessionId: string }> {
  const stripe = getStripe();

  // Stripe SDK v22 nests the line-item type slightly differently across
  // patch releases; treat it as the SDK input shape without pinning to a
  // specific namespace path.
  type LineItem = { price: string; quantity: number };
  const lineItems: LineItem[] = [
    { price: params.priceId, quantity: params.seats },
    ...(params.addOnPriceIds ?? []).map((price): LineItem => ({ price, quantity: 1 })),
  ];

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer: params.existingCustomerId ?? undefined,
    customer_email: params.existingCustomerId ? undefined : params.customerEmail,
    client_reference_id: params.organizationId,
    subscription_data: {
      metadata: {
        organizationId: params.organizationId,
        organizationName: params.organizationName,
      },
    },
    metadata: {
      organizationId: params.organizationId,
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Stripe Checkout did not return a redirect URL");
  }

  logInfo("Created Stripe Checkout session", {
    organizationId: params.organizationId,
    sessionId: session.id,
  });

  return { url: session.url, sessionId: session.id };
}

export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

export function verifyWebhook(
  rawBody: Buffer | string,
  signature: string | undefined,
): Stripe.Event {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  if (!signature) {
    throw new Error("Missing Stripe-Signature header");
  }
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Report metered usage to Stripe for the org's metered subscription
 * item. Silently skips when no metered price is configured for that
 * usage key — callers should consult `isStripeConfigured()` and the
 * org's plan for hard-block vs bill-on-overage policy.
 */
interface UsageRecordParams {
  quantity: number;
  timestamp: number;
  action: "increment" | "set";
}
interface SubscriptionItemsWithUsage {
  createUsageRecord(
    subscriptionItemId: string,
    params: UsageRecordParams,
  ): Promise<unknown>;
}

export async function reportMeteredUsage(
  subscriptionItemId: string,
  quantity: number,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (!isStripeConfigured()) return;
  if (quantity <= 0) return;
  try {
    const stripe = getStripe();
    // The legacy `createUsageRecord` helper is moved between sub-resources
    // across Stripe SDK minor versions. We declare a typed view onto the
    // stable shape rather than reaching for `any`.
    const usage = stripe.subscriptionItems as unknown as SubscriptionItemsWithUsage;
    await usage.createUsageRecord(subscriptionItemId, {
      quantity,
      timestamp,
      action: "increment",
    });
  } catch (e) {
    logError("Failed to report metered usage to Stripe", {
      subscriptionItemId,
      quantity,
    }, e instanceof Error ? e : new Error(String(e)));
  }
}

export async function ensureStripeCustomer(
  organizationId: string,
  organizationName: string,
  email: string,
  existingCustomerId?: string | null,
): Promise<string> {
  const stripe = getStripe();
  if (existingCustomerId) {
    try {
      const c = await stripe.customers.retrieve(existingCustomerId);
      if (c && !("deleted" in c && c.deleted)) {
        return existingCustomerId;
      }
    } catch {
      // fall through and create a new one
    }
  }
  const created = await stripe.customers.create({
    email,
    name: organizationName,
    metadata: { organizationId },
  });
  return created.id;
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.cancel(subscriptionId);
}
