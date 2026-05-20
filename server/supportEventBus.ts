import { EventEmitter } from "events";
import type { SupportTicketReply } from "@shared/schema";

export interface SupportReplyCreatedEvent {
  ticketId: string;
  reply: SupportTicketReply;
}

class SupportEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(500);
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
}

export const supportEventBus = new SupportEventBus();
