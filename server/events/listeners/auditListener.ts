import { eventBus } from "../eventBus";
import { logAudit } from "../../auditLogger";
import { logError } from "../../utils/logger";
import type { InsertAuditLog } from "@shared/schema";
import type { DomainEvent } from "../eventTypes";

type AuditAction = InsertAuditLog["action"];

const EVENT_TO_ACTION: Record<DomainEvent["type"], AuditAction> = {
  "project.created": "CREATE",
  "project.status_changed": "UPDATE",
  "bid.submitted": "SUBMIT",
  "bid.converted_to_project": "CREATE",
  "change_order.approved": "APPROVE",
  "change_order.rejected": "REJECT",
  "timeclock.checked_in": "CLOCK_IN",
  "timeclock.checked_out": "CLOCK_OUT",
  "payroll.run.completed": "UPDATE",
};

function getEntityId(event: DomainEvent): string {
  switch (event.type) {
    case "project.created":
    case "project.status_changed":
      return event.payload.projectId;
    case "bid.submitted":
    case "bid.converted_to_project":
      return event.payload.bidId;
    case "change_order.approved":
    case "change_order.rejected":
      return event.payload.changeOrderId;
    case "timeclock.checked_in":
    case "timeclock.checked_out":
      return event.payload.shiftId;
    case "payroll.run.completed":
      return event.payload.payRunId;
  }
}

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

export function registerAuditListener(): void {
  eventBus.onAll(async (event: DomainEvent) => {
    try {
      await logAudit({
        userId: event.actorId,
        entityType: ENTITY_TYPE_MAP[event.type],
        entityId: getEntityId(event),
        action: EVENT_TO_ACTION[event.type],
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
