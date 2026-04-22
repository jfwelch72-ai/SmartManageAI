import { db } from "../db";
import { integrationWebhookSubscriptions } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

const BLOCKED_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
];

function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] >= 224) return true; // multicast/reserved
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped
      const v4 = lower.replace("::ffff:", "");
      if (net.isIP(v4) === 4) return isPrivateIp(v4);
    }
    return false;
  }
  return true;
}

export async function assertWebhookUrlSafe(urlString: string): Promise<void> {
  const initial = isBlockedUrl(urlString);
  if (initial.blocked) throw new Error(initial.reason || "Invalid webhook URL");
  const hostname = new URL(urlString).hostname;
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("Webhook URL resolves to a private network");
    return;
  }
  let addrs: { address: string; family: number }[] = [];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Webhook URL hostname could not be resolved");
  }
  if (addrs.length === 0) throw new Error("Webhook URL hostname could not be resolved");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error("Webhook URL resolves to a private/internal address");
    }
  }
}

export function isBlockedUrl(urlString: string): { blocked: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:") {
      return { blocked: true, reason: "Only HTTPS URLs are allowed for webhooks" };
    }
    const hostname = parsed.hostname;
    for (const pattern of BLOCKED_IP_RANGES) {
      if (pattern.test(hostname)) {
        return { blocked: true, reason: "Webhook URLs targeting internal/private networks are not allowed" };
      }
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return { blocked: true, reason: "Raw IP addresses are not allowed for webhooks — use a domain name" };
    }
    return { blocked: false };
  } catch {
    return { blocked: true, reason: "Invalid webhook URL" };
  }
}

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
  await assertWebhookUrlSafe(targetUrl);

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
  // Re-validate at delivery time (DNS rebind protection) and block redirects.
  await assertWebhookUrlSafe(targetUrl);

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
      redirect: "error",
    });
    clearTimeout(timeout);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    clearTimeout(timeout);
    logError("Webhook delivery failed", { targetUrl, error: String(err) });
    throw err;
  }
}
