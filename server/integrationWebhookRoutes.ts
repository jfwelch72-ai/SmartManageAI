import { Router } from "express";
import { requireAuth } from "./auth";
import * as connectionService from "./integrations/connectionService";
import * as outboxService from "./integrations/outboxService";
import * as webhookService from "./integrations/webhookService";
import { logIntegrationAudit } from "./integrations/audit";
import { logInfo, logError } from "./utils/logger";
import { db } from "./db";
import { zapierWebhooks, ZAPIER_EVENT_TYPES } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateWebhookSecret, deliverZapierWebhook } from "./integrations/providers/zapier";
import { z } from "zod";

const router = Router();

router.get("/events", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const events = await outboxService.getOutboxEvents(user.organizationId, 100);
    res.json(events);
  } catch (err) {
    logError("Failed to list events", { error: String(err) });
    res.status(500).json({ error: "Failed to list events" });
  }
});

router.post("/webhooks/subscribe", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { connectionId, eventType, targetUrl } = req.body;
    if (!connectionId || !eventType || !targetUrl) return res.status(400).json({ error: "Missing required fields" });
    const connection = await connectionService.getConnection(connectionId, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    const sub = await webhookService.createSubscription(user.organizationId, connectionId, eventType, targetUrl);
    res.status(201).json({ id: sub.id, eventType: sub.eventType, targetUrl: sub.targetUrl });
  } catch (err) {
    logError("Failed to create webhook subscription", { error: String(err) });
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

router.post("/webhooks/test", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Super admin access required" });
    const { targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ error: "targetUrl required" });
    const result = await webhookService.deliverWebhook(targetUrl, { test: true, timestamp: new Date().toISOString() }, "test-secret");
    res.json({ delivered: result.ok, status: result.status });
  } catch (err) {
    res.status(500).json({ error: "Webhook test failed", details: String(err) });
  }
});

const zapierWebhookSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1).max(100),
  webhookUrl: z.string().url(),
  eventTypes: z.array(z.string().refine(
    (val) => (ZAPIER_EVENT_TYPES as readonly string[]).includes(val),
    { message: "Invalid event type" }
  )).min(1),
});

router.get("/zapier/webhooks", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const webhooks = await db
      .select()
      .from(zapierWebhooks)
      .where(eq(zapierWebhooks.organizationId, user.organizationId))
      .orderBy(desc(zapierWebhooks.createdAt));
    res.json(webhooks);
  } catch (err) {
    logError("Failed to list Zapier webhooks", { error: String(err) });
    res.status(500).json({ error: "Failed to list webhooks" });
  }
});

router.post("/zapier/webhooks", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const parsed = zapierWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { connectionId, name, webhookUrl, eventTypes } = parsed.data;
    const connection = await connectionService.getConnection(connectionId, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "zapier") return res.status(400).json({ error: "Connection must be a Zapier connection" });

    const secretKey = generateWebhookSecret();
    const [webhook] = await db.insert(zapierWebhooks).values({
      organizationId: user.organizationId,
      connectionId,
      name,
      webhookUrl,
      eventTypes,
      secretKey,
      isActive: true,
    }).returning();

    logIntegrationAudit("zapier.webhook_created", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { webhookId: webhook.id, name, eventTypes },
    });
    res.status(201).json(webhook);
  } catch (err) {
    logError("Failed to create Zapier webhook", { error: String(err) });
    res.status(500).json({ error: "Failed to create webhook" });
  }
});

router.patch("/zapier/webhooks/:webhookId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { name, webhookUrl, eventTypes, isActive } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;
    if (eventTypes !== undefined) updates.eventTypes = eventTypes;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(zapierWebhooks)
      .set(updates)
      .where(
        and(
          eq(zapierWebhooks.id, req.params.webhookId),
          eq(zapierWebhooks.organizationId, user.organizationId)
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Webhook not found" });
    logIntegrationAudit("zapier.webhook_updated", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { webhookId: updated.id },
    });
    res.json(updated);
  } catch (err) {
    logError("Failed to update Zapier webhook", { error: String(err) });
    res.status(500).json({ error: "Failed to update webhook" });
  }
});

router.delete("/zapier/webhooks/:webhookId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const [deleted] = await db
      .delete(zapierWebhooks)
      .where(
        and(
          eq(zapierWebhooks.id, req.params.webhookId),
          eq(zapierWebhooks.organizationId, user.organizationId)
        )
      )
      .returning();

    if (!deleted) return res.status(404).json({ error: "Webhook not found" });
    logIntegrationAudit("zapier.webhook_deleted", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { webhookId: deleted.id },
    });
    res.json({ success: true });
  } catch (err) {
    logError("Failed to delete Zapier webhook", { error: String(err) });
    res.status(500).json({ error: "Failed to delete webhook" });
  }
});

router.post("/zapier/webhooks/:webhookId/test", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const [webhook] = await db
      .select()
      .from(zapierWebhooks)
      .where(
        and(
          eq(zapierWebhooks.id, req.params.webhookId),
          eq(zapierWebhooks.organizationId, user.organizationId)
        )
      );
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });

    const result = await deliverZapierWebhook(
      webhook.webhookUrl,
      "test.ping",
      { message: "Test webhook from SmartManageAI", organization: user.organizationId },
      webhook.secretKey
    );
    res.json({ delivered: result.ok, status: result.status });
  } catch (err) {
    logError("Zapier webhook test failed", { error: String(err) });
    res.status(500).json({ error: "Webhook test failed" });
  }
});

router.get("/zapier/event-types", requireAuth, (_req, res) => {
  res.json(ZAPIER_EVENT_TYPES);
});

router.post("/zapier/incoming/:secretKey", async (req, res) => {
  try {
    const { secretKey } = req.params;
    if (!secretKey) return res.status(400).json({ error: "Missing secret key" });

    const [webhook] = await db
      .select()
      .from(zapierWebhooks)
      .where(eq(zapierWebhooks.secretKey, secretKey));

    if (!webhook || !webhook.isActive) {
      return res.status(404).json({ error: "Webhook not found or inactive" });
    }

    logInfo("Zapier incoming webhook received", {
      webhookId: webhook.id,
      orgId: webhook.organizationId,
      action: req.body?.action || "unknown",
    });

    res.json({ received: true, webhookId: webhook.id });
  } catch (err) {
    logError("Zapier incoming webhook error", { error: String(err) });
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
