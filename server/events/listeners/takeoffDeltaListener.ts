import { eventBus } from "../eventBus";
import { db } from "../../db";
import { notifications, users } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logError, logInfo, logWarn } from "../../utils/logger";
import { deliverNotifications } from "../../services/notificationDelivery";
import { computeTakeoffDelta, createChangeOrderFromDelta } from "../../services/takeoffDeltaChangeOrderService";
import type { TakeoffVersionSupersededEvent } from "../eventTypes";

const ADMIN_ROLES = ["ADMIN", "MANAGER"] as const;

async function getAdminUserIds(orgId: string): Promise<string[]> {
  try {
    const roles: string[] = [...ADMIN_ROLES];
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          eq(users.isActive, true),
          inArray(users.role, roles)
        )
      );
    return rows.map((r) => r.id);
  } catch {
    logWarn("Non-critical operation failed");
    return [];
  }
}

export function registerTakeoffDeltaListener(): void {
  eventBus.on("takeoff.version_superseded", async (event: TakeoffVersionSupersededEvent) => {
    try {
      const { payload } = event;

      if (!payload.projectId) {
        logInfo("takeoffDeltaListener: no projectId, skipping", { oldSheetId: payload.oldSheetId });
        return;
      }

      const delta = await computeTakeoffDelta(payload.oldSheetId, payload.newSheetId);

      if (!delta) {
        logInfo("takeoffDeltaListener: no delta computed (no versions or measurements)", {
          oldSheetId: payload.oldSheetId,
          newSheetId: payload.newSheetId,
        });
        return;
      }

      if (delta.addedCount === 0 && delta.removedCount === 0 && delta.changedCount === 0) {
        logInfo("takeoffDeltaListener: no meaningful deltas detected", {
          oldSheetId: payload.oldSheetId,
          newSheetId: payload.newSheetId,
        });
        return;
      }

      const result = await createChangeOrderFromDelta(
        payload.projectId,
        event.orgId,
        event.actorId,
        delta,
        payload.oldSheetName,
        payload.newSheetName,
        payload.revisionLabel,
      );

      if (result && result.created) {
        const adminIds = await getAdminUserIds(event.orgId);
        if (adminIds.length > 0) {
          const sheetLabel = payload.newSheetName || payload.oldSheetName || "Sheet";
          try {
            const inserted = await db.insert(notifications).values(
              adminIds.map((userId) => ({
                userId,
                organizationId: event.orgId || null,
                type: "SYSTEM" as const,
                title: "Auto Change Order from Plan Revision",
                message: `A change order was auto-generated for "${sheetLabel}" with a cost impact of $${delta.totalCostDelta.toFixed(2)}. Review and adjust as needed.`,
                relatedEntityId: result.changeOrderId,
                relatedEntityType: "changeOrder",
              }))
            ).returning();
            setImmediate(() => {
              deliverNotifications(inserted as Parameters<typeof deliverNotifications>[0]).catch(() => undefined);
            });
          } catch (notifErr) {
            logError("takeoffDeltaListener: failed to insert notifications", {
              error: String(notifErr),
            });
          }
        }
      }

      logInfo("takeoffDeltaListener: takeoff.version_superseded processed", {
        oldSheetId: payload.oldSheetId,
        newSheetId: payload.newSheetId,
        changeOrderCreated: result?.created ?? false,
      });
    } catch (err) {
      logError("takeoffDeltaListener: handler failed", {
        error: String(err),
        oldSheetId: event.payload.oldSheetId,
      });
    }
  });
}
