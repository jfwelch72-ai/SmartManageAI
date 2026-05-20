import { EventEmitter } from "events";
import type { SupportTicketReply } from "@shared/schema";

export interface SupportReplyCreatedEvent {
  ticketId: string;
  reply: SupportTicketReply;
}

export type ActivityEventType = "created" | "status_changed" | "sla_breach" | "csat_rated";

export interface SupportActivityEvent {
  id: string;
  type: ActivityEventType;
  ticketId: string;
  subject: string;
  orgName: string | null;
  timestamp: string;
  meta?: Record<string, unknown>;
}

// In-memory ring buffer: captures the last ACTIVITY_LOG_CAPACITY events as
// they fire through the event bus. Serves the polling endpoint so it always
// reflects real occurrences rather than synthesised ticket snapshots.
const ACTIVITY_LOG_CAPACITY = 100;
const activityLog: SupportActivityEvent[] = [];

/** Returns the most recent `limit` activity events, newest-first. */
export function getRecentActivity(limit: number): SupportActivityEvent[] {
  return activityLog.slice(0, Math.min(limit, activityLog.length));
}

class SupportEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(500);

    // Keep the in-memory log up to date whenever an activity event fires.
    this.on("support.activity", (payload: SupportActivityEvent) => {
      activityLog.unshift(payload);
      if (activityLog.length > ACTIVITY_LOG_CAPACITY) {
        activityLog.length = ACTIVITY_LOG_CAPACITY;
      }
    });
  }

  emitReplyCreated(payload: SupportReplyCreatedEvent): void {
    this.emit(`support.reply.created:${payload.ticketId}`, payload);
  }

  onReplyCreated(
    ticketId: string,
    handler: (payload: SupportReplyCreatedEvent) => void,
  ): () => void {
    const event = `support.reply.created:${ticketId}`;
    this.on(event, handler);
    return () => this.off(event, handler);
  }

  emitActivity(payload: SupportActivityEvent): void {
    this.emit("support.activity", payload);
  }

  onActivity(handler: (payload: SupportActivityEvent) => void): () => void {
    this.on("support.activity", handler);
    return () => this.off("support.activity", handler);
  }
}

export const supportEventBus = new SupportEventBus();
