import { eventBus } from "../eventBus";
import { logAudit } from "../../auditLogger";
import { logError } from "../../utils/logger";
import type { DomainEvent } from "../eventTypes";

const ENTITY_TYPE_MAP: Record<DomainEvent["type"], string> = {
  "project.created": "project",
  "project.status_changed": "project",
  "bid.submitted": "bid",
  "bid.converted_to_project": "bid",
  "change_order.approved": "changeOrder",
  "change_order.rejected": "changeOrder",
  "timeclock.checked_in": "timeClock",
  "timeclock.checked_out": "timeClock",
  "payroll.run.completed": "payRun",
};

function getEntityId(event: DomainEvent): string {
  const p = event.payload as any;
  return (
    p.projectId ??
    p.bidId ??
    p.changeOrderId ??
    p.shiftId ??
    p.payRunId ??
    "unknown"
  );
}

export function registerAuditListener(): void {
  const ALL_TYPES: DomainEvent["type"][] = [
    "project.created",
    "project.status_changed",
    "bid.submitted",
    "bid.converted_to_project",
    "change_order.approved",
    "change_order.rejected",
    "timeclock.checked_in",
    "timeclock.checked_out",
    "payroll.run.completed",
  ];

  for (const type of ALL_TYPES) {
    eventBus.on(type as any, async (event: DomainEvent) => {
      try {
        await logAudit({
          userId: event.actorId,
          entityType: ENTITY_TYPE_MAP[event.type],
          entityId: getEntityId(event),
          action: "EVENT",
          oldValue: null,
          newValue: JSON.stringify({ eventType: event.type, payload: event.payload }),
        });
      } catch (err) {
        logError("auditListener: failed to write audit entry", {
          error: String(err),
          eventType: event.type,
        });
      }
    });
  }
}
