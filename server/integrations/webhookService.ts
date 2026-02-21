import { db } from "../db";
import { integrationWebhookSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import crypto from "crypto";

export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function getSubscriptions(orgId: string, connectionId: string, eventType?: string) {
  const conditions = [
    eq(integrationWebhookSubscriptions.organizationId, orgId),
    eq(integrationWebhookSubscriptions.connectionId, connectionId),
    eq(integrationWebhookSubscriptions.isActive, true),
  ];
  if (eventType) {
    conditions.push(eq(integrationWebhookSubscriptions.eventType, eventType));
  }
  return db.select().from(integrationWebhookSubscriptions).where(and(...conditions));
}

export async function createSubscription(
  orgId: string,
  connectionId: string,
  eventType: string,
  targetUrl: string
) {
  const secret = crypto.randomBytes(32).toString("hex");
  const [sub] = await db.insert(integrationWebhookSubscriptions).values({
    organizationId: orgId,
    connectionId,
    eventType,
    targetUrl,
    secret,
  }).returning();
  logInfo("Webhook subscription created", { subscriptionId: sub.id, orgId, eventType });
  return sub;
}

export async function deliverWebhook(targetUrl: string, payload: Record<string, any>, secret: string) {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": new Date().toISOString(),
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    clearTimeout(timeout);
    logError("Webhook delivery failed", { targetUrl, error: String(err) });
    throw err;
  }
}
