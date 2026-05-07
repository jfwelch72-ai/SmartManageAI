/**
 * Stripe webhook entry point.
 *
 * Task #2482 — Billing & Subscription Productization.
 *
 * Mounted as `POST /api/stripe/webhook`. CSRF is bypassed for this
 * path in `server/csrf.ts`. The raw request body is captured by the
 * JSON body parser's `verify` hook in `server/index.ts` (req.rawBody),
 * which we feed to Stripe's signature verifier.
 */

import { Router, type Request, type Response } from "express";
import { isStripeConfigured, verifyWebhook } from "./services/billing/stripeService";
import { processStripeEvent } from "./services/billing/webhookHandler";
import { logError, logInfo } from "./utils/logger";

const router = Router();

// `rawBody` is attached to the express request by the JSON body parser's
// `verify` hook in `server/index.ts` so Stripe's signature verifier can
// read the byte-exact payload.
type RequestWithRawBody = Request & { rawBody?: Buffer };

router.post("/webhook", async (req: Request, res: Response) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: "Stripe is not configured on this deployment" });
  }

  const signature = req.header("stripe-signature");
  const raw = (req as RequestWithRawBody).rawBody;
  if (!raw) {
    return res.status(400).json({ error: "Missing raw request body" });
  }

  let event;
  try {
    event = verifyWebhook(raw, signature);
  } catch (e) {
    logError("Stripe webhook signature verification failed", {}, e instanceof Error ? e : new Error(String(e)));
    return res.status(400).json({ error: "Invalid Stripe webhook signature" });
  }

  try {
    const result = await processStripeEvent(event);
    logInfo("Stripe webhook processed", { id: event.id, type: event.type, ...result });
    return res.json({ received: true, ...result });
  } catch (e) {
    logError("Stripe webhook handler error", { id: event.id, type: event.type }, e instanceof Error ? e : new Error(String(e)));
    // Return 500 so Stripe retries.
    return res.status(500).json({ error: "Webhook handler error" });
  }
});

export default router;
