import { Router } from "express";
import { requireAuth } from "../auth";
import { z } from "zod";
import crypto from "crypto";
import * as keyService from "./apiKeyService";
import { PUBLIC_API_SCOPES, PUBLIC_API_EVENT_TYPES, integrationWebhookSubscriptions, integrationConnections } from "@shared/schema";
import { logIntegrationAudit } from "../integrations/audit";
import { assertWebhookUrlSafe } from "../integrations/webhookService";
import { db } from "../db";
import { and, eq, desc } from "drizzle-orm";

const router = Router();

router.get("/scopes", requireAuth, (_req, res) => {
  res.json({ scopes: PUBLIC_API_SCOPES, events: PUBLIC_API_EVENT_TYPES });
});

router.get("/keys", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const keys = await keyService.listApiKeys(user.organizationId);
    res.json(keys);
  } catch (err) { next(err); }
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  rateLimitPerMinute: z.number().int().positive().max(10000).optional(),
  expiresAt: z.string().datetime().optional(),
});

router.post("/keys", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    const issued = await keyService.issueApiKey(
      user.organizationId,
      user.id,
      parsed.data.name,
      parsed.data.scopes,
      {
        rateLimitPerMinute: parsed.data.rateLimitPerMinute,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
    );
    logIntegrationAudit("security.credentials_changed", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { event: "api_key_issued", keyId: issued.id, scopes: issued.scopes },
    });
    res.status(201).json(issued);
  } catch (err: any) {
    if (err?.message?.startsWith("Unknown scope")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.delete("/keys/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const row = await keyService.revokeApiKey(user.organizationId, req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    logIntegrationAudit("security.credentials_changed", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { event: "api_key_revoked", keyId: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Webhook subscription management (admin) ----
router.get("/webhooks", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const rows = await db.select().from(integrationWebhookSubscriptions)
      .where(eq(integrationWebhookSubscriptions.organizationId, user.organizationId))
      .orderBy(desc(integrationWebhookSubscriptions.createdAt));
    res.json({ data: rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      targetUrl: r.targetUrl,
      isActive: r.isActive,
      createdAt: r.createdAt,
    })) });
  } catch (err) { next(err); }
});

const webhookSchema = z.object({
  eventType: z.enum(PUBLIC_API_EVENT_TYPES as unknown as [string, ...string[]]),
  targetUrl: z.string().url(),
  apiKey: z.string().optional(),
});

router.post("/webhooks", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    const { eventType, targetUrl, apiKey } = parsed.data;
    try { await assertWebhookUrlSafe(targetUrl); } catch (e: any) { return res.status(400).json({ error: e?.message || "Invalid webhook URL" }); }

    if (apiKey) {
      const k = await keyService.authenticateApiKey(apiKey);
      if (!k || k.organizationId !== user.organizationId) {
        return res.status(400).json({ error: "API key invalid for this organization" });
      }
      if (!keyService.hasScope(k, "webhooks:manage")) {
        return res.status(400).json({ error: "API key missing scope webhooks:manage" });
      }
    }

    const secret = crypto.randomBytes(32).toString("hex");
    let [conn] = await db.select().from(integrationConnections)
      .where(and(eq(integrationConnections.organizationId, user.organizationId), eq(integrationConnections.provider, "zapier"), eq(integrationConnections.displayName, "Public API")))
      .limit(1);
    if (!conn) {
      [conn] = await db.insert(integrationConnections).values({
        organizationId: user.organizationId,
        provider: "zapier",
        displayName: "Public API",
        status: "active",
        metadata: { source: "public_api" },
      }).returning();
    }
    const [row] = await db.insert(integrationWebhookSubscriptions).values({
      organizationId: user.organizationId,
      connectionId: conn.id,
      eventType,
      targetUrl,
      secret,
    }).returning();
    logIntegrationAudit("security.credentials_changed", {
      orgId: user.organizationId, userId: user.id,
      meta: { event: "webhook_subscribed", subscriptionId: row.id, eventType, targetUrl },
    });
    res.status(201).json({ id: row.id, eventType: row.eventType, targetUrl: row.targetUrl, isActive: row.isActive, createdAt: row.createdAt, secret });
  } catch (err) { next(err); }
});

router.delete("/webhooks/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const [row] = await db.update(integrationWebhookSubscriptions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(integrationWebhookSubscriptions.id, req.params.id), eq(integrationWebhookSubscriptions.organizationId, user.organizationId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    logIntegrationAudit("security.credentials_changed", {
      orgId: user.organizationId, userId: user.id,
      meta: { event: "webhook_unsubscribed", subscriptionId: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get("/request-log", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const limit = Math.min(500, parseInt(String(req.query.limit || "200"), 10) || 200);
    const rows = await keyService.getRequestLog(user.organizationId, limit);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
