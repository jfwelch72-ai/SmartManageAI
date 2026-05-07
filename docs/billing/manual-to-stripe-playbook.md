# Manual → Stripe Billing Migration Playbook

**Task #2482 — Billing & Subscription Productization.**

This runbook covers moving an organisation from manual billing
(`organization_subscriptions.billing_provider = 'manual'`) onto the
Stripe-backed self-serve flow.

---

## 0. Prerequisites

The following environment variables must be present **before** running any
migration step:

| Var | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe SDK auth (keep `sk_live_…` out of dev). |
| `STRIPE_WEBHOOK_SECRET` | Verifies signed webhooks at `/api/stripe/webhook`. |
| `STRIPE_PRICE_STARTER` | Price ID for the Starter plan (per-seat). |
| `STRIPE_PRICE_GROWTH` | Price ID for the Professional/Growth plan. |
| `STRIPE_PRICE_SCALE` | Price ID for the Enterprise plan. |
| `STRIPE_PRICE_ADDON_*` | Add-on price IDs (see `shared/billing/plans.ts`). |
| `STRIPE_METERED_PRICE_*` | Optional, for usage-based overage billing. |
| `APP_BASE_URL` | Used for Checkout `success_url` / `cancel_url`. |

Confirm presence:

```sh
node -e "['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRICE_STARTER'].forEach(k=>console.log(k, !!process.env[k]))"
```

Register the production webhook at:

```
POST https://<your-domain>/api/stripe/webhook
```

with the events: `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.payment_succeeded`, `invoice.payment_failed`,
`checkout.session.completed`.

---

## 1. Migration paths

### 1a. Org has no Stripe subscription yet (greenfield)

1. **Verify entitlement** — confirm the target plan, seat count, add-ons,
   and any quota overrides currently applied in the manual record. Take a
   screenshot of `/billing` (admin view).
2. **Flip provider** — call:

   ```http
   POST /api/billing/migrate-to-stripe
   { "organizationId": "<org-id>" }
   ```

   This creates (or reuses) the Stripe customer and switches
   `billing_provider` to `stripe` while leaving the seat & quota state
   intact. The org admin will be charged starting from the next checkout.
3. **Email the org admin** with the link to `/billing` and instructions to
   click **Subscribe** (which opens Stripe Checkout) — they need a payment
   method to complete the move.
4. After checkout completes, the `customer.subscription.created` webhook
   stamps `stripeSubscriptionId`, `stripePriceId`, period dates, and the
   plan tier (resolved from the price ID).

### 1b. Org already has a Stripe subscription created out-of-band

If a sales-led customer already has a Stripe subscription (e.g. created
via the Dashboard or invoice billing):

1. Find the `sub_…` ID in the Stripe Dashboard.
2. Call:

   ```http
   POST /api/billing/migrate-to-stripe
   {
     "organizationId": "<org-id>",
     "stripeSubscriptionId": "sub_…"
   }
   ```

3. The next webhook event Stripe fires for that subscription will be
   processed by `processStripeEvent` and reconcile the local row
   (status, period dates, plan). To force a sync immediately, click
   **"Send test event"** on the subscription in the Stripe Dashboard or
   apply a no-op metadata change.

### 1c. Bulk migration

For >5 orgs, drive the same endpoint from a script using a
super-admin token. Stripe customer creation is idempotent for our
purposes because `ensureStripeCustomer` reuses
`organization_subscriptions.stripe_customer_id` when present.

---

## 2. Verification

After migration, confirm each org is healthy:

```sql
select organization_id,
       billing_provider,
       plan_tier,
       status,
       stripe_customer_id,
       stripe_subscription_id,
       current_period_end
from organization_subscriptions
where organization_id = '<org-id>';
```

Expect:
* `billing_provider = 'stripe'`
* `stripe_customer_id` populated (`cus_…`)
* `stripe_subscription_id` populated (`sub_…`) once checkout finishes
* `status` mirrors the Stripe subscription status

Check the webhook audit log:

```sql
select event_type, status, processed_at
from stripe_webhook_events
where organization_id = '<org-id>'
order by processed_at desc
limit 20;
```

Every event should have `status = 'processed'`.

---

## 3. Roll-back

To revert an org to manual billing:

```sql
update organization_subscriptions
set billing_provider = 'manual',
    stripe_subscription_id = null
where organization_id = '<org-id>';
```

The Stripe customer record is intentionally **not** deleted — leave it in
place so future re-migration is one click. If you must close it, do so in
the Stripe Dashboard after confirming there are no open invoices.

---

## 4. Dunning behaviour after migration

Once an org is on Stripe:

* `invoice.payment_failed` → status flips to `past_due`,
  `payment_failed_at` and `grace_period_ends_at`
  (= `payment_failed_at + DUNNING_GRACE_PERIOD_DAYS`) are stamped.
* `runDunningCycle` (cron-friendly, also exposed at
  `POST /api/billing/dunning/run` for super-admin) sends reminder
  emails on day 0, day 3, day 7 and **suspends** the org on day 14.
* `invoice.payment_succeeded` clears all dunning state and re-activates
  suspended orgs.

Suspended orgs retain READ access to their data; write paths must consult
`organization_subscriptions.status` and reject when it equals `suspended`.

---

## 5. Common errors

| Symptom | Cause | Fix |
| --- | --- | --- |
| `503 Stripe is not configured` | Missing `STRIPE_SECRET_KEY`. | Add the env var and restart. |
| `409 No Stripe price configured for plan "starter"` | `STRIPE_PRICE_STARTER` env unset. | Populate the price env var matching `STRIPE_PRICE_ENV_VARS` in `shared/billing/plans.ts`. |
| Webhook 400 "Invalid Stripe webhook signature" | Wrong `STRIPE_WEBHOOK_SECRET` for this endpoint, or upstream proxy mutating the body. | Re-copy the secret from Stripe Dashboard; ensure raw body is preserved (`req.rawBody` in `server/index.ts`). |
| Duplicate webhook in audit log | Stripe retried delivery. The handler short-circuits on the unique `stripe_event_id`; this is expected. | No action. |
