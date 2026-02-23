import { db } from "../../../db";
import { zapierWebhooks } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { deliverZapierWebhook } from "./provider";
import { logInfo, logError } from "../../../utils/logger";

export async function dispatchZapierEvent(
  orgId: string,
  eventType: string,
  data: Record<string, any>
): Promise<{ dispatched: number; failed: number }> {
  const webhooks = await db
    .select()
    .from(zapierWebhooks)
    .where(
      and(
        eq(zapierWebhooks.organizationId, orgId),
        eq(zapierWebhooks.isActive, true)
      )
    );

  const matching = webhooks.filter((w) =>
    w.eventTypes.includes(eventType)
  );

  if (matching.length === 0) {
    return { dispatched: 0, failed: 0 };
  }

  let dispatched = 0;
  let failed = 0;

  for (const webhook of matching) {
    try {
      const result = await deliverZapierWebhook(
        webhook.webhookUrl,
        eventType,
        data,
        webhook.secretKey
      );

      await db
        .update(zapierWebhooks)
        .set({
          lastTriggeredAt: new Date(),
          lastStatus: result.ok ? "success" : `error_${result.status}`,
          triggerCount: sql`${zapierWebhooks.triggerCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(zapierWebhooks.id, webhook.id));

      if (result.ok) {
        dispatched++;
        logInfo("Zapier webhook delivered", {
          webhookId: webhook.id,
          eventType,
          orgId,
        });
      } else {
        failed++;
        logError("Zapier webhook delivery failed", {
          webhookId: webhook.id,
          eventType,
          status: result.status,
        });
      }
    } catch (err) {
      failed++;
      await db
        .update(zapierWebhooks)
        .set({
          lastTriggeredAt: new Date(),
          lastStatus: `error: ${String(err).slice(0, 100)}`,
          triggerCount: sql`${zapierWebhooks.triggerCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(zapierWebhooks.id, webhook.id));
      logError("Zapier webhook error", {
        webhookId: webhook.id,
        error: String(err),
      });
    }
  }

  return { dispatched, failed };
}
