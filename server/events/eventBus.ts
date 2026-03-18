import { EventEmitter } from "events";
import type { DomainEvent, DomainEventType } from "./eventTypes";
import { ALL_DOMAIN_EVENT_TYPES } from "./eventTypes";
import { logError } from "../utils/logger";

type EventHandler<T extends DomainEvent> = (event: T) => void | Promise<void>;

class TypedEventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  on<T extends DomainEventType>(
    type: T,
    handler: EventHandler<Extract<DomainEvent, { type: T }>>
  ): void {
    this.emitter.on(type, (event: Extract<DomainEvent, { type: T }>) => {
      // Use .then() to ensure both sync throws and async rejections are caught.
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) => {
          logError(`EventBus: listener error for "${type}"`, {
            error: String(err),
            eventType: type,
          });
        });
    });
  }

  /**
   * Subscribe to all domain event types with a single handler.
   * Use this when the handler logic is uniform across all event types
   * (e.g., audit fan-out, webhook fan-out).
   */
  onAll(handler: (event: DomainEvent) => void | Promise<void>): void {
    for (const type of ALL_DOMAIN_EVENT_TYPES) {
      this.emitter.on(type, (event: DomainEvent) => {
        Promise.resolve()
          .then(() => handler(event))
          .catch((err) => {
            logError(`EventBus: listener error for "${type}"`, {
              error: String(err),
              eventType: type,
            });
          });
      });
    }
  }

  emit(event: DomainEvent): void {
    setImmediate(() => {
      this.emitter.emit(event.type, event);
    });
  }
}

export const eventBus = new TypedEventBus();
